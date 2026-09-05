// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {VesperToken} from "./VesperToken.sol";
import {VesperNFT} from "./VesperNFT.sol";
import {VesperFeeHook} from "./VesperFeeHook.sol";
import {Airdrop} from "./Airdrop.sol";
import {FloorVault} from "./FloorVault.sol";
import {LaunchDeployer} from "./LaunchDeployer.sol";

/// @title VesperFactory
/// @notice NFT-gated launchpad. `createLaunch` deploys an NFT collection; when it mints out the NFT
///         calls `finalize`, which splits the raised ETH (LP 50 / creator 30 / dev 20), deploys the
///         token, opens + locks a Uniswap V4 market (two-sided if the mint was paid, single-sided if
///         free), and wires the airdrop (10%, 1-month lock) and the fee-backed floor vault.
contract VesperFactory {
    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    VesperFeeHook public immutable hook;
    LaunchDeployer public immutable dep; // deploys child contracts (keeps factory under 24KB)
    address public immutable devMint; // receives the dev cut of paid mints (20%)
    address public immutable devSecondary; // receives dev cut of royalty + redeem (via FeeSplitter)
    // note: the dev cut of TRADE fees (20%) goes to the hook's own `dev` wallet, set at hook deploy

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    int24 public constant TICK_SPACING = 60;
    int24 public constant RANGE_WIDTH = 60_000;
    uint256 public constant FDV_X100 = 180; // 1.8 ETH FDV (free-mint reference)
    uint256 public constant AIRDROP_BPS = 1000; // 10%
    uint256 public constant LOCK = 30 days;

    struct Config { address creator; string name; string symbol; string uri; bool done; }
    mapping(address => Config) public configs; // nft => config

    struct Launch { address nft; address token; address vault; address airdrop; address splitter; }
    Launch[] public launches;
    mapping(address => uint256) public launchOf; // token => index+1

    address[] public allNfts; // every collection created (minting or finalized)
    mapping(address => uint256) public finalizedIndex; // nft => launches index+1 (0 = not finalized)

    event LaunchCreated(address indexed nft, address indexed creator, uint256 maxSupply, uint256 mintPrice);
    event LaunchFinalized(address indexed nft, address indexed token, address vault, address airdrop, bool twoSided);

    constructor(
        IPoolManager _poolManager,
        IPositionManager _positionManager,
        IAllowanceTransfer _permit2,
        VesperFeeHook _hook,
        LaunchDeployer _dep,
        address _devMint,
        address _devSecondary
    ) {
        require(_devMint != address(0) && _devSecondary != address(0), "ZERO");
        poolManager = _poolManager;
        positionManager = _positionManager;
        permit2 = _permit2;
        hook = _hook;
        dep = _dep;
        devMint = _devMint;
        devSecondary = _devSecondary;
    }

    function launchesLength() external view returns (uint256) {
        return launches.length;
    }

    function allNftsLength() external view returns (uint256) {
        return allNfts.length;
    }

    /// @notice Deploy a new NFT collection that gates a token launch.
    function createLaunch(
        string calldata tokenName,
        string calldata tokenSymbol,
        string calldata uri,
        string calldata nftName,
        string calldata nftSymbol,
        uint256 nftSupply,
        uint256 mintPrice
    ) external returns (address nft) {
        require(nftSupply > 0, "SUPPLY");
        nft = dep.deployNFT(nftName, nftSymbol, uri, address(this), nftSupply, mintPrice);
        configs[nft] = Config({creator: msg.sender, name: tokenName, symbol: tokenSymbol, uri: uri, done: false});
        allNfts.push(nft);
        emit LaunchCreated(nft, msg.sender, nftSupply, mintPrice);
    }

    /// @notice Called by the NFT when sold out (auto or via its permissionless fallback).
    function finalize(address nftAddr) external {
        Config storage cfg = configs[nftAddr];
        require(cfg.creator != address(0) && !cfg.done, "BAD");
        cfg.done = true;
        VesperNFT nft = VesperNFT(nftAddr);
        require(nft.totalMinted() == nft.maxSupply(), "NOT_SOLD_OUT");

        // 1. pull raised ETH, split LP50 / creator30 / dev20
        uint256 raised = nft.sweepTo(address(this));
        uint256 lpEth = (raised * 50) / 100;
        uint256 crEth = (raised * 30) / 100;
        uint256 devEth = raised - lpEth - crEth;
        if (crEth > 0) { (bool a,) = cfg.creator.call{value: crEth}(""); require(a, "CR"); }
        if (devEth > 0) { (bool b,) = devMint.call{value: devEth}(""); require(b, "DEV"); }

        // 2. token (mints 1B to this factory), split airdrop vs LP
        VesperToken token = VesperToken(dep.deployToken(cfg.name, cfg.symbol, cfg.uri, address(this)));
        uint256 total = token.TOTAL_SUPPLY();
        uint256 airdropAlloc = (total * AIRDROP_BPS) / 10_000;
        uint256 lpTokens = total - airdropAlloc;

        // 3. airdrop + splitter + vault (deployed via helper to keep this factory small)
        uint256 unlock = block.timestamp + LOCK;
        Airdrop airdrop = Airdrop(dep.deployAirdrop(address(this), IERC721(nftAddr), token, unlock));
        token.transfer(address(airdrop), airdropAlloc);
        address splitter = dep.deploySplitter(cfg.creator, devSecondary, 6000);
        FloorVault vault = FloorVault(payable(dep.deployVault(nft, airdrop, splitter, unlock)));
        airdrop.configure(airdropAlloc / nft.maxSupply(), address(vault));

        // 4. pool + LP
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        hook.registerPool(key, cfg.creator, address(vault));
        bool twoSided = _seedPool(key, address(token), lpEth, lpTokens, address(vault));

        // 5. wire NFT (also flips it to finalized)
        nft.wire(address(vault), splitter, address(airdrop));

        launches.push(Launch(nftAddr, address(token), address(vault), address(airdrop), splitter));
        launchOf[address(token)] = launches.length;
        finalizedIndex[nftAddr] = launches.length;
        emit LaunchFinalized(nftAddr, address(token), address(vault), address(airdrop), twoSided);
    }

    /// @dev Seeds and locks liquidity. Paid mint => two-sided full-range (ETH + token); free mint =>
    ///      single-sided token-only at the FDV reference. Returns whether it was two-sided.
    function _seedPool(PoolKey memory key, address token, uint256 lpEth, uint256 lpTokens, address vault)
        internal
        returns (bool twoSided)
    {
        IERC20(token).approve(address(permit2), type(uint256).max);
        permit2.approve(token, address(positionManager), type(uint160).max, type(uint48).max);

        if (lpEth > 0) {
            twoSided = true;
            // init at the price implied by the deposited amounts (token per ETH), full range
            uint256 tokenPerEth = lpTokens / lpEth; // whole tokens per whole ETH (both 1e18-scaled)
            uint160 sqrtP = _sqrtPriceForTokenPerEth(tokenPerEth);
            poolManager.initialize(key, sqrtP);
            int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
            int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);
            uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
                sqrtP, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), lpEth, lpTokens
            );
            // MINT + SETTLE_PAIR + SWEEP (refund unused native ETH to the factory)
            bytes memory actions =
                abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP));
            bytes[] memory params = new bytes[](3);
            params[0] = abi.encode(
                key, tickLower, tickUpper, uint256(liq), type(uint128).max, type(uint128).max, DEAD, bytes("")
            );
            params[1] = abi.encode(key.currency0, key.currency1);
            params[2] = abi.encode(key.currency0, address(this));
            positionManager.modifyLiquidities{value: lpEth}(abi.encode(actions, params), block.timestamp + 300);
        } else {
            twoSided = false;
            uint256 tokenPerEth = (1_000_000_000 * 100) / FDV_X100;
            uint160 sqrtLaunch = _sqrtPriceForTokenPerEth(tokenPerEth);
            int24 tickUpper = (TickMath.getTickAtSqrtPrice(sqrtLaunch) / TICK_SPACING) * TICK_SPACING;
            int24 tickLower = tickUpper - RANGE_WIDTH;
            poolManager.initialize(key, TickMath.getSqrtPriceAtTick(tickUpper));
            uint128 liq = LiquidityAmounts.getLiquidityForAmount1(
                TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), lpTokens
            );
            bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
            bytes[] memory params = new bytes[](2);
            params[0] = abi.encode(
                key, tickLower, tickUpper, uint256(liq), type(uint128).max, type(uint128).max, DEAD, bytes("")
            );
            params[1] = abi.encode(key.currency0, key.currency1);
            positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp + 300);
        }

        // sweep leftovers: unused token -> burn (deflationary); unused ETH -> vault (bonus floor)
        uint256 leftTok = IERC20(token).balanceOf(address(this));
        if (leftTok > 0) VesperToken(token).burn(leftTok);
        uint256 leftEth = address(this).balance;
        if (leftEth > 0) { (bool ok,) = vault.call{value: leftEth}(""); require(ok, "SWEEP_ETH"); }
    }

    function _sqrtPriceForTokenPerEth(uint256 tokenPerEth) internal pure returns (uint160) {
        uint256 sqrtPrice = _sqrt(tokenPerEth * 1e18) * (1 << 96) / 1e9;
        return uint160(sqrtPrice);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    receive() external payable {}
}
