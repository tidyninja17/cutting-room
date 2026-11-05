/* Local platform: provides the small runtime the app expects (window.claude.use)
   when served by the self-hosted server instead of claude.ai.
   - db: JSON documents over the server's REST API, live via server-sent events
   - downloads: ordinary browser downloads
   Anything else resolves null, and the app hides that feature. */
(function () {
  "use strict";
  const api = (p) => "api/" + p;
  const err = (code, message) => ({ code, message });
  const parent = (p) => p.split("/").slice(0, -1).join("/");
  async function call(method, url, body) {
    let res;
    try { res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" }); }
    catch (e) { throw err("unavailable", "Server unreachable"); }
    if (res.status === 404 && method === "PATCH") throw err("invalid_argument", "Document does not exist");
    if (res.status === 413) throw err("invalid_argument", "Document too large");
    if (!res.ok) throw err(res.status >= 500 ? "unavailable" : "invalid_argument", (await res.text()) || res.statusText);
    return res.status === 204 ? null : res.json();
  }
  const freeze = (o) => JSON.parse(JSON.stringify(o));
  const docSnap = (path, r) => ({ id: path.split("/").pop(), exists: !!r.exists, data: () => (r.exists ? freeze(r.data) : undefined), metadata: { fromCache: false, hasPendingWrites: false } });
  const colSnap = (r) => { const docs = r.docs.map((d) => ({ id: d.id, exists: true, data: () => freeze(d.data), metadata: { fromCache: false, hasPendingWrites: false } })); return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] }; };
  const rid = () => { const a = new Uint8Array(10); crypto.getRandomValues(a); return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };

  // live updates: one event stream, listeners keyed by document or collection path
  const listeners = new Set();
  let es = null;
  function stream() {
    if (es) return;
    es = new EventSource(api("events"));
    es.onmessage = (e) => { let p; try { p = JSON.parse(e.data).path; } catch { return; } listeners.forEach((l) => { if (l.match(p)) l.refresh(); }); };
    es.onopen = () => listeners.forEach((l) => l.refresh()); // resync after a reconnect
  }
  function listen(match, load, next, error) {
    const l = { match, refresh: () => load().then(next).catch((e) => error && error(e)) };
    listeners.add(l); stream(); l.refresh();
    const poll = setInterval(l.refresh, 60000); // belt and braces if the stream is blocked by a proxy
    return () => { listeners.delete(l); clearInterval(poll); };
  }

  function docRef(path) {
    const q = "doc?path=" + encodeURIComponent(path);
    const get = async () => docSnap(path, await call("GET", api(q)));
    return {
      id: path.split("/").pop(), path, get,
      set: (data) => call("PUT", api(q), data),
      update: (data) => call("PATCH", api(q), data),
      delete: () => call("DELETE", api(q)),
      onSnapshot: (next, error) => listen((p) => p === path, get, next, error),
      collection: (c) => colRef(path + "/" + c),
    };
  }
  function colRef(path) {
    const get = async () => colSnap(await call("GET", api("collection?path=" + encodeURIComponent(path))));
    return {
      path, get,
      doc: (id) => docRef(path + "/" + (id || rid())),
      add: async (data) => { const r = docRef(path + "/" + rid()); await r.set(data); return r; },
      onSnapshot: (next, error) => listen((p) => parent(p) === path, get, next, error),
    };
  }
  const db = { doc: docRef, collection: colRef };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { status: "saved" };
    },
  };

  const caps = { db, downloads };
  window.claude = { use: async (name) => caps[name] || null };
  window.__PLATFORM__ = "local";
})();
