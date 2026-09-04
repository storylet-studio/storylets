// The dev server: copy once, then serve dist/ as static files. The two bundles
// are read from their PUBLISHED paths in examples/ and the three scripts from
// src/, on every request, so a Publish or an edit shows on the next refresh.
// Nothing watches, nothing builds.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildHamlet, published, sources } from "./build.mjs";

const dist = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "dist");
const port = Number(process.env.PORT) || 5181;
const live = { "/hamlet.storyletsc": published.storylets, "/hamlet.patterc": published.patter, ...Object.fromEntries(sources.map(([n, p]) => ["/" + n, p])) };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".storyletsc": "application/json", ".patterc": "application/json" };

await buildHamlet();
createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const path = live[url] ?? join(dist, url === "/" ? "index.html" : url);
  try {
    const body = readFileSync(path);
    res.setHeader("Content-Type", types[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch {
    res.statusCode = 404; res.end("no " + url);
  }
}).listen(port, () => console.log(`http://localhost:${port}  (bundles from examples/ and scripts from src/, read on every request: Publish or edit, then refresh)`));
