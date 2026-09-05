# Vesper — NFT-Gated Launch (Final Blueprint)

Self-serve launchpad on Robinhood Chain. A creator launches an **NFT collection** that acts as a fair
presale + airdrop ticket. When it mints out, the **token auto-deploys** with a real two-sided Uniswap V4
market and locked liquidity. NFT holders get a locked token airdrop, and a share of the token's trade
fees flows into an **NFT floor vault** — so the more the token trades, the more each NFT is worth.

Status: DESIGN FINAL. Contracts for this model not built yet. Do NOT deploy to mainnet until instructed.

---

## 1. Fixed parameters

| Item | Value |
|---|---|
| Token supply | 1,000,000,000 (fixed) |
| Reference FDV | 1.8 ETH (opening FDV depends on ETH raised; surplus → vault) |
| Pair | ETH (Uniswap V4) |
| Trade fee | 2.5% buy / 2.5% sell, in ETH |
| Trade fee split | **Creator 50% · NFT vault 30% · Dev 20%** |
| NFT standard | ERC-721 + EIP-2981 |
| Rarity | none (all NFTs equal value; cosmetic art variety optional) |

## 2. NFT collection (per launch)

| Item | Value |
|---|---|
| Supply | default 1,000 (must sell out to trigger the token launch) |
| Max per wallet | 1 (anti-sybil, even distribution) |
| Mint | creator-set price, **free or paid, no min / no max** (default 0.005 ETH) |
| Mint proceeds split | **LP 50% · Creator 30% · Dev 20%** (paid only) |
| Free-mint LP | if price = 0, no ETH is raised → LP falls back to **single-sided** (token only) |

## 3. Token supply distribution

| Bucket | Share | Notes |
|---|---|---|
| Airdrop to NFT minters | **10%** (100,000,000) | attached to NFT tokenId, 1-month cliff |
| Liquidity (LP) | **90%** (900,000,000) | two-sided (ETH + token), LP burned |
| Dev premine | 0% | none — dev earns from fees + mint + royalty |

Per-NFT airdrop = 100,000,000 / NFT supply (1,000 → **100,000 tokens per NFT**).

## 4. Lifecycle

1. **Create** — creator sets name/symbol/logo, NFT supply, mint price. Deploys the NFT collection.
2. **Mint** — anyone mints at the fixed price. Max 1 / wallet. ETH accrues in the collection.
3. **Sold out → auto-deploy** (with a permissionless `finalize()` fallback):
   - split raised ETH: LP 50 / creator 30 / dev 20 (paid mints). Free mint → no ETH, LP single-sided.
   - deploy the ERC-20 (1B), open a Uniswap V4 ETH pool, seed (two-sided if paid, else single-sided),
     **burn the LP position**
   - wire the fee hook (2.5/2.5, split 50/30/20), the floor vault, and the airdrop (unlock = +30 days)
4. **Airdrop claim** — after 30 days, the current holder of each NFT claims its 100k token share
   (one claim per NFT).
5. **Trading** — token trades on Uniswap; 30% of every fee (ETH) flows into the NFT floor vault.
6. **Exit an NFT:**
   - **Redeem (instant, no buyer needed):** burn NFT → receive floor share **minus a 3% redeem fee**.
     Any **unclaimed airdrop is BURNED** (deflationary — no holder left). Enabled after the 1-month lock.
   - **Sell on marketplace:** transfer NFT for any price; **5% royalty** applies.

## 5. NFT floor vault (the flywheel)

- 30% of token trade fees (ETH) accumulate in the vault.
- Floor per NFT = vault ETH / current NFT supply.
- Redeem guarantees market price ≥ floor (arbitrage). More trading → higher floor → higher NFT price.
- Redeeming burns the NFT (and its unclaimed airdrop), shrinking supply → floor rises for the rest.

## 6. Fees on NFT activity (creator + dev)

| Action | Fee | Recipient |
|---|---|---|
| Redeem to floor | **3%** of floor payout | Creator/Dev **60/40** |
| Secondary sale (royalty) | **5%** | Creator/Dev **60/40** |

Example: sell an NFT for $10 at 5% → $0.50 fee (creator $0.30, dev $0.20), seller nets $9.50.
Redeem a $10 floor at 3% → $0.30 fee (creator $0.18, dev $0.12), redeemer nets $9.70.

## 7. Airdrop rules

- Claim right is **attached to the NFT tokenId**, not the minter wallet.
- Sell before claim → the buyer claims (un-claimed NFTs trade richer).
- One claim per NFT; after claim, tokens are in the wallet and do not follow further sales.
- To keep the airdrop: **claim it** (after the 1-month lock) before redeeming.
- Redeeming an NFT that still has an unclaimed airdrop **burns** those tokens (deflationary).
- **Transfer rule:** before claim the NFT is freely tradable (a buyer inherits the airdrop). Once
  claimed, the NFT is **locked/non-transferable to others** — it can only be redeemed to the floor or
  burned. This stops "empty" (already-claimed) NFTs being sold as if they still carried an airdrop.

## 8. Secondary market

- v1: **redeem-to-floor** (built in, always liquid) + external RH-Chain marketplaces (ERC-721 + royalty).
- v2: minimal on-site marketplace on Vesper (list / buy), royalty enforced.

## 9. Contracts (planned)

- `VesperNFT` (ERC-721 + 2981): paid mint, max-per-wallet, holds mint ETH, `finalize()`.
- `VesperLaunch` / factory: on finalize — split ETH, deploy token, seed+burn LP, wire hook+vault+airdrop.
- `VesperToken` (ERC-20, 1B).
- `VesperFeeHook` (shared V4 hook): 2.5/2.5 ETH fee, split Creator 50 / Vault 30 / Dev 20 per pool.
- `NFTFloorVault`: receives 30% fees; `redeem(tokenId)` → floor − 3% (fee to creator/dev), burns NFT +
  unclaimed airdrop.
- `AirdropClaim`: per-tokenId 100k share, 30-day cliff.

## 10. Economics summary

- Mint: LP 50 / Creator 30 / Dev 20
- Trade fee (2.5/2.5): Creator 50 / Vault 30 / Dev 20
- Supply: 10% airdrop (locked 1mo) / 90% LP (burned) / 0% dev premine
- Redeem: floor − 3% (creator/dev 60/40); unclaimed airdrop burned
- Royalty: 5% (creator/dev 60/40)
- Dev revenue: 20% trade fees + 20% mint + 40% of (royalty & redeem fees)

Public story: fair-launch — no bonding curve, no premine, LP burned, creator keeps the majority of fees.
