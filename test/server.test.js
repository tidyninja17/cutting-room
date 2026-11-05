// Server: document store, collections, merge, export, import, auth, static files.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer, validPath } = require("../server/server.js");

function start(extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-"));
  if (extra.importDocs) fs.writeFileSync(path.join(dataDir, "import.json"), JSON.stringify({ docs: extra.importDocs }));
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "crp-"));
  fs.writeFileSync(path.join(publicDir, "index.html"), "<p>app</p>");
  const { server } = createServer({ dataDir, publicDir, basicAuth: extra.auth || "", noBackups: true, log: () => {} });
  return new Promise((r) => server.listen(0, () => r({ server, dataDir, url: `http://127.0.0.1:${server.address().port}` })));
}
const j = (r) => r.json();

test("path validation", () => {
  assert.ok(validPath("projects/p1", "doc"));
  assert.ok(validPath("projects/p1/versions", "collection"));
  assert.ok(!validPath("projects", "doc"));
  assert.ok(!validPath("projects/../x", "doc"));
  assert.ok(!validPath("a b/c", "doc"));
});

test("documents: set, get, merge, list, delete", async () => {
  const { server, url } = await start();
  try {
    const doc = (p) => `${url}/api/doc?path=${encodeURIComponent(p)}`;
    assert.deepEqual(await j(await fetch(doc("projects/p1"))), { exists: false });
    assert.equal((await fetch(doc("projects/p1"), { method: "PUT", body: JSON.stringify({ name: "A", input: { a: 1, b: { c: 2 } } }) })).status, 204);
    assert.equal((await fetch(doc("projects/p1"), { method: "PATCH", body: JSON.stringify({ input: { b: { d: 3 } } }) })).status, 204);
    const got = await j(await fetch(doc("projects/p1")));
    assert.deepEqual(got.data, { name: "A", input: { a: 1, b: { c: 2, d: 3 } } });
    assert.equal((await fetch(doc("projects/nope"), { method: "PATCH", body: "{}" })).status, 404);
    await fetch(doc("projects/p1/versions/v001"), { method: "PUT", body: JSON.stringify({ n: 1 }) });
    await fetch(doc("projects/p1/versions/v002"), { method: "PUT", body: JSON.stringify({ n: 2 }) });
    const col = await j(await fetch(`${url}/api/collection?path=projects/p1/versions`));
    assert.deepEqual(col.docs.map((d) => d.id), ["v001", "v002"]);
    await fetch(doc("projects/p1/versions/v001"), { method: "DELETE" });
    assert.equal((await j(await fetch(`${url}/api/collection?path=projects/p1/versions`))).docs.length, 1);
    assert.equal((await fetch(doc("projects/p1"), { method: "PUT", body: "[1,2]" })).status, 400);
    const exp = await j(await fetch(`${url}/api/export`));
    assert.equal(exp.docs.length, 2);
  } finally { server.close(); }
});

test("changes are announced on the event stream", async () => {
  const { server, url } = await start();
  try {
    const ctl = new AbortController();
    const res = await fetch(`${url}/api/events`, { signal: ctl.signal });
    const reader = res.body.getReader();
    await reader.read(); // ": connected"
    await fetch(`${url}/api/doc?path=projects/p9`, { method: "PUT", body: "{}" });
    const { value } = await reader.read();
    assert.match(Buffer.from(value).toString(), /"path":"projects\/p9"/);
    ctl.abort();
  } finally { server.close(); }
});

test("import.json loads into an empty store once", async () => {
  const { server, url, dataDir } = await start({ importDocs: [{ path: "projects/x", data: { name: "Imported" } }, { path: "bad", data: {} }] });
  try {
    assert.equal((await j(await fetch(`${url}/api/doc?path=projects/x`))).data.name, "Imported");
    assert.ok(fs.existsSync(path.join(dataDir, "import.json.done")));
  } finally { server.close(); }
});

test("basic auth protects everything except the health check", async () => {
  const { server, url } = await start({ auth: "cutter:secret" });
  try {
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
    assert.equal((await fetch(`${url}/`)).status, 401);
    const h = { Authorization: "Basic " + Buffer.from("cutter:secret").toString("base64") };
    assert.equal((await fetch(`${url}/`, { headers: h })).status, 200);
  } finally { server.close(); }
});

test("static files cannot escape the app folder", async () => {
  const { server, url } = await start();
  try {
    assert.equal((await fetch(`${url}/`)).status, 200);
    assert.equal((await fetch(`${url}/..%2F..%2Fetc%2Fpasswd`)).status, 404);
  } finally { server.close(); }
});
