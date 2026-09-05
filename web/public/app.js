const C = window.VESPER;
const $ = s => document.querySelector(s);
const qs = k => new URLSearchParams(location.search).get(k);
let provider, signer, account;

// ---------- wallet ----------
async function connect() {
  if (!window.ethereum) { alert("Install a wallet (MetaMask) first."); return; }
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  await ensureChain();
  signer = await provider.getSigner();
  account = await signer.getAddress();
  document.querySelectorAll("[data-connect]").forEach(b => b.textContent = account.slice(0, 6) + "…" + account.slice(-4));
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

const ro = new ethers.JsonRpcProvider(C.chain.rpc);
const factory = r => new ethers.Contract(C.FACTORY, C.factoryAbi, r);
const nftC = (a, r) => new ethers.Contract(a, C.nftAbi, r);
const esc = s => String(s || "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const short = a => a.slice(0, 6) + "…" + a.slice(-4);
async function metaImg(uri) { if (!uri) return ""; try { return (await fetch(uri).then(r => r.json())).image || ""; } catch { return ""; } }

// ================= CREATE (launch page) =================
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
  $("#f-logo").onchange = e => {
    const f = e.target.files[0];
    $("#logoName").textContent = f ? f.name : "PNG / JPG / WEBP, max 5MB";
    if (f) $("#pvImg").src = URL.createObjectURL(f);
  };
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
      const up = await fetch("/api/upload", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, symbol, image, description: $("#f-desc").value.trim(), twitter: $("#f-twitter").value.trim(), website: $("#f-website").value.trim() }) }).then(r => r.json());
      if (up.error) throw new Error(up.error);
      msg("Confirm in your wallet…", "");
      const f = factory(signer);
      const tx = await f.createLaunch(name, symbol, up.contractURI, nftName, nftSymbol, supply, ethers.parseEther(priceStr));
      const rc = await tx.wait();
      // find the deployed NFT from the LaunchCreated event
      let nftAddr = "";
      for (const lg of rc.logs) { try { const p = f.interface.parseLog(lg); if (p && p.name === "LaunchCreated") { nftAddr = p.args[0]; break; } } catch {} }
      msg("Live! Redirecting to your mint page…", "ok");
      location.href = nftAddr ? ("/collection?a=" + nftAddr) : "/explore";
    } catch (err) { msg(err.shortMessage || err.message || "Failed.", "err"); btn.disabled = false; }
  };
}

// ================= EXPLORE =================
async function loadExplore() {
  const grid = $("#grid"); if (!grid) return;
  if (!C.FACTORY) { grid.innerHTML = `<p class="empty">No launches yet — be the first when Vesper goes live.</p>`; return; }
  grid.innerHTML = `<p class="empty">Loading…</p>`;
  try {
    const f = factory(ro);
    const n = Number(await f.allNftsLength());
    if (!n) { grid.innerHTML = `<p class="empty">No launches yet — be the first.</p>`; return; }
    const idx = []; for (let i = n - 1; i >= 0 && i > n - 61; i--) idx.push(i);
    const cards = await Promise.all(idx.map(async i => {
      try {
        const a = await f.allNfts(i);
        const c = nftC(a, ro);
        const [nm, sy, max, minted, fin, uri] = await Promise.all([c.name(), c.symbol(), c.maxSupply(), c.totalMinted(), c.finalized(), c.contractURI()]);
        return { a, nm, sy, max: Number(max), minted: Number(minted), fin, img: await metaImg(uri) };
      } catch { return null; }
    }));
    const q = ($("#search")?.value || "").toLowerCase().trim();
    const list = cards.filter(Boolean).filter(c => !q || (c.nm + " " + c.sy).toLowerCase().includes(q));
    grid.innerHTML = list.map(c => {
      const status = c.fin ? `<span class="pill live">Live</span>` : `<span class="pill mint">${c.minted}/${c.max} minted</span>`;
      return `<a class="tok" href="/collection?a=${c.a}">
        <img src="${c.img || "/logo-placeholder.svg"}" onerror="this.src='/logo-placeholder.svg'"/>
        <div><div class="nm">${esc(c.nm)}</div><div class="sy">$${esc(c.sy)}</div></div>
        ${status}</a>`;
    }).join("") || `<p class="empty">No launches yet.</p>`;
  } catch { grid.innerHTML = `<p class="empty">Could not load launches.</p>`; }
}
if ($("#grid")) { loadExplore(); if ($("#search")) $("#search").addEventListener("input", loadExplore); if ($("#refresh")) $("#refresh").onclick = loadExplore; }

// ================= COLLECTION / MINT =================
if ($("#collection")) {
  const a = qs("a");
  const box = $("#collection");
  if (!C.FACTORY) { box.innerHTML = `<p class="empty">Vesper is launching soon.</p>`; }
  else if (!a || !ethers.isAddress(a)) { box.innerHTML = `<p class="empty">Collection not found.</p>`; }
  else renderCollection(a);

  async function renderCollection(addr) {
    try {
      const f = factory(ro), c = nftC(addr, ro);
      const [nm, sy, max, minted, price, fin, uri] = await Promise.all([c.name(), c.symbol(), c.maxSupply(), c.totalMinted(), c.mintPrice(), c.finalized(), c.contractURI()]);
      const img = await metaImg(uri);
      const pct = Math.min(100, Math.round(Number(minted) / Number(max) * 100));
      const priceTxt = price == 0n ? "Free" : ethers.formatEther(price) + " ETH";
      let action;
      if (!fin) {
        action = `
          <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
          <div class="prow"><span>${minted}/${max} minted</span><b>${priceTxt}</b></div>
          <button id="mintBtn" class="btn primary full">Mint (${priceTxt})</button>
          <p id="mMsg" class="msg"></p>`;
      } else {
        const idx = Number(await f.finalizedIndex(addr));
        const L = await f.launches(idx - 1);
        const vault = new ethers.Contract(L.vault, C.vaultAbi, ro);
        const floor = await vault.floor().catch(() => 0n);
        action = `
          <span class="pill live">Live</span>
          <ul class="pv-facts">
            <li><span>Token</span><b>${short(L.token)}</b></li>
            <li><span>NFT floor</span><b>${ethers.formatEther(floor)} ETH</b></li>
          </ul>
          <label class="mini">Your NFT id<input id="tid" class="input" placeholder="e.g. 12"/></label>
          <div class="row2">
            <button id="claimBtn" class="btn ghost full">Claim airdrop</button>
            <button id="redeemBtn" class="btn ghost full">Redeem to floor</button>
          </div>
          <p id="mMsg" class="msg"></p>`;
      }
      box.innerHTML = `
        <div class="col-head">
          <img src="${img || "/logo-placeholder.svg"}" onerror="this.src='/logo-placeholder.svg'"/>
          <div><h1>${esc(nm)}</h1><p class="muted">$${esc(sy)} · <a href="/how">how it works</a></p></div>
        </div>
        <div class="card">${action}</div>`;

      if (!fin) {
        $("#mintBtn").onclick = async () => {
          const m = $("#mMsg");
          try {
            if (!signer) await connect();
            m.textContent = "Confirm in your wallet…"; m.className = "msg";
            const tx = await nftC(addr, signer).mint({ value: price });
            m.textContent = "Minting…";
            await tx.wait();
            m.textContent = "Minted!"; m.className = "msg ok";
            setTimeout(() => renderCollection(addr), 1200);
          } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
        };
      } else {
        const idx = Number(await f.finalizedIndex(addr));
        const L = await f.launches(idx - 1);
        const run = async (which) => {
          const m = $("#mMsg"); const id = $("#tid").value.trim();
          if (!id) { m.textContent = "Enter your NFT id."; m.className = "msg err"; return; }
          try {
            if (!signer) await connect();
            m.textContent = "Confirm in your wallet…"; m.className = "msg";
            const ct = which === "claim"
              ? new ethers.Contract(L.airdrop, C.airdropAbi, signer)
              : new ethers.Contract(L.vault, C.vaultAbi, signer);
            const tx = which === "claim" ? await ct.claim(id) : await ct.redeem(id);
            m.textContent = "Processing…"; await tx.wait();
            m.textContent = which === "claim" ? "Airdrop claimed!" : "Redeemed!"; m.className = "msg ok";
          } catch (e) { m.textContent = e.shortMessage || e.message; m.className = "msg err"; }
        };
        $("#claimBtn").onclick = () => run("claim");
        $("#redeemBtn").onclick = () => run("redeem");
      }
    } catch { box.innerHTML = `<p class="empty">Could not load this collection.</p>`; }
  }
}

// boot
if (window.ethereum && window.ethereum.selectedAddress) connect().catch(() => {});
