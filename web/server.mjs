import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUB = join(__dir, "public");
const DATA = join(__dir, "data");
const META = join(DATA, "meta");
const LOGO = join(DATA, "logo");
const PORT = 3096;
const ORIGIN = process.env.VESPER_ORIGIN || `http://localhost:${PORT}`;

const TYPES = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".gif": "image/gif"
};

function json(res, code, obj) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); }
function body(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let d = ""; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { reject(new Error("too big")); req.destroy(); } else d += c; });
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
  });
}
const slug = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const isImg = m => /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(m || "");
const clean = s => String(s || "").replace(/[<>]/g, "").slice(0, 400);

async function serveStatic(req, res) {
  let p = normalize(decodeURIComponent(req.url.split("?")[0]));
  if (p === "/") p = "/index.html";
  // data assets (metadata JSON + logos) live under /meta and /logo
  let file;
  if (p.startsWith("/meta/")) file = join(META, p.slice("/meta/".length));
  else if (p.startsWith("/logo/")) file = join(LOGO, p.slice("/logo/".length));
  else file = join(PUB, p);
  if (!file.startsWith(PUB) && !file.startsWith(META) && !file.startsWith(LOGO)) { res.writeHead(403); return res.end("no"); }
  // clean URLs: /explore -> explore.html
  if (!existsSync(file) && !extname(file) && existsSync(file + ".html")) file = file + ".html";
  if (!existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  const buf = await readFile(file);
  const ext = extname(file);
  const cache = (ext === ".html" || file.endsWith("index.html"))
    ? "no-cache, no-store, must-revalidate"
    : (ext === ".css" || ext === ".js") ? "no-cache" : "public,max-age=60";
  res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": cache });
  res.end(buf);
}

createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];

    // Upload metadata: takes {name,symbol,description,twitter,website,image(dataURI)}
    // stores logo + ERC-7572 JSON, returns the contractURI to pass to createToken().
    if (url === "/api/upload" && req.method === "POST") {
      const b = await body(req);
      const name = clean(b.name), symbol = clean(b.symbol);
      if (!name || !symbol) return json(res, 400, { error: "name and symbol required" });
      if (!isImg(b.image)) return json(res, 400, { error: "png/jpg/webp/gif logo required" });
      const id = slug();
      const ext = (b.image.match(/^data:image\/(\w+);/)[1] || "png").replace("jpeg", "jpg");
      const bin = Buffer.from(b.image.split(",")[1], "base64");
      if (bin.length > 5 * 1024 * 1024) return json(res, 400, { error: "logo too large (max 5MB)" });
      await mkdir(LOGO, { recursive: true }); await mkdir(META, { recursive: true });
      await writeFile(join(LOGO, `${id}.${ext}`), bin);
      const meta = {
        name, symbol,
        description: clean(b.description),
        image: `${ORIGIN}/logo/${id}.${ext}`,
        ...(b.twitter ? { twitter: clean(b.twitter) } : {}),
        ...(b.website ? { website: clean(b.website) } : {})
      };
      await writeFile(join(META, `${id}.json`), JSON.stringify(meta, null, 2));
      return json(res, 200, { contractURI: `${ORIGIN}/meta/${id}.json`, id });
    }

    if (url === "/api/health") return json(res, 200, { ok: true });

    return await serveStatic(req, res);
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`vesper-web on ${PORT} origin=${ORIGIN}`));
