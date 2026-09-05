// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VesperNFT} from "./VesperNFT.sol";
import {Airdrop} from "./Airdrop.sol";

/// @title FloorVault
/// @notice Backing vault for a launch's NFTs. 30% of the token's ETH trade fees accrue here (sent by
///         the fee hook). Each NFT is redeemable for its equal share of the vault: floor = balance /
///         current NFT supply. Redeeming burns the NFT (and its unclaimed airdrop) and pays the holder
///         the floor minus a 3% fee that goes to the creator/dev splitter. As the token trades more,
///         the floor rises — so an active token lifts every NFT's price.
contract FloorVault {
    VesperNFT public immutable nft;
    Airdrop public immutable airdrop;
    address public immutable splitter; // FeeSplitter (creator/dev)
    uint256 public immutable unlock;
    uint256 public constant REDEEM_FEE_BPS = 300; // 3%

    uint256 private _lock = 1;

    event Redeemed(uint256 indexed tokenId, address indexed to, uint256 payout, uint256 fee);

    modifier nonReentrant() {
        require(_lock == 1, "REENTRANT");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(VesperNFT nft_, Airdrop airdrop_, address splitter_, uint256 unlock_) {
        nft = nft_;
        airdrop = airdrop_;
        splitter = splitter_;
        unlock = unlock_;
    }

    receive() external payable {}

    /// @notice Current floor price per NFT (ETH), for display.
    function floor() external view returns (uint256) {
        uint256 supply = nft.totalSupply();
        return supply == 0 ? 0 : address(this).balance / supply;
    }

    /// @notice Redeem an NFT for its floor share. Burns the NFT and its unclaimed airdrop.
    function redeem(uint256 tokenId) external nonReentrant {
        require(block.timestamp >= unlock, "LOCKED");
        require(nft.ownerOf(tokenId) == msg.sender, "NOT_OWNER");
        uint256 supply = nft.totalSupply();
        uint256 share = address(this).balance / supply;

        airdrop.burnUnclaimed(tokenId);
        nft.burn(tokenId);

        uint256 fee = (share * REDEEM_FEE_BPS) / 10_000;
        uint256 payout = share - fee;
        if (fee > 0) { (bool okf,) = splitter.call{value: fee}(""); require(okf, "FEE"); }
        if (payout > 0) { (bool okp,) = msg.sender.call{value: payout}(""); require(okp, "PAY"); }
        emit Redeemed(tokenId, msg.sender, payout, fee);
    }
}
