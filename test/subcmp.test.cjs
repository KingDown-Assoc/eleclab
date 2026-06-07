"use strict";
/* Blocs bus « soustracteur » (subb) et « comparateur » (cmp). */
module.exports = function (t, E) {
  let N = 0;
  function build(W, type, A, B) {
    const comps = [], wires = [];
    const id = () => "x" + (++N);
    const a = id(); comps.push({ id: a, type: "busin", x: 0, y: 0, value: A, width: W });
    const b = id(); comps.push({ id: b, type: "busin", x: 0, y: 0, value: B, width: W });
    const u = id(); comps.push({ id: u, type, x: 0, y: 0, width: W });
    let m = 0; const w = (x, y, bus) => wires.push({ id: "w" + (++m), a: x, b: y, ...(bus ? { bus } : {}) });
    w(a + "#out", u + "#a", W); w(b + "#out", u + "#b", W);
    let outId = null;
    if (type === "subb") { outId = id(); comps.push({ id: outId, type: "busout", x: 0, y: 0, width: W }); w(u + "#s", outId + "#in", W); }
    const sim = E.busSimulate(comps, wires);
    return { sim, u, outId };
  }
  const sub = (W, A, B) => { const { sim, u, outId } = build(W, "subb", A, B); return { s: sim.busVal(outId, "in"), borrow: E.busBit(sim, u, "borrow") }; };
  const cmp = (W, A, B) => { const { sim, u } = build(W, "cmp", A, B); return { gt: E.busBit(sim, u, "gt"), eq: E.busBit(sim, u, "eq"), lt: E.busBit(sim, u, "lt") }; };
  const M = (W) => (1 << W) - 1;

  // Soustracteur 4 bits : quelques cas clés.
  { const r = sub(4, 9, 4); t("subb 9-4=5, borrow=0", r.s === 5 && r.borrow === 0, r); }
  { const r = sub(4, 2, 5); t("subb 2-5=13 (mod16), borrow=1", r.s === ((2 - 5) & 15) && r.borrow === 1, r); }
  { const r = sub(4, 0, 0); t("subb 0-0=0, borrow=0", r.s === 0 && r.borrow === 0, r); }
  { const r = sub(4, 15, 15); t("subb 15-15=0, borrow=0", r.s === 0 && r.borrow === 0, r); }
  { const r = sub(4, 7, 8); t("subb 7-8 borrow=1", r.borrow === 1, r); }

  // Soustracteur sur d'autres largeurs.
  for (const W of [2, 3, 8]) {
    const A = M(W), B = 1; const r = sub(W, A, B);
    t("subb W=" + W + " : max-1", r.s === ((A - B) & M(W)) && r.borrow === 0, { W, ...r });
  }

  // Comparateur : exhaustif sur 4 bits (256 cas), sorties exclusives + correctes.
  let cmpOK = true, bad = null;
  for (let A = 0; A < 16 && cmpOK; A++) for (let B = 0; B < 16; B++) {
    const r = cmp(4, A, B);
    const expGt = A > B ? 1 : 0, expEq = A === B ? 1 : 0, expLt = A < B ? 1 : 0;
    const excl = (r.gt + r.eq + r.lt) === 1;
    if (r.gt !== expGt || r.eq !== expEq || r.lt !== expLt || !excl) { cmpOK = false; bad = { A, B, ...r }; break; }
  }
  t("cmp 4 bits : 256 cas (gt/eq/lt exclusifs et corrects)", cmpOK, bad);
};
