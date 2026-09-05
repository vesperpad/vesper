// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, toBeforeSwapDelta, BeforeSwapDeltaLibrary} from
    "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @title VesperFeeHook
/// @notice Shared Uniswap V4 hook for every Vesper launch. Buys/sells pay 2.5% each, always in ETH
///         (currency0), split per pool: Creator 50% / NFT floor vault 30% / Dev 20%. The factory
///         registers each pool's creator and vault at launch. Unregistered pools send everything to
///         the dev treasury.
contract VesperFeeHook is BaseHook {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using PoolIdLibrary for PoolKey;

    uint256 public constant BUY_FEE_BPS = 250;
    uint256 public constant SELL_FEE_BPS = 250;
    uint256 public constant CREATOR_BPS = 5000; // 50% of the fee
    uint256 public constant VAULT_BPS = 3000; // 30% of the fee
    // dev gets the remainder (20%)

    address public immutable dev;
    address public immutable owner;
    address public factory;

    mapping(PoolId => address) public creatorOf;
    mapping(PoolId => address) public vaultOf;

    /// @notice Creator trade-fee earnings accrue here and must be claimed manually (not auto-sent).
    ///         The NFT floor vault (30%) and dev (20%) shares are still paid out automatically.
    mapping(address => uint256) public feesOwed;

    event FactorySet(address factory);
    event PoolRegistered(PoolId indexed id, address creator, address vault);
    event FeeSplit(PoolId indexed id, uint256 toCreator, uint256 toVault, uint256 toDev);
    event FeesClaimed(address indexed creator, uint256 amount);

    constructor(IPoolManager _manager, address _dev, address _owner) BaseHook(_manager) {
        require(_dev != address(0) && _owner != address(0), "ZERO");
        dev = _dev;
        owner = _owner;
    }

    function setFactory(address _factory) external {
        require(msg.sender == owner, "NOT_OWNER");
        require(factory == address(0) && _factory != address(0), "SET");
        factory = _factory;
        emit FactorySet(_factory);
    }

    function registerPool(PoolKey calldata key, address creator, address vault) external {
        require(msg.sender == factory, "NOT_FACTORY");
        require(creator != address(0) && vault != address(0), "ZERO");
        PoolId id = key.toId();
        creatorOf[id] = creator;
        vaultOf[id] = vault;
        emit PoolRegistered(id, creator, vault);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _split(PoolKey calldata key, uint256 feeAmount) internal {
        PoolId id = key.toId();
        address creator = creatorOf[id];
        address vault = vaultOf[id];
        if (creator == address(0)) {
            poolManager.take(key.currency0, dev, feeAmount);
            emit FeeSplit(id, 0, 0, feeAmount);
            return;
        }
        uint256 toCreator = (feeAmount * CREATOR_BPS) / 10_000;
        uint256 toVault = (feeAmount * VAULT_BPS) / 10_000;
        uint256 toDev = feeAmount - toCreator - toVault;
        // Creator's share is held here and claimed manually; vault + dev are paid out immediately.
        if (toCreator > 0) {
            poolManager.take(key.currency0, address(this), toCreator);
            feesOwed[creator] += toCreator;
        }
        if (toVault > 0) poolManager.take(key.currency0, vault, toVault);
        if (toDev > 0) poolManager.take(key.currency0, dev, toDev);
        emit FeeSplit(id, toCreator, toVault, toDev);
    }

    /// @notice Claim accrued creator trade fees (native ETH).
    function claim() external returns (uint256 amount) {
        amount = feesOwed[msg.sender];
        require(amount > 0, "NOTHING");
        feesOwed[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "SEND_FAIL");
        emit FeesClaimed(msg.sender, amount);
    }

    /// @notice ETH pulled from the pool for creator fees lands here.
    receive() external payable {}

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bool exactInput = params.amountSpecified < 0;
        bool ethIsSpecified = (params.zeroForOne == exactInput);
        if (!ethIsSpecified) return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        uint256 specifiedAbs =
            params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint256 feeBps = params.zeroForOne ? BUY_FEE_BPS : SELL_FEE_BPS;
        uint256 feeAmount = (specifiedAbs * feeBps) / 10_000;
        if (feeAmount == 0) return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        _split(key, feeAmount);
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(feeAmount)), int128(0)), 0);
    }

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        bool exactInput = params.amountSpecified < 0;
        bool ethIsSpecified = (params.zeroForOne == exactInput);
        if (ethIsSpecified) return (BaseHook.afterSwap.selector, int128(0));

        int128 ethDelta = delta.amount0();
        uint256 magnitude = ethDelta < 0 ? uint256(uint128(-ethDelta)) : uint256(uint128(ethDelta));
        uint256 feeBps = params.zeroForOne ? BUY_FEE_BPS : SELL_FEE_BPS;
        uint256 feeAmount = (magnitude * feeBps) / 10_000;
        if (feeAmount == 0) return (BaseHook.afterSwap.selector, int128(0));

        _split(key, feeAmount);
        return (BaseHook.afterSwap.selector, int128(int256(feeAmount)));
    }
}
