# Vesper

The launchpad for Robinhood Chain — where a token launch starts as an NFT mint.

**Website:** [vesperpad.world](https://vesperpad.world) · **X:** [@vesperpad](https://x.com/vesperpad)

A creator deploys an NFT collection. When it mints out, the token launches by itself: a real
Uniswap V4 market opens and the liquidity is locked forever. Minters receive a locked airdrop, and a
share of the token's trade fees backs a growing NFT floor — so an active token lifts every NFT.

## How it works

1. **Create** — deploy an NFT collection for your token (set supply and a free or paid mint, 1 per wallet).
2. **Mint** — people mint. On a paid mint the ETH is split **floor 50% / creator 30% / dev 20%**; the floor share seeds the NFT floor vault.
3. **Auto-launch** — on sold-out the token deploys, a Uniswap V4 ETH market opens single-sided at a fixed opening valuation (FDV ~1.8 ETH), and the LP position is burned.
4. **Airdrop** — 10% of supply goes to minters, locked one month; the claim is attached to the NFT.
5. **Floor** — every trade pays 2.5% each way, split **creator 50 / vault 30 / dev 20**. The vault's 30% backs the NFTs (floor = vault balance ÷ supply). The creator's 50% is held in the fee hook and paid only when the creator calls `claim()`; it is never auto-sent.
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
| `VesperFeeHook` | Shared Uniswap V4 hook; 2.5%/2.5% ETH fee split creator/vault/dev. Creator share accrues for manual `claim()` |
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
| VesperFactory | `0x6f1914E5936077d47E5682d3D4662fD168d452Ae` |
| VesperFeeHook | `0x3872A66a82B7c6e98a795AdDB7A92D9898a140cC` |
| LaunchDeployer | `0x41dE2EA622847b2875CCF9aB619Dde36A6b9C707` |
| Swap router (PoolSwapTest) | `0x569e99E9E8C09C4940a0407aD4E3d8ef90B6d51F` |
| NFT marketplace | `0x79dae07308e70c6Ce649D1dd9bD650249A1A0AA0` |

## Security & verification

This repository ships source only. Before trusting a live address, verify its on-chain bytecode
against these sources. Every launch is created by the one factory above and uses the one shared fee
hook — there is no per-token custom code, so what you read here is what runs.

What the code guarantees, and you can check on-chain:

- **Liquidity is burned.** On launch the LP position is minted straight to `0x…dEaD`. There is no
  withdrawal path — not for the creator, not for us.
- **No premine.** Total supply is fixed at 1,000,000,000: 10% to minters (locked one month), 90% into
  the burned pool. No allocation is minted to any team wallet.
- **No admin over launches.** The factory has no owner switch and no upgrade path; launch parameters
  are constants in the source. The hook owner's only action is a one-time `setFactory`, after which it
  cannot be changed.
- **Non-custodial.** Every action is a transaction from your own wallet. Vesper never holds your keys
  or your assets.

Tokens can be volatile and can lose all their value. Nothing here is financial advice. If you find a
security issue, please report it privately rather than opening a public issue.
