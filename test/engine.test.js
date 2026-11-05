// Drafting engine, fitting guide and 3D model: pure functions, no browser needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/engine.js");
const { GUIDE } = require("../src/fitting-guide.js");
require("../src/viewer3d.js");
const T3 = globalThis.Trouser3D;

const base = () => ({
  measurements: { waist: 860, seat: 1020, outside_leg: 1080, inside_leg: 800, thigh: 600, knee: 410, bottom: 420, front_rise: 300, back_rise: 390, waist_position: "natural_waist" },
  figuration: { seat: "normal", stomach: "normal", stance: "normal", hips: "level", legs: "straight", thighs: "normal" },
  style: { rise: "natural_waist", front: "single_forward_pleat", waistband: "side_adjusters", side_pockets: "on_seam", hip_pockets: "2", bottoms: "turn_up", turnup_depth: 45, break: "slight", leg_line: "classic" },
  cloth: { weight: 320 }, adjustments: {}, confirmed: [],
});

test("a normal figure drafts and every check passes", () => {
  const s = C.draft(base());
  assert.equal(s.status, "ok");
  for (const c of s.checks) assert.ok(c.pass, `${c.name}: ${c.detail}`);
});

test("the draft is deterministic", () => {
  assert.deepEqual(JSON.stringify(C.draft(base())), JSON.stringify(C.draft(base())));
});

test("missing measures stop the draft with questions", () => {
  const i = base(); delete i.measurements.knee;
  const s = C.draft(i);
  assert.equal(s.status, "needs_clarification");
  assert.match(s.questions[0], /knee/i);
});

test("a confirmed conflict lets the draft proceed", () => {
  const i = base(); i.measurements.body_rise = 230;
  assert.equal(C.draft(i).status, "needs_clarification");
  i.confirmed = ["rise_mismatch"];
  assert.equal(C.draft(i).status, "ok");
});

test("figuration combinations draft with core checks passing", () => {
  const combos = [
    [{ seat: "prominent", stomach: "corpulent", stance: "erect", hips: "left_low", hip_mm: 12, legs: "bow", thighs: "heavy" }, 1020],
    [{ seat: "flat", stomach: "flat", stance: "stooping", hips: "right_low", hip_mm: 8, legs: "knock", thighs: "normal" }, 900],
  ];
  for (const [fig, waist] of combos) {
    const i = base(); i.figuration = fig; i.measurements.waist = waist; i.measurements.seat = 1080;
    const s = C.draft(i);
    assert.equal(s.status, "ok", JSON.stringify(s.questions));
    for (const name of ["Side seams equal, waist to knee", "Inside legs differ by ironwork only", "Net seat × 2 = seat + ease"]) assert.ok(s.checks.find((c) => c.name === name).pass, name);
    assert.ok(s.pieces.some((p) => p.id === "front_left") && s.pieces.some((p) => p.id === "back_right"), "low hip drafts left and right");
  }
});

test("fitting adjustments change the draft in the right direction", () => {
  const a = C.draft(base());
  const i = base(); i.adjustments = { backFork: 8, seatAngleDeg: -1 };
  const b = C.draft(i);
  assert.ok(Math.abs(b.params.back_fork - a.params.back_fork - 8) < 0.11);
  assert.ok(Math.abs(b.params.seat_angle_deg - a.params.seat_angle_deg + 1) < 0.11);
});

test("every fitting guide correction uses a known parameter", () => {
  let n = 0;
  for (const area of GUIDE) for (const s of area.symptoms) {
    const results = s.result ? [s.result] : s.ask.options.map((o) => o.result);
    for (const r of results) { assert.ok(r.cause); for (const d of r.deltas) { assert.ok(C.ADJ_PARAMS[d.param], `${s.id}: ${d.param}`); assert.ok(Number.isFinite(d.value)); n++; } }
  }
  assert.ok(n > 10);
});

test("the 3D model lofts with finite geometry and seams meet at the centre line", () => {
  for (const style of [{}, { waistband: "fishtail_braces", front: "double_forward_pleat" }]) {
    const i = base(); Object.assign(i.style, style);
    const s = C.draft(i); const M = T3.legModel(s, i, "pair");
    assert.ok(M.rows.length > 50);
    for (let r = 0; r < M.rows.length; r++) for (let j = 0; j <= 64; j += 8) assert.ok(M.V(r, j).every(Number.isFinite));
    assert.equal(M.V(0, 0)[0], 0, "CB at x = 0");
    assert.equal(M.V(0, 64)[0], 0, "CF at x = 0");
  }
});
