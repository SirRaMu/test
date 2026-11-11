// Sprachausgabe (Text-to-Speech), Spracherkennung und Umwandlung zwischen
// gesprochenem Deutsch und Schachzügen.

const PIECE_NAMES = { K: "König", Q: "Dame", R: "Turm", B: "Läufer", N: "Springer", P: "Bauer" };
const PIECE_LETTER_DE = { K: "K", Q: "D", R: "T", B: "L", N: "S" };

/** SAN (englisch) -> deutsche Kurznotation, z. B. "Nf3" -> "Sf3". */
export function sanToGerman(san) {
  return san.replace(/^[KQRBN]/, (p) => PIECE_LETTER_DE[p]).replace(/=([QRBN])/, (_, p) => "=" + PIECE_LETTER_DE[p]);
}

/** SAN -> gut vorlesbarer deutscher Text. */
export function sanToSpeech(san, color) {
  const check = san.endsWith("#") ? " Schachmatt" : san.endsWith("+") ? " Schach" : "";
  const s = san.replace(/[+#]/g, "");
  if (s === "O-O") return "kurze Rochade" + check;
  if (s === "O-O-O") return "lange Rochade" + check;
  const m = s.match(/^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(=([QRBN]))?$/);
  if (!m) return san;
  const [, piece, fromFile, fromRank, capture, to, , promo] = m;
  let out = piece ? PIECE_NAMES[piece] : "Bauer";
  if (!piece && fromFile) out = fromFile + "-Bauer";
  else if (fromFile || fromRank) out += " von " + (fromFile || "") + (fromRank || "");
  out += capture ? " schlägt auf " + to : " nach " + to;
  if (promo) out += ", Umwandlung in " + PIECE_NAMES[promo];
  if (color) out = (color === "w" ? "Weiß: " : "Schwarz: ") + out;
  return out + check;
}

// ---------------------------------------------------------------------------
// Sprachausgabe
// ---------------------------------------------------------------------------
export class Speaker {
  constructor() {
    this.enabled = true;
    this.rate = 1.05;
    this.voice = null;
    this.onStart = () => {};
    this.onEnd = () => {};
    this.supported = "speechSynthesis" in window;
    if (this.supported) {
      const pick = () => {
        const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("de"));
        // Bevorzugt natürlich klingende Stimmen
        this.voice =
          voices.find((v) => /natural|neural|premium|enhanced|google/i.test(v.name)) || voices[0] || null;
      };
      pick();
      speechSynthesis.addEventListener?.("voiceschanged", pick);
    }
  }

  speak(text) {
    if (!this.supported || !this.enabled || !text) return Promise.resolve();
    // Markdown und Sonderzeichen entfernen, Notation vorlesbar machen
    const clean = text
      .replace(/[*_#`>]/g, "")
      .replace(/…/g, "")
      .replace(/\b(\d+)\.\s?/g, "")
      .replace(/\bO-O-O\b/g, "lange Rochade")
      .replace(/\bO-O\b/g, "kurze Rochade");
    speechSynthesis.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = "de-DE";
      if (this.voice) u.voice = this.voice;
      u.rate = this.rate;
      u.onstart = () => this.onStart();
      const done = () => { this.onEnd(); resolve(); };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }

  stop() {
    if (this.supported) speechSynthesis.cancel();
    this.onEnd();
  }

  get speaking() {
    return this.supported && speechSynthesis.speaking;
  }
}

// ---------------------------------------------------------------------------
// Spracherkennung (Web Speech API, funktioniert in Chrome/Android, Edge und Safari)
// ---------------------------------------------------------------------------
export class Listener {
  constructor() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    this.active = false; // vom Nutzer gewünscht
    this.paused = false; // z. B. während die App spricht
    this.onFinal = () => {};
    this.onPartial = () => {};
    this.onState = () => {};
    if (!SR) return;
    this.rec = new SR();
    this.rec.lang = "de-DE";
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.running = false;
    this.rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) this.onFinal(text);
        else this.onPartial(text);
      }
    };
    this.rec.onstart = () => { this.running = true; this.onState(this.state); };
    this.rec.onend = () => {
      this.running = false;
      // Erkennung beendet sich gerne selbst – automatisch neu starten
      if (this.active && !this.paused) setTimeout(() => this._start(), 250);
      this.onState(this.state);
    };
    this.rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.active = false;
        this.onState("denied");
      }
    };
  }

  get state() {
    if (!this.supported) return "unsupported";
    if (!this.active) return "off";
    if (this.paused) return "paused";
    return this.running ? "listening" : "starting";
  }

  _start() {
    if (!this.rec || this.running) return;
    try { this.rec.start(); } catch { /* läuft schon */ }
  }

  start() {
    if (!this.supported) return;
    this.active = true;
    this.paused = false;
    this._start();
    this.onState(this.state);
  }

  stop() {
    this.active = false;
    try { this.rec?.stop(); } catch { /* egal */ }
    this.onState(this.state);
  }

  pause() {
    if (!this.active) return;
    this.paused = true;
    try { this.rec?.abort(); } catch { /* egal */ }
    this.onState(this.state);
  }

  resume() {
    if (!this.active) return;
    this.paused = false;
    this._start();
    this.onState(this.state);
  }
}

// ---------------------------------------------------------------------------
// Gesprochenen Text in einen Zug bzw. Befehl übersetzen
// ---------------------------------------------------------------------------
const NUMBER_WORDS = { eins: 1, ein: 1, eine: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, "fünf": 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8 };
const LETTER_WORDS = { a: "a", ah: "a", b: "b", be: "b", bee: "b", c: "c", ce: "c", see: "c", zeh: "c", d: "d", de: "d", dee: "d", e: "e", ee: "e", f: "f", ef: "f", eff: "f", g: "g", ge: "g", geh: "g", h: "h", ha: "h", hah: "h" };

const COMMANDS = [
  { cmd: "done", re: /^(ok(ay)?|erledigt|gemacht|fertig|weiter|gesetzt|gezogen|ist gemacht|hab ich|habe ich|ja)\b/ },
  { cmd: "hint", re: /\b(tipp|tip|hinweis|hilfe|was soll ich|welcher zug)\b/ },
  { cmd: "repeat", re: /\b(nochmal|noch mal|wiederhol|wie bitte)\b/ },
  { cmd: "undo", re: /\b(zurück|rückgängig|zurücknehmen)\b/ },
  { cmd: "stop", re: /^(stopp?|ruhe|still|halt)\b/ },
];

export function parseCommand(text) {
  const t = text.toLowerCase().trim().replace(/[.!?,]/g, "");
  for (const c of COMMANDS) if (c.re.test(t)) return c.cmd;
  return null;
}

/**
 * Versucht, aus gesprochenem Text einen legalen Zug zu machen.
 * @param {string} text   erkannter Text, z. B. "Springer f3", "e4", "Läufer schlägt c6", "kurze Rochade"
 * @param {Array} legal   chess.js verbose moves
 * @returns {object|null} der passende chess.js-Zug oder null
 */
export function parseSpokenMove(text, legal) {
  let t = " " + text.toLowerCase().replace(/[.,!?]/g, " ") + " ";

  if (/(kurze|kleine) rochade|rochade kurz|0-0(?!-)|o-o(?!-)/.test(t)) return legal.find((m) => m.san.startsWith("O-O") && !m.san.startsWith("O-O-O")) || null;
  if (/(lange|große) rochade|rochade lang|0-0-0|o-o-o/.test(t)) return legal.find((m) => m.san.startsWith("O-O-O")) || null;
  if (/\brochade\b/.test(t)) {
    const r = legal.filter((m) => m.san.startsWith("O-O"));
    if (r.length === 1) return r[0];
  }

  // Figur bestimmen
  let piece = null;
  const pieceWords = [
    ["n", /springer|pferd|pferdchen|\bs(?=[a-h][1-8])/],
    ["b", /läufer|laeufer|leufer|\bl(?=[a-h][1-8])/],
    ["r", /turm|\bt(?=[a-h][1-8])/],
    ["q", /dame|königin|koenigin|\bd(?=[a-h][1-8])/],
    ["k", /könig|koenig|\bk(?=[a-h][1-8])/],
    ["p", /bauer|bauern/],
  ];
  for (const [p, re] of pieceWords) {
    if (re.test(t)) { piece = p; t = t.replace(re, " "); break; }
  }
  // Englische SAN wie "Nf3" direkt erkennen
  const sanDirect = text.trim().replace(/\s+/g, "");
  const direct = legal.find((m) => m.san.replace(/[+#]/g, "") === sanDirect.replace(/[+#]/g, ""));
  if (direct) return direct;
  const capture = /schlägt|schlaegt|nimmt|schlagen|\bx\b/.test(t);

  // Zahlwörter und gesprochene Buchstaben normalisieren
  t = t.replace(/\b(eins|ein|eine|zwei|zwo|drei|vier|fünf|fuenf|sechs|sieben|acht)\b/g, (w) => NUMBER_WORDS[w]);
  t = t.replace(/\b(ah|be|bee|ce|see|zeh|de|dee|ee|ef|eff|ge|geh|ha|hah)\b/g, (w) => LETTER_WORDS[w]);
  // "e 4" -> "e4"
  t = t.replace(/\b([a-h])\s*-?\s*([1-8])\b/g, "$1$2");

  const squares = [...t.matchAll(/\b([a-h][1-8])\b/g)].map((m) => m[1]);
  if (!squares.length) return null;

  let cands = legal;
  if (squares.length >= 2) {
    const [from, to] = squares.slice(-2);
    cands = cands.filter((m) => m.from === from && m.to === to);
  } else {
    const to = squares[0];
    cands = cands.filter((m) => m.to === to);
    // Bauernzüge wie "e schlägt d5"
    const fileHint = t.match(/\b([a-h])\b\s*(?:schlägt|schlaegt|nimmt|x)/);
    if (fileHint) cands = cands.filter((m) => m.piece === "p" && m.from[0] === fileHint[1]);
  }
  if (piece) cands = cands.filter((m) => m.piece === piece);
  if (capture) {
    const withCap = cands.filter((m) => m.captured);
    if (withCap.length) cands = withCap;
  }
  if (cands.length > 1 && !piece) {
    // Ohne Figurangabe bevorzugt man im Schach den Bauernzug ("e4")
    const pawns = cands.filter((m) => m.piece === "p");
    if (pawns.length === 1) cands = pawns;
  }
  if (cands.length > 1) {
    // Umwandlung: standardmäßig Dame
    const promoQ = cands.filter((m) => m.promotion === "q");
    if (promoQ.length === 1) cands = promoQ;
  }
  return cands.length === 1 ? cands[0] : null;
}
