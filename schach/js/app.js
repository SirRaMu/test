import { Chess } from "../vendor/chess.js";
import { OPENINGS, normalizeOpening } from "./openings.js";
import { BoardView } from "./board.js";
import { BoardCamera } from "./camera.js";
import { Speaker, Listener, parseCommand, parseSpokenMove, sanToSpeech, sanToGerman } from "./speech.js";
import { Coach, MODELS } from "./ai.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat-Modus */ } },
};

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
const settings = Object.assign(
  { apiKey: "", model: MODELS[0].id, voice: true, rate: 1.05, perspective: "von der Seite von Weiß (Weiß unten im Bild)", autoDetect: true, notes: true, explainMistakes: true, showFuture: true },
  store.get("schach.settings", {}),
);
const progress = store.get("schach.progress", {}); // {openingId: {lineIdx: {runs, perfect}}}

const coach = new Coach();
coach.configure({ apiKey: settings.apiKey, model: settings.model });
const speaker = new Speaker();
speaker.enabled = settings.voice;
speaker.rate = settings.rate;
const listener = new Listener();
const board = new BoardView($("board"));
const camera = new BoardCamera($("video"));

const S = {
  opening: null, // normalisierte Eröffnung
  lineIdx: 0,
  randomLine: false,
  mode: "learn", // learn | quiz
  opp: "app", // app | partner
  game: new Chess(),
  outOfBook: false,
  awaiting: false,
  finished: false,
  mistakes: 0,
  hintShown: false,
  lastSpoken: "",
  detecting: false,
  recheck: false,
  advice: null, // Zugvorschlag von Claude außerhalb des Buchs
  view: null, // Durchblättern: angezeigter Halbzug (null = aktuelle Stellung)
  freeNotes: {}, // Claudes Kommentare zu Zügen außerhalb des Buchs (Halbzug -> Text)
  photoMode: false, // auf claude.ai: keine Live-Kamera, stattdessen Foto pro Zug
  vsClaude: false, // Claude spielt nach dem Buch selbst die Gegenseite
  claudeMove: null, // von Claude angesagter Zug, den der Nutzer ausführen soll
  pendingConfirm: null,
};

const line = () => S.opening.lines[S.lineIdx];
const userSide = () => S.opening.side;
const isUserTurn = () => S.game.turn() === userSide();
const ply = () => S.game.history().length;
const expected = () => (S.outOfBook ? null : line().moves[ply()] || null);
const colorName = (c) => (c === "w" ? "Weiß" : "Schwarz");

// ---------------------------------------------------------------------------
// Menü
// ---------------------------------------------------------------------------
let filter = "all";
function renderMenu() {
  $("setupHint").hidden = coach.ready;
  const list = $("openingList");
  list.innerHTML = "";
  for (const op of OPENINGS) {
    if (filter !== "all" && op.side !== filter) continue;
    const p = progress[op.id] || {};
    const done = Object.values(p).filter((x) => x.perfect > 0).length;
    const btn = document.createElement("button");
    btn.className = "card op-card";
    btn.innerHTML = `
      <div class="head"><span class="side">${op.side === "w" ? "♔" : "♚"}</span>
        <span class="title"></span><span class="badge"></span></div>
      <p></p>
      <span class="prog">${op.lines.length} Varianten${done ? ` · ${done} fehlerfrei gespielt ✓` : ""}</span>`;
    btn.querySelector(".title").textContent = op.name;
    btn.querySelector(".badge").textContent = `${op.side === "w" ? "Weiß" : "Schwarz"} · ${op.level}`;
    btn.querySelector("p").textContent = op.summary;
    btn.addEventListener("click", () => openOpeningDialog(op.id));
    list.appendChild(btn);
  }
}

document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    filter = t.dataset.filter;
    renderMenu();
  }),
);

let dialogOpening = null;
function openOpeningDialog(id) {
  const op = normalizeOpening(OPENINGS.find((o) => o.id === id));
  dialogOpening = op;
  $("opTitle").textContent = (op.side === "w" ? "♔ " : "♚ ") + op.name;
  $("opSummary").textContent = op.summary;
  $("opIdeas").innerHTML = "";
  for (const idea of op.ideas) {
    const li = document.createElement("li");
    li.textContent = idea;
    $("opIdeas").appendChild(li);
  }
  const p = progress[op.id] || {};
  $("opLines").innerHTML = "";
  const addChoice = (value, title, sub, checked) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="line" value="${value}" ${checked ? "checked" : ""}><span><b></b><small></small></span>`;
    l.querySelector("b").textContent = title;
    l.querySelector("small").textContent = sub;
    $("opLines").appendChild(l);
  };
  op.lines.forEach((ln, i) => {
    const st = p[i];
    const preview = ln.moves.slice(0, 8).map((m, k) => (k % 2 === 0 ? `${k / 2 + 1}.` : "") + sanToGerman(m.san)).join(" ");
    addChoice(i, ln.name + (st?.perfect ? " ✓" : ""), `${preview} … (${Math.ceil(ln.moves.length / 2)} Züge)`, i === 0);
  });
  addChoice("random", "🎲 Zufällige Variante", "Der Trainer wählt – gut zum Wiederholen", false);
  $("dlgOpening").showModal();
}

$("dlgOpening").addEventListener("close", () => {
  if ($("dlgOpening").returnValue !== "start" || !dialogOpening) return;
  const f = $("dlgOpening").querySelector("form");
  const lineVal = f.querySelector("input[name=line]:checked")?.value ?? "0";
  startTraining(dialogOpening, {
    lineIdx: lineVal === "random" ? null : Number(lineVal),
    mode: f.querySelector("input[name=mode]:checked").value,
    opp: f.querySelector("input[name=opp]:checked").value,
  });
});

// ---------------------------------------------------------------------------
// Training starten / Bildschirmwechsel
// ---------------------------------------------------------------------------
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* nicht unterstützt */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !$("screenTrain").hidden) keepAwake(true);
});

function showScreen(name) {
  $("screenMenu").hidden = name !== "menu";
  $("screenTrain").hidden = name !== "train";
  $("btnBack").hidden = name !== "train";
  $("topSub").textContent = name === "train" ? "Training läuft" : coach.viaAccount ? "läuft über dein Claude-Konto" : "mit Claude, Kamera & Sprache";
  window.scrollTo(0, 0);
}

function startTraining(op, { lineIdx, mode, opp, free = false }) {
  S.opening = op;
  S.randomLine = lineIdx === null;
  S.lineIdx = lineIdx === null ? Math.floor(Math.random() * op.lines.length) : lineIdx;
  S.mode = mode;
  S.opp = opp;
  coach.resetConversation();
  $("chatLog").innerHTML = "";
  showScreen("train");
  keepAwake(true);
  board.setOrientation(op.side);
  resetGame();
  if (free) {
    S.vsClaude = true;
    S.outOfBook = true;
    sys(`Freie Partie gegen Claude – du spielst ${colorName(op.side)}`);
    step(`Wir spielen eine freie Partie. Du hast ${op.side === "w" ? "Weiß und fängst an" : "Schwarz, ich fange an"}. Ich sage dir meine Züge an, du führst sie auf dem Brett für mich aus. Du kannst mich jederzeit etwas fragen.`);
    return;
  }
  sys(`${op.name} – ${line().name}. ${mode === "quiz" ? "Abfragemodus" : "Lernmodus"}, ${opp === "app" ? "der Trainer sagt die Gegnerzüge an" : "ein Mitspieler spielt frei"}.`);
  const intro =
    `Wir üben ${op.name}, ${line().name}. Du spielst ${colorName(op.side)}. ` +
    (mode === "quiz" ? "Ich sage dir nicht, was du ziehen sollst – spiel aus dem Gedächtnis. " : "") +
    (opp === "app" ? "Die Züge des Gegners sage ich dir an, du führst sie dann auf dem Brett aus. " : "");
  step(intro);
}

function resetGame() {
  S.game = new Chess();
  S.outOfBook = false;
  S.finished = false;
  S.mistakes = 0;
  S.advice = null;
  S.claudeMove = null;
  // Freie Partie (Variante ohne Buchzüge) bleibt eine Partie gegen Claude
  S.vsClaude = !!S.opening && line().moves.length === 0;
  S.outOfBook = S.vsClaude;
  S.pendingConfirm = null;
  S.freeNotes = {};
  S.view = null;
  board.interactive = true;
  board.setArrows([]);
  $("reviewBanner").hidden = true;
  $("finishBox").hidden = true;
  board.setHighlights({ last: null, hint: null });
  board.render(S.game);
  updateHead();
}

function updateHead() {
  $("trOpening").textContent = S.opening.name;
  $("trLine").textContent = S.vsClaude ? (line().moves.length ? `${line().name} → gegen Claude` : line().name) : S.outOfBook ? `${line().name} → freies Spiel` : line().name;
  const total = line().moves.length;
  $("trProgress").style.width = total ? `${Math.min(100, (ply() / total) * 100)}%` : "100%";
  $("trScore").textContent = `Zug ${Math.floor(ply() / 2) + 1} · Fehler: ${S.mistakes}`;
  renderMoves();
}

// ---------------------------------------------------------------------------
// Zugliste, Erklärungen und Durchblättern
// ---------------------------------------------------------------------------
/** Alle Züge, die in der Liste stehen: gespielte + (im Lernmodus) die restliche Variante. */
function listMoves() {
  const hist = S.game.history();
  const out = hist.map((san, i) => ({ san, played: true, note: noteFor(hist, i) }));
  if (!S.outOfBook && S.mode === "learn" && settings.showFuture) {
    for (let i = hist.length; i < line().moves.length; i++) out.push({ san: line().moves[i].san, played: false, note: line().moves[i].note });
  }
  return out;
}

function noteFor(hist, i) {
  const ln = S.opening.lines.find((l) => hist.slice(0, i + 1).every((h, k) => l.moves[k]?.san === h));
  if (ln) return ln.moves[i].note;
  return S.freeNotes[i] || "";
}

function renderMoves() {
  const list = $("moveList");
  if (!list || !S.opening) return;
  const moves = listMoves();
  const cur = S.game.history().length;
  let html = "";
  for (let i = 0; i < moves.length; i += 2) {
    html += `<span class="no">${i / 2 + 1}.</span>`;
    for (const k of [i, i + 1]) {
      const m = moves[k];
      if (!m) { html += "<span></span>"; continue; }
      const cls = [m.played ? "" : "future", S.view === k + 1 ? "view" : "", S.view === null && k === cur - 1 ? "cur" : ""].join(" ");
      html += `<button type="button" class="${cls}" data-ply="${k + 1}">${sanToGerman(m.san)}</button>`;
    }
  }
  if (!moves.length) html = `<span></span><span class="muted" style="grid-column: span 2">Noch keine Züge.</span>`;
  list.innerHTML = html;
  const active = list.querySelector(".view, .cur");
  active?.scrollIntoView({ block: "nearest" });
  // Erklärung zum angezeigten bzw. letzten Zug
  const show = S.view ?? cur;
  const m = moves[show - 1];
  $("moveNote").innerHTML = m
    ? `<b>${Math.ceil(show / 2)}.${show % 2 === 0 ? ".." : ""} ${sanToGerman(m.san)}</b> – ${escapeHtml(m.note || "Keine Erklärung hinterlegt. Frag Claude mit „🧠 Warum?“.")}`
    : `<span class="muted">${escapeHtml(S.opening.summary || "")}</span>`;
  $("btnPrev").disabled = show <= 0;
  $("btnFirst").disabled = show <= 0;
  $("btnNext").disabled = show >= moves.length;
  $("btnLast").disabled = S.view === null;
}

function escapeHtml(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/** Eine Stellung aus der Liste ansehen (nur Anzeige, die Partie läuft weiter). */
function viewPly(n) {
  const moves = listMoves();
  n = Math.max(0, Math.min(n, moves.length));
  if (n === S.game.history().length && moves.slice(0, n).every((m) => m.played)) return goLive();
  S.view = n;
  const g = new Chess();
  let last = null;
  for (const m of moves.slice(0, n)) last = g.move(m.san);
  board.interactive = false;
  board.setArrows(last ? [{ from: last.from, to: last.to, kind: last.color === userSide() ? "you" : "opp" }] : []);
  board.highlights = { last: last ? { from: last.from, to: last.to } : null, hint: null };
  board.render(g);
  $("reviewBanner").hidden = false;
  $("reviewText").textContent = n ? `Ansicht nach ${Math.ceil(n / 2)}.${n % 2 === 0 ? ".." : ""} ${sanToGerman(last.san)}` : "Ansicht: Ausgangsstellung";
  renderMoves();
}

function goLive() {
  if (S.view === null) return;
  S.view = null;
  board.interactive = true;
  board.setArrows([]);
  $("reviewBanner").hidden = true;
  const last = S.game.history({ verbose: true }).slice(-1)[0];
  board.highlights = { last: last ? { from: last.from, to: last.to } : null, hint: S.liveHint || null };
  board.render(S.game);
  renderMoves();
}

$("moveList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ply]");
  if (b) viewPly(Number(b.dataset.ply));
});
$("btnPrev").addEventListener("click", () => viewPly((S.view ?? S.game.history().length) - 1));
$("btnNext").addEventListener("click", () => viewPly((S.view ?? S.game.history().length) + 1));
$("btnFirst").addEventListener("click", () => viewPly(0));
$("btnLast").addEventListener("click", goLive);
$("btnLive").addEventListener("click", goLive);

$("btnBack").addEventListener("click", () => {
  speaker.stop();
  camera.armed = false;
  S.awaiting = false;
  keepAwake(false);
  showScreen("menu");
  renderMenu();
});

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------
function mvHtml(san) {
  return `<span class="mv">${sanToGerman(san)}</span>`;
}

/** Nächsten Schritt ansagen. `prefix` wird vor der Ansage vorgelesen. */
async function step(prefix = "") {
  if (S.view !== null) goLive();
  updateHead();
  board.render(S.game);
  S.hintShown = false;
  S.pendingConfirm = null;

  if (S.game.isGameOver()) {
    S.awaiting = false;
    camera.armed = false;
    say("Die Partie ist beendet.", S.game.isCheckmate() ? "Schachmatt!" : "Remis.", { extraSpeech: prefix });
    return;
  }

  if (S.outOfBook) return stepFree(prefix);

  const exp = expected();
  if (!exp) return finish(prefix);

  S.awaiting = true;
  camera.armed = settings.autoDetect && camera.running;
  const color = S.game.turn();

  if (isUserTurn()) {
    if (S.mode === "learn") {
      board.setHighlights({ hint: { ...moveSquares(exp.san), kind: "you" } });
      say(`Dein Zug: ${mvHtml(exp.san)}`, exp.note, { extraSpeech: prefix });
    } else {
      board.setHighlights({ hint: null });
      say("Du bist dran – welcher Zug?", "Tipp: Sag „Tipp“, wenn du nicht weiterweißt.", { speakNote: false, extraSpeech: prefix });
    }
  } else if (S.opp === "app") {
    board.setHighlights({ hint: { ...moveSquares(exp.san), kind: "opp" } });
    say(
      `Gegner (${colorName(color)}): ${mvHtml(exp.san)}`,
      exp.note,
      { extraSpeech: prefix, tail: ply() < 2 ? "Führe diesen Zug bitte für den Gegner auf dem Brett aus." : "" },
    );
  } else {
    board.setHighlights({ hint: null });
    say(`${colorName(color)} (Mitspieler) ist am Zug`, "Ich erkenne den Zug über die Kamera – oder tippe ihn auf dem Brett ein.", { speakNote: false, extraSpeech: prefix });
  }
}

/**
 * Zeigt eine Ansage an und liest sie vor. Züge in `main` (als <span class="mv">) werden
 * ausgeschrieben vorgelesen ("Sf3" -> "Springer nach f3").
 * opts: extraSpeech (vorher vorlesen), tail (danach vorlesen), speakNote, bad
 */
function say(main, note = "", opts = {}) {
  $("coachMain").innerHTML = main;
  $("coachMain").classList.toggle("bad", !!opts.bad);
  $("coachNote").textContent = note || "";
  const tmp = document.createElement("div");
  tmp.innerHTML = main;
  tmp.querySelectorAll(".mv").forEach((el) => (el.textContent = sanToSpeech(germanToSan(el.textContent))));
  const spoken = tmp.textContent;
  const text = [opts.extraSpeech, spoken + ".", opts.speakNote !== false && settings.notes ? note : "", opts.tail]
    .filter(Boolean)
    .join(" ");
  S.lastSpoken = text;
  speaker.speak(text);
}

function germanToSan(g) {
  return g.replace(/^[KDTLS]/, (p) => ({ K: "K", D: "Q", T: "R", L: "B", S: "N" })[p]).replace(/=([DTLS])/, (_, p) => "=" + { D: "Q", T: "R", L: "B", S: "N" }[p]);
}

function moveSquares(san) {
  try {
    const g = new Chess(S.game.fen());
    const m = g.move(san);
    return { from: m.from, to: m.to };
  } catch {
    return null;
  }
}

async function stepFree(prefix) {
  S.awaiting = true;
  camera.armed = settings.autoDetect && camera.running;
  S.claudeMove = null;
  board.setHighlights({ hint: null });

  if (S.vsClaude) {
    if (isUserTurn()) {
      say("Du bist dran", "Spiel deinen Zug auf dem Brett. „Tipp“ gibt dir einen Vorschlag.", { extraSpeech: prefix, speakNote: false });
      return;
    }
    if (!coach.ready) {
      say("Claude braucht eine Verbindung", "Trag unter ⚙️ einen Claude-API-Schlüssel ein, damit Claude mitspielen kann.", { extraSpeech: prefix });
      return;
    }
    say("Claude überlegt …", "", { extraSpeech: prefix, speakNote: false });
    const fenAtAsk = S.game.fen();
    try {
      const r = await coach.playOrAdvise({ game: S.game, ctx: contextText(), userSide: userSide(), role: "opponent" });
      if (S.game.fen() !== fenAtAsk) return;
      if (!r.move) throw new Error("Claude hat keinen gültigen Zug geliefert – bitte „Nochmal“ antippen.");
      S.claudeMove = r.move;
      board.setHighlights({ hint: { from: r.move.from, to: r.move.to, kind: "opp" } });
      if (r.comment) S.freeNotes[ply()] = r.comment;
      if (r.comment) coachMsg(r.comment);
      coachMsg(`➜ Ich spiele ${sanToGerman(r.move.san)}`);
      say(`Ich spiele ${mvHtml(r.move.san)}`, r.comment, {
        extraSpeech: r.comment,
        speakNote: false,
        tail: "Führe meinen Zug bitte auf dem Brett aus.",
      });
    } catch (e) {
      showError(e);
      say("Claude konnte nicht ziehen", "Tippe auf „🔁 Nochmal“, um es erneut zu versuchen.", { speakNote: false });
    }
    return;
  }

  if (isUserTurn()) {
    if (!coach.ready) {
      say("Freies Spiel – du bist dran", "Für Zugvorschläge außerhalb der Theorie trag einen Claude-API-Schlüssel ein.", { extraSpeech: prefix });
      return;
    }
    say("Freies Spiel – ich überlege …", "", { extraSpeech: prefix, speakNote: false });
    const fenAtAsk = S.game.fen();
    try {
      const adv = await coach.playOrAdvise({ game: S.game, ctx: contextText(), userSide: userSide(), role: "advice" });
      if (S.game.fen() !== fenAtAsk) return; // inzwischen weitergespielt
      S.advice = adv.move;
      if (adv.move) board.setHighlights({ hint: { from: adv.move.from, to: adv.move.to, kind: "claude" } });
      say(adv.move ? `Vorschlag: ${mvHtml(adv.move.san)}` : "Du bist dran", adv.comment);
      coachMsg(adv.comment + (adv.move ? `\n➜ Vorschlag: ${sanToGerman(adv.move.san)}` : ""));
    } catch (e) {
      showError(e);
      say("Freies Spiel – du bist dran", "");
    }
  } else {
    say(`${colorName(S.game.turn())} ist am Zug`, "Spiel den Zug des Gegners auf dem Brett und bestätige ihn per Kamera, Antippen oder Sprache.", { extraSpeech: prefix });
  }
}

/** Nach der Eröffnung (oder von Anfang an) gegen Claude weiterspielen. */
function playOnVsClaude() {
  S.vsClaude = true;
  S.outOfBook = true;
  S.finished = false;
  $("finishBox").hidden = true;
  sys("Freie Partie gegen Claude");
  step(S.game.history().length ? "Jetzt spielen wir die Partie zu Ende. Ich übernehme den Gegner." : "");
}

function finish(prefix) {
  S.awaiting = false;
  S.finished = true;
  camera.armed = false;
  board.setHighlights({ hint: null });
  const p = (progress[S.opening.id] ||= {});
  const st = (p[S.lineIdx] ||= { runs: 0, perfect: 0 });
  st.runs++;
  if (S.mistakes === 0) st.perfect++;
  store.set("schach.progress", progress);
  updateHead();
  $("trProgress").style.width = "100%";
  const praise = S.mistakes === 0 ? "Perfekt, ohne Fehler!" : `Geschafft – mit ${S.mistakes} ${S.mistakes === 1 ? "Fehler" : "Fehlern"}.`;
  say(`🎉 Variante geschafft! ${praise}`, "Wie geht's weiter? Nochmal, nächste Variante oder abfragen lassen.", { extraSpeech: prefix });
  $("finishBox").hidden = false;
}

// ---------------------------------------------------------------------------
// Zugeingabe (Kamera, Sprache, Brett, Knopf)
// ---------------------------------------------------------------------------
/**
 * @param move chess.js verbose move (muss legal sein)
 * @param source "board" | "voice" | "camera" | "button" | "text"
 */
function handleMove(move, source) {
  if (S.view !== null) goLive();
  if (!S.awaiting || S.finished) {
    if (source !== "camera") toast("Gerade wird kein Zug erwartet.");
    return;
  }
  const san = move.san;
  if (source !== "camera") camera.resetBaseline();

  if (S.outOfBook) {
    if (S.vsClaude && !isUserTurn()) {
      if (!S.claudeMove) return toast("Moment, Claude überlegt noch.");
      if (san !== S.claudeMove.san) {
        say(
          `Erkannt: ${mvHtml(san)} – ich hatte ${mvHtml(S.claudeMove.san)} angesagt`,
          "Bitte stell meinen Zug richtig auf. Oder übernimm den erkannten Zug unten.",
          { bad: true },
        );
        S.pendingConfirm = move;
        addConfirmButton(move, () => applyFree(move));
        return;
      }
    }
    return applyFree(move);
  }


  const exp = expected();
  const userMove = isUserTurn();

  if (san === exp.san) {
    S.game.move(san);
    board.setHighlights({ last: { from: move.from, to: move.to }, hint: null });
    sys(`${colorName(move.color)}: ${sanToGerman(san)}${source === "camera" ? " (Kamera)" : ""}`);
    let prefix = "";
    if (userMove) {
      prefix = S.hintShown || S.mode === "learn" ? "Richtig." : pick(["Richtig!", "Sehr gut!", "Genau!", "Perfekt!"]);
      if (S.mode === "quiz" && settings.notes && exp.note) prefix += " " + exp.note;
    }
    return step(prefix);
  }

  // Anderer Buchzug derselben Eröffnung? -> Variante wechseln
  const hist = S.game.history();
  const altIdx = S.opening.lines.findIndex(
    (l) => hist.every((h, i) => l.moves[i]?.san === h) && l.moves[hist.length]?.san === san,
  );
  if (altIdx >= 0) {
    S.lineIdx = altIdx;
    S.game.move(san);
    board.setHighlights({ last: { from: move.from, to: move.to }, hint: null });
    sys(`${colorName(move.color)}: ${sanToGerman(san)} → Variante „${line().name}“`);
    const note = line().moves[hist.length].note;
    return step(`Das ist auch Theorie: ${line().name}. ${settings.notes ? note : ""}`);
  }

  if (userMove) {
    S.mistakes++;
    updateHead();
    S.hintShown = true;
    board.setHighlights({ hint: { ...moveSquares(exp.san), kind: "you" } });
    const takeBack = source === "board" || source === "text" ? "" : " Bitte nimm den Zug auf dem Brett zurück.";
    say(
      `Nicht ganz: ${mvHtml(san)} ✗ – richtig ist ${mvHtml(exp.san)}`,
      exp.note,
      { bad: true, tail: takeBack },
    );
    if (takeBack) setTimeout(() => toast("Zug auf dem Brett zurücknehmen und dann richtig ziehen."), 200);
    sys(`Falsch: ${sanToGerman(san)} (erwartet ${sanToGerman(exp.san)})`);
    camera.resetBaseline();
    explainMistake(san, exp);
    return;
  }

  // Gegner weicht vom Buch ab
  if (S.opp === "partner" || source === "board" || source === "text" || source === "voice") {
    leaveBook(move);
  } else {
    // Trainer hat einen anderen Gegnerzug angesagt als erkannt wurde
    S.pendingConfirm = move;
    say(
      `Erkannt: ${mvHtml(san)} – angesagt war ${mvHtml(exp.san)}`,
      "Bitte korrigiere den Zug auf dem Brett. Oder tippe auf „✅ Zug ausgeführt“, wenn ich mich verguckt habe.",
      { bad: true },
    );
    addConfirmButton(move);
  }
}

/** Claude erklärt kurz, warum der gespielte Zug schlechter ist als der Buchzug. */
async function explainMistake(wrongSan, exp) {
  if (!settings.explainMistakes || !coach.ready) return;
  const fen = S.game.fen();
  const typing = document.createElement("div");
  typing.className = "msg coach typing";
  typing.textContent = "Claude erklärt den Fehler …";
  $("chatLog").appendChild(typing);
  $("chatLog").scrollTop = 1e9;
  try {
    const text = await coach.explainMistake({ game: S.game, wrong: wrongSan, right: exp.san, note: exp.note, ctx: contextText() });
    typing.remove();
    if (!text) return;
    coachMsg("💡 " + text);
    // Nur vorlesen, wenn noch dieselbe Stellung auf dem Brett ist
    if (S.game.fen() === fen) {
      $("coachNote").textContent = text;
      await speaker.whenIdle?.();
      if (S.game.fen() === fen) speaker.speak(text);
    }
  } catch (e) {
    typing.remove();
    if (e?.code !== "cancelled") sys("⚠️ " + (e.message || e));
  }
}

function leaveBook(move) {
  S.game.move(move.san);
  S.outOfBook = true;
  board.setHighlights({ last: { from: move.from, to: move.to }, hint: null });
  sys(`${colorName(move.color)}: ${sanToGerman(move.san)} – außerhalb der Theorie`);
  step(`Der Gegner hat mit ${sanToSpeech(move.san)} die Theorie verlassen. Ab jetzt spielen wir frei.`);
}

function addConfirmButton(move, onAccept = () => leaveBook(move)) {
  const b = document.createElement("button");
  b.className = "btn small";
  b.textContent = `Doch ${sanToGerman(move.san)} übernehmen`;
  b.addEventListener("click", () => {
    b.remove();
    if (S.pendingConfirm === move) onAccept();
  });
  const wrap = document.createElement("div");
  wrap.className = "msg sys";
  wrap.appendChild(b);
  $("chatLog").appendChild(wrap);
  $("chatLog").scrollTop = 1e9;
}

function applyFree(move) {
  const san = move.san;
  S.game.move(san);
  board.setHighlights({ last: { from: move.from, to: move.to }, hint: null });
  sys(`${colorName(move.color)}: ${sanToGerman(san)}`);
  const good = S.advice && S.advice.san === san && move.color === userSide();
  S.advice = null;
  S.claudeMove = null;
  return step(good ? "Gut gespielt." : "");
}

/** "Zug ausgeführt" – der erwartete Zug wurde auf dem Brett gemacht. */
function confirmDone() {
  if (!S.awaiting) return;
  if (S.outOfBook) {
    if (isUserTurn() && S.advice && !S.vsClaude) return handleMove(S.advice, "button");
    if (!isUserTurn() && S.claudeMove) return handleMove(S.claudeMove, "button");
    toast("Im freien Spiel brauche ich den genauen Zug: per Kamera, Antippen oder Sprache.");
    return;
  }
  const exp = expected();
  if (!exp) return;
  if (isUserTurn() && S.mode === "quiz" && !S.hintShown) {
    toast("Im Abfragemodus: Sag den Zug, tippe ihn an oder lass die Kamera prüfen.");
    speaker.speak("Welchen Zug hast du gespielt? Sag ihn mir, oder lass die Kamera prüfen.");
    return;
  }
  const m = S.game.moves({ verbose: true }).find((x) => x.san === exp.san);
  handleMove(m, "button");
}

function giveHint() {
  if (!S.awaiting) return;
  if (S.outOfBook) {
    if (S.vsClaude && isUserTurn()) {
      askHintVsClaude();
      return;
    }
    if (S.advice) speaker.speak(`Mein Vorschlag: ${sanToSpeech(S.advice.san)}`);
    return;
  }
  const exp = expected();
  if (!exp) return;
  if (!S.hintShown && S.mode === "quiz" && isUserTurn()) {
    // Erst ein kleiner Tipp: welche Figur
    S.hintShown = true;
    const piece = { N: "dem Springer", B: "dem Läufer", R: "dem Turm", Q: "der Dame", K: "dem König", O: "dem König (Rochade)" }[exp.san[0]] || "einem Bauern";
    const sq = moveSquares(exp.san);
    if (sq) board.setHighlights({ hint: { from: sq.from, to: null } });
    say(`Tipp: Zieh mit ${piece}`, "Sag nochmal „Tipp“ für die Lösung.", { speakNote: false });
    return;
  }
  S.hintShown = true;
  board.setHighlights({ hint: { ...moveSquares(exp.san), kind: isUserTurn() ? "you" : "opp" } });
  say(`Lösung: ${mvHtml(exp.san)}`, exp.note);
}

async function askHintVsClaude() {
  if (!coach.ready) return toast("Für Tipps brauche ich eine Claude-Verbindung (⚙️).");
  say("Ich schaue mir die Stellung an …", "", { speakNote: false });
  const fen = S.game.fen();
  try {
    const adv = await coach.playOrAdvise({ game: S.game, ctx: contextText(), userSide: userSide(), role: "advice" });
    if (S.game.fen() !== fen) return;
    S.advice = adv.move;
    if (adv.move) board.setHighlights({ hint: { from: adv.move.from, to: adv.move.to, kind: "claude" } });
    coachMsg(adv.comment + (adv.move ? `\n➜ Vorschlag: ${sanToGerman(adv.move.san)}` : ""));
    say(adv.move ? `Mein Tipp: ${mvHtml(adv.move.san)}` : "Du bist dran", adv.comment);
  } catch (e) {
    showError(e);
  }
}

function undo() {
  if (S.game.history().length === 0) return;
  // Bis zum letzten eigenen Zug zurück (damit der Nutzer wieder am Zug ist)
  S.game.undo();
  if (!isUserTurn() && S.game.history().length) S.game.undo();
  S.finished = false;
  $("finishBox").hidden = true;
  if (S.outOfBook && !S.vsClaude) {
    const hist = S.game.history();
    S.outOfBook = !S.opening.lines.some((l) => hist.every((h, i) => l.moves[i]?.san === h));
    if (!S.outOfBook) S.lineIdx = S.opening.lines.findIndex((l) => hist.every((h, i) => l.moves[i]?.san === h));
  }
  board.setHighlights({ last: null });
  camera.resetBaseline();
  sys("Zug zurückgenommen – bitte auch auf dem Brett zurückstellen.");
  step("Zurückgenommen.");
}

const _setHL = board.setHighlights.bind(board);
board.setHighlights = (h) => {
  if ("hint" in h) S.liveHint = h.hint;
  if (S.view !== null) return; // während des Durchblätterns nicht überschreiben
  _setHL(h);
};

board.onMove = ({ from, to, promotion }) => {
  if (S.view !== null) goLive();
  const legal = S.game.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
  if (!legal.length) return board.render(S.game);
  const m = legal.find((x) => (promotion ? x.promotion === promotion : !x.promotion || x.promotion === "q")) || legal[0];
  handleMove(m, "board");
  board.render(S.game);
};

// ---------------------------------------------------------------------------
// Kamera
// ---------------------------------------------------------------------------
function camStatus(text, cls = "") {
  const el = $("camStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

async function startCamera() {
  if (S.photoMode) return $("photoInput").click();
  try {
    await camera.start();
    $("camOff").hidden = true;
    camStatus(settings.autoDetect ? "bereit – warte auf Zug" : "bereit", "ok");
    camera.armed = settings.autoDetect && S.awaiting;
    if (!coach.ready) toast("Für die Kamera-Erkennung brauchst du einen Claude-API-Schlüssel (⚙️).");
  } catch (e) {
    toast("Kamera konnte nicht gestartet werden: " + (e.message || e.name));
    camStatus("Fehler", "busy");
  }
}
function stopCamera() {
  camera.stop();
  $("camOff").hidden = false;
  camStatus("aus");
}

$("btnCam").addEventListener("click", startCamera);
$("btnCamToggle").addEventListener("click", () => (S.photoMode ? $("photoInput").click() : camera.running ? stopCamera() : startCamera()));
$("btnCamSwitch").addEventListener("click", () => camera.switchCamera().catch((e) => toast(e.message)));
$("btnDetect").addEventListener("click", async () => {
  if (S.photoMode || !camera.running) return $("photoInput").click();
  const after = await camera.capture();
  runDetection(camera.baseline, after, true);
});

// Foto vom Brett (Kamera-App des Handys) – wird mit der bekannten Stellung verglichen
$("photoInput").addEventListener("change", async () => {
  const file = $("photoInput").files?.[0];
  $("photoInput").value = "";
  if (!file) return;
  if (!S.awaiting) return toast("Gerade wird kein Zug erwartet.");
  try {
    const img = await toJpeg(file);
    showPhoto(img);
    runDetection(null, img, true);
  } catch {
    toast("Das Foto konnte nicht gelesen werden.");
  }
});

async function toJpeg(file, maxSide = 1280) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
}

function showPhoto(blob) {
  const v = $("camView");
  let img = v.querySelector("img.photo");
  if (!img) {
    img = document.createElement("img");
    img.className = "photo";
    v.prepend(img);
  }
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(blob);
  $("camOff").hidden = true;
}

camera.onMotion = (lvl) => {
  $("motionBar").style.width = `${Math.min(100, lvl * 800)}%`;
};
camera.onStateChange = (st) => {
  if (S.detecting) return;
  if (st === "moving") camStatus("Bewegung …", "busy");
  else if (st === "settling") camStatus("warte, bis die Hand weg ist …", "busy");
  else camStatus(camera.armed ? "bereit – warte auf Zug" : "bereit", "ok");
};
camera.onStable = (before, after) => runDetection(before, after, false);

async function runDetection(before, after, manual) {
  if (!coach.ready || !coach.canSeeImages) {
    if (manual) toast(coach.ready ? "Bilder können hier nicht an Claude geschickt werden." : "Für die Kamera-Erkennung bitte einen Claude-API-Schlüssel eintragen (⚙️).");
    if (!S.photoMode) camera.baseline = after;
    return;
  }
  if (!S.awaiting) {
    camera.baseline = after;
    return;
  }
  if (S.detecting) {
    S.recheck = true;
    return;
  }
  S.detecting = true;
  camStatus("Claude schaut aufs Brett …", "busy");
  const fenAtAsk = S.game.fen();
  try {
    const res = await coach.detectMove({
      before, after, game: S.game, expected: expected() && moveFor(expected().san), perspective: settings.perspective,
    });
    if (S.game.fen() !== fenAtAsk) {
      // Inzwischen wurde der Zug schon anders eingegeben
      camera.baseline = after;
    } else if (res.move && res.confidence >= 0.45) {
      camera.baseline = after;
      const exp = expected();
      if (exp && res.move.san !== exp.san && res.confidence < 0.8 && isUserTurn()) {
        // Unsicher und abweichend: lieber nachfragen als einen Fehler zählen
        say(
          `Ich glaube, ich sehe ${mvHtml(res.move.san)} – stimmt das?`,
          "Wenn nicht: Kamera ruhig halten und „📸 Zug prüfen“ tippen, oder den Zug sagen.",
          { speakNote: false },
        );
        addAcceptDetected(res.move);
      } else {
        handleMove(res.move, "camera");
      }
    } else {
      // Kein (sicherer) Zug erkannt – Referenzbild bleibt, damit der nächste Versuch den ganzen Zug sieht
      if (manual) toast("Kein Zug erkannt. " + (res.observation || ""));
      sys("Kamera: " + (res.observation || "kein Zug erkannt"));
    }
  } catch (e) {
    showError(e);
  } finally {
    S.detecting = false;
    camStatus(S.photoMode ? "Foto-Modus" : camera.running ? "bereit" : "aus", camera.running || S.photoMode ? "ok" : "");
    if (S.recheck && camera.running) {
      S.recheck = false;
      const fresh = await camera.capture();
      runDetection(camera.baseline, fresh, false);
    }
  }
}

function moveFor(san) {
  return S.game.moves({ verbose: true }).find((m) => m.san === san) || null;
}

function addAcceptDetected(move) {
  const b = document.createElement("button");
  b.className = "btn small";
  b.textContent = `Ja, ${sanToGerman(move.san)}`;
  b.addEventListener("click", () => {
    b.parentElement.remove();
    if (moveFor(move.san)) handleMove(moveFor(move.san), "camera");
  });
  const wrap = document.createElement("div");
  wrap.className = "msg sys";
  wrap.appendChild(b);
  $("chatLog").appendChild(wrap);
  $("chatLog").scrollTop = 1e9;
}

// ---------------------------------------------------------------------------
// Sprache & Chat
// ---------------------------------------------------------------------------
// Kurzer Ton, sobald der Trainer fertig gesprochen hat und wieder zuhört
let audioCtx = null;
function beep() {
  if (!audioCtx) return;
  try {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.2);
  } catch { /* egal */ }
}
speaker.onStart = () => listener.pause();
speaker.onEnd = () =>
  setTimeout(() => {
    if (!listener.active) return;
    listener.resume();
    beep();
  }, 300);

listener.onState = (st) => {
  const btn = $("btnMic");
  btn.classList.toggle("on", st === "listening" || st === "starting");
  btn.classList.toggle("paused", st === "paused");
  $("micState").textContent = {
    unsupported: "Spracheingabe wird von diesem Browser nicht unterstützt (Chrome oder Safari nutzen)",
    off: "Mikrofon aus – tippe zum Sprechen",
    paused: "Trainer spricht …",
    listening: "🟢 Du kannst jetzt sprechen",
    starting: "🟢 Du kannst jetzt sprechen",
    denied: "Mikrofon-Zugriff verweigert – in den Einstellungen erlauben",
    tap: "🎤 Tippe aufs Mikrofon und sprich",
  }[st] || st;
};
listener.onPartial = (t) => ($("micPartial").textContent = t);
listener.onFinal = (t) => {
  $("micPartial").textContent = "";
  handleUtterance(t, "voice");
};
listener.onState(listener.state);

$("btnMic").addEventListener("click", () => {
  if (!listener.supported) return toast("Spracheingabe geht in diesem Browser nicht. Du kannst unten tippen.");
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* kein Ton */ }
  }
  if (listener.active) listener.stop();
  else {
    speaker.stop();
    listener.start();
    beep();
  }
});

$("btnVoice").addEventListener("click", () => {
  settings.voice = !settings.voice;
  speaker.enabled = settings.voice;
  if (!settings.voice) speaker.stop();
  store.set("schach.settings", settings);
  $("btnVoice").textContent = settings.voice ? "🔊" : "🔇";
});
$("btnVoice").textContent = settings.voice ? "🔊" : "🔇";

$("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("chatInput").value.trim();
  if (!t) return;
  $("chatInput").value = "";
  handleUtterance(t, "text");
});

function handleUtterance(text, source) {
  if (!S.opening || $("screenTrain").hidden) return;
  const cmd = parseCommand(text);
  if (cmd && text.split(/\s+/).length <= 4) {
    meMsg(text);
    if (cmd === "done") return confirmDone();
    if (cmd === "hint") return giveHint();
    if (cmd === "repeat") return speaker.speak(S.lastSpoken);
    if (cmd === "undo") return undo();
    if (cmd === "stop") return speaker.stop();
  }
  if (S.awaiting) {
    const legal = S.game.moves({ verbose: true });
    const t = text.trim();
    // Deutsche Kurznotation ("Sf3", "Lxc6") nur umwandeln, wenn es wirklich Notation ist
    const isNotation = /^[KDTLS][a-h]?[1-8]?x?[a-h][1-8](=[DTLS])?[+#]?$/.test(t);
    const mv = (isNotation && parseSpokenMove(germanToSan(t), legal)) || parseSpokenMove(t, legal);
    if (mv && text.split(/\s+/).length <= 6) {
      meMsg(text);
      return handleMove(mv, source);
    }
  }
  // Einzelne Wörter / Geräusche ignorieren, wenn gesprochen
  if (source === "voice" && text.split(/\s+/).length < 2) return;
  askCoach(text);
}

async function askCoach(question, { silentUser = false } = {}) {
  if (!silentUser) meMsg(question);
  if (!coach.ready) {
    coachMsg("Für Fragen an mich brauche ich einen Claude-API-Schlüssel – trag ihn unter ⚙️ Einstellungen ein.");
    return;
  }
  const typing = document.createElement("div");
  typing.className = "msg coach typing";
  typing.textContent = "denkt nach …";
  $("chatLog").appendChild(typing);
  $("chatLog").scrollTop = 1e9;
  try {
    const answer = await coach.ask(question, contextText());
    typing.remove();
    coachMsg(answer);
    S.lastSpoken = answer;
    speaker.speak(answer);
  } catch (e) {
    typing.remove();
    showError(e);
  }
}

function contextText() {
  const g = S.game;
  const hist = g.history();
  const movesTxt = hist.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + m).join(" ") || "(noch keine)";
  const exp = expected();
  return [
    `Eröffnung: ${S.opening.name} (${S.opening.summary})`,
    `Der Nutzer spielt: ${colorName(userSide())}`,
    `Geübte Variante: ${line().name}`,
    `Vollständige Variante laut Buch: ${line().moves.map((m) => m.san).join(" ")}`,
    `Modus: ${S.mode === "quiz" ? "Abfragen (Nutzer soll Züge selbst finden – verrate den nächsten Zug nur, wenn er ausdrücklich danach fragt)" : "Lernen"}`,
    `Gegner: ${S.opp === "app" ? "die App gibt die Gegnerzüge vor" : "ein Mitspieler spielt frei"}`,
    `Bisher gespielt: ${movesTxt}`,
    `Aktuelle Stellung (FEN): ${g.fen()}`,
    `Am Zug: ${colorName(g.turn())}${isUserTurn() ? " (der Nutzer)" : " (der Gegner)"}`,
    S.vsClaude ? "Freie Partie: Du (Claude) spielst selbst die Gegenseite." : S.outOfBook ? "Die Partie hat das Eröffnungsbuch verlassen." : exp ? `Nächster Buchzug: ${exp.san}${exp.note ? ` – ${exp.note}` : ""}` : "Die Variante ist zu Ende gespielt.",
    `Fehler bisher: ${S.mistakes}`,
  ].join("\n");
}

function meMsg(t) { addMsg(t, "me"); }
function coachMsg(t) { addMsg(t, "coach"); }
function sys(t) { addMsg(t, "sys"); }
function addMsg(t, cls) {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = t;
  $("chatLog").appendChild(d);
  $("chatLog").scrollTop = 1e9;
}

function toast(t) {
  const el = $("toast");
  el.textContent = t;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3500);
}

function showError(e) {
  const msg = e?.message || String(e);
  sys("⚠️ " + msg);
  toast(msg);
  if (e?.code === "auth" || e?.code === "no_key") openSettings();
}

function pick(a) {
  return a[Math.floor(Math.random() * a.length)];
}

// Knöpfe
$("btnDone").addEventListener("click", confirmDone);
$("btnHint").addEventListener("click", giveHint);
$("btnRepeat").addEventListener("click", () => {
  if (S.vsClaude && S.awaiting && !isUserTurn() && !S.claudeMove) return step();
  speaker.speak(S.lastSpoken);
});
$("btnUndo").addEventListener("click", undo);
$("btnWhy").addEventListener("click", () => {
  const exp = expected();
  const last = S.game.history().slice(-1)[0];
  const q = exp
    ? `Erkläre mir ausführlicher, warum in dieser Stellung ${exp.san} gespielt wird und welche Pläne beide Seiten jetzt haben.`
    : `Erkläre mir die Ideen hinter dem letzten Zug ${last || ""} und wie es in dieser Stellung typischerweise weitergeht.`;
  askCoach(S.mode === "quiz" && exp && isUserTurn() ? "Erkläre mir die aktuelle Stellung und worauf ich achten sollte, ohne den nächsten Zug zu verraten." : q);
});
$("btnPlayOn").addEventListener("click", playOnVsClaude);
for (const [id, side] of [["btnFreeW", "w"], ["btnFreeB", "b"]]) {
  $(id).addEventListener("click", () => {
    const free = {
      id: "frei-" + side, name: "Freie Partie gegen Claude", side, level: "", ideas: [],
      summary: "Freie Partie ohne Eröffnungsbuch", lines: [{ name: side === "w" ? "Du spielst Weiß" : "Du spielst Schwarz", moves: [] }],
    };
    startTraining(free, { lineIdx: 0, mode: "learn", opp: "app", free: true });
  });
}
$("btnAgain").addEventListener("click", () => { resetGame(); step("Noch einmal von vorne."); });
$("btnNextLine").addEventListener("click", () => {
  S.lineIdx = S.randomLine ? Math.floor(Math.random() * S.opening.lines.length) : (S.lineIdx + 1) % S.opening.lines.length;
  resetGame();
  sys(`Neue Variante: ${line().name}`);
  step(`Neue Variante: ${line().name}.`);
});
$("btnQuiz").addEventListener("click", () => {
  S.mode = "quiz";
  resetGame();
  sys("Abfragemodus");
  step("Jetzt frage ich dich ab. Spiel die Variante aus dem Gedächtnis.");
});
$("btnSummary").addEventListener("click", () =>
  askCoach(`Fasse die Variante ${line().name} der ${S.opening.name} zusammen: Was sind die wichtigsten Ideen, typischen Pläne im Mittelspiel und häufige Fallen?`),
);

// ---------------------------------------------------------------------------
// Tastatur (PC) und Foto per Drag & Drop
// ---------------------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if ($("screenTrain").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest("input, textarea, select, dialog[open]")) return;
  const k = e.key.toLowerCase();
  const act = {
    " ": confirmDone,
    enter: confirmDone,
    t: giveHint,
    w: () => $("btnWhy").click(),
    n: () => $("btnRepeat").click(),
    z: undo,
    backspace: undo,
    arrowleft: () => $("btnPrev").click(),
    arrowright: () => $("btnNext").click(),
    home: () => viewPly(0),
    end: goLive,
    escape: goLive,
    m: () => $("btnMic").click(),
  }[k];
  if (act) {
    e.preventDefault();
    act();
  }
});

const camView = $("camView");
camView.addEventListener("dragover", (e) => {
  if (![...(e.dataTransfer?.items || [])].some((i) => i.type.startsWith("image/"))) return;
  e.preventDefault();
  camView.classList.add("drop");
});
camView.addEventListener("dragleave", () => camView.classList.remove("drop"));
camView.addEventListener("drop", async (e) => {
  e.preventDefault();
  camView.classList.remove("drop");
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
  if (!file) return;
  if (!S.awaiting) return toast("Gerade wird kein Zug erwartet.");
  const img = await toJpeg(file);
  showPhoto(img);
  runDetection(null, img, true);
});

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
for (const m of MODELS) {
  const o = document.createElement("option");
  o.value = m.id;
  o.textContent = m.label;
  $("setModel").appendChild(o);
}

function openSettings() {
  $("setKey").value = settings.apiKey;
  $("setModel").value = settings.model;
  $("setPerspective").value = settings.perspective;
  $("setAutoDetect").checked = settings.autoDetect;
  $("setVoice").checked = settings.voice;
  $("setRate").value = settings.rate;
  $("setNotes").checked = settings.notes;
  $("setExplainMistakes").checked = settings.explainMistakes;
  $("setShowFuture").checked = settings.showFuture;
  $("testResult").textContent = "";
  $("accountInfo").hidden = !coach.viaAccount;
  $("keySection").hidden = coach.viaAccount;
  if (!$("dlgSettings").open) $("dlgSettings").showModal();
}

function readSettingsForm() {
  settings.apiKey = $("setKey").value.trim();
  settings.model = $("setModel").value;
  settings.perspective = $("setPerspective").value;
  settings.autoDetect = $("setAutoDetect").checked;
  settings.voice = $("setVoice").checked;
  settings.rate = Number($("setRate").value);
  settings.notes = $("setNotes").checked;
  settings.explainMistakes = $("setExplainMistakes").checked;
  settings.showFuture = $("setShowFuture").checked;
  if (S.opening) renderMoves();
  coach.configure({ apiKey: settings.apiKey, model: settings.model });
  speaker.enabled = settings.voice;
  speaker.rate = settings.rate;
  $("btnVoice").textContent = settings.voice ? "🔊" : "🔇";
  camera.armed = settings.autoDetect && S.awaiting && camera.running;
}

$("btnSettings").addEventListener("click", openSettings);
$("btnSetupOpen").addEventListener("click", openSettings);
$("btnShowKey").addEventListener("click", () => {
  $("setKey").type = $("setKey").type === "password" ? "text" : "password";
});
$("btnTestKey").addEventListener("click", async () => {
  readSettingsForm();
  $("testResult").textContent = "teste …";
  try {
    await coach.ping();
    $("testResult").textContent = "✅ Verbindung klappt!";
  } catch (e) {
    $("testResult").textContent = "❌ " + e.message;
  }
});
$("dlgSettings").addEventListener("close", () => {
  if ($("dlgSettings").returnValue === "save") {
    readSettingsForm();
    store.set("schach.settings", settings);
    renderMenu();
    toast("Gespeichert.");
  }
});

// ---------------------------------------------------------------------------
renderMenu();
showScreen("menu");
initClaudeAccount();

/** Läuft die App als Artifact auf claude.ai, nutzt sie das Claude-Konto (Abo) des Nutzers. */
async function initClaudeAccount() {
  if (!window.claude?.use) return;
  S.photoMode = true; // Live-Kamera und Dauer-Mikrofon sind auf claude.ai nicht erlaubt
  $("camOff").querySelector("p").textContent = "📸 Mach pro Zug ein Foto vom Brett";
  $("btnCam").textContent = "Foto aufnehmen";
  $("btnCamToggle").textContent = "📸 Foto";
  $("btnCamSwitch").hidden = true;
  camStatus("Foto-Modus", "ok");
  const [ok, tts, dict] = await Promise.all([
    coach.initAccount(),
    window.claude.use("tts").catch(() => null),
    window.claude.use("dictation").catch(() => null),
  ]);
  if (tts) speaker.useClaudeVoice(tts);
  if (dict) listener.useClaudeDictation(dict);
  listener.onState(listener.state);
  if (ok) {
    $("topSub").textContent = "läuft über dein Claude-Konto";
    renderMenu();
  }
}
if (!window.isSecureContext) {
  toast("Hinweis: Kamera und Mikrofon funktionieren nur über https:// oder localhost.");
}
