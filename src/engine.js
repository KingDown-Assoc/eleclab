/*
 * ÉlecLab — simulation ENGINE (pure, no React or UI).
 *  A) Analog solver: modified nodal analysis (MNA) for DC + AC,
 *     diodes/MOSFET (Newton), measurements, frequency/step response.
 *  B) Logic / bus engine: gates, chips, buses, adders, CPU.
 * Split out of ElecLab.jsx. No external dependency: importable from the app
 * (Vite) and from tests (Node).
 */

const LAMP_R = 30; // résistance interne d'une ampoule (Ω)

function makeUF() {
  const parent = {};
  const find = (x) => { if (parent[x] === undefined) parent[x] = x; while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  return { find, union };
}
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-15) continue;
    [M[col], M[piv]] = [M[piv], M[col]];
    const pv = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) { const d = M[i][i]; x[i] = Math.abs(d) < 1e-15 ? 0 : M[i][n] / d; }
  return x;
}
const FUSE_R = 1e-3, RINT_MIN = 1e-4, IND_DC = 1e-3;
/* resistance of a resistive element (Ω), or null if open / non-resistive */
function elemR(c) {
  if (c.type === "resistor" || c.type === "pot" || c.type === "motor") return Math.max(c.value || 1e-6, 1e-6);
  if (c.type === "relay") return Math.max(c.coilR || 200, 1);
  if (c.type === "lamp") return LAMP_R;
  if (c.type === "fuse") return c.state === "blown" ? null : FUSE_R;
  // Photoresistor (LDR): dark → max R, light → min R (log interpolation over light level 0..1).
  if (c.type === "ldr") { const L = c.light == null ? 0.5 : Math.max(0, Math.min(1, c.light)); const Rmin = c.rmin || 200, Rmax = c.rmax || 200000; return Math.max(Rmin, Rmax * Math.pow(Rmin / Rmax, L)); }
  // NTC thermistor: R = R0·exp(B·(1/T − 1/T0)), R0 at 25 °C; R drops as temperature rises.
  if (c.type === "thermistor") { const T = ((c.temp == null ? 25 : c.temp) + 273.15), T0 = 298.15, R0 = c.r0 || 10000, B = c.beta || 3950; return Math.max(1, R0 * Math.exp(B * (1 / T - 1 / T0))); }
  return null;
}
// Junction (Shockley) model for diode / LED — the LED has a higher threshold.
function diodeModel(c) { return c.type === "led" ? { Is: 1e-19, n: 2 } : { Is: 1e-12, n: 1 }; }
// Junction-voltage limiting between Newton iterations (prevents exp divergence).
function pnjlim(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) { const a = 1 + (vnew - vold) / vt; vnew = a > 0 ? vold + vt * Math.log(a) : vcrit; }
    else if (vnew > 0) { vnew = vt * Math.log(Math.max(vnew / vt, 1e-9)); }
  }
  return vnew;
}
const batRint = (c) => (c.type === "battery" && c.rInt && c.rInt > 0 ? Math.max(c.rInt, RINT_MIN) : 0);

// Level-1 MOSFET model (Shichman-Hodges), written on the NMOS side.
// vgs/vds in NMOS convention (PMOS: pass vsg/vsd, same equations).
const MOS_VTH = 1.0, MOS_KP = 2e-3, MOS_LAM = 0.02, MOS_GMIN = 1e-12;
function mosCore(vgs, vds) {
  const vov = vgs - MOS_VTH;
  let Id, gm, gds;
  if (vov <= 0) { Id = 0; gm = 0; gds = 0; }
  else if (vds < vov) { Id = MOS_KP * (vov * vds - 0.5 * vds * vds); gm = MOS_KP * vds; gds = MOS_KP * (vov - vds); }
  else { const f = 1 + MOS_LAM * vds; Id = 0.5 * MOS_KP * vov * vov * f; gm = MOS_KP * vov * f; gds = 0.5 * MOS_KP * vov * vov * MOS_LAM; }
  return { Id, gm, gds: gds + MOS_GMIN };
}
// Operating region (for display).
function mosRegion(vgs, vds) {
  const vov = vgs - MOS_VTH; if (vov <= 0) return "bloqué"; return vds < vov ? "ohmique" : "saturé";
}
// Newton step limiter.
const mosLim = (vn, vo, d) => { const dv = vn - vo; return dv > d ? vo + d : dv < -d ? vo - d : vn; };

function solveCircuit(components, wires, tr) {
  const GMIN = 1e-9;
  const uf = makeUF();
  for (const c of components) for (const p of c.pins) uf.find(p);
  for (const w of wires) uf.union(w.a, w.b);
  for (const c of components) if (c.type === "switch" && c.state === "closed") uf.union(c.pins[0], c.pins[1]);
  for (const c of components) if (c.type === "spdt") uf.union(c.pins[0], c.state === "2" ? c.pins[2] : c.pins[1]);
  for (const c of components) if (c.type === "relay" && c.state === "closed") uf.union(c.pins[2], c.pins[3]);
  const gnds = components.filter((c) => c.type === "ground");
  for (let i = 1; i < gnds.length; i++) uf.union(gnds[0].pins[0], gnds[i].pins[0]);
  const nodeOf = (pid) => uf.find(pid);

  let ref = null;
  if (gnds.length) ref = nodeOf(gnds[0].pins[0]);
  if (ref === null) { const b = components.find((c) => c.type === "battery" || c.type === "acsource"); if (b) ref = nodeOf(b.pins[1]); }
  if (ref === null) return { ok: false, reason: "NO_SOURCE", result: {}, nodeVoltage: {} };

  const intKey = (c) => "INT:" + c.id;
  const nodeIndex = {};
  let N = 0;
  const addNode = (key) => { if (key === ref) return; if (!(key in nodeIndex)) nodeIndex[key] = N++; };
  const roots = new Set(components.flatMap((c) => c.pins.map(nodeOf)));
  for (const r of roots) addNode(r);
  for (const c of components) if (batRint(c) > 0) addNode(intKey(c));
  const kidx = (key) => (key === ref ? -1 : nodeIndex[key]);
  const idx = (pid) => kidx(nodeOf(pid));

  const acE = (c) => { const amp = c.value || 0, f = c.freq || 1; return (tr && tr.dt > 0) ? amp * Math.sin(2 * Math.PI * f * (tr.t || 0)) : amp; };
  const vsources = [];
  for (const c of components) {
    if (c.type === "battery") { const ri = batRint(c); vsources.push({ c, pKey: ri > 0 ? intKey(c) : nodeOf(c.pins[0]), nKey: nodeOf(c.pins[1]), E: c.value }); }
    if (c.type === "acsource") vsources.push({ c, pKey: nodeOf(c.pins[0]), nKey: nodeOf(c.pins[1]), E: acE(c) });
    if (c.type === "ammeter" || c.type === "wattmeter") vsources.push({ c, pKey: nodeOf(c.pins[0]), nKey: nodeOf(c.pins[1]), E: 0 });
    if (c.type === "multimeter" && c.mode === "A") vsources.push({ c, pKey: nodeOf(c.pins[0]), nKey: nodeOf(c.pins[1]), E: 0 });
  }
  const opamps = [];
  for (const c of components) if (c.type === "opamp") opamps.push({ id: c.id, out: nodeOf(c.pins[2]), p: nodeOf(c.pins[0]), n: nodeOf(c.pins[1]), Vsat: Math.max(c.value || 12, 0.5) });
  const xfmrs = [];
  for (const c of components) if (c.type === "transformer") xfmrs.push({ id: c.id, p1: nodeOf(c.pins[0]), p2: nodeOf(c.pins[1]), s1: nodeOf(c.pins[2]), s2: nodeOf(c.pins[3]), a: Math.max(Math.abs(c.value) || 2, 0.01) });
  const isrcs = components.filter((c) => c.type === "isource");
  const vcvss = components.filter((c) => c.type === "vcvs");
  const vccss = components.filter((c) => c.type === "vccs");
  const ccvss = components.filter((c) => c.type === "ccvs");
  const cccss = components.filter((c) => c.type === "cccs");
  const nDep = vcvss.length + 2 * ccvss.length + cccss.length; // extra branch unknowns
  const m = vsources.length, nOp = opamps.length, nXf = xfmrs.length, size = N + m + nOp + nXf + nDep;
  const A = Array.from({ length: size }, () => new Array(size).fill(0));
  const b = new Array(size).fill(0);

  const stampR = (ka, kb, R) => {
    if (R <= 0) R = 1e-6;
    const g = 1 / R, a = kidx(ka), bb = kidx(kb);
    if (a >= 0) A[a][a] += g;
    if (bb >= 0) A[bb][bb] += g;
    if (a >= 0 && bb >= 0) { A[a][bb] -= g; A[bb][a] -= g; }
  };

  let shortCircuit = false;
  for (const c of components) { const R = elemR(c); if (R !== null) stampR(nodeOf(c.pins[0]), nodeOf(c.pins[1]), R); }
  for (const c of components) { const ri = batRint(c); if (ri > 0) stampR(intKey(c), nodeOf(c.pins[0]), ri); }
  for (const c of components) if (c.type === "inductor" && !(tr && tr.dt > 0)) stampR(nodeOf(c.pins[0]), nodeOf(c.pins[1]), IND_DC);
  for (let i = 0; i < N; i++) A[i][i] += GMIN;

  vsources.forEach((s, k) => {
    const row = N + k;
    const pi = kidx(s.pKey), ni = kidx(s.nKey);
    if (pi === ni) shortCircuit = true;
    if (pi >= 0) { A[pi][row] += 1; A[row][pi] += 1; }
    if (ni >= 0) { A[ni][row] -= 1; A[row][ni] -= 1; }
    b[row] = s.E;
  });
  const opMap = {};
  opamps.forEach((o, j) => {
    o.row = N + m + j; opMap[o.id] = o;
    const oi = kidx(o.out);
    if (oi >= 0) { A[oi][o.row] += 1; A[o.row][oi] += 1; }
  });
  // Ideal transformer: Vp = a·Vs (a = Np/Ns), Is = −a·Ip. One unknown (Ip) + one constraint, symmetric stamp.
  const xfMap = {};
  xfmrs.forEach((t, j) => {
    const row = N + m + nOp + j; t.row = row; xfMap[t.id] = t; const a = t.a;
    const P = kidx(t.p1), Q = kidx(t.p2), S = kidx(t.s1), U = kidx(t.s2);
    if (P >= 0) { A[P][row] += 1; A[row][P] += 1; }
    if (Q >= 0) { A[Q][row] -= 1; A[row][Q] -= 1; }
    if (S >= 0) { A[S][row] -= a; A[row][S] -= a; }
    if (U >= 0) { A[U][row] += a; A[row][U] += a; }
  });
  // Sources: independent current source (RHS injection) and dependent sources (2-port models).
  // Ports: in+ = pin0, in- = pin1, out+ = pin2, out- = pin3. The input port of voltage-
  // controlled sources is high-impedance (the per-node GMIN avoids singularity); that of
  // current-controlled sources is a short whose current we read (branch unknown).
  const vcvsInfo = {}, vccsInfo = {}, ccvsInfo = {}, cccsInfo = {};
  for (const c of isrcs) {
    const I = c.value || 0, a = idx(c.pins[0]), bn = idx(c.pins[1]);
    if (a >= 0) b[a] += I; if (bn >= 0) b[bn] -= I; // courant délivré : sort de pin0, rentre par pin1
  }
  for (const c of vccss) {
    const g = c.value || 0, cp = idx(c.pins[0]), cn = idx(c.pins[1]), op = idx(c.pins[2]), on = idx(c.pins[3]);
    if (op >= 0) { if (cp >= 0) A[op][cp] += g; if (cn >= 0) A[op][cn] -= g; }
    if (on >= 0) { if (cp >= 0) A[on][cp] -= g; if (cn >= 0) A[on][cn] += g; }
    vccsInfo[c.id] = { cp: nodeOf(c.pins[0]), cn: nodeOf(c.pins[1]), op: nodeOf(c.pins[2]), on: nodeOf(c.pins[3]) };
  }
  let depRow = N + m + nOp + nXf;
  for (const c of vcvss) {
    const mu = c.value == null ? 2 : c.value, row = depRow++;
    const cp = idx(c.pins[0]), cn = idx(c.pins[1]), op = idx(c.pins[2]), on = idx(c.pins[3]);
    if (op >= 0) { A[op][row] += 1; A[row][op] += 1; }
    if (on >= 0) { A[on][row] -= 1; A[row][on] -= 1; }
    if (cp >= 0) A[row][cp] -= mu;
    if (cn >= 0) A[row][cn] += mu;
    vcvsInfo[c.id] = { row, op: nodeOf(c.pins[2]), on: nodeOf(c.pins[3]) };
  }
  for (const c of ccvss) {
    const r = c.value == null ? 1000 : c.value, rowIn = depRow++, rowOut = depRow++;
    const ip = idx(c.pins[0]), inn = idx(c.pins[1]), op = idx(c.pins[2]), on = idx(c.pins[3]);
    if (ip >= 0) { A[ip][rowIn] += 1; A[rowIn][ip] += 1; }
    if (inn >= 0) { A[inn][rowIn] -= 1; A[rowIn][inn] -= 1; }
    if (op >= 0) { A[op][rowOut] += 1; A[rowOut][op] += 1; }
    if (on >= 0) { A[on][rowOut] -= 1; A[rowOut][on] -= 1; }
    A[rowOut][rowIn] -= r; // V(out) = r * i_in
    ccvsInfo[c.id] = { rowIn, rowOut, op: nodeOf(c.pins[2]), on: nodeOf(c.pins[3]) };
  }
  for (const c of cccss) {
    const beta = c.value == null ? 10 : c.value, rowIn = depRow++;
    const ip = idx(c.pins[0]), inn = idx(c.pins[1]), op = idx(c.pins[2]), on = idx(c.pins[3]);
    if (ip >= 0) { A[ip][rowIn] += 1; A[rowIn][ip] += 1; }
    if (inn >= 0) { A[inn][rowIn] -= 1; A[rowIn][inn] -= 1; }
    if (op >= 0) A[op][rowIn] += beta; // I_out = beta * i_in, de out+ vers out-
    if (on >= 0) A[on][rowIn] -= beta;
    cccsInfo[c.id] = { rowIn, op: nodeOf(c.pins[2]), on: nodeOf(c.pins[3]) };
  }
  // 555 timer (relaxation macro-model): the internal flip-flop ("out" state) is carried from one step to the next.
  // Output high -> OUT pulled to VCC, discharge transistor OPEN; output low -> OUT to GND, DIS pulled to ground.
  const R555 = 10;
  const timers = [], timerMap = {};
  for (const c of components) if (c.type === "timer555") {
    const t = { id: c.id, vcc: nodeOf(c.pins[0]), gnd: nodeOf(c.pins[1]), out: nodeOf(c.pins[2]), dis: nodeOf(c.pins[3]), thr: nodeOf(c.pins[4]), trg: nodeOf(c.pins[5]), st: (tr && tr.latch && (c.id in tr.latch)) ? tr.latch[c.id] : 1 };
    timers.push(t); timerMap[c.id] = t;
    if (t.st) stampR(t.out, t.vcc, R555); else { stampR(t.out, t.gnd, R555); stampR(t.dis, t.gnd, R555); }
  }

  // Reactive elements: backward-Euler companion models (transient only)
  const capInfo = {}, indInfo = {};
  if (tr && tr.dt > 0) {
    for (const c of components) {
      if (c.type === "capacitor") {
        const C = Math.max((c.value || 0) * 1e-6, 1e-12);
        const Geq = C / tr.dt;
        const Vprev = (tr.capV && tr.capV[c.id]) || 0;
        const Ieq = Geq * Vprev;
        stampR(nodeOf(c.pins[0]), nodeOf(c.pins[1]), 1 / Geq);
        const ka = idx(c.pins[0]), kb = idx(c.pins[1]);
        if (ka >= 0) b[ka] += Ieq;
        if (kb >= 0) b[kb] -= Ieq;
        capInfo[c.id] = { Geq, Ieq };
      } else if (c.type === "inductor") {
        const L = Math.max(c.value || 0, 1e-9);
        const Geq = tr.dt / L;
        const Iprev = (tr.indI && tr.indI[c.id]) || 0;
        stampR(nodeOf(c.pins[0]), nodeOf(c.pins[1]), 1 / Geq);
        const ka = idx(c.pins[0]), kb = idx(c.pins[1]);
        if (ka >= 0) b[ka] -= Iprev;
        if (kb >= 0) b[kb] += Iprev;
        indInfo[c.id] = { Geq, Iprev };
      }
    }
  }

  const VT = 0.02585;
  const nlEls = components.filter((c) => c.type === "diode" || c.type === "led" || c.type === "zener" || c.type === "npn" || c.type === "nmos" || c.type === "pmos" || c.type === "opamp");
  let x;
  if (!nlEls.length) {
    x = solveLinear(A, b);
  } else {
    const BF = 200, BR = 2, BIS = 1e-15;
    const st = {};
    nlEls.forEach((c) => { st[c.id] = c.type === "npn" ? { vbe: 0.6, vbc: -1 } : (c.type === "nmos" || c.type === "pmos") ? { vc: 0, vd: 0.1 } : c.type === "zener" ? { vd: -0.5 } : { vd: c.type === "opamp" ? 0 : 0.5 }; });
    let xi = solveLinear(A, b);
    for (let it = 0; it < 200; it++) {
      const Ai = A.map((r) => r.slice()), bi = b.slice();
      for (const c of nlEls) {
        if (c.type === "npn") {
          const nc = idx(c.pins[0]), nb = idx(c.pins[1]), ne = idx(c.pins[2]);
          const vbe = st[c.id].vbe, vbc = st[c.id].vbc;
          const ebe = Math.exp(Math.min(vbe / VT, 80)), ebc = Math.exp(Math.min(vbc / VT, 80));
          const Ic = BIS * ((ebe - ebc) - (ebc - 1) / BR);
          const Ib = BIS * ((ebe - 1) / BF + (ebc - 1) / BR);
          const Ie = -(Ic + Ib);
          const gicbe = BIS * ebe / VT, gicbc = -(BIS * ebc / VT) * (1 + 1 / BR);
          const gibbe = BIS * ebe / (BF * VT), gibbc = BIS * ebc / (BR * VT);
          const gm = 1e-12;
          const g = {
            c: { c: -gicbc + gm, b: gicbe + gicbc - gm, e: -gicbe },
            b: { c: -gibbc - gm, b: gibbe + gibbc + 2 * gm, e: -gibbe - gm },
            e: { c: gicbc + gibbc, b: -(gicbe + gicbc + gibbe + gibbc) - gm, e: gicbe + gibbe + gm },
          };
          // Equivalent currents: linearized at the limited (vbe, vbc) point, not at raw node voltages.
          const Ieq = {
            c: Ic - gicbe * vbe - gicbc * vbc,
            b: Ib - gibbe * vbe - gibbc * vbc,
            e: Ie + (gicbe + gibbe) * vbe + (gicbc + gibbc) * vbc,
          };
          const nodeIdx = { c: nc, b: nb, e: ne };
          for (const xk of ["c", "b", "e"]) {
            const nx = nodeIdx[xk]; if (nx < 0) continue;
            bi[nx] -= Ieq[xk];
            for (const yk of ["c", "b", "e"]) { const ny = nodeIdx[yk]; if (ny >= 0) Ai[nx][ny] += g[xk][yk]; }
          }
        } else if (c.type === "nmos" || c.type === "pmos") {
          const nd = idx(c.pins[0]), ng = idx(c.pins[1]), ns = idx(c.pins[2]);
          const vc = st[c.id].vc, vds = st[c.id].vd;
          const mm = mosCore(vc, vds); const gm = mm.gm, gds = mm.gds;
          const Ieq0 = c.type === "nmos" ? (mm.Id - gm * vc - gds * vds) : (-mm.Id + gm * vc + gds * vds);
          const g = {
            d: { d: gds, g: gm, s: -(gm + gds) },
            g: { d: 0, g: 0, s: 0 },
            s: { d: -gds, g: -gm, s: gm + gds },
          };
          const Ieq = { d: Ieq0, g: 0, s: -Ieq0 };
          const nodeIdx = { d: nd, g: ng, s: ns };
          for (const xk of ["d", "g", "s"]) {
            const nx = nodeIdx[xk]; if (nx < 0) continue;
            bi[nx] -= Ieq[xk];
            for (const yk of ["d", "g", "s"]) { const ny = nodeIdx[yk]; if (ny >= 0) Ai[nx][ny] += g[xk][yk]; }
          }
        } else if (c.type === "opamp") {
          const o = opMap[c.id], ro = o.row, Aol = 1e5;
          const np = kidx(o.p), nn = kidx(o.n);
          const vd = st[c.id].vd;
          const th = Math.tanh(Aol * vd / o.Vsat);
          const g0 = o.Vsat * th, gp = Aol * (1 - th * th);
          if (np >= 0) Ai[ro][np] -= gp;
          if (nn >= 0) Ai[ro][nn] += gp;
          bi[ro] = g0 - gp * vd;
        } else if (c.type === "zener") {
          const Vz = c.value > 0 ? c.value : 5.1;
          const Is = 1e-12, nvt = VT, Izs = 1e-9, nzt = 0.3 * VT;
          const v = st[c.id].vd;
          const ep = Math.exp(Math.min(v / nvt, 80)), en = Math.exp(Math.min(-(v + Vz) / nzt, 80));
          const Id = Is * (ep - 1) - Izs * (en - 1);
          const Gd = (Is / nvt) * ep + (Izs / nzt) * en + 1e-12;
          const Ieq = Id - Gd * v;
          const a = idx(c.pins[0]), k = idx(c.pins[1]);
          if (a >= 0) { Ai[a][a] += Gd; bi[a] -= Ieq; }
          if (k >= 0) { Ai[k][k] += Gd; bi[k] += Ieq; }
          if (a >= 0 && k >= 0) { Ai[a][k] -= Gd; Ai[k][a] -= Gd; }
        } else {
          const { Is, n } = diodeModel(c), nvt = n * VT;
          const v = st[c.id].vd, ev = Math.exp(Math.min(v / nvt, 80));
          const Id = Is * (ev - 1), Gd = (Is / nvt) * ev, Ieq = Id - Gd * v;
          const a = idx(c.pins[0]), k = idx(c.pins[1]);
          if (a >= 0) { Ai[a][a] += Gd; bi[a] -= Ieq; }
          if (k >= 0) { Ai[k][k] += Gd; bi[k] += Ieq; }
          if (a >= 0 && k >= 0) { Ai[a][k] -= Gd; Ai[k][a] -= Gd; }
        }
      }
      xi = solveLinear(Ai, bi);
      let maxdv = 0;
      for (const c of nlEls) {
        if (c.type === "npn") {
          const nc = idx(c.pins[0]), nb = idx(c.pins[1]), ne = idx(c.pins[2]);
          const Vc = nc < 0 ? 0 : xi[nc], Vb = nb < 0 ? 0 : xi[nb], Ve = ne < 0 ? 0 : xi[ne];
          const vcrit = VT * Math.log(VT / (Math.SQRT2 * BIS));
          const nvbe = pnjlim(Vb - Ve, st[c.id].vbe, VT, vcrit), nvbc = pnjlim(Vb - Vc, st[c.id].vbc, VT, vcrit);
          maxdv = Math.max(maxdv, Math.abs(nvbe - st[c.id].vbe), Math.abs(nvbc - st[c.id].vbc));
          st[c.id].vbe = nvbe; st[c.id].vbc = nvbc;
        } else if (c.type === "nmos" || c.type === "pmos") {
          const nd = idx(c.pins[0]), ng = idx(c.pins[1]), ns = idx(c.pins[2]);
          const Vd = nd < 0 ? 0 : xi[nd], Vg = ng < 0 ? 0 : xi[ng], Vs = ns < 0 ? 0 : xi[ns];
          const nvc = c.type === "nmos" ? mosLim(Vg - Vs, st[c.id].vc, 1.0) : mosLim(Vs - Vg, st[c.id].vc, 1.0);
          const nvd = c.type === "nmos" ? mosLim(Vd - Vs, st[c.id].vd, 2.0) : mosLim(Vs - Vd, st[c.id].vd, 2.0);
          maxdv = Math.max(maxdv, Math.abs(nvc - st[c.id].vc), Math.abs(nvd - st[c.id].vd));
          st[c.id].vc = nvc; st[c.id].vd = nvd;
        } else if (c.type === "opamp") {
          const o = opMap[c.id];
          const np = kidx(o.p), nn = kidx(o.n);
          const Vp = np < 0 ? 0 : xi[np], Vn = nn < 0 ? 0 : xi[nn];
          const nvd = Vp - Vn;
          maxdv = Math.max(maxdv, Math.abs(nvd - st[c.id].vd));
          st[c.id].vd = nvd;
        } else if (c.type === "zener") {
          const a = idx(c.pins[0]), k = idx(c.pins[1]);
          const va = a < 0 ? 0 : xi[a], vk = k < 0 ? 0 : xi[k];
          const Vz = c.value > 0 ? c.value : 5.1;
          const old = st[c.id].vd; let nv = va - vk; const maxStep = 1.0;
          if (nv - old > maxStep) nv = old + maxStep; else if (old - nv > maxStep) nv = old - maxStep;
          if (nv > 1.2) nv = 1.2; if (nv < -(Vz + 8)) nv = -(Vz + 8);
          maxdv = Math.max(maxdv, Math.abs(nv - old));
          st[c.id].vd = nv;
        } else {
          const a = idx(c.pins[0]), k = idx(c.pins[1]);
          const va = a < 0 ? 0 : xi[a], vk = k < 0 ? 0 : xi[k];
          const { Is, n } = diodeModel(c), nvt = n * VT;
          const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * Is));
          const nv = pnjlim(va - vk, st[c.id].vd, nvt, vcrit);
          maxdv = Math.max(maxdv, Math.abs(nv - st[c.id].vd));
          st[c.id].vd = nv;
        }
      }
      if (maxdv < 1e-7) break;
    }
    x = xi;
  }
  const Vk = (key) => { const i = kidx(key); return i < 0 ? 0 : x[i]; };
  const V = (pid) => Vk(nodeOf(pid));
  const sourceCurrents = new Map();
  vsources.forEach((s, k) => sourceCurrents.set(s.c.id, x[N + k]));
  const latch555 = {};

  const result = {};
  const capV = {}, indI = {};
  for (const c of components) {
    if (c.type === "npn") {
      const BF = 200, BR = 2, BIS = 1e-15;
      const Vc = V(c.pins[0]), Vb = V(c.pins[1]), Ve = V(c.pins[2]);
      const vbe = Vb - Ve, vbc = Vb - Vc;
      const ebe = Math.exp(Math.min(vbe / 0.02585, 80)), ebc = Math.exp(Math.min(vbc / 0.02585, 80));
      const Ic = BIS * ((ebe - ebc) - (ebc - 1) / BR), Ib = BIS * ((ebe - 1) / BF + (ebc - 1) / BR);
      if (Math.abs(Ic) > 50 || Math.abs(Ib) > 50) shortCircuit = true;
      result[c.id] = { ic: Ic, ib: Ib, ie: -(Ic + Ib), vce: Vc - Ve, vbe, voltage: Vc - Ve, current: Ic, power: (Vc - Ve) * Ic, na: nodeOf(c.pins[0]), nb: nodeOf(c.pins[1]), nce: nodeOf(c.pins[2]) };
      continue;
    }
    if (c.type === "transformer") {
      const t = xfMap[c.id]; const ip = t ? x[t.row] : 0; const a = t ? t.a : 1;
      const vp = V(c.pins[0]) - V(c.pins[1]), vs = V(c.pins[2]) - V(c.pins[3]);
      result[c.id] = { vp, vs, ip, is: -a * ip, voltage: vs, current: Math.abs(ip), power: 0, na: nodeOf(c.pins[2]), nb: nodeOf(c.pins[3]) };
      continue;
    }
    if (c.type === "timer555") {
      const t = timerMap[c.id];
      const Vcc = Vk(t.vcc) - Vk(t.gnd), Vhi = (2 / 3) * Vcc, Vlo = (1 / 3) * Vcc;
      const vthr = Vk(t.thr) - Vk(t.gnd), vtrg = Vk(t.trg) - Vk(t.gnd);
      let ns = t.st;
      if (vtrg < Vlo) ns = 1; else if (vthr > Vhi) ns = 0;
      latch555[c.id] = ns;
      result[c.id] = { out: t.st, vthr, vtrg, vcc: Vcc, voltage: Vk(t.out) - Vk(t.gnd), current: 0, power: 0, na: nodeOf(c.pins[2]), nb: nodeOf(c.pins[1]) };
      continue;
    }
    if (c.type === "nmos" || c.type === "pmos") {
      const Vd = V(c.pins[0]), Vg = V(c.pins[1]), Vs = V(c.pins[2]);
      const vc = c.type === "nmos" ? (Vg - Vs) : (Vs - Vg);
      const vdsDev = c.type === "nmos" ? (Vd - Vs) : (Vs - Vd);
      const Id = (c.type === "nmos" ? 1 : -1) * mosCore(vc, vdsDev).Id;
      if (Math.abs(Id) > 50) shortCircuit = true;
      result[c.id] = { id: Id, vgs: vc, vds: vdsDev, region: mosRegion(vc, vdsDev), voltage: vdsDev, current: Math.abs(Id), power: Math.abs(vdsDev * Id), na: nodeOf(c.pins[0]), nb: nodeOf(c.pins[1]), nce: nodeOf(c.pins[2]) };
      continue;
    }
    if (c.type === "opamp") {
      const o = opMap[c.id];
      const Vp = V(c.pins[0]), Vn = V(c.pins[1]), Vo = V(c.pins[2]);
      const io = o ? x[o.row] : 0;
      result[c.id] = { vout: Vo, vp: Vp, vn: Vn, vdiff: Vp - Vn, voltage: Vo, current: io, power: 0, na: nodeOf(c.pins[2]), nb: ref };
      continue;
    }
    if (c.type === "isource") {
      const I = c.value || 0, va = V(c.pins[0]), vb = V(c.pins[1]);
      result[c.id] = { voltage: va - vb, current: I, power: (va - vb) * I, na: nodeOf(c.pins[0]), nb: nodeOf(c.pins[1]) };
      continue;
    }
    if (c.type === "vccs") {
      const inf = vccsInfo[c.id], vin = Vk(inf.cp) - Vk(inf.cn), I = (c.value || 0) * vin, vout = Vk(inf.op) - Vk(inf.on);
      result[c.id] = { vin, iout: I, voltage: vout, current: I, power: vout * I, na: inf.op, nb: inf.on };
      continue;
    }
    if (c.type === "vcvs") {
      const inf = vcvsInfo[c.id], io = x[inf.row], vout = Vk(inf.op) - Vk(inf.on), vin = V(c.pins[0]) - V(c.pins[1]);
      result[c.id] = { vin, vout, voltage: vout, current: io, power: vout * io, na: inf.op, nb: inf.on };
      continue;
    }
    if (c.type === "ccvs") {
      const inf = ccvsInfo[c.id], iin = x[inf.rowIn], io = x[inf.rowOut], vout = Vk(inf.op) - Vk(inf.on);
      result[c.id] = { iin, vout, voltage: vout, current: io, power: vout * io, na: inf.op, nb: inf.on };
      continue;
    }
    if (c.type === "cccs") {
      const inf = cccsInfo[c.id], iin = x[inf.rowIn], I = (c.value == null ? 10 : c.value) * iin, vout = Vk(inf.op) - Vk(inf.on);
      result[c.id] = { iin, iout: I, voltage: vout, current: I, power: vout * I, na: inf.op, nb: inf.on };
      continue;
    }
    const va = V(c.pins[0]); const vb = c.pins[1] !== undefined ? V(c.pins[1]) : 0;
    let current = 0, voltage = va - vb, power = 0;
    const R = elemR(c);
    if (c.type === "resistor" || c.type === "pot" || c.type === "motor" || c.type === "lamp") { current = voltage / (R || 1e-6); power = voltage * current; }
    else if (c.type === "relay") { current = voltage / Math.max(c.coilR || 200, 1); power = voltage * current; }
    else if (c.type === "fuse") { current = R === null ? 0 : voltage / R; }
    else if (c.type === "battery" || c.type === "acsource") { current = sourceCurrents.get(c.id) || 0; power = voltage * current; }
    else if (c.type === "ammeter") { current = sourceCurrents.get(c.id) || 0; voltage = 0; }
    else if (c.type === "wattmeter") { current = sourceCurrents.get(c.id) || 0; power = va * current; voltage = 0; }
    else if (c.type === "multimeter") { if (c.mode === "A") { current = sourceCurrents.get(c.id) || 0; voltage = 0; } else { current = 0; } }
    else if (c.type === "voltmeter" || c.type === "switch" || c.type === "spdt") { current = 0; }
    else if (c.type === "diode" || c.type === "led") {
      const { Is, n } = diodeModel(c), nvt = n * 0.02585;
      current = Is * (Math.exp(Math.min(voltage / nvt, 80)) - 1);
      power = voltage * current;
    }
    else if (c.type === "zener") {
      const Vz = c.value > 0 ? c.value : 5.1;
      const ep = Math.exp(Math.min(voltage / 0.02585, 80)), en = Math.exp(Math.min(-(voltage + Vz) / (0.3 * 0.02585), 80));
      current = 1e-12 * (ep - 1) - 1e-9 * (en - 1);
      power = voltage * current;
    }
    else if (c.type === "capacitor") {
      const ci = capInfo[c.id];
      current = ci ? ci.Geq * voltage - ci.Ieq : 0; // 0 en statique (ouvert)
      power = voltage * current;
      capV[c.id] = voltage;
    }
    else if (c.type === "inductor") {
      if (tr && tr.dt > 0) { const ii = indInfo[c.id]; current = ii ? ii.Geq * voltage + ii.Iprev : 0; }
      else { current = voltage / IND_DC; } // static: near short, current = loop current
      indI[c.id] = current; power = voltage * current;
    }
    if (Math.abs(current) > 50) shortCircuit = true;
    result[c.id] = {
      voltage, current, power,
      na: nodeOf(c.pins[0]),
      nb: c.pins[1] !== undefined ? nodeOf(c.pins[1]) : null,
    };
  }
  const nodeVoltage = {};
  for (const r of roots) nodeVoltage[r] = Vk(r);
  return { ok: true, result, nodeVoltage, ref, shortCircuit, capV, indI, latch555 };
}

/* ---- Sinusoidal steady state: complex-impedance analysis (frequency response) ---- */
const cMul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cDiv = (a, b) => { const d = b.re * b.re + b.im * b.im || 1e-30; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
const cAbs = (a) => Math.hypot(a.re, a.im);
function solveComplex(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r.map((z) => ({ ...z })), { ...b[i] }]);
  for (let c = 0; c < n; c++) {
    let pv = c; for (let r = c + 1; r < n; r++) if (cAbs(M[r][c]) > cAbs(M[pv][c])) pv = r;
    if (cAbs(M[pv][c]) < 1e-18) continue;
    [M[c], M[pv]] = [M[pv], M[c]];
    const p = M[c][c];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = cDiv(M[r][c], p);
      if (cAbs(f) === 0) continue;
      for (let k = c; k <= n; k++) { const t = cMul(f, M[c][k]); M[r][k] = { re: M[r][k].re - t.re, im: M[r][k].im - t.im }; }
    }
  }
  const x = new Array(n).fill(0).map(() => ({ re: 0, im: 0 }));
  for (let i = 0; i < n; i++) { const d = M[i][i]; x[i] = cAbs(d) < 1e-18 ? { re: 0, im: 0 } : cDiv(M[i][n], d); }
  return x;
}
// Returns the current amplitude delivered by the 1st AC source at angular frequency omega
function solveAC(components, wires, omega) {
  const uf = makeUF();
  for (const c of components) for (const p of c.pins) uf.find(p);
  for (const w of wires) uf.union(w.a, w.b);
  for (const c of components) {
    if (c.type === "switch" && c.state === "closed") uf.union(c.pins[0], c.pins[1]);
    if (c.type === "spdt") uf.union(c.pins[0], c.state === "2" ? c.pins[2] : c.pins[1]);
    if (c.type === "multimeter" && c.mode === "A") uf.union(c.pins[0], c.pins[1]);
    if (c.type === "battery" || c.type === "ammeter" || c.type === "wattmeter") uf.union(c.pins[0], c.pins[1]); // sources continues / mesures série = court-circuit en régime sinusoïdal
  }
  const nodeOf = (pid) => uf.find(pid);
  const acs = components.filter((c) => c.type === "acsource");
  if (!acs.length) return 0;
  let ref = null;
  for (const c of components) if (c.type === "ground") { ref = nodeOf(c.pins[0]); break; }
  if (ref === null) ref = nodeOf(acs[0].pins[1]);
  const nodeIndex = {}; let N = 0;
  const addNode = (k) => { if (k === ref) return; if (!(k in nodeIndex)) nodeIndex[k] = N++; };
  for (const c of components) for (const p of c.pins) addNode(nodeOf(p));
  const kidx = (k) => (k === ref ? -1 : nodeIndex[k]);
  const m = acs.length, size = N + m;
  const A = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ re: 0, im: 0 })));
  const b = Array.from({ length: size }, () => ({ re: 0, im: 0 }));
  const stampY = (ka, kb, Y) => {
    const a = kidx(ka), bb = kidx(kb);
    if (a >= 0) { A[a][a].re += Y.re; A[a][a].im += Y.im; }
    if (bb >= 0) { A[bb][bb].re += Y.re; A[bb][bb].im += Y.im; }
    if (a >= 0 && bb >= 0) { A[a][bb].re -= Y.re; A[a][bb].im -= Y.im; A[bb][a].re -= Y.re; A[bb][a].im -= Y.im; }
  };
  for (const c of components) {
    const a = nodeOf(c.pins[0]), bb = nodeOf(c.pins[1]);
    if (c.type === "resistor" || c.type === "pot" || c.type === "motor" || c.type === "lamp") stampY(a, bb, { re: 1 / Math.max(c.value || 1e-6, 1e-6), im: 0 });
    else if (c.type === "fuse") { if (c.state !== "blown") stampY(a, bb, { re: 1 / FUSE_R, im: 0 }); }
    else if (c.type === "capacitor") stampY(a, bb, { re: 0, im: omega * Math.max((c.value || 0) * 1e-6, 1e-12) });
    else if (c.type === "inductor") stampY(a, bb, { re: 0, im: -1 / (omega * Math.max(c.value || 0, 1e-9)) });
  }
  for (let i = 0; i < N; i++) A[i][i].re += 1e-9;
  acs.forEach((s, k) => {
    const row = N + k, pi = kidx(nodeOf(s.pins[0])), nidx = kidx(nodeOf(s.pins[1]));
    if (pi >= 0) { A[pi][row].re += 1; A[row][pi].re += 1; }
    if (nidx >= 0) { A[nidx][row].re -= 1; A[row][nidx].re -= 1; }
    b[row] = { re: s.value || 0, im: 0 };
  });
  const x = solveComplex(A, b);
  return cAbs(x[N]); // current amplitude of the 1st ~ source
}
function freqResponse(components, wires) {
  if (!components.some((c) => c.type === "acsource")) return null;
  const Lc = components.find((c) => c.type === "inductor");
  const Cc = components.find((c) => c.type === "capacitor");
  let f0Theo = null;
  if (Lc && Cc) { const L = Math.max(Lc.value || 0, 1e-9), C = Math.max((Cc.value || 0) * 1e-6, 1e-12); f0Theo = 1 / (2 * Math.PI * Math.sqrt(L * C)); }
  const center = f0Theo || 1;
  const lo = Math.max(center / 40, 0.02), hi = center * 40;
  const pts = []; const Ns = 80;
  let fPeak = lo, magPeak = -1;
  for (let i = 0; i <= Ns; i++) {
    const f = lo * Math.pow(hi / lo, i / Ns);
    const mag = solveAC(components, wires, 2 * Math.PI * f);
    pts.push({ f, mag });
    if (mag > magPeak) { magPeak = mag; fPeak = f; }
  }
  return { points: pts, f0Theo, fPeak, magPeak, lo, hi };
}

/* Nodal sinusoidal solver: returns the complex nodal voltages (phasors) and the
   complex current of the 1st ~ source at angular frequency omega. Enables gain/phase and impedance. */
function solveACNodes(components, wires, omega) {
  const uf = makeUF();
  for (const c of components) for (const p of c.pins) uf.find(p);
  for (const w of wires) uf.union(w.a, w.b);
  for (const c of components) {
    if (c.type === "switch" && c.state === "closed") uf.union(c.pins[0], c.pins[1]);
    if (c.type === "spdt") uf.union(c.pins[0], c.state === "2" ? c.pins[2] : c.pins[1]);
    if (c.type === "multimeter" && c.mode === "A") uf.union(c.pins[0], c.pins[1]);
    if (c.type === "battery" || c.type === "ammeter" || c.type === "wattmeter") uf.union(c.pins[0], c.pins[1]);
  }
  const nodeOf = (pid) => uf.find(pid);
  const acs = components.filter((c) => c.type === "acsource");
  if (!acs.length) return { ok: false };
  let ref = null;
  for (const c of components) if (c.type === "ground") { ref = nodeOf(c.pins[0]); break; }
  if (ref === null) ref = nodeOf(acs[0].pins[1]);
  const nodeIndex = {}; let N = 0;
  const addNode = (k) => { if (k === ref) return; if (!(k in nodeIndex)) nodeIndex[k] = N++; };
  for (const c of components) for (const p of c.pins) addNode(nodeOf(p));
  const kidx = (k) => (k === ref ? -1 : nodeIndex[k]);
  const m = acs.length, size = N + m;
  if (size === 0) return { ok: false };
  const A = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ re: 0, im: 0 })));
  const b = Array.from({ length: size }, () => ({ re: 0, im: 0 }));
  const stampY = (ka, kb, Y) => {
    const a = kidx(ka), bb = kidx(kb);
    if (a >= 0) { A[a][a].re += Y.re; A[a][a].im += Y.im; }
    if (bb >= 0) { A[bb][bb].re += Y.re; A[bb][bb].im += Y.im; }
    if (a >= 0 && bb >= 0) { A[a][bb].re -= Y.re; A[a][bb].im -= Y.im; A[bb][a].re -= Y.re; A[bb][a].im -= Y.im; }
  };
  for (const c of components) {
    const a = nodeOf(c.pins[0]), bb = nodeOf(c.pins[1]);
    if (c.type === "resistor" || c.type === "pot" || c.type === "motor" || c.type === "lamp") stampY(a, bb, { re: 1 / Math.max(c.value || 1e-6, 1e-6), im: 0 });
    else if (c.type === "fuse") { if (c.state !== "blown") stampY(a, bb, { re: 1 / FUSE_R, im: 0 }); }
    else if (c.type === "capacitor") stampY(a, bb, { re: 0, im: omega * Math.max((c.value || 0) * 1e-6, 1e-12) });
    else if (c.type === "inductor") stampY(a, bb, { re: 0, im: -1 / (omega * Math.max(c.value || 0, 1e-9)) });
  }
  for (let i = 0; i < N; i++) A[i][i].re += 1e-9;
  acs.forEach((s, k) => {
    const row = N + k, pi = kidx(nodeOf(s.pins[0])), nidx = kidx(nodeOf(s.pins[1]));
    if (pi >= 0) { A[pi][row].re += 1; A[row][pi].re += 1; }
    if (nidx >= 0) { A[nidx][row].re -= 1; A[row][nidx].re -= 1; }
    b[row] = { re: s.value || 0, im: 0 };
  });
  const x = solveComplex(A, b);
  const Vpin = (pid) => { const i = kidx(nodeOf(pid)); return i < 0 ? { re: 0, im: 0 } : { ...x[i] }; };
  return { ok: true, Vpin, srcCur: { ...x[N] }, srcPins: acs[0].pins, N };
}

/* Frequency analysis of an arbitrary ~ circuit: gain (dB) and phase of output / input,
   plus l'impédance vue par la source, sur un balayage de fréquences.
   Output auto-picked: voltmeter > probe (vs ground) > 1st capacitor > 1st inductor > 1st resistor. */
function acAnalysis(components, wires, opts = {}) {
  const acs = components.filter((c) => c.type === "acsource");
  if (!acs.length) return null;
  const src = acs[0];
  const Vin = Math.max(Math.abs(src.value || 0), 1e-9);
  let outA = null, outB = null, outLabel = "";
  const vm = components.find((c) => c.type === "voltmeter" || (c.type === "multimeter" && c.mode === "V"));
  const probe = components.find((c) => c.type === "probe");
  if (opts.outA && opts.outB) { outA = opts.outA; outB = opts.outB; outLabel = opts.outLabel || "sortie"; }
  else if (vm) { outA = vm.pins[0]; outB = vm.pins[1]; outLabel = "voltmètre"; }
  else if (probe) { outA = probe.pins[0]; outB = null; outLabel = "sonde / masse"; }
  else {
    const cap = components.find((c) => c.type === "capacitor");
    const ind = components.find((c) => c.type === "inductor");
    const res = components.find((c) => c.type === "resistor");
    const t = cap || ind || res;
    if (t) { outA = t.pins[0]; outB = t.pins[1]; outLabel = "sur " + (t.name || t.type); }
  }
  if (!outA) return null;
  const Lc = components.find((c) => c.type === "inductor");
  const Cc = components.find((c) => c.type === "capacitor");
  const Rsum = components.filter((c) => c.type === "resistor" || c.type === "pot").reduce((s, c) => s + Math.max(c.value || 0, 1), 0) || 1000;
  let center = 1000;
  if (Lc && Cc) { const L = Math.max(Lc.value || 0, 1e-9), C = Math.max((Cc.value || 0) * 1e-6, 1e-12); center = 1 / (2 * Math.PI * Math.sqrt(L * C)); }
  else if (Cc) { center = 1 / (2 * Math.PI * Rsum * Math.max((Cc.value || 0) * 1e-6, 1e-12)); }
  else if (Lc) { center = Rsum / (2 * Math.PI * Math.max(Lc.value || 0, 1e-9)); }
  const lo = Math.max(center / 1000, 1e-3), hi = center * 1000;
  const Ns = 100;
  const wrap = (deg) => ((deg + 540) % 360) - 180;
  const pts = [];
  let f3db = null, dcGain = null;
  for (let i = 0; i <= Ns; i++) {
    const f = lo * Math.pow(hi / lo, i / Ns), w = 2 * Math.PI * f;
    const r = solveACNodes(components, wires, w);
    if (!r.ok) return null;
    const va = r.Vpin(outA), vb = outB ? r.Vpin(outB) : { re: 0, im: 0 };
    const Vout = { re: va.re - vb.re, im: va.im - vb.im };
    const H = cDiv(Vout, { re: src.value || 0, im: 0 });
    const mag = cAbs(H), gainDb = 20 * Math.log10(Math.max(mag, 1e-9));
    const phaseDeg = wrap((Math.atan2(H.im, H.re) * 180) / Math.PI);
    const Z = cDiv({ re: src.value || 0, im: 0 }, { re: -r.srcCur.re, im: -r.srcCur.im });
    const zMag = cAbs(Z), zPhase = wrap((Math.atan2(Z.im, Z.re) * 180) / Math.PI);
    if (i === 0) dcGain = gainDb;
    pts.push({ f, gainDb, mag, phaseDeg, zMag, zPhase });
  }
  const gMax = pts.reduce((mx, p) => Math.max(mx, p.gainDb), -Infinity);
  for (let i = 1; i < pts.length; i++) { if (pts[i - 1].gainDb >= gMax - 3 && pts[i].gainDb < gMax - 3) { f3db = pts[i].f; break; } }
  let zAtSrc = null;
  if (src.freq && src.freq > 0) {
    const r = solveACNodes(components, wires, 2 * Math.PI * src.freq);
    if (r.ok) { const Z = cDiv({ re: src.value || 0, im: 0 }, { re: -r.srcCur.re, im: -r.srcCur.im }); zAtSrc = { f: src.freq, mag: cAbs(Z), phase: wrap((Math.atan2(Z.im, Z.re) * 180) / Math.PI) }; }
  }
  return { points: pts, lo, hi, center, f3db, gMax, dcGain, outLabel, Vin, zAtSrc };
}

/* Step-response analysis of a series RLC (from the values, series circuit assumed) */
function stepResponse(components) {
  if (components.some((c) => c.type === "acsource")) return { ok: false };
  if (!components.some((c) => c.type === "battery")) return { ok: false };
  const inds = components.filter((c) => c.type === "inductor");
  const caps = components.filter((c) => c.type === "capacitor");
  if (!inds.length || !caps.length) return { ok: false };
  let R = 0;
  for (const c of components) { const r = elemR(c); if (r != null) R += r; R += batRint(c); }
  const L = inds.reduce((s, c) => s + Math.max(c.value || 0, 1e-9), 0);
  const C = 1 / caps.reduce((s, c) => s + 1 / Math.max((c.value || 0) * 1e-6, 1e-12), 0);
  if (!(L > 0) || !(C > 0)) return { ok: false };
  const w0 = 1 / Math.sqrt(L * C), alpha = R / (2 * L), zeta = alpha / w0;
  const Rcrit = 2 * Math.sqrt(L / C);
  let regime, wd = 0, Td = 0;
  if (zeta < 0.995) { regime = "oscillatoire"; wd = Math.sqrt(Math.max(w0 * w0 - alpha * alpha, 0)); Td = wd > 0 ? 2 * Math.PI / wd : 0; }
  else if (zeta <= 1.005) regime = "critique";
  else regime = "apériodique";
  return { ok: true, R, L, C, w0, f0: w0 / (2 * Math.PI), alpha, zeta, Rcrit, regime, wd, Td };
}

/* Power transfer: source (E, r) -> load. Load power is maximal when R_load = r. */
function maxPower(components, sim) {
  if (!sim || !sim.ok || sim.shortCircuit) return { ok: false };
  if (components.some((c) => c.type === "acsource")) return { ok: false };
  const bats = components.filter((c) => c.type === "battery");
  if (bats.length !== 1) return { ok: false };
  const b = bats[0];
  const r = batRint(b);
  if (!(r > 0)) return { ok: false };
  const E = b.value || 0;
  const I = Math.abs(sim.result[b.id]?.current || 0);
  if (I <= 1e-6) return { ok: false };
  const Ptot = E * I, Pr = I * I * r, PL = Math.max(Ptot - Pr, 0);
  const RL = Math.max(E / I - r, 0);
  const eta = Ptot > 0 ? PL / Ptot : 0;
  const Pmax = E * E / (4 * r);
  return { ok: true, E, r, I, RL, PL, Pr, Ptot, eta, Pmax, ratio: RL / r };
}

/* Ohmmeter: equivalent resistance between the multimeter's 2 terminals, sources off
   (ideal battery -> short, otherwise its internal resistance; ~ -> short). */
function measureResistance(components, wires, mmId) {
  const mm = components.find((c) => c.id === mmId);
  if (!mm) return { ok: false };
  const nP = (c) => (c.type === "ground" ? 1 : c.type === "spdt" ? 3 : 2);
  const uf = makeUF();
  for (const c of components) { const n = nP(c); for (let i = 0; i < n; i++) uf.find(c.id + ":" + i); }
  for (const w of wires) uf.union(w.a, w.b);
  for (const c of components) {
    if (c.id === mmId) continue;
    if (c.type === "switch") { if (c.state === "closed") uf.union(c.id + ":0", c.id + ":1"); }
    else if (c.type === "spdt") uf.union(c.id + ":0", c.state === "2" ? c.id + ":2" : c.id + ":1");
    else if (c.type === "inductor" || c.type === "acsource" || c.type === "ammeter" || c.type === "wattmeter") uf.union(c.id + ":0", c.id + ":1");
    else if (c.type === "multimeter" && c.mode === "A") uf.union(c.id + ":0", c.id + ":1");
    else if (c.type === "battery" && batRint(c) <= 0) uf.union(c.id + ":0", c.id + ":1");
  }
  const gnds = components.filter((c) => c.type === "ground");
  for (let i = 1; i < gnds.length; i++) uf.union(gnds[0].id + ":0", gnds[i].id + ":0");
  const nodeOf = (p) => uf.find(p);
  const nA = nodeOf(mm.id + ":0"), nB = nodeOf(mm.id + ":1");
  if (nA === nB) return { ok: true, R: 0 };
  const G = [];
  for (const c of components) {
    if (c.id === mmId) continue;
    const r = elemR(c);
    if (r != null && r > 0) G.push([nodeOf(c.id + ":0"), nodeOf(c.id + ":1"), 1 / r]);
    else if (c.type === "battery" && batRint(c) > 0) G.push([nodeOf(c.id + ":0"), nodeOf(c.id + ":1"), 1 / batRint(c)]);
  }
  const uf2 = makeUF();
  G.forEach((e) => uf2.union(e[0], e[1]));
  if (G.length === 0 || uf2.find(nA) !== uf2.find(nB)) return { ok: true, R: Infinity };
  const nodeSet = [...new Set(G.flatMap((e) => [e[0], e[1]]))].filter((n) => n !== nB);
  const idx = {}; nodeSet.forEach((n, i) => (idx[n] = i));
  if (idx[nA] === undefined) return { ok: true, R: Infinity };
  const N = nodeSet.length;
  const A = Array.from({ length: N }, () => new Array(N).fill(0));
  const b = new Array(N).fill(0);
  for (const e of G) {
    const ia = e[0] === nB ? -1 : idx[e[0]], ib = e[1] === nB ? -1 : idx[e[1]], g = e[2];
    if (ia >= 0) A[ia][ia] += g;
    if (ib >= 0) A[ib][ib] += g;
    if (ia >= 0 && ib >= 0) { A[ia][ib] -= g; A[ib][ia] -= g; }
  }
  b[idx[nA]] = 1;
  const x = solveLinear(A, b);
  const R = x[idx[nA]];
  return { ok: true, R: R > 1e-9 && isFinite(R) ? R : (R <= 1e-9 ? 0 : Infinity) };
}

/* Kirchhoff's laws: current law (Σ I = 0) and voltage law (Σ U = 0). */
function kirchhoffAnalysis(components, sim) {
  if (!sim || !sim.ok || sim.shortCircuit) return { ok: false };
  const isBranch = (c) => ["resistor", "pot", "motor", "lamp", "fuse", "battery", "acsource", "inductor", "capacitor", "ammeter", "wattmeter"].includes(c.type) || (c.type === "multimeter" && c.mode === "A");
  const Vof = (n) => (n === sim.ref ? 0 : (sim.nodeVoltage[n] ?? 0));
  const branches = [];
  for (const c of components) {
    if (!isBranch(c)) continue;
    const r = sim.result[c.id]; if (!r) continue;
    if (r.na == null || r.nb == null || r.na === r.nb) continue;
    branches.push({ c, na: r.na, nb: r.nb, r });
  }
  if (branches.length < 2) return { ok: false };
  const nodeIds = [...new Set(branches.flatMap((b) => [b.na, b.nb]))];
  const nodes = [];
  // current leaving the component at pin idx = current entering the node;
  // uniform rule (battery, ammeter/wattmeter, passives): pin0 -> -I, pin1 -> +I, with I = res.current (pin0->pin1 direction)
  const intoNode = (r, idx) => (idx === 0 ? -r.current : r.current);
  for (const n of nodeIds) {
    const terms = [];
    for (const b of branches) {
      if (b.na === n) terms.push({ label: compLabel(b.c, components), inI: intoNode(b.r, 0) });
      if (b.nb === n) terms.push({ label: compLabel(b.c, components), inI: intoNode(b.r, 1) });
    }
    if (terms.length < 2) continue;
    const sum = terms.reduce((s, t) => s + t.inI, 0);
    nodes.push({ V: Vof(n), terms, sum, junction: terms.length >= 3 });
  }
  nodes.sort((a, b) => (b.junction - a.junction) || (b.V - a.V));
  const uf = makeUF();
  const treeEdges = [], chords = [];
  branches.forEach((b, i) => { if (uf.find(b.na) !== uf.find(b.nb)) { uf.union(b.na, b.nb); treeEdges.push(i); } else chords.push(i); });
  const adj = {};
  treeEdges.forEach((i) => { const b = branches[i]; (adj[b.na] = adj[b.na] || []).push({ to: b.nb, e: i }); (adj[b.nb] = adj[b.nb] || []).push({ to: b.na, e: i }); });
  const loops = [];
  for (const ci of chords.slice(0, 6)) {
    const ch = branches[ci];
    const prev = { [ch.na]: null }; const q = [ch.na]; let found = false;
    while (q.length) { const u = q.shift(); if (u === ch.nb) { found = true; break; } for (const { to, e } of (adj[u] || [])) if (!(to in prev)) { prev[to] = { node: u, e }; q.push(to); } }
    if (!found) continue;
    const seq = [{ e: ci, from: ch.na, to: ch.nb }];
    let cur = ch.nb, p = prev[cur];
    while (p) { seq.push({ e: p.e, from: cur, to: p.node }); cur = p.node; p = prev[cur]; }
    const items = seq.map((s) => { const b = branches[s.e]; return { label: compLabel(b.c, components), drop: Vof(s.from) - Vof(s.to) }; });
    const sum = items.reduce((s, it) => s + it.drop, 0);
    loops.push({ items, sum });
  }
  return { ok: true, nodes: nodes.slice(0, 8), loops };
}

const compNet = (components, override = {}) =>
  components.map((c) => ({
    id: c.id, type: c.type, value: c.value, rInt: c.rInt, freq: c.freq, q: c.q, light: c.light, temp: c.temp,
    state: override[c.id]?.state ?? c.state,
    pins: c.type === "ground" || c.type === "in" || c.type === "out" || c.type === "clock" || c.type === "high" || c.type === "low" || c.type === "probe" ? [c.id + ":0"]
      : c.type === "not" ? [c.id + ":0", c.id + ":1"]
      : c.type === "seg7" ? [c.id + ":0", c.id + ":1", c.id + ":2", c.id + ":3"]
      : c.type === "and3" || c.type === "or3" ? [c.id + ":0", c.id + ":1", c.id + ":2", c.id + ":3"]
      : c.type === "node" ? [c.id + ":0", c.id + ":1", c.id + ":2", c.id + ":3"]
      : c.type === "arduino" ? [c.id + ":d2", c.id + ":d3", c.id + ":d4", c.id + ":d5", c.id + ":d6", c.id + ":d7", c.id + ":d8", c.id + ":d9", c.id + ":d10", c.id + ":d11", c.id + ":d12", c.id + ":d13", c.id + ":a0", c.id + ":a1", c.id + ":a2", c.id + ":a3", c.id + ":a4", c.id + ":a5", c.id + ":5v", c.id + ":gnd"]
      : c.type === "breadboard" ? []
      : c.type === "spdt" || c.type === "npn" || c.type === "nmos" || c.type === "pmos" || c.type === "opamp" || c.type === "srlatch" || c.type === "zbuf" || c.type === "and" || c.type === "or" || c.type === "nand" || c.type === "nor" || c.type === "xor" || c.type === "xnor" ? [c.id + ":0", c.id + ":1", c.id + ":2"]
      : c.type === "transformer" ? [c.id + ":0", c.id + ":1", c.id + ":2", c.id + ":3"]
      : c.type === "relay" ? [c.id + ":0", c.id + ":1", c.id + ":2", c.id + ":3"]
      : c.type === "vcvs" || c.type === "vccs" || c.type === "ccvs" || c.type === "cccs" ? [c.id + ":0", c.id + ":1", c.id + ":2", c.id + ":3"]
      : c.type === "timer555" ? [c.id + ":vcc", c.id + ":gnd", c.id + ":out", c.id + ":dis", c.id + ":thr", c.id + ":trg"]
      : [c.id + ":0", c.id + ":1"],
  }));

const LOGIC_GATES = ["not", "and", "or", "nand", "nor", "xor", "xnor", "and3", "or3"];
const LOGIC_TYPES = ["in", "out", "clock", "high", "low", "dff", "srlatch", "seg7", ...LOGIC_GATES];
const SEG7_MAP = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg", 10: "abcefg", 11: "cdefg", 12: "adef", 13: "bcdeg", 14: "adefg", 15: "aefg" };
function solveLogic(components, wires) {
  const uf = makeUF();
  for (const c of components) for (const p of c.pins) uf.find(p);
  for (const w of wires) uf.union(w.a, w.b);
  const net = (pin) => uf.find(pin);
  const level = {};
  const isHi = (s) => s === 1 || s === "1" || s === true || s === "on";
  for (const c of components) {
    if (c.type === "in" || c.type === "clock") level[net(c.pins[0])] = isHi(c.state) ? 1 : 0;
    if (c.type === "high") level[net(c.pins[0])] = 1;
    if (c.type === "low") level[net(c.pins[0])] = 0;
    if (c.type === "dff") level[net(c.pins[1])] = isHi(c.q) ? 1 : 0;
  }
  const gates = components.filter((c) => LOGIC_GATES.includes(c.type));
  const zbufs = components.filter((c) => c.type === "zbuf");
  const zMap = {}; for (const z of zbufs) { const n = net(z.pins[2]); (zMap[n] = zMap[n] || []).push(z); }
  const hasZ = zbufs.length > 0;
  const lv = (pin) => (level[net(pin)] ? 1 : 0);
  const evalGate = (c) => {
    if (c.type === "not") return lv(c.pins[0]) ? 0 : 1;
    const a = lv(c.pins[0]), b = lv(c.pins[1]);
    switch (c.type) { case "and": return a & b; case "or": return a | b; case "nand": return (a & b) ? 0 : 1; case "nor": return (a | b) ? 0 : 1; case "xor": return a ^ b; case "and3": return (a & b & lv(c.pins[3])) ? 1 : 0; case "or3": return (a | b | lv(c.pins[3])) ? 1 : 0; default: return (a ^ b) ? 0 : 1; }
  };
  let stable = false;
  for (let it = 0; it < 200 && !stable; it++) {
    stable = true;
    for (const c of gates) {
      const outPin = c.type === "not" ? c.pins[1] : c.pins[2];
      const nv = evalGate(c), r = net(outPin);
      if ((level[r] ? 1 : 0) !== nv) { level[r] = nv; stable = false; }
    }
    if (hasZ) for (const n in zMap) { let v = 0; for (const z of zMap[n]) if ((level[net(z.pins[1])] ? 1 : 0) && (level[net(z.pins[0])] ? 1 : 0)) { v = 1; break; } if ((level[n] ? 1 : 0) !== v) { level[n] = v; stable = false; } }
    for (const c of components) if (c.type === "dff") { const r = net(c.pins[1]), want = isHi(c.q) ? 1 : 0; if ((level[r] ? 1 : 0) !== want) { level[r] = want; stable = false; } }
    for (const c of components) if (c.type === "srlatch") { const s = lv(c.pins[0]), rr = lv(c.pins[1]), held = isHi(c.q) ? 1 : 0; const q = (s && !rr) ? 1 : (rr && !s) ? 0 : (s && rr) ? 0 : held; const rt = net(c.pins[2]); if ((level[rt] ? 1 : 0) !== q) { level[rt] = q; stable = false; } }
  }
  const result = {}, nodeVoltage = {}, pinNet = {}, netLevel = {};
  for (const c of components) {
    c.pins.forEach((p, i) => { const r = net(p); pinNet[c.id + ":" + i] = r; const L = level[r] ? 1 : 0; netLevel[r] = L; nodeVoltage[r] = L ? 5 : 0; });
    if (c.type === "dff") result[c.id] = { d: lv(c.pins[0]), q: lv(c.pins[1]), voltage: lv(c.pins[1]) * 5, current: 0, na: net(c.pins[1]), nb: net(c.pins[0]) };
    else if (c.type === "srlatch") result[c.id] = { s: lv(c.pins[0]), r: lv(c.pins[1]), q: lv(c.pins[2]), voltage: lv(c.pins[2]) * 5, current: 0, na: net(c.pins[2]), nb: net(c.pins[0]) };
    else if (c.type === "not") result[c.id] = { in: lv(c.pins[0]), out: lv(c.pins[1]), voltage: lv(c.pins[1]) * 5, current: 0, na: net(c.pins[1]), nb: net(c.pins[0]) };
    else if (LOGIC_GATES.includes(c.type)) result[c.id] = { a: lv(c.pins[0]), b: lv(c.pins[1]), out: lv(c.pins[2]), voltage: lv(c.pins[2]) * 5, current: 0, na: net(c.pins[2]), nb: net(c.pins[0]) };
    else if (c.type === "out") result[c.id] = { in: lv(c.pins[0]), voltage: lv(c.pins[0]) * 5, current: 0, na: net(c.pins[0]), nb: net(c.pins[0]) };
    else if (c.type === "seg7") result[c.id] = { value: lv(c.pins[0]) + (lv(c.pins[1]) << 1) + (lv(c.pins[2]) << 2) + (lv(c.pins[3]) << 3), voltage: 0, current: 0, na: net(c.pins[0]), nb: net(c.pins[0]) };
    else result[c.id] = { out: lv(c.pins[0]), voltage: lv(c.pins[0]) * 5, current: 0, na: net(c.pins[0]), nb: net(c.pins[0]) };
  }
  return { ok: true, logic: true, shortCircuit: false, result, nodeVoltage, pinNet, netLevel, oscillating: !stable };
}
/* ---- Turing Complete: encapsulation, scoring, net conflict ---- */
// Recursively flattens "chip" components into their internal primitives (combinational logic).
function flattenChips(components, wires) {
  if (!components.some((c) => c.type === "chip")) return { comps: components, wires, portMap: {} };
  const comps = [], outWires = [], portMap = {};
  for (const c of components) {
    if (c.type !== "chip") { comps.push(c); continue; }
    const pfx = c.id + "~", def = c.def || { comps: [], wires: [], ports: [] };
    const innerComps = (def.comps || []).map((ic) => ({ ...ic, id: pfx + ic.id }));
    const innerWires = (def.wires || []).map((w, wi) => ({ id: pfx + (w.id || ("w" + wi)), a: pfx + w.a, b: pfx + w.b }));
    const inner = flattenChips(innerComps, innerWires);
    comps.push(...inner.comps); outWires.push(...inner.wires);
    (def.ports || []).forEach((port, i) => { const tgt = pfx + port.pin; portMap[c.id + ":" + i] = inner.portMap[tgt] || tgt; });
  }
  for (const w of wires) outWires.push({ id: w.id, a: portMap[w.a] || w.a, b: portMap[w.b] || w.b });
  return { comps, wires: outWires, portMap };
}
// Circuit cost in primitive gates and NAND equivalents (Turing Complete style).
const NAND_COST = { nand: 1, not: 1, and: 2, or: 3, nor: 2, xor: 4, xnor: 5 };
function gateCost(components, wires) {
  const f = flattenChips(components, wires);
  let comps = f.comps;
  if (comps.some(isBusComp)) { try { comps = busExpand(comps, f.wires).prims; } catch (_) {} }
  let gates = 0, nand = 0;
  for (const c of comps) {
    if (LOGIC_GATES.includes(c.type)) { gates++; nand += NAND_COST[c.type] || 1; }
    else if (c.type === "dff") { gates++; nand += 4; }
    else if (c.type === "srlatch") { gates++; nand += 2; }
  }
  return { gates, nand };
}
// Detects nets driven by ≥2 disagreeing outputs (logic short). Does not alter solveLogic.
function findNetConflicts(components, wires, ls) {
  const uf = makeUF();
  for (const c of components) for (const p of c.pins) uf.find(p);
  for (const w of wires) uf.union(w.a, w.b);
  const net = (p) => uf.find(p);
  const lvl = (p) => (ls.netLevel[net(p)] ? 1 : 0);
  const hi = (s) => s === 1 || s === "1" || s === true || s === "on";
  const vals = {}, dpins = {};
  const add = (pin, v) => { const n = net(pin); (vals[n] = vals[n] || new Set()).add(v); (dpins[n] = dpins[n] || []).push(pin); };
  for (const c of components) {
    if (c.type === "in" || c.type === "clock") add(c.pins[0], hi(c.state) ? 1 : 0);
    else if (c.type === "high") add(c.pins[0], 1);
    else if (c.type === "low") add(c.pins[0], 0);
    else if (c.type === "dff") add(c.pins[1], hi(c.q) ? 1 : 0);
    else if (c.type === "zbuf") { if (lvl(c.pins[1])) add(c.pins[2], lvl(c.pins[0])); }
    else if (c.type === "srlatch") { const s = lvl(c.pins[0]), r = lvl(c.pins[1]), held = hi(c.q) ? 1 : 0; add(c.pins[2], (s && !r) ? 1 : (r && !s) ? 0 : (s && r) ? 0 : held); }
    else if (c.type === "not") add(c.pins[1], lvl(c.pins[0]) ? 0 : 1);
    else if (LOGIC_GATES.includes(c.type)) { const a = lvl(c.pins[0]), b = lvl(c.pins[1]); let v; switch (c.type) { case "and": v = a & b; break; case "or": v = a | b; break; case "nand": v = (a & b) ? 0 : 1; break; case "nor": v = (a | b) ? 0 : 1; break; case "xor": v = a ^ b; break; case "and3": v = a & b & lvl(c.pins[3]); break; case "or3": v = a | b | lvl(c.pins[3]); break; default: v = (a ^ b) ? 0 : 1; } add(c.pins[2], v); }
  }
  const nets = new Set(), pins = new Set();
  for (const n in vals) if (vals[n].size > 1) { nets.add(n); dpins[n].forEach((p) => pins.add(p)); }
  return { nets, pins, count: nets.size };
}
function simulate(components, wires, tr) {
  if (components.some((c) => LOGIC_TYPES.includes(c.type))) return solveLogic(components, wires);
  return solveCircuit(components, wires, tr);
}
function clockTick(components, wires) {
  const f = flattenChips(components, wires);
  if (f.comps.some(isBusComp)) {
    const { prims, pwires, portPins, alias } = busExpand(f.comps, f.wires);
    const ls = solveLogic(compNet(prims), pwires);
    const rd = (id, port) => busPortVal(ls, portPins, id, port);
    return components.map((c) => {
      if (c.type === "dff") return { ...c, q: (ls.netLevel && ls.netLevel[ls.pinNet[c.id + ":0"]]) ? 1 : 0 };
      if (c.type === "reg4") {
        const rstWired = wires.some((w) => w.a === c.id + ":rst" || w.b === c.id + ":rst");
        const rst = rstWired ? ((ls.netLevel[ls.pinNet[alias[c.id + ":rst"]]]) ? 1 : 0) : 0;
        if (rst) return { ...c, q: 0 };
        const weWired = wires.some((w) => w.a === c.id + ":we" || w.b === c.id + ":we");
        const we = weWired ? ((ls.netLevel[ls.pinNet[alias[c.id + ":we"]]]) ? 1 : 0) : 1;
        return we ? { ...c, q: bnorm(rd(c.id, "in")) } : c;
      }
      if (c.type === "counter") {
        const Wc = c.width || BUS_W;
        const rstWired = wires.some((w) => w.a === c.id + ":rst" || w.b === c.id + ":rst");
        const rst = rstWired ? ((ls.netLevel[ls.pinNet[alias[c.id + ":rst"]]]) ? 1 : 0) : 0;
        if (rst) return { ...c, q: 0 };
        const enWired = wires.some((w) => w.a === c.id + ":en" || w.b === c.id + ":en");
        const en = enWired ? ((ls.netLevel[ls.pinNet[alias[c.id + ":en"]]]) ? 1 : 0) : 1;
        return en ? { ...c, q: bnorm((toBig(c.q) + 1n) & bmask(Wc)) } : c;
      }
      if (c.type === "shiftreg") {
        const Ws = c.width || BUS_W;
        const sinWired = wires.some((w) => w.a === c.id + ":sin" || w.b === c.id + ":sin");
        const sin = sinWired ? ((ls.netLevel[ls.pinNet[alias[c.id + ":sin"]]]) ? 1 : 0) : 0;
        return { ...c, q: bnorm(((toBig(c.q) << 1n) | (sin ? 1n : 0n)) & bmask(Ws)) };
      }
      if (c.type === "ram") {
        const weWired = wires.some((w) => w.a === c.id + ":we" || w.b === c.id + ":we");
        const we = weWired ? ((ls.netLevel[ls.pinNet[alias[c.id + ":we"]]]) ? 1 : 0) : 0;
        if (we) {
          const W = c.width || 8, cells = c.cells || 16;
          const addr = Number(toBig(rd(c.id, "addr")) & BigInt(cells - 1));
          const din = bnorm(toBig(rd(c.id, "in")) & bmask(W));
          const mem = c.mem ? c.mem.slice() : Array(cells).fill(0); mem[addr] = din;
          return { ...c, mem };
        }
        return c;
      }
      if (c.type === "delay") {
        const depth = Math.max(1, Math.min(16, c.depth || 1));
        const din = bnorm(toBig(rd(c.id, "in")) & bmask(c.width || BUS_W));
        const prev = c.stages || [];
        const stages = []; for (let s = 0; s < depth; s++) stages[s] = (s === 0 ? din : (prev[s - 1] ?? 0));
        return { ...c, stages };
      }
      if (c.type === "dualram") {
        const cells = c.cells || 16, Wd = c.width || 8;
        const wEn = (sfx) => { const wired = wires.some((w) => w.a === c.id + ":we" + sfx || w.b === c.id + ":we" + sfx); return wired ? ((ls.netLevel[ls.pinNet[alias[c.id + ":we" + sfx]]]) ? 1 : 0) : 0; };
        const weA = wEn("A"), weB = wEn("B");
        if (!weA && !weB) return c;
        const mem = c.mem ? c.mem.slice() : Array(cells).fill(0);
        if (weA) { const a = Number(toBig(rd(c.id, "addrA")) & BigInt(cells - 1)); mem[a] = bnorm(toBig(rd(c.id, "inA")) & bmask(Wd)); }
        if (weB) { const a = Number(toBig(rd(c.id, "addrB")) & BigInt(cells - 1)); mem[a] = bnorm(toBig(rd(c.id, "inB")) & bmask(Wd)); }
        return { ...c, mem };
      }
      if (c.type === "latchram") {
        const cells = c.cells || 16, Wl = c.width || 8;
        const addr = Number(toBig(rd(c.id, "addr")) & BigInt(cells - 1));
        const mem0 = c.mem || [];
        const oreg = bnorm(toBig(Number(mem0[addr] || 0)) & bmask(Wl));
        const wired = wires.some((w) => w.a === c.id + ":we" || w.b === c.id + ":we");
        const we = wired ? ((ls.netLevel[ls.pinNet[alias[c.id + ":we"]]]) ? 1 : 0) : 0;
        let mem = mem0;
        if (we) { mem = mem0.slice(); mem[addr] = bnorm(toBig(rd(c.id, "in")) & bmask(Wl)); }
        return { ...c, mem, oreg };
      }
      return c;
    });
  }
  const sim = solveLogic(compNet(f.comps), f.wires);
  return components.map((c) => (c.type === "dff" ? { ...c, q: (sim.netLevel && sim.netLevel[sim.pinNet[c.id + ":0"]]) || 0 } : c));
}
function hasDff(components) { return components.some((c) => c.type === "dff" || c.type === "reg4" || c.type === "counter" || c.type === "shiftreg" || c.type === "delay" || c.type === "dualram" || c.type === "latchram"); }
const BUS_W = 4;
// Wide buses (32/64 bits) exceed JS 32-bit bitwise ops, so value<->bits paths use BigInt.
const bmask = (W) => (1n << BigInt(W)) - 1n;
const toBig = (v) => (typeof v === "bigint" ? v : BigInt(Math.trunc(Number(v) || 0)));
const bnorm = (v) => Number(v); // stored component state must stay JSON-safe (no BigInt); exact for <=2^53
const bbit = (v, k) => Number((toBig(v) >> BigInt(k)) & 1n);
const BUS_TYPES = ["busin", "busout", "reg4", "add4", "mux4", "split", "merge", "alu", "decoder", "rom", "ram", "tristate", "subb", "cmp", "counter", "shiftreg", "busnot", "busand", "busor", "busxor", "busnand", "busnor", "busxnor", "busneg", "shl", "shr", "ashr", "rol", "ror", "demux", "bytesplit", "bytemerge", "fulladd", "indexbit", "indexbyte", "bitcomp", "byteexp", "mul", "divmod", "outz", "delay", "bidir", "dualram", "latchram"];
function isBusComp(c) { return BUS_TYPES.includes(c.type); }
function busPortVal(sim, portPins, id, port) {
  const arr = portPins[id] && portPins[id][port]; if (!arr) return 0;
  let v = 0n; arr.forEach((pid, k) => { const n = sim.pinNet[pid]; if (sim.netLevel[n]) v |= (1n << BigInt(k)); });
  return arr.length > 52 ? v : Number(v);
}
function busExpand(components, wires) {
  const prims = [], pwires = [], portPins = {}, alias = {}; let n = 0; const uid = () => "bw" + (++n);
  const setPort = (id, port, arr) => { (portPins[id] = portPins[id] || {})[port] = arr; };
  for (const c of components) {
    if (!isBusComp(c)) { prims.push(c); continue; }
    const W = c.width || BUS_W;
    if (c.type === "busin") {
      const v = toBig(c.value) & bmask(W), outs = [];
      for (let k = 0; k < W; k++) { const pid = c.id + "$d" + k; prims.push({ id: pid, type: bbit(v, k) ? "high" : "low" }); outs.push(pid + ":0"); }
      setPort(c.id, "out", outs);
    } else if (c.type === "busout") {
      const ins = []; for (let k = 0; k < W; k++) { const pid = c.id + "$o" + k; prims.push({ id: pid, type: "out" }); ins.push(pid + ":0"); }
      setPort(c.id, "in", ins);
    } else if (c.type === "reg4") {
      const q = toBig(c.q) & bmask(W), ins = [], outs = [];
      for (let k = 0; k < W; k++) { const pid = c.id + "$f" + k; prims.push({ id: pid, type: "dff", q: bbit(q, k) }); ins.push(pid + ":0"); outs.push(pid + ":1"); }
      setPort(c.id, "in", ins); setPort(c.id, "out", outs);
      const weA = c.id + "$we"; prims.push({ id: weA, type: "out" }); alias[c.id + ":we"] = weA + ":0";
      const reA = c.id + "$rst"; prims.push({ id: reA, type: "out" }); alias[c.id + ":rst"] = reA + ":0";
    } else if (c.type === "counter") {
      // Counter: W flip-flops storing the count; the output reflects the state.
      // The increment is computed on the clock edge (clockTick). en/rst are read inputs.
      const cnt = toBig(c.q) & bmask(W), outs = [];
      for (let k = 0; k < W; k++) { const pid = c.id + "$f" + k; prims.push({ id: pid, type: "dff", q: bbit(cnt, k) }); outs.push(pid + ":1"); }
      setPort(c.id, "out", outs);
      const enA = c.id + "$en"; prims.push({ id: enA, type: "out" }); alias[c.id + ":en"] = enA + ":0";
      const rsA = c.id + "$rst"; prims.push({ id: rsA, type: "out" }); alias[c.id + ":rst"] = rsA + ":0";
    } else if (c.type === "shiftreg") {
      // Shift register: W flip-flops; parallel output = state, serial output = MSB.
      // The shift (serial input -> bit 0) is computed on the clock edge (clockTick).
      const q = toBig(c.q) & bmask(W), outs = [];
      for (let k = 0; k < W; k++) { const pid = c.id + "$f" + k; prims.push({ id: pid, type: "dff", q: bbit(q, k) }); outs.push(pid + ":1"); }
      setPort(c.id, "out", outs);
      const sinA = c.id + "$sin"; prims.push({ id: sinA, type: "out" }); alias[c.id + ":sin"] = sinA + ":0";
      alias[c.id + ":sout"] = outs[W - 1];
    } else if (c.type === "add4") {
      const aP = [], bP = [], sP = []; let cin = null, carry = null;
      for (let k = 0; k < W; k++) {
        const x1 = c.id + "$x" + k, a1 = c.id + "$p" + k, sX = c.id + "$s" + k, a2 = c.id + "$q" + k, co = c.id + "$c" + k;
        prims.push({ id: x1, type: "xor" }, { id: a1, type: "and" }, { id: sX, type: "xor" }, { id: a2, type: "and" }, { id: co, type: "or" });
        pwires.push({ id: uid(), a: x1 + ":0", b: a1 + ":0" }, { id: uid(), a: x1 + ":1", b: a1 + ":1" });
        pwires.push({ id: uid(), a: x1 + ":2", b: sX + ":0" }, { id: uid(), a: x1 + ":2", b: a2 + ":0" });
        if (k === 0) { alias[c.id + ":cin"] = sX + ":1"; pwires.push({ id: uid(), a: sX + ":1", b: a2 + ":1" }); }
        else { pwires.push({ id: uid(), a: cin, b: sX + ":1" }, { id: uid(), a: cin, b: a2 + ":1" }); }
        pwires.push({ id: uid(), a: a1 + ":2", b: co + ":0" }, { id: uid(), a: a2 + ":2", b: co + ":1" });
        aP.push(x1 + ":0"); bP.push(x1 + ":1"); sP.push(sX + ":2"); cin = co + ":2"; carry = co + ":2";
      }
      setPort(c.id, "a", aP); setPort(c.id, "b", bP); setPort(c.id, "s", sP); portPins[c.id]._cout = [carry];
      alias[c.id + ":cout"] = carry;
    } else if (c.type === "subb") {
      const HI = c.id + "$hi"; prims.push({ id: HI, type: "high" });
      const aP = [], bP = [], sP = []; let cin = HI + ":0", carry = null;
      for (let k = 0; k < W; k++) {
        const nb = c.id + "$nb" + k, x1 = c.id + "$x" + k, a1 = c.id + "$p" + k, sX = c.id + "$s" + k, a2 = c.id + "$q" + k, co = c.id + "$c" + k;
        prims.push({ id: nb, type: "not" }, { id: x1, type: "xor" }, { id: a1, type: "and" }, { id: sX, type: "xor" }, { id: a2, type: "and" }, { id: co, type: "or" });
        pwires.push({ id: uid(), a: nb + ":1", b: x1 + ":1" }, { id: uid(), a: nb + ":1", b: a1 + ":1" });
        pwires.push({ id: uid(), a: x1 + ":0", b: a1 + ":0" });
        pwires.push({ id: uid(), a: x1 + ":2", b: sX + ":0" }, { id: uid(), a: x1 + ":2", b: a2 + ":0" });
        pwires.push({ id: uid(), a: cin, b: sX + ":1" }, { id: uid(), a: cin, b: a2 + ":1" });
        pwires.push({ id: uid(), a: a1 + ":2", b: co + ":0" }, { id: uid(), a: a2 + ":2", b: co + ":1" });
        aP.push(x1 + ":0"); bP.push(nb + ":0"); sP.push(sX + ":2"); cin = co + ":2"; carry = co + ":2";
      }
      setPort(c.id, "a", aP); setPort(c.id, "b", bP); setPort(c.id, "s", sP);
      const bn = c.id + "$bn"; prims.push({ id: bn, type: "not" }); pwires.push({ id: uid(), a: carry, b: bn + ":0" }); alias[c.id + ":borrow"] = bn + ":1";
    } else if (c.type === "cmp") {
      const HI = c.id + "$hi"; prims.push({ id: HI, type: "high" });
      const aP = [], bP = [], dbits = []; let cin = HI + ":0", carry = null;
      for (let k = 0; k < W; k++) {
        const nb = c.id + "$nb" + k, x1 = c.id + "$x" + k, a1 = c.id + "$p" + k, sX = c.id + "$s" + k, a2 = c.id + "$q" + k, co = c.id + "$c" + k;
        prims.push({ id: nb, type: "not" }, { id: x1, type: "xor" }, { id: a1, type: "and" }, { id: sX, type: "xor" }, { id: a2, type: "and" }, { id: co, type: "or" });
        pwires.push({ id: uid(), a: nb + ":1", b: x1 + ":1" }, { id: uid(), a: nb + ":1", b: a1 + ":1" });
        pwires.push({ id: uid(), a: x1 + ":0", b: a1 + ":0" });
        pwires.push({ id: uid(), a: x1 + ":2", b: sX + ":0" }, { id: uid(), a: x1 + ":2", b: a2 + ":0" });
        pwires.push({ id: uid(), a: cin, b: sX + ":1" }, { id: uid(), a: cin, b: a2 + ":1" });
        pwires.push({ id: uid(), a: a1 + ":2", b: co + ":0" }, { id: uid(), a: a2 + ":2", b: co + ":1" });
        aP.push(x1 + ":0"); bP.push(nb + ":0"); dbits.push(sX + ":2"); cin = co + ":2"; carry = co + ":2";
      }
      setPort(c.id, "a", aP); setPort(c.id, "b", bP);
      let acc = dbits[0];
      for (let k = 1; k < dbits.length; k++) { const g = c.id + "$z" + k; prims.push({ id: g, type: "or" }); pwires.push({ id: uid(), a: acc, b: g + ":0" }, { id: uid(), a: dbits[k], b: g + ":1" }); acc = g + ":2"; }
      const eqn = c.id + "$eq"; prims.push({ id: eqn, type: "not" }); pwires.push({ id: uid(), a: acc, b: eqn + ":0" }); alias[c.id + ":eq"] = eqn + ":1";
      const ltn = c.id + "$lt"; prims.push({ id: ltn, type: "not" }); pwires.push({ id: uid(), a: carry, b: ltn + ":0" }); const ltU = ltn + ":1";
      const gtg = c.id + "$gt"; prims.push({ id: gtg, type: "and" }); pwires.push({ id: uid(), a: carry, b: gtg + ":0" }, { id: uid(), a: acc, b: gtg + ":1" }); const gtU = gtg + ":2";
      if (c.signed) {
        // Signed (two's complement) order: signedLt = (sa & ~sb) | ((sa XNOR sb) & unsignedLt); signedGt = ~signedLt & (A != B).
        const sa = aP[W - 1], sb = bP[W - 1];
        const nsb = c.id + "$nsb"; prims.push({ id: nsb, type: "not" }); pwires.push({ id: uid(), a: sb, b: nsb + ":0" });
        const t1 = c.id + "$st1"; prims.push({ id: t1, type: "and" }); pwires.push({ id: uid(), a: sa, b: t1 + ":0" }, { id: uid(), a: nsb + ":1", b: t1 + ":1" });
        const xn = c.id + "$sxn"; prims.push({ id: xn, type: "xnor" }); pwires.push({ id: uid(), a: sa, b: xn + ":0" }, { id: uid(), a: sb, b: xn + ":1" });
        const t2 = c.id + "$st2"; prims.push({ id: t2, type: "and" }); pwires.push({ id: uid(), a: xn + ":2", b: t2 + ":0" }, { id: uid(), a: ltU, b: t2 + ":1" });
        const sl = c.id + "$ssl"; prims.push({ id: sl, type: "or" }); pwires.push({ id: uid(), a: t1 + ":2", b: sl + ":0" }, { id: uid(), a: t2 + ":2", b: sl + ":1" });
        alias[c.id + ":lt"] = sl + ":2";
        const nsl = c.id + "$snsl"; prims.push({ id: nsl, type: "not" }); pwires.push({ id: uid(), a: sl + ":2", b: nsl + ":0" });
        const sg = c.id + "$ssg"; prims.push({ id: sg, type: "and" }); pwires.push({ id: uid(), a: nsl + ":1", b: sg + ":0" }, { id: uid(), a: acc, b: sg + ":1" });
        alias[c.id + ":gt"] = sg + ":2";
      } else { alias[c.id + ":lt"] = ltU; alias[c.id + ":gt"] = gtU; }
    } else if (c.type === "mux4") {
      const NS = c.id + "$ns"; prims.push({ id: NS, type: "not" }); alias[c.id + ":sel"] = NS + ":0";
      const aP = [], bP = [], sP = [];
      for (let k = 0; k < W; k++) {
        const aa = c.id + "$a" + k, ab = c.id + "$b" + k, orr = c.id + "$o" + k;
        prims.push({ id: aa, type: "and" }, { id: ab, type: "and" }, { id: orr, type: "or" });
        pwires.push({ id: uid(), a: NS + ":1", b: aa + ":1" }, { id: uid(), a: NS + ":0", b: ab + ":1" });
        pwires.push({ id: uid(), a: aa + ":2", b: orr + ":0" }, { id: uid(), a: ab + ":2", b: orr + ":1" });
        aP.push(aa + ":0"); bP.push(ab + ":0"); sP.push(orr + ":2");
      }
      setPort(c.id, "a", aP); setPort(c.id, "b", bP); setPort(c.id, "s", sP);
    } else if (c.type === "split") {
      const ins = []; for (let k = 0; k < W; k++) { const an = c.id + "$a" + k; prims.push({ id: an, type: "out" }); ins.push(an + ":0"); alias[c.id + ":" + k] = an + ":0"; }
      setPort(c.id, "in", ins);
    } else if (c.type === "merge") {
      const outs = []; for (let k = 0; k < W; k++) { const an = c.id + "$a" + k; prims.push({ id: an, type: "out" }); outs.push(an + ":0"); alias[c.id + ":" + k] = an + ":0"; }
      setPort(c.id, "out", outs);
    } else if (c.type === "alu") {
      const N0 = c.id + "$no0", N1 = c.id + "$no1"; prims.push({ id: N0, type: "not" }, { id: N1, type: "not" });
      alias[c.id + ":op0"] = N0 + ":0"; alias[c.id + ":op1"] = N1 + ":0";
      const op0 = N0 + ":0", op1 = N1 + ":0", nop0 = N0 + ":1", nop1 = N1 + ":1";
      const sA = c.id + "$sA", sL = c.id + "$sL", sN = c.id + "$sN", sO = c.id + "$sO";
      prims.push({ id: sA, type: "and" }, { id: sL, type: "and" }, { id: sN, type: "and" }, { id: sO, type: "and" });
      pwires.push({ id: uid(), a: nop1, b: sA + ":0" }, { id: uid(), a: nop0, b: sA + ":1" });
      pwires.push({ id: uid(), a: nop1, b: sL + ":0" }, { id: uid(), a: op0, b: sL + ":1" });
      pwires.push({ id: uid(), a: op1, b: sN + ":0" }, { id: uid(), a: nop0, b: sN + ":1" });
      pwires.push({ id: uid(), a: op1, b: sO + ":0" }, { id: uid(), a: op0, b: sO + ":1" });
      const Nsub = c.id + "$nsub"; prims.push({ id: Nsub, type: "not" }); alias[c.id + ":sub"] = Nsub + ":0"; const sub = Nsub + ":0";
      let cin = null; const aP = [], bP = [], oP = [];
      for (let k = 0; k < W; k++) {
        const x1 = c.id + "$x" + k, bx = c.id + "$bx" + k, ax = c.id + "$ax" + k, ag = c.id + "$ag" + k, sX = c.id + "$s" + k, a2 = c.id + "$q" + k, co = c.id + "$c" + k, aG = c.id + "$A" + k, oG = c.id + "$O" + k;
        const mA = c.id + "$mA" + k, mB = c.id + "$mB" + k, mN = c.id + "$mN" + k, mO = c.id + "$mO" + k, r1 = c.id + "$r1" + k, r2 = c.id + "$r2" + k, r3 = c.id + "$r3" + k;
        prims.push({ id: x1, type: "xor" }, { id: bx, type: "xor" }, { id: ax, type: "xor" }, { id: ag, type: "and" }, { id: sX, type: "xor" }, { id: a2, type: "and" }, { id: co, type: "or" }, { id: aG, type: "and" }, { id: oG, type: "or" });
        prims.push({ id: mA, type: "and" }, { id: mB, type: "and" }, { id: mN, type: "and" }, { id: mO, type: "and" }, { id: r1, type: "or" }, { id: r2, type: "or" }, { id: r3, type: "or" });
        pwires.push({ id: uid(), a: x1 + ":0", b: ax + ":0" }, { id: uid(), a: x1 + ":0", b: ag + ":0" }, { id: uid(), a: x1 + ":0", b: aG + ":0" }, { id: uid(), a: x1 + ":0", b: oG + ":0" });
        pwires.push({ id: uid(), a: x1 + ":1", b: bx + ":0" }, { id: uid(), a: x1 + ":1", b: aG + ":1" }, { id: uid(), a: x1 + ":1", b: oG + ":1" }, { id: uid(), a: x1 + ":1", b: mB + ":1" });
        pwires.push({ id: uid(), a: sub, b: bx + ":1" });
        pwires.push({ id: uid(), a: bx + ":2", b: ax + ":1" }, { id: uid(), a: bx + ":2", b: ag + ":1" });
        pwires.push({ id: uid(), a: ax + ":2", b: sX + ":0" }, { id: uid(), a: ax + ":2", b: a2 + ":0" });
        if (k === 0) pwires.push({ id: uid(), a: sub, b: sX + ":1" }, { id: uid(), a: sub, b: a2 + ":1" });
        else pwires.push({ id: uid(), a: cin, b: sX + ":1" }, { id: uid(), a: cin, b: a2 + ":1" });
        pwires.push({ id: uid(), a: ag + ":2", b: co + ":0" }, { id: uid(), a: a2 + ":2", b: co + ":1" });
        cin = co + ":2";
        pwires.push({ id: uid(), a: sA + ":2", b: mA + ":0" }, { id: uid(), a: sX + ":2", b: mA + ":1" });
        pwires.push({ id: uid(), a: sL + ":2", b: mB + ":0" });
        pwires.push({ id: uid(), a: sN + ":2", b: mN + ":0" }, { id: uid(), a: aG + ":2", b: mN + ":1" });
        pwires.push({ id: uid(), a: sO + ":2", b: mO + ":0" }, { id: uid(), a: oG + ":2", b: mO + ":1" });
        pwires.push({ id: uid(), a: mA + ":2", b: r1 + ":0" }, { id: uid(), a: mB + ":2", b: r1 + ":1" });
        pwires.push({ id: uid(), a: mN + ":2", b: r2 + ":0" }, { id: uid(), a: mO + ":2", b: r2 + ":1" });
        pwires.push({ id: uid(), a: r1 + ":2", b: r3 + ":0" }, { id: uid(), a: r2 + ":2", b: r3 + ":1" });
        aP.push(x1 + ":0"); bP.push(x1 + ":1"); oP.push(r3 + ":2");
      }
      setPort(c.id, "a", aP); setPort(c.id, "b", bP); setPort(c.id, "s", oP);
      let zacc = oP[0];
      for (let k = 1; k < oP.length; k++) { const zg = c.id + "$z" + k; prims.push({ id: zg, type: "or" }); pwires.push({ id: uid(), a: zacc, b: zg + ":0" }, { id: uid(), a: oP[k], b: zg + ":1" }); zacc = zg + ":2"; }
      const zn = c.id + "$zn"; prims.push({ id: zn, type: "not" }); pwires.push({ id: uid(), a: zacc, b: zn + ":0" }); alias[c.id + ":zero"] = zn + ":1";
    } else if (c.type === "decoder") {
      const inPins = [];
      for (let j = 0; j < 4; j++) { const an = c.id + "$i" + j; prims.push({ id: an, type: "out" }); inPins[j] = an + ":0"; }
      setPort(c.id, "imm", [inPins[0], inPins[1], inPins[2], inPins[3]]);
      const ob = [], obn = [];
      for (let j = 0; j < 4; j++) { const ng = c.id + "$o" + j; prims.push({ id: ng, type: "not" }); inPins[4 + j] = ng + ":0"; ob[j] = ng + ":0"; obn[j] = ng + ":1"; }
      setPort(c.id, "in", inPins);
      let mc = 0;
      const minterm = (v) => { const t0 = c.id + "$t" + mc + "a", t1 = c.id + "$t" + mc + "b", t2 = c.id + "$t" + mc + "c"; mc++; prims.push({ id: t0, type: "and" }, { id: t1, type: "and" }, { id: t2, type: "and" }); const pin = (j) => ((v >> j) & 1) ? ob[j] : obn[j]; pwires.push({ id: uid(), a: pin(0), b: t0 + ":0" }, { id: uid(), a: pin(1), b: t0 + ":1" }); pwires.push({ id: uid(), a: pin(2), b: t1 + ":0" }, { id: uid(), a: pin(3), b: t1 + ":1" }); pwires.push({ id: uid(), a: t0 + ":2", b: t2 + ":0" }, { id: uid(), a: t1 + ":2", b: t2 + ":1" }); return t2 + ":2"; };
      const m1 = minterm(1), m2 = minterm(2), m3 = minterm(3), m4 = minterm(4), m5 = minterm(5), m6 = minterm(6), m7 = minterm(7), m8 = minterm(8), m9 = minterm(9);
      const orG = (x, y, tag) => { const g = c.id + "$" + tag; prims.push({ id: g, type: "or" }); pwires.push({ id: uid(), a: x, b: g + ":0" }, { id: uid(), a: y, b: g + ":1" }); return g + ":2"; };
      const we1 = orG(m1, m2, "we1"), we2 = orG(m3, m4, "we2"), we3 = orG(m6, m8, "we3"), weA = orG(we1, we2, "weA"), we = orG(weA, we3, "we");
      const dop0 = orG(m1, m4, "dop0"), dop1 = orG(m3, m4, "dop1");
      alias[c.id + ":we"] = we; alias[c.id + ":op0"] = dop0; alias[c.id + ":op1"] = dop1; alias[c.id + ":jmp"] = m5;
      alias[c.id + ":sub"] = m6; alias[c.id + ":jz"] = m7; alias[c.id + ":ld"] = m8; alias[c.id + ":st"] = m9;
    } else if (c.type === "rom") {
      const prog = c.prog || []; const words = Math.min(prog.length, 8) || 1;
      const addrPins = [], ab = [], abn = [];
      for (let j = 0; j < 3; j++) { const ng = c.id + "$a" + j; prims.push({ id: ng, type: "not" }); addrPins[j] = ng + ":0"; ab[j] = ng + ":0"; abn[j] = ng + ":1"; }
      const a3 = c.id + "$a3"; prims.push({ id: a3, type: "out" }); addrPins[3] = a3 + ":0";
      setPort(c.id, "addr", addrPins);
      const mt = [];
      for (let i = 0; i < words; i++) { const t0 = c.id + "$m" + i + "a", t1 = c.id + "$m" + i + "b"; prims.push({ id: t0, type: "and" }, { id: t1, type: "and" }); const pin = (j) => ((i >> j) & 1) ? ab[j] : abn[j]; pwires.push({ id: uid(), a: pin(0), b: t0 + ":0" }, { id: uid(), a: pin(1), b: t0 + ":1" }); pwires.push({ id: uid(), a: t0 + ":2", b: t1 + ":0" }, { id: uid(), a: pin(2), b: t1 + ":1" }); mt[i] = t1 + ":2"; }
      const dataP = [];
      for (let j = 0; j < W; j++) { const terms = []; for (let i = 0; i < words; i++) if (bbit(prog[i], j)) terms.push(mt[i]); if (terms.length === 0) { const lo = c.id + "$d" + j + "l"; prims.push({ id: lo, type: "low" }); dataP[j] = lo + ":0"; } else if (terms.length === 1) dataP[j] = terms[0]; else { let acc = terms[0]; for (let t = 1; t < terms.length; t++) { const g = c.id + "$d" + j + "o" + t; prims.push({ id: g, type: "or" }); pwires.push({ id: uid(), a: acc, b: g + ":0" }, { id: uid(), a: terms[t], b: g + ":1" }); acc = g + ":2"; } dataP[j] = acc; } }
      setPort(c.id, "data", dataP);
    } else if (c.type === "ram") {
      const cells = c.cells || 16, mem = c.mem || [];
      const L = Math.max(1, Math.ceil(Math.log2(cells)));
      const ab = [], abn = [], addrPins = [];
      for (let j = 0; j < L; j++) { const ng = c.id + "$a" + j; prims.push({ id: ng, type: "not" }); addrPins[j] = ng + ":0"; ab[j] = ng + ":0"; abn[j] = ng + ":1"; }
      setPort(c.id, "addr", addrPins);
      const mt = [];
      for (let i = 0; i < cells; i++) {
        const sel = (j) => ((i >> j) & 1) ? ab[j] : abn[j];
        let acc = sel(0);
        for (let j = 1; j < L; j++) { const g = c.id + "$mt" + i + "_" + j; prims.push({ id: g, type: "and" }); pwires.push({ id: uid(), a: acc, b: g + ":0" }, { id: uid(), a: sel(j), b: g + ":1" }); acc = g + ":2"; }
        mt[i] = acc;
      }
      const dataP = [];
      for (let j = 0; j < W; j++) {
        const terms = []; for (let i = 0; i < cells; i++) if (bbit(mem[i] || 0, j)) terms.push(mt[i]);
        if (terms.length === 0) { const lo = c.id + "$d" + j + "l"; prims.push({ id: lo, type: "low" }); dataP[j] = lo + ":0"; }
        else if (terms.length === 1) dataP[j] = terms[0];
        else { let acc = terms[0]; for (let t = 1; t < terms.length; t++) { const g = c.id + "$d" + j + "o" + t; prims.push({ id: g, type: "or" }); pwires.push({ id: uid(), a: acc, b: g + ":0" }, { id: uid(), a: terms[t], b: g + ":1" }); acc = g + ":2"; } dataP[j] = acc; }
      }
      setPort(c.id, "out", dataP);
      const ins = []; for (let k = 0; k < W; k++) { const pid = c.id + "$i" + k; prims.push({ id: pid, type: "out" }); ins.push(pid + ":0"); }
      setPort(c.id, "in", ins);
      const weA = c.id + "$we"; prims.push({ id: weA, type: "out" }); alias[c.id + ":we"] = weA + ":0";
    } else if (c.type === "tristate") {
      const Nea = c.id + "$ea", Neb = c.id + "$eb", Nec = c.id + "$ec";
      prims.push({ id: Nea, type: "out" }, { id: Neb, type: "out" }, { id: Nec, type: "out" });
      alias[c.id + ":ea"] = Nea + ":0"; alias[c.id + ":eb"] = Neb + ":0"; alias[c.id + ":ec"] = Nec + ":0";
      const aP = [], bP = [], cP = [], oP = [];
      for (let k = 0; k < W; k++) {
        const ga = c.id + "$ga" + k, gb = c.id + "$gb" + k, gc = c.id + "$gc" + k, o1 = c.id + "$o1" + k, o2 = c.id + "$o2" + k;
        prims.push({ id: ga, type: "and" }, { id: gb, type: "and" }, { id: gc, type: "and" }, { id: o1, type: "or" }, { id: o2, type: "or" });
        pwires.push({ id: uid(), a: Nea + ":0", b: ga + ":1" }, { id: uid(), a: Neb + ":0", b: gb + ":1" }, { id: uid(), a: Nec + ":0", b: gc + ":1" });
        pwires.push({ id: uid(), a: ga + ":2", b: o1 + ":0" }, { id: uid(), a: gb + ":2", b: o1 + ":1" });
        pwires.push({ id: uid(), a: o1 + ":2", b: o2 + ":0" }, { id: uid(), a: gc + ":2", b: o2 + ":1" });
        aP.push(ga + ":0"); bP.push(gb + ":0"); cP.push(gc + ":0"); oP.push(o2 + ":2");
      }
      setPort(c.id, "a", aP); setPort(c.id, "b", bP); setPort(c.id, "c", cP); setPort(c.id, "out", oP);
    } else if (c.type === "busnot") {
      // Bitwise NOT: one inverter per bit (works at any width, incl. 64).
      const aP = [], oP = [];
      for (let k = 0; k < W; k++) { const g = c.id + "$n" + k; prims.push({ id: g, type: "not" }); aP.push(g + ":0"); oP.push(g + ":1"); }
      setPort(c.id, "a", aP); setPort(c.id, "s", oP);
    } else if (c.type === "busand" || c.type === "busor" || c.type === "busxor" || c.type === "busnand" || c.type === "busnor" || c.type === "busxnor") {
      // Bitwise 2-input gate: one primitive gate per bit.
      const base = { busand: "and", busor: "or", busxor: "xor", busnand: "nand", busnor: "nor", busxnor: "xnor" }[c.type];
      const aP = [], bP = [], oP = [];
      for (let k = 0; k < W; k++) { const g = c.id + "$g" + k; prims.push({ id: g, type: base }); aP.push(g + ":0"); bP.push(g + ":1"); oP.push(g + ":2"); }
      setPort(c.id, "a", aP); setPort(c.id, "b", bP); setPort(c.id, "s", oP);
    } else if (c.type === "busneg") {
      // Two's-complement negate: s = (~a) + 1, via per-bit NOT + ripple half-adder (carry-in = 1).
      const aP = [], oP = []; let cin = null;
      for (let k = 0; k < W; k++) {
        const nb = c.id + "$nb" + k, sX = c.id + "$s" + k, a2 = c.id + "$q" + k;
        prims.push({ id: nb, type: "not" }, { id: sX, type: "xor" }, { id: a2, type: "and" });
        pwires.push({ id: uid(), a: nb + ":1", b: sX + ":0" }, { id: uid(), a: nb + ":1", b: a2 + ":0" });
        if (k === 0) { const HI = c.id + "$hi"; prims.push({ id: HI, type: "high" }); pwires.push({ id: uid(), a: HI + ":0", b: sX + ":1" }, { id: uid(), a: HI + ":0", b: a2 + ":1" }); }
        else { pwires.push({ id: uid(), a: cin, b: sX + ":1" }, { id: uid(), a: cin, b: a2 + ":1" }); }
        aP.push(nb + ":0"); oP.push(sX + ":2"); cin = a2 + ":2";
      }
      setPort(c.id, "a", aP); setPort(c.id, "s", oP);
    } else if (c.type === "shl" || c.type === "shr" || c.type === "ashr" || c.type === "rol" || c.type === "ror") {
      // Barrel shifter: ceil(log2(W)) stages of 2:1 muxes; stage i shifts by 2^i when amount bit i = 1.
      const L = Math.max(1, Math.ceil(Math.log2(W)));
      const aP = []; for (let k = 0; k < W; k++) { const an = c.id + "$a" + k; prims.push({ id: an, type: "out" }); aP.push(an + ":0"); }
      setPort(c.id, "a", aP);
      const amtP = []; for (let i = 0; i < L; i++) { const an = c.id + "$amt" + i; prims.push({ id: an, type: "out" }); amtP.push(an + ":0"); }
      setPort(c.id, "amt", amtP);
      const LOW = c.id + "$lo"; prims.push({ id: LOW, type: "low" }); const lo = LOW + ":0";
      const sign = aP[W - 1];
      let cur = aP.slice();
      for (let i = 0; i < L; i++) {
        const sh = 1 << i, ai = amtP[i];
        const niN = c.id + "$ni" + i; prims.push({ id: niN, type: "not" }); pwires.push({ id: uid(), a: ai, b: niN + ":0" }); const nai = niN + ":1";
        const next = [];
        for (let k = 0; k < W; k++) {
          let src;
          if (c.type === "shl") src = (k - sh >= 0) ? cur[k - sh] : lo;
          else if (c.type === "shr") src = (k + sh < W) ? cur[k + sh] : lo;
          else if (c.type === "ashr") src = (k + sh < W) ? cur[k + sh] : sign;
          else if (c.type === "rol") src = cur[((k - sh) % W + W) % W];
          else src = cur[(k + sh) % W];
          const g1 = c.id + "$m" + i + "_" + k + "a", g2 = c.id + "$m" + i + "_" + k + "b", g3 = c.id + "$m" + i + "_" + k + "o";
          prims.push({ id: g1, type: "and" }, { id: g2, type: "and" }, { id: g3, type: "or" });
          pwires.push({ id: uid(), a: nai, b: g1 + ":0" }, { id: uid(), a: cur[k], b: g1 + ":1" });
          pwires.push({ id: uid(), a: ai, b: g2 + ":0" }, { id: uid(), a: src, b: g2 + ":1" });
          pwires.push({ id: uid(), a: g1 + ":2", b: g3 + ":0" }, { id: uid(), a: g2 + ":2", b: g3 + ":1" });
          next.push(g3 + ":2");
        }
        cur = next;
      }
      setPort(c.id, "s", cur);
    } else if (c.type === "demux") {
      // n-to-2^n one-hot decoder: output j = 1 iff sel == j (AND of sel bits in the right polarity).
      const nb = Math.max(1, Math.min(3, c.bits || 2)), outc = 1 << nb;
      const selB = [], selN = [];
      for (let i = 0; i < nb; i++) { const an = c.id + "$s" + i; prims.push({ id: an, type: "out" }); selB[i] = an + ":0"; const ni = c.id + "$n" + i; prims.push({ id: ni, type: "not" }); pwires.push({ id: uid(), a: an + ":0", b: ni + ":0" }); selN[i] = ni + ":1"; }
      setPort(c.id, "sel", selB);
      for (let j = 0; j < outc; j++) {
        const term = (i) => (((j >> i) & 1) ? selB[i] : selN[i]);
        let acc;
        if (nb === 1) acc = term(0);
        else {
          const g0 = c.id + "$o" + j + "a0"; prims.push({ id: g0, type: "and" }); pwires.push({ id: uid(), a: term(0), b: g0 + ":0" }, { id: uid(), a: term(1), b: g0 + ":1" }); acc = g0 + ":2";
          for (let i = 2; i < nb; i++) { const g = c.id + "$o" + j + "a" + i; prims.push({ id: g, type: "and" }); pwires.push({ id: uid(), a: acc, b: g + ":0" }, { id: uid(), a: term(i), b: g + ":1" }); acc = g + ":2"; }
        }
        alias[c.id + ":o" + j] = acc;
      }
    } else if (c.type === "bytesplit") {
      // Word (W bits) -> W/8 byte buses. Output port o_b is bits [8b .. 8b+7] of the input.
      const nb = Math.max(1, Math.floor(W / 8));
      const inP = []; for (let k = 0; k < W; k++) { const an = c.id + "$a" + k; prims.push({ id: an, type: "out" }); inP.push(an + ":0"); }
      setPort(c.id, "in", inP);
      for (let b = 0; b < nb; b++) setPort(c.id, "o" + b, inP.slice(8 * b, 8 * b + 8));
    } else if (c.type === "bytemerge") {
      // W/8 byte buses -> one word. Output bit 8b+k = byte b, bit k.
      const nb = Math.max(1, Math.floor(W / 8));
      const outP = [];
      for (let b = 0; b < nb; b++) { const bp = []; for (let k = 0; k < 8; k++) { const an = c.id + "$b" + b + "_" + k; prims.push({ id: an, type: "out" }); bp.push(an + ":0"); } setPort(c.id, "i" + b, bp); outP.push(...bp); }
      setPort(c.id, "out", outP);
    } else if (c.type === "fulladd") {
      // 1-bit full adder: sum = a^b^cin ; cout = a·b + cin·(a^b). I/O are 1-bit alias pins.
      const aB = c.id + "$a", bB = c.id + "$b", cB = c.id + "$ci"; prims.push({ id: aB, type: "out" }, { id: bB, type: "out" }, { id: cB, type: "out" });
      alias[c.id + ":a"] = aB + ":0"; alias[c.id + ":b"] = bB + ":0"; alias[c.id + ":cin"] = cB + ":0";
      const x1 = c.id + "$x1"; prims.push({ id: x1, type: "xor" }); pwires.push({ id: uid(), a: aB + ":0", b: x1 + ":0" }, { id: uid(), a: bB + ":0", b: x1 + ":1" });
      const x2 = c.id + "$x2"; prims.push({ id: x2, type: "xor" }); pwires.push({ id: uid(), a: x1 + ":2", b: x2 + ":0" }, { id: uid(), a: cB + ":0", b: x2 + ":1" }); alias[c.id + ":sum"] = x2 + ":2";
      const a1 = c.id + "$a1"; prims.push({ id: a1, type: "and" }); pwires.push({ id: uid(), a: aB + ":0", b: a1 + ":0" }, { id: uid(), a: bB + ":0", b: a1 + ":1" });
      const a2 = c.id + "$a2"; prims.push({ id: a2, type: "and" }); pwires.push({ id: uid(), a: cB + ":0", b: a2 + ":0" }, { id: uid(), a: x1 + ":2", b: a2 + ":1" });
      const o1 = c.id + "$o1"; prims.push({ id: o1, type: "or" }); pwires.push({ id: uid(), a: a1 + ":2", b: o1 + ":0" }, { id: uid(), a: a2 + ":2", b: o1 + ":1" }); alias[c.id + ":cout"] = o1 + ":2";
    } else if (c.type === "indexbit") {
      // Select bit #idx of a W-bit word: out = OR_k ( in[k] AND (idx == k) ). 1-bit alias output.
      const L = Math.max(1, Math.ceil(Math.log2(W)));
      const inP = []; for (let k = 0; k < W; k++) { const an = c.id + "$a" + k; prims.push({ id: an, type: "out" }); inP.push(an + ":0"); }
      setPort(c.id, "in", inP);
      const idxB = [], idxN = [];
      for (let i = 0; i < L; i++) { const an = c.id + "$i" + i; prims.push({ id: an, type: "out" }); idxB[i] = an + ":0"; const ni = c.id + "$ni" + i; prims.push({ id: ni, type: "not" }); pwires.push({ id: uid(), a: an + ":0", b: ni + ":0" }); idxN[i] = ni + ":1"; }
      setPort(c.id, "idx", idxB);
      let acc = null;
      for (let k = 0; k < W; k++) {
        const term = (i) => (((k >> i) & 1) ? idxB[i] : idxN[i]);
        let m;
        if (L === 1) m = term(0);
        else { const g0 = c.id + "$mt" + k + "_0"; prims.push({ id: g0, type: "and" }); pwires.push({ id: uid(), a: term(0), b: g0 + ":0" }, { id: uid(), a: term(1), b: g0 + ":1" }); m = g0 + ":2"; for (let i = 2; i < L; i++) { const g = c.id + "$mt" + k + "_" + i; prims.push({ id: g, type: "and" }); pwires.push({ id: uid(), a: m, b: g + ":0" }, { id: uid(), a: term(i), b: g + ":1" }); m = g + ":2"; } }
        const sg = c.id + "$sel" + k; prims.push({ id: sg, type: "and" }); pwires.push({ id: uid(), a: inP[k], b: sg + ":0" }, { id: uid(), a: m, b: sg + ":1" });
        if (acc === null) acc = sg + ":2"; else { const o = c.id + "$or" + k; prims.push({ id: o, type: "or" }); pwires.push({ id: uid(), a: acc, b: o + ":0" }, { id: uid(), a: sg + ":2", b: o + ":1" }); acc = o + ":2"; }
      }
      alias[c.id + ":out"] = acc;
    } else if (c.type === "indexbyte") {
      // Select byte #idx of a W-bit word: out[j] = OR_b ( in[8b+j] AND (idx == b) ). 8-bit output.
      const nb = Math.max(1, Math.floor(W / 8)), L = Math.max(1, Math.ceil(Math.log2(nb)));
      const inP = []; for (let k = 0; k < W; k++) { const an = c.id + "$a" + k; prims.push({ id: an, type: "out" }); inP.push(an + ":0"); }
      setPort(c.id, "in", inP);
      const idxB = [], idxN = [];
      for (let i = 0; i < L; i++) { const an = c.id + "$i" + i; prims.push({ id: an, type: "out" }); idxB[i] = an + ":0"; const ni = c.id + "$ni" + i; prims.push({ id: ni, type: "not" }); pwires.push({ id: uid(), a: an + ":0", b: ni + ":0" }); idxN[i] = ni + ":1"; }
      setPort(c.id, "idx", idxB);
      const h = [];
      for (let b = 0; b < nb; b++) {
        const term = (i) => (((b >> i) & 1) ? idxB[i] : idxN[i]);
        let m;
        if (L === 1) m = term(0);
        else { const g0 = c.id + "$h" + b + "_0"; prims.push({ id: g0, type: "and" }); pwires.push({ id: uid(), a: term(0), b: g0 + ":0" }, { id: uid(), a: term(1), b: g0 + ":1" }); m = g0 + ":2"; for (let i = 2; i < L; i++) { const g = c.id + "$h" + b + "_" + i; prims.push({ id: g, type: "and" }); pwires.push({ id: uid(), a: m, b: g + ":0" }, { id: uid(), a: term(i), b: g + ":1" }); m = g + ":2"; } }
        h[b] = m;
      }
      const outP = [];
      for (let j = 0; j < 8; j++) {
        let acc = null;
        for (let b = 0; b < nb; b++) { const sg = c.id + "$s" + j + "_" + b; prims.push({ id: sg, type: "and" }); pwires.push({ id: uid(), a: inP[8 * b + j], b: sg + ":0" }, { id: uid(), a: h[b], b: sg + ":1" }); if (acc === null) acc = sg + ":2"; else { const o = c.id + "$o" + j + "_" + b; prims.push({ id: o, type: "or" }); pwires.push({ id: uid(), a: acc, b: o + ":0" }, { id: uid(), a: sg + ":2", b: o + ":1" }); acc = o + ":2"; } }
        outP.push(acc);
      }
      setPort(c.id, "out", outP);
    } else if (c.type === "byteexp") {
      // word -> W individual bits (parametrized splitter). Each bit aliased as :o{k}.
      const ins = []; for (let k = 0; k < W; k++) { const an = c.id + "$a" + k; prims.push({ id: an, type: "out" }); ins.push(an + ":0"); alias[c.id + ":o" + k] = an + ":0"; }
      setPort(c.id, "in", ins);
    } else if (c.type === "bitcomp") {
      // W individual bits -> word (parametrized merger). Each bit fed via :i{k}.
      const outs = []; for (let k = 0; k < W; k++) { const an = c.id + "$a" + k; prims.push({ id: an, type: "out" }); outs.push(an + ":0"); alias[c.id + ":i" + k] = an + ":0"; }
      setPort(c.id, "out", outs);
    } else if (c.type === "mul") {
      // W x W array multiplier (shift-and-add), FULL 2W-bit product. #s = low W bits, #hi = high W bits.
      // Gates emitted LSB-first / stage-by-stage so solveLogic converges in one pass even at 64 bits.
      const aP = [], bP = [];
      for (let i = 0; i < W; i++) { const an = c.id + "$a" + i; prims.push({ id: an, type: "out" }); aP.push(an + ":0"); }
      for (let j = 0; j < W; j++) { const bn = c.id + "$b" + j; prims.push({ id: bn, type: "out" }); bP.push(bn + ":0"); }
      setPort(c.id, "a", aP); setPort(c.id, "b", bP);
      const ZL = c.id + "$z"; prims.push({ id: ZL, type: "low" }); const zero = ZL + ":0";
      const N = 2 * W;
      let acc = [];
      for (let i = 0; i < N; i++) { if (i < W) { const g = c.id + "$pp0_" + i; prims.push({ id: g, type: "and" }); pwires.push({ id: uid(), a: aP[i], b: g + ":0" }, { id: uid(), a: bP[0], b: g + ":1" }); acc[i] = g + ":2"; } else acc[i] = zero; }
      for (let j = 1; j < W; j++) {
        const addend = [];
        for (let p = 0; p < N; p++) {
          if (p >= j && (p - j) < W) { const g = c.id + "$pp" + j + "_" + p; prims.push({ id: g, type: "and" }); pwires.push({ id: uid(), a: aP[p - j], b: g + ":0" }, { id: uid(), a: bP[j], b: g + ":1" }); addend[p] = g + ":2"; }
          else addend[p] = zero;
        }
        let carry = zero; const nacc = [];
        for (let p = 0; p < N; p++) {
          const x1 = c.id + "$mx" + j + "_" + p, sX = c.id + "$ms" + j + "_" + p, a1 = c.id + "$mp" + j + "_" + p, a2 = c.id + "$mq" + j + "_" + p, co = c.id + "$mc" + j + "_" + p;
          prims.push({ id: x1, type: "xor" }, { id: sX, type: "xor" }, { id: a1, type: "and" }, { id: a2, type: "and" }, { id: co, type: "or" });
          pwires.push({ id: uid(), a: acc[p], b: x1 + ":0" }, { id: uid(), a: addend[p], b: x1 + ":1" });
          pwires.push({ id: uid(), a: acc[p], b: a1 + ":0" }, { id: uid(), a: addend[p], b: a1 + ":1" });
          pwires.push({ id: uid(), a: x1 + ":2", b: sX + ":0" }, { id: uid(), a: carry, b: sX + ":1" });
          pwires.push({ id: uid(), a: x1 + ":2", b: a2 + ":0" }, { id: uid(), a: carry, b: a2 + ":1" });
          pwires.push({ id: uid(), a: a1 + ":2", b: co + ":0" }, { id: uid(), a: a2 + ":2", b: co + ":1" });
          nacc[p] = sX + ":2"; carry = co + ":2";
        }
        acc = nacc;
      }
      setPort(c.id, "s", acc.slice(0, W)); setPort(c.id, "hi", acc.slice(W, N));
    } else if (c.type === "divmod") {
      // unsigned restoring division: A / B -> Q (#q), A mod B -> R (#r), each W bits.
      // W stages, each = (W+1)-bit compare-subtract + per-bit restore mux. Topological emission.
      const aP = [], bP = [];
      for (let i = 0; i < W; i++) { const an = c.id + "$a" + i; prims.push({ id: an, type: "out" }); aP.push(an + ":0"); }
      for (let i = 0; i < W; i++) { const bn = c.id + "$b" + i; prims.push({ id: bn, type: "out" }); bP.push(bn + ":0"); }
      setPort(c.id, "a", aP); setPort(c.id, "b", bP);
      const HI = c.id + "$hi"; prims.push({ id: HI, type: "high" }); const hi = HI + ":0";
      const LO = c.id + "$lo"; prims.push({ id: LO, type: "low" }); const lo = LO + ":0";
      const nB = [];
      for (let k = 0; k < W; k++) { const g = c.id + "$nb" + k; prims.push({ id: g, type: "not" }); pwires.push({ id: uid(), a: bP[k], b: g + ":0" }); nB[k] = g + ":1"; }
      const nbe = (k) => (k < W ? nB[k] : hi);
      let R = []; for (let k = 0; k < W; k++) R[k] = lo;
      const Q = new Array(W);
      for (let i = W - 1; i >= 0; i--) {
        const sh = new Array(W + 1);
        sh[0] = aP[i];
        for (let k = 1; k < W; k++) sh[k] = R[k - 1];
        sh[W] = R[W - 1];
        let carry = hi; const diff = new Array(W);
        for (let k = 0; k <= W; k++) {
          const x1 = c.id + "$dx" + i + "_" + k, sX = c.id + "$ds" + i + "_" + k, a1 = c.id + "$dp" + i + "_" + k, a2 = c.id + "$dq" + i + "_" + k, co = c.id + "$dc" + i + "_" + k;
          prims.push({ id: x1, type: "xor" }, { id: sX, type: "xor" }, { id: a1, type: "and" }, { id: a2, type: "and" }, { id: co, type: "or" });
          pwires.push({ id: uid(), a: sh[k], b: x1 + ":0" }, { id: uid(), a: nbe(k), b: x1 + ":1" });
          pwires.push({ id: uid(), a: sh[k], b: a1 + ":0" }, { id: uid(), a: nbe(k), b: a1 + ":1" });
          pwires.push({ id: uid(), a: x1 + ":2", b: sX + ":0" }, { id: uid(), a: carry, b: sX + ":1" });
          pwires.push({ id: uid(), a: x1 + ":2", b: a2 + ":0" }, { id: uid(), a: carry, b: a2 + ":1" });
          pwires.push({ id: uid(), a: a1 + ":2", b: co + ":0" }, { id: uid(), a: a2 + ":2", b: co + ":1" });
          if (k < W) diff[k] = sX + ":2";
          carry = co + ":2";
        }
        const ge = carry; Q[i] = ge;
        const ng = c.id + "$ng" + i; prims.push({ id: ng, type: "not" }); pwires.push({ id: uid(), a: ge, b: ng + ":0" }); const nge = ng + ":1";
        const nR = new Array(W);
        for (let k = 0; k < W; k++) {
          const m1 = c.id + "$rm" + i + "_" + k, m2 = c.id + "$rn" + i + "_" + k, ro = c.id + "$ro" + i + "_" + k;
          prims.push({ id: m1, type: "and" }, { id: m2, type: "and" }, { id: ro, type: "or" });
          pwires.push({ id: uid(), a: ge, b: m1 + ":0" }, { id: uid(), a: diff[k], b: m1 + ":1" });
          pwires.push({ id: uid(), a: nge, b: m2 + ":0" }, { id: uid(), a: sh[k], b: m2 + ":1" });
          pwires.push({ id: uid(), a: m1 + ":2", b: ro + ":0" }, { id: uid(), a: m2 + ":2", b: ro + ":1" });
          nR[k] = ro + ":2";
        }
        R = nR;
      }
      setPort(c.id, "q", Q); setPort(c.id, "r", R);
    } else if (c.type === "outz") {
      // tri-state output buffer: drives out[k] = in[k] when en=1, else high-Z. Uses zbuf so several
      // can share one bus (wired-OR resolution in solveLogic).
      const en = c.id + "$en"; prims.push({ id: en, type: "out" }); alias[c.id + ":en"] = en + ":0";
      const ins = [], outs = [];
      for (let k = 0; k < W; k++) { const z = c.id + "$z" + k; prims.push({ id: z, type: "zbuf" }); pwires.push({ id: uid(), a: en + ":0", b: z + ":1" }); ins.push(z + ":0"); outs.push(z + ":2"); }
      setPort(c.id, "in", ins); setPort(c.id, "out", outs);
    } else if (c.type === "bidir") {
      // bidirectional bus port: when dir=1, drive #io from #in (tri-state); #out always reads #io.
      // Several bidir tied on #io share the line; one drives, the others read.
      const dir = c.id + "$dir"; prims.push({ id: dir, type: "out" }); alias[c.id + ":dir"] = dir + ":0";
      const ins = [], ios = [], outs = [];
      for (let k = 0; k < W; k++) {
        const z = c.id + "$z" + k; prims.push({ id: z, type: "zbuf" }); pwires.push({ id: uid(), a: dir + ":0", b: z + ":1" });
        const ob = c.id + "$o" + k; prims.push({ id: ob, type: "or" }); pwires.push({ id: uid(), a: z + ":2", b: ob + ":0" }, { id: uid(), a: z + ":2", b: ob + ":1" });
        ins.push(z + ":0"); ios.push(z + ":2"); outs.push(ob + ":2");
      }
      setPort(c.id, "in", ins); setPort(c.id, "io", ios); setPort(c.id, "out", outs);
    } else if (c.type === "delay") {
      // delay line: output = input delayed by 'depth' clock ticks. State in c.stages (array of words).
      const depth = Math.max(1, Math.min(16, c.depth || 1));
      const stages = c.stages || [];
      const outWord = toBig(stages[depth - 1] || 0) & bmask(W);
      const ins = [], outs = [];
      for (let k = 0; k < W; k++) { const pid = c.id + "$f" + k; prims.push({ id: pid, type: "dff", q: bbit(outWord, k) }); ins.push(pid + ":0"); outs.push(pid + ":1"); }
      setPort(c.id, "in", ins); setPort(c.id, "out", outs);
    } else if (c.type === "dualram") {
      // dual-port RAM: two independent read ports (A, B) over shared memory; writes on clock edge.
      const cells = c.cells || 16, mem = c.mem || [];
      const L = Math.max(1, Math.ceil(Math.log2(cells)));
      const buildPort = (sfx) => {
        const ab = [], abn = [], addrPins = [];
        for (let j = 0; j < L; j++) { const ng = c.id + "$" + sfx + "a" + j; prims.push({ id: ng, type: "not" }); addrPins[j] = ng + ":0"; ab[j] = ng + ":0"; abn[j] = ng + ":1"; }
        setPort(c.id, "addr" + sfx, addrPins);
        const mt = [];
        for (let i = 0; i < cells; i++) { const sel = (j) => ((i >> j) & 1) ? ab[j] : abn[j]; let acc = sel(0); for (let j = 1; j < L; j++) { const g = c.id + "$" + sfx + "mt" + i + "_" + j; prims.push({ id: g, type: "and" }); pwires.push({ id: uid(), a: acc, b: g + ":0" }, { id: uid(), a: sel(j), b: g + ":1" }); acc = g + ":2"; } mt[i] = acc; }
        const dataP = [];
        for (let jb = 0; jb < W; jb++) {
          const terms = []; for (let i = 0; i < cells; i++) if (bbit(mem[i] || 0, jb)) terms.push(mt[i]);
          if (terms.length === 0) { const lo = c.id + "$" + sfx + "d" + jb + "l"; prims.push({ id: lo, type: "low" }); dataP[jb] = lo + ":0"; }
          else if (terms.length === 1) dataP[jb] = terms[0];
          else { let acc = terms[0]; for (let tt = 1; tt < terms.length; tt++) { const g = c.id + "$" + sfx + "d" + jb + "o" + tt; prims.push({ id: g, type: "or" }); pwires.push({ id: uid(), a: acc, b: g + ":0" }, { id: uid(), a: terms[tt], b: g + ":1" }); acc = g + ":2"; } dataP[jb] = acc; }
        }
        setPort(c.id, "out" + sfx, dataP);
        const ins = []; for (let k = 0; k < W; k++) { const pid = c.id + "$" + sfx + "i" + k; prims.push({ id: pid, type: "out" }); ins.push(pid + ":0"); } setPort(c.id, "in" + sfx, ins);
        const weN = c.id + "$" + sfx + "we"; prims.push({ id: weN, type: "out" }); alias[c.id + ":we" + sfx] = weN + ":0";
      };
      buildPort("A"); buildPort("B");
    } else if (c.type === "latchram") {
      // latency RAM: read output is registered (1 clock-cycle latency). #out reflects c.oreg.
      const oreg = toBig(c.oreg || 0) & bmask(W);
      const outs = []; for (let k = 0; k < W; k++) { const pid = c.id + "$f" + k; prims.push({ id: pid, type: "dff", q: bbit(oreg, k) }); outs.push(pid + ":1"); }
      setPort(c.id, "out", outs);
      const L = Math.max(1, Math.ceil(Math.log2(c.cells || 16)));
      const addrPins = []; for (let j = 0; j < L; j++) { const pid = c.id + "$a" + j; prims.push({ id: pid, type: "out" }); addrPins.push(pid + ":0"); } setPort(c.id, "addr", addrPins);
      const ins = []; for (let k = 0; k < W; k++) { const pid = c.id + "$i" + k; prims.push({ id: pid, type: "out" }); ins.push(pid + ":0"); } setPort(c.id, "in", ins);
      const weN = c.id + "$we"; prims.push({ id: weN, type: "out" }); alias[c.id + ":we"] = weN + ":0";
    }
  }
  for (const w of wires) {
    if (w.bus) {
      const [ai, ap] = w.a.split("#"), [bi, bp] = w.b.split("#");
      const A = portPins[ai] && portPins[ai][ap], B = portPins[bi] && portPins[bi][bp];
      if (A && B) { const m = Math.min(A.length, B.length); for (let k = 0; k < m; k++) pwires.push({ id: uid(), a: A[k], b: B[k] }); }
    } else pwires.push({ id: w.id, a: alias[w.a] || w.a, b: alias[w.b] || w.b });
  }
  return { prims, pwires, portPins, alias };
}
function busSimulate(components, wires) {
  const { prims, pwires, portPins, alias } = busExpand(components, wires);
  const ls = solveLogic(compNet(prims), pwires);
  ls.portPins = portPins; ls.pinAlias = alias;
  ls.busVal = (id, port) => busPortVal(ls, portPins, id, port);
  return ls;
}

const BRIDGE_TYPES = ["dac", "adc", "athresh", "schmitt"];
function hasBridge(components) { return components.some((c) => BRIDGE_TYPES.includes(c.type)); }

/*
 * MIXED analog ↔ digital co-simulator (fixed point).
 * Does NOT touch the existing solvers: it orchestrates them. On each iteration,
 *  - DIGITAL phase: busSimulate on the logic part, where each bridge is
 *    replaced by an existing component — DAC→busout (to READ its input word),
 *    ADC→busin (its output = the measured code), threshold→high/low (its bit);
 *  - ANALOG phase: solveCircuit on the analog part, where DAC→battery
 *    (voltage = word ÷ full scale × Vref) and ADC/threshold→load resistor
 *    (we read the input voltage via result[id].voltage).
 * We loop until stabilization (≈2 passes without feedback).
 */
function solveMixed(components, wires) {
  const byId = {}; for (const c of components) byId[c.id] = c;
  const Wb = (c) => c.width || BUS_W;
  const full = (c) => ((1 << Wb(c)) >>> 0) - 1;
  const vref = (c) => (c.vref == null ? 5 : c.vref);
  const isDigi = (c) => LOGIC_TYPES.includes(c.type) || isBusComp(c);
  const isBridge = (c) => BRIDGE_TYPES.includes(c.type);
  const isAna = (c) => !isDigi(c) && !isBridge(c);
  const anaPins = (c) => c.type === "ground" ? [c.id + ":0"] : (c.type === "npn" || c.type === "nmos" || c.type === "pmos" || c.type === "opamp") ? [c.id + ":0", c.id + ":1", c.id + ":2"] : [c.id + ":0", c.id + ":1"];

  const pinDomain = (pid) => {
    if (pid.indexOf("#") >= 0) return "d";
    const i = pid.indexOf(":"); const id = i < 0 ? pid : pid.slice(0, i); const sfx = i < 0 ? "" : pid.slice(i + 1);
    const c = byId[id]; if (!c) return "d";
    if (isBridge(c)) return (sfx === "aout" || sfx === "ain" || sfx === "gnd") ? "a" : "d";
    return isDigi(c) ? "d" : "a";
  };
  const anaWires = wires.filter((w) => pinDomain(w.a) === "a" && pinDomain(w.b) === "a");
  const digWires = wires.filter((w) => pinDomain(w.a) === "d" && pinDomain(w.b) === "d");
  const userAna = components.filter(isAna), userDig = components.filter(isDigi), bridges = components.filter(isBridge);

  const dacV = {}, adcCode = {}, thBit = {};
  for (const c of bridges) { if (c.type === "dac") dacV[c.id] = 0; else if (c.type === "adc") adcCode[c.id] = 0; else thBit[c.id] = (c.type === "schmitt" && c.state === "hi") ? 1 : 0; }
  const schEntry = {}; for (const c of bridges) if (c.type === "schmitt") schEntry[c.id] = (c.state === "hi") ? 1 : 0;
  const vIn = {};

  let aRes = { ok: false, result: {}, nodeVoltage: {} }, dRes = null, prevKey = "";
  for (let iter = 0; iter < 12; iter++) {
    // DIGITAL PHASE
    const dComps = userDig.slice(); const extra = [];
    for (const c of bridges) {
      if (c.type === "dac") dComps.push({ id: c.id, type: "busout", width: Wb(c) });
      else if (c.type === "adc") dComps.push({ id: c.id, type: "busin", width: Wb(c), value: adcCode[c.id] });
      else { dComps.push({ id: "$th_" + c.id, type: thBit[c.id] ? "high" : "low" }); extra.push({ id: "$thw_" + c.id, a: "$th_" + c.id + ":0", b: c.id + ":out" }); }
    }
    dRes = busSimulate(dComps, digWires.concat(extra));
    for (const c of bridges) if (c.type === "dac") dacV[c.id] = (dRes.busVal(c.id, "in") / (full(c) || 1)) * vref(c);

    // ANALOG PHASE
    const aComps = userAna.map((c) => ({ ...c, pins: anaPins(c) }));
    for (const c of bridges) {
      if (c.type === "dac") aComps.push({ id: c.id, type: "battery", value: dacV[c.id], pins: [c.id + ":aout", c.id + ":gnd"] });
      else aComps.push({ id: c.id, type: "resistor", value: 1e6, pins: [c.id + ":ain", c.id + ":gnd"] });
    }
    aRes = solveCircuit(aComps, anaWires);
    for (const c of bridges) {
      if (c.type === "adc" || c.type === "athresh" || c.type === "schmitt") {
        const v = (aRes.ok && aRes.result[c.id]) ? aRes.result[c.id].voltage : 0; vIn[c.id] = v;
        if (c.type === "adc") adcCode[c.id] = Math.max(0, Math.min(full(c), Math.round((v / vref(c)) * full(c))));
        else if (c.type === "athresh") thBit[c.id] = (v >= (c.value == null ? 2.5 : c.value)) ? 1 : 0;
        else { const vhi = c.vhi == null ? 3 : c.vhi, vlo = c.vlo == null ? 2 : c.vlo; thBit[c.id] = v >= vhi ? 1 : (v <= vlo ? 0 : schEntry[c.id]); }
      }
    }
    const key = JSON.stringify([dacV, adcCode, thBit]);
    if (key === prevKey) break; prevKey = key;
  }

  // MERGE: analog + digital results, plus the state of each bridge.
  const result = Object.assign({}, aRes.result || {}, dRes.result || {});
  for (const c of bridges) {
    if (c.type === "dac") result[c.id] = { mixed: "dac", code: (dRes.busVal(c.id, "in") | 0), vout: dacV[c.id], voltage: dacV[c.id], current: 0 };
    else if (c.type === "adc") result[c.id] = { mixed: "adc", vin: vIn[c.id] || 0, code: adcCode[c.id], voltage: vIn[c.id] || 0, current: 0 };
    else if (c.type === "athresh") result[c.id] = { mixed: "athresh", vin: vIn[c.id] || 0, bit: thBit[c.id], thr: (c.value == null ? 2.5 : c.value), voltage: vIn[c.id] || 0, current: 0 };
    else result[c.id] = { mixed: "schmitt", vin: vIn[c.id] || 0, bit: thBit[c.id], vhi: (c.vhi == null ? 3 : c.vhi), vlo: (c.vlo == null ? 2 : c.vlo), voltage: vIn[c.id] || 0, current: 0 };
  }
  const out = Object.assign({}, dRes, { mixed: true, ok: (aRes.ok || userAna.length === 0), analogOk: aRes.ok, result, nodeVoltage: aRes.nodeVoltage || {} });
  out.busVal = dRes.busVal;
  return out;
}

/* Thevenin / Norton equivalent seen between two pins (pinA relative to pinB).
   Voc = open-circuit voltage (measured with an ideal voltmeter across A-B),
   Isc = short-circuit current (measured with an ammeter across A-B),
   Rth = |Voc / Isc|, In = Isc. Pure analysis: adds temporary probes, no state change. */
function thevenin(components, wires, pinA, pinB) {
  if (!pinA || !pinB || pinA === pinB) return { ok: false };
  const base = compNet(components);
  const ocComps = base.concat([{ id: "__th_vm", type: "voltmeter", pins: ["__th_vm:0", "__th_vm:1"] }]);
  const ocWires = wires.concat([{ id: "__th_wa", a: "__th_vm:0", b: pinA }, { id: "__th_wb", a: "__th_vm:1", b: pinB }]);
  const oc = solveCircuit(ocComps, ocWires);
  if (!oc.ok) return { ok: false };
  const Voc = oc.result["__th_vm"] ? oc.result["__th_vm"].voltage : 0;
  const scComps = base.concat([{ id: "__th_am", type: "ammeter", pins: ["__th_am:0", "__th_am:1"] }]);
  const scWires = wires.concat([{ id: "__th_wa", a: "__th_am:0", b: pinA }, { id: "__th_wb", a: "__th_am:1", b: pinB }]);
  const sc = solveCircuit(scComps, scWires);
  const Isc = sc.ok && sc.result["__th_am"] ? sc.result["__th_am"].current : 0;
  const Rth = Math.abs(Isc) > 1e-12 ? Math.abs(Voc / Isc) : Infinity;
  return { ok: true, Eth: Voc, In: Isc, Rth };
}

/* Power budget: total power delivered by sources, total dissipated by the rest,
   efficiency, and per-component dissipation (for the thermal map). Uses the
   per-component power already computed by the solver. */
function powerBudget(components, sim) {
  if (!sim || !sim.ok) return { ok: false };
  const SRC = new Set(["battery", "acsource", "isource"]);
  let dissipated = 0, delivered = 0, maxComp = 0;
  const perComp = {};
  for (const c of components) {
    const r = sim.result[c.id]; if (!r) continue;
    const p = Math.abs(r.power || 0);
    if (SRC.has(c.type)) { delivered += p; }
    else { dissipated += p; perComp[c.id] = p; if (p > maxComp) maxComp = p; }
  }
  const eta = delivered > 1e-12 ? Math.min(dissipated / delivered, 1) : 0;
  return { ok: true, dissipated, delivered, eta, maxComp, perComp };
}

/* DC operating-point sweep: vary one field of one component across a range and
   record an output quantity (voltage / current / power) of a target component.
   Re-runs the static solver at each step (handles analog, mixed and bus circuits). */
function dcSweep(components, wires, sweep) {
  const { compId, field, from, to, steps, outId, outKind } = sweep;
  const N = Math.max(2, Math.min(steps || 60, 240));
  const pts = [];
  for (let i = 0; i < N; i++) {
    const x = from + (to - from) * (i / (N - 1));
    const comps = components.map((c) => (c.id === compId ? { ...c, [field]: x } : c));
    const f = flattenChips(comps, wires);
    let sim;
    if (hasBridge(f.comps)) sim = solveMixed(f.comps, f.wires);
    else if (f.comps.some(isBusComp)) sim = busSimulate(f.comps, f.wires);
    else sim = simulate(compNet(f.comps), f.wires);
    const r = (sim.result && sim.result[outId]) || {};
    let y = 0;
    if (outKind === "I") y = r.current || 0;
    else if (outKind === "P") y = Math.abs(r.power || 0);
    else y = r.voltage || 0;
    pts.push({ x, y });
  }
  return { points: pts };
}


/* ---- Arduino co-simulation: inject the board's pins into the analog netlist ----
 * The Arduino is a programmable "bridge": each OUTPUT pin becomes a voltage source
 * (HIGH=5V, LOW=0V, PWM=duty*5V), INPUT_PULLUP a 30kΩ to 5V, INPUT a high-Z sense.
 * 5V/GND pins are the rails. Returns the solved circuit + pinV (node voltage per
 * Arduino pin number) so the caller can feed digitalRead/analogRead back in.
 * The sketch is advanced by the caller (it owns the C++ runtime); this is pure analog. */
const ARD_PINMAP = { d2: 2, d3: 3, d4: 4, d5: 5, d6: 6, d7: 7, d8: 8, d9: 9, d10: 10, d11: 11, d12: 12, d13: 13, a0: 14, a1: 15, a2: 16, a3: 17, a4: 18, a5: 19 };
function solveArduino(components, wires, world) {
  const ard = components.find((c) => c.type === "arduino");
  if (!ard) { const s = simulate(compNet(components), wires); return Object.assign({}, s, { pinV: {} }); }
  const gnd = ard.id + ":gnd", v5 = ard.id + ":5v";
  const others = compNet(components.filter((c) => c.type !== "arduino"));
  const extra = [{ id: "$ardg", type: "ground", pins: [gnd] }, { id: "$ard5", type: "battery", value: 5, rInt: 0.5, pins: [v5, gnd] }];
  const senseId = {};
  for (const sfx in ARD_PINMAP) {
    const pin = ARD_PINMAP[sfx], term = ard.id + ":" + sfx, s = (world.pins && world.pins[pin]) || {};
    if (s.mode === 1) { const v = s.out === 1 ? 5 : (s.pwm > 0 ? s.pwm / 255 * 5 : 0); extra.push({ id: "$o_" + sfx, type: "battery", value: v, rInt: 1, pins: [term, gnd] }); senseId[sfx] = "$o_" + sfx; }
    else if (s.mode === 2) { extra.push({ id: "$pu_" + sfx, type: "resistor", value: 30000, pins: [term, v5] }); senseId[sfx] = "$pu_" + sfx; }
    else { extra.push({ id: "$in_" + sfx, type: "resistor", value: 1e6, pins: [term, gnd] }); senseId[sfx] = "$in_" + sfx; }
  }
  const sim = solveCircuit(others.concat(extra), wires);
  const pinV = {};
  for (const sfx in ARD_PINMAP) { const r = sim.result[senseId[sfx]]; pinV[ARD_PINMAP[sfx]] = (sim.ok && r && sim.nodeVoltage[r.na] != null) ? sim.nodeVoltage[r.na] : 0; }
  return Object.assign({}, sim, { ardId: ard.id, pinV });
}

export { ARD_PINMAP, solveArduino, BUS_W, LOGIC_GATES, SEG7_MAP, acAnalysis, batRint, busSimulate, clockTick, compNet, dcSweep, findNetConflicts, flattenChips, freqResponse, gateCost, hasBridge, hasDff, isBusComp, kirchhoffAnalysis, makeUF, maxPower, measureResistance, powerBudget, simulate, solveACNodes, solveCircuit, solveMixed, stepResponse, thevenin };
