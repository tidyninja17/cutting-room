# Working on Cutting Room

Personal tool: bespoke (Savile Row style) trouser drafting, self-hosted on the owner's Unraid server. Pushing to `main` publishes a new Docker image that Unraid installs automatically. Treat every push to `main` as a release.

## Before you push

1. `npm ci && npm test`. All tests must pass. Add a test for any behaviour you change or add.
2. `npm run build` must succeed. It fails if the offline build references the network.
3. For UI changes, run `npm run dev` and check the page in a browser if one is available. At minimum, check that the inline scripts in `dist/public/index.html` parse.
4. Bump `version` in `package.json`: patch for fixes, minor for features. The sidebar shows it, which is how the owner confirms an update arrived.
5. Write a commit message that says what changed for the user.

## Rules that protect data and past work

- **Never break stored data.** Documents live at `projects/{pid}`, `projects/{pid}/versions/{vid}` and `settings/house`. Add fields freely. Never rename or remove one without a migration that runs at load and keeps old documents working.
- **Fitted versions are records.** A version with `locked: true` was cut and fitted. Its `input` and `house` snapshot must keep drafting the same pattern. If you change drafting geometry, bump `ENGINE_VERSION` in `src/engine.js` and say so in the commit. If old versions should keep the old geometry, gate the change on the version's stored `engine`.
- **Version numbers only go up** (`maxN` on the project). Fitting records point at them.
- **Offline.** No CDN, font or API calls at run time. Vendor anything new through `scripts/build.mjs` from `node_modules`.
- **Deterministic drafting.** Same input gives the same draft. No randomness or clock in the engine.
- Units are millimetres throughout. Every CALIBRATE value belongs in `DEFAULTS` and in the House calibration list in `src/app.html`.
- Never commit client data, `data/`, `*.db` or `import.json`.

## Architecture

- `src/app.html` is the whole UI. It reaches storage only through `window.claude.use("db")` and `use("downloads")`.
  - Self-hosted, `src/platform-local.js` provides these over the server API, with live updates by server-sent events.
  - In a claude.ai artifact (`dist/artifact.html`), the claude.ai runtime provides them.
  - Keep the app working on both.
- `server/server.js`: plain `node:http` plus `node:sqlite`. Endpoints:
  - `/api/doc?path=` (GET, PUT, PATCH merge, DELETE)
  - `/api/collection?path=`
  - `/api/events` (SSE)
  - `/api/export`, `/api/version`, `/healthz`
- The engine, exports, viewer and guide are UMD-style files. They run in the browser and in Node tests through `require`.

## Release path

`.github/workflows/release.yml` tests, then builds `ghcr.io/tidyninja17/cutting-room:latest` plus a `sha-*` tag (linux/amd64). Unraid's Auto Update Applications pulls `latest` daily. To roll back, point the container at a `sha-*` tag.
