/*
 * ÉlecLab — part GEOMETRY (pure, no JSX).
 * Position and orientation of each component's pins (pinsOf), chip
 * dimensions (chipDims), rotation (rot90/ORIENT) and the pin map (buildPinMap).
 * Used for rendering and wiring. Only dependency: BUS_W (bus width) from the engine.
 */
import { BUS_W } from "./engine.js";

const PIN = 40;
const SPDT_SP = 26;
const rot90 = (p, a) => { let x = p[0], y = p[1]; for (let i = 0; i < (((a % 4) + 4) % 4); i++) { const nx = -y, ny = x; x = nx; y = ny; } return [x, y]; };
const ORIENT = [[[PIN, 0], [-PIN, 0]], [[0, PIN], [0, -PIN]], [[-PIN, 0], [PIN, 0]], [[0, -PIN], [0, PIN]]];
function chipDims(c) {
  const ports = (c.def && c.def.ports) || [];
  const idx = ports.map((p, i) => ({ i, side: p.side }));
  const L = idx.filter((x) => x.side !== "R"), R = idx.filter((x) => x.side === "R");
  const rows = Math.max(L.length, R.length, 1);
  const hh = Math.max(26, rows * 13 + 4);
  const nameW = ((c.name || "Bloc").length) * 5.4 + 20;
  const hw = Math.max(30, Math.min(62, nameW / 2));
  const yFor = (k, n) => (n <= 1 ? 0 : (k - (n - 1) / 2) * Math.min(26, (2 * hh - 12) / Math.max(n - 1, 1)));
  return { L, R, hw, hh, yFor, ports };
}
function pinsOf(c) {
  const a = (((c.orient || 0) % 4) + 4) % 4; const o = ORIENT[a];
  if (c.type === "ground") return [{ x: c.x + o[0][0], y: c.y + o[0][1], id: c.id + ":0" }];
  if (c.type === "probe") return [{ x: c.x + o[0][0], y: c.y + o[0][1], id: c.id + ":0" }];
  if (c.type === "breadboard") return [];
  if (c.type === "arduino") {
    const P = 18, HH = 30;
    const top = ["d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10", "d11", "d12", "d13"];
    const bot = ["a0", "a1", "a2", "a3", "a4", "a5", "5v", "gnd"];
    const pts = [];
    top.forEach((nm, i) => { const r = rot90([(i - (top.length - 1) / 2) * P, -HH], a); pts.push({ x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + nm }); });
    bot.forEach((nm, i) => { const r = rot90([(i - (bot.length - 1) / 2) * P, HH], a); pts.push({ x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + nm }); });
    return pts;
  }
  if (c.type === "chip") {
    const { L, R, hw, hh, yFor } = chipDims(c); const pts = [];
    L.forEach((x, k) => { const r = rot90([-hw, yFor(k, L.length)], a); pts.push({ x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + x.i }); });
    R.forEach((x, k) => { const r = rot90([hw, yFor(k, R.length)], a); pts.push({ x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + x.i }); });
    return pts;
  }
  if (c.type === "spdt") {
    const base = [[-PIN, 0], [PIN, -SPDT_SP], [PIN, SPDT_SP]];
    return base.map((p, i) => { const r = rot90(p, a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + i }; });
  }
  if (c.type === "npn" || c.type === "nmos" || c.type === "pmos") {
    const base = [[24, -PIN], [-PIN, 0], [24, PIN]];
    return base.map((p, i) => { const r = rot90(p, a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + i }; });
  }
  if (c.type === "opamp") {
    const base = [[-PIN, -14], [-PIN, 14], [PIN, 0]];
    return base.map((p, i) => { const r = rot90(p, a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + i }; });
  }
  if (c.type === "and" || c.type === "or" || c.type === "nand" || c.type === "nor" || c.type === "xor" || c.type === "xnor" || c.type === "srlatch") {
    const base = [[-PIN, -14], [-PIN, 14], [PIN, 0]];
    return base.map((p, i) => { const r = rot90(p, a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + i }; });
  }
  if (c.type === "and3" || c.type === "or3") {
    const base = [[-PIN, -16], [-PIN, 16], [PIN, 0], [-PIN, 0]];
    return base.map((p, i) => { const r = rot90(p, a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + i }; });
  }
  if (c.type === "not") {
    const base = [[-PIN, 0], [PIN, 0]];
    return base.map((p, i) => { const r = rot90(p, a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + i }; });
  }
  if (c.type === "in" || c.type === "high" || c.type === "low" || c.type === "clock") {
    const r = rot90([PIN, 0], a); return [{ x: c.x + r[0], y: c.y + r[1], id: c.id + ":0" }];
  }
  if (c.type === "out") {
    const r = rot90([-PIN, 0], a); return [{ x: c.x + r[0], y: c.y + r[1], id: c.id + ":0" }];
  }
  if (c.type === "seg7") {
    const base = [[-PIN, -21], [-PIN, -7], [-PIN, 7], [-PIN, 21]];
    return base.map((p, i) => { const r = rot90(p, a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + i }; });
  }
  if (c.type === "busin") { const W = c.width || BUS_W; const r = rot90([PIN, 0], a); return [{ x: c.x + r[0], y: c.y + r[1], id: c.id + "#out", bus: W }]; }
  if (c.type === "busout") { const W = c.width || BUS_W; const r = rot90([-PIN, 0], a); return [{ x: c.x + r[0], y: c.y + r[1], id: c.id + "#in", bus: W }]; }
  if (c.type === "reg4") { const W = c.width || BUS_W; const ri = rot90([-PIN, 0], a), ro = rot90([PIN, 0], a), rw = rot90([0, 34], a), rr = rot90([0, -34], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: W }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }, { x: c.x + rw[0], y: c.y + rw[1], id: c.id + ":we" }, { x: c.x + rr[0], y: c.y + rr[1], id: c.id + ":rst" }]; }
  if (c.type === "outz") { const W = c.width || 8; const ri = rot90([-PIN, -12], a), re = rot90([-PIN, 16], a), ro = rot90([PIN, 0], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: W }, { x: c.x + re[0], y: c.y + re[1], id: c.id + ":en" }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }]; }
  if (c.type === "delay") { const W = c.width || BUS_W; const ri = rot90([-PIN, 0], a), ro = rot90([PIN, 0], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: W }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }]; }
  if (c.type === "bidir") { const W = c.width || 8; const ri = rot90([-PIN, -14], a), rd = rot90([-PIN, 14], a), rio = rot90([PIN, 0], a), ro = rot90([0, PIN], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: W }, { x: c.x + rd[0], y: c.y + rd[1], id: c.id + ":dir" }, { x: c.x + rio[0], y: c.y + rio[1], id: c.id + "#io", bus: W }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }]; }
  if (c.type === "dualram") { const W = c.width || 8; const L = Math.max(1, Math.ceil(Math.log2(c.cells || 16))); const aA = rot90([-PIN, -32], a), iA = rot90([-PIN, -12], a), aB = rot90([-PIN, 12], a), iB = rot90([-PIN, 32], a), oA = rot90([PIN, -22], a), oB = rot90([PIN, 22], a), wA = rot90([0, -PIN], a), wB = rot90([0, PIN], a); return [{ x: c.x + aA[0], y: c.y + aA[1], id: c.id + "#addrA", bus: L }, { x: c.x + iA[0], y: c.y + iA[1], id: c.id + "#inA", bus: W }, { x: c.x + aB[0], y: c.y + aB[1], id: c.id + "#addrB", bus: L }, { x: c.x + iB[0], y: c.y + iB[1], id: c.id + "#inB", bus: W }, { x: c.x + oA[0], y: c.y + oA[1], id: c.id + "#outA", bus: W }, { x: c.x + oB[0], y: c.y + oB[1], id: c.id + "#outB", bus: W }, { x: c.x + wA[0], y: c.y + wA[1], id: c.id + ":weA" }, { x: c.x + wB[0], y: c.y + wB[1], id: c.id + ":weB" }]; }
  if (c.type === "latchram") { const W = c.width || 8; const L = Math.max(1, Math.ceil(Math.log2(c.cells || 16))); const raddr = rot90([-PIN, -24], a), rin = rot90([-PIN, 24], a), ro = rot90([PIN, 0], a), rw = rot90([0, 46], a); return [{ x: c.x + raddr[0], y: c.y + raddr[1], id: c.id + "#addr", bus: L }, { x: c.x + rin[0], y: c.y + rin[1], id: c.id + "#in", bus: W }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }, { x: c.x + rw[0], y: c.y + rw[1], id: c.id + ":we" }]; }
  if (c.type === "node") { const d = 28; return [{ x: c.x - d, y: c.y, id: c.id + ":0" }, { x: c.x + d, y: c.y, id: c.id + ":1" }, { x: c.x, y: c.y - d, id: c.id + ":2" }, { x: c.x, y: c.y + d, id: c.id + ":3" }]; }
  if (c.type === "counter") { const W = c.width || BUS_W; const ro = rot90([PIN, 0], a), re = rot90([-PIN, -14], a), rr = rot90([-PIN, 14], a); return [{ x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }, { x: c.x + re[0], y: c.y + re[1], id: c.id + ":en" }, { x: c.x + rr[0], y: c.y + rr[1], id: c.id + ":rst" }]; }
  if (c.type === "shiftreg") { const W = c.width || BUS_W; const ri = rot90([-PIN, 0], a), ro = rot90([PIN, -10], a), rs = rot90([PIN, 16], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + ":sin" }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }, { x: c.x + rs[0], y: c.y + rs[1], id: c.id + ":sout" }]; }
  if (c.type === "ram") { const W = c.width || 8; const L = Math.max(1, Math.ceil(Math.log2(c.cells || 16))); const raddr = rot90([-PIN, -24], a), rin = rot90([-PIN, 24], a), ro = rot90([PIN, 0], a), rw = rot90([0, 46], a); return [{ x: c.x + raddr[0], y: c.y + raddr[1], id: c.id + "#addr", bus: L }, { x: c.x + rin[0], y: c.y + rin[1], id: c.id + "#in", bus: W }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }, { x: c.x + rw[0], y: c.y + rw[1], id: c.id + ":we" }]; }
  if (c.type === "tristate") { const W = c.width || BUS_W; const ra = rot90([-PIN, -30], a), rb = rot90([-PIN, 0], a), rc = rot90([-PIN, 30], a), ro = rot90([PIN, 0], a), rea = rot90([-22, 46], a), reb = rot90([0, 46], a), rec = rot90([22, 46], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rb[0], y: c.y + rb[1], id: c.id + "#b", bus: W }, { x: c.x + rc[0], y: c.y + rc[1], id: c.id + "#c", bus: W }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }, { x: c.x + rea[0], y: c.y + rea[1], id: c.id + ":ea" }, { x: c.x + reb[0], y: c.y + reb[1], id: c.id + ":eb" }, { x: c.x + rec[0], y: c.y + rec[1], id: c.id + ":ec" }]; }
  if (c.type === "alu") { const W = c.width || BUS_W; const ra = rot90([-PIN, -26], a), rb = rot90([-PIN, 26], a), rs = rot90([PIN, -12], a), rz = rot90([PIN, 16], a), r0 = rot90([-18, 42], a), rsub = rot90([0, 42], a), r1 = rot90([18, 42], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rb[0], y: c.y + rb[1], id: c.id + "#b", bus: W }, { x: c.x + rs[0], y: c.y + rs[1], id: c.id + "#s", bus: W }, { x: c.x + rz[0], y: c.y + rz[1], id: c.id + ":zero" }, { x: c.x + r0[0], y: c.y + r0[1], id: c.id + ":op0" }, { x: c.x + rsub[0], y: c.y + rsub[1], id: c.id + ":sub" }, { x: c.x + r1[0], y: c.y + r1[1], id: c.id + ":op1" }]; }
  if (c.type === "decoder") { const ri = rot90([-PIN, 0], a), rm = rot90([PIN, -36], a), r0 = rot90([PIN, -24], a), r1 = rot90([PIN, -13], a), rw = rot90([PIN, -2], a), rj = rot90([PIN, 9], a), rs = rot90([PIN, 20], a), rz = rot90([PIN, 31], a), rl = rot90([PIN, 42], a), rt = rot90([PIN, 53], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: 8 }, { x: c.x + rm[0], y: c.y + rm[1], id: c.id + "#imm", bus: 4 }, { x: c.x + r0[0], y: c.y + r0[1], id: c.id + ":op0" }, { x: c.x + r1[0], y: c.y + r1[1], id: c.id + ":op1" }, { x: c.x + rw[0], y: c.y + rw[1], id: c.id + ":we" }, { x: c.x + rj[0], y: c.y + rj[1], id: c.id + ":jmp" }, { x: c.x + rs[0], y: c.y + rs[1], id: c.id + ":sub" }, { x: c.x + rz[0], y: c.y + rz[1], id: c.id + ":jz" }, { x: c.x + rl[0], y: c.y + rl[1], id: c.id + ":ld" }, { x: c.x + rt[0], y: c.y + rt[1], id: c.id + ":st" }]; }
  if (c.type === "rom") { const W = c.width || 8; const ra = rot90([-PIN, 0], a), rd = rot90([PIN, 0], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#addr", bus: 4 }, { x: c.x + rd[0], y: c.y + rd[1], id: c.id + "#data", bus: W }]; }
  if (c.type === "add4") { const W = c.width || BUS_W; const ra = rot90([-PIN, -28], a), rci = rot90([-PIN, 0], a), rb = rot90([-PIN, 28], a), rs = rot90([PIN, -14], a), rco = rot90([PIN, 18], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rb[0], y: c.y + rb[1], id: c.id + "#b", bus: W }, { x: c.x + rs[0], y: c.y + rs[1], id: c.id + "#s", bus: W }, { x: c.x + rci[0], y: c.y + rci[1], id: c.id + ":cin" }, { x: c.x + rco[0], y: c.y + rco[1], id: c.id + ":cout" }]; }
  if (c.type === "subb") { const W = c.width || BUS_W; const ra = rot90([-PIN, -26], a), rb = rot90([-PIN, 26], a), rs = rot90([PIN, -12], a), rbo = rot90([PIN, 18], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rb[0], y: c.y + rb[1], id: c.id + "#b", bus: W }, { x: c.x + rs[0], y: c.y + rs[1], id: c.id + "#s", bus: W }, { x: c.x + rbo[0], y: c.y + rbo[1], id: c.id + ":borrow" }]; }
  if (c.type === "cmp") { const W = c.width || BUS_W; const ra = rot90([-PIN, -26], a), rb = rot90([-PIN, 26], a), rg = rot90([PIN, -16], a), re = rot90([PIN, 0], a), rl = rot90([PIN, 16], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rb[0], y: c.y + rb[1], id: c.id + "#b", bus: W }, { x: c.x + rg[0], y: c.y + rg[1], id: c.id + ":gt" }, { x: c.x + re[0], y: c.y + re[1], id: c.id + ":eq" }, { x: c.x + rl[0], y: c.y + rl[1], id: c.id + ":lt" }]; }
  if (c.type === "mux4") { const W = c.width || BUS_W; const ra = rot90([-PIN, -28], a), rsel = rot90([-PIN, 0], a), rb = rot90([-PIN, 28], a), rs = rot90([PIN, 0], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rb[0], y: c.y + rb[1], id: c.id + "#b", bus: W }, { x: c.x + rs[0], y: c.y + rs[1], id: c.id + "#s", bus: W }, { x: c.x + rsel[0], y: c.y + rsel[1], id: c.id + ":sel" }]; }
  if (c.type === "split") { const W = c.width || BUS_W; const sp = W <= 4 ? 18 : W <= 8 ? 16 : W <= 16 ? 15 : W <= 32 ? 14 : 13; const ri = rot90([-PIN, 0], a); const outs = Array.from({ length: W }, (_, i) => { const y = (i - (W - 1) / 2) * sp; const r = rot90([PIN, y], a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + i }; }); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: W }, ...outs]; }
  if (c.type === "merge") { const W = c.width || BUS_W; const sp = W <= 4 ? 18 : W <= 8 ? 16 : W <= 16 ? 15 : W <= 32 ? 14 : 13; const ro = rot90([PIN, 0], a); const ins = Array.from({ length: W }, (_, i) => { const y = (i - (W - 1) / 2) * sp; const r = rot90([-PIN, y], a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + i }; }); return [...ins, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }]; }
  if (c.type === "busnot" || c.type === "busneg") { const W = c.width || BUS_W; const ri = rot90([-PIN, 0], a), ro = rot90([PIN, 0], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#a", bus: W }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#s", bus: W }]; }
  if (c.type === "busand" || c.type === "busor" || c.type === "busxor" || c.type === "busnand" || c.type === "busnor" || c.type === "busxnor") { const W = c.width || BUS_W; const ra = rot90([-PIN, -14], a), rb = rot90([-PIN, 14], a), rs = rot90([PIN, 0], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rb[0], y: c.y + rb[1], id: c.id + "#b", bus: W }, { x: c.x + rs[0], y: c.y + rs[1], id: c.id + "#s", bus: W }]; }
  if (c.type === "shl" || c.type === "shr" || c.type === "ashr" || c.type === "rol" || c.type === "ror") { const W = c.width || BUS_W; const L = Math.max(1, Math.ceil(Math.log2(W))); const ra = rot90([-PIN, -14], a), rt = rot90([-PIN, 18], a), rs = rot90([PIN, 0], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rt[0], y: c.y + rt[1], id: c.id + "#amt", bus: L }, { x: c.x + rs[0], y: c.y + rs[1], id: c.id + "#s", bus: W }]; }
  if (c.type === "demux") { const nb = Math.max(1, Math.min(3, c.bits || 2)); const outc = 1 << nb; const sp = outc <= 2 ? 24 : outc <= 4 ? 16 : 12; const rsel = rot90([-PIN, 0], a); const outs = Array.from({ length: outc }, (_, j) => { const y = (j - (outc - 1) / 2) * sp; const r = rot90([PIN, y], a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":o" + j }; }); return [{ x: c.x + rsel[0], y: c.y + rsel[1], id: c.id + "#sel", bus: nb }, ...outs]; }
  if (c.type === "bytesplit") { const W = c.width || BUS_W; const nb = Math.max(1, Math.floor(W / 8)); const sp = nb <= 2 ? 28 : nb <= 4 ? 18 : 12; const rin = rot90([-PIN, 0], a); const outs = Array.from({ length: nb }, (_, b) => { const y = (b - (nb - 1) / 2) * sp; const r = rot90([PIN, y], a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + "#o" + b, bus: 8 }; }); return [{ x: c.x + rin[0], y: c.y + rin[1], id: c.id + "#in", bus: W }, ...outs]; }
  if (c.type === "bytemerge") { const W = c.width || BUS_W; const nb = Math.max(1, Math.floor(W / 8)); const sp = nb <= 2 ? 28 : nb <= 4 ? 18 : 12; const rout = rot90([PIN, 0], a); const ins = Array.from({ length: nb }, (_, b) => { const y = (b - (nb - 1) / 2) * sp; const r = rot90([-PIN, y], a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + "#i" + b, bus: 8 }; }); return [...ins, { x: c.x + rout[0], y: c.y + rout[1], id: c.id + "#out", bus: W }]; }
  if (c.type === "fulladd") { const P = [["a", -PIN, -16], ["b", -PIN, 0], ["cin", -PIN, 16], ["sum", PIN, -10], ["cout", PIN, 12]]; return P.map(([nm, x, y]) => { const r = rot90([x, y], a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":" + nm }; }); }
  if (c.type === "indexbit") { const W = c.width || BUS_W; const L = Math.max(1, Math.ceil(Math.log2(W))); const ri = rot90([-PIN, -14], a), rx = rot90([-PIN, 18], a), ro = rot90([PIN, 0], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: W }, { x: c.x + rx[0], y: c.y + rx[1], id: c.id + "#idx", bus: L }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + ":out" }]; }
  if (c.type === "indexbyte") { const W = c.width || BUS_W; const nb = Math.max(1, Math.floor(W / 8)); const L = Math.max(1, Math.ceil(Math.log2(nb))); const ri = rot90([-PIN, -14], a), rx = rot90([-PIN, 18], a), ro = rot90([PIN, 0], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: W }, { x: c.x + rx[0], y: c.y + rx[1], id: c.id + "#idx", bus: L }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: 8 }]; }
  if (c.type === "byteexp") { const W = c.width || 8; const sp = W <= 4 ? 18 : W <= 8 ? 16 : W <= 16 ? 15 : W <= 32 ? 14 : 13; const ri = rot90([-PIN, 0], a); const outs = Array.from({ length: W }, (_, i) => { const y = (i - (W - 1) / 2) * sp; const r = rot90([PIN, y], a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":o" + i }; }); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: W }, ...outs]; }
  if (c.type === "bitcomp") { const W = c.width || 8; const sp = W <= 4 ? 18 : W <= 8 ? 16 : W <= 16 ? 15 : W <= 32 ? 14 : 13; const ro = rot90([PIN, 0], a); const ins = Array.from({ length: W }, (_, i) => { const y = (i - (W - 1) / 2) * sp; const r = rot90([-PIN, y], a); return { x: c.x + r[0], y: c.y + r[1], id: c.id + ":i" + i }; }); return [...ins, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }]; }
  if (c.type === "mul") { const W = c.width || 8; const ra = rot90([-PIN, -16], a), rb = rot90([-PIN, 16], a), rs = rot90([PIN, 16], a), rh = rot90([PIN, -16], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rb[0], y: c.y + rb[1], id: c.id + "#b", bus: W }, { x: c.x + rs[0], y: c.y + rs[1], id: c.id + "#s", bus: W }, { x: c.x + rh[0], y: c.y + rh[1], id: c.id + "#hi", bus: W }]; }
  if (c.type === "divmod") { const W = c.width || 8; const ra = rot90([-PIN, -16], a), rb = rot90([-PIN, 16], a), rq = rot90([PIN, -14], a), rr = rot90([PIN, 14], a); return [{ x: c.x + ra[0], y: c.y + ra[1], id: c.id + "#a", bus: W }, { x: c.x + rb[0], y: c.y + rb[1], id: c.id + "#b", bus: W }, { x: c.x + rq[0], y: c.y + rq[1], id: c.id + "#q", bus: W }, { x: c.x + rr[0], y: c.y + rr[1], id: c.id + "#r", bus: W }]; }
  if (c.type === "dac") { const W = c.width || BUS_W; const ri = rot90([-PIN, 0], a), ro = rot90([PIN, -10], a), rg = rot90([PIN, 16], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + "#in", bus: W }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + ":aout" }, { x: c.x + rg[0], y: c.y + rg[1], id: c.id + ":gnd" }]; }
  if (c.type === "adc") { const W = c.width || BUS_W; const ri = rot90([-PIN, -10], a), rg = rot90([-PIN, 16], a), ro = rot90([PIN, 0], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + ":ain" }, { x: c.x + rg[0], y: c.y + rg[1], id: c.id + ":gnd" }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + "#out", bus: W }]; }
  if (c.type === "athresh") { const ri = rot90([-PIN, -10], a), rg = rot90([-PIN, 16], a), ro = rot90([PIN, 0], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + ":ain" }, { x: c.x + rg[0], y: c.y + rg[1], id: c.id + ":gnd" }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + ":out" }]; }
  if (c.type === "schmitt") { const ri = rot90([-PIN, -10], a), rg = rot90([-PIN, 16], a), ro = rot90([PIN, 0], a); return [{ x: c.x + ri[0], y: c.y + ri[1], id: c.id + ":ain" }, { x: c.x + rg[0], y: c.y + rg[1], id: c.id + ":gnd" }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + ":out" }]; }
  if (c.type === "transformer") { const r0 = rot90([-PIN, -20], a), r1 = rot90([-PIN, 20], a), r2 = rot90([PIN, -20], a), r3 = rot90([PIN, 20], a); return [{ x: c.x + r0[0], y: c.y + r0[1], id: c.id + ":0" }, { x: c.x + r1[0], y: c.y + r1[1], id: c.id + ":1" }, { x: c.x + r2[0], y: c.y + r2[1], id: c.id + ":2" }, { x: c.x + r3[0], y: c.y + r3[1], id: c.id + ":3" }]; }
  if (c.type === "relay") { const r0 = rot90([-PIN, -16], a), r1 = rot90([-PIN, 16], a), r2 = rot90([PIN, -16], a), r3 = rot90([PIN, 16], a); return [{ x: c.x + r0[0], y: c.y + r0[1], id: c.id + ":0" }, { x: c.x + r1[0], y: c.y + r1[1], id: c.id + ":1" }, { x: c.x + r2[0], y: c.y + r2[1], id: c.id + ":2" }, { x: c.x + r3[0], y: c.y + r3[1], id: c.id + ":3" }]; }
  if (c.type === "vcvs" || c.type === "vccs" || c.type === "ccvs" || c.type === "cccs") { const r0 = rot90([-PIN, -18], a), r1 = rot90([-PIN, 18], a), r2 = rot90([PIN, -18], a), r3 = rot90([PIN, 18], a); return [{ x: c.x + r0[0], y: c.y + r0[1], id: c.id + ":0" }, { x: c.x + r1[0], y: c.y + r1[1], id: c.id + ":1" }, { x: c.x + r2[0], y: c.y + r2[1], id: c.id + ":2" }, { x: c.x + r3[0], y: c.y + r3[1], id: c.id + ":3" }]; }
  if (c.type === "timer555") { const rv = rot90([0, -PIN], a), rg = rot90([0, PIN], a), ro = rot90([PIN, 0], a), rd = rot90([-PIN, -16], a), rt = rot90([-PIN, 0], a), rr = rot90([-PIN, 16], a); return [{ x: c.x + rv[0], y: c.y + rv[1], id: c.id + ":vcc" }, { x: c.x + rg[0], y: c.y + rg[1], id: c.id + ":gnd" }, { x: c.x + ro[0], y: c.y + ro[1], id: c.id + ":out" }, { x: c.x + rd[0], y: c.y + rd[1], id: c.id + ":dis" }, { x: c.x + rt[0], y: c.y + rt[1], id: c.id + ":thr" }, { x: c.x + rr[0], y: c.y + rr[1], id: c.id + ":trg" }]; }
  return [
    { x: c.x + o[0][0], y: c.y + o[0][1], id: c.id + ":0" },
    { x: c.x + o[1][0], y: c.y + o[1][1], id: c.id + ":1" },
  ];
}
function buildPinMap(components) {
  const m = {};
  for (const c of components) for (const p of pinsOf(c)) m[p.id] = { x: p.x, y: p.y, bus: p.bus };
  return m;
}

/* ---- Breadboard layout (shared by renderer + connectivity mapper) ----
   64 columns, two 5-row blocks (top f–j, bottom a–e) split by a center channel,
   plus 4 outer power rails (top +/-, bottom -/+). Hole pitch P = 20 = PIN/2, so a
   2-pin part (legs ±PIN = ±2P) lands on holes when its center snaps to a hole.
   Each column-half is one electrical strip; each rail is one strip running the length. */
const BB_P = 20, BB_COLS = 64;
const bbColX = (C) => (C - (BB_COLS + 1) / 2) * BB_P;
const BB_ROWS_TOP = [1, 2, 3, 4, 5].map((k) => -k * BB_P);
const BB_ROWS_BOT = [1, 2, 3, 4, 5].map((k) => k * BB_P);
const BB_RAILS = [
  { y: -8 * BB_P, key: "tp", pos: true },
  { y: -7 * BB_P, key: "tm", pos: false },
  { y: 7 * BB_P, key: "bm", pos: false },
  { y: 8 * BB_P, key: "bp", pos: true },
];
const BB_HW = (BB_COLS / 2 + 1) * BB_P;
const BB_HH = 9 * BB_P;
function bbStripOf(b, px, py) {
  const lx = px - b.x, ly = py - b.y;
  const C = Math.round(lx / BB_P + (BB_COLS + 1) / 2);
  if (C < 1 || C > BB_COLS) return null;
  if (Math.abs(lx - bbColX(C)) > BB_P * 0.45) return null;
  let best = null, be = BB_P * 0.45;
  for (const y of BB_ROWS_TOP) { const e = Math.abs(ly - y); if (e <= be) { be = e; best = "c" + C + "t"; } }
  for (const y of BB_ROWS_BOT) { const e = Math.abs(ly - y); if (e <= be) { be = e; best = "c" + C + "b"; } }
  for (const r of BB_RAILS) { const e = Math.abs(ly - r.y); if (e <= be) { be = e; best = "r" + r.key; } }
  return best ? (b.id + "#" + best) : null;
}
function bbSnap(b, px, py) {
  const lx = px - b.x, ly = py - b.y;
  if (Math.abs(lx) > BB_HW || Math.abs(ly) > BB_HH) return null;
  const C = Math.max(1, Math.min(BB_COLS, Math.round(lx / BB_P + (BB_COLS + 1) / 2)));
  const rows = [...BB_ROWS_TOP, ...BB_ROWS_BOT, ...BB_RAILS.map((r) => r.y)];
  let ry = rows[0]; for (const y of rows) if (Math.abs(ly - y) < Math.abs(ly - ry)) ry = y;
  return { x: b.x + bbColX(C), y: b.y + ry };
}
const BBOARD = { P: BB_P, COLS: BB_COLS, colX: bbColX, rowsTop: BB_ROWS_TOP, rowsBot: BB_ROWS_BOT, rails: BB_RAILS, hw: BB_HW, hh: BB_HH, stripOf: bbStripOf, snap: bbSnap };

export { PIN, SPDT_SP, chipDims, pinsOf, buildPinMap, BBOARD };
