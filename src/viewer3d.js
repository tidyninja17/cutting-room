/* 3D preview of the drafted trousers.
   Each leg is lofted from the draft as two panels, back and front, joined where
   they are stitched: the side seam, the inside leg, and CB/CF above the fork.
   At every level the panel widths come from the net pattern, and details
   (creases, pleats, darts, pockets, fly) are mapped from their pattern positions. */
(function (root) {
  "use strict";
  const NB = 32, NF = 32, NC = NB + NF; // column 0 = CB / inside leg, NB = side seam, NC = CF / inside leg

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const pid = (spec, id) => (spec.points.front.find((p) => p.id === id) || spec.points.back.find((p) => p.id === id) || {});
  function spanAt(poly, y) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) { const x = a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y); lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    return hi > lo ? { lo, hi, w: hi - lo } : { lo: 0, hi: 0, w: 0 };
  }
  function smoothArr(rows, key, passes) {
    for (let p = 0; p < passes; p++) { const v = rows.map((r) => r[key]); for (let i = 1; i < rows.length - 1; i++) rows[i][key] = (v[i - 1] + 2 * v[i] + v[i + 1]) / 4; }
  }

  const CLOTHS = [
    [/navy|midnight/i, 0x26324a], [/charcoal|anthracite/i, 0x3c3f44], [/black/i, 0x222326], [/grey|gray|flannel/i, 0x7c7f83],
    [/brown|chocolate|tobacco/i, 0x5b4331], [/tan|camel|fawn|khaki|stone/i, 0xb39a74], [/cream|ecru|ivory|white/i, 0xe4dccb],
    [/green|olive|loden|bottle/i, 0x4b5a3f], [/blue|cobalt/i, 0x34507a], [/burgundy|wine|claret/i, 0x5e2a33], [/tweed/i, 0x7a6a52],
  ];
  const clothColor = (t) => { for (const [re, c] of CLOTHS) if (re.test(t || "")) return c; return 0x6f7378; };

  // ---- section curve: half-ellipse (t = 0) opening to a full leg loop (t = 1) ----
  const range = (t) => (t >= 1 ? [-Math.PI, Math.PI] : [-Math.acos(-t), Math.acos(-t)]);
  function curve(t, a, Df, Db, n = 240) {
    const [t0, t1] = range(t); const pts = []; let L = 0;
    for (let i = 0; i <= n; i++) {
      const th = t0 + (t1 - t0) * (i / n), s = Math.sin(th);
      const p = { x: Math.max(0, (t + Math.cos(th)) * a), z: s * (s > 0 ? Df : Db) };
      if (i) L += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      p.s = L; pts.push(p);
    }
    return { pts, L };
  }
  function atS(c, s) {
    const p = c.pts; let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].s < s) lo = m; else hi = m; }
    const w = (s - p[lo].s) / ((p[hi].s - p[lo].s) || 1);
    return { x: lerp(p[lo].x, p[hi].x, w), z: lerp(p[lo].z, p[hi].z, w) };
  }

  function legModel(spec, input, sideKey) {
    const find = (base) => spec.pieces.find((p) => p.id === base + (sideKey === "pair" ? "" : "_" + sideKey));
    const F = find("front"), B = find("back");
    const seatY = pid(spec, "F_seat_side").y, R = pid(spec, "F_fork").y, OL = pid(spec, "F_hem_side").y, kneeY = pid(spec, "F_knee_side").y;
    const P = spec.params, sup = spec.suppression;
    const pleatSum = (sup.front.pleats || []).reduce((a, b) => a + b, 0) + (sup.front.dart || 0);
    const dartSum = (sup.back.darts || []).reduce((a, b) => a + b, 0);
    const st = input.style || {}, fig = input.figuration || {};
    const lowHip = fig.hips && fig.hips !== "level" && ((fig.hips === "left_low" && sideKey === "left") || (fig.hips === "right_low" && sideKey === "right")) ? Number(fig.hip_mm) || 0 : 0;
    const fSeat = spanAt(F.net, seatY).w, bSeat = spanAt(B.net, seatY).w;
    const fThigh = spanAt(F.net, R + 70).w, bThigh = spanAt(B.net, R + 70).w;
    const kAt = (y) => {
      if (y <= seatY) return lerp(0.74, 0.8, y / seatY);
      if (y <= R) return lerp(0.8, 1.2, smooth((y - seatY) / (R - seatY)));
      if (y <= kneeY) return lerp(1.2, 0.84, smooth((y - R) / (kneeY - R)));
      return lerp(0.84, 0.62, (y - kneeY) / (OL - kneeY));
    };
    const ys = []; for (let y = 0; y < OL; y += 8) ys.push(y); ys.push(OL);
    const rows = ys.map((y) => {
      const yy = Math.max(y, 12);
      const fs = spanAt(F.net, yy), bs = spanAt(B.net, yy);
      let Fw = fs.w - pleatSum * Math.max(0, 1 - y / 90), Bw = bs.w - dartSum * Math.max(0, 1 - y / 100);
      // cloth beyond a smooth seat-to-thigh reference is the crotch extension: it folds between the legs
      const u = smooth((y - seatY) / (R + 70 - seatY));
      const refF = lerp(fSeat, fThigh, u), refB = lerp(bSeat, bThigh, u);
      const on = y > seatY && y < R + 70 ? 1 : 0;
      const exF = 0.85 * Math.max(0, Fw - refF) * on, exB = 0.85 * Math.max(0, Bw - refB) * on;
      Fw -= exF; Bw -= exB;
      return { y, fs, bs, exF, exB, Fw, Bw, g: Fw + Bw, f: clamp(Fw / (Fw + Bw), 0.3, 0.7), k: kAt(y),
        t: Math.min(1, smooth((y - seatY + 30) / (R - seatY + 70))), gap: y > R ? 24 * (y - R) / (OL - R) : 0 };
    });
    // natural depths for the section's proportion, then let the seat and front hip fall smoothly
    rows.forEach((r) => { const L1 = curve(r.t, 1, r.k * 2 * r.f, r.k * 2 * (1 - r.f), 64).L; const a = r.g / L1; r.Df = a * r.k * 2 * r.f; r.Db = a * r.k * 2 * (1 - r.f); });
    const sr = rows.reduce((a, b) => (Math.abs(b.y - seatY) < Math.abs(a.y - seatY) ? b : a));
    rows.forEach((r) => {
      if (r.y <= seatY) return;
      r.Db = Math.max(r.Db, sr.Db * (1 - smooth((r.y - seatY) / (R + 230 - seatY))));
      r.Df = Math.max(r.Df, sr.Df * (1 - smooth((r.y - seatY) / (R + 90 - seatY))));
    });
    smoothArr(rows, "Df", 6); smoothArr(rows, "Db", 6); smoothArr(rows, "g", 3);
    rows.forEach((r) => { let lo = 5, hi = 1200; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (curve(r.t, m, r.Df, r.Db, 64).L > r.g) hi = m; else lo = m; } r.a = (lo + hi) / 2; });
    smoothArr(rows, "a", 4);
    // place the panels: back from CB / inside leg to the side seam, front from the side seam to CF / inside leg
    rows.forEach((r) => {
      const c = curve(r.t, r.a, r.Df, r.Db, 160); const sSide = c.L * (r.Bw / (r.Fw + r.Bw));
      r.cols = [];
      for (let j = 0; j <= NC; j++) {
        const s = j <= NB ? sSide * (j / NB) : sSide + (c.L - sSide) * ((j - NB) / NF);
        const q = atS(c, s); r.cols.push({ x: q.x + r.gap, z: q.z });
      }
      if (r.t < 1) { r.cols[0].x = 0; r.cols[NC].x = 0; }
    });
    // a trouser side seam runs straight from the hip down: keep the silhouette from rising again below the seat
    let cap = Infinity; const want = rows.map((r) => {
      const side = r.cols[NB].x;
      if (r.y < seatY) return side;
      if (r.y <= kneeY) { cap = Math.min(cap, side); return cap; }
      return side;
    });
    for (let p = 0; p < 6; p++) { const v = want.slice(); for (let i = 1; i < rows.length - 1; i++) want[i] = (v[i - 1] + 2 * v[i] + v[i + 1]) / 4; }
    rows.forEach((r, i) => {
      const inner = Math.min(...r.cols.map((c) => c.x)), side = r.cols[NB].x; if (side - inner < 1) return;
      const k = (want[i] - inner) / (side - inner); r.cols.forEach((c) => { c.x = inner + (c.x - inner) * k; });
    });
    const lift = (r, j, z) => {
      const top = Math.max(0, 1 - r.y / 140), wb = j <= NB ? 1 - j / NB : 0, wf = j >= NB ? (j - NB) / NF : 0;
      const side = 1 - Math.abs(j - NB) / NB;
      let d = (P.back_raise || 0) * wb * wb * top + (P.front_raise || 0) * wf * wf * top - lowHip * Math.max(0, side) * top;
      const hem = clamp((r.y - (OL - 80)) / 80, 0, 1); d -= (P.back_hem_drop || 0) * clamp(-z / Math.max(1, r.Db), 0, 1) * hem;
      return d;
    };
    // vertex at (row index, fractional column), optionally pushed out along the surface normal
    const V = (i, j, off = 0) => {
      i = clamp(i, 0, rows.length - 1); j = clamp(j, 0, NC);
      const r = rows[i]; const j0 = Math.min(NC - 1, Math.floor(j)), w = j - j0;
      const A = r.cols[j0], Bc = r.cols[j0 + 1];
      let x = lerp(A.x, Bc.x, w), z = lerp(A.z, Bc.z, w);
      if (off) { const ja = Math.max(0, j - 0.5), jb = Math.min(NC, j + 0.5); const pa = col(r, ja), pb = col(r, jb); let tx = pb.x - pa.x, tz = pb.z - pa.z; const L = Math.hypot(tx, tz) || 1; x += (tz / L) * off; z += (-tx / L) * off; }
      return [x, OL - r.y + lift(r, j, z), z];
    };
    const col = (r, j) => { const j0 = Math.min(NC - 1, Math.floor(j)), w = j - j0; return { x: lerp(r.cols[j0].x, r.cols[j0 + 1].x, w), z: lerp(r.cols[j0].z, r.cols[j0 + 1].z, w) }; };
    const rowAt = (y) => { const i = clamp(y / 8, 0, rows.length - 1); return i; };
    // fractional surface position of a pattern point
    const fromPattern = (kind, x, y) => {
      const i = rowAt(y), r = rows[Math.round(i)];
      if (kind === "front") { const s = r.fs; const u = clamp((x - s.lo) / Math.max(1, s.w - r.exF), 0, 1); return [i, NB + u * NF]; }
      const s = r.bs; const u = clamp((x - s.lo) / Math.max(1, s.w - r.exB), 0, 1); return [i, NB * (1 - u)];
    };
    const at = (kind, x, y, off = 0) => { const [i, j] = fromPattern(kind, x, y); const i0 = Math.floor(i), w = i - i0; const a = V(i0, j, off), b = V(i0 + 1, j, off); return [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)]; };
    // a line on the grain (crease): pattern x fixed, column positions smoothed so the press line runs clean
    const grainLine = (kind, x, y0, y1, off = 1) => {
      const ids = []; for (let i = Math.ceil(y0 / 8); i <= Math.floor(y1 / 8) && i < rows.length; i++) ids.push(i);
      const js = ids.map((i) => fromPattern(kind, x, rows[i].y)[1]);
      for (let p = 0; p < 60; p++) { const v = js.slice(); for (let k = 1; k < js.length - 1; k++) js[k] = (v[k - 1] + 2 * v[k] + v[k + 1]) / 4; }
      return ids.map((i, k) => V(i, js[k], off));
    };
    return { rows, V, at, grainLine, OL, R, seatY, st, F, B };
  }

  function create(container) {
    const THREE = root.THREE;
    const wrap = document.createElement("div"); wrap.className = "v3d";
    const msg = document.createElement("div"); msg.className = "v3d-msg"; msg.hidden = true;
    const views = document.createElement("div"); views.className = "v3d-views";
    views.innerHTML = ["Front", "Side", "Back", "¾"].map((v, i) => `<button type="button" class="btn sm" data-view="${i}">${v}</button>`).join("");
    wrap.append(views, msg); container.append(wrap);
    const dead = (t) => { msg.hidden = false; msg.textContent = t; return { update() {}, attach(el) { el.append(wrap); } }; };
    if (!THREE) return dead("The 3D preview needs WebGL and couldn’t load here.");
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { return dead("This browser can’t show the 3D preview (WebGL is off)."); }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.outputEncoding = THREE.sRGBEncoding;
    wrap.prepend(renderer.domElement);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(28, 1, 10, 20000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3530, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(900, 2200, 1600); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35); rim.position.set(-1500, 900, -1400); scene.add(rim);
    const cv = document.createElement("canvas"); cv.width = cv.height = 128; const cx = cv.getContext("2d");
    const grd = cx.createRadialGradient(64, 64, 4, 64, 64, 64); grd.addColorStop(0, "rgba(0,0,0,0.35)"); grd.addColorStop(1, "rgba(0,0,0,0)"); cx.fillStyle = grd; cx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
    const group = new THREE.Group(); scene.add(group);
    let az = 0.45, el = 0.12, dist = 3600, framed = false; const target = new THREE.Vector3(0, 600, 0); let OLs = 1100;
    const place = () => { cam.position.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(az) * Math.cos(el)); cam.lookAt(target); render(); };
    let raf = 0; const render = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; renderer.render(scene, cam); }); };
    const resize = () => { const w = wrap.clientWidth || 300, h = wrap.clientHeight || 400; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); render(); };
    new ResizeObserver(resize).observe(wrap);
    let drag = null; const cvs = renderer.domElement;
    cvs.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, az, el }; cvs.setPointerCapture(e.pointerId); });
    cvs.addEventListener("pointermove", (e) => { if (!drag) return; az = drag.az - (e.clientX - drag.x) * 0.008; el = clamp(drag.el + (e.clientY - drag.y) * 0.005, -0.25, 0.9); place(); });
    cvs.addEventListener("pointerup", () => (drag = null));
    cvs.addEventListener("wheel", (e) => { e.preventDefault(); dist = clamp(dist * (1 + Math.sign(e.deltaY) * 0.08), OLs * 1.0, OLs * 6); place(); }, { passive: false });
    cvs.addEventListener("dblclick", () => { az = 0.45; el = 0.12; dist = OLs * 3.1; place(); });
    views.addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (!b) return; az = [0, Math.PI / 2, Math.PI, 0.6][Number(b.dataset.view)]; el = 0.08; place(); });
    const clear = () => { while (group.children.length) { const o = group.children.pop(); o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); } };

    function update(spec, input, note) {
      msg.hidden = !note; if (note) msg.textContent = note;
      if (!spec || spec.status !== "ok") { if (!group.children.length) { msg.hidden = false; msg.textContent = note || "Enter the required measures to see the trousers."; } render(); return; }
      clear();
      const color = clothColor(input.cloth && input.cloth.type);
      const base = new THREE.Color(color);
      const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
      const bandMat = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.94), roughness: 0.88, side: THREE.DoubleSide });
      const seam = new THREE.LineBasicMaterial({ color: base.clone().multiplyScalar(0.5) });
      const crease = new THREE.LineBasicMaterial({ color: base.clone().lerp(new THREE.Color(0xffffff), 0.28) });
      const st = input.style || {};
      const asym = spec.pieces.some((p) => p.id === "front_left");
      const legs = asym ? [["right", 1], ["left", -1]] : [["pair", 1], ["pair", -1]];
      const pts = (arr, mx) => arr.map((v) => new THREE.Vector3(v[0] * mx, v[1], v[2]));
      const addLine = (arr, mx, mat) => { if (arr.length > 1) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts(arr, mx)), mat)); };
      const addMesh = (pos, idx, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); group.add(new THREE.Mesh(g, mat)); };
      const strip = (bottom, heights, mat, mx, out = 0) => { // vertical band rising from a ring of points
        const pos = [], idx = [];
        bottom.forEach((v, j) => { pos.push(v[0] * mx, v[1], v[2], v[0] * mx, v[1] + heights[j], v[2]); });
        for (let j = 0; j < bottom.length - 1; j++) { const a = j * 2, b = a + 1, c = a + 2, d = a + 3; if (mx > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
        addMesh(pos, idx, mat);
      };
      const box = (v, w, h, d, mx, rotY, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || bandMat); m.position.set(v[0] * mx, v[1], v[2]); m.rotation.y = rotY * mx; group.add(m); };
      const button = (v, mx) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 3, 16), new THREE.MeshStandardMaterial({ color: 0xd8cfbf, roughness: 0.5 })); m.position.set(v[0] * mx, v[1], v[2]); m.rotation.x = Math.PI / 2; group.add(m); };

      legs.forEach(([sk, mx]) => {
        const M = legModel(spec, input, sk); OLs = M.OL; const nr = M.rows.length;
        // cloth
        const pos = [], idx = [];
        for (let i = 0; i < nr; i++) for (let j = 0; j <= NC; j++) pos.push(...M.V(i, j).map((v, k) => (k === 0 ? v * mx : v)));
        for (let i = 0; i < nr - 1; i++) for (let j = 0; j < NC; j++) { const a = i * (NC + 1) + j, b = a + 1, c = a + NC + 1, d = c + 1; if (mx > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
        addMesh(pos, idx, cloth);
        // seams, where they are stitched
        const colLine = (j, i0, i1, off = 0.8) => { const a = []; for (let i = i0; i <= i1; i++) a.push(M.V(i, j, off)); return a; };
        const iFork = Math.round(clamp((M.R + 40) / 8, 0, nr - 1));
        addLine(colLine(NB, 0, nr - 1), mx, seam);           // side seam
        addLine(colLine(0, 0, nr - 1), mx, seam);            // CB seam, then inside leg
        addLine(colLine(NC, 0, iFork), mx, seam);            // CF seam down to the fork
        // creases on the grain, mapped from the pattern
        const g = (pc) => pc.marks.find((m) => m.type === "grain");
        const fg = g(M.F), bg = g(M.B);
        const pleats = M.F.marks.filter((m) => m.type === "pleat");
        const line = (kind, x0, y0, x1, y1, off = 1, n = 16) => { const a = []; for (let s = 0; s <= n; s++) { const t = s / n; a.push(M.at(kind, lerp(x0, x1, t), lerp(y0, y1, t), off)); } return a; };
        if (fg) addLine(M.grainLine("front", fg.x, pleats.length ? pleats[0].len : 110, M.OL - 2), mx, crease);
        if (bg) addLine(M.grainLine("back", bg.x, M.R + 60, M.OL - 2), mx, crease);
        // pleats: fold edge on the crease and its placement line
        pleats.forEach((p) => { addLine(line("front", p.x, 2, p.x, p.len, 1.2), mx, seam); addLine(line("front", p.x - p.w, 2, p.x - p.w, p.len * 0.55, 1.2), mx, seam); });
        // darts
        M.B.marks.filter((m) => m.type === "dart").forEach((d) => { addLine(line("back", d.a.x, d.a.y + 2, d.tip.x, d.tip.y, 1.2, 8), mx, seam); addLine(line("back", d.b.x, d.b.y + 2, d.tip.x, d.tip.y, 1.2, 8), mx, seam); });
        M.F.marks.filter((m) => m.type === "dart").forEach((d) => { addLine(line("front", d.a.x, d.a.y + 2, d.tip.x, d.tip.y, 1.2, 8), mx, seam); addLine(line("front", d.b.x, d.b.y + 2, d.tip.x, d.tip.y, 1.2, 8), mx, seam); });
        // pockets
        if (st.side_pockets === "on_seam") addLine(colLine(NB + 0.7, Math.round(40 / 8), Math.round(210 / 8), 1.2), mx, seam);
        const cross = M.F.marks.find((m) => m.type === "line" && /Cross pocket/.test(m.label));
        if (cross) addLine(line("front", cross.a.x, cross.a.y + 3, cross.b.x, cross.b.y, 1.2), mx, seam);
        const hip = M.B.marks.find((m) => m.type === "line" && /Hip pocket/.test(m.label));
        const hp = Number(st.hip_pockets) || 0;
        if (hip && (hp === 2 || (hp === 1 && mx > 0))) {
          [-5, 5].forEach((dy) => addLine(line("back", hip.a.x, hip.a.y + dy, hip.b.x, hip.b.y + dy, 1.4, 12), mx, seam));
          if (st.hip_pocket_button) button(M.at("back", (hip.a.x + hip.b.x) / 2, (hip.a.y + hip.b.y) / 2 + 18, 3), mx);
        }
        // fly stitching on the button side: 35 mm in from CF, curving into the seam
        if (mx > 0) {
          const a = []; for (let y = 2; y <= 190; y += 6) { const r = M.rows[Math.round(y / 8)]; const off = y <= 155 ? 35 : 35 * Math.sqrt(Math.max(0, 1 - ((y - 155) / 35) ** 2)); a.push(M.at("front", r.fs.hi - off, y, 1.2)); }
          addLine(a, mx, seam);
        }
        // turn-ups
        if (st.bottoms === "turn_up") {
          const depth = Number(st.turnup_depth) || 45; const ring = []; for (let j = 0; j <= NC; j++) ring.push(M.V(nr - 1, j, 2.5));
          strip(ring, ring.map(() => depth), bandMat, mx);
          addLine(ring.map((v) => [v[0], v[1] + depth, v[2]]), mx, seam);
        }
        // waistband or cut-on fishtail; both halves meet exactly at CB and CF
        const top = []; for (let j = 0; j <= NC; j++) top.push(M.V(0, j, 1.5));
        const fish = st.waistband === "fishtail_braces", wb = 40;
        if (fish) {
          const back = top.slice(0, NB + 1), front = top.slice(NB);
          const hB = back.map((_, j) => { const u = j / NB; return wb + 60 * Math.pow(Math.max(0, 1 - u / 0.8), 1.5); });
          strip(back, hB, cloth, mx);
          strip(front, front.map(() => wb), bandMat, mx);
          addLine(front, mx, seam); addLine(front.map((v) => [v[0], v[1] + wb, v[2]]), mx, seam);
          addLine(back.map((v, j) => [v[0], v[1] + hB[j], v[2]]), mx, seam);
          // braces buttons sit inside the band
          [NB + NF * 0.42, NB + NF * 0.72].forEach((j) => { const v = M.V(0, j, -3); button([v[0], v[1] + 20, v[2]], mx); });
          const vb = M.V(0, 3, -3); button([vb[0], vb[1] + 40, vb[2]], mx);
        } else {
          strip(top, top.map(() => wb), bandMat, mx);
          addLine(top, mx, seam); addLine(top.map((v) => [v[0], v[1] + wb, v[2]]), mx, seam);
        }
        addLine([top[0], [top[0][0], top[0][1] + (fish ? 86 : wb), top[0][2]]], mx, seam); // CB seam through the band
        const facing = (j) => { const a = M.V(0, Math.max(0, j - 0.5)), b = M.V(0, Math.min(NC, j + 0.5)); return Math.atan2(b[2] - a[2], b[0] - a[0]); };
        if (st.waistband === "belt_loops") [NB * 0.45, NB + 2, NB + NF * 0.5].forEach((j) => { const v = M.V(0, j, 3); box([v[0], v[1] + wb / 2, v[2]], 10, wb + 8, 3, mx, -facing(j)); });
        if (st.waistband === "side_adjusters") { const v = M.V(0, NB + 3, 3.5); box([v[0], v[1] + wb / 2, v[2]], 60, 18, 3, mx, -facing(NB + 3)); const b2 = M.V(0, NB + 6, 5); box([b2[0], b2[1] + wb / 2, b2[2]], 14, 24, 4, mx, -facing(NB + 6), new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.35, metalness: 0.6 })); }
      });
      const b3 = new THREE.Box3().setFromObject(group), size = b3.getSize(new THREE.Vector3());
      target.set(0, b3.min.y + size.y * 0.5, 0);
      shadow.scale.set(size.x * 1.6, Math.max(size.z, 200) * 2.6, 1); shadow.position.set(0, b3.min.y - 1, 0);
      if (!framed) { dist = size.y * 3.1; framed = true; }
      place();
    }
    resize(); place();
    return { update, attach(el2) { el2.append(wrap); resize(); }, el: wrap };
  }

  root.Trouser3D = { create, legModel };
})(typeof window !== "undefined" ? window : globalThis);
