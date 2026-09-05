// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IVesperFactoryFinalize {
    function finalize(address nft) external;
}

interface IAirdropClaimed {
    function claimed(uint256 tokenId) external view returns (bool);
}

/// @title VesperNFT
/// @notice The launch collection. Minting is free or paid (creator-set), capped at 1 per wallet.
///         Mint ETH accrues here until sold out, when it auto-calls the factory to deploy the token,
///         seed + lock liquidity, and wire the airdrop + floor vault. After launch, the floor vault
///         may burn NFTs on redeem. EIP-2981 royalty (5%) routes to the launch's FeeSplitter.
///         Enumerable so front-ends can list a holder's NFTs.
contract VesperNFT is ERC721Enumerable, IERC2981 {
    address public immutable factory;
    uint256 public immutable maxSupply;
    uint256 public immutable mintPrice; // 0 = free
    string private _uri;

    uint256 public totalMinted;
    bool public finalized;
    address public vault; // set at finalize; only it may burn
    address public airdrop; // set at finalize; used to lock claimed NFTs
    address public royaltyReceiver; // FeeSplitter; set at finalize
    uint96 public constant ROYALTY_BPS = 500; // 5%

    mapping(address => bool) public hasMinted;

    event Minted(address indexed to, uint256 indexed tokenId);
    event Finalized();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory uri_,
        address factory_,
        uint256 maxSupply_,
        uint256 mintPrice_
    ) ERC721(name_, symbol_) {
        require(factory_ != address(0) && maxSupply_ > 0, "PARAM");
        _uri = uri_;
        factory = factory_;
        maxSupply = maxSupply_;
        mintPrice = mintPrice_;
    }

    function mint() external payable {
        require(!finalized, "DONE");
        require(totalMinted < maxSupply, "SOLD_OUT");
        require(!hasMinted[msg.sender], "ONE_PER_WALLET");
        require(msg.value == mintPrice, "BAD_VALUE");
        hasMinted[msg.sender] = true;
        uint256 id = ++totalMinted; // ids 1..maxSupply
        _mint(msg.sender, id);
        emit Minted(msg.sender, id);
        if (totalMinted == maxSupply) {
            IVesperFactoryFinalize(factory).finalize(address(this));
        }
    }

    /// @notice Fallback trigger if the last mint didn't finalize for any reason.
    function finalize() external {
        require(!finalized && totalMinted == maxSupply, "NOT_READY");
        IVesperFactoryFinalize(factory).finalize(address(this));
    }

    // --- factory hooks (only during finalize) ---
    function sweepTo(address to) external returns (uint256 amount) {
        require(msg.sender == factory, "NOT_FACTORY");
        amount = address(this).balance;
        if (amount > 0) { (bool ok,) = to.call{value: amount}(""); require(ok, "SWEEP"); }
    }

    function wire(address vault_, address royaltyReceiver_, address airdrop_) external {
        require(msg.sender == factory, "NOT_FACTORY");
        require(!finalized, "DONE");
        vault = vault_;
        royaltyReceiver = royaltyReceiver_;
        airdrop = airdrop_;
        finalized = true;
        emit Finalized();
    }

    /// @notice Burn a token — only the floor vault, on redeem.
    function burn(uint256 tokenId) external {
        require(msg.sender == vault, "NOT_VAULT");
        _burn(tokenId);
    }

    function tokenURI(uint256) public view override returns (string memory) {
        return _uri;
    }

    function contractURI() external view returns (string memory) {
        return _uri;
    }

    function royaltyInfo(uint256, uint256 salePrice) external view override returns (address, uint256) {
        return (royaltyReceiver, (salePrice * ROYALTY_BPS) / 10_000);
    }

    /// @dev Once an NFT's airdrop is claimed it becomes non-transferable to others — it can only be
    ///      burned (redeemed to the floor). Minting (from == 0) and burning (to == 0) are always allowed.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && airdrop != address(0)) {
            require(!IAirdropClaimed(airdrop).claimed(tokenId), "CLAIMED_LOCKED");
        }
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 amount) internal override(ERC721Enumerable) {
        super._increaseBalance(account, amount);
    }

    function supportsInterface(bytes4 id) public view override(ERC721Enumerable, IERC165) returns (bool) {
        return id == type(IERC2981).interfaceId || super.supportsInterface(id);
    }
}
