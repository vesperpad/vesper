// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title VesperToken
/// @notice Fixed-supply (1,000,000,000) ERC-20 minted once, in full, to its deployer (the launch
///         factory), which then splits it between the airdrop contract and the locked LP. Burnable
///         so the airdrop contract can burn a redeemed NFT's unclaimed share (deflationary).
contract VesperToken is ERC20Burnable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    string private _contractURI;

    constructor(string memory name_, string memory symbol_, string memory contractURI_) ERC20(name_, symbol_) {
        _contractURI = contractURI_;
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    /// @notice ERC-7572 contract-level metadata URI (Irys/HTTP JSON).
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }
}
