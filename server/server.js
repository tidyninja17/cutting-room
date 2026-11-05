// Cutting Room self-hosted server.
// Serves the built app from ./public (or ../dist/public in development) and a
// small JSON document store backed by SQLite (node:sqlite, no dependencies).
//
// Environment:
//   PORT        listen port (default 8080)
//   DATA_DIR    where cutting-room.db, backups/ and import.json live (default /data)
//   BASIC_AUTH  optional "user:password"; when set, every route except /healthz needs it
//   BACKUP_KEEP number of daily database backups to keep (default 14)
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const SEG = /^(?!\.\.?$)[A-Za-z0-9_\-.~:@+]{1,200}$/;
const MAX_BODY = 1024 * 1024;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".png": "image/png" };

function validPath(p, kind) {
  if (typeof p !== "string" || !p || p.length > 1000) return false;
  const s = p.split("/");
  if (s.length > 16 || !s.every((x) => SEG.test(x))) return false;
  return kind === "doc" ? s.length % 2 === 0 : s.length % 2 === 1;
}
const parentOf = (p) => p.split("/").slice(0, -1).join("/");
function merge(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) ? merge(a[k], v) : v;
  return o;
}

function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "cutting-room.db");
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, parent TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);`);
  const q = {
    get: db.prepare("SELECT data FROM docs WHERE path = ?"),
    put: db.prepare("INSERT INTO docs(path, parent, data, updated) VALUES(?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, updated = excluded.updated"),
    del: db.prepare("DELETE FROM docs WHERE path = ?"),
    list: db.prepare("SELECT path, data FROM docs WHERE parent = ? ORDER BY path"),
    all: db.prepare("SELECT path, data, updated FROM docs ORDER BY path"),
    count: db.prepare("SELECT COUNT(*) AS n FROM docs"),
  };
  return {
    file, db,
    get: (p) => { const r = q.get.get(p); return r ? JSON.parse(r.data) : null; },
    put: (p, d) => q.put.run(p, parentOf(p), JSON.stringify(d), new Date().toISOString()),
    del: (p) => q.del.run(p),
    list: (p) => q.list.all(p).map((r) => ({ id: r.path.split("/").pop(), data: JSON.parse(r.data) })),
    all: () => q.all.all().map((r) => ({ path: r.path, data: JSON.parse(r.data), updated: r.updated })),
    count: () => q.count.get().n,
    close: () => db.close(),
  };
}

// One-off import of data exported from the claude.ai version: /data/import.json
// = { docs: [{ path, data }] }. Runs only into an empty store, then is renamed.
function importIfPresent(store, dataDir, log) {
  const f = path.join(dataDir, "import.json");
  if (!fs.existsSync(f)) return 0;
  if (store.count() > 0) { log(`import.json ignored: the store already has data`); return 0; }
  const { docs } = JSON.parse(fs.readFileSync(f, "utf8"));
  let n = 0;
  store.db.exec("BEGIN");
  try { for (const d of docs) { if (validPath(d.path, "doc") && d.data && typeof d.data === "object") { store.put(d.path, d.data); n++; } } store.db.exec("COMMIT"); }
  catch (e) { store.db.exec("ROLLBACK"); throw e; }
  fs.renameSync(f, f + ".done");
  log(`Imported ${n} documents from import.json`);
  return n;
}

function backup(store, dataDir, keep, log) {
  const dir = path.join(dataDir, "backups"); fs.mkdirSync(dir, { recursive: true });
  const name = `cutting-room-${new Date().toISOString().slice(0, 10)}.db`;
  const target = path.join(dir, name);
  if (!fs.existsSync(target)) { store.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`); log(`Backup written: backups/${name}`); }
  const files = fs.readdirSync(dir).filter((f) => /^cutting-room-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  files.slice(0, Math.max(0, files.length - keep)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
}

function createServer(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || "/data";
  const publicDir = opts.publicDir || [path.join(__dirname, "..", "public"), path.join(__dirname, "..", "dist", "public")].find((d) => fs.existsSync(path.join(d, "index.html")));
  const auth = opts.basicAuth ?? process.env.BASIC_AUTH ?? "";
  const log = opts.log || ((m) => console.log(new Date().toISOString(), m));
  const store = openStore(dataDir);
  importIfPresent(store, dataDir, log);
  const keep = Number(process.env.BACKUP_KEEP || 14);
  if (!opts.noBackups) { try { backup(store, dataDir, keep, log); } catch (e) { log("Backup failed: " + e.message); } }
  const backupTimer = opts.noBackups ? null : setInterval(() => { try { backup(store, dataDir, keep, log); } catch (e) { log("Backup failed: " + e.message); } }, 6 * 3600 * 1000);
  if (backupTimer) backupTimer.unref();
  const clients = new Set();
  const notify = (p) => { const msg = `data: ${JSON.stringify({ path: p })}\n\n`; clients.forEach((res) => res.write(msg)); };
  const expected = auth ? "Basic " + Buffer.from(auth).toString("base64") : "";

  const send = (res, code, body, headers = {}) => {
    const isJson = body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body);
    res.writeHead(code, { "Cache-Control": "no-store", ...(isJson ? { "Content-Type": "application/json" } : {}), ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("body must be a JSON object"); resolve(v); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
    req.on("error", reject);
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    if (url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (expected) {
      const got = req.headers.authorization || "";
      const ok = got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
      if (!ok) return send(res, 401, "Authentication required", { "WWW-Authenticate": 'Basic realm="Cutting Room"' });
    }
    try {
      if (url.pathname === "/api/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write(": connected\n\n"); clients.add(res);
        const hb = setInterval(() => res.write(": ping\n\n"), 25000);
        req.on("close", () => { clearInterval(hb); clients.delete(res); });
        return;
      }
      if (url.pathname === "/api/doc") {
        const p = url.searchParams.get("path");
        if (!validPath(p, "doc")) return send(res, 400, "Invalid document path");
        if (req.method === "GET") { const d = store.get(p); return send(res, 200, d ? { exists: true, data: d } : { exists: false }); }
        if (req.method === "PUT") { store.put(p, await readBody(req)); notify(p); return send(res, 204, ""); }
        if (req.method === "PATCH") { const cur = store.get(p); if (!cur) return send(res, 404, "Document does not exist"); store.put(p, merge(cur, await readBody(req))); notify(p); return send(res, 204, ""); }
        if (req.method === "DELETE") { store.del(p); notify(p); return send(res, 204, ""); }
        return send(res, 405, "Method not allowed");
      }
      if (url.pathname === "/api/collection" && req.method === "GET") {
        const p = url.searchParams.get("path");
        if (!validPath(p, "collection")) return send(res, 400, "Invalid collection path");
        return send(res, 200, { docs: store.list(p) });
      }
      if (url.pathname === "/api/export" && req.method === "GET") {
        return send(res, 200, { app: "cutting-room", exported: new Date().toISOString(), docs: store.all() }, { "Content-Disposition": `attachment; filename="cutting-room-export-${new Date().toISOString().slice(0, 10)}.json"` });
      }
      if (url.pathname === "/api/version") {
        let build = null; try { build = JSON.parse(fs.readFileSync(path.join(publicDir, "build.json"), "utf8")); } catch {}
        return send(res, 200, { build, node: process.version });
      }
      if (url.pathname.startsWith("/api/")) return send(res, 404, "Not found");
      // static files
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
      if (!publicDir) return send(res, 500, "App not built: run npm run build");
      let rel = decodeURIComponent(url.pathname); if (rel === "/") rel = "/index.html";
      const file = path.normalize(path.join(publicDir, rel));
      if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "Not found");
      const ext = path.extname(file);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".html" || rel === "/platform.js" ? "no-cache" : "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      send(res, e.status || 500, e.status ? e.message : "Server error");
      if (!e.status) log("Error: " + (e.stack || e));
    }
  });
  server.on("close", () => { clearInterval(backupTimer); clients.forEach((r) => r.end()); store.close(); });
  return { server, store, publicDir };
}

module.exports = { createServer, validPath, merge };

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  const { server, store, publicDir } = createServer();
  server.listen(port, () => console.log(`Cutting Room on :${port} · data ${store.file} · app ${publicDir}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
