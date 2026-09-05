// Vesper front-end config. Fill FACTORY after the mainnet deploy of VesperFactory (NFT-gated model).
window.VESPER = {
  chain: {
    id: 4663,
    hex: "0x1237",
    name: "Robinhood",
    rpc: "https://robinhood-rpc.publicnode.com",
    logsRpc: "https://quarrel.lol/rpc",
    symbol: "ETH",
    explorer: "" // e.g. "https://explorer.robinhood..." — enables address links when set
  },
  FACTORY: "0x9a86E62BD2fe67220a8161099868406912F48D71", // empty => site runs in "launching soon" preview mode
  POOL_MANAGER: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  ROUTER: "0x569e99E9E8C09C4940a0407aD4E3d8ef90B6d51F", // PoolSwapTest (buy/sell helper)
  MARKET: "0x79dae07308e70c6Ce649D1dd9bD650249A1A0AA0", // NFT marketplace (list/buy)
  HOOK: "0xFd9EDa1DC25Df6fEC433Df778940D100a33a40cC",
  TICK_SPACING: 60,
  POOLS_SLOT: 6,
  MIN_SQRT_PRICE: "4295128739",
  MAX_SQRT_PRICE: "1461446703485210103287273052203988822378723970342",

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
    "function getApproved(uint256) view returns (address)",
    "function approve(address,uint256)",
    "function mint() payable"
  ],
  marketAbi: [
    "function list(address nft, uint256 tokenId, uint256 price)",
    "function cancel(address nft, uint256 tokenId)",
    "function buy(address nft, uint256 tokenId) payable",
    "function listings(address,uint256) view returns (address seller, uint256 price)",
    "event Listed(address indexed nft, uint256 indexed tokenId, address indexed seller, uint256 price)"
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
  ],
  poolManagerAbi: [
    "function extsload(bytes32 slot) view returns (bytes32)",
    "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"
  ],
  hookAbi: [
    "function feesOwed(address) view returns (uint256)",
    "function claim() returns (uint256)"
  ],
  routerAbi: [
    "function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,(bool takeClaims,bool settleUsingBurn) testSettings,bytes hookData) payable returns (int256)"
  ]
};
