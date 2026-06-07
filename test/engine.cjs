"use strict";
/*
 * Harnais de test — charge le MOTEUR.
 *
 * Le moteur de simulation vit dans src/engine.js (module ES). Pour le tester
 * sous CommonJS sans étape de build, on lit la source, on retire la ligne
 * d'export ESM, on évalue le corps, puis on expose les liaisons dont les suites
 * ont besoin — y compris quelques helpers internes qui ne font pas partie de la
 * liste d'export publique (solveLogic, busExpand, busPortVal, LOGIC_TYPES,
 * NAND_COST). Les tests s'exécutent donc contre le code réellement livré.
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "engine.js");
let src = fs.readFileSync(SRC, "utf8");

// Retire la (les) instruction(s) d'export ESM pour que le corps soit du CommonJS valide.
src = src.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, "");

// Liaisons exposées aux suites (publiques + quelques helpers internes du moteur).
const EXPORTS = [
  "solveCircuit", "solveLogic", "simulate", "busSimulate", "busExpand",
  "clockTick", "hasDff", "isBusComp", "busPortVal", "gateCost",
  "findNetConflicts", "flattenChips", "compNet", "makeUF",
  "LOGIC_GATES", "LOGIC_TYPES", "BUS_W", "SEG7_MAP", "NAND_COST",
];

let mod;
try {
  const body = src + "\n\nreturn { " + EXPORTS.join(", ") + " };";
  // eslint-disable-next-line no-new-func
  mod = new Function(body)();
} catch (e) {
  throw new Error("Échec d'évaluation du moteur (src/engine.js) : " + e.message);
}

// --- petits utilitaires partagés par les suites ---

// Lit une sortie 1 bit (alias) d'un composant de bus après busSimulate.
mod.busBit = function (sim, id, sfx) {
  let p = id + ":" + sfx;
  if (sim.pinAlias && sim.pinAlias[p]) p = sim.pinAlias[p];
  return sim.netLevel && sim.netLevel[sim.pinNet[p]] ? 1 : 0;
};

// Point d'entrée unique reproduisant le choix de l'app :
//  - composants de bus -> busSimulate (compNet appelé en interne) ;
//  - sinon (analogique / logique) -> simulate(compNet(comps), wires).
mod.run = function (comps, wires) {
  if (comps.some(mod.isBusComp)) return mod.busSimulate(comps, wires);
  const cn = mod.compNet(comps);
  const sim = mod.simulate(cn, wires);
  if (sim && sim.logic) sim.conflict = mod.findNetConflicts(cn, wires, sim);
  return sim;
};

module.exports = mod;
