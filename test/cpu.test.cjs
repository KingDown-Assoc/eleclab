"use strict";
/* Processeur câblé : jeu d'instructions étendu (SUB, JZ, LOAD, STORE). */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "builders.js"), "utf8");

module.exports = function (t, E) {
  // buildCpu (et son helper mkBuilder) construisent le netlist du CPU ; on les
  // évalue depuis la source (ce sont des "builders" d'UI, pas du moteur).
  const grab = (name) => {
    const m = src.match(new RegExp("function " + name + "[\\s\\S]*?\\n}", "m"));
    if (!m) throw new Error("builder introuvable: " + name);
    return m[0];
  };
  let buildCpu;
  try {
    buildCpu = new Function(grab("mkBuilder") + "\n" + grab("buildCpu") + "\nreturn buildCpu;")();
  } catch (e) {
    t("buildCpu évaluable", false, e.message); return;
  }

  const NOP = 0, LDI = 1, ADD = 2, AND = 3, OR = 4, JMP = 5, SUB = 6, JZ = 7, LOAD = 8, STORE = 9;
  const I = (op, imm) => (op << 4) | (imm & 15);

  const makeCPU = (prog) => { const { comps, wires } = buildCpu(0, 0); comps.find((c) => c.type === "rom").prog = prog.slice(); return { comps, wires }; };
  function run(prog, ticks) {
    let { comps: cs, wires } = makeCPU(prog);
    const acc = () => E.busSimulate(cs, wires).busVal(cs.find((c) => c.name === "Accumulateur").id, "out");
    for (let i = 0; i < ticks; i++) cs = E.clockTick(cs, wires);
    const ram = cs.find((c) => c.type === "ram");
    return { acc: acc(), mem: (ram && ram.mem) || [] };
  }

  t("SUB : 9-4 = 5", run([I(LDI, 9), I(SUB, 4), I(JMP, 2)], 6).acc === 5);
  t("SUB (modulo) : 2-5 = 13", run([I(LDI, 2), I(SUB, 5), I(JMP, 2)], 6).acc === 13);
  t("ADD : 5+3 = 8", run([I(LDI, 5), I(ADD, 3), I(JMP, 2)], 6).acc === 8);
  t("AND : 13 & 6 = 4", run([I(LDI, 13), I(AND, 6), I(JMP, 2)], 6).acc === 4);
  t("OR : 5 | 2 = 7", run([I(LDI, 5), I(OR, 2), I(JMP, 2)], 6).acc === 7);

  // JZ : LDI 1 ; SUB 1 (A=0) ; JZ 5 (saut pris) ; LDI 9 (sauté) ; ... ; LDI 3 @5
  { const r = run([I(LDI, 1), I(SUB, 1), I(JZ, 5), I(LDI, 9), I(JMP, 4), I(LDI, 3), I(JMP, 6)], 12); t("JZ : saut si A==0 -> A=3", r.acc === 3, r); }
  // JZ non pris : LDI 1 ; JZ 4 (A!=0, pas de saut) ; ADD 1 (A=2) ; JMP 3
  { const r = run([I(LDI, 1), I(JZ, 4), I(ADD, 1), I(JMP, 3), I(LDI, 9)], 10); t("JZ : pas de saut si A!=0 -> A=2", r.acc === 2, r); }

  // STORE/LOAD : LDI 6 ; STORE 2 ; LDI 0 ; LOAD 2 ; ADD 3 -> 9 ; et RAM[2]==6
  { const r = run([I(LDI, 6), I(STORE, 2), I(LDI, 0), I(LOAD, 2), I(ADD, 3), I(JMP, 5)], 10); t("STORE+LOAD : relit la RAM -> A=9", r.acc === 9, r); t("STORE : RAM[2] == 6", (r.mem[2] | 0) === 6, r.mem); }

  // Décompte : LDI 5 ; SUB 1 ; JZ 4 ; JMP 1 -> s'arrête à 0
  { const r = run([I(LDI, 5), I(SUB, 1), I(JZ, 4), I(JMP, 1), I(JMP, 4)], 40); t("Décompte 5->0 puis stable à 0", r.acc === 0, r); }
};
