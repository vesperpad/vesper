const C = window.VESPER;
const $ = s => document.querySelector(s);
const qs = k => new URLSearchParams(location.search).get(k);
let provider, signer, account, eip1193, wc;
const WC_PROJECT_ID = "6f586a16df07e60c9b57f3cbc290f516"; // WalletConnect project id (shared, origin-open)

// ---------- wallet: injected first, else WalletConnect (QR) ----------
async function connect() {
  try {
    if (window.ethereum) {
      eip1193 = window.ethereum;
      await eip1193.request({ method: "eth_requestAccounts" });
    } else {
      const { EthereumProvider } = await import("https://esm.sh/@walletconnect/ethereum-provider@2.17.0");
      wc = await EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: [C.chain.id],
        optionalChains: [C.chain.id, 1],
        rpcMap: { [C.chain.id]: C.chain.rpc },
        showQrModal: true,
        metadata: {
          name: "Vesper",
          description: "The launchpad for Robinhood Chain",
          url: "https://vesperpad.world",
          icons: ["https://vesperpad.world/vesper-icon.png"]
        }
      });
      await wc.connect(); // opens the QR / wallet picker
      eip1193 = wc;
    }
    provider = new ethers.BrowserProvider(eip1193);
    await ensureChain();
    signer = await provider.getSigner();
    account = await signer.getAddress();
    document.querySelectorAll("[data-connect]").forEach(b => b.textContent = short(account));
    return account;
  } catch (e) {
    console.error(e);
    return null;
  }
}
async function ensureChain() {
  try {
    const net = await provider.getNetwork();
    if (Number(net.chainId) === C.chain.id) return;
    await eip1193.request({ method: "wallet_switchEthereumChain", params: [{ chainId: C.chain.hex }] });
  } catch (e) {
    if (e && e.code === 4902) {
      await eip1193.request({ method: "wallet_addEthereumChain", params: [{
        chainId: C.chain.hex, chainName: C.chain.name,
        nativeCurrency: { name: C.chain.symbol, symbol: C.chain.symbol, decimals: 18 }, rpcUrls: [C.chain.rpc]
      }] });
    }
  }
  provider = new ethers.BrowserProvider(eip1193);
}
document.querySelectorAll("[data-connect]").forEach(b => b.onclick = connect);

// ---------- back button (every sub-page) ----------
(function () {
  const wrap = document.querySelector("main.sub .wrap");
  if (!wrap) return;
  const b = document.createElement("button");
  b.className = "backbtn"; b.type = "button"; b.innerHTML = "← Back";
  b.onclick = () => { if (history.length > 1 && document.referrer) history.back(); else location.href = "/"; };
  wrap.insertBefore(b, wrap.firstChild);
})();

// ---------- mobile menu ----------
(function () {
  const nav = document.querySelector(".nav"), links = document.querySelector(".nav-links");
  if (!nav || !links) return;
  const btn = document.createElement("button");
  btn.className = "menu-btn"; btn.setAttribute("aria-label", "Menu"); btn.innerHTML = "☰";
  nav.appendChild(btn);
  btn.onclick = () => nav.classList.toggle("open");
  links.querySelectorAll("a").forEach(a => a.addEventListener("click", () => nav.classList.remove("open")));
})();

// ---------- helpers ----------
// Quarrel/publicnode choke on JSON-RPC batch arrays (they hang), so force one request per call.
const NET = new ethers.Network(C.chain.name || "rh", C.chain.id);
const rpcOpts = { batchMaxCount: 1, staticNetwork: NET };
const mkLogsProv = () => new ethers.JsonRpcProvider(C.chain.logsRpc || C.chain.rpc, NET, rpcOpts);
const ro = new ethers.JsonRpcProvider(C.chain.rpc, NET, rpcOpts);
const logsRo = mkLogsProv(); // for eth_getLogs (events)
const factory = r => new ethers.Contract(C.FACTORY, C.factoryAbi, r);
const nftC = (a, r) => new ethers.Contract(a, C.nftAbi, r);
const esc = s => String(s || "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const short = a => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
const eth = v => { try { return (+ethers.formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 }); } catch { return "0"; } };
async function metaImg(uri) { if (!uri) return ""; try { return (await fetch(uri).then(r => r.json())).image || ""; } catch { return ""; } }
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]); }
// The logs RPC is occasionally slow/hangs; retry with a fresh provider so a wedged connection never blocks the UI.
async function queryLogs(address, abi, filterFn, span = 200000, tries = 2, ms = 12000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const prov = mkLogsProv();
    try {
      const c = new ethers.Contract(address, abi, prov);
      const cur = await withTimeout(prov.getBlockNumber(), 8000);
      return await withTimeout(c.queryFilter(filterFn(c), Math.max(0, cur - span), cur), ms);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("getLogs failed");
}
function copy(t) { navigator.clipboard?.writeText(t); }
function explLink(addr) { return C.chain.explorer ? `${C.chain.explorer}/address/${addr}` : ""; }
async function addToWallet(token, sym, img) {
  try {
    await window.ethereum.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: token, symbol: (sym || "TKN").slice(0, 11), decimals: 18, image: img || "" } } });
  } catch {}
}

// unified write: routes through the browser wallet, or the VPS wallet (server signs)
const IFACE = {
  factory: new ethers.Interface(C.factoryAbi),
  nft: new ethers.Interface(C.nftAbi),
  vault: new ethers.Interface(C.vaultAbi),
  airdrop: new ethers.Interface(C.airdropAbi)
};
async function sendTx(kind, to, method, args, value = 0n) {
  if (!signer) await connect();
  if (!signer) throw new Error("Wallet not connected");
  const data = IFACE[kind].encodeFunctionData(method, args);
  const tx = await signer.sendTransaction({ to, data, value });
  const rc = await tx.wait();
  return { hash: tx.hash, logs: rc.logs };
}

// ---------- pool price / buy / chart ----------
function poolKeyOf(token) {
  return { currency0: ethers.ZeroAddress, currency1: token, fee: 0, tickSpacing: C.TICK_SPACING, hooks: C.HOOK };
}
function poolIdOf(token) {
  const k = poolKeyOf(token);
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24", "int24", "address"], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
}
async function poolSqrt(token) {
  try {
    const pm = new ethers.Contract(C.POOL_MANAGER, C.poolManagerAbi, ro);
    const base = ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256"], [poolIdOf(token), C.POOLS_SLOT]));
    const v = BigInt(await pm.extsload(base));
    return v & ((1n << 160n) - 1n);
  } catch { return 0n; }
}
function priceFromSqrt(sqrt) {
  if (!sqrt) return { ethPerToken: 0, fdv: 0 };
  const s = Number(sqrt) / 2 ** 96;
  const tokenPerEth = s * s;
  const ethPerToken = tokenPerEth ? 1 / tokenPerEth : 0;
  return { ethPerToken, fdv: ethPerToken * 1e9 };
}
async function buyToken(token, ethInStr) {
  if (!signer) await connect();
  if (!signer) throw new Error("Wallet not connected");
  const ethIn = ethers.parseEther(ethInStr);
  const params = { zeroForOne: true, amountSpecified: -ethIn, sqrtPriceLimitX96: BigInt(C.MIN_SQRT_PRICE) + 1n };
  const router = new ethers.Contract(C.ROUTER, C.routerAbi, signer);
  const tx = await router.swap(poolKeyOf(token), params, { takeClaims: false, settleUsingBurn: false }, "0x", { value: ethIn * 103n / 100n });
  return await tx.wait();
}
async function sellToken(token, amtStr) {
  if (!signer) await connect();
  if (!signer) throw new Error("Wallet not connected");
  const amt = ethers.parseUnits(amtStr, 18);
  const owner = await signer.getAddress();
  const erc = new ethers.Contract(token, ["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], signer);
  if ((await erc.allowance(owner, C.ROUTER)) < amt) { const ap = await erc.approve(C.ROUTER, ethers.MaxUint256); await ap.wait(); }
  const params = { zeroForOne: false, amountSpecified: -amt, sqrtPriceLimitX96: BigInt(C.MAX_SQRT_PRICE) - 1n };
  const router = new ethers.Contract(C.ROUTER, C.routerAbi, signer);
  const tx = await router.swap(poolKeyOf(token), params, { takeClaims: false, settleUsingBurn: false }, "0x");
  return await tx.wait();
}
// ---------- NFT marketplace ----------
async function listNFT(nft, tokenId, priceEth) {
  if (!signer) await connect();
  const c = new ethers.Contract(nft, C.nftAbi, signer);
  if ((await c.getApproved(tokenId)).toLowerCase() !== C.MARKET.toLowerCase()) { const ap = await c.approve(C.MARKET, tokenId); await ap.wait(); }
  const mkt = new ethers.Contract(C.MARKET, C.marketAbi, signer);
  return await (await mkt.list(nft, tokenId, ethers.parseEther(priceEth))).wait();
}
async function buyNFT(nft, tokenId, priceWei) {
  if (!signer) await connect();
  const mkt = new ethers.Contract(C.MARKET, C.marketAbi, signer);
  return await (await mkt.buy(nft, tokenId, { value: priceWei })).wait();
}
async function activeListings(nft) {
  // NOTE: filtering by the indexed nft address topic makes the RPC hang; fetch all Listed() and filter client-side.
  const ev = await queryLogs(C.MARKET, C.marketAbi, c => c.filters.Listed());
  const want = nft.toLowerCase();
  const read = new ethers.Contract(C.MARKET, C.marketAbi, ro);
  const seen = new Set(), out = [];
  for (const e of ev.reverse()) {
    if (e.args.nft.toLowerCase() !== want) continue;
    const id = Number(e.args.tokenId); if (seen.has(id)) continue; seen.add(id);
    try { const l = await read.listings(nft, id); if (l.seller !== ethers.ZeroAddress) out.push({ id, seller: l.seller, price: l.price }); } catch {}
  }
  return out;
}

async function drawChart(token, canvas) {
  let ev = [];
  try { ev = await queryLogs(C.POOL_MANAGER, C.poolManagerAbi, c => c.filters.Swap(poolIdOf(token))); } catch {}
  let pts = ev.map(e => priceFromSqrt(BigInt(e.args.sqrtPriceX96)).ethPerToken).filter(x => x > 0);
  const cur = priceFromSqrt(await poolSqrt(token)).ethPerToken;
  if (cur > 0) pts.push(cur);
  const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (pts.length < 2) { ctx.fillStyle = "#8f7d84"; ctx.font = "13px Inter,sans-serif"; ctx.fillText("No trades yet", 12, H / 2); return; }
  const min = Math.min(...pts), max = Math.max(...pts), pad = 8;
  const x = i => pad + i * (W - 2 * pad) / (pts.length - 1);
  const y = v => H - pad - (max === min ? 0.5 : (v - min) / (max - min)) * (H - 2 * pad);
  ctx.strokeStyle = "#e6c069"; ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p)));
  ctx.stroke();
  ctx.lineTo(x(pts.length - 1), H - pad); ctx.lineTo(x(0), H - pad); ctx.closePath();
  ctx.fillStyle = "rgba(230,192,105,.08)"; ctx.fill();
}

// combined summary for one collection
async function summary(a) {
  const f = factory(ro), c = nftC(a, ro);
  const [nm, sy, max, minted, price, fin, uri] = await Promise.all([
    c.name(), c.symbol(), c.maxSupply(), c.totalMinted(), c.mintPrice(), c.finalized(), c.contractURI()
  ]);
  let cfg = { creator: ethers.ZeroAddress };
  try { cfg = await f.configs(a); } catch {}
  let token = "", vault = "", airdrop = "", floor = 0n;
  if (fin) {
    try {
      const idx = Number(await f.finalizedIndex(a));
      const L = await f.launches(idx - 1);
      token = L.token; vault = L.vault; airdrop = L.airdrop;
      floor = await new ethers.Contract(vault, C.vaultAbi, ro).floor().catch(() => 0n);
    } catch {}
  }
  return { a, nm, sy, max: Number(max), minted: Number(minted), price, fin, img: await metaImg(uri), creator: cfg.creator, token, vault, airdrop, floor };
}

// ================= CREATE (launch) =================
if ($("#launchForm")) {
  const upd = () => {
    $("#pvName").textContent = $("#f-name").value.trim() || "Your token";
    const s = $("#f-symbol").value.trim();
    $("#pvSym").textContent = s ? "$" + s.toUpperCase() : "$SYMBOL";
    const price = $("#f-price").value.trim();
    $("#pvMint").textContent = (!price || Number(price) === 0) ? "Free" : price + " ETH";
    $("#pvSupply").textContent = ($("#f-nftsupply").value.trim() || "1000") + " NFTs";
  };
  ["f-name", "f-symbol", "f-price", "f-nftsupply"].forEach(id => $("#" + id) && $("#" + id).addEventListener("input", upd));
  $("#f-logo").onchange = e => { const f = e.target.files[0]; $("#logoName").textContent = f ? f.name : "PNG / JPG / WEBP, max 5MB"; if (f) $("#pvImg").src = URL.createObjectURL(f); };
  upd();
  const msg = (t, c) => { const m = $("#formMsg"); m.textContent = t; m.className = "msg " + (c || ""); };
  $("#launchForm").onsubmit = async e => {
    e.preventDefault();
    const btn = $("#launchBtn");
    const name = $("#f-name").value.trim(), symbol = $("#f-symbol").value.trim(), logo = $("#f-logo").files[0];
    const nftName = ($("#f-nftname") ? $("#f-nftname").value.trim() : "") || name + " NFT";
    const nftSymbol = ($("#f-nftsymbol") ? $("#f-nftsymbol").value.trim() : "") || symbol;
    const supply = parseInt($("#f-nftsupply").value.trim() || "1000", 10);
    const priceStr = $("#f-price").value.trim() || "0";
    if (!name || !symbol || !logo) { msg("Fill token name, symbol and logo.", "err"); return; }
    if (!C.FACTORY) { msg("Launching soon. The contract goes live shortly.", ""); return; }
    try {
      btn.disabled = true;
      if (!account) await connect();
      if (!account) { msg("Connect a wallet first.", "err"); btn.disabled = false; return; }
      msg("Uploading metadata…", "");
      const image = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(logo); });
      const up = await fetch("/api/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, symbol, image, description: $("#f-desc").value.trim(), twitter: $("#f-twitter").value.trim(), website: $("#f-website").value.trim() }) }).then(r => r.json());
      if (up.error) throw new Error(up.error);
      msg("Signing the launch…", "");
      const r = await sendTx("factory", C.FACTORY, "createLaunch", [name, symbol, up.contractURI, nftName, nftSymbol, supply, ethers.parseEther(priceStr)]);
      let nftAddr = "";
      for (const lg of r.logs) { try { const p = IFACE.factory.parseLog(lg); if (p && p.name === "LaunchCreated") { nftAddr = p.args[0]; break; } } catch {} }
      msg("Live! Redirecting to your mint page…", "ok");
      location.href = nftAddr ? ("/collection?a=" + nftAddr) : "/explore";
    } catch (err) { msg(err.shortMessage || err.message || "Failed.", "err"); btn.disabled = false; }
  };
}

// ================= EXPLORE =================
if ($("#grid") && !$("#collection") && !$("#portfolio")) {
  let ALL = [], filter = "nfts", sort = "new";
  const grid = $("#grid");

  async function load() {
    if (!C.FACTORY) { grid.innerHTML = `<p class="empty">No launches yet. Be the first when Vesper goes live.</p>`; renderStats([]); const ab = $("#activity"); if (ab) ab.innerHTML = `<li class="cmut">No activity yet.</li>`; return; }
    grid.innerHTML = `<p class="empty">Loading…</p>`;
    try {
      const f = factory(ro);
      const n = Number(await f.allNftsLength());
      const idx = []; for (let i = n - 1; i >= 0 && i > n - 61; i--) idx.push(i);
      const addrs = await Promise.all(idx.map(i => f.allNfts(i)));
      ALL = (await Promise.all(addrs.map(a => summary(a).catch(() => null)))).filter(Boolean);
      renderStats(ALL); render(); loadActivity();
    } catch { grid.innerHTML = `<p class="empty">Could not load launches.</p>`; }
  }
  function render() {
    const q = ($("#search")?.value || "").toLowerCase().trim();
    let list = ALL.filter(c => !q || (c.nm + " " + c.sy).toLowerCase().includes(q));
    if (filter === "nfts") list = list.filter(c => !c.fin);
    if (filter === "tokens") list = list.filter(c => c.fin);
    if (sort === "active") list.sort((a, b) => { const x = a.floor * BigInt(a.max), y = b.floor * BigInt(b.max); return y > x ? 1 : (y < x ? -1 : 0); });
    if (sort === "progress") list.sort((a, b) => (b.minted / b.max) - (a.minted / a.max));
    grid.innerHTML = list.map(card).join("") || `<p class="empty">Nothing here yet.</p>`;
  }
  function card(c) {
    if (!c.fin) {
      // NFT (minting) card: progress + mint price
      const pct = Math.round(c.minted / c.max * 100);
      const price = c.price == 0n ? "Free" : eth(c.price) + " ETH";
      return `<a class="tok" href="/collection?a=${c.a}">
        <img src="${c.img || "/logo-placeholder.svg"}" onerror="this.src='/logo-placeholder.svg'"/>
        <div><div class="nm">${esc(c.nm)}</div><div class="sy">NFT · mint ${price}</div></div>
        <div class="cbar"><div style="width:${pct}%"></div></div>
        <div class="tok-foot"><span class="cmut">${c.minted}/${c.max} minted</span><span class="pill mint">Minting</span></div></a>`;
    }
    // Token (live) card: floor + tradable
    return `<a class="tok" href="/collection?a=${c.a}">
      <img src="${c.img || "/logo-placeholder.svg"}" onerror="this.src='/logo-placeholder.svg'"/>
      <div><div class="nm">${esc(c.nm)}</div><div class="sy">$${esc(c.sy)} · token</div></div>
      <div class="tok-foot"><span class="cmut">floor ${eth(c.floor)} ETH</span><span class="pill live">Live</span></div></a>`;
  }
  function renderStats(list) {
    const el = $("#exStats"); if (!el) return;
    const live = list.filter(c => c.fin).length;
    let tvl = 0n; list.forEach(c => { if (c.floor) tvl += c.floor * BigInt(c.max); });
    el.innerHTML = `
      <div><b>${list.length}</b><span>Collections</span></div>
      <div><b>${live}</b><span>Live tokens</span></div>
      <div><b>${eth(tvl)}</b><span>ETH in floors</span></div>`;
  }
  async function loadActivity() {
    const box = $("#activity"); if (!box || !C.FACTORY) return;
    try {
      const f = factory(logsRo);
      const cur = await logsRo.getBlockNumber();
      const from = Math.max(0, cur - 200000);
      const created = await f.queryFilter(f.filters.LaunchCreated(), from, cur).catch(() => []);
      const fin = await f.queryFilter(f.filters.LaunchFinalized(), from, cur).catch(() => []);
      const items = [
        ...created.map(e => ({ t: "created", nft: e.args.nft, block: e.blockNumber })),
        ...fin.map(e => ({ t: "launched", nft: e.args.nft, block: e.blockNumber }))
      ].sort((a, b) => b.block - a.block).slice(0, 8);
      box.innerHTML = items.length ? items.map(i =>
        `<li><span class="dot ${i.t}"></span>${i.t === "created" ? "New collection" : "Token launched"} · <a href="/collection?a=${i.nft}">${short(i.nft)}</a></li>`
      ).join("") : `<li class="cmut">No activity yet.</li>`;
    } catch {}
  }
  function setSortOptions() {
    const s = $("#sort"); if (!s) return;
    const opts = filter === "tokens"
      ? [["new", "Newest"], ["active", "Most active"]]
      : [["new", "Newest"], ["progress", "Almost sold out"]];
    s.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    sort = "new";
  }
  setSortOptions();
  ["nfts", "tokens"].forEach(k => { const b = $("#tab-" + k); if (b) b.onclick = () => {
    filter = k;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("on")); b.classList.add("on");
    if ($("#search")) $("#search").placeholder = k === "nfts" ? "Search collections" : "Search tokens";
    setSortOptions();
    render();
  }; });
  if ($("#sort")) $("#sort").onchange = e => { sort = e.target.value; render(); };
  if ($("#search")) $("#search").addEventListener("input", render);
  if ($("#refresh")) $("#refresh").onclick = load;
  load();
}

// ================= COLLECTION =================
if ($("#collection")) {
  const a = qs("a"), box = $("#collection");
  if (!C.FACTORY) box.innerHTML = `<p class="empty">Vesper is launching soon.</p>`;
  else if (!a || !ethers.isAddress(a)) box.innerHTML = `<p class="empty">Collection not found.</p>`;
  else renderCol(a);

  async function ownedIds(a2) {
    if (!account) return [];
    try {
      const c = nftC(a2, ro);
      const bal = Number(await c.balanceOf(account));
      const ids = [];
      for (let i = 0; i < bal; i++) ids.push(Number(await c.tokenOfOwnerByIndex(account, i)));
      return ids;
    } catch { return []; }
  }
  async function renderCol(a2) {
    try {
      const s = await summary(a2);
      const pct = Math.min(100, Math.round(s.minted / s.max * 100));
      const priceTxt = s.price == 0n ? "Free" : ethers.formatEther(s.price) + " ETH";
      const addrRow = (label, val) => val && val !== ethers.ZeroAddress
        ? `<li><span>${label}</span><b class="mono" data-copy="${val}" title="copy">${short(val)}</b></li>` : "";
      let action;
      if (!s.fin) {
        action = `
          <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
          <div class="prow"><span>${s.minted}/${s.max} minted</span><b>${priceTxt}</b></div>
          <ul class="pv-facts">${addrRow("Creator", s.creator)}<li><span>Airdrop</span><b>10% · 1-mo lock</b></li></ul>
          <button id="mintBtn" class="btn primary full">Mint (${priceTxt})</button>
          <p id="mMsg" class="msg"></p>`;
      } else {
        action = `
          <div class="tokhead"><span class="pill live">Live</span><span class="pxline" id="pxLine">loading price…</span></div>
          <canvas id="chart" class="chart" width="620" height="150"></canvas>
          <div class="buybox">
            <label>Buy with ETH<input id="buyAmt" class="input" type="number" min="0" step="0.001" placeholder="0.01" /></label>
            <button id="buyBtn" class="btn primary full">Buy $${esc(s.sy)}</button>
            <label>Sell $${esc(s.sy)} (amount)<input id="sellAmt" class="input" type="number" min="0" placeholder="1000000" /></label>
            <button id="sellBtn" class="btn ghost full">Sell $${esc(s.sy)}</button>
            <p id="buyMsg" class="msg"></p>
          </div>
          <ul class="pv-facts">
            ${addrRow("Token", s.token)}${addrRow("Creator", s.creator)}
            <li><span>NFT floor</span><b>${eth(s.floor)} ETH</b></li>
          </ul>
          <button id="addBtn" class="btn ghost full">Add token to wallet</button>
          <div class="mini">Your NFT<div id="ownedWrap"><button id="loadOwned" class="btn ghost sm">Show my NFTs</button></div></div>
          <div class="row2">
            <button id="claimBtn" class="btn ghost full" disabled>Claim airdrop</button>
            <button id="redeemBtn" class="btn ghost full" disabled>Sell NFT → floor</button>
          </div>
          <div class="row2">
            <input id="listPrice" class="input" type="number" min="0" step="0.001" placeholder="list price ETH" />
            <button id="listBtn" class="btn ghost full" disabled>Sell NFT to a buyer</button>
          </div>
          <p id="mMsg" class="msg"></p>
          <p class="form-sec" style="margin-top:14px">For sale</p>
          <div id="market"><p class="cmut">Loading listings…</p></div>`;
      }
      box.innerHTML = `
        <div class="col-head">
          <img src="${s.img || "/logo-placeholder.svg"}" onerror="this.src='/logo-placeholder.svg'"/>
          <div><h1>${esc(s.nm)}</h1><p class="muted">$${esc(s.sy)} · <a href="/how">how it works</a></p></div>
        </div>
        <div class="card">${action}</div>`;
      box.querySelectorAll("[data-copy]").forEach(el => el.onclick = () => { copy(el.dataset.copy); el.textContent = "copied"; setTimeout(() => el.textContent = short(el.dataset.copy), 900); });

      if (!s.fin) {
        $("#mintBtn").onclick = async () => {
          const m = $("#mMsg");
          try { if (!account) await connect(); m.textContent = "Minting…"; m.className = "msg";
            await sendTx("nft", a2, "mint", [], s.price);
            m.textContent = "Minted!"; m.className = "msg ok"; setTimeout(() => renderCol(a2), 1200);
          } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
        };
      } else {
        $("#addBtn").onclick = () => addToWallet(s.token, s.sy, s.img);
        // price + chart
        const refreshPx = async () => {
          const { ethPerToken, fdv } = priceFromSqrt(await poolSqrt(s.token));
          const px = $("#pxLine");
          const fdvTxt = fdv >= 1 ? fdv.toLocaleString(undefined, { maximumFractionDigits: 2 }) : fdv.toPrecision(3);
          if (px) px.textContent = ethPerToken ? `${ethPerToken.toExponential(3)} ETH · FDV ${fdvTxt} ETH` : "no price yet";
          const cv = $("#chart"); if (cv) drawChart(s.token, cv);
        };
        refreshPx();
        $("#buyBtn").onclick = async () => {
          const m = $("#buyMsg"); const amt = $("#buyAmt").value.trim();
          if (!amt || Number(amt) <= 0) { m.textContent = "Enter an ETH amount."; m.className = "msg err"; return; }
          try {
            m.textContent = "Buying…"; m.className = "msg";
            await buyToken(s.token, amt);
            m.textContent = "Bought! The tokens are in your wallet."; m.className = "msg ok";
            setTimeout(refreshPx, 1500);
          } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
        };
        $("#sellBtn").onclick = async () => {
          const m = $("#buyMsg"); const amt = $("#sellAmt").value.trim();
          if (!amt || Number(amt) <= 0) { m.textContent = "Enter an amount to sell."; m.className = "msg err"; return; }
          try {
            m.textContent = "Approving + selling…"; m.className = "msg";
            await sellToken(s.token, amt);
            m.textContent = "Sold! ETH is in your wallet."; m.className = "msg ok";
            setTimeout(refreshPx, 1500);
          } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
        };
        let picked = null;
        const setPicked = id => { picked = id; $("#claimBtn").disabled = false; $("#redeemBtn").disabled = false; $("#listBtn").disabled = false; };
        $("#loadOwned").onclick = async () => {
          if (!signer) await connect();
          const ids = await ownedIds(a2);
          const wrap = $("#ownedWrap");
          if (!ids.length) { wrap.innerHTML = `<span class="cmut">You hold no NFTs from this collection.</span>`; return; }
          wrap.innerHTML = `<select id="idSel" class="input">${ids.map(i => `<option value="${i}">#${i}</option>`).join("")}</select>`;
          setPicked(ids[0]);
          $("#idSel").onchange = e => setPicked(Number(e.target.value));
        };
        const run = async which => {
          const m = $("#mMsg"); if (picked == null) { m.textContent = "Pick your NFT first."; m.className = "msg err"; return; }
          try { if (!account) await connect(); m.textContent = "Processing…"; m.className = "msg";
            if (which === "claim") await sendTx("airdrop", s.airdrop, "claim", [picked]);
            else await sendTx("vault", s.vault, "redeem", [picked]);
            m.textContent = which === "claim" ? "Airdrop claimed!" : "Redeemed!"; m.className = "msg ok";
          } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
        };
        $("#claimBtn").onclick = () => run("claim");
        $("#redeemBtn").onclick = () => run("redeem");
        // list your NFT for sale
        $("#listBtn").onclick = async () => {
          const m = $("#mMsg"); const p = $("#listPrice").value.trim();
          if (picked == null) { m.textContent = "Pick your NFT first (Show my NFTs)."; m.className = "msg err"; return; }
          if (!p || Number(p) <= 0) { m.textContent = "Enter a list price."; m.className = "msg err"; return; }
          try { if (!signer) await connect(); m.textContent = "Approving + listing…"; m.className = "msg";
            await listNFT(a2, picked, p);
            m.textContent = "Listed for sale!"; m.className = "msg ok"; loadMarket();
          } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
        };
        // listings for sale (buy from other holders)
        async function loadMarket() {
          const box = $("#market"); if (!box) return;
          let rows = [];
          try { rows = await activeListings(a2); } catch { box.innerHTML = `<p class="cmut">Could not load listings. Refresh to retry.</p>`; return; }
          if (!rows.length) { box.innerHTML = `<p class="cmut">No NFTs listed yet.</p>`; return; }
          box.innerHTML = rows.map(r =>
            `<div class="listing"><span>NFT #${r.id} · <b>${eth(r.price)} ETH</b></span><button class="btn primary sm" data-buy="${r.id}" data-px="${r.price}">Buy</button></div>`
          ).join("");
          box.querySelectorAll("[data-buy]").forEach(b => b.onclick = async () => {
            const m = $("#mMsg");
            try { if (!signer) await connect(); m.textContent = "Buying NFT…"; m.className = "msg";
              await buyNFT(a2, Number(b.dataset.buy), BigInt(b.dataset.px));
              m.textContent = "NFT bought!"; m.className = "msg ok"; loadMarket();
            } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
          });
        }
        loadMarket();
      }
    } catch { box.innerHTML = `<p class="empty">Could not load this collection.</p>`; }
  }
}

// ================= PORTFOLIO =================
if ($("#portfolio")) {
  const box = $("#portfolio");
  $("#pfConnect") && ($("#pfConnect").onclick = async () => { await connect(); load(); });
  async function load() {
    if (!C.FACTORY) { box.innerHTML = `<p class="empty">Vesper is launching soon.</p>`; return; }
    if (!account) { await connect(); }
    if (!account) { box.innerHTML = `<p class="empty">Connect your wallet to see your launches and NFTs.</p>`; return; }
    box.innerHTML = `<p class="empty">Loading…</p>`;
    try {
      const f = factory(ro);
      const n = Number(await f.allNftsLength());
      const idx = []; for (let i = n - 1; i >= 0; i--) idx.push(i);
      const addrs = await Promise.all(idx.map(i => f.allNfts(i)));
      const sums = (await Promise.all(addrs.map(a => summary(a).catch(() => null)))).filter(Boolean);
      const mine = sums.filter(s => s.creator && s.creator.toLowerCase() === account.toLowerCase());
      const held = [];
      for (const s of sums) {
        try {
          const c = nftC(s.a, ro); const bal = Number(await c.balanceOf(account));
          for (let i = 0; i < bal; i++) held.push({ s, id: Number(await c.tokenOfOwnerByIndex(account, i)) });
        } catch {}
      }
      const cardMini = s => `<a class="tok" href="/collection?a=${s.a}"><img src="${s.img || "/logo-placeholder.svg"}" onerror="this.src='/logo-placeholder.svg'"/><div><div class="nm">${esc(s.nm)}</div><div class="sy">$${esc(s.sy)}</div></div><div class="tok-foot">${s.fin ? `<span class="pill live">Live</span>` : `<span class="pill mint">${s.minted}/${s.max}</span>`}</div></a>`;
      const heldRow = h => `<a class="tok" href="/collection?a=${h.s.a}"><img src="${h.s.img || "/logo-placeholder.svg"}" onerror="this.src='/logo-placeholder.svg'"/><div><div class="nm">${esc(h.s.nm)} #${h.id}</div><div class="sy">${h.s.fin ? "floor " + eth(h.s.floor) + " ETH" : "minting"}</div></div><div class="tok-foot">${h.s.fin ? `<span class="pill live">manage →</span>` : `<span class="pill mint">${h.s.minted}/${h.s.max}</span>`}</div></a>`;
      box.innerHTML = `
        <div class="pf-sec"><h2>My NFTs</h2><div class="grid">${held.length ? held.map(heldRow).join("") : `<p class="empty">You don't hold any Vesper NFTs yet.</p>`}</div></div>
        <div class="pf-sec"><h2>My launches</h2><div class="grid">${mine.length ? mine.map(cardMini).join("") : `<p class="empty">You haven't created a launch yet. <a href="/launch">Create one →</a></p>`}</div></div>`;
    } catch { box.innerHTML = `<p class="empty">Could not load your portfolio.</p>`; }
  }
  load();
}

// ================= MARKET (global listings) =================
if ($("#marketGrid")) {
  const grid = $("#marketGrid");
  async function load() {
    if (!C.FACTORY || !C.MARKET) { grid.innerHTML = `<p class="empty">Marketplace launching soon.</p>`; return; }
    grid.innerHTML = `<p class="empty">Loading…</p>`;
    try {
      const read = new ethers.Contract(C.MARKET, C.marketAbi, ro);
      let ev = [];
      try { ev = await queryLogs(C.MARKET, C.marketAbi, c => c.filters.Listed()); }
      catch { grid.innerHTML = `<p class="empty">Could not reach the network. <button class="btn ghost sm" id="retry">Retry</button></p>`; const rb = $("#retry"); if (rb) rb.onclick = load; return; }
      const seen = new Set(), items = [];
      for (const e of ev.reverse()) {
        const nft = e.args.nft, id = Number(e.args.tokenId), k = nft + "-" + id;
        if (seen.has(k)) continue; seen.add(k);
        try { const l = await read.listings(nft, id); if (l.seller !== ethers.ZeroAddress) items.push({ nft, id, price: l.price }); } catch {}
      }
      if (!items.length) { grid.innerHTML = `<p class="empty">No NFTs listed for sale yet.</p>`; return; }
      const metaCache = {};
      const cards = await Promise.all(items.map(async it => {
        if (!metaCache[it.nft]) { const c = nftC(it.nft, ro); metaCache[it.nft] = { nm: await c.name().catch(() => "NFT"), img: await metaImg(await c.contractURI().catch(() => "")) }; }
        const m = metaCache[it.nft];
        return `<div class="tok">
          <img src="${m.img || "/logo-placeholder.svg"}" onerror="this.src='/logo-placeholder.svg'"/>
          <div><div class="nm">${esc(m.nm)} #${it.id}</div><div class="sy">${eth(it.price)} ETH</div></div>
          <div class="row2"><a class="btn ghost sm" href="/collection?a=${it.nft}">View</a><button class="btn primary sm" data-nft="${it.nft}" data-id="${it.id}" data-px="${it.price}">Buy</button></div>
        </div>`;
      }));
      grid.innerHTML = cards.join("");
      grid.querySelectorAll("[data-nft]").forEach(b => b.onclick = async () => {
        try { if (!signer) await connect(); b.textContent = "…";
          await buyNFT(b.dataset.nft, Number(b.dataset.id), BigInt(b.dataset.px));
          b.textContent = "Bought"; load();
        } catch (e) { b.textContent = "Buy"; alert(e.shortMessage || e.message); }
      });
    } catch { grid.innerHTML = `<p class="empty">Could not load listings.</p>`; }
  }
  if ($("#refresh")) $("#refresh").onclick = load;
  load();
}

// tap-to-copy for any static [data-copy] (e.g. the contract addresses on Home)
document.querySelectorAll("[data-copy]").forEach(el => {
  if (el.closest("#collection")) return; // collection page wires its own copy
  el.addEventListener("click", () => { copy(el.dataset.copy); const t = el.textContent; el.textContent = "copied"; setTimeout(() => (el.textContent = t), 900); });
});

// boot
if (window.ethereum && window.ethereum.selectedAddress) connect().catch(() => {});
