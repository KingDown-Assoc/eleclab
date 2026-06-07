/*
 * ÉlecLab — Arduino runtime (client-side, no backend).
 * Interprets a subset of Arduino C++ with JSCPP, binding the Arduino API
 * (pinMode, digitalRead/Write, analogRead/Write, delay, millis, Serial) to a `world` of pin states.
 * One CRuntime instance is kept so global variables persist across loop()
 * calls; setup() runs once, loop() is driven per tick. A virtual clock makes
 * delay() throttle execution (visible timing) instead of freezing the tab.
 *
 * Pure logic, no JSX. The UI feeds the circuit in via world.readAnalog /
 * world.readDigital and reads pin outputs from world.pins.
 */
import * as rtMod from "JSCPP/lib/rt";
import * as interpMod from "JSCPP/lib/interpreter";
import * as astMod from "JSCPP/lib/ast";
import * as ppMod from "JSCPP/lib/preprocessor";
import * as pegMod from "pegjs-util";

const CRuntime = rtMod.CRuntime, mergeConfig = rtMod.mergeConfig;
const Interpreter = interpMod.Interpreter;
const ast = astMod.default || astMod;
const preprocessor = ppMod.default || ppMod;
const PEGUtil = pegMod.default || pegMod;

// Implicit Arduino constants (the IDE injects these without an #include).
const PRELUDE = [
  "#define HIGH 1", "#define LOW 0",
  "#define INPUT 0", "#define OUTPUT 1", "#define INPUT_PULLUP 2",
  "#define LED_BUILTIN 13", "#define true 1", "#define false 0",
  "#define A0 14", "#define A1 15", "#define A2 16", "#define A3 17", "#define A4 18", "#define A5 19",
  // constants
  "#define DEC 10", "#define HEX 16", "#define OCT 8", "#define BIN 2",
  "#define LSBFIRST 0", "#define MSBFIRST 1",
  "#define PI (3.1415926535897932)", "#define HALF_PI (1.5707963267948966)", "#define TWO_PI (6.283185307179586)",
  "#define DEG_TO_RAD (0.017453292519943295)", "#define RAD_TO_DEG (57.29577951308232)", "#define EULER (2.718281828459045)",
  // Arduino macro-style helpers (faithful to the real core)
  "#define min(a,b) ((a)<(b)?(a):(b))",
  "#define max(a,b) ((a)>(b)?(a):(b))",
  "#define abs(x) ((x)>0?(x):-(x))",
  "#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))",
  "#define round(x) ((x)>=0?(long)((x)+0.5):(long)((x)-0.5))",
  "#define radians(deg) ((deg)*DEG_TO_RAD)",
  "#define degrees(rad) ((rad)*RAD_TO_DEG)",
  "#define sq(x) ((x)*(x))",
  "#define bit(b) (1UL<<(b))",
  "#define bitRead(value,bit) (((value)>>(bit))&0x01)",
  "#define bitSet(value,bit) ((value)|=(1UL<<(bit)))",
  "#define bitClear(value,bit) ((value)&=~(1UL<<(bit)))",
  "#define bitWrite(value,bit,bitvalue) ((bitvalue)?((value)|=(1UL<<(bit))):((value)&=~(1UL<<(bit))))",
  "#define lowByte(w) ((w)&0xFF)",
  "#define highByte(w) (((w)>>8)&0xFF)",
  "",
].join("\n");

function makeWorld() {
  return {
    vClock: 0,           // virtual milliseconds elapsed (millis())
    pins: {},            // pin -> { mode, out (0/1), pwm (0..255) }
    serial: "",          // captured Serial output
    readAnalog: () => 0, // UI sets this: pin -> 0..1023 (from the circuit)
    readDigital: () => 0,// UI sets this: pin -> 0/1 (from the circuit)
    readPulse: () => 0,  // UI sets this: echo pin -> pulse duration (us), for HC-SR04 pulseIn()
    rngState: 1,
    setPin(p) { return this.pins[p] || (this.pins[p] = { mode: undefined, out: 0, pwm: 0, tone: 0, servo: -1 }); },
    seed(s) { this.rngState = (s >>> 0) || 1; },
    rand(lo, hi) { this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0; const span = hi - lo; return span > 0 ? lo + (this.rngState % span) : lo; },
  };
}

function loadArduino(rt, world) {
  const I = rt.intTypeLiteral, V = rt.voidTypeLiteral, UL = rt.primitiveType("unsigned long"), g = "global";
  const num = (x) => { const v = Number(x.v); return Number.isFinite(v) ? v : 0; };
  rt.regFunc((rt, _t, p, m) => { world.setPin(num(p)).mode = num(m); }, g, "pinMode", [I, I], V);
  rt.regFunc((rt, _t, p, v) => { const s = world.setPin(num(p)); s.out = num(v) ? 1 : 0; s.pwm = 0; }, g, "digitalWrite", [I, I], V);
  rt.regFunc((rt, _t, p) => rt.val(I, world.readDigital(num(p)) ? 1 : 0), g, "digitalRead", [I], I);
  rt.regFunc((rt, _t, p) => rt.val(I, Math.max(0, Math.min(1023, world.readAnalog(num(p)) | 0))), g, "analogRead", [I], I);
  rt.regFunc((rt, _t, p, v) => { const s = world.setPin(num(p)); s.pwm = Math.max(0, Math.min(255, num(v))); s.out = 0; }, g, "analogWrite", [I, I], V);
  rt.regFunc((rt, _t, ms) => { world.vClock += Math.max(0, num(ms)); }, g, "delay", [UL], V);
  rt.regFunc((rt, _t) => rt.val(UL, world.vClock), g, "millis", [], UL);
  rt.regFunc((rt, _t) => rt.val(UL, world.vClock * 1000), g, "micros", [], UL);
  // --- math & utility (Arduino core) ---
  const D = rt.doubleTypeLiteral, LO = rt.primitiveType("long"), UI = rt.primitiveType("unsigned int");
  rt.regFunc((rt, _t, x) => rt.val(D, Math.sqrt(x.v)), g, "sqrt", [D], D);
  rt.regFunc((rt, _t, x, y) => rt.val(D, Math.pow(x.v, y.v)), g, "pow", [D, D], D);
  rt.regFunc((rt, _t, x) => rt.val(D, Math.sin(x.v)), g, "sin", [D], D);
  rt.regFunc((rt, _t, x) => rt.val(D, Math.cos(x.v)), g, "cos", [D], D);
  rt.regFunc((rt, _t, x) => rt.val(D, Math.tan(x.v)), g, "tan", [D], D);
  rt.regFunc((rt, _t, v, iL, iH, oL, oH) => { const d = iH.v - iL.v; return rt.val(LO, d === 0 ? oL.v : Math.trunc((v.v - iL.v) * (oH.v - oL.v) / d) + oL.v); }, g, "map", [LO, LO, LO, LO, LO], LO);
  rt.regFunc((rt, _t, us) => { world.vClock += Math.max(0, num(us)) / 1000; }, g, "delayMicroseconds", [UL], V);
  rt.regFunc((rt, _t, a, b) => { const hasB = b !== undefined; const lo = hasB ? Math.trunc(num(a)) : 0; const hi = hasB ? Math.trunc(num(b)) : Math.trunc(num(a)); return rt.val(LO, world.rand(lo, hi)); }, g, "random", [LO, "?"], LO);
  rt.regFunc((rt, _t, s) => { world.seed(num(s)); }, g, "randomSeed", [UL], V);
  rt.regFunc((rt, _t, p, f) => { world.setPin(num(p)).tone = Math.max(0, num(f)); }, g, "tone", [I, UI, "?"], V);
  rt.regFunc((rt, _t, p) => { world.setPin(num(p)).tone = 0; }, g, "noTone", [I], V);
  rt.regFunc((rt, _t, p, v, to) => { const dur = Math.max(0, world.readPulse(num(p)) | 0); world.vClock += dur / 1000; return rt.val(UL, dur); }, g, "pulseIn", [I, I, "?"], UL);
}

// Arduino `Serial` object: a native class with print/println overloads whose
// output is appended to world.serial (no iostream, so no printf dependency).
function loadSerial(rt, world) {
  const I = rt.intTypeLiteral, D = rt.doubleTypeLiteral, V = rt.voidTypeLiteral, C = rt.charTypeLiteral, B = rt.boolTypeLiteral;
  const UL = rt.primitiveType("unsigned long"), LO = rt.primitiveType("long"), UI = rt.primitiveType("unsigned int");
  const pchar = rt.normalPointerType(rt.charTypeLiteral);
  const type = rt.newClass("SerialClass", []);
  rt.types[rt.getTypeSignature(type)].father = "object";
  const out = (s) => { world.serial += s; if (world.serial.length > 20000) world.serial = world.serial.slice(-20000); };
  const f2 = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2);
  const str = (rt, x) => rt.getStringFromCharArray(x);
  const intStr = (x) => String(Math.trunc(Number(x.v)));
  const reg = (name, argT, fn) => rt.regFunc(fn, type, name, argT, V);
  reg("begin", [UL], () => {}); reg("begin", [UL, I], () => {}); reg("end", [], () => {}); reg("flush", [], () => {});
  for (const T of [I, UI, LO, UL]) reg("print", [T], (rt, _t, x) => out(intStr(x)));
  reg("print", [D], (rt, _t, x) => out(f2(x.v)));
  reg("print", [pchar], (rt, _t, x) => out(str(rt, x)));
  reg("print", [C], (rt, _t, x) => out(String.fromCharCode(x.v)));
  reg("print", [B], (rt, _t, x) => out(x.v ? "1" : "0"));
  for (const T of [I, UI, LO, UL]) reg("println", [T], (rt, _t, x) => out(intStr(x) + "\n"));
  reg("println", [D], (rt, _t, x) => out(f2(x.v) + "\n"));
  reg("println", [pchar], (rt, _t, x) => out(str(rt, x) + "\n"));
  reg("println", [C], (rt, _t, x) => out(String.fromCharCode(x.v) + "\n"));
  reg("println", [B], (rt, _t, x) => out((x.v ? "1" : "0") + "\n"));
  reg("println", [], () => out("\n"));
  rt.scope[0].variables["Serial"] = { t: type, v: { members: {} }, left: true };
}

/**
 * Build an Arduino runtime from sketch source.
 * Returns { world, pump(wallMs, budget), reset(), totalSteps } or throws on a
 * parse/compile error (message is the C++ diagnostic).
 */

// Arduino `Servo` library: a user-instantiable native class. Each instance keeps
// its own state (attached pin + current angle) via a side-table keyed by the
// instance value, since JSCPP class members are typed and we want free-form state.
function loadServo(rt, world) {
  const I = rt.intTypeLiteral, V = rt.voidTypeLiteral, B = rt.boolTypeLiteral;
  const num = (x) => { const v = Number(x.v); return Number.isFinite(v) ? v : 0; };
  const type = rt.newClass("Servo", []);
  rt.types[rt.getTypeSignature(type)].father = "object";
  const state = new Map();
  const stOf = (_t) => { let s = state.get(_t.v); if (!s) { s = { pin: -1, angle: 90, attached: false }; state.set(_t.v, s); } return s; };
  const clamp = (a, lo, hi) => Math.max(lo, Math.min(hi, a));
  const reg = (name, argT, ret, fn) => rt.regFunc(fn, type, name, argT, ret);
  const doAttach = (_t, pin) => { const s = stOf(_t); s.pin = pin; s.attached = true; const w = world.setPin(pin); w.mode = 1; if (w.servo < 0) w.servo = s.angle; };
  reg("attach", [I], I, (rt, _t, p) => { doAttach(_t, num(p)); return rt.val(I, 0); });
  reg("attach", [I, I, I], I, (rt, _t, p) => { doAttach(_t, num(p)); return rt.val(I, 0); });
  reg("write", [I], V, (rt, _t, a) => { const s = stOf(_t); s.angle = clamp(Math.trunc(num(a)), 0, 180); if (s.pin >= 0) world.setPin(s.pin).servo = s.angle; });
  reg("writeMicroseconds", [I], V, (rt, _t, us) => { const s = stOf(_t); const u = clamp(num(us), 544, 2400); s.angle = clamp(Math.round((u - 1000) * 180 / 1000), 0, 180); if (s.pin >= 0) world.setPin(s.pin).servo = s.angle; });
  reg("read", [], I, (rt, _t) => rt.val(I, stOf(_t).angle));
  reg("attached", [], B, (rt, _t) => rt.val(B, stOf(_t).attached ? 1 : 0));
  reg("detach", [], V, (rt, _t) => { stOf(_t).attached = false; });
}

export function createArduino(userCode, opts = {}) {
  const world = makeWorld();
  const config = {
    stdio: { drain() { return null; }, write(s) { world.serial += s; } },
    includes: {},   // standard headers omitted on purpose (the Arduino API is registered natively, and JSCPP's cstdio/iostream drag in printf→util/stream which break browser bundling)
    unsigned_overflow: "warn",
  };
  const _c = {}; mergeConfig(_c, config);
  const rt = new CRuntime(_c);
  loadArduino(rt, world);
  loadSerial(rt, world);
  loadServo(rt, world);

  let code = PRELUDE + String(userCode || "").replace(/^[ \t]*#include[ \t]*<\s*Servo\.h\s*>[ \t]*$/gmi, "");
  code = preprocessor.parse(rt, code);
  const res = PEGUtil.parse(ast, code);
  if (res.error != null) throw new Error(PEGUtil.errorMessage(res.error, true));

  const interp = new Interpreter(rt);
  const dg = interp.run(res.ast, code);
  while (!dg.next().done) { /* run global initialisers */ }

  const hasFn = (name) => { try { return !!rt.getFunc("global", name, []); } catch (_) { return false; } };
  const call = (name) => rt.getFunc("global", name, [])(rt, null);

  if (!hasFn("loop")) throw new Error("Le sketch doit définir une fonction loop().");
  const hasSetup = hasFn("setup");

  let setupDone = false, loopGen = null, totalSteps = 0;
  // Advance loop() while the virtual clock hasn't outrun wall time; the step
  // budget bounds a delay-less loop so a runaway sketch can't hang the tab.
  function pump(wallMs, budget = 20000) {
    // Run setup() exactly once, on the first pump — by then the UI has wired
    // world.readAnalog / world.readDigital, so a sensor read inside setup() is correct.
    if (!setupDone) { setupDone = true; if (hasSetup) { const sg = call("setup"); while (!sg.next().done) {} } }
    let steps = 0;
    while (steps < budget) {
      if (world.vClock > wallMs) break;
      if (!loopGen) loopGen = call("loop");
      const r = loopGen.next();
      steps++; totalSteps++;
      if (r.done) loopGen = null;
    }
    return steps;
  }

  return {
    world,
    pump,
    get totalSteps() { return totalSteps; },
    get serial() { return world.serial; },
  };
}

export default createArduino;
