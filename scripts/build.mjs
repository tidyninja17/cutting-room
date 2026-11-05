// Build the app from src/ into:
//   dist/public/       self-hosted, fully offline (served by server/server.js)
//   dist/artifact.html single-file page for a claude.ai artifact (CDN libraries)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = (f) => fs.readFileSync(path.join(root, "src", f), "utf8");
const nm = (f) => path.join(root, "node_modules", f);
const out = path.join(root, "dist");
const pub = path.join(out, "public");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(pub, "vendor", "fonts"), { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
let sha = process.env.BUILD_SHA || "";
if (!sha) { try { sha = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { sha = "dev"; } }
const build = { version: pkg.version, sha: sha.slice(0, 7), date: new Date().toISOString().slice(0, 10) };

let app = src("app.html")
  .replace("/*ENGINE*/", () => src("engine.js"))
  .replace("/*EXPORTS*/", () => src("exports.js"))
  .replace("/*VIEWER*/", () => src("viewer3d.js"))
  .replace("/*GUIDE*/", () => src("fitting-guide.js"));
const buildTag = `<script>window.__BUILD__=${JSON.stringify(build)};</script>`;

// ---- artifact build: unchanged external libraries, runtime supplied by claude.ai ----
fs.writeFileSync(path.join(out, "artifact.html"), buildTag + "\n" + app);

// ---- self-hosted build: vendored libraries and fonts, local platform shim ----
const LIBS = {
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js": ["jspdf/dist/jspdf.umd.min.js", "jspdf.umd.min.js"],
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js": ["jszip/dist/jszip.min.js", "jszip.min.js"],
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js": ["three/build/three.min.js", "three.min.js"],
};
let local = app;
for (const [url, [from, to]] of Object.entries(LIBS)) {
  if (!local.includes(url)) throw new Error("Library reference not found in app.html: " + url);
  fs.copyFileSync(nm(from), path.join(pub, "vendor", to));
  local = local.replace(url, "vendor/" + to);
}
const FONTS = [["gloock", [400]], ["ibm-plex-sans-condensed", [400, 500, 600]], ["ibm-plex-mono", [400, 500]]];
let css = "";
for (const [pkgName, weights] of FONTS) {
  for (const w of weights) {
    let c = fs.readFileSync(nm(`@fontsource/${pkgName}/latin-${w}.css`), "utf8");
    c = c.replace(/url\(\.\/files\/([^)]+)\)/g, (_, f) => { fs.copyFileSync(nm(`@fontsource/${pkgName}/files/${f}`), path.join(pub, "vendor", "fonts", f)); return `url(fonts/${f})`; });
    css += c + "\n";
  }
}
fs.writeFileSync(path.join(pub, "vendor", "fonts.css"), css);
local = local
  .replace(/<link rel="preconnect"[^>]*>\n?/g, "")
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">/, '<link rel="stylesheet" href="vendor/fonts.css">');
fs.copyFileSync(path.join(root, "src", "platform-local.js"), path.join(pub, "platform.js"));
fs.copyFileSync(path.join(root, "src", "icon.svg"), path.join(pub, "icon.svg"));
const head = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
${buildTag}
<script src="platform.js"></script>
</head>
<body>
`;
fs.writeFileSync(path.join(pub, "build.json"), JSON.stringify(build));
fs.writeFileSync(path.join(pub, "index.html"), head + local + "\n</body>\n</html>\n");
const leftover = local.match(/(src|href)="https?:\/\/[^"]+"/g);
if (leftover) throw new Error("Self-hosted build still references the network: " + leftover.join(", "));
console.log(`Built ${build.version} (${build.sha}) → dist/public and dist/artifact.html`);
