// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

/// @title VesperMarket
/// @notice Minimal peer-to-peer marketplace for Vesper NFTs. A holder lists an NFT for a price; a
///         buyer pays it and the NFT transfers directly from seller to buyer. EIP-2981 royalty (5%)
///         is split off to the collection's royalty receiver (creator/dev). Claimed NFTs are locked
///         by the collection, so only un-claimed NFTs can be listed/sold here (a claimed one reverts
///         on transfer). No custody: the NFT stays with the seller until it sells.
contract VesperMarket {
    struct Listing { address seller; uint256 price; }
    mapping(address => mapping(uint256 => Listing)) public listings; // nft => tokenId => listing

    uint256 private _lock = 1;
    modifier nonReentrant() { require(_lock == 1, "REENTRANT"); _lock = 2; _; _lock = 1; }

    event Listed(address indexed nft, uint256 indexed tokenId, address indexed seller, uint256 price);
    event Cancelled(address indexed nft, uint256 indexed tokenId);
    event Sold(address indexed nft, uint256 indexed tokenId, address seller, address buyer, uint256 price);

    function list(address nft, uint256 tokenId, uint256 price) external {
        require(price > 0, "PRICE");
        require(IERC721(nft).ownerOf(tokenId) == msg.sender, "NOT_OWNER");
        require(
            IERC721(nft).getApproved(tokenId) == address(this) || IERC721(nft).isApprovedForAll(msg.sender, address(this)),
            "NOT_APPROVED"
        );
        listings[nft][tokenId] = Listing(msg.sender, price);
        emit Listed(nft, tokenId, msg.sender, price);
    }

    function cancel(address nft, uint256 tokenId) external {
        require(listings[nft][tokenId].seller == msg.sender, "NOT_SELLER");
        delete listings[nft][tokenId];
        emit Cancelled(nft, tokenId);
    }

    function buy(address nft, uint256 tokenId) external payable nonReentrant {
        Listing memory l = listings[nft][tokenId];
        require(l.seller != address(0), "NOT_LISTED");
        require(msg.value == l.price, "BAD_VALUE");
        delete listings[nft][tokenId];

        uint256 royalty;
        address receiver;
        try IERC2981(nft).royaltyInfo(tokenId, l.price) returns (address r, uint256 amt) { receiver = r; royalty = amt; }
        catch {}
        if (royalty >= l.price) royalty = 0;

        IERC721(nft).transferFrom(l.seller, msg.sender, tokenId); // reverts if the NFT is claim-locked
        if (royalty > 0 && receiver != address(0)) { (bool okr,) = receiver.call{value: royalty}(""); require(okr, "ROYALTY"); }
        (bool oks,) = l.seller.call{value: l.price - royalty}(""); require(oks, "PAY");
        emit Sold(nft, tokenId, l.seller, msg.sender, l.price);
    }
}
