// Vesper front-end config. Fill FACTORY after the mainnet deploy of VesperFactory (NFT-gated model).
window.VESPER = {
  chain: {
    id: 4663,
    hex: "0x1237",
    name: "Robinhood",
    rpc: "https://robinhood-rpc.publicnode.com",
    symbol: "ETH",
    explorer: "" // e.g. "https://explorer.robinhood..." — enables address links when set
  },
  FACTORY: "0xB8E089d63aeAfb890F852B9ba74805B39ec40391", // empty => site runs in "launching soon" preview mode

  factoryAbi: [
    "function createLaunch(string tokenName, string tokenSymbol, string uri, string nftName, string nftSymbol, uint256 nftSupply, uint256 mintPrice) returns (address)",
    "function allNftsLength() view returns (uint256)",
    "function allNfts(uint256) view returns (address)",
    "function launchesLength() view returns (uint256)",
    "function finalizedIndex(address) view returns (uint256)",
    "function launches(uint256) view returns (address nft, address token, address vault, address airdrop, address splitter)",
    "function configs(address) view returns (address creator, string name, string symbol, string uri, bool done)",
    "event LaunchCreated(address indexed nft, address indexed creator, uint256 maxSupply, uint256 mintPrice)",
    "event LaunchFinalized(address indexed nft, address indexed token, address vault, address airdrop, bool twoSided)"
  ],
  nftAbi: [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function contractURI() view returns (string)",
    "function maxSupply() view returns (uint256)",
    "function mintPrice() view returns (uint256)",
    "function totalMinted() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function finalized() view returns (bool)",
    "function hasMinted(address) view returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
    "function mint() payable"
  ],
  tokenAbi: [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function contractURI() view returns (string)",
    "function totalSupply() view returns (uint256)"
  ],
  vaultAbi: [
    "function floor() view returns (uint256)",
    "function unlock() view returns (uint256)",
    "function redeem(uint256 tokenId)"
  ],
  airdropAbi: [
    "function perShare() view returns (uint256)",
    "function unlock() view returns (uint256)",
    "function claimed(uint256) view returns (bool)",
    "function claim(uint256 tokenId)"
  ]
};
