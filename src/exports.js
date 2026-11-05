/* Pattern output: SVG (preview + export), DXF, tiled PDF. All geometry in mm at 1:1. */
(function (root) {
  "use strict";
  const C = root.Cutter || (typeof require !== "undefined" ? require("./engine.js") : null);
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const asc = (s) => String(s).replace(/[−–—]/g, "-").replace(/×/g, "x").replace(/°/g, " deg").replace(/[^\x20-\x7E]/g, "");

  // Flatten one placed piece into drawing primitives (mm, page space)
  function primitives(pl, meta) {
    const { piece: p, dx, dy } = pl; const T = (q) => ({ x: q.x + dx, y: q.y + dy });
    const out = [];
    out.push({ k: "poly", layer: "CUT", pts: p.cut.map(T), closed: true });
    out.push({ k: "poly", layer: "NET", pts: p.net.map(T), closed: true });
    p.marks.forEach((m) => {
      if (m.type === "grain") {
        const a = T({ x: m.x, y: m.y0 }), b = T({ x: m.x, y: m.y1 });
        out.push({ k: "line", layer: "GRAIN", a, b });
        [[a, 1], [b, -1]].forEach(([q, s]) => { out.push({ k: "line", layer: "GRAIN", a: q, b: { x: q.x - 5, y: q.y + 12 * s } }); out.push({ k: "line", layer: "GRAIN", a: q, b: { x: q.x + 5, y: q.y + 12 * s } }); });
        out.push({ k: "text", layer: "TEXT", p: { x: a.x + 6, y: a.y + 40 }, size: 4, rot: 90, s: m.label });
      } else if (m.type === "notch") {
        const q = T(m.p); out.push({ k: "line", layer: "MARKS", a: { x: q.x - 2 * m.dir, y: q.y }, b: { x: q.x + 10 * m.dir, y: q.y } });
      } else if (m.type === "line") {
        out.push({ k: "line", layer: "MARKS", a: T(m.a), b: T(m.b) });
        out.push({ k: "text", layer: "TEXT", p: T({ x: m.b.x + 3, y: m.b.y - 2 }), size: 3, s: m.label });
      } else if (m.type === "dart") {
        out.push({ k: "line", layer: "MARKS", a: T(m.a), b: T(m.tip) }); out.push({ k: "line", layer: "MARKS", a: T(m.b), b: T(m.tip) });
        out.push({ k: "drill", layer: "MARKS", p: T({ x: m.tip.x, y: m.tip.y - 10 }) });
        out.push({ k: "text", layer: "TEXT", p: T({ x: m.tip.x + 4, y: m.tip.y }), size: 3, s: m.label });
      } else if (m.type === "pleat") {
        const y0 = m.y0;
        out.push({ k: "line", layer: "MARKS", a: T({ x: m.x, y: y0 }), b: T({ x: m.x, y: y0 + m.len }) });
        out.push({ k: "line", layer: "MARKS", a: T({ x: m.x - m.w, y: y0 }), b: T({ x: m.x - m.w, y: y0 + m.len * 0.6 }) });
        out.push({ k: "text", layer: "TEXT", p: T({ x: m.x + 3, y: y0 + 30 }), size: 3, s: m.label });
      }
    });
    const b = C.bbox(p.net);
    const cx = b.x0 + dx + 70, cy = b.y0 + dy + Math.min(b.h * 0.42, 420);
    const big = b.h > 400;
    const sz = big ? 9 : 4.5;
    const lines = [p.name, p.count + " · " + p.material, meta.project, meta.version];
    lines.forEach((s, i) => out.push({ k: "text", layer: "TEXT", p: { x: big ? cx : b.x0 + dx + 6, y: (big ? cy : b.y0 + dy + 12) + i * sz * 1.5 }, size: i === 0 ? sz : sz * 0.7, s }));
    return out;
  }

  function sheet(spec, meta, width) {
    const L = C.layout(spec.pieces, width);
    const prims = []; L.placed.forEach((pl) => prims.push(...primitives(pl, meta)));
    return { prims, width: L.width, height: L.height };
  }

  // ---------- SVG ----------
  function toSVG(spec, meta, opts = {}) {
    const S = sheet(spec, meta, opts.width || 900);
    const col = opts.colors || { CUT: "#111", NET: "#888", GRAIN: "#1d5fa8", MARKS: "#b3261e", TEXT: "#222" };
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    let o = `<svg xmlns="http://www.w3.org/2000/svg" ${opts.preview ? 'class="pattern"' : `width="${f1(S.width)}mm" height="${f1(S.height)}mm"`} viewBox="0 0 ${f1(S.width)} ${f1(S.height)}">`;
    if (!opts.preview) o += `<rect x="20" y="20" width="100" height="100" fill="none" stroke="#111" stroke-width="0.4"/><text x="30" y="72" font-family="Helvetica,Arial" font-size="6">100 mm</text>`;
    S.prims.forEach((q) => {
      if (q.k === "poly") o += `<path d="M${q.pts.map((p) => f1(p.x) + " " + f1(p.y)).join("L")}${q.closed ? "Z" : ""}" fill="none" stroke="${col[q.layer]}" stroke-width="${q.layer === "CUT" ? 0.5 : 0.3}"${q.layer === "NET" ? ' stroke-dasharray="4 2"' : ""}/>`;
      else if (q.k === "line") o += `<line x1="${f1(q.a.x)}" y1="${f1(q.a.y)}" x2="${f1(q.b.x)}" y2="${f1(q.b.y)}" stroke="${col[q.layer]}" stroke-width="0.35"/>`;
      else if (q.k === "drill") o += `<circle cx="${f1(q.p.x)}" cy="${f1(q.p.y)}" r="1.5" fill="none" stroke="${col.MARKS}" stroke-width="0.35"/>`;
      else if (q.k === "text") o += `<text x="${f1(q.p.x)}" y="${f1(q.p.y)}" font-family="Helvetica,Arial" font-size="${q.size}" fill="${col.TEXT}"${q.rot ? ` transform="rotate(${-q.rot} ${f1(q.p.x)} ${f1(q.p.y)})"` : ""}>${esc(q.s)}</text>`;
    });
    if (!opts.preview) o += `<text x="140" y="30" font-family="Helvetica,Arial" font-size="5">${esc(meta.project)} · ${esc(meta.version)} · ${esc(meta.date)} · solid = cut line, dashed = net (stitch) line · engine ${C.ENGINE_VERSION}</text>`;
    return o + "</svg>";
  }

  // ---------- DXF (R12, mm, y up) ----------
  function toDXF(spec, meta) {
    const S = sheet(spec, meta, 900);
    const H = S.height; const Y = (y) => f1(H - y);
    const g = []; const P = (c, v) => g.push(String(c), String(v));
    P(0, "SECTION"); P(2, "HEADER"); P(9, "$ACADVER"); P(1, "AC1009"); P(9, "$INSUNITS"); P(70, 4); P(9, "$MEASUREMENT"); P(70, 1); P(0, "ENDSEC");
    P(0, "SECTION"); P(2, "TABLES"); P(0, "TABLE"); P(2, "LAYER"); P(70, 5);
    [["CUT", 7], ["NET", 8], ["GRAIN", 5], ["MARKS", 1], ["TEXT", 7]].forEach(([n, c]) => { P(0, "LAYER"); P(2, n); P(70, 0); P(62, c); P(6, "CONTINUOUS"); });
    P(0, "ENDTAB"); P(0, "ENDSEC");
    P(0, "SECTION"); P(2, "ENTITIES");
    S.prims.forEach((q) => {
      if (q.k === "poly") { P(0, "POLYLINE"); P(8, q.layer); P(66, 1); P(70, q.closed ? 1 : 0); q.pts.forEach((p) => { P(0, "VERTEX"); P(8, q.layer); P(10, f1(p.x)); P(20, Y(p.y)); }); P(0, "SEQEND"); P(8, q.layer); }
      else if (q.k === "line") { P(0, "LINE"); P(8, q.layer); P(10, f1(q.a.x)); P(20, Y(q.a.y)); P(11, f1(q.b.x)); P(21, Y(q.b.y)); }
      else if (q.k === "drill") { P(0, "CIRCLE"); P(8, q.layer); P(10, f1(q.p.x)); P(20, Y(q.p.y)); P(40, 1.5); }
      else if (q.k === "text") { P(0, "TEXT"); P(8, "TEXT"); P(10, f1(q.p.x)); P(20, Y(q.p.y)); P(40, f1(q.size)); P(1, asc(q.s)); if (q.rot) P(50, q.rot); }
    });
    P(0, "ENDSEC"); P(0, "EOF");
    return g.join("\r\n") + "\r\n";
  }

  // ---------- PDF ----------
  const FORMATS = {
    a4: { label: "Tiled A4", pw: 210, ph: 297, margin: 10, layoutW: 880, tile: true },
    a0: { label: "A0 sheets", pw: 841, ph: 1189, margin: 15, layoutW: 811, tile: true },
    roll: { label: "Plotter roll 914 mm", pw: 914, ph: null, margin: 10, layoutW: 894, tile: false },
  };

  function pdfInfo(spec, meta, fmtKey) {
    const F = FORMATS[fmtKey]; const S = sheet(spec, meta, F.layoutW);
    const tw = F.pw - 2 * F.margin, th = (F.ph || 0) - 2 * F.margin;
    if (!F.tile) return { pages: 1, size: `${F.pw} x ${Math.round(S.height + 2 * F.margin)} mm` };
    const cols = Math.ceil(S.width / tw), rows = Math.ceil(S.height / th);
    const boxes = S.prims.filter((q) => q.k === "poly" && q.layer === "CUT").map((q) => C.bbox(q.pts));
    let n = 0; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x0 = c * tw, y0 = r * th; if ((r === 0 && c === 0) || boxes.some((b) => b.x1 > x0 && b.x0 < x0 + tw && b.y1 > y0 && b.y0 < y0 + th)) n++; }
    return { pages: n, size: `${rows} x ${cols} grid` };
  }

  function toPDF(spec, meta, fmtKey, jsPDF) {
    const F = FORMATS[fmtKey];
    const S = sheet(spec, meta, F.layoutW);
    const tw = F.pw - 2 * F.margin, th = (F.ph || S.height + 2 * F.margin) - 2 * F.margin;
    const cols = F.tile ? Math.ceil(S.width / tw) : 1, rows = F.tile ? Math.ceil(S.height / th) : 1;
    const pageH = F.ph || S.height + 2 * F.margin;
    const doc = new jsPDF({ unit: "mm", format: [F.pw, pageH], orientation: F.pw > pageH ? "landscape" : "portrait", compress: true });
    const pages = []; const skipped = [];
    const boxes = S.prims.filter((q) => q.k === "poly" && q.layer === "CUT").map((q) => C.bbox(q.pts));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x0 = c * tw, y0 = r * th, x1 = x0 + tw, y1 = y0 + th;
      const used = (r === 0 && c === 0) || boxes.some((b) => b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1);
      if (used) pages.push([r, c]); else skipped.push(String.fromCharCode(65 + r) + (c + 1));
    }
    pages.forEach(([r, c], idx) => {
      if (idx > 0) doc.addPage([F.pw, pageH], F.pw > pageH ? "landscape" : "portrait");
      const ox = F.margin - c * tw, oy = F.margin - r * th;
      doc.saveGraphicsState();
      doc.rect(F.margin, F.margin, tw, th, null); doc.clip(); doc.discardPath();
      drawPrims(doc, S.prims, ox, oy);
      doc.restoreGraphicsState();
      if (F.tile) tileFurniture(doc, F, r, c, rows, cols, tw, th);
      if (idx === 0) {
        doc.setLineWidth(0.3); doc.setDrawColor(0); doc.setLineDashPattern([], 0);
        const sx = F.margin + 8, sy = F.margin + 12;
        doc.rect(sx, sy, 100, 100); doc.rect(sx + 110, sy, 50, 50);
        doc.setFontSize(9); doc.setTextColor(0);
        doc.text("100 mm", sx + 38, sy + 52); doc.text("50 mm", sx + 125, sy + 27);
        doc.setFontSize(8);
        doc.text(asc(`Print at 100% / actual size. Measure both squares before cutting.`), sx, sy + 108);
        doc.text(asc(`${meta.project} | ${meta.version} | ${meta.date} | ${F.label}${F.tile ? `, ${rows} rows x ${cols} columns` : ""}`), sx, sy + 113);
        if (skipped.length) doc.text(asc(`Blank tiles not printed: ${skipped.join(", ")}`), sx, sy + 118);
      }
    });
    return doc.output("arraybuffer");
  }

  function drawPrims(doc, prims, ox, oy) {
    prims.forEach((q) => {
      const rgb = { CUT: [17, 17, 17], NET: [130, 130, 130], GRAIN: [29, 95, 168], MARKS: [179, 38, 30], TEXT: [30, 30, 30] }[q.layer];
      doc.setDrawColor(...rgb);
      if (q.k === "poly") {
        doc.setLineWidth(q.layer === "CUT" ? 0.45 : 0.25);
        doc.setLineDashPattern(q.layer === "NET" ? [3, 1.5] : [], 0);
        const p0 = q.pts[0]; const segs = [];
        for (let i = 1; i < q.pts.length; i++) segs.push([q.pts[i].x - q.pts[i - 1].x, q.pts[i].y - q.pts[i - 1].y]);
        doc.lines(segs, p0.x + ox, p0.y + oy, [1, 1], "S", !!q.closed);
      } else if (q.k === "line") {
        doc.setLineWidth(0.3); doc.setLineDashPattern([], 0);
        doc.line(q.a.x + ox, q.a.y + oy, q.b.x + ox, q.b.y + oy);
      } else if (q.k === "drill") {
        doc.setLineWidth(0.3); doc.setLineDashPattern([], 0); doc.circle(q.p.x + ox, q.p.y + oy, 1.5, "S");
      } else if (q.k === "text") {
        doc.setTextColor(...rgb); doc.setFontSize(q.size * 2.835);
        doc.text(asc(q.s), q.p.x + ox, q.p.y + oy, q.rot ? { angle: q.rot } : undefined);
      }
    });
  }

  function tileFurniture(doc, F, r, c, rows, cols, tw, th) {
    const m = F.margin; const L = String.fromCharCode(65 + r) + (c + 1);
    doc.setLineDashPattern([], 0); doc.setDrawColor(160); doc.setLineWidth(0.15);
    doc.rect(m, m, tw, th);
    doc.setDrawColor(0); doc.setLineWidth(0.25);
    // half-diamonds at each joining edge midpoint: they meet into a full diamond when tiles are butted
    const d = 6;
    const tri = (x1, y1, x2, y2, x3, y3) => doc.triangle(x1, y1, x2, y2, x3, y3, "S");
    if (c < cols - 1) tri(m + tw, m + th / 2 - d, m + tw, m + th / 2 + d, m + tw - d, m + th / 2);
    if (c > 0) tri(m, m + th / 2 - d, m, m + th / 2 + d, m + d, m + th / 2);
    if (r < rows - 1) tri(m + tw / 2 - d, m + th, m + tw / 2 + d, m + th, m + tw / 2, m + th - d);
    if (r > 0) tri(m + tw / 2 - d, m, m + tw / 2 + d, m, m + tw / 2, m + d);
    doc.setFontSize(F.tile && F.pw < 300 ? 10 : 28); doc.setTextColor(120);
    doc.text(L, m + 3, m + (F.pw < 300 ? 6 : 14));
    doc.setFontSize(F.pw < 300 ? 6 : 14);
    doc.text(asc(`Tile ${L} of ${String.fromCharCode(64 + rows)}${cols}. Trim right and bottom margins on the grey line; lay over the next tile on its grey border.`), m + 3, F.pw < 300 ? m + th + 5 : m + th + 10);
  }

  const api = { toSVG, toDXF, toPDF, pdfInfo, FORMATS, sheet };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CutterExport = api;
})(typeof window !== "undefined" ? window : globalThis);
