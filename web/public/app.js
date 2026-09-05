const C = window.VESPER;
const $ = s => document.querySelector(s);
const qs = k => new URLSearchParams(location.search).get(k);
let provider, signer, account;

// ---------- wallet ----------
async function connect() {
  if (!window.ethereum) { alert("Install a wallet (MetaMask) first."); return null; }
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  await ensureChain();
  signer = await provider.getSigner();
  account = await signer.getAddress();
  document.querySelectorAll("[data-connect]").forEach(b => b.textContent = short(account));
  return account;
}
async function ensureChain() {
  const net = await provider.getNetwork();
  if (Number(net.chainId) === C.chain.id) return;
  try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: C.chain.hex }] }); }
  catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
        chainId: C.chain.hex, chainName: C.chain.name,
        nativeCurrency: { name: C.chain.symbol, symbol: C.chain.symbol, decimals: 18 }, rpcUrls: [C.chain.rpc]
      }] });
    } else throw e;
  }
  provider = new ethers.BrowserProvider(window.ethereum);
}
document.querySelectorAll("[data-connect]").forEach(b => b.onclick = connect);

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
const ro = new ethers.JsonRpcProvider(C.chain.rpc);
const factory = r => new ethers.Contract(C.FACTORY, C.factoryAbi, r);
const nftC = (a, r) => new ethers.Contract(a, C.nftAbi, r);
const esc = s => String(s || "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const short = a => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
const eth = v => { try { return (+ethers.formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 }); } catch { return "0"; } };
async function metaImg(uri) { if (!uri) return ""; try { return (await fetch(uri).then(r => r.json())).image || ""; } catch { return ""; } }
function copy(t) { navigator.clipboard?.writeText(t); }
function explLink(addr) { return C.chain.explorer ? `${C.chain.explorer}/address/${addr}` : ""; }
async function addToWallet(token, sym, img) {
  try {
    await window.ethereum.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: token, symbol: (sym || "TKN").slice(0, 11), decimals: 18, image: img || "" } } });
  } catch {}
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
    const nftName = $("#f-nftname").value.trim() || name + " NFT";
    const nftSymbol = $("#f-nftsymbol").value.trim() || symbol + "N";
    const supply = parseInt($("#f-nftsupply").value.trim() || "1000", 10);
    const priceStr = $("#f-price").value.trim() || "0";
    if (!name || !symbol || !logo) { msg("Fill token name, symbol and logo.", "err"); return; }
    if (!C.FACTORY) { msg("Launching soon — the contract goes live shortly.", ""); return; }
    try {
      btn.disabled = true;
      if (!signer) await connect();
      msg("Uploading metadata…", "");
      const image = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(logo); });
      const up = await fetch("/api/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, symbol, image, description: $("#f-desc").value.trim(), twitter: $("#f-twitter").value.trim(), website: $("#f-website").value.trim() }) }).then(r => r.json());
      if (up.error) throw new Error(up.error);
      msg("Confirm in your wallet…", "");
      const f = factory(signer);
      const tx = await f.createLaunch(name, symbol, up.contractURI, nftName, nftSymbol, supply, ethers.parseEther(priceStr));
      const rc = await tx.wait();
      let nftAddr = "";
      for (const lg of rc.logs) { try { const p = f.interface.parseLog(lg); if (p && p.name === "LaunchCreated") { nftAddr = p.args[0]; break; } } catch {} }
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
    if (!C.FACTORY) { grid.innerHTML = `<p class="empty">No launches yet — be the first when Vesper goes live.</p>`; renderStats([]); const ab = $("#activity"); if (ab) ab.innerHTML = `<li class="cmut">No activity yet.</li>`; return; }
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
    if (sort === "floor") list.sort((a, b) => (b.floor > a.floor ? 1 : -1));
    if (sort === "progress") list.sort((a, b) => (b.minted / b.max) - (a.minted / a.max));
    grid.innerHTML = list.map(card).join("") || `<p class="empty">Nothing here yet.</p>`;
  }
  function card(c) {
    const status = c.fin
      ? `<span class="pill live">Live</span>`
      : `<span class="pill mint">${c.minted}/${c.max}</span>`;
    const sub = c.fin ? `floor ${eth(c.floor)} ETH` : `${Math.round(c.minted / c.max * 100)}% minted`;
    return `<a class="tok" href="/collection?a=${c.a}">
      <img src="${c.img || "/logo-placeholder.svg"}" onerror="this.src='/logo-placeholder.svg'"/>
      <div><div class="nm">${esc(c.nm)}</div><div class="sy">$${esc(c.sy)}</div></div>
      <div class="tok-foot"><span class="cmut">${sub}</span>${status}</div></a>`;
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
      const f = factory(ro);
      const created = await f.queryFilter(f.filters.LaunchCreated(), -50000).catch(() => []);
      const fin = await f.queryFilter(f.filters.LaunchFinalized(), -50000).catch(() => []);
      const items = [
        ...created.map(e => ({ t: "created", nft: e.args.nft, block: e.blockNumber })),
        ...fin.map(e => ({ t: "launched", nft: e.args.nft, block: e.blockNumber }))
      ].sort((a, b) => b.block - a.block).slice(0, 8);
      box.innerHTML = items.length ? items.map(i =>
        `<li><span class="dot ${i.t}"></span>${i.t === "created" ? "New collection" : "Token launched"} · <a href="/collection?a=${i.nft}">${short(i.nft)}</a></li>`
      ).join("") : `<li class="cmut">No activity yet.</li>`;
    } catch {}
  }
  ["nfts", "tokens"].forEach(k => { const b = $("#tab-" + k); if (b) b.onclick = () => { filter = k; document.querySelectorAll(".tab").forEach(t => t.classList.remove("on")); b.classList.add("on"); render(); }; });
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
          <span class="pill live">Live</span>
          <ul class="pv-facts">
            ${addrRow("Token", s.token)}${addrRow("Creator", s.creator)}
            <li><span>NFT floor</span><b>${eth(s.floor)} ETH</b></li>
          </ul>
          <div class="row2">
            <button id="addBtn" class="btn ghost full">Add token to wallet</button>
            ${C.chain.explorer ? `<a class="btn ghost full" href="${explLink(s.token)}" target="_blank" rel="noopener">Trade / explorer</a>` : ""}
          </div>
          <div class="mini">Your NFT<div id="ownedWrap"><button id="loadOwned" class="btn ghost sm">Show my NFTs</button></div></div>
          <div class="row2">
            <button id="claimBtn" class="btn primary full" disabled>Claim airdrop</button>
            <button id="redeemBtn" class="btn ghost full" disabled>Redeem to floor</button>
          </div>
          <p id="mMsg" class="msg"></p>`;
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
          try { if (!signer) await connect(); m.textContent = "Confirm in your wallet…"; m.className = "msg";
            const tx = await nftC(a2, signer).mint({ value: s.price }); m.textContent = "Minting…"; await tx.wait();
            m.textContent = "Minted!"; m.className = "msg ok"; setTimeout(() => renderCol(a2), 1200);
          } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
        };
      } else {
        $("#addBtn").onclick = () => addToWallet(s.token, s.sy, s.img);
        let picked = null;
        const setPicked = id => { picked = id; $("#claimBtn").disabled = false; $("#redeemBtn").disabled = false; };
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
          try { if (!signer) await connect(); m.textContent = "Confirm in your wallet…"; m.className = "msg";
            const ct = which === "claim" ? new ethers.Contract(s.airdrop, C.airdropAbi, signer) : new ethers.Contract(s.vault, C.vaultAbi, signer);
            const tx = which === "claim" ? await ct.claim(picked) : await ct.redeem(picked); m.textContent = "Processing…"; await tx.wait();
            m.textContent = which === "claim" ? "Airdrop claimed!" : "Redeemed!"; m.className = "msg ok";
          } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
        };
        $("#claimBtn").onclick = () => run("claim");
        $("#redeemBtn").onclick = () => run("redeem");
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

// boot
if (window.ethereum && window.ethereum.selectedAddress) connect().catch(() => {});
