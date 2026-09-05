# Vesper

The launchpad for Robinhood Chain — where a token launch starts as an NFT mint.

**Website:** [vesperpad.world](https://vesperpad.world) · **X:** [@vesperpad](https://x.com/vesperpad)

A creator deploys an NFT collection. When it mints out, the token launches by itself: a real
Uniswap V4 market opens and the liquidity is locked forever. Minters receive a locked airdrop, and a
share of the token's trade fees backs a growing NFT floor — so an active token lifts every NFT.

## How it works

1. **Create** — deploy an NFT collection for your token (set supply and a free or paid mint, 1 per wallet).
2. **Mint** — people mint. On a paid mint the ETH is split **LP 50% / creator 30% / dev 20%**; the LP share funds the token's liquidity.
3. **Auto-launch** — on sold-out the token deploys, a Uniswap V4 ETH market opens (two-sided if paid, single-sided if free), and the LP position is burned.
4. **Airdrop** — 10% of supply goes to minters, locked one month; the claim is attached to the NFT.
5. **Floor** — 30% of every trade fee (2.5% / 2.5%) flows to a vault that backs the NFTs. Trade fees split **creator 50 / vault 30 / dev 20**.
6. **Exit** — sell the NFT before claiming (buyer inherits the airdrop), or redeem it to the floor anytime after the lock. Once claimed, the NFT can only be redeemed/burned.

Full spec: [BLUEPRINT.md](./BLUEPRINT.md)

## Repo layout

```
contracts/   Foundry project (Solidity)
  src/       VesperFactory, VesperNFT, VesperToken, VesperFeeHook, FloorVault, Airdrop, FeeSplitter
  test/      fork integration tests
web/         static front-end (vanilla Node server + SPA-less multi-page site)
```

## Contracts

| Contract | Role |
|---|---|
| `VesperFactory` | Creates NFT collections; on sold-out, deploys the token, seeds + locks LP, wires everything |
| `VesperNFT` | ERC-721 + EIP-2981. Mint (free/paid, 1/wallet), auto-finalize, locked after airdrop claim |
| `VesperToken` | Fixed-supply (1B) ERC-20, burnable |
| `VesperFeeHook` | Shared Uniswap V4 hook; 2.5%/2.5% ETH fee split creator/vault/dev |
| `FloorVault` | Holds 30% of fees; `redeem(tokenId)` pays the floor and burns the NFT |
| `Airdrop` | Per-NFT share, 1-month cliff, claim by holder |
| `FeeSplitter` | Splits royalty / redeem fees between creator and dev |

### Build & test

Built with [Foundry](https://book.getfoundry.sh/).

```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts Uniswap/v4-periphery
RH_RPC=<robinhood-chain-rpc> forge test
```

Remappings live in `foundry.toml`; `v4-periphery` vendors `v4-core`, `permit2` and `solmate`.

Tests run against a Robinhood Chain fork (Uniswap V4 is already deployed there).

## Web

```bash
cd web
node server.mjs   # serves the static site on :3096
```

Set `window.VESPER.FACTORY` in `web/public/config.js` to the deployed factory address to go live.

## Status

Live on Robinhood Chain. Contracts deployed and the site is running at [vesperpad.world](https://vesperpad.world).

## Deployed (Robinhood Chain)

| Contract | Address |
|---|---|
| VesperFactory | `0xB8E089d63aeAfb890F852B9ba74805B39ec40391` |
| VesperFeeHook | `0x79f4B9FBc9CAF9A885fD9D9fe7A543e70cb580cc` |
| LaunchDeployer | `0x41dE2EA622847b2875CCF9aB619Dde36A6b9C707` |
