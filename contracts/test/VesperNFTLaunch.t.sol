// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {VesperFeeHook} from "../src/VesperFeeHook.sol";
import {VesperFactory} from "../src/VesperFactory.sol";
import {LaunchDeployer} from "../src/LaunchDeployer.sol";
import {VesperNFT} from "../src/VesperNFT.sol";
import {VesperToken} from "../src/VesperToken.sol";
import {Airdrop} from "../src/Airdrop.sol";
import {FloorVault} from "../src/FloorVault.sol";
import {VesperMarket} from "../src/VesperMarket.sol";

contract VesperNFTLaunchTest is Test {
    using PoolIdLibrary for PoolKey;

    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant CREATE2_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address constant DEV_TRADE = 0x00000000000000000000000000000000DEAD0001;
    address constant DEV_MINT = 0x00000000000000000000000000000000DEAD0002;
    address constant DEV_SEC = 0x00000000000000000000000000000000DEad0003;

    IPoolManager pm = IPoolManager(POOL_MANAGER);
    VesperFeeHook hook;
    VesperFactory factory;
    address creator = makeAddr("creator");

    uint256 constant NFT_SUPPLY = 5;
    uint256 constant PRICE = 0.01 ether;

    function setUp() public {
        vm.createSelectFork(vm.envString("RH_RPC"));
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory args = abi.encode(pm, DEV_TRADE, address(this));
        (address hookAddr, bytes32 salt) = HookMiner.find(CREATE2_PROXY, flags, type(VesperFeeHook).creationCode, args);
        (bool ok,) =
            CREATE2_PROXY.call(abi.encodePacked(salt, abi.encodePacked(type(VesperFeeHook).creationCode, args)));
        require(ok && hookAddr.code.length > 0, "hook");
        hook = VesperFeeHook(payable(hookAddr));
        LaunchDeployer dep = new LaunchDeployer();
        factory = new VesperFactory(pm, IPositionManager(POSITION_MANAGER), IAllowanceTransfer(PERMIT2), hook, dep, DEV_MINT, DEV_SEC);
        hook.setFactory(address(factory));
    }

    function _minter(uint256 i) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("minter", i)))));
    }

    function _key(address token) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    function test_PaidLaunch_FullFlow() public {
        vm.prank(creator);
        address nft = factory.createLaunch(
            "Vesper Cat", "VCAT", "https://gateway.irys.xyz/x", "Vesper Cat NFT", "VCATN", NFT_SUPPLY, PRICE
        );

        uint256 crBefore = creator.balance;
        uint256 devBefore = DEV_MINT.balance;
        uint256 deadNfts = IERC721(POSITION_MANAGER).balanceOf(DEAD);

        for (uint256 i = 0; i < NFT_SUPPLY; i++) {
            address m = _minter(i);
            vm.deal(m, 1 ether);
            vm.prank(m);
            VesperNFT(nft).mint{value: PRICE}(); // 5th mint auto-finalizes
        }

        assertEq(factory.launchesLength(), 1, "launch recorded");
        (, address token, address vault, address airdrop,) = factory.launches(0);

        assertLe(VesperToken(token).totalSupply(), 1_000_000_000 ether, "supply <= 1B");
        assertEq(IERC20(token).balanceOf(airdrop), 100_000_000 ether, "airdrop 10%");
        assertGt(IERC20(token).balanceOf(POOL_MANAGER), 800_000_000 ether, "pool holds most tokens");
        assertEq(IERC721(POSITION_MANAGER).balanceOf(DEAD), deadNfts + 1, "LP burned");
        assertEq(creator.balance, crBefore + 0.015 ether, "creator 30%");
        assertEq(DEV_MINT.balance, devBefore + 0.01 ether, "dev 20%");
        assertApproxEqAbs(vault.balance, 0.025 ether, 1e14, "vault seeded with 50% of mint as floor");

        PoolKey memory key = _key(token);
        assertEq(hook.creatorOf(key.toId()), creator, "hook creator");
        assertEq(hook.vaultOf(key.toId()), vault, "hook vault");

        // airdrop claim (tokenId 1)
        address holder1 = _minter(0);
        vm.warp(block.timestamp + 31 days);
        vm.prank(holder1);
        Airdrop(airdrop).claim(1);
        assertEq(IERC20(token).balanceOf(holder1), 20_000_000 ether, "airdrop share 100M/5");

        // claimed NFT is locked (can't sell to others); unclaimed NFT still transfers
        vm.prank(holder1);
        vm.expectRevert(bytes("CLAIMED_LOCKED"));
        IERC721(nft).transferFrom(holder1, address(0xBEEF), 1);
        address holder3 = _minter(2);
        vm.prank(holder3);
        IERC721(nft).transferFrom(holder3, address(0xCAFE), 3);
        assertEq(IERC721(nft).ownerOf(3), address(0xCAFE), "unclaimed transferable");

        // swap (buy) -> fee split 50/30/20
        PoolSwapTest router = new PoolSwapTest(pm);
        address buyer = makeAddr("buyer");
        vm.deal(buyer, 10 ether);
        uint256 crEthBefore = creator.balance;
        uint256 devEthBefore = DEV_TRADE.balance;
        uint256 vaultBefore = vault.balance;
        uint256 amountIn = 0.1 ether;
        SwapParams memory sp = SwapParams({
            zeroForOne: true,
            amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        PoolSwapTest.TestSettings memory ts = PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        vm.prank(buyer);
        router.swap{value: amountIn + 0.05 ether}(key, sp, ts, bytes(""));

        uint256 feeTotal = (amountIn * 250) / 10_000; // 0.0025
        // creator fee is NOT auto-sent anymore; it accrues in the hook for manual claim
        assertEq(creator.balance, crEthBefore, "creator not auto-paid");
        assertApproxEqAbs(hook.feesOwed(creator), feeTotal * 50 / 100, 1e13, "creator 50% fee accrued");
        assertApproxEqAbs(vault.balance - vaultBefore, feeTotal * 30 / 100, 1e13, "vault 30% fee");
        assertApproxEqAbs(DEV_TRADE.balance - devEthBefore, feeTotal * 20 / 100, 1e13, "dev 20% fee");
        assertGt(IERC20(token).balanceOf(buyer), 0, "buyer got tokens");
        // creator claims accrued fees
        uint256 owed = hook.feesOwed(creator);
        vm.prank(creator);
        hook.claim();
        assertEq(creator.balance - crEthBefore, owed, "creator claimed fees");
        assertEq(hook.feesOwed(creator), 0, "owed cleared after claim");

        // redeem NFT #2 to floor
        address holder2 = _minter(1);
        uint256 supplyBefore = VesperNFT(nft).totalSupply();
        uint256 h2Before = holder2.balance;
        vm.prank(holder2);
        FloorVault(payable(vault)).redeem(2);
        assertEq(VesperNFT(nft).totalSupply(), supplyBefore - 1, "nft burned");
        assertGt(holder2.balance, h2Before, "redeemer got floor ETH");
    }

    function test_Marketplace() public {
        vm.prank(creator);
        address nft = factory.createLaunch("MktTok", "MKT", "u", "Mkt NFT", "MKTN", 2, PRICE);
        for (uint256 i = 0; i < 2; i++) { address m = _minter(200 + i); vm.deal(m, 1 ether); vm.prank(m); VesperNFT(nft).mint{value: PRICE}(); }
        (address ln, address lt, address lv, address la, address splitter) = factory.launches(factory.launchesLength() - 1);
        ln; lt; lv; la;

        VesperMarket mkt = new VesperMarket();
        address seller = _minter(200); // holds tokenId 1, unclaimed -> transferable
        address buyer = makeAddr("mktbuyer"); vm.deal(buyer, 1 ether);
        uint256 price = 0.02 ether;

        vm.startPrank(seller);
        IERC721(nft).approve(address(mkt), 1);
        mkt.list(nft, 1, price);
        vm.stopPrank();

        uint256 sellerBefore = seller.balance;
        uint256 splitBefore = splitter.balance;
        vm.prank(buyer);
        mkt.buy{value: price}(nft, 1);

        assertEq(IERC721(nft).ownerOf(1), buyer, "buyer got NFT");
        uint256 royalty = price * 5 / 100;
        assertEq(splitter.balance, splitBefore + royalty, "5% royalty to splitter");
        assertEq(seller.balance, sellerBefore + price - royalty, "seller got price - royalty");
    }

    function test_FreeLaunch_SingleSided() public {
        vm.prank(creator);
        address nft = factory.createLaunch("Free Tok", "FREE", "u", "Free NFT", "FN", NFT_SUPPLY, 0);
        for (uint256 i = 0; i < NFT_SUPPLY; i++) {
            vm.prank(_minter(100 + i));
            VesperNFT(nft).mint();
        }
        (, address token,,,) = factory.launches(0);
        assertGt(IERC20(token).balanceOf(POOL_MANAGER), 800_000_000 ether, "single-sided pool tokens");
    }
}
