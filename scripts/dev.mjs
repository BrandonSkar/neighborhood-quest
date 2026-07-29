// Run the whole quest on your PC with the REAL data behind it.
//
//   node scripts/dev.mjs            -> http://localhost:5173
//   node scripts/dev.mjs 3000       -> pick another port
//
// Files come off your disk (edit, save, refresh), while anything under /api/ is
// forwarded to the live site — so setup.html shows the cards you actually published
// and stats.html shows real scans, which is what opening the .html files directly
// could never do. Publishing and wiping from here hit the live database for real.
//
// No npm install, no Vercel CLI, no environment variables: the database credentials
// stay on the server where they belong.
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 5173;
const LIVE = process.env.NQ_LIVE || "https://neighborhood-quest.vercel.app";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");

  // ---- /api/* -> the live site, headers and body passed straight through ----
  if (u.pathname.startsWith("/api/")) {
    try {
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
      const r = await fetch(LIVE + u.pathname + u.search, {
        method: req.method,
        headers: { "Content-Type": req.headers["content-type"] || "application/json" },
        body,
      });
      const text = await r.text();
      console.log(`  ${req.method} ${u.pathname} -> ${r.status} (live)`);
      res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/json" });
      res.end(text);
    } catch (e) {
      console.log(`  ${req.method} ${u.pathname} -> live site unreachable`);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Can't reach " + LIVE + " — are you online?" }));
    }
    return;
  }

  // ---- everything else off the local disk ----
  const rel = u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname).replace(/^\/+/, "");
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("nope"); return; }   // no ../ escapes
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found: " + rel); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store" });
    res.end(buf);
  });
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`\n🗺️  Neighborhood Quest — local\n`);
  console.log(`   game       http://localhost:${PORT}/`);
  console.log(`   setup      http://localhost:${PORT}/setup.html`);
  console.log(`   dashboard  http://localhost:${PORT}/stats.html`);
  console.log(`\n   /api/* is proxied to ${LIVE} — this is your LIVE data.`);
  console.log(`   Ctrl+C to stop.\n`);
});
