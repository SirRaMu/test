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
  { apiKey: "", model: MODELS[0].id, voice: true, rate: 1.05, perspective: "von der Seite von Weiß (Weiß unten im Bild)", autoDetect: true, notes: true },
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
  $("setupHint").hidden = !!settings.apiKey;
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
  $("topSub").textContent = name === "train" ? "Training läuft" : "mit Claude, Kamera & Sprache";
  window.scrollTo(0, 0);
}

function startTraining(op, { lineIdx, mode, opp }) {
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
  S.pendingConfirm = null;
  $("finishBox").hidden = true;
  board.setHighlights({ last: null, hint: null });
  board.render(S.game);
  updateHead();
}

function updateHead() {
  $("trOpening").textContent = S.opening.name;
  $("trLine").textContent = S.outOfBook ? `${line().name} → freies Spiel` : line().name;
  const total = line().moves.length;
  $("trProgress").style.width = `${Math.min(100, (ply() / total) * 100)}%`;
  $("trScore").textContent = `Zug ${Math.floor(ply() / 2) + 1} · Fehler: ${S.mistakes}`;
}

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
      board.setHighlights({ hint: moveSquares(exp.san) });
      say(`Dein Zug: ${mvHtml(exp.san)}`, exp.note, { extraSpeech: prefix });
    } else {
      board.setHighlights({ hint: null });
      say("Du bist dran – welcher Zug?", "Tipp: Sag „Tipp“, wenn du nicht weiterweißt.", { speakNote: false, extraSpeech: prefix });
    }
  } else if (S.opp === "app") {
    board.setHighlights({ hint: moveSquares(exp.san) });
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
  if (isUserTurn()) {
    board.setHighlights({ hint: null });
    if (!coach.ready) {
      say("Freies Spiel – du bist dran", "Für Zugvorschläge außerhalb der Theorie trag einen Claude-API-Schlüssel ein.", { extraSpeech: prefix });
      return;
    }
    say("Freies Spiel – ich überlege …", "", { extraSpeech: prefix, speakNote: false });
    const fenAtAsk = S.game.fen();
    try {
      const adv = await coach.adviseOutOfBook({ game: S.game, ctx: contextText(), userSide: userSide() });
      if (S.game.fen() !== fenAtAsk) return; // inzwischen weitergespielt
      S.advice = adv.move;
      if (adv.move) board.setHighlights({ hint: { from: adv.move.from, to: adv.move.to } });
      say(adv.move ? `Vorschlag: ${mvHtml(adv.move.san)}` : "Du bist dran", adv.comment);
      coachMsg(adv.comment + (adv.move ? `\n➜ Vorschlag: ${sanToGerman(adv.move.san)}` : ""));
    } catch (e) {
      showError(e);
      say("Freies Spiel – du bist dran", "");
    }
  } else {
    board.setHighlights({ hint: null });
    say(`${colorName(S.game.turn())} ist am Zug`, "Spiel den Zug des Gegners auf dem Brett und bestätige ihn per Kamera, Antippen oder Sprache.", { extraSpeech: prefix });
  }
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
  if (!S.awaiting || S.finished) {
    if (source !== "camera") toast("Gerade wird kein Zug erwartet.");
    return;
  }
  const san = move.san;
  if (source !== "camera") camera.resetBaseline();

  if (S.outOfBook) {
    S.game.move(san);
    board.setHighlights({ last: { from: move.from, to: move.to }, hint: null });
    sys(`${colorName(move.color)}: ${sanToGerman(san)}`);
    const good = S.advice && S.advice.san === san && move.color === userSide();
    S.advice = null;
    return step(good ? "Gut gespielt." : "");
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
    board.setHighlights({ hint: moveSquares(exp.san) });
    const takeBack = source === "board" || source === "text" ? "" : " Bitte nimm den Zug auf dem Brett zurück.";
    say(
      `Nicht ganz: ${mvHtml(san)} ✗ – richtig ist ${mvHtml(exp.san)}`,
      exp.note,
      { bad: true, tail: takeBack },
    );
    if (takeBack) setTimeout(() => toast("Zug auf dem Brett zurücknehmen und dann richtig ziehen."), 200);
    sys(`Falsch: ${sanToGerman(san)} (erwartet ${sanToGerman(exp.san)})`);
    camera.resetBaseline();
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

function leaveBook(move) {
  S.game.move(move.san);
  S.outOfBook = true;
  board.setHighlights({ last: { from: move.from, to: move.to }, hint: null });
  sys(`${colorName(move.color)}: ${sanToGerman(move.san)} – außerhalb der Theorie`);
  step(`Der Gegner hat mit ${sanToSpeech(move.san)} die Theorie verlassen. Ab jetzt spielen wir frei.`);
}

function addConfirmButton(move) {
  const b = document.createElement("button");
  b.className = "btn small";
  b.textContent = `Doch ${sanToGerman(move.san)} übernehmen`;
  b.addEventListener("click", () => {
    b.remove();
    if (S.pendingConfirm === move) leaveBook(move);
  });
  const wrap = document.createElement("div");
  wrap.className = "msg sys";
  wrap.appendChild(b);
  $("chatLog").appendChild(wrap);
  $("chatLog").scrollTop = 1e9;
}

/** "Zug ausgeführt" – der erwartete Zug wurde auf dem Brett gemacht. */
function confirmDone() {
  if (!S.awaiting) return;
  if (S.outOfBook) {
    if (isUserTurn() && S.advice) return handleMove(S.advice, "button");
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
  board.setHighlights({ hint: moveSquares(exp.san) });
  say(`Lösung: ${mvHtml(exp.san)}`, exp.note);
}

function undo() {
  if (S.game.history().length === 0) return;
  // Bis zum letzten eigenen Zug zurück (damit der Nutzer wieder am Zug ist)
  S.game.undo();
  if (!isUserTurn() && S.game.history().length) S.game.undo();
  S.finished = false;
  $("finishBox").hidden = true;
  if (S.outOfBook) {
    const hist = S.game.history();
    S.outOfBook = !S.opening.lines.some((l) => hist.every((h, i) => l.moves[i]?.san === h));
    if (!S.outOfBook) S.lineIdx = S.opening.lines.findIndex((l) => hist.every((h, i) => l.moves[i]?.san === h));
  }
  board.setHighlights({ last: null });
  camera.resetBaseline();
  sys("Zug zurückgenommen – bitte auch auf dem Brett zurückstellen.");
  step("Zurückgenommen.");
}

board.onMove = ({ from, to }) => {
  const legal = S.game.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
  if (!legal.length) return;
  const m = legal.find((x) => !x.promotion || x.promotion === "q") || legal[0];
  handleMove(m, "board");
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
$("btnCamToggle").addEventListener("click", () => (camera.running ? stopCamera() : startCamera()));
$("btnCamSwitch").addEventListener("click", () => camera.switchCamera().catch((e) => toast(e.message)));
$("btnDetect").addEventListener("click", async () => {
  if (!camera.running) return toast("Erst die Kamera starten.");
  const after = await camera.capture();
  runDetection(camera.baseline, after, true);
});

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
  if (!coach.ready) {
    if (manual) toast("Für die Kamera-Erkennung bitte einen Claude-API-Schlüssel eintragen (⚙️).");
    camera.baseline = after;
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
    camStatus(camera.running ? "bereit" : "aus", camera.running ? "ok" : "");
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
speaker.onStart = () => listener.pause();
speaker.onEnd = () => setTimeout(() => listener.resume(), 300);

listener.onState = (st) => {
  const btn = $("btnMic");
  btn.classList.toggle("on", st === "listening" || st === "starting");
  btn.classList.toggle("paused", st === "paused");
  $("micState").textContent = {
    unsupported: "Spracheingabe wird von diesem Browser nicht unterstützt (Chrome oder Safari nutzen)",
    off: "Mikrofon aus – tippe zum Sprechen",
    paused: "Trainer spricht …",
    listening: "Ich höre zu …",
    starting: "Ich höre zu …",
    denied: "Mikrofon-Zugriff verweigert – in den Browser-Einstellungen erlauben",
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
  if (listener.active) listener.stop();
  else {
    speaker.stop();
    listener.start();
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
    S.outOfBook ? "Die Partie hat das Eröffnungsbuch verlassen." : exp ? `Nächster Buchzug: ${exp.san}${exp.note ? ` – ${exp.note}` : ""}` : "Die Variante ist zu Ende gespielt.",
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
$("btnRepeat").addEventListener("click", () => speaker.speak(S.lastSpoken));
$("btnUndo").addEventListener("click", undo);
$("btnWhy").addEventListener("click", () => {
  const exp = expected();
  const last = S.game.history().slice(-1)[0];
  const q = exp
    ? `Erkläre mir ausführlicher, warum in dieser Stellung ${exp.san} gespielt wird und welche Pläne beide Seiten jetzt haben.`
    : `Erkläre mir die Ideen hinter dem letzten Zug ${last || ""} und wie es in dieser Stellung typischerweise weitergeht.`;
  askCoach(S.mode === "quiz" && exp && isUserTurn() ? "Erkläre mir die aktuelle Stellung und worauf ich achten sollte, ohne den nächsten Zug zu verraten." : q);
});
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
  $("testResult").textContent = "";
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
if (!window.isSecureContext) {
  toast("Hinweis: Kamera und Mikrofon funktionieren nur über https:// oder localhost.");
}
