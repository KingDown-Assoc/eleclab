"use strict";
/* Cœur du moteur : analogique (lois DC + diode), portes logiques, bus. */
module.exports = function (t, E) {
  const mA = (r, id) => r.result[id].current * 1000;
  const lvl = (sim, pin) => { let p = pin; if (sim.pinAlias && sim.pinAlias[p]) p = sim.pinAlias[p]; return sim.netLevel[sim.pinNet[p]] ? 1 : 0; };

  // --- Analogique : loi d'Ohm, série, parallèle ---
  {
    const r = E.run([{ id: "B", type: "battery", value: 6 }, { id: "R", type: "resistor", value: 1000 }],
      [{ id: "1", a: "B:0", b: "R:0" }, { id: "2", a: "R:1", b: "B:1" }]);
    t("Ohm : 6V/1kΩ = 6 mA", r.ok && Math.abs(mA(r, "R") - 6) < 0.05, r.ok && mA(r, "R"));
  }
  {
    const r = E.run([{ id: "B", type: "battery", value: 6 }, { id: "R1", type: "resistor", value: 1000 }, { id: "R2", type: "resistor", value: 1000 }],
      [{ id: "1", a: "B:0", b: "R1:0" }, { id: "2", a: "R1:1", b: "R2:0" }, { id: "3", a: "R2:1", b: "B:1" }]);
    t("Série : deux 1kΩ sous 6V = 3 mA", r.ok && Math.abs(mA(r, "R1") - 3) < 0.05, r.ok && mA(r, "R1"));
  }
  {
    const r = E.run([{ id: "B", type: "battery", value: 6 }, { id: "R1", type: "resistor", value: 1000 }, { id: "R2", type: "resistor", value: 1000 }],
      [{ id: "1", a: "B:0", b: "R1:0" }, { id: "2", a: "B:0", b: "R2:0" }, { id: "3", a: "R1:1", b: "B:1" }, { id: "4", a: "R2:1", b: "B:1" }]);
    t("Parallèle : chaque branche 6 mA", r.ok && Math.abs(mA(r, "R1") - 6) < 0.05 && Math.abs(mA(r, "R2") - 6) < 0.05, r.ok && [mA(r, "R1"), mA(r, "R2")]);
  }
  {
    // Diode passante (anode au +) vs bloquée (inversée)
    const fwd = E.run([{ id: "B", type: "battery", value: 5 }, { id: "R", type: "resistor", value: 1000 }, { id: "D", type: "diode" }],
      [{ id: "1", a: "B:0", b: "R:0" }, { id: "2", a: "R:1", b: "D:0" }, { id: "3", a: "D:1", b: "B:1" }]);
    const rev = E.run([{ id: "B", type: "battery", value: 5 }, { id: "R", type: "resistor", value: 1000 }, { id: "D", type: "diode" }],
      [{ id: "1", a: "B:0", b: "R:0" }, { id: "2", a: "R:1", b: "D:1" }, { id: "3", a: "D:0", b: "B:1" }]);
    t("Diode : passante conduit, inverse bloque", fwd.ok && rev.ok && Math.abs(mA(fwd, "R")) > 1 && Math.abs(mA(rev, "R")) < 0.05,
      { fwd: fwd.ok && mA(fwd, "R"), rev: rev.ok && mA(rev, "R") });
  }

  // --- Portes logiques (table de vérité par lecture de net) ---
  function gate(type, a, b) {
    const comps = [{ id: "A", type: a ? "high" : "low" }, { id: "G", type }, { id: "O", type: "out" }];
    const wires = [{ id: "1", a: "A:0", b: "G:0" }, { id: "3", a: "G:" + (type === "not" ? 1 : 2), b: "O:0" }];
    if (type !== "not") { comps.push({ id: "B", type: b ? "high" : "low" }); wires.push({ id: "2", a: "B:0", b: "G:1" }); }
    const sim = E.run(comps, wires);
    return lvl(sim, "O:0");
  }
  t("AND : 0,1,1·1=1", gate("and", 0, 0) === 0 && gate("and", 1, 0) === 0 && gate("and", 1, 1) === 1);
  t("OR  : 0|0=0, 1|0=1", gate("or", 0, 0) === 0 && gate("or", 1, 0) === 1);
  t("XOR : 1^1=0, 1^0=1", gate("xor", 1, 1) === 0 && gate("xor", 1, 0) === 1);
  t("NAND: 1·1=0, 0·0=1", gate("nand", 1, 1) === 0 && gate("nand", 0, 0) === 1);
  t("NOT : ¬1=0, ¬0=1", gate("not", 1) === 0 && gate("not", 0) === 1);

  // --- Bus : additionneur 4 bits + multiplexeur ---
  {
    const r = E.run([{ id: "a", type: "busin", value: 9, width: 4 }, { id: "b", type: "busin", value: 4, width: 4 }, { id: "s", type: "add4", width: 4 }, { id: "o", type: "busout", width: 4 }],
      [{ id: "1", a: "a#out", b: "s#a", bus: 4 }, { id: "2", a: "b#out", b: "s#b", bus: 4 }, { id: "3", a: "s#s", b: "o#in", bus: 4 }]);
    t("add4 : 9+4 = 13", r.busVal("o", "in") === 13, r.busVal("o", "in"));
  }
};
