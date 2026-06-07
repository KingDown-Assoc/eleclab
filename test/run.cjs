"use strict";
/*
 * Lanceur de tests ÉlecLab.
 * Découvre tous les fichiers test/*.test.cjs, leur passe un assertateur commun
 * `t(nom, condition, info?)` et le moteur extrait, agrège les résultats, puis
 * sort en code ≠ 0 si au moins un test échoue (pour faire échouer la CI).
 *
 *   node test/run.cjs            # toute la suite
 */
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const engine = require("./engine.cjs");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.cjs")).sort();

let pass = 0, fail = 0;
const fails = [];

for (const f of files) {
  const label = f.replace(/\.test\.cjs$/, "");
  const suite = require(path.join(dir, f));
  let sp = 0, sf = 0;
  const t = (name, ok, info) => {
    if (ok) { pass++; sp++; }
    else { fail++; sf++; fails.push(label + " › " + name + (info !== undefined ? "  " + JSON.stringify(info) : "")); }
  };
  try {
    suite(t, engine);
  } catch (e) {
    fail++; sf++;
    fails.push(label + " › (exception) " + e.message);
  }
  const mark = sf === 0 ? "✔" : "✗";
  console.log(`  ${mark} ${label.padEnd(16)} ${sp}/${sp + sf}`);
}

console.log(`\nÉlecLab — moteur : ${pass} réussis, ${fail} échoués.`);
if (fail) {
  console.log("\nDétail des échecs :");
  for (const x of fails) console.log("  ✗ " + x);
  process.exit(1);
}
console.log("Tout est vert ✔");
