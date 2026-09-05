// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {VesperToken} from "./VesperToken.sol";
import {VesperNFT} from "./VesperNFT.sol";
import {Airdrop} from "./Airdrop.sol";
import {FloorVault} from "./FloorVault.sol";
import {FeeSplitter} from "./FeeSplitter.sol";

/// @title LaunchDeployer
/// @notice Stateless helper that deploys a launch's child contracts. This keeps their (large)
///         creation bytecode out of the VesperFactory, so the factory stays under the 24KB code
///         size limit. The factory holds one immutable reference to this deployer and calls it
///         during finalize; ownership/authority of each child is set via its constructor args
///         (e.g. Airdrop's factory, the token recipient), so the deployer itself is never trusted.
contract LaunchDeployer {
    function deployNFT(
        string calldata name,
        string calldata symbol,
        string calldata uri,
        address factory,
        uint256 maxSupply,
        uint256 mintPrice
    ) external returns (address) {
        return address(new VesperNFT(name, symbol, uri, factory, maxSupply, mintPrice));
    }

    function deployToken(string calldata name, string calldata symbol, string calldata uri, address to)
        external
        returns (address)
    {
        return address(new VesperToken(name, symbol, uri, to));
    }

    function deployAirdrop(address factory, IERC721 nft, VesperToken token, uint256 unlock)
        external
        returns (address)
    {
        return address(new Airdrop(factory, nft, token, unlock));
    }

    function deploySplitter(address creator, address dev, uint256 creatorBps) external returns (address) {
        return address(new FeeSplitter(creator, dev, creatorBps));
    }

    function deployVault(VesperNFT nft, Airdrop airdrop, address splitter, uint256 unlock)
        external
        returns (address)
    {
        return address(new FloorVault(nft, airdrop, splitter, unlock));
    }
}
