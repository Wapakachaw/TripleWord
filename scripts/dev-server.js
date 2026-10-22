// Local test server: serves /public and routes /api/game to the same handler Vercel runs.
// Usage: npm run dev   (then open http://localhost:3000 in three browser windows)
const http = require("http");
const fs = require("fs");
const path = require("path");
const handler = require("../api/game.js");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "..", "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/game") {
    req.query = Object.fromEntries(url.searchParams);
    return handler(req, res);
  }
  let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, "index.html");
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Word game running at http://localhost:${PORT}`));
