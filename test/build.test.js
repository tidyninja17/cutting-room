// The self-hosted build must run offline: no network references.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("self-hosted build has no external references", () => {
  execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "build.mjs")], { stdio: "ignore" });
  const html = fs.readFileSync(path.join(__dirname, "..", "dist", "public", "index.html"), "utf8");
  assert.ok(!/(src|href)="https?:\/\//.test(html), "no CDN or font URLs");
  assert.ok(!/Diagnose with Claude|claude\.use\("sample"\)/.test(html), "no Claude diagnosis");
  for (const f of ["vendor/three.min.js", "vendor/jspdf.umd.min.js", "vendor/jszip.min.js", "vendor/fonts.css", "platform.js"]) assert.ok(fs.existsSync(path.join(__dirname, "..", "dist", "public", f)), f);
});
