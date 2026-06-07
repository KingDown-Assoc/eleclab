/*
 * ÉlecLab — example BUILDERS (pure, no JSX).
 * Each build*() returns { comps, wires } for a sample circuit (from a simple
 * voltage divider to a wired CPU). mkBuilder() is the small placement helper.
 * BUILDERS maps an example key -> its builder. No external dependency.
 */

function mkBuilder(list, wireList) {
  let n = 0;
  const comp = (type, x, y, extra = {}) => { const id = "c" + (++n); list.push({ id, type, x, y, value: extra.value, state: extra.state, ...extra }); return id; };
  const wire = (a, b) => wireList.push({ id: "w" + (++n), a, b });
  return { comp, wire };
}
function buildCpu(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0; const bw = (a, b, bus) => wires.push({ id: "cw" + (++n), a, b, ...(bus ? { bus } : {}) });
  const ONE = comp("busin", cx - 380, cy - 150, { value: 1, name: "un" });
  const PC = comp("reg4", cx - 380, cy + 30, { q: 0, name: "PC" });
  const PCOUT = comp("busout", cx - 380, cy + 190, { name: "PC" });
  const INC = comp("add4", cx - 190, cy - 60, { name: "PC+1" });
  const PCMUX = comp("mux4", cx - 190, cy + 170, { name: "saut ?" });
  const ROM = comp("rom", cx + 10, cy - 160, { width: 8, prog: [0x10, 0x21, 0x51], name: "Programme" });
  const DEC = comp("decoder", cx + 10, cy + 60, { name: "Décodeur" });
  const ALU = comp("alu", cx + 250, cy - 90, { name: "ALU" });
  const RAM = comp("ram", cx + 250, cy + 120, { width: 4, mem: [], name: "RAM" });
  const AMUX = comp("mux4", cx + 430, cy - 10, { name: "A ← ALU/RAM" });
  const ACC = comp("reg4", cx + 600, cy + 30, { q: 0, name: "Accumulateur" });
  const ACCOUT = comp("busout", cx + 600, cy + 190, { name: "A" });
  const ZS = comp("split", cx + 760, cy + 190, { width: 4, name: "bits A" });
  const Z01 = comp("or", cx + 860, cy + 150);
  const Z23 = comp("or", cx + 860, cy + 230);
  const ZALL = comp("or", cx + 950, cy + 190);
  const ZNOT = comp("not", cx + 1030, cy + 190, { name: "A=0 ?" });
  const JZAND = comp("and", cx - 30, cy + 300);
  const SELOR = comp("or", cx - 150, cy + 280);
  bw(PC + "#out", INC + "#a", 4);
  bw(ONE + "#out", INC + "#b", 4);
  bw(PC + "#out", ROM + "#addr", 4);
  bw(PC + "#out", PCOUT + "#in", 4);
  bw(ROM + "#data", DEC + "#in", 8);
  bw(DEC + "#imm", ALU + "#b", 4);
  bw(DEC + "#imm", PCMUX + "#b", 4);
  bw(DEC + "#imm", RAM + "#addr", 4);
  bw(ACC + "#out", ALU + "#a", 4);
  bw(ALU + "#s", AMUX + "#a", 4);
  bw(RAM + "#out", AMUX + "#b", 4);
  bw(AMUX + "#s", ACC + "#in", 4);
  bw(ACC + "#out", RAM + "#in", 4);
  bw(ACC + "#out", ACCOUT + "#in", 4);
  bw(ACC + "#out", ZS + "#in", 4);
  bw(INC + "#s", PCMUX + "#a", 4);
  bw(PCMUX + "#s", PC + "#in", 4);
  bw(DEC + ":op0", ALU + ":op0");
  bw(DEC + ":op1", ALU + ":op1");
  bw(DEC + ":sub", ALU + ":sub");
  bw(DEC + ":we", ACC + ":we");
  bw(DEC + ":ld", AMUX + ":sel");
  bw(DEC + ":st", RAM + ":we");
  bw(ZS + ":0", Z01 + ":0"); bw(ZS + ":1", Z01 + ":1");
  bw(ZS + ":2", Z23 + ":0"); bw(ZS + ":3", Z23 + ":1");
  bw(Z01 + ":2", ZALL + ":0"); bw(Z23 + ":2", ZALL + ":1");
  bw(ZALL + ":2", ZNOT + ":0");
  bw(DEC + ":jz", JZAND + ":0"); bw(ZNOT + ":1", JZAND + ":1");
  bw(DEC + ":jmp", SELOR + ":0"); bw(JZAND + ":2", SELOR + ":1");
  bw(SELOR + ":2", PCMUX + ":sel");
  return { comps, wires };
}
function buildCmosInverter(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0; const W = (a, b) => wires.push({ id: "iw" + (++n), a, b });
  const VDD = comp("battery", cx - 300, cy + 10, { value: 5, name: "VDD" });
  const G = comp("ground", cx - 300, cy + 160);
  const SW = comp("spdt", cx - 140, cy + 20, { state: "1", name: "entrée" });
  const P = comp("pmos", cx + 40, cy - 90, { orient: 2, name: "P" });
  const Nn = comp("nmos", cx + 40, cy + 100, { name: "N" });
  const VM = comp("voltmeter", cx + 250, cy + 10, { orient: 1, name: "sortie" });
  W(G + ":0", VDD + ":1");          // masse = pôle − de VDD
  W(VDD + ":0", P + ":2");          // VDD → source du PMOS (orient 2 : source en haut)
  W(Nn + ":2", VDD + ":1");         // source du NMOS → masse
  W(P + ":0", Nn + ":0");           // sortie = drains reliés
  W(SW + ":0", P + ":1"); W(SW + ":0", Nn + ":1"); // entrée → grilles
  W(SW + ":1", VDD + ":1");         // va-et-vient position 1 → masse (entrée basse)
  W(SW + ":2", VDD + ":0");         // position 2 → VDD (entrée haute)
  W(P + ":0", VM + ":0"); W(VM + ":1", VDD + ":1"); // voltmètre sur la sortie
  return { comps, wires };
}
function buildTristateBus(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const bw = (a, b, bus) => wires.push({ id: "tw" + (++n), a, b, ...(bus ? { bus } : {}) });
  const A = comp("busin", cx - 340, cy - 110, { width: 8, value: 5, name: "source A" });
  const B = comp("busin", cx - 340, cy + 0, { width: 8, value: 170, name: "source B" });
  const C = comp("busin", cx - 340, cy + 110, { width: 8, value: 60, name: "source C" });
  const T = comp("tristate", cx - 40, cy + 0, { width: 8 });
  const EA = comp("in", cx - 130, cy + 150, { state: 1, name: "ea" });
  const EB = comp("in", cx - 40, cy + 175, { state: 0, name: "eb" });
  const EC = comp("in", cx + 50, cy + 150, { state: 0, name: "ec" });
  const OUT = comp("busout", cx + 240, cy + 0, { width: 8, name: "bus" });
  bw(A + "#out", T + "#a", 8); bw(B + "#out", T + "#b", 8); bw(C + "#out", T + "#c", 8);
  bw(EA + ":0", T + ":ea"); bw(EB + ":0", T + ":eb"); bw(EC + ":0", T + ":ec");
  bw(T + "#out", OUT + "#in", 8);
  return { comps, wires };
}
function buildRamDemo(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const bw = (a, b, bus) => wires.push({ id: "rw" + (++n), a, b, ...(bus ? { bus } : {}) });
  const AD = comp("busin", cx - 320, cy - 90, { width: 4, value: 3, name: "adresse" });
  const DA = comp("busin", cx - 320, cy + 60, { width: 8, value: 42, name: "donnée" });
  const WE = comp("in", cx - 320, cy + 185, { state: 0, name: "we" });
  const RAM = comp("ram", cx - 40, cy + 10, { width: 8, mem: [] });
  const RD = comp("busout", cx + 250, cy + 10, { width: 8, name: "lecture" });
  bw(AD + "#out", RAM + "#addr", 4);
  bw(DA + "#out", RAM + "#in", 8);
  bw(WE + ":0", RAM + ":we");
  bw(RAM + "#out", RD + "#in", 8);
  return { comps, wires };
}
function buildZenerReg(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const E = comp("battery", cx - 280, cy + 20, { value: 12, name: "entrée 12 V" });
  const G = comp("ground", cx - 280, cy + 180);
  const R = comp("resistor", cx - 70, cy - 70, { value: 470, name: "R série" });
  const Z = comp("zener", cx + 120, cy + 50, { value: 5.1, orient: 3, name: "Zener 5,1 V" });
  const VM = comp("voltmeter", cx + 300, cy + 50, { orient: 1, name: "sortie" });
  wire(G + ":0", E + ":1");          // masse = pôle − de l'entrée
  wire(E + ":0", R + ":0");          // entrée + → R
  wire(R + ":1", Z + ":1");          // R → cathode du Zener (côté +)
  wire(Z + ":0", E + ":1");          // anode du Zener → masse
  wire(R + ":1", VM + ":0"); wire(VM + ":1", E + ":1"); // voltmètre sur la sortie
  return { comps, wires };
}
function buildCmosNand(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0; const W = (a, b) => wires.push({ id: "nw" + (++n), a, b });
  const VDD = comp("battery", cx - 360, cy - 10, { value: 5, name: "VDD" });
  const G = comp("ground", cx - 360, cy + 160);
  const A = comp("spdt", cx - 200, cy - 70, { state: "1", name: "A" });
  const B = comp("spdt", cx - 200, cy + 120, { state: "2", name: "B" });
  const PA = comp("pmos", cx + 30, cy - 160, { orient: 2, name: "PA" });
  const PB = comp("pmos", cx + 190, cy - 160, { orient: 2, name: "PB" });
  const NA = comp("nmos", cx + 30, cy + 40, { name: "NA" });
  const NB = comp("nmos", cx + 30, cy + 200, { name: "NB" });
  const VM = comp("voltmeter", cx + 360, cy - 10, { orient: 1, name: "sortie" });
  W(G + ":0", VDD + ":1");                         // masse = pôle − de VDD
  W(VDD + ":0", PA + ":2"); W(VDD + ":0", PB + ":2"); // pull-up : sources PMOS → VDD
  W(PA + ":0", PB + ":0");                         // drains PMOS reliés = sortie
  W(PA + ":0", NA + ":0");                         // sortie → drain NMOS A
  W(NA + ":2", NB + ":0");                         // pull-down série : source A → drain B
  W(NB + ":2", VDD + ":1");                        // source NMOS B → masse
  W(A + ":0", PA + ":1"); W(A + ":0", NA + ":1");  // entrée A → grilles PA + NA
  W(B + ":0", PB + ":1"); W(B + ":0", NB + ":1");  // entrée B → grilles PB + NB
  W(A + ":1", VDD + ":1"); W(A + ":2", VDD + ":0"); // A : position 1 → masse (0), 2 → VDD (1)
  W(B + ":1", VDD + ":1"); W(B + ":2", VDD + ":0"); // B : idem
  W(PA + ":0", VM + ":0"); W(VM + ":1", VDD + ":1"); // voltmètre sur la sortie
  return { comps, wires };
}
function buildSimple(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 130, cy, { value: 9 });
  const L = comp("lamp", cx + 110, cy);
  wire(B + ":0", L + ":1"); wire(L + ":0", B + ":1");
  return { comps, wires };
}
function buildSeries(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 175, cy, { value: 9 });
  const L1 = comp("lamp", cx + 5, cy);
  const L2 = comp("lamp", cx + 175, cy);
  wire(B + ":0", L1 + ":1"); wire(L1 + ":0", L2 + ":1"); wire(L2 + ":0", B + ":1");
  return { comps, wires };
}
function buildParallel(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 175, cy, { value: 9 });
  const L1 = comp("lamp", cx + 120, cy - 85);
  const L2 = comp("lamp", cx + 120, cy + 85);
  wire(B + ":0", L1 + ":1"); wire(B + ":0", L2 + ":1");
  wire(L1 + ":0", B + ":1"); wire(L2 + ":0", B + ":1");
  return { comps, wires };
}
function buildOhm(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 185, cy + 55, { value: 9 });
  const Am = comp("ammeter", cx - 25, cy - 90);
  const R = comp("resistor", cx + 165, cy - 90, { value: 220 });
  const Vm = comp("voltmeter", cx + 165, cy + 95);
  wire(B + ":0", Am + ":1"); wire(Am + ":0", R + ":1"); wire(R + ":0", B + ":1");
  wire(Vm + ":0", R + ":0"); wire(Vm + ":1", R + ":1");
  return { comps, wires };
}
function buildPotLamp(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 175, cy, { value: 9 });
  const P = comp("pot", cx + 5, cy, { value: 80 });
  const L = comp("lamp", cx + 175, cy);
  wire(B + ":0", P + ":1"); wire(P + ":0", L + ":1"); wire(L + ":0", B + ":1");
  return { comps, wires };
}
function buildMotor(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 130, cy, { value: 9 });
  const M = comp("motor", cx + 110, cy, { value: 40 });
  wire(B + ":0", M + ":1"); wire(M + ":0", B + ":1");
  return { comps, wires };
}
function buildFuse(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 175, cy, { value: 9 });
  const F = comp("fuse", cx + 5, cy, { value: 0.5, state: "ok" });
  const L = comp("lamp", cx + 175, cy);
  wire(B + ":0", F + ":1"); wire(F + ":0", L + ":1"); wire(L + ":0", B + ":1");
  return { comps, wires };
}
function buildWeakBat(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 130, cy, { value: 9, rInt: 2 });
  const L = comp("lamp", cx + 110, cy);
  wire(B + ":0", L + ":1"); wire(L + ":0", B + ":1");
  return { comps, wires };
}
function buildBrokenOpen(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 130, cy, { value: 9 });
  const L = comp("lamp", cx + 110, cy);
  wire(B + ":0", L + ":1"); /* missing return wire */
  return { comps, wires };
}
function buildBrokenVolt(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 175, cy, { value: 9 });
  const Vm = comp("voltmeter", cx + 5, cy);
  const L = comp("lamp", cx + 175, cy);
  wire(B + ":0", Vm + ":1"); wire(Vm + ":0", L + ":1"); wire(L + ":0", B + ":1");
  return { comps, wires };
}
function buildBrokenShort(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 130, cy, { value: 9 });
  const L = comp("lamp", cx + 110, cy);
  wire(B + ":0", L + ":1"); wire(L + ":0", B + ":1"); wire(B + ":0", B + ":1");
  return { comps, wires };
}
function buildRC(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 175, cy, { value: 9 });
  const R = comp("resistor", cx + 5, cy, { value: 1000 });
  const C = comp("capacitor", cx + 175, cy, { value: 1000 });
  wire(B + ":0", R + ":1"); wire(R + ":0", C + ":0"); wire(C + ":1", B + ":1");
  return { comps, wires };
}
function buildRL(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 175, cy, { value: 9 });
  const R = comp("resistor", cx + 5, cy, { value: 10 });
  const Lc = comp("inductor", cx + 175, cy, { value: 10 });
  wire(B + ":0", R + ":1"); wire(R + ":0", Lc + ":0"); wire(Lc + ":1", B + ":1");
  return { comps, wires };
}
function buildAC(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const S = comp("acsource", cx - 175, cy, { value: 5, freq: 1 });
  const R = comp("resistor", cx + 5, cy, { value: 220 });
  const L = comp("lamp", cx + 175, cy);
  wire(S + ":0", R + ":1"); wire(R + ":0", L + ":1"); wire(L + ":0", S + ":1");
  return { comps, wires };
}
function buildACFilter(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const S = comp("acsource", cx - 175, cy, { value: 5, freq: 1 });
  const R = comp("resistor", cx + 5, cy, { value: 1000 });
  const C = comp("capacitor", cx + 175, cy, { value: 220 });
  wire(S + ":0", R + ":1"); wire(R + ":0", C + ":0"); wire(C + ":1", S + ":1");
  return { comps, wires };
}
function buildRLC(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const S = comp("acsource", cx - 210, cy, { value: 5, freq: 1 });
  const R = comp("resistor", cx - 40, cy, { value: 15 });
  const Lc = comp("inductor", cx + 130, cy, { value: 10 });
  const Cc = comp("capacitor", cx + 130, cy + 130, { value: 2500, orient: 2 });
  wire(S + ":0", R + ":1"); wire(R + ":0", Lc + ":1"); wire(Lc + ":0", Cc + ":0"); wire(Cc + ":1", S + ":1");
  return { comps, wires };
}
function buildGround(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 190, cy, { value: 9 });
  const R1 = comp("resistor", cx - 20, cy, { value: 220 });
  const R2 = comp("resistor", cx + 150, cy, { value: 220 });
  const G = comp("ground", cx - 190, cy + 120, { orient: 3 });
  wire(B + ":0", R1 + ":1"); wire(R1 + ":0", R2 + ":1"); wire(R2 + ":0", B + ":1"); wire(G + ":0", B + ":1");
  return { comps, wires };
}
function buildWatt(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 175, cy, { value: 12 });
  const W = comp("wattmeter", cx - 5, cy, { price: 0.25 });
  const La = comp("lamp", cx + 165, cy);
  wire(B + ":0", W + ":1"); wire(W + ":0", La + ":1"); wire(La + ":0", B + ":1");
  return { comps, wires };
}
function buildVaVient(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 250, cy + 40, { value: 9 });
  const S1 = comp("spdt", cx - 95, cy, { state: "1" });
  const S2 = comp("spdt", cx + 95, cy, { orient: 2, state: "2" });
  const La = comp("lamp", cx + 245, cy);
  wire(B + ":0", S1 + ":0");          // pile + -> commun de l'inverseur 1
  wire(S1 + ":1", S2 + ":2");         // navette haute
  wire(S1 + ":2", S2 + ":1");         // navette basse
  wire(S2 + ":0", La + ":1");         // commun de l'inverseur 2 -> lampe
  wire(La + ":0", B + ":1");          // retour
  return { comps, wires };
}
function mkRlcStep(Rval) {
  return (cx, cy) => {
    const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
    const B = comp("battery", cx - 210, cy, { value: 9 });
    const Rr = comp("resistor", cx - 40, cy, { value: Rval });
    const Lc = comp("inductor", cx + 130, cy, { value: 10 });
    const Cc = comp("capacitor", cx + 130, cy + 130, { value: 10000, orient: 2 });
    wire(B + ":0", Rr + ":1"); wire(Rr + ":0", Lc + ":1"); wire(Lc + ":0", Cc + ":0"); wire(Cc + ":1", B + ":1");
    return { comps, wires };
  };
}
function buildMaxPow(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 150, cy, { value: 12, rInt: 20 });
  const Pl = comp("pot", cx + 90, cy, { value: 60, name: "Charge" });
  wire(B + ":0", Pl + ":1"); wire(Pl + ":0", B + ":1");
  return { comps, wires };
}
function buildMultimeter(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const MM = comp("multimeter", cx - 120, cy, { mode: "Ω", orient: 1 });
  const R1 = comp("resistor", cx + 40, cy, { value: 100, orient: 1 });
  const R2 = comp("resistor", cx + 160, cy, { value: 100, orient: 1 });
  wire(MM + ":1", R1 + ":1"); wire(R1 + ":1", R2 + ":1");
  wire(MM + ":0", R1 + ":0"); wire(R1 + ":0", R2 + ":0");
  return { comps, wires };
}
function buildKirchhoff(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 250, cy, { value: 9 });
  const R1 = comp("resistor", cx - 100, cy, { value: 100, name: "R₁" });
  const R2 = comp("resistor", cx + 80, cy - 70, { value: 200, name: "R₂" });
  const R3 = comp("resistor", cx + 80, cy + 70, { value: 200, name: "R₃" });
  wire(B + ":0", R1 + ":1");
  wire(R1 + ":0", R2 + ":1"); wire(R1 + ":0", R3 + ":1");
  wire(R2 + ":0", R3 + ":0"); wire(R3 + ":0", B + ":1");
  return { comps, wires };
}
function buildDivider(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 185, cy + 55, { value: 9 });
  const R1 = comp("resistor", cx - 25, cy - 90, { value: 100, name: "R₁" });
  const R2 = comp("resistor", cx + 165, cy - 90, { value: 100, name: "R₂" });
  const Vm = comp("voltmeter", cx + 165, cy + 95);
  wire(B + ":0", R1 + ":1"); wire(R1 + ":0", R2 + ":1"); wire(R2 + ":0", B + ":1");
  wire(Vm + ":0", R2 + ":1"); wire(Vm + ":1", R2 + ":0");
  return { comps, wires };
}
function buildWheatstone(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 230, cy, { value: 9, orient: 1 });
  const R1 = comp("resistor", cx - 50, cy - 115, { value: 100, name: "R₁", orient: 1 });
  const R3 = comp("resistor", cx - 50, cy + 115, { value: 100, name: "R₃", orient: 1 });
  const R2 = comp("resistor", cx + 140, cy - 115, { value: 100, name: "R₂", orient: 1 });
  const R4 = comp("resistor", cx + 140, cy + 115, { value: 120, name: "R₄", orient: 1 });
  const Vm = comp("voltmeter", cx + 45, cy, { orient: 0 });
  wire(R1 + ":1", R2 + ":1"); wire(B + ":1", R1 + ":1");
  wire(R3 + ":0", R4 + ":0"); wire(B + ":0", R3 + ":0");
  wire(R1 + ":0", R3 + ":1"); wire(Vm + ":1", R1 + ":0");
  wire(R2 + ":0", R4 + ":1"); wire(Vm + ":0", R2 + ":0");
  return { comps, wires };
}
function buildRectifier(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const S = comp("acsource", cx - 150, cy, { value: 5, freq: 2, orient: 3 });
  const D = comp("diode", cx, cy - 95, { orient: 2 });
  const R = comp("resistor", cx + 150, cy, { value: 1000, orient: 1 });
  wire(S + ":0", D + ":0"); wire(D + ":1", R + ":1"); wire(R + ":0", S + ":1");
  return { comps, wires };
}
function buildAmpli(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 200, cy, { value: 12, orient: 3 });
  const R1 = comp("resistor", cx - 40, cy - 80, { value: 47000, orient: 1, name: "R₁" });
  const R2 = comp("resistor", cx - 40, cy + 80, { value: 10000, orient: 1, name: "R₂" });
  const Rc = comp("resistor", cx + 64, cy - 100, { value: 3300, orient: 1, name: "R_C" });
  const Re = comp("resistor", cx + 64, cy + 100, { value: 1000, orient: 1, name: "R_E" });
  const Q = comp("npn", cx + 40, cy, {});
  const G = comp("ground", cx - 200, cy + 120, { orient: 3 });
  wire(B + ":0", R1 + ":1"); wire(B + ":0", Rc + ":1");
  wire(R1 + ":0", Q + ":1"); wire(R2 + ":1", Q + ":1");
  wire(R2 + ":0", G + ":0");
  wire(Rc + ":0", Q + ":0");
  wire(Q + ":2", Re + ":1"); wire(Re + ":0", G + ":0");
  wire(B + ":1", G + ":0");
  return { comps, wires };
}
function buildAmpliAOP(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const Bin = comp("battery", cx - 220, cy - 20, { value: 2 });
  const U = comp("opamp", cx - 60, cy, { value: 12 });
  const Rf = comp("resistor", cx - 60, cy + 80, { value: 20000, name: "R_f" });
  const Rg = comp("resistor", cx - 140, cy + 80, { value: 10000, name: "R_g" });
  const RL = comp("resistor", cx + 60, cy, { orient: 1, value: 10000, name: "charge" });
  const G = comp("ground", cx - 180, cy + 150, { orient: 3 });
  wire(Bin + ":0", U + ":0");
  wire(U + ":2", Rf + ":0"); wire(Rf + ":1", U + ":1");
  wire(Rg + ":0", U + ":1"); wire(Rg + ":1", G + ":0");
  wire(U + ":2", RL + ":1"); wire(RL + ":0", G + ":0");
  wire(Bin + ":1", G + ":0");
  return { comps, wires };
}
function buildNotNand(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 180, cy, { state: 0 }), G = comp("nand", cx, cy), O = comp("out", cx + 180, cy); wire(A + ":0", G + ":0"); wire(A + ":0", G + ":1"); wire(G + ":2", O + ":0"); return { comps, wires }; }
function buildAndNand(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 230, cy - 50, { state: 0 }), B = comp("in", cx - 230, cy + 50, { state: 0 }), N1 = comp("nand", cx - 60, cy), N2 = comp("nand", cx + 110, cy), O = comp("out", cx + 280, cy); wire(A + ":0", N1 + ":0"); wire(B + ":0", N1 + ":1"); wire(N1 + ":2", N2 + ":0"); wire(N1 + ":2", N2 + ":1"); wire(N2 + ":2", O + ":0"); return { comps, wires }; }
function buildOrNand(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 280, cy - 70, { state: 0 }), B = comp("in", cx - 280, cy + 70, { state: 0 }), NA = comp("nand", cx - 120, cy - 70), NB = comp("nand", cx - 120, cy + 70), G = comp("nand", cx + 60, cy), O = comp("out", cx + 230, cy); wire(A + ":0", NA + ":0"); wire(A + ":0", NA + ":1"); wire(B + ":0", NB + ":0"); wire(B + ":0", NB + ":1"); wire(NA + ":2", G + ":0"); wire(NB + ":2", G + ":1"); wire(G + ":2", O + ":0"); return { comps, wires }; }
function buildNorNand(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 320, cy - 70, { state: 0 }), B = comp("in", cx - 320, cy + 70, { state: 0 }), NA = comp("nand", cx - 160, cy - 70), NB = comp("nand", cx - 160, cy + 70), G = comp("nand", cx, cy), INV = comp("nand", cx + 160, cy), O = comp("out", cx + 320, cy); wire(A + ":0", NA + ":0"); wire(A + ":0", NA + ":1"); wire(B + ":0", NB + ":0"); wire(B + ":0", NB + ":1"); wire(NA + ":2", G + ":0"); wire(NB + ":2", G + ":1"); wire(G + ":2", INV + ":0"); wire(G + ":2", INV + ":1"); wire(INV + ":2", O + ":0"); return { comps, wires }; }
function buildXorNand(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 300, cy - 90, { state: 0 }), B = comp("in", cx - 300, cy + 90, { state: 0 }), N1 = comp("nand", cx - 130, cy), N2 = comp("nand", cx + 40, cy - 80), N3 = comp("nand", cx + 40, cy + 80), N4 = comp("nand", cx + 210, cy), O = comp("out", cx + 380, cy); wire(A + ":0", N1 + ":0"); wire(B + ":0", N1 + ":1"); wire(A + ":0", N2 + ":0"); wire(N1 + ":2", N2 + ":1"); wire(B + ":0", N3 + ":0"); wire(N1 + ":2", N3 + ":1"); wire(N2 + ":2", N4 + ":0"); wire(N3 + ":2", N4 + ":1"); wire(N4 + ":2", O + ":0"); return { comps, wires }; }
function buildXnorNand(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 320, cy - 90, { state: 0 }), B = comp("in", cx - 320, cy + 90, { state: 0 }), N1 = comp("nand", cx - 160, cy), N2 = comp("nand", cx - 10, cy - 80), N3 = comp("nand", cx - 10, cy + 80), N4 = comp("nand", cx + 150, cy), N5 = comp("nand", cx + 300, cy), O = comp("out", cx + 450, cy); wire(A + ":0", N1 + ":0"); wire(B + ":0", N1 + ":1"); wire(A + ":0", N2 + ":0"); wire(N1 + ":2", N2 + ":1"); wire(B + ":0", N3 + ":0"); wire(N1 + ":2", N3 + ":1"); wire(N2 + ":2", N4 + ":0"); wire(N3 + ":2", N4 + ":1"); wire(N4 + ":2", N5 + ":0"); wire(N4 + ":2", N5 + ":1"); wire(N5 + ":2", O + ":0"); return { comps, wires }; }
function buildMuxGates(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 280, cy - 100, { state: 0 }), B = comp("in", cx - 280, cy + 10, { state: 0 }), S = comp("in", cx - 280, cy + 120, { state: 0 }), NS = comp("not", cx - 120, cy + 120), AA = comp("and", cx + 30, cy - 60), AB = comp("and", cx + 30, cy + 70), OR1 = comp("or", cx + 190, cy), O = comp("out", cx + 340, cy); wire(S + ":0", NS + ":0"); wire(A + ":0", AA + ":0"); wire(NS + ":1", AA + ":1"); wire(B + ":0", AB + ":0"); wire(S + ":0", AB + ":1"); wire(AA + ":2", OR1 + ":0"); wire(AB + ":2", OR1 + ":1"); wire(OR1 + ":2", O + ":0"); return { comps, wires }; }
function buildHalfAddGates(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 220, cy - 70, { state: 0 }), B = comp("in", cx - 220, cy + 70, { state: 0 }), X = comp("xor", cx - 20, cy - 70), AN = comp("and", cx - 20, cy + 70), S = comp("out", cx + 180, cy - 70), C = comp("out", cx + 180, cy + 70); wire(A + ":0", X + ":0"); wire(B + ":0", X + ":1"); wire(A + ":0", AN + ":0"); wire(B + ":0", AN + ":1"); wire(X + ":2", S + ":0"); wire(AN + ":2", C + ":0"); return { comps, wires }; }
function buildConflictDemo(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 220, cy + 20, { state: 1 }), N = comp("not", cx - 40, cy + 20), H = comp("high", cx - 40, cy - 110), O = comp("out", cx + 180, cy + 20); wire(A + ":0", N + ":0"); wire(N + ":1", O + ":0"); wire(H + ":0", O + ":0"); return { comps, wires }; }
function buildRingOsc(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const N1 = comp("not", cx - 140, cy), N2 = comp("not", cx + 10, cy), N3 = comp("not", cx + 160, cy), O = comp("out", cx + 300, cy - 90); wire(N1 + ":1", N2 + ":0"); wire(N2 + ":1", N3 + ":0"); wire(N3 + ":1", N1 + ":0"); wire(N3 + ":1", O + ":0"); return { comps, wires }; }
function buildConflictFixed(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const A = comp("in", cx - 180, cy, { state: 1 }), N = comp("not", cx, cy), O = comp("out", cx + 180, cy); wire(A + ":0", N + ":0"); wire(N + ":1", O + ":0"); return { comps, wires }; }
function buildFullAddGates(cx, cy) { const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires); const E1 = comp("in", cx - 320, cy - 80, { state: 0 }), E2 = comp("in", cx - 320, cy + 30, { state: 0 }), Ci = comp("in", cx - 320, cy + 150, { state: 0 }), X1 = comp("xor", cx - 150, cy - 30), A1 = comp("and", cx - 150, cy + 90), X2 = comp("xor", cx + 20, cy - 60), A2 = comp("and", cx + 20, cy + 70), O1 = comp("or", cx + 190, cy + 90), S = comp("out", cx + 200, cy - 60), Co = comp("out", cx + 350, cy + 90); wire(E1 + ":0", X1 + ":0"); wire(E2 + ":0", X1 + ":1"); wire(E1 + ":0", A1 + ":0"); wire(E2 + ":0", A1 + ":1"); wire(X1 + ":2", X2 + ":0"); wire(Ci + ":0", X2 + ":1"); wire(X2 + ":2", S + ":0"); wire(X1 + ":2", A2 + ":0"); wire(Ci + ":0", A2 + ":1"); wire(A1 + ":2", O1 + ":0"); wire(A2 + ":2", O1 + ":1"); wire(O1 + ":2", Co + ":0"); return { comps, wires }; }
function buildAccum(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const K = comp("busin", cx - 240, cy - 30, { value: 1 });
  const ADD = comp("add4", cx - 30, cy - 30);
  const REG = comp("reg4", cx + 190, cy - 30, { q: 0 });
  const OUT = comp("busout", cx + 190, cy + 110);
  wires.push({ id: "bw1", a: K + "#out", b: ADD + "#a", bus: 4 });
  wires.push({ id: "bw2", a: REG + "#out", b: ADD + "#b", bus: 4 });
  wires.push({ id: "bw3", a: ADD + "#s", b: REG + "#in", bus: 4 });
  wires.push({ id: "bw4", a: REG + "#out", b: OUT + "#in", bus: 4 });
  return { comps, wires };
}
function buildAdd8(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const Alo = comp("busin", cx - 290, cy - 90, { value: 9 });
  const Blo = comp("busin", cx - 290, cy - 10, { value: 7 });
  const Ahi = comp("busin", cx - 290, cy + 110, { value: 2 });
  const Bhi = comp("busin", cx - 290, cy + 190, { value: 3 });
  const ADlo = comp("add4", cx - 50, cy - 40);
  const ADhi = comp("add4", cx - 50, cy + 150);
  const Olo = comp("busout", cx + 190, cy - 40);
  const Ohi = comp("busout", cx + 190, cy + 150);
  wires.push({ id: "b1", a: Alo + "#out", b: ADlo + "#a", bus: 4 });
  wires.push({ id: "b2", a: Blo + "#out", b: ADlo + "#b", bus: 4 });
  wires.push({ id: "b3", a: ADlo + "#s", b: Olo + "#in", bus: 4 });
  wires.push({ id: "b4", a: Ahi + "#out", b: ADhi + "#a", bus: 4 });
  wires.push({ id: "b5", a: Bhi + "#out", b: ADhi + "#b", bus: 4 });
  wires.push({ id: "b6", a: ADhi + "#s", b: Ohi + "#in", bus: 4 });
  wires.push({ id: "b7", a: ADlo + ":cout", b: ADhi + ":cin" });
  return { comps, wires };
}
function buildBitwise8(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const A = comp("busin", cx - 300, cy - 60, { value: 204, width: 8 });
  const B = comp("busin", cx - 300, cy + 70, { value: 15, width: 8 });
  const AND = comp("busand", cx - 60, cy - 130, { width: 8 });
  const XOR = comp("busxor", cx - 60, cy - 10, { width: 8 });
  const NOT = comp("busnot", cx - 60, cy + 110, { width: 8 });
  const Oand = comp("busout", cx + 180, cy - 130, { width: 8 });
  const Oxor = comp("busout", cx + 180, cy - 10, { width: 8 });
  const Onot = comp("busout", cx + 180, cy + 110, { width: 8 });
  wires.push({ id: "w1", a: A + "#out", b: AND + "#a", bus: 8 });
  wires.push({ id: "w2", a: B + "#out", b: AND + "#b", bus: 8 });
  wires.push({ id: "w3", a: AND + "#s", b: Oand + "#in", bus: 8 });
  wires.push({ id: "w4", a: A + "#out", b: XOR + "#a", bus: 8 });
  wires.push({ id: "w5", a: B + "#out", b: XOR + "#b", bus: 8 });
  wires.push({ id: "w6", a: XOR + "#s", b: Oxor + "#in", bus: 8 });
  wires.push({ id: "w7", a: A + "#out", b: NOT + "#a", bus: 8 });
  wires.push({ id: "w8", a: NOT + "#s", b: Onot + "#in", bus: 8 });
  return { comps, wires };
}
function buildShifter(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const A = comp("busin", cx - 300, cy - 90, { value: 22, width: 8 });
  const T = comp("busin", cx - 300, cy + 40, { value: 2, width: 3 });
  const SL = comp("shl", cx - 60, cy - 120, { width: 8 });
  const SR = comp("shr", cx - 60, cy - 10, { width: 8 });
  const RL = comp("rol", cx - 60, cy + 110, { width: 8 });
  const Osl = comp("busout", cx + 190, cy - 120, { width: 8 });
  const Osr = comp("busout", cx + 190, cy - 10, { width: 8 });
  const Orl = comp("busout", cx + 190, cy + 110, { width: 8 });
  const link = (g, o, n) => { wires.push({ id: n + "a", a: A + "#out", b: g + "#a", bus: 8 }); wires.push({ id: n + "t", a: T + "#out", b: g + "#amt", bus: 3 }); wires.push({ id: n + "s", a: g + "#s", b: o + "#in", bus: 8 }); };
  link(SL, Osl, "1"); link(SR, Osr, "2"); link(RL, Orl, "3");
  return { comps, wires };
}
function buildDecoder(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const S = comp("busin", cx - 210, cy, { value: 5, width: 3 });
  const D = comp("demux", cx - 10, cy, { bits: 3 });
  wires.push({ id: "s", a: S + "#out", b: D + "#sel", bus: 3 });
  for (let j = 0; j < 8; j++) { const o = comp("out", cx + 220, cy + (j - 3.5) * 32); wires.push({ id: "o" + j, a: D + ":o" + j, b: o + ":0" }); }
  return { comps, wires };
}
function buildDelayDemo(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  const A = comp("busin", cx - 300, cy, { width: 8, value: 10 });
  const D = comp("delay", cx - 80, cy, { width: 8, depth: 2, stages: [] });
  const O = comp("busout", cx + 150, cy, { width: 8 });
  w(A + "#out", D + "#in", 8); w(D + "#out", O + "#in", 8);
  return { comps, wires };
}
function buildMultiply(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  const A = comp("busin", cx - 320, cy - 40, { width: 8, value: 12 });
  const B = comp("busin", cx - 320, cy + 40, { width: 8, value: 10 });
  const M = comp("mul", cx - 100, cy, { width: 8 });
  const O = comp("busout", cx + 140, cy, { width: 8 });
  w(A + "#out", M + "#a", 8); w(B + "#out", M + "#b", 8); w(M + "#s", O + "#in", 8);
  return { comps, wires };
}
function buildDivide(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  const A = comp("busin", cx - 320, cy - 40, { width: 8, value: 100 });
  const B = comp("busin", cx - 320, cy + 40, { width: 8, value: 7 });
  const D = comp("divmod", cx - 100, cy, { width: 8 });
  const Q = comp("busout", cx + 150, cy - 36, { width: 8 });
  const R = comp("busout", cx + 150, cy + 36, { width: 8 });
  w(A + "#out", D + "#a", 8); w(B + "#out", D + "#b", 8); w(D + "#q", Q + "#in", 8); w(D + "#r", R + "#in", 8);
  return { comps, wires };
}
function buildAddIndex(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  // Full adder: A=1, B=0, Cin=1 -> S=0, Cout=1
  const A = comp("in", cx - 360, cy - 230, { state: 1 }); const B = comp("in", cx - 360, cy - 190, { state: 0 }); const Ci = comp("in", cx - 360, cy - 150, { state: 1 });
  const FA = comp("fulladd", cx - 170, cy - 190);
  w(A + ":0", FA + ":a"); w(B + ":0", FA + ":b"); w(Ci + ":0", FA + ":cin");
  const LS = comp("out", cx + 60, cy - 200); const LC = comp("out", cx + 60, cy - 168);
  w(FA + ":sum", LS + ":0"); w(FA + ":cout", LC + ":0");
  // IndexBit: constant 0b10110100 (180), select bit 2 -> 1
  const K = comp("busin", cx - 360, cy + 40, { const: true, width: 8, value: 180 });
  const IB = comp("indexbit", cx - 150, cy + 40, { width: 8 });
  const IDX = comp("busin", cx - 360, cy + 150, { width: 3, value: 2 });
  w(K + "#out", IB + "#in", 8); w(IDX + "#out", IB + "#idx", 3);
  const LO = comp("out", cx + 90, cy + 40);
  w(IB + ":out", LO + ":0");
  return { comps, wires };
}
function buildBitConv(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  // word 0b10110010 (178) -> expander -> 8 LEDs + recompress -> busout
  const Wd = comp("busin", cx - 360, cy, { width: 8, value: 178 });
  const X = comp("byteexp", cx - 170, cy, { width: 8 });
  w(Wd + "#out", X + "#in", 8);
  const C = comp("bitcomp", cx + 110, cy, { width: 8 });
  const O = comp("busout", cx + 300, cy, { width: 8 });
  for (let k = 0; k < 8; k++) { const led = comp("out", cx - 20, cy + (k - 3.5) * 30); w(X + ":o" + k, led + ":0"); w(X + ":o" + k, C + ":i" + k); }
  w(C + "#out", O + "#in", 8);
  return { comps, wires };
}
function buildFamily3(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  // --- Signed comparator: A = -3, B = 2 (8 bits) ---
  const A = comp("busin", cx - 380, cy - 250, { value: 253, width: 8 });
  const B = comp("busin", cx - 380, cy - 160, { value: 2, width: 8 });
  const C = comp("cmp", cx - 170, cy - 205, { width: 8, signed: true });
  w(A + "#out", C + "#a", 8); w(B + "#out", C + "#b", 8);
  const Lgt = comp("out", cx + 70, cy - 245); const Leq = comp("out", cx + 70, cy - 205); const Llt = comp("out", cx + 70, cy - 165);
  w(C + ":gt", Lgt + ":0"); w(C + ":eq", Leq + ":0"); w(C + ":lt", Llt + ":0");
  // --- 3-input gates sharing A3/B3/C3 ---
  const A3 = comp("in", cx - 380, cy - 40, { state: 1 }); const B3 = comp("in", cx - 380, cy + 10, { state: 1 }); const C3 = comp("in", cx - 380, cy + 60, { state: 0 });
  const G1 = comp("and3", cx - 170, cy - 5); const G2 = comp("or3", cx - 170, cy + 60);
  w(A3 + ":0", G1 + ":0"); w(B3 + ":0", G1 + ":1"); w(C3 + ":0", G1 + ":3");
  w(A3 + ":0", G2 + ":0"); w(B3 + ":0", G2 + ":1"); w(C3 + ":0", G2 + ":3");
  const O1 = comp("out", cx + 70, cy - 5); const O2 = comp("out", cx + 70, cy + 60);
  w(G1 + ":2", O1 + ":0"); w(G2 + ":2", O2 + ":0");
  // --- Byte split: 0xDEADBEEF (32 bits) -> 4 bytes ---
  const Wd = comp("busin", cx - 380, cy + 215, { value: 0xDEADBEEF, width: 32 });
  const S = comp("bytesplit", cx - 150, cy + 215, { width: 32 });
  w(Wd + "#out", S + "#in", 32);
  for (let b = 0; b < 4; b++) { const ob = comp("busout", cx + 120, cy + 215 + (b - 1.5) * 46, { width: 8 }); w(S + "#o" + b, ob + "#in", 8); }
  return { comps, wires };
}
function buildMuxDemo(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const A = comp("busin", cx - 250, cy - 70, { value: 5 });
  const B = comp("busin", cx - 250, cy + 70, { value: 10 });
  const SEL = comp("in", cx - 250, cy + 180, { state: 0 });
  const M = comp("mux4", cx - 20, cy + 10);
  const OUT = comp("busout", cx + 200, cy + 10);
  wires.push({ id: "b1", a: A + "#out", b: M + "#a", bus: 4 });
  wires.push({ id: "b2", a: B + "#out", b: M + "#b", bus: 4 });
  wires.push({ id: "b3", a: M + "#s", b: OUT + "#in", bus: 4 });
  wires.push({ id: "b4", a: SEL + ":0", b: M + ":sel" });
  return { comps, wires };
}
function buildCompare(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const bw = (a, b, bus) => wires.push({ id: "kw" + (++n), a, b, ...(bus ? { bus } : {}) });
  const A = comp("busin", cx - 300, cy - 60, { value: 9, name: "A" });
  const B = comp("busin", cx - 300, cy + 90, { value: 4, name: "B" });
  const CMP = comp("cmp", cx - 20, cy - 30, { name: "comparateur" });
  const SUB = comp("subb", cx - 20, cy + 110, { name: "soustracteur" });
  const DIFF = comp("busout", cx + 220, cy + 110, { name: "A − B" });
  bw(A + "#out", CMP + "#a", 4); bw(B + "#out", CMP + "#b", 4);
  bw(A + "#out", SUB + "#a", 4); bw(B + "#out", SUB + "#b", 4);
  bw(SUB + "#s", DIFF + "#in", 4);
  return { comps, wires };
}
function buildCounter(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const bw = (a, b, bus) => wires.push({ id: "kw" + (++n), a, b, ...(bus ? { bus } : {}) });
  const K = comp("counter", cx, cy, { q: 0, width: 4 });
  const O = comp("busout", cx + 210, cy, { width: 4 });
  bw(K + "#out", O + "#in", 4);
  return { comps, wires };
}
function buildShiftReg(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const bw = (a, b, bus) => wires.push({ id: "sw" + (++n), a, b, ...(bus ? { bus } : {}) });
  const IN = comp("in", cx - 210, cy, { state: 1 });
  const S = comp("shiftreg", cx, cy, { q: 0, width: 4 });
  const O = comp("busout", cx + 210, cy, { width: 4 });
  wires.push({ id: "sw0", a: IN + ":0", b: S + ":sin" });
  bw(S + "#out", O + "#in", 4);
  return { comps, wires };
}
function buildDacDemo(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const bw = (a, b, bus) => wires.push({ id: "dw" + (++n), a, b, ...(bus ? { bus } : {}) });
  const w = (a, b) => wires.push({ id: "dwa" + (++n), a, b });
  const K = comp("counter", cx - 230, cy, { q: 0, width: 4 });
  const D = comp("dac", cx - 30, cy, { width: 4, vref: 5 });
  const V = comp("voltmeter", cx + 180, cy - 30);
  const G = comp("ground", cx + 40, cy + 95, { orient: 3 });
  bw(K + "#out", D + "#in", 4);
  w(D + ":aout", V + ":0"); w(V + ":1", D + ":gnd"); w(D + ":gnd", G + ":0");
  return { comps, wires };
}
function buildSensorDemo(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const w = (a, b) => wires.push({ id: "sw" + (++n), a, b });
  const B = comp("battery", cx - 230, cy, { value: 5, rInt: 0 });
  const R1 = comp("resistor", cx - 90, cy - 55, { value: 10000 });
  const L = comp("ldr", cx - 90, cy + 55, { light: 0.2 });
  const T = comp("athresh", cx + 70, cy, { value: 2.5 });
  const O = comp("out", cx + 230, cy - 10);
  const G = comp("ground", cx - 90, cy + 125, { orient: 3 });
  w(B + ":0", R1 + ":0"); w(R1 + ":1", L + ":0"); w(L + ":1", B + ":1");
  w(T + ":ain", R1 + ":1"); w(T + ":gnd", B + ":1"); w(B + ":1", G + ":0");
  w(T + ":out", O + ":0");
  return { comps, wires };
}
function buildAdcDemo(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const bw = (a, b, bus) => wires.push({ id: "aw" + (++n), a, b, ...(bus ? { bus } : {}) });
  const w = (a, b) => wires.push({ id: "awa" + (++n), a, b });
  const B = comp("battery", cx - 230, cy, { value: 5, rInt: 0 });
  const R1 = comp("resistor", cx - 90, cy - 55, { value: 10000 });
  const R2 = comp("resistor", cx - 90, cy + 55, { value: 10000 });
  const A = comp("adc", cx + 70, cy, { width: 4, vref: 5 });
  const O = comp("busout", cx + 240, cy, { width: 4 });
  const G = comp("ground", cx - 90, cy + 125, { orient: 3 });
  w(B + ":0", R1 + ":0"); w(R1 + ":1", R2 + ":0"); w(R2 + ":1", B + ":1");
  w(A + ":ain", R1 + ":1"); w(A + ":gnd", B + ":1"); w(B + ":1", G + ":0");
  bw(A + "#out", O + "#in", 4);
  return { comps, wires };
}
function buildPowerSupply(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const w = (a, b) => wires.push({ id: "pw" + (++n), a, b });
  const A = comp("acsource", cx - 380, cy, { value: 24, freq: 50 });
  const X = comp("transformer", cx - 250, cy, { value: 2 });
  const D1 = comp("diode", cx - 120, cy - 70), D2 = comp("diode", cx - 120, cy - 20);
  const D3 = comp("diode", cx - 120, cy + 30), D4 = comp("diode", cx - 120, cy + 80);
  const C = comp("capacitor", cx - 10, cy, { value: 470 });
  const Rs = comp("resistor", cx + 110, cy - 40, { value: 330 });
  const Z = comp("zener", cx + 230, cy, { value: 5.1 });
  const RL = comp("resistor", cx + 360, cy, { value: 1000 });
  const G = comp("ground", cx - 250, cy + 110, { orient: 3 });
  // primary
  w(A + ":0", X + ":0"); w(A + ":1", X + ":1"); w(A + ":1", G + ":0");
  // Graetz bridge (P+ = + terminal of capacitor C:0; ground = G)
  w(D1 + ":0", X + ":2"); w(D1 + ":1", C + ":0");
  w(D2 + ":0", X + ":3"); w(D2 + ":1", C + ":0");
  w(D3 + ":0", G + ":0"); w(D3 + ":1", X + ":2");
  w(D4 + ":0", G + ":0"); w(D4 + ":1", X + ":3");
  w(C + ":1", G + ":0");
  // Zener regulation (output = cathode Z:1)
  w(Rs + ":0", C + ":0"); w(Rs + ":1", Z + ":1");
  w(Z + ":0", G + ":0");
  w(RL + ":0", Z + ":1"); w(RL + ":1", G + ":0");
  return { comps, wires };
}
function buildTransfoExample(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const w = (a, b) => wires.push({ id: "tx" + (++n), a, b });
  const A = comp("acsource", cx - 240, cy, { value: 12, freq: 50 });
  const X = comp("transformer", cx - 80, cy, { value: 2 });
  const VP = comp("voltmeter", cx - 180, cy - 95);
  const VS = comp("voltmeter", cx + 30, cy - 95);
  const RL = comp("resistor", cx + 120, cy, { value: 1000, name: "charge" });
  const G = comp("ground", cx - 240, cy + 105, { orient: 3 });
  w(A + ":0", X + ":0"); w(A + ":1", X + ":1"); w(A + ":1", G + ":0");
  w(X + ":2", RL + ":0"); w(X + ":3", RL + ":1");
  w(VP + ":0", X + ":0"); w(VP + ":1", X + ":1");
  w(VS + ":0", X + ":2"); w(VS + ":1", X + ":3");
  return { comps, wires };
}
function buildSensorAnalog(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires); let n = 0;
  const w = (a, b) => wires.push({ id: "se" + (++n), a, b });
  const B = comp("battery", cx - 200, cy, { value: 5 });
  const R = comp("resistor", cx - 40, cy - 55, { value: 10000, name: "R fixe" });
  const L = comp("ldr", cx - 40, cy + 55, { light: 0.3 });
  const VM = comp("voltmeter", cx + 140, cy);
  const G = comp("ground", cx - 200, cy + 110, { orient: 3 });
  w(B + ":0", R + ":0"); w(R + ":1", L + ":0"); w(L + ":1", B + ":1"); w(B + ":1", G + ":0");
  w(VM + ":0", R + ":1"); w(VM + ":1", L + ":1");
  return { comps, wires };
}
function buildSchmitt(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const B = comp("battery", cx - 220, cy, { value: 2.5, name: "entrée (règle la tension)" });
  const S = comp("schmitt", cx - 30, cy, { vlo: 2, vhi: 3 });
  const O = comp("out", cx + 160, cy);
  const G = comp("ground", cx - 160, cy + 120, { orient: 3 });
  wire(B + ":0", S + ":ain");
  wire(B + ":1", G + ":0"); wire(S + ":gnd", G + ":0");
  wire(S + ":out", O + ":0");
  return { comps, wires };
}
function buildIntegrator(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const Vin = comp("battery", cx - 250, cy - 10, { value: 1, name: "Vin" });
  const R = comp("resistor", cx - 90, cy - 80, { value: 100000, name: "R = 100 kΩ" });
  const C = comp("capacitor", cx + 10, cy - 80, { value: 1, name: "C = 1 µF" });
  const U = comp("opamp", cx + 80, cy, { value: 12 });
  const P = comp("probe", cx + 200, cy - 70, { color: "#37dbf0" });
  const G = comp("ground", cx - 200, cy + 130, { orient: 3 });
  wire(Vin + ":0", R + ":0"); wire(Vin + ":1", G + ":0");
  wire(R + ":1", U + ":1"); wire(R + ":1", C + ":0");
  wire(C + ":1", U + ":2");
  wire(U + ":0", G + ":0");
  wire(U + ":2", P + ":0");
  return { comps, wires };
}
function buildDifferentiator(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const Vin = comp("acsource", cx - 250, cy - 10, { value: 1, freq: 1, name: "Vin ~" });
  const C = comp("capacitor", cx - 90, cy - 80, { value: 1, name: "C = 1 µF" });
  const R = comp("resistor", cx + 10, cy - 80, { value: 100000, name: "R = 100 kΩ" });
  const U = comp("opamp", cx + 80, cy, { value: 12 });
  const Pin = comp("probe", cx - 250, cy + 70, { color: "#ffb020" });
  const Pout = comp("probe", cx + 200, cy - 70, { color: "#37dbf0" });
  const G = comp("ground", cx - 200, cy + 140, { orient: 3 });
  wire(Vin + ":0", C + ":0"); wire(Vin + ":1", G + ":0");
  wire(C + ":1", U + ":1"); wire(C + ":1", R + ":0");
  wire(R + ":1", U + ":2");
  wire(U + ":0", G + ":0");
  wire(Vin + ":0", Pin + ":0");
  wire(U + ":2", Pout + ":0");
  return { comps, wires };
}
function buildRelay(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const Bc = comp("battery", cx - 250, cy - 60, { value: 6, name: "commande (règle-moi)" });
  const Rel = comp("relay", cx - 30, cy - 20, { coilR: 200, vpull: 5, vdrop: 2, state: "open" });
  const Bl = comp("battery", cx - 60, cy + 130, { value: 6, name: "alim. charge" });
  const Lp = comp("lamp", cx + 170, cy - 20, { orient: 1 });
  const G = comp("ground", cx - 250, cy + 120, { orient: 3 });
  wire(Bc + ":0", Rel + ":0"); wire(Rel + ":1", Bc + ":1"); wire(Bc + ":1", G + ":0");
  wire(Bl + ":0", Rel + ":2"); wire(Rel + ":3", Lp + ":0"); wire(Lp + ":1", G + ":0"); wire(Bl + ":1", G + ":0");
  return { comps, wires };
}
function buildNorton(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const I = comp("isource", cx - 210, cy, { value: 0.01, name: "I = 10 mA" });
  const Rn = comp("resistor", cx - 20, cy + 60, { value: 1000, name: "R (Norton)", orient: 1 });
  const RL = comp("resistor", cx + 170, cy + 60, { value: 1000, name: "charge", orient: 1 });
  const Vm = comp("voltmeter", cx + 170, cy - 90, { orient: 1 });
  const G = comp("ground", cx - 210, cy + 150, { orient: 3 });
  wire(I + ":0", Rn + ":1"); wire(Rn + ":1", RL + ":1");
  wire(I + ":1", G + ":0"); wire(Rn + ":0", G + ":0"); wire(RL + ":0", G + ":0");
  wire(Vm + ":0", RL + ":1"); wire(Vm + ":1", RL + ":0");
  return { comps, wires };
}
function buildVcvsAmp(cx, cy) {
  const comps = [], wires = []; const { comp, wire } = mkBuilder(comps, wires);
  const Bin = comp("battery", cx - 250, cy + 10, { value: 0.5, name: "Vin = 0,5 V" });
  const E = comp("vcvs", cx - 20, cy, { value: 10 });
  const RL = comp("resistor", cx + 175, cy + 65, { value: 1000, name: "charge", orient: 1 });
  const Pin = comp("probe", cx - 250, cy - 95, { color: "#ffb020" });
  const Pout = comp("probe", cx + 255, cy - 70, { color: "#37dbf0" });
  const G = comp("ground", cx - 250, cy + 125, { orient: 3 });
  wire(Bin + ":0", E + ":0"); wire(Bin + ":1", E + ":1"); wire(Bin + ":1", G + ":0");
  wire(E + ":2", RL + ":1"); wire(RL + ":0", E + ":3"); wire(E + ":3", G + ":0");
  wire(Bin + ":0", Pin + ":0"); wire(E + ":2", Pout + ":0");
  return { comps, wires };
}
function buildBidirBus(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  // Port A drives the shared line (#io) from a value; port B, in read mode, copies it to #out.
  const VA = comp("busin", cx - 360, cy - 70, { width: 8, value: 0xA5 });
  const DA = comp("high", cx - 360, cy + 30, {});
  const A = comp("bidir", cx - 150, cy - 20, { width: 8 });
  const B = comp("bidir", cx + 110, cy - 20, { width: 8 });
  const DB = comp("low", cx + 110, cy + 90, {});
  const OB = comp("busout", cx + 340, cy - 20, { width: 8 });
  w(VA + "#out", A + "#in", 8); w(DA + ":0", A + ":dir");
  w(A + "#io", B + "#io", 8);
  w(DB + ":0", B + ":dir"); w(B + "#out", OB + "#in", 8);
  return { comps, wires };
}
function buildDualPortRam(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  const mem = Array(16).fill(0); mem[3] = 0x2A; mem[7] = 0x5C;
  const AA = comp("busin", cx - 360, cy - 90, { width: 4, value: 3 });
  const AB = comp("busin", cx - 360, cy + 90, { width: 4, value: 7 });
  const R = comp("dualram", cx - 90, cy, { width: 8, cells: 16, mem });
  const OA = comp("busout", cx + 280, cy - 60, { width: 8 });
  const OB = comp("busout", cx + 280, cy + 60, { width: 8 });
  w(AA + "#out", R + "#addrA", 4); w(AB + "#out", R + "#addrB", 4);
  w(R + "#outA", OA + "#in", 8); w(R + "#outB", OB + "#in", 8);
  return { comps, wires };
}
function buildLatchRam(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  const mem = Array(16).fill(0); mem[5] = 0x99;
  const AD = comp("busin", cx - 300, cy, { width: 4, value: 5 });
  const R = comp("latchram", cx - 60, cy, { width: 8, cells: 16, mem, oreg: 0 });
  const O = comp("busout", cx + 230, cy, { width: 8 });
  w(AD + "#out", R + "#addr", 4); w(R + "#out", O + "#in", 8);
  return { comps, wires };
}
function buildFullMul(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b, bus) => wires.push({ id: "w" + wires.length, a, b, ...(bus ? { bus } : {}) });
  const A = comp("busin", cx - 320, cy - 50, { width: 8, value: 200 });
  const B = comp("busin", cx - 320, cy + 50, { width: 8, value: 200 });
  const M = comp("mul", cx - 90, cy, { width: 8 });
  const HI = comp("busout", cx + 180, cy - 45, { width: 8 });
  const LO = comp("busout", cx + 180, cy + 45, { width: 8 });
  w(A + "#out", M + "#a", 8); w(B + "#out", M + "#b", 8);
  w(M + "#hi", HI + "#in", 8); w(M + "#s", LO + "#in", 8);
  return { comps, wires };
}
function buildJunctionFanout(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b) => wires.push({ id: "w" + wires.length, a, b });
  // one source, a junction, three readers — all on the same node.
  const I = comp("in", cx - 280, cy, { state: 1 });
  const N = comp("node", cx - 100, cy, {});
  const O1 = comp("out", cx + 130, cy - 80, {});
  const O2 = comp("out", cx + 150, cy, {});
  const O3 = comp("out", cx + 130, cy + 80, {});
  w(I + ":0", N + ":0"); w(N + ":2", O1 + ":0"); w(N + ":1", O2 + ":0"); w(N + ":3", O3 + ":0");
  return { comps, wires };
}
function buildBbMontage(cx, cy) {
  const comps = [], wires = []; const { comp } = mkBuilder(comps, wires);
  const w = (a, b) => wires.push({ id: "w" + wires.length, a, b });
  // Breadboard first-circuit demo. Hole pitch 20, colX(C) = (C-32.5)*20, bottom block row +2P (=+40).
  // battery → [board tie col12] → resistor → [board tie col16] → lamp → single jumper (col8↔col20) → battery.
  const BB = comp("breadboard", cx, cy, { name: "Plaque" });
  const BAT = comp("battery", cx - 450, cy + 40, { value: 9 });   // legs col8 / col12
  const R = comp("resistor", cx - 370, cy + 40, { value: 10 });   // legs col12 / col16
  const L = comp("lamp", cx - 290, cy + 40, {});                  // legs col16 / col20
  w(BAT + ":1", L + ":0");                                        // close the loop with one jumper
  return { comps, wires };
}
const BUILDERS = { capteur: buildSensorAnalog, transfo: buildTransfoExample, alim: buildPowerSupply, dacdemo: buildDacDemo, sensordemo: buildSensorDemo, adcdemo: buildAdcDemo, counter: buildCounter, shiftreg: buildShiftReg, conflit: buildConflictDemo, oscill: buildRingOsc, conflitok: buildConflictFixed, ram: buildRamDemo, tristate: buildTristateBus, compare: buildCompare, bitwise8: buildBitwise8, shifter: buildShifter, decoder: buildDecoder, family3: buildFamily3, addindex: buildAddIndex, bitconv: buildBitConv, multiply: buildMultiply, divide: buildDivide, delayline: buildDelayDemo, bidirbus: buildBidirBus, dualportram: buildDualPortRam, latchramex: buildLatchRam, fullmul: buildFullMul, junctionfanout: buildJunctionFanout, bb_montage: buildBbMontage, cmos: buildCmosInverter, cmosnand: buildCmosNand, zenerreg: buildZenerReg, cpu: buildCpu, add8: buildAdd8, muxDemo: buildMuxDemo, accum: buildAccum, notNand: buildNotNand, andNand: buildAndNand, orNand: buildOrNand, norNand: buildNorNand, xorNand: buildXorNand, xnorNand: buildXnorNand, muxGates: buildMuxGates, halfAddGates: buildHalfAddGates, fullAddGates: buildFullAddGates, simple: buildSimple, rectifier: buildRectifier, ampli: buildAmpli, ampliaop: buildAmpliAOP, series: buildSeries, parallel: buildParallel, ohm: buildOhm, potlamp: buildPotLamp, motor: buildMotor, fuse: buildFuse, weakbat: buildWeakBat, brokenOpen: buildBrokenOpen, brokenVolt: buildBrokenVolt, brokenShort: buildBrokenShort, rc: buildRC, rl: buildRL, ac: buildAC, acrc: buildACFilter, rlc: buildRLC, gnd: buildGround, watt: buildWatt, vavient: buildVaVient, rlcunder: mkRlcStep(6), rlccrit: mkRlcStep(63), rlcover: mkRlcStep(200), maxpow: buildMaxPow, mmeter: buildMultimeter, kirch: buildKirchhoff, divider: buildDivider, wheatstone: buildWheatstone, schmitt: buildSchmitt, integrator: buildIntegrator, differentiator: buildDifferentiator, relay: buildRelay, norton: buildNorton, vcvsamp: buildVcvsAmp };

export { BUILDERS };
