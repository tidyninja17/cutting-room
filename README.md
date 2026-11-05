# Cutting Room

Bespoke trouser drafting for personal use. Enter a client's measures, figuration, style and cloth. The app drafts front and back on a West End proportional system, runs the cutter's checks, and adds inlays. It then prints 1:1 patterns as tiled A4, A0 or plotter-roll PDF, SVG or DXF.

Each project is a folder of versions. Recording a fitting keeps that version as cut and creates the next one with the corrections added. The offline fitting guide turns what you see at a fitting into those corrections.

Everything runs offline: one small Node server, a SQLite file, no external requests.

## Install on Unraid

**1. Let Unraid pull the image (once).** After the first GitHub Actions run, open github.com → your profile → Packages → `cutting-room` → Package settings, and set visibility to **Public**. The image contains the app's code but none of your data, which lives only on the server. The repo itself can stay private.

To keep the package private instead, run `docker login ghcr.io -u tidyninja17` on the Unraid terminal with a personal access token that has `read:packages`. Unraid keeps `/root` in RAM, so the login is lost on reboot unless you re-run it from `/boot/config/go`.

**2. Add the container.** Copy `unraid/cutting-room.xml` to `/boot/config/plugins/dockerMan/templates-user/my-cutting-room.xml` on the flash drive, for example over the `flash` SMB share. Then go to **Docker → Add Container → Template → cutting-room → Apply**.

| Setting | Default |
|---|---|
| Web UI port | `8080` |
| Data | `/mnt/user/appdata/cutting-room` |
| Basic auth | empty (set `user:password` if anything beyond your LAN or Tailscale can reach it) |

**3. Turn on automatic updates.** Install **Auto Update Applications** from the Apps tab. In its settings, on the Docker auto update tab, enable it for `cutting-room` and set the check to daily. To update straight away instead, go to **Docker → cutting-room → Check for Updates → Apply Update**.

**4. Open it** at `http://tower:8080` (or your server's IP). From outside the house, use the Tailscale plugin rather than forwarding a port.

The sidebar shows the running version, for example `v1.1.0 · engine 1.0.0`. Use it to confirm that an update has landed.

## How updates flow

```
change on main ──► GitHub Actions: npm test ─► build image ─► ghcr.io/tidyninja17/cutting-room:latest
                                                                   │
                                     Unraid Auto Update (daily) ◄──┘  pulls and restarts the container
```

A failing test stops the publish, so a broken build never reaches Unraid. Every image is also tagged with its commit (`sha-abc1234`). To roll back, set the container's Repository to `ghcr.io/tidyninja17/cutting-room:sha-abc1234`.

## Data and backups

`/mnt/user/appdata/cutting-room` holds:

- `cutting-room.db`: all projects, versions and house calibration (SQLite)
- `backups/`: one copy per day, the last 14 kept (`BACKUP_KEEP`)
- `import.json`: optional, see below

**Download backup** in the sidebar saves everything as JSON. To restore, stop the container, replace `cutting-room.db` with a file from `backups/`, and start it again. Appdata Backup also covers the folder.

**Importing data.** Put an `import.json` of the form `{ "docs": [{ "path": "projects/…", "data": {…} }] }` in the data folder before first start. A **Download backup** file has this shape. It loads only into an empty store and is then renamed `import.json.done`.

## Development

```sh
npm ci
npm test          # engine, fitting guide, 3D model, server, offline build
npm run dev       # builds, then serves http://localhost:8080 with data in ./data
```

Node 22.13 or later; the server uses the built-in `node:sqlite` and has no runtime dependencies.

| Path | What it is |
|---|---|
| `src/engine.js` | Drafting engine: validation, draft, figuration, inlays, checks, pieces |
| `src/exports.js` | SVG, DXF and tiled PDF output |
| `src/viewer3d.js` | 3D preview lofted from the draft |
| `src/fitting-guide.js` | Offline fitting guide: symptom → cause → corrections |
| `src/app.html` | The app (UI, projects, versions, fitting, export) |
| `src/platform-local.js` | Browser runtime for self-hosting: storage over the server API, downloads |
| `server/server.js` | HTTP server, SQLite document store, live updates, backups, import |
| `scripts/build.mjs` | Builds `dist/public` (offline) and `dist/artifact.html` (claude.ai) |
