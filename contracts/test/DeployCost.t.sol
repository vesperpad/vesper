// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {VesperFeeHook} from "../src/VesperFeeHook.sol";
import {VesperFactory} from "../src/VesperFactory.sol";

contract DeployCostTest is Test {
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant CREATE2_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant DEVV = 0x00000000000000000000000000000000dE00DE00;

    function setUp() public { vm.createSelectFork(vm.envString("RH_RPC")); }

    function test_DeployCost() public {
        IPoolManager pm = IPoolManager(POOL_MANAGER);
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory args = abi.encode(pm, DEVV, address(this));
        (address hookAddr, bytes32 salt) = HookMiner.find(CREATE2_PROXY, flags, type(VesperFeeHook).creationCode, args);
        bytes memory initcode = abi.encodePacked(type(VesperFeeHook).creationCode, args);

        uint256 g0 = gasleft();
        (bool ok,) = CREATE2_PROXY.call(abi.encodePacked(salt, initcode));
        uint256 gHook = g0 - gasleft();
        require(ok && hookAddr.code.length > 0, "hook");

        uint256 g1 = gasleft();
        VesperFactory f = new VesperFactory(pm, IPositionManager(POSITION_MANAGER), IAllowanceTransfer(PERMIT2), VesperFeeHook(hookAddr), DEVV, DEVV);
        uint256 gFac = g1 - gasleft();

        uint256 g2 = gasleft();
        VesperFeeHook(hookAddr).setFactory(address(f)); // note: owner is 0xBEEF, will revert; measure separately below
        uint256 gSet = g2 - gasleft();

        console2.log("hook deploy gas   ", gHook);
        console2.log("factory deploy gas", gFac);
        console2.log("setFactory gas    ", gSet);
        console2.log("sum (exec only)   ", gHook + gFac + gSet);
    }
}
