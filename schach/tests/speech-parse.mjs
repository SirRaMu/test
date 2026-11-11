// Prüft, ob gesprochene deutsche Züge richtig erkannt werden.
// Aufruf: node schach/tests/speech-parse.mjs
import { Chess } from "../vendor/chess.js";
import { parseSpokenMove, parseCommand, sanToSpeech, sanToGerman } from "../js/speech.js";

const cases = [
  ["", "e4", "e4"],
  ["", "e vier", "e4"],
  ["", "Bauer e4", "e4"],
  ["", "Springer f3", "Nf3"],
  ["", "Springer nach f drei", "Nf3"],
  ["", "Sf3", "Nf3"],
  ["", "Nf3", "Nf3"],
  ["e4 e5 Nf3 Nc6", "Läufer b5", "Bb5"],
  ["e4 e5 Nf3 Nc6", "Läufer c4", "Bc4"],
  ["e4 e5 Nf3 Nc6 Bb5 a6", "Läufer schlägt c6", "Bxc6"],
  ["e4 d5", "e schlägt d5", "exd5"],
  ["e4 d5", "Bauer schlägt d5", "exd5"],
  ["e4 e5 Nf3 Nc6 Bc4 Bc5", "kurze Rochade", "O-O"],
  ["e4 e5 Nf3 Nc6 Bc4 Bc5", "Rochade", "O-O"],
  ["d4 d5 c4 e5 dxe5 d4 e3 Bb4+ Bd2 dxe3 Bxb4 exf2+ Ke2", "f schlägt g1", "fxg1=Q"],
  ["", "g1 f3", "Nf3"],
  ["", "Dame h5", null],
];
let fail = 0;
for (const [hist, text, want] of cases) {
  const g = new Chess();
  for (const m of hist.split(" ").filter(Boolean)) g.move(m);
  const got = parseSpokenMove(text, g.moves({ verbose: true }));
  const ok = (got?.san ?? null) === want;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} "${text}" -> ${got?.san ?? null}${ok ? "" : ` (erwartet ${want})`}`);
}
for (const [t, want] of [["erledigt", "done"], ["ok", "done"], ["Tipp bitte", "hint"], ["nochmal", "repeat"], ["zurück", "undo"], ["Warum spielt man hier e5?", null]]) {
  const got = parseCommand(t);
  if (got !== want) { fail++; console.log(`✗ Befehl "${t}" -> ${got}`); } else console.log(`✓ Befehl "${t}" -> ${got}`);
}
console.log(sanToSpeech("Nf3"), "|", sanToSpeech("exd5"), "|", sanToSpeech("fxg1=N+"), "|", sanToSpeech("O-O-O"), "|", sanToGerman("Qxd8+"));
console.log(fail ? `${fail} Fehler` : "Alles ok");
process.exit(fail ? 1 : 0);
