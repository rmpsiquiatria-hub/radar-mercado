// Local test server: serves the static site and runs api/*.js the way Vercel does.
// Run with: npm run dev   → http://localhost:3000

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    const api = url.pathname.match(/^\/api\/([a-z-]+)$/);
    if (api) {
      const mod = await import(pathToFileURL(join(ROOT, "api", api[1] + ".js")).href + "?t=" + Date.now());
      const r = await mod.GET(new Request(url));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[\\/])+/, "");
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" || e.code === "ERR_MODULE_NOT_FOUND" ? 404 : 500, { "Content-Type": "text/plain" });
    res.end(String(e.message));
  }
}).listen(PORT, () => console.log(`Radar do Mercado em http://localhost:${PORT}`));
