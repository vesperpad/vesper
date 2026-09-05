// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {VesperFeeHook} from "../src/VesperFeeHook.sol";
import {VesperFactory} from "../src/VesperFactory.sol";
import {LaunchDeployer} from "../src/LaunchDeployer.sol";

/// @notice Deploys the Vesper launchpad infrastructure on Robinhood Chain:
///         the shared VesperFeeHook (mined address) + VesperFactory, then wires them.
/// Env: PRIVATE_KEY (deployer/owner), FEES_TRADE, FEES_MINT, FEES_SECONDARY
contract Deploy is Script {
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant CREATE2_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(pk);
        address feesTrade = vm.envAddress("FEES_TRADE");
        address feesMint = vm.envAddress("FEES_MINT");
        address feesSecondary = vm.envAddress("FEES_SECONDARY");
        IPoolManager pm = IPoolManager(POOL_MANAGER);

        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory args = abi.encode(pm, feesTrade, owner);
        (address hookAddr, bytes32 salt) = HookMiner.find(CREATE2_PROXY, flags, type(VesperFeeHook).creationCode, args);

        vm.startBroadcast(pk);
        bytes memory initcode = abi.encodePacked(type(VesperFeeHook).creationCode, args);
        (bool ok,) = CREATE2_PROXY.call(abi.encodePacked(salt, initcode));
        require(ok && hookAddr.code.length > 0, "hook deploy");
        VesperFeeHook hook = VesperFeeHook(hookAddr);

        address depEnv = vm.envOr("DEP", address(0));
        LaunchDeployer dep = depEnv != address(0) ? LaunchDeployer(depEnv) : new LaunchDeployer();
        VesperFactory factory = new VesperFactory(
            pm, IPositionManager(POSITION_MANAGER), IAllowanceTransfer(PERMIT2), hook, dep, feesMint, feesSecondary
        );
        hook.setFactory(address(factory));
        vm.stopBroadcast();

        console2.log("HOOK    ", hookAddr);
        console2.log("DEPLOYER", address(dep));
        console2.log("FACTORY ", address(factory));
        console2.log("OWNER   ", owner);
    }
}
