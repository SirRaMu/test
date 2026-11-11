// Prüft alle Eröffnungsvarianten mit chess.js auf legale Züge.
// Aufruf: node schach/tests/validate-openings.mjs
import { Chess } from "../vendor/chess.js";
import { OPENINGS, normalizeOpening } from "../js/openings.js";

let errors = 0, lines = 0;
const ids = new Set();
for (const raw of OPENINGS) {
  if (ids.has(raw.id)) { console.error("Doppelte ID", raw.id); errors++; }
  ids.add(raw.id);
  const op = normalizeOpening(raw);
  for (const line of op.lines) {
    lines++;
    const g = new Chess();
    for (const [i, m] of line.moves.entries()) {
      try {
        const mv = g.move(m.san);
        if (mv.san !== m.san) { console.error(`${op.name} / ${line.name}: Zug ${i + 1} "${m.san}" heißt kanonisch "${mv.san}"`); errors++; }
      } catch (e) {
        console.error(`${op.name} / ${line.name}: illegaler Zug ${i + 1} "${m.san}" in ${g.fen()}`); errors++; break;
      }
      if (!m.note) console.warn(`  (ohne Erklärung) ${op.name} / ${line.name}: ${m.san}`);
    }
  }
}
console.log(`${OPENINGS.length} Eröffnungen, ${lines} Varianten geprüft, ${errors} Fehler.`);
process.exit(errors ? 1 : 0);
