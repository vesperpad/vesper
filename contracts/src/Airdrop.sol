// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {VesperToken} from "./VesperToken.sol";

/// @title Airdrop
/// @notice Holds the 10% minter airdrop. Each NFT tokenId can claim an equal `perShare` after a
///         1-month cliff; the claim right lives with the NFT (whoever holds it claims). If an NFT is
///         redeemed to the floor vault before claiming, its unclaimed share is burned (deflationary).
contract Airdrop {
    address public immutable factory;
    IERC721 public immutable nft;
    VesperToken public immutable token;
    uint256 public immutable unlock;

    uint256 public perShare;
    address public vault;
    bool private _configured;

    mapping(uint256 => bool) public claimed;

    event Claimed(uint256 indexed tokenId, address indexed to, uint256 amount);
    event BurnedUnclaimed(uint256 indexed tokenId, uint256 amount);

    constructor(address factory_, IERC721 nft_, VesperToken token_, uint256 unlock_) {
        factory = factory_;
        nft = nft_;
        token = token_;
        unlock = unlock_;
    }

    function configure(uint256 perShare_, address vault_) external {
        require(msg.sender == factory && !_configured, "CFG");
        perShare = perShare_;
        vault = vault_;
        _configured = true;
    }

    function claim(uint256 tokenId) external {
        require(block.timestamp >= unlock, "LOCKED");
        require(nft.ownerOf(tokenId) == msg.sender, "NOT_OWNER");
        require(!claimed[tokenId], "CLAIMED");
        claimed[tokenId] = true;
        token.transfer(msg.sender, perShare);
        emit Claimed(tokenId, msg.sender, perShare);
    }

    /// @notice Called by the floor vault when an NFT is redeemed: burn its unclaimed share.
    function burnUnclaimed(uint256 tokenId) external {
        require(msg.sender == vault, "NOT_VAULT");
        if (claimed[tokenId]) return;
        claimed[tokenId] = true;
        token.burn(perShare);
        emit BurnedUnclaimed(tokenId, perShare);
    }
}
