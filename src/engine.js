/* Trouser drafting engine — deterministic, net draft in mm.
   Coordinates per piece: x to the right, y downward, origin at the side
   seam on the seat line's vertical, waist level y = 0. */
(function (root) {
  "use strict";
  const ENGINE_VERSION = "1.0.0";

  // ---------- House defaults (every value is a CALIBRATE setting) ----------
  const DEFAULTS = {
    seatEase: { flat: 40, single_forward_pleat: 50, double_forward_pleat: 60, reverse_pleat: 55 },
    heavyClothGm: 400, heavyClothEaseCut: 10,
    stretchEasePerPct: 2, stretchEaseMaxCut: 20,
    waistEase: 10, waistEaseBraces: 15,
    frontForkDiv: 16, backForkDiv: 10,
    seatAngleDeg: 12,
    seatLineFrac: 0.25,           // seat line above the fork line, as a fraction of body rise
    kneeRaise: 50,                // knee line above the fork-to-hem midpoint
    frontBackSplit: 10,           // front = half-width − 10, back = half-width + 10
    backHemDrop: { none: 5, slight: 10, full: 15 },
    backInsideLegShorten: 8,      // stretched in pressing, fork to knee
    cfInset: 10, backRaise: 20, fishtailRise: 60,
    sideSuppressMax: 15, dartMax: 25, frontDartMax: 15,
    backDartLen: [100, 85], frontDartLen: 70,
    pleats: { flat: [], single_forward_pleat: [30], double_forward_pleat: [30, 20], reverse_pleat: [30] },
    kneeOverBottom: { slim: 20, classic: 40, full: 55 },
    kneeEaseMin: 50, thighEaseMin: 60, minBottom: 340,
    crotchEase: 20, crotchTol: 20,
    riseOffset: 10, riseTol: 15,
    waistbandHeight: 40, flyExtension: 40, flyLength: 190,
    sidePocketOpening: 170, hipPocketOpening: 135, hipPocketDrop: 65,
    inlay: { backSeamWaist: 40, side: 20, inside: 15, waistbandEnds: 25, hemPlain: 50, hemTurnupExtra: 40, other: 10 },
  };

  const FAULTS = [
    { id: "seat_folds", label: "Folds under the seat", cause: "Too much back seam length or back fork", deltas: [{ param: "seatAngleDeg", value: -1 }, { param: "backFork", value: -5 }] },
    { id: "seat_strain", label: "Strain from seat to fork, seat tight", cause: "Back fork too short or seat too small", deltas: [{ param: "backFork", value: 8 }, { param: "seatEase", value: 10 }] },
    { id: "front_whiskers", label: "Whiskers at front fork", cause: "Front fork too short or front rise too long", deltas: [{ param: "frontFork", value: 6 }] },
    { id: "crease_twist", label: "Crease hangs off the shoe or twists", cause: "Leg line not matched to stance or knees", deltas: [{ param: "kneeShift", value: 8 }, { param: "hemShift", value: 5 }] },
    { id: "back_waist_pulls", label: "Back waist pulls down when seated", cause: "Back rise too short", deltas: [{ param: "backRaise", value: 15 }] },
    { id: "front_thigh_breaks", label: "Cloth breaks across front thigh", cause: "Insufficient thigh width", deltas: [{ param: "thighWidth", value: 10 }] },
  ];

  const ADJ_PARAMS = {
    seatAngleDeg: { unit: "°", label: "Seat angle" },
    backFork: { unit: "mm", label: "Back fork extension" },
    frontFork: { unit: "mm", label: "Front fork extension" },
    backRaise: { unit: "mm", label: "Back waist height" },
    frontRaise: { unit: "mm", label: "Front waist height" },
    seatEase: { unit: "mm", label: "Seat ease" },
    waistEase: { unit: "mm", label: "Waist ease" },
    thighWidth: { unit: "mm", label: "Thigh width (inside leg)" },
    kneeShift: { unit: "mm", label: "Knee shift toward side seam" },
    hemShift: { unit: "mm", label: "Hem shift toward side seam" },
    outsideLeg: { unit: "mm", label: "Outside leg length" },
    seatWedge: { unit: "mm", label: "Wedge out at seat line (CB)" },
    backInsideLegShorten: { unit: "mm", label: "Back inside leg ironwork" },
  };

  const REQUIRED = ["waist", "seat", "outside_leg", "inside_leg", "thigh", "knee", "bottom"];

  // ---------- geometry helpers ----------
  const r1 = (v) => Math.round(v * 10) / 10;
  const pt = (x, y) => ({ x, y });
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  function bez(p0, p1, p2, p3, n = 32) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push(pt(
        u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y));
    }
    return out;
  }
  const line = (a, b, n = 2) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n; o.push(pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)); } return o; };
  const plen = (pl) => { let s = 0; for (let i = 1; i < pl.length; i++) s += dist(pl[i - 1], pl[i]); return s; };
  const join = (...parts) => { const o = []; parts.forEach((p, k) => p.forEach((q, i) => { if (k > 0 && i === 0) return; o.push(q); })); return o; };
  const rev = (pl) => pl.slice().reverse();
  const unit = (a, b) => { const d = dist(a, b) || 1; return pt((b.x - a.x) / d, (b.y - a.y) / d); };
  // point at distance s along polyline
  function along(pl, s) {
    let acc = 0;
    for (let i = 1; i < pl.length; i++) {
      const d = dist(pl[i - 1], pl[i]);
      if (acc + d >= s) { const t = (s - acc) / (d || 1); return { p: pt(pl[i - 1].x + (pl[i].x - pl[i - 1].x) * t, pl[i - 1].y + (pl[i].y - pl[i - 1].y) * t), dir: unit(pl[i - 1], pl[i]) }; }
      acc += d;
    }
    const n = pl.length; return { p: pl[n - 1], dir: unit(pl[n - 2], pl[n - 1]) };
  }
  // x of polyline at given y (first crossing)
  function xAtY(pl, y) {
    for (let i = 1; i < pl.length; i++) {
      const a = pl[i - 1], b = pl[i];
      if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
    }
    return null;
  }
  function signedArea(pl) { let s = 0; for (let i = 0; i < pl.length; i++) { const a = pl[i], b = pl[(i + 1) % pl.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }
  function lineIntersect(p1, d1, p2, d2) {
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
    return pt(p1.x + d1.x * t, p1.y + d1.y * t);
  }

  // Offset a closed outline made of seams. seams: [{name, pts, allow:(t)=>mm}]
  // The outline must run clockwise in screen coordinates (y down) so the
  // left-hand normal points outward.
  function offsetOutline(seams) {
    const all = []; seams.forEach((s) => all.push(...s.pts));
    const sgn = signedArea(all) > 0 ? 1 : -1;
    const offs = seams.map((s) => {
      const L = plen(s.pts); let acc = 0; const out = [];
      for (let i = 0; i < s.pts.length; i++) {
        if (i > 0) acc += dist(s.pts[i - 1], s.pts[i]);
        const a = s.pts[Math.max(0, i - 1)], b = s.pts[Math.min(s.pts.length - 1, i + 1)];
        const u = unit(a, b); const nrm = pt(sgn * u.y, -sgn * u.x);
        const d = s.allow(L ? acc / L : 0);
        out.push(pt(s.pts[i].x + nrm.x * d, s.pts[i].y + nrm.y * d));
      }
      return out;
    });
    const res = [];
    for (let k = 0; k < offs.length; k++) {
      const cur = offs[k], nxt = offs[(k + 1) % offs.length];
      const n = cur.length;
      const d1 = unit(cur[n - 2], cur[n - 1]), d2 = unit(nxt[0], nxt[1]);
      const X = lineIntersect(cur[n - 1], d1, nxt[0], d2);
      const body = cur.slice(k === 0 ? 0 : 1, n - 1);
      res.push(...body);
      if (X && dist(X, cur[n - 1]) < 120) res.push(X); else { res.push(cur[n - 1]); res.push(nxt[0]); }
    }
    // the first seam's start was kept; drop it in favour of the final corner
    res.shift();
    return res;
  }

  // ---------- validation (Stage 1) ----------
  function validate(input) {
    const m = input.measurements || {}, f = input.figuration || {}, st = input.style || {};
    const issues = [];
    const add = (id, severity, text, question) => issues.push({ id, severity, text, question });
    REQUIRED.forEach((k) => {
      if (!(Number(m[k]) > 0)) add("missing_" + k, "block", `${label(k)} is missing.`, `What is the client's ${label(k).toLowerCase()} in mm?`);
    });
    if (issues.length) return issues;
    const R = m.outside_leg - m.inside_leg;
    if (R < 180 || R > 380) add("rise_range", "block", `Body rise from outside leg − inside leg is ${R} mm, outside 180–380 mm.`, "Please re-check outside leg and inside leg. Were both taken in shoes, to the same finished hem?");
    if (m.body_rise > 0) {
      const diff = R - m.body_rise - DEFAULTS.riseOffset;
      if (Math.abs(diff) > DEFAULTS.riseTol) add("rise_mismatch", "block",
        `Outside leg − inside leg gives ${R} mm; seated body rise is ${m.body_rise} mm. Allowing ${DEFAULTS.riseOffset} mm for the inside leg being taken short, that is ${r1(diff)} mm out (tolerance ${DEFAULTS.riseTol}).`,
        "Which is right: the leg measures or the seated body rise? Re-measure the inside leg to the fork, or the body rise seated at the worn waist height.");
    }
    const drop = m.seat - m.waist;
    const ranges = { flat: [60, 260], normal: [60, 260], prominent: [20, 180], corpulent: [-120, 100] };
    const rg = ranges[f.stomach || "normal"];
    if (drop < rg[0] || drop > rg[1]) add("drop", "block",
      `Seat − waist drop is ${drop} mm, outside the ${rg[0]} to ${rg[1]} mm range expected for a ${f.stomach || "normal"} stomach.`,
      `Is the stomach really "${f.stomach || "normal"}"? Or was the waist taken at a different height from where the trousers will be worn?`);
    const tr = m.thigh / m.seat;
    if (tr < 0.5 || tr > 0.72) add("thigh_ratio", "warn", `Thigh is ${Math.round(tr * 100)}% of seat (usual 55–65%).`, "Confirm the thigh was taken at the fullest part, close up to the fork.");
    if (f.thighs !== "heavy" && tr > 0.66) add("thigh_heavy", "warn", "Thigh is large for the seat but thighs are set to normal.", "Should thighs be set to heavy?");
    if (m.bottom < DEFAULTS.minBottom) add("bottom_foot", "block", `Bottom of ${m.bottom} mm is under ${DEFAULTS.minBottom} mm; the foot may not pass.`, "Confirm the bottom width, or measure heel-to-instep to check the foot passes.");
    const Kf = m.bottom + DEFAULTS.kneeOverBottom[st.leg_line || "classic"];
    if (Kf < m.knee + DEFAULTS.kneeEaseMin) add("knee_tight", "warn", `A ${st.leg_line || "classic"} leg gives a finished knee of ${Kf} mm, less than knee + ${DEFAULTS.kneeEaseMin} mm. The knee will be widened to ${m.knee + DEFAULTS.kneeEaseMin} mm.`, "Accept the wider knee, or re-check the knee measure?");
    if (m.bottom > Kf + 10) add("bottom_wide", "warn", `Bottom (${m.bottom}) is wider than the finished knee (${Kf}).`, "Is a flared leg intended?");
    const wp = m.waist_position || "natural_waist";
    if (wp !== (st.rise || "natural_waist")) add("waist_height", "block", `Waist and outside leg were taken at ${wp.replace("_", " ")}, but the style rise is ${(st.rise || "natural_waist").replace("_", " ")}.`, "Re-measure at the height the trousers will be worn, or change the rise.");
    if (f.hips && f.hips !== "level" && !(Number(f.hip_mm) > 0)) add("hip_mm", "block", "A low hip is set without an amount.", "By how many mm is the low hip lower?");
    if (st.bottoms === "turn_up" && !(Number(st.turnup_depth) > 0)) add("turnup", "block", "Turn-ups are set without a depth.", "What turn-up depth, in mm? (usually 40–45)");
    return issues;
  }
  const LABELS = { waist: "Waist", seat: "Seat", outside_leg: "Outside leg", inside_leg: "Inside leg", thigh: "Thigh", knee: "Knee", bottom: "Bottom", body_rise: "Seated body rise", front_rise: "Front rise", back_rise: "Back rise", calf: "Calf" };
  const label = (k) => LABELS[k] || k;

  // ---------- parameters ----------
  function buildParams(input, house) {
    const H = deepMerge(DEFAULTS, house || {});
    const m = input.measurements, f = input.figuration || {}, st = input.style || {}, cl = input.cloth || {};
    const adj = input.adjustments || {};
    const A = (k) => Number(adj[k] || 0);
    const notes = []; // corrections log
    const front = st.front || "flat";
    let seatEase = H.seatEase[front] ?? 40;
    if (Number(cl.weight) >= H.heavyClothGm) { seatEase -= H.heavyClothEaseCut; notes.push({ kind: "cloth", text: `Seat ease reduced ${H.heavyClothEaseCut} mm for heavy cloth (${cl.weight} g/m).` }); }
    if (Number(cl.stretch) > 0) { const c = Math.min(H.stretchEaseMaxCut, H.stretchEasePerPct * Number(cl.stretch)); seatEase -= c; notes.push({ kind: "cloth", text: `Seat ease reduced ${r1(c)} mm for ${cl.stretch}% stretch.` }); }
    seatEase += A("seatEase");
    const braces = st.waistband === "fishtail_braces" || st.braces === true;
    let waistEase = (braces ? H.waistEaseBraces : H.waistEase) + A("waistEase");
    let seatAngle = H.seatAngleDeg, backFork = m.seat / H.backForkDiv, frontFork = m.seat / H.frontForkDiv;
    let backRaise = H.backRaise, cfRaise = 0, cfInset = H.cfInset, thighAdd = 0;
    let pleats = (H.pleats[front] || []).slice();
    const corr = (text, moves) => notes.push({ kind: "figuration", text, moves });
    if (f.seat === "prominent") { seatAngle += 3; backFork += 10; backRaise += 10; corr("Prominent seat: seat angle +3°, back fork +10 mm, back waist +10 mm.", ["B_cb_waist", "B_fork"]); }
    if (f.seat === "flat") { seatAngle -= 3; backFork -= 5; backRaise -= 5; corr("Flat seat: seat angle −3°, back fork −5 mm, back waist −5 mm.", ["B_cb_waist", "B_fork"]); }
    if (f.stomach === "prominent") { cfRaise += 10; cfInset -= 10; if (pleats.length) pleats[0] += 5; corr("Prominent stomach: front waist raised 10 mm at CF, CF inset removed (+10 mm over the stomach)" + (pleats.length ? ", first pleat +5 mm." : "."), ["F_cf_waist"]); }
    if (f.stomach === "corpulent") { cfRaise += 20; cfInset -= 25; if (pleats.length) pleats[0] += 5; corr("Corpulent stomach: front waist raised 20 mm at CF, CF waist taken 15 mm beyond the seat line (+25 mm)" + (pleats.length ? ", first pleat +5 mm." : "."), ["F_cf_waist"]); }
    if (f.stance === "erect") { backRaise -= 10; cfRaise += 10; seatAngle -= 2; corr("Erect stance: back waist −10 mm, front waist +10 mm, seat angle −2°.", ["B_cb_waist", "F_cf_waist"]); }
    if (f.stance === "stooping") { backRaise += 10; cfRaise -= 10; seatAngle += 2; corr("Stooping stance: back waist +10 mm, front waist −10 mm, seat angle +2°.", ["B_cb_waist", "F_cf_waist"]); }
    let kneeShift = A("kneeShift"), hemShift = A("hemShift");
    if (f.legs === "bow") { kneeShift += 10; hemShift += 5; corr("Bow legs: knee moved 10 mm and hem 5 mm toward the side seam, crease kept on the grain.", ["F_knee_*", "B_knee_*", "F_hem_*", "B_hem_*"]); }
    if (f.legs === "knock") { kneeShift -= 10; hemShift -= 5; corr("Knock knees: knee moved 10 mm and hem 5 mm toward the inside leg, crease kept on the grain.", ["F_knee_*", "B_knee_*", "F_hem_*", "B_hem_*"]); }
    if (f.thighs === "heavy") { thighAdd += 10; frontFork += 3; backFork += 5; corr("Heavy thighs: +10 mm at the thigh on the inside leg, front fork +3 mm, back fork +5 mm.", ["F_fork", "B_fork"]); }
    seatAngle += A("seatAngleDeg"); backFork += A("backFork"); frontFork += A("frontFork");
    backRaise += A("backRaise"); cfRaise += A("frontRaise"); thighAdd += A("thighWidth");
    const wedge = A("seatWedge"); if (wedge) { backRaise -= wedge; seatAngle -= wedge / 10; }
    const OL = m.outside_leg + A("outsideLeg");
    const R = m.outside_leg - m.inside_leg;
    const ll = st.leg_line || "classic";
    let Kf = m.bottom + H.kneeOverBottom[ll];
    if (Kf < m.knee + H.kneeEaseMin) { Kf = m.knee + H.kneeEaseMin; notes.push({ kind: "system", text: `Finished knee widened to ${Kf} mm (knee + ${H.kneeEaseMin}).` }); }
    const hemDrop = H.backHemDrop[st.break || "slight"];
    const iron = H.backInsideLegShorten + A("backInsideLegShorten");
    return { H, m, f, st, cl, OL, R, seatEase, waistEase, seatAngle, backFork, frontFork, backRaise, cfRaise, cfInset, thighAdd, pleats, kneeShift, hemShift, Kf, B: m.bottom, hemDrop, iron, braces, notes, front };
  }

  // ---------- Stage 2: draft ----------
  function draftFront(P, side) {
    const pts = {}; const trace = [];
    const T = (id, rule, p) => { pts[id] = p; trace.push({ id, rule, x: r1(p.x), y: r1(p.y) }); return p; };
    const { H, m, R, OL } = P;
    const seatY = R * (1 - H.seatLineFrac);
    const kneeY = R + m.inside_leg / 2 - H.kneeRaise;
    const lowHip = side.lowHip || 0;
    const Fs = (m.seat + P.seatEase) / 4 - H.frontBackSplit;
    T("F0", "Waist level at side seam line", pt(0, 0));
    T("F_seat_side", "Seat line: rise × (1 − " + H.seatLineFrac + ")", pt(0, seatY));
    T("F_seat_cf", "Seat line + (seat + seat ease)/4 − " + H.frontBackSplit, pt(Fs, seatY));
    T("F_fork_corner", "Square down from F_seat_cf to fork line (rise = OL − IL)", pt(Fs, R));
    T("F_fork", "F_fork_corner + seat/" + H.frontForkDiv + (P.frontFork !== m.seat / H.frontForkDiv ? " (corrected)" : ""), pt(Fs + P.frontFork, R));
    T("F_fork_side", "Fork line, 5 mm in from side line", pt(5, R));
    const crease = (pts.F_fork_side.x + pts.F_fork.x) / 2;
    T("F_crease_fork", "Crease: midpoint of F_fork_side–F_fork", pt(crease, R));
    const kh = P.Kf / 4 - H.frontBackSplit / 2, hh = P.B / 4 - H.frontBackSplit / 2;
    T("F_knee_side", "Knee line (fork + IL/2 − " + H.kneeRaise + "); crease − (knee/4 − 5) − knee shift", pt(crease - kh - P.kneeShift, kneeY));
    T("F_knee_in", "Crease + (knee/4 − 5) − knee shift", pt(crease + kh - P.kneeShift, kneeY));
    T("F_hem_side", "Hem line (OL); crease − (bottom/4 − 5) − hem shift", pt(crease - hh - P.hemShift, OL));
    T("F_hem_in", "Crease + (bottom/4 − 5) − hem shift", pt(crease + hh - P.hemShift, OL));
    T("F_cf_waist", `Waist: F_seat_cf in ${P.cfInset} mm, raised ${P.cfRaise} mm`, pt(Fs - P.cfInset, -P.cfRaise));
    // waist suppression
    const wq = (m.waist + P.waistEase) / 4 - H.frontBackSplit;
    let pleats = P.pleats.slice(); let dart = 0;
    const dyW = lowHip + P.cfRaise;
    const reachF = (L) => Math.sqrt(Math.max(0, L * L - dyW * dyW));
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    let sx = pts.F_cf_waist.x - reachF(wq + sum(pleats));
    if (sx > H.sideSuppressMax) {
      const extra = sx - H.sideSuppressMax;
      if (pleats.length) { pleats[0] += Math.min(10, extra); }
      else { dart = Math.min(H.frontDartMax, extra); }
      sx = pts.F_cf_waist.x - reachF(wq + sum(pleats) + dart);
    }
    T("F_side_waist", `F_cf_waist − (waist + ease)/4 + ${H.frontBackSplit} − pleats/dart; low hip −${lowHip}`, pt(sx, lowHip));
    // curves
    const sideTop = bez(pts.F_side_waist, pt(sx * 0.55, seatY * 0.35), pt(0, seatY * 0.7), pts.F_seat_side);
    const kd = unit(pts.F_knee_side, pts.F_hem_side), kl = pts.F_knee_side.y - seatY;
    const sideMid = bez(pts.F_seat_side, pt(0, seatY + kl * 0.35), pt(pts.F_knee_side.x - kd.x * kl * 0.35, pts.F_knee_side.y - kd.y * kl * 0.35), pts.F_knee_side);
    const sideSeam = join(sideTop, sideMid, line(pts.F_knee_side, pts.F_hem_side, 8));
    const id = unit(pts.F_knee_in, pts.F_hem_in), il = kneeY - R;
    const thighY = R + 25;
    const insTop = bez(pts.F_fork, pt(pts.F_fork.x - P.frontFork * 0.25 + P.thighAdd * 0.6, R + il * 0.25), pt(pts.F_knee_in.x - id.x * il * 0.4, pts.F_knee_in.y - id.y * il * 0.4), pts.F_knee_in);
    const insideLeg = join(insTop, line(pts.F_knee_in, pts.F_hem_in, 8)); // fork → hem
    const forkCurve = bez(pts.F_seat_cf, pt(Fs, seatY + (R - seatY) * 0.55), pt(Fs + P.frontFork * 0.4, R), pts.F_fork);
    const cfLine = line(pts.F_cf_waist, pts.F_seat_cf, 6);
    const frontSeam = join(cfLine, forkCurve); // waist → fork
    const waist = line(pts.F_cf_waist, pts.F_side_waist, 12);
    const hem = line(pts.F_hem_side, pts.F_hem_in, 8);
    // outline clockwise (y down): CF waist → side waist → side seam ↓ → hem → inside leg ↑ → fork → CF
    const seams = [
      { name: "waist", pts: waist },
      { name: "side", pts: sideSeam },
      { name: "hem", pts: hem },
      { name: "inside", pts: rev(insideLeg) },
      { name: "fork", pts: rev(forkCurve) },
      { name: "cf", pts: rev(cfLine) },
    ];
    const kneeIdx = sideTop.length + sideMid.length - 2;
    const sideToKnee = plen(sideSeam.slice(0, kneeIdx + 1));
    const insideToKnee = plen(insTop);
    const marks = [];
    // pleats on the crease at the waist
    let off = 0;
    pleats.forEach((d, i) => {
      const x0 = crease - off; marks.push({ type: "pleat", x: x0, w: d, y0: waistYAt(pts, x0), len: 90 - i * 20, label: `Pleat ${i + 1}: ${r1(d)} mm` });
      off += d + 35;
    });
    if (dart) marks.push(dartMark(waist, 0.5, dart, H.frontDartLen, "Front dart"));
    const thighW = (xAtY(insTop, thighY) ?? pts.F_fork.x) - (xAtY(sideMid, thighY) ?? 0);
    return { pts, trace, seams, sideSeam, insideLeg, frontSeam, waist, hem, crease, seatY, kneeY, thighY, thighW, sideToKnee, insideToKnee, sideTotal: plen(sideSeam), pleats, dart, suppression: { side: sx, dart, pleats }, marks, seamLen: plen(frontSeam), waistLen: plen(waist) };
  }
  function waistYAt(pts, x) { const a = pts.F_cf_waist, b = pts.F_side_waist; const t = (x - a.x) / (b.x - a.x); return a.y + (b.y - a.y) * t; }
  function dartMark(waistPl, t, width, len, label) {
    const L = plen(waistPl); const c = along(waistPl, L * t);
    const n = pt(c.dir.y, -c.dir.x); // into the piece: waist runs leftward toward the side seam
    const a = along(waistPl, L * t - width / 2).p, b = along(waistPl, L * t + width / 2).p;
    const tip = pt(c.p.x + n.x * len, c.p.y + n.y * len);
    return { type: "dart", a, b, tip, label: `${label}: ${r1(width)} × ${len} mm` };
  }

  function draftBack(P, F, side, sideDy, forkDrop) {
    const pts = {}; const trace = [];
    const T = (id, rule, p) => { pts[id] = p; trace.push({ id, rule, x: r1(p.x), y: r1(p.y) }); return p; };
    const { H, m, R, OL } = P; const seatY = F.seatY, kneeY = F.kneeY;
    const t = Math.tan(P.seatAngle * Math.PI / 180);
    const Bs = (m.seat + P.seatEase) / 4 + H.frontBackSplit;
    const Rb = R + forkDrop; const lowHip = side.lowHip || 0;
    const cbX = (y) => Bs + (y - seatY) * t;
    T("B_seat_side", "Seat line, side seam line", pt(0, seatY));
    T("B_seat_cb", "Seat line + (seat + seat ease)/4 + " + H.frontBackSplit, pt(Bs, seatY));
    T("B_cb_fork", `Seat angle ${r1(P.seatAngle)}° through B_seat_cb to back fork line (front fork line + ${r1(forkDrop)})`, pt(cbX(Rb), Rb));
    T("B_fork", "B_cb_fork + seat/" + H.backForkDiv + (Math.abs(P.backFork - m.seat / H.backForkDiv) > 0.01 ? " (corrected)" : ""), pt(cbX(Rb) + P.backFork, Rb));
    T("B_fork_side", "Back fork line, 5 mm in from side line", pt(5, Rb));
    const crease = (pts.B_fork_side.x + pts.B_fork.x) / 2;
    T("B_crease_fork", "Crease: midpoint of B_fork_side–B_fork", pt(crease, Rb));
    const kh = P.Kf / 4 + H.frontBackSplit / 2, hh = P.B / 4 + H.frontBackSplit / 2;
    const hemY = OL + P.hemDrop;
    T("B_knee_side", "Knee line; crease − (knee/4 + 5) − knee shift", pt(crease - kh - P.kneeShift, kneeY));
    T("B_knee_in", "Crease + (knee/4 + 5) − knee shift", pt(crease + kh - P.kneeShift, kneeY));
    T("B_hem_side", `Hem line + back drop ${P.hemDrop} mm; crease − (bottom/4 + 5) − hem shift`, pt(crease - hh - P.hemShift, hemY));
    T("B_hem_in", "Crease + (bottom/4 + 5) − hem shift", pt(crease + hh - P.hemShift, hemY));
    const cbWy = -P.backRaise;
    T("B_cb_waist", `Seat-angle line up to ${r1(P.backRaise)} mm above waist level`, pt(cbX(cbWy), cbWy));
    const wq = (m.waist + P.waistEase) / 4 + H.frontBackSplit;
    // horizontal reach of the waist from CB with no suppression
    const sideY = sideDy + lowHip;
    const reach = (L) => Math.sqrt(Math.max(0, L * L - (sideY - cbWy) ** 2));
    let sxNoDart = pts.B_cb_waist.x - reach(wq);
    let sx = sxNoDart, darts = [];
    if (sxNoDart > H.sideSuppressMax) {
      let extra = sxNoDart - H.sideSuppressMax;
      const n = extra > H.dartMax ? 2 : 1;
      const each = Math.min(H.dartMax, extra / n);
      darts = Array(n).fill(each);
      sx = pts.B_cb_waist.x - reach(wq + each * n);
    }
    T("B_side_waist", `B_cb_waist − ((waist + ease)/4 + ${H.frontBackSplit} + darts); side seam matched to front` + (lowHip ? `; low hip −${lowHip}` : ""), pt(sx, sideY));
    let fishtail = null;
    if (P.st.waistband === "fishtail_braces") {
      T("B_fishtail", `CB raised ${H.fishtailRise} mm above back waist for fishtail`, pt(pts.B_cb_waist.x - H.fishtailRise * t, cbWy - H.fishtailRise));
    }
    const sideTop = bez(pts.B_side_waist, pt(sx * 0.55, sideY + (seatY - sideY) * 0.35), pt(0, seatY * 0.7), pts.B_seat_side);
    const kd = unit(pts.B_knee_side, pts.B_hem_side), kl = kneeY - seatY;
    const sideMid = bez(pts.B_seat_side, pt(0, seatY + kl * 0.35), pt(pts.B_knee_side.x - kd.x * kl * 0.35, pts.B_knee_side.y - kd.y * kl * 0.35), pts.B_knee_side);
    const sideSeam = join(sideTop, sideMid, line(pts.B_knee_side, pts.B_hem_side, 8));
    const id = unit(pts.B_knee_in, pts.B_hem_in), il = kneeY - Rb;
    const insTop = bez(pts.B_fork, pt(pts.B_fork.x - P.backFork * 0.3 + P.thighAdd * 0.4, Rb + il * 0.25), pt(pts.B_knee_in.x - id.x * il * 0.4, pts.B_knee_in.y - id.y * il * 0.4), pts.B_knee_in);
    const insideLeg = join(insTop, line(pts.B_knee_in, pts.B_hem_in, 8));
    const forkCurve = bez(pts.B_seat_cb, pt(cbX(seatY + (Rb - seatY) * 0.6), seatY + (Rb - seatY) * 0.6), pt(pts.B_fork.x - P.backFork * 0.55, Rb), pts.B_fork);
    const cbTop = pts.B_fishtail || pts.B_cb_waist;
    const cbLine = line(cbTop, pts.B_seat_cb, 6);
    const backSeam = join(line(pts.B_cb_waist, pts.B_seat_cb, 6), forkCurve);
    let waist;
    if (pts.B_fishtail) {
      const mid = pt(pts.B_cb_waist.x - reach(wq) * 0.45, cbWy * 0.6 + sideY * 0.4);
      waist = join(bez(pts.B_fishtail, pt(pts.B_fishtail.x - 30, pts.B_fishtail.y + 5), pt(mid.x + 40, mid.y - 10), mid, 16), line(mid, pts.B_side_waist, 8));
    } else waist = line(pts.B_cb_waist, pts.B_side_waist, 12);
    const hem = line(pts.B_hem_side, pts.B_hem_in, 8);
    // clockwise for a back drawn with side seam on the left and fork on the right:
    // CB top → waist → side ↓ → hem → inside ↑ → fork → CB
    const seams = [
      { name: "waist", pts: waist },
      { name: "side", pts: sideSeam },
      { name: "hem", pts: hem },
      { name: "inside", pts: rev(insideLeg) },
      { name: "fork", pts: rev(forkCurve) },
      { name: "cb", pts: rev(cbLine) },
    ];
    const kneeIdx = sideTop.length + sideMid.length - 2;
    const marks = [];
    const wl = line(pts.B_cb_waist, pts.B_side_waist, 40);
    if (darts.length === 1) marks.push(dartMark(wl, 0.45, darts[0], H.backDartLen[0], "Back dart"));
    if (darts.length === 2) { marks.push(dartMark(wl, 0.33, darts[0], H.backDartLen[0], "Back dart 1")); marks.push(dartMark(wl, 0.62, darts[1], H.backDartLen[1], "Back dart 2")); }
    const thighY = Rb + 25;
    const thighW = (xAtY(insTop, thighY) ?? pts.B_fork.x) - (xAtY(sideMid, thighY) ?? 0);
    return { pts, trace, seams, sideSeam, insideLeg, backSeam, waist, hem, crease, seatY, kneeY, thighW, Rb,
      sideToKnee: plen(sideSeam.slice(0, kneeIdx + 1)), insideToKnee: plen(insTop), sideTotal: plen(sideSeam),
      darts, suppression: { side: sx, darts }, marks, seamLen: plen(backSeam), waistLen: plen(line(pts.B_cb_waist, pts.B_side_waist)), cbWy };
  }

  function draftSide(P, side) {
    const F = draftFront(P, side);
    let sideDy = 0, forkDrop = P.iron, B;
    for (let i = 0; i < 6; i++) {
      B = draftBack(P, F, side, sideDy, forkDrop);
      const dSide = B.sideToKnee - F.sideToKnee;
      const dIns = B.insideToKnee - (F.insideToKnee - P.iron);
      if (Math.abs(dSide) < 0.2 && Math.abs(dIns) < 0.2) break;
      sideDy += dSide; forkDrop += dIns;
    }
    return { F, B, sideDy, forkDrop };
  }

  function draft(input, house) {
    const issues = validate(input);
    const confirmed = new Set(input.confirmed || []);
    const blocking = issues.filter((i) => i.severity === "block" && !confirmed.has(i.id));
    if (blocking.length) return { status: "needs_clarification", engine: ENGINE_VERSION, issues, questions: blocking.map((b, i) => `${i + 1}. ${b.question}`) };
    const P = buildParams(input, house);
    const f = P.f; const asym = f.hips && f.hips !== "level" && Number(f.hip_mm) > 0;
    const sides = asym ? [
      { key: "left", lowHip: f.hips === "left_low" ? Number(f.hip_mm) : 0 },
      { key: "right", lowHip: f.hips === "right_low" ? Number(f.hip_mm) : 0 },
    ] : [{ key: "pair", lowHip: 0 }];
    if (asym) P.notes.push({ kind: "figuration", text: `Low ${f.hips === "left_low" ? "left" : "right"} hip: side waist on that side lowered ${f.hip_mm} mm (shorter outside leg from the waist); left and right drafted as separate pieces.`, moves: ["F_side_waist", "B_side_waist"] });
    const drafts = sides.map((s) => ({ side: s, ...draftSide(P, s) }));
    const main = drafts[0];
    const checks = runChecks(P, main);
    const pieces = buildPieces(P, drafts);
    scalePieces(pieces, P);
    const ironwork = ironworkFor(P, main);
    const cutting = cuttingList(P, pieces, asym);
    const fitting = fittingChecklist(P, main);
    const spec = {
      status: "ok", engine: ENGINE_VERSION,
      issues, corrections: P.notes, checks, ironwork, cutting, fitting,
      params: { seat_ease: r1(P.seatEase), waist_ease: r1(P.waistEase), seat_angle_deg: r1(P.seatAngle), front_fork: r1(P.frontFork), back_fork: r1(P.backFork), back_raise: r1(P.backRaise), front_raise: r1(P.cfRaise), body_rise: r1(P.R), finished_knee: r1(P.Kf), back_hem_drop: P.hemDrop, back_fork_drop: r1(main.forkDrop), back_inside_leg_iron: r1(P.iron) },
      suppression: { front: main.F.suppression, back: main.B.suppression },
      points: { front: main.F.trace, back: main.B.trace },
      measures: { front_seam: r1(main.F.seamLen), back_seam: r1(main.B.seamLen), crotch: r1(main.F.seamLen + main.B.seamLen), front_side_to_knee: r1(main.F.sideToKnee), back_side_to_knee: r1(main.B.sideToKnee), front_inside_to_knee: r1(main.F.insideToKnee), back_inside_to_knee: r1(main.B.insideToKnee) },
      pieces,
    };
    spec.note = cuttersNote(P, spec, main);
    return spec;
  }

  function runChecks(P, d) {
    const { F, B } = d; const m = P.m; const out = [];
    const C = (name, pass, detail) => out.push({ name, pass, detail });
    C("Side seams equal, waist to knee", Math.abs(F.sideToKnee - B.sideToKnee) < 1, `front ${r1(F.sideToKnee)} / back ${r1(B.sideToKnee)} mm`);
    const fk = F.sideTotal - F.sideToKnee, bk = B.sideTotal - B.sideToKnee;
    C("Side seams, knee to hem (less back drop)", Math.abs(bk - fk - P.hemDrop) < 3, `front ${r1(fk)} / back ${r1(bk)} mm, drop ${P.hemDrop}`);
    C("Inside legs differ by ironwork only", Math.abs(F.insideToKnee - B.insideToKnee - P.iron) < 1, `front ${r1(F.insideToKnee)} / back ${r1(B.insideToKnee)} mm, iron ${r1(P.iron)}`);
    const seatNet = (F.pts.F_seat_cf.x - F.pts.F_seat_side.x) + (B.pts.B_seat_cb.x - B.pts.B_seat_side.x);
    C("Net seat × 2 = seat + ease", Math.abs(seatNet * 2 - (m.seat + P.seatEase)) < 1, `${r1(seatNet * 2)} vs ${r1(m.seat + P.seatEase)} mm`);
    const fW = F.waistLen - F.pleats.reduce((a, b) => a + b, 0) - F.dart, bW = B.waistLen - B.darts.reduce((a, b) => a + b, 0);
    C("Net waist × 2 = waist + ease", Math.abs((fW + bW) * 2 - (m.waist + P.waistEase)) < 6, `${r1((fW + bW) * 2)} vs ${r1(m.waist + P.waistEase)} mm (straight-line)`);
    const thigh = (F.thighW + B.thighW) - m.thigh;
    C("Thigh ease", thigh >= P.H.thighEaseMin, `${r1(thigh)} mm over thigh (min ${P.H.thighEaseMin})`);
    if (m.front_rise > 0 && m.back_rise > 0) {
      const target = m.front_rise + m.back_rise + P.H.crotchEase; const got = F.seamLen + B.seamLen;
      C("Crotch length vs through-leg rise", Math.abs(got - target) <= P.H.crotchTol, `drafted ${r1(got)} vs measured ${m.front_rise + m.back_rise} + ${P.H.crotchEase} ease = ${target} mm`);
    }
    C("Back seam leaves room at the fork", B.pts.B_fork.y >= F.pts.F_fork.y, `back fork ${r1(B.Rb - P.R)} mm below front fork line`);
    return out;
  }

  // ---------- pieces (net + cut lines, marks) ----------
  function allowFn(P, seam, piece) {
    const I = P.H.inlay;
    const hem = P.st.bottoms === "turn_up" ? Number(P.st.turnup_depth) * 2 + I.hemTurnupExtra : I.hemPlain;
    switch (seam) {
      case "side": return () => I.side;
      case "inside": return () => I.inside;
      case "hem": return () => hem;
      case "waist": return () => I.other;
      case "fork": return () => I.other;
      case "cf": return () => I.other;
      case "cb": return (t) => I.other + (I.backSeamWaist - I.other) * (1 - t); // runs fork→waist reversed? see below
      default: return () => I.other;
    }
  }

  function legPiece(P, D, kind, side, asym) {
    const isF = kind === "front"; const d = isF ? D.F : D.B;
    const seams = d.seams.map((s) => {
      let allow = allowFn(P, s.name);
      if (s.name === "cb") allow = (t) => P.H.inlay.backSeamWaist - (P.H.inlay.backSeamWaist - P.H.inlay.other) * (1 - t) ; // t: seat→CB top, so 10 at seat rising to 40 at waist
      if (s.name === "fork" && !isF) allow = () => P.H.inlay.other; // inlay tapered to nil (SA only) through the fork
      return { name: s.name, pts: s.pts, allow };
    });
    // CB seam runs seat → waist in the outline (rev of waist→seat)? It is rev(cbLine) = seat → top, so t=0 at seat.
    const net = join(...seams.map((s) => s.pts));
    const cut = offsetOutline(seams);
    const P0 = d.pts;
    const k = isF ? "F" : "B";
    const marks = d.marks.slice();
    const notch = (p, dir, label) => marks.push({ type: "notch", p, dir, label });
    notch(P0[k + "_knee_side"], -1, "knee"); notch(P0[k + "_knee_in"], 1, "knee");
    notch(isF ? P0.F_seat_side : P0.B_seat_side, -1, "seat");
    marks.push({ type: "grain", x: d.crease, y0: (isF ? 40 : 60), y1: P.OL - 80, label: "Crease / straight grain" });
    marks.push({ type: "line", a: pt(d.crease - 60, d.kneeY), b: pt(d.crease + 60, d.kneeY), label: "Knee line" });
    marks.push({ type: "line", a: pt(d.crease - 60, d.seatY), b: pt(d.crease + 60, d.seatY), label: "Seat line" });
    if (isF && P.st.side_pockets === "on_seam") { notch(along(d.sideSeam, 40).p, -1, "pocket"); notch(along(d.sideSeam, 40 + P.H.sidePocketOpening).p, -1, "pocket"); }
    if (isF && P.st.side_pockets === "cross") {
      const a = along(d.waist, d.waistLen - 40).p, b = along(d.sideSeam, P.H.sidePocketOpening).p;
      marks.push({ type: "line", a, b, label: "Cross pocket" });
    }
    if (isF) { const fl = along(d.frontSeam, P.H.flyLength).p; notch(fl, 1, "fly end"); }
    if (!isF && Number(P.st.hip_pockets) > 0) {
      const wl = line(P0.B_cb_waist, P0.B_side_waist, 40);
      const c = along(wl, plen(wl) * 0.48);
      const n = pt(c.dir.y, -c.dir.x);
      const mid = pt(c.p.x + n.x * P.H.hipPocketDrop, c.p.y + n.y * P.H.hipPocketDrop);
      const half = P.H.hipPocketOpening / 2;
      marks.push({ type: "line", a: pt(mid.x - c.dir.x * half, mid.y - c.dir.y * half), b: pt(mid.x + c.dir.x * half, mid.y + c.dir.y * half), label: `Hip pocket ${P.H.hipPocketOpening} mm, jetted${P.st.hip_pocket_button ? ", button" : ""}` });
    }
    const count = asym ? `Cut 1 ${side}` : "Cut 1 pair";
    const name = (isF ? "Front" : "Back") + (asym ? ` (${side})` : "");
    return { id: (isF ? "front" : "back") + (asym ? "_" + side : ""), name, material: "cloth", count, net, cut, marks, seamNames: seams.map((s) => s.name) };
  }

  function rectPiece(id, name, material, count, w, h, opts = {}) {
    const net = opts.shape || [pt(0, 0), pt(w, 0), pt(w, h), pt(0, h)];
    const a = opts.allow ?? 10;
    const segs = []; for (let i = 0; i < net.length; i++) segs.push({ name: "e" + i, pts: [net[i], net[(i + 1) % net.length]], allow: () => (Array.isArray(a) ? a[i] : a) });
    const cut = offsetOutline(segs);
    const marks = [{ type: "grain", x: w / 2, y0: h * 0.15, y1: h * 0.85, label: opts.grainLabel || "Straight grain" }].concat(opts.marks || []);
    return { id, name, material, count, net: net.concat([net[0]]), cut, marks };
  }

  function buildPieces(P, drafts) {
    const asym = drafts.length > 1; const out = [];
    drafts.forEach((D) => { out.push(legPiece(P, D, "front", D.side.key, asym)); out.push(legPiece(P, D, "back", D.side.key, asym)); });
    const D = drafts[0];
    const H = P.H, wb = H.waistbandHeight;
    const fish = P.st.waistband === "fishtail_braces";
    const halfWaist = D.F.waistLen + (fish ? 0 : D.B.waistLen);
    const ends = H.inlay.waistbandEnds;
    // waistband halves: allowances top/bottom 10, CB end inlay, fly end 10
    out.push(rectPiece("waistband_left", "Waistband, left (button side)", "cloth", "Cut 1", halfWaist + H.flyExtension, wb, { allow: [10, fish ? 10 : ends, 10, 10], grainLabel: "Grain along length", marks: [] }));
    out.push(rectPiece("waistband_right", "Waistband, right", "cloth", "Cut 1", halfWaist + H.flyExtension, wb, { allow: [10, fish ? 10 : ends, 10, 10], grainLabel: "Grain along length" }));
    out.push(rectPiece("curtain", "Curtain (waistband lining)", "curtain", "Cut 2", halfWaist + H.flyExtension, wb + 15, { allow: 10, grainLabel: "Bias or straight, per curtain" }));
    // fly facing with curved bottom
    const fl = H.flyLength, fw = 45;
    const flyShape = [pt(0, 0), pt(fw, 0), ...bez(pt(fw, fl - 40), pt(fw, fl - 10), pt(fw - 15, fl), pt(5, fl), 10), pt(0, fl)];
    out.push(rectPiece("fly_facing", "Fly facing (left)", "cloth", "Cut 1", fw, fl, { shape: flyShape, allow: 10 }));
    out.push(rectPiece("fly_shield", "Fly shield (right), on the fold", "cloth", "Cut 1, fold", 100, fl + 15, { allow: [10, 10, 10, 0], grainLabel: "Fold edge on straight grain" }));
    if (fish) out.push(rectPiece("fishtail_facing", "Fishtail facing", "cloth", "Cut 1 pair", 140, 90, { allow: 10 }));
    if (P.st.waistband === "side_adjusters") out.push(rectPiece("adjuster_tab", "Side adjuster tabs", "cloth", "Cut 4", 90, 35, { allow: 8 }));
    if (P.st.waistband === "belt_loops") out.push(rectPiece("belt_loop_strip", "Belt loop strip", "cloth", "Cut 1", 600, 36, { allow: 0, grainLabel: "Straight grain" }));
    if (P.st.side_pockets && P.st.side_pockets !== "none") {
      out.push(rectPiece("side_pocket_facing", "Side pocket facing", "cloth", "Cut 1 pair", 60, H.sidePocketOpening + 60, { allow: 10 }));
      const bw = 180, bh = H.sidePocketOpening + 180;
      const bag = [pt(0, 0), pt(bw, 0), pt(bw, bh - 50), ...bez(pt(bw, bh - 50), pt(bw, bh), pt(bw - 50, bh), pt(bw / 2, bh), 8).slice(1), ...bez(pt(bw / 2, bh), pt(40, bh), pt(0, bh - 30), pt(0, bh - 70), 8).slice(1)];
      out.push(rectPiece("side_pocket_bag", "Side pocket bag", "pocketing", "Cut 2 pair", bw, bh, { shape: bag, allow: 10 }));
    }
    const hp = Number(P.st.hip_pockets) || 0;
    if (hp > 0) {
      out.push(rectPiece("hip_pocket_bag", "Hip pocket bag (folded)", "pocketing", `Cut ${hp}`, H.hipPocketOpening + 40, 300, { allow: 10 }));
      out.push(rectPiece("hip_pocket_jets", "Hip pocket jets", "cloth", `Cut ${hp * 2}`, H.hipPocketOpening + 30, 40, { allow: 0 }));
      out.push(rectPiece("hip_pocket_facing", "Hip pocket facing", "cloth", `Cut ${hp}`, H.hipPocketOpening + 30, 60, { allow: 0 }));
      if (P.st.hip_pocket_button) out.push(rectPiece("hip_pocket_tab", "Button tab", "cloth", `Cut ${hp * 2}`, 30, 50, { allow: 8 }));
    }
    return out;
  }

  function scalePieces(pieces, P) {
    const sl = Number(P.cl.shrinkage_length) || 0, sw = Number(P.cl.shrinkage_width) || 0;
    if (!sl && !sw) return;
    const kx = 1 + sw / 100, ky = 1 + sl / 100;
    const S = (p) => pt(p.x * kx, p.y * ky);
    pieces.forEach((pc) => {
      pc.net = pc.net.map(S); pc.cut = pc.cut.map(S);
      pc.marks = pc.marks.map((mk) => {
        const o = { ...mk };
        ["p", "a", "b", "tip"].forEach((k) => { if (o[k]) o[k] = S(o[k]); });
        if (o.x != null) o.x *= kx; if (o.y0 != null) o.y0 *= ky; if (o.y1 != null) o.y1 *= ky; if (o.w != null) o.w *= kx;
        return o;
      });
    });
    P.notes.push({ kind: "cloth", text: `Pattern scaled for known shrinkage: +${sl}% length, +${sw}% width.` });
  }

  function ironworkFor(P, d) {
    const items = [];
    items.push({ where: "Back inside leg, fork to knee", action: "stretch", mm: r1(P.iron), text: `Stretch the back inside leg ${r1(P.iron)} mm between 50 mm below the fork and the knee, so it matches the front.` });
    items.push({ where: "Back, under the seat", action: "shrink", mm: 6, text: "Shrink away about 6 mm of fullness at the side seam just below the seat line, and draw the seat round." });
    items.push({ where: "Back seam, seat", action: "stretch", mm: 5, text: "Stretch the back seam 5 mm across the seat line to give room over the seat." });
    items.push({ where: "Front inside leg, knee hollow", action: "shrink", mm: 3, text: "Shrink 3 mm out of the front inside leg at the knee hollow." });
    if (P.f.seat === "prominent") items.push({ where: "Back seam, seat", action: "stretch", mm: 5, text: "Prominent seat: stretch a further 5 mm across the seat on the back seam." });
    return items;
  }

  function cuttingList(P, pieces, asym) {
    return pieces.map((p) => ({ piece: p.name, material: p.material, count: p.count }));
  }

  function fittingChecklist(P, d) {
    const L = [
      "Balance: side seam hangs plumb from the hip to the shoe; front and back creases fall straight.",
      `Seat: ease feels right standing and seated (${r1(P.seatEase)} mm drafted); no folds under the seat, no strain to the fork.`,
      "Fork: no whiskers at the front fork; back fork does not drag when walking.",
      `Back waist: does not pull down when seated (back raised ${r1(P.backRaise)} mm).`,
      `Waist: ${r1(P.waistEase)} mm ease; check with ${P.braces ? "braces adjusted" : "no braces"}.`,
      `Length and break: ${P.st.break || "slight"} break; back drop ${P.hemDrop} mm sits on the heel.`,
    ];
    if (P.pleats.length) L.push("Pleats hang closed when standing; open only slightly when seated.");
    if (P.f.hips && P.f.hips !== "level") L.push("Low hip: both side seams plumb; waistband level.");
    if (P.f.legs && P.f.legs !== "straight") L.push("Leg line: crease hangs straight over the knee and onto the shoe.");
    return L;
  }

  function cuttersNote(P, spec, d) {
    const st = P.st; const front = (st.front || "flat").replace(/_/g, " ");
    const s = [];
    s.push(`Natural-waist proportional draft from a ${P.m.seat} mm seat: body rise ${r1(P.R)} mm, seat ease ${r1(P.seatEase)} mm (${front}), seat angle ${r1(P.seatAngle)}°, front fork ${r1(P.frontFork)} mm, back fork ${r1(P.backFork)} mm.`);
    const fs = spec.suppression.front, bs = spec.suppression.back;
    s.push(`Waist suppression: front side ${r1(fs.side)} mm${fs.pleats.length ? ", pleats " + fs.pleats.map(r1).join(" + ") + " mm" : ""}${fs.dart ? ", dart " + r1(fs.dart) + " mm" : ""}; back side ${r1(bs.side)} mm${bs.darts.length ? ", " + bs.darts.length + " dart" + (bs.darts.length > 1 ? "s" : "") + " of " + r1(bs.darts[0]) + " mm" : ""}.`);
    const fig = P.notes.filter((n) => n.kind === "figuration");
    if (fig.length) s.push("Figuration: " + fig.map((n) => n.text).join(" "));
    s.push(`Back fork set ${r1(d.forkDrop)} mm below the front fork line so the back inside leg is ${r1(P.iron)} mm shorter to the knee; stretch to match.`);
    s.push("First draft is for a baste fitting; inlays are generous at the back seam (40 mm at waist) and side seams (20 mm).");
    return s.join("\n\n");
  }

  function deepMerge(a, b) {
    const o = Array.isArray(a) ? a.slice() : { ...a };
    for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") o[k] = deepMerge(a[k], b[k]); else if (b[k] !== undefined && b[k] !== null && b[k] !== "") o[k] = b[k]; }
    return o;
  }

  function bbox(pl) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; pl.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; }

  // Shelf-pack pieces onto a sheet of given width (mm). Returns placements.
  function layout(pieces, sheetW, gap = 20, top = 130) {
    const items = pieces.map((p) => ({ p, b: bbox(p.cut) })).sort((a, b) => b.b.h - a.b.h);
    const placed = []; let x = gap, y = top, rowH = 0;
    items.forEach((it) => {
      if (x + it.b.w + gap > sheetW && x > gap) { x = gap; y += rowH + gap + 20; rowH = 0; }
      placed.push({ piece: it.p, dx: x - it.b.x0, dy: y - it.b.y0 + 20, b: it.b });
      x += it.b.w + gap; rowH = Math.max(rowH, it.b.h);
    });
    return { placed, width: sheetW, height: y + rowH + gap + 20 };
  }

  const api = { ENGINE_VERSION, DEFAULTS, FAULTS, ADJ_PARAMS, REQUIRED, LABELS, validate, draft, layout, bbox, deepMerge };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Cutter = api;
})(typeof window !== "undefined" ? window : globalThis);
