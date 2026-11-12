// Digitales Brett: SVG-Figuren, Ziehen per Finger/Maus/Stift (Drag & Drop) oder Antippen,
// animierte Züge, Pfeile für Ansagen/Vorschläge und Auswahl bei Bauernumwandlung.

const FILES = "abcdefgh";

// Eigene Figurengrafiken (viewBox 0 0 100 100). Jede Figur besteht aus Körperflächen
// (Füllung je nach Farbe) und Detail-Linien.
const SHAPES = {
  p: `<circle cx="50" cy="29" r="13"/>
      <path d="M39 45 Q50 39 61 45 L66 71 L34 71 Z"/>
      <path d="M25 88 Q25 75 37 73 L63 73 Q75 75 75 88 Z"/>`,
  r: `<path d="M27 16 h11 v8 h7 v-8 h10 v8 h7 v-8 h11 v20 l-7 6 v25 l7 6 v9 H27 v-9 l7-6 V42 l-7-6 Z"/>
      <path d="M21 82 h58 v8 H21 Z"/>`,
  n: `<path d="M30 84 C29 70 35 60 45 52 C38 55 29 59 23 55 C18 49 23 42 31 37 C37 29 43 21 47 12 L54 21 C68 23 79 37 79 57 C79 70 76 79 74 84 Z"/>
      <path d="M21 92 Q21 84 30 82 H73 Q81 84 81 92 Z"/>`,
  b: `<circle cx="50" cy="13" r="6"/>
      <path d="M50 20 C35 31 31 46 38 59 L62 59 C69 46 65 31 50 20 Z"/>
      <path d="M36 61 H64 L67 70 H33 Z"/>
      <path d="M23 89 Q23 76 40 72 L60 72 Q77 76 77 89 Z"/>`,
  q: `<circle cx="15" cy="27" r="5.5"/><circle cx="32" cy="17" r="5.5"/><circle cx="50" cy="12" r="5.5"/>
      <circle cx="68" cy="17" r="5.5"/><circle cx="85" cy="27" r="5.5"/>
      <path d="M17 31 L30 64 H70 L83 31 L67 50 L64 22 L54 47 L50 18 L46 47 L36 22 L33 50 Z"/>
      <path d="M30 66 H70 L66 76 H34 Z"/>
      <path d="M23 90 Q23 80 35 78 H65 Q77 80 77 90 Z"/>`,
  k: `<path d="M46 4 h8 v8 h8 v8 h-8 v9 h-8 v-9 h-8 v-8 h8 Z"/>
      <path d="M50 31 C28 29 15 46 30 65 H70 C85 46 72 29 50 31 Z"/>
      <path d="M30 67 H70 L66 77 H34 Z"/>
      <path d="M23 91 Q23 81 35 79 H65 Q77 81 77 91 Z"/>`,
};
// Kleine Details, die die Figuren lesbarer machen
const DETAILS = {
  p: "",
  r: `<path d="M34 42 H66 M34 67 H66" />`,
  n: `<circle cx="48" cy="31" r="3.2" class="eye"/><path d="M58 24 C66 30 71 40 71 52" /><path d="M31 43 L36 45" />`,
  b: `<path d="M54 32 L45 45" /><path d="M38 59 H62" />`,
  q: `<path d="M30 64 H70" />`,
  k: `<path d="M50 31 V64" /><path d="M30 65 H70" />`,
};

export function pieceSvg(type, color) {
  return `<svg viewBox="0 0 100 100" class="piece-svg ${color === "w" ? "pw" : "pb"}" aria-hidden="true">
    <g class="body">${SHAPES[type]}</g><g class="detail">${DETAILS[type]}</g></svg>`;
}

const NAMES = { k: "König", q: "Dame", r: "Turm", b: "Läufer", n: "Springer", p: "Bauer" };

export class BoardView {
  constructor(el) {
    this.el = el;
    this.orientation = "w";
    this.selected = null;
    this.onMove = () => {}; // ({from, to, promotion}) => void
    this.game = null;
    this.interactive = true;
    this.highlights = { last: null, hint: null };
    this.arrows = []; // [{from, to, kind}] kind: you | opp | claude | info
    this.pieceEls = []; // {el, type, color, square}
    this.drag = null;

    el.classList.add("board");
    el.innerHTML = `
      <div class="b-squares"></div>
      <div class="b-pieces"></div>
      <svg class="b-arrows" viewBox="0 0 800 800" aria-hidden="true">
        <defs>
          ${["you", "opp", "claude", "info"].map((k) => `<marker id="ah-${k}" class="ah ${k}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z"/></marker>`).join("")}
        </defs>
        <g class="arrows"></g>
      </svg>
      <div class="b-promo" hidden></div>`;
    this.sqLayer = el.querySelector(".b-squares");
    this.pcLayer = el.querySelector(".b-pieces");
    this.arrowLayer = el.querySelector(".b-arrows .arrows");
    this.promoEl = el.querySelector(".b-promo");
    this._buildSquares();

    el.addEventListener("pointerdown", (e) => this._down(e));
    window.addEventListener("pointermove", (e) => this._moveDrag(e), { passive: false });
    window.addEventListener("pointerup", (e) => this._up(e));
    window.addEventListener("pointercancel", () => this._cancelDrag());
  }

  // ------------------------------------------------------------------ Darstellung
  _buildSquares() {
    let html = "";
    for (let i = 0; i < 64; i++) html += `<div class="sq"></div>`;
    this.sqLayer.innerHTML = html;
    this.squareEls = [...this.sqLayer.children];
  }

  /** Bildschirmposition (Spalte/Zeile 0..7) eines Feldes je nach Blickrichtung. */
  _pos(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]) - 1;
    return this.orientation === "w" ? { col: f, row: 7 - r } : { col: 7 - f, row: r };
  }

  _sqAt(col, row) {
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    const f = this.orientation === "w" ? col : 7 - col;
    const r = this.orientation === "w" ? 7 - row : row;
    return FILES[f] + (r + 1);
  }

  setOrientation(c) {
    this.orientation = c;
    this.render(this.game, { animate: false });
  }

  setHighlights(h) {
    this.highlights = { ...this.highlights, ...h };
    this._paintSquares();
    this._paintArrows();
  }

  /** Pfeile setzen: [{from, to, kind}] */
  setArrows(arrows) {
    this.arrows = arrows || [];
    this._paintArrows();
  }

  render(game = this.game, { animate = true } = {}) {
    this.game = game;
    if (!game) return;
    this._paintSquares();
    this._paintPieces(animate);
    this._paintArrows();
  }

  _paintSquares() {
    const game = this.game;
    const targets = new Map();
    if (this.selected && game) for (const m of game.moves({ square: this.selected, verbose: true })) targets.set(m.to, !!m.captured || m.flags.includes("e"));
    const { last, hint } = this.highlights;
    const inCheck = game?.inCheck() ? this._kingSquare(game.turn()) : null;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = this._sqAt(col, row);
        const el = this.squareEls[row * 8 + col];
        const fileIdx = FILES.indexOf(sq[0]);
        const dark = (fileIdx + Number(sq[1])) % 2 === 1; // a1 ist dunkel
        let cls = "sq " + (dark ? "dark" : "light");
        if (last && (last.from === sq || last.to === sq)) cls += " last";
        if (hint && hint.from === sq) cls += " hint-from";
        if (hint && hint.to === sq) cls += " hint-to";
        if (this.selected === sq) cls += " sel";
        if (targets.has(sq)) cls += targets.get(sq) ? " target cap" : " target";
        if (inCheck === sq) cls += " check";
        // Felder mit ziehbaren Figuren: kein Scrollen beim Ziehen per Finger
        const pc = game?.get(sq);
        if (this.interactive && pc && pc.color === game.turn()) cls += " movable";
        if (this.drag?.over === sq) cls += " over";
        el.className = cls;
        el.dataset.sq = sq;
        let label = "";
        if (col === 0) label += `<span class="rank">${sq[1]}</span>`;
        if (row === 7) label += `<span class="file">${sq[0]}</span>`;
        if (el._label !== label) {
          el.innerHTML = label;
          el._label = label;
        }
      }
    }
  }

  _kingSquare(color) {
    const b = this.game.board();
    for (const row of b) for (const p of row) if (p && p.type === "k" && p.color === color) return p.square;
    return null;
  }

  _place(el, sq) {
    const { col, row } = this._pos(sq);
    el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  }

  /** Figuren zeichnen – bestehende Figuren gleiten an ihren neuen Platz. */
  _paintPieces(animate) {
    const now = [];
    for (const row of this.game.board()) for (const p of row) if (p) now.push(p);
    const old = this.pieceEls;
    const used = new Set();
    const next = [];
    const takeOld = (pred) => {
      let best = null, bestD = 1e9;
      for (const o of old) {
        if (used.has(o) || !pred(o)) continue;
        const d = Math.abs(FILES.indexOf(o.square[0]) - FILES.indexOf(this._tmp.square[0])) + Math.abs(o.square[1] - this._tmp.square[1]);
        if (d < bestD) { best = o; bestD = d; }
      }
      return best;
    };
    // 1. Figuren, die stehen geblieben sind
    const pending = [];
    for (const p of now) {
      const same = old.find((o) => !used.has(o) && o.square === p.square && o.type === p.type && o.color === p.color);
      if (same) { used.add(same); next.push(same); } else pending.push(p);
    }
    // 2. Figuren, die gezogen haben (nächste gleiche Figur), sonst neue Figur
    for (const p of pending) {
      this._tmp = p;
      let o = takeOld((x) => x.type === p.type && x.color === p.color);
      // Umwandlung: Bauer wird zur neuen Figur
      if (!o) o = takeOld((x) => x.type === "p" && x.color === p.color && (p.square[1] === "8" || p.square[1] === "1"));
      if (o) {
        used.add(o);
        if (o.type !== p.type) {
          o.el.innerHTML = pieceSvg(p.type, p.color);
          o.type = p.type;
        }
        o.square = p.square;
        next.push(o);
      } else {
        const el = document.createElement("div");
        el.className = "pc";
        el.innerHTML = pieceSvg(p.type, p.color);
        if (animate) el.classList.add("appear");
        this.pcLayer.appendChild(el);
        next.push({ el, type: p.type, color: p.color, square: p.square });
      }
    }
    // 3. Geschlagene Figuren ausblenden
    for (const o of old) {
      if (used.has(o)) continue;
      o.el.classList.add("gone");
      setTimeout(() => o.el.remove(), 260);
    }
    this.pcLayer.classList.toggle("no-anim", !animate);
    for (const o of next) {
      this._place(o.el, o.square);
      o.el.dataset.sq = o.square;
      o.el.setAttribute("aria-label", `${o.color === "w" ? "weißer" : "schwarzer"} ${NAMES[o.type]} auf ${o.square}`);
      o.el.classList.toggle("movable", this.interactive && this.game.turn() === o.color);
    }
    if (!animate) requestAnimationFrame(() => this.pcLayer.classList.remove("no-anim"));
    this.pieceEls = next;
  }

  _paintArrows() {
    const list = [...this.arrows];
    const { hint } = this.highlights;
    if (hint?.from && hint?.to && !list.some((a) => a.from === hint.from && a.to === hint.to)) list.push({ ...hint, kind: hint.kind || "you" });
    const center = (sq) => {
      const { col, row } = this._pos(sq);
      return [col * 100 + 50, row * 100 + 50];
    };
    let svg = "";
    for (const a of list) {
      if (!a.from || !a.to) continue;
      const [x1, y1] = center(a.from);
      let [x2, y2] = center(a.to);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      // Pfeilspitze etwas vor dem Feldmittelpunkt enden lassen
      x2 -= (dx / len) * 22;
      y2 -= (dy / len) * 22;
      const sx = x1 + (dx / len) * 18, sy = y1 + (dy / len) * 18;
      // Springerzüge als Winkel zeichnen
      const isKnight = (Math.abs(dx) === 100 && Math.abs(dy) === 200) || (Math.abs(dx) === 200 && Math.abs(dy) === 100);
      const kind = a.kind || "you";
      if (isKnight) {
        const [ex, ey] = center(a.to);
        const mx = Math.abs(dx) > Math.abs(dy) ? ex : x1;
        const my = Math.abs(dx) > Math.abs(dy) ? y1 : ey;
        const ux = Math.sign(ex - mx), uy = Math.sign(ey - my);
        svg += `<path class="arrow ${kind}" d="M${x1 + Math.sign(mx - x1) * 18} ${y1 + Math.sign(my - y1) * 18} L${mx} ${my} L${ex - ux * 22} ${ey - uy * 22}" marker-end="url(#ah-${kind})"/>`;
      } else {
        svg += `<line class="arrow ${kind}" x1="${sx}" y1="${sy}" x2="${x2}" y2="${y2}" marker-end="url(#ah-${kind})"/>`;
      }
    }
    this.arrowLayer.innerHTML = svg;
  }

  // ------------------------------------------------------------------ Eingabe
  _squareFromPoint(x, y) {
    const r = this.el.getBoundingClientRect();
    const col = Math.floor(((x - r.left) / r.width) * 8);
    const row = Math.floor(((y - r.top) / r.height) * 8);
    return this._sqAt(col, row);
  }

  _canMove(sq) {
    const p = this.game?.get(sq);
    return this.interactive && p && p.color === this.game.turn();
  }

  _down(e) {
    if (!this.game || e.button > 0) return;
    if (!this.promoEl.hidden) return;
    const sq = this._squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    // Zielfeld einer ausgewählten Figur antippen
    if (this.selected && sq !== this.selected && this._legal(this.selected, sq).length) {
      e.preventDefault();
      return this._tryMove(this.selected, sq);
    }
    if (!this._canMove(sq)) {
      this.selected = null;
      this._paintSquares();
      return;
    }
    e.preventDefault();
    const pe = this.pieceEls.find((o) => o.square === sq);
    if (!pe) return;
    const wasSelected = this.selected === sq;
    this.selected = sq;
    const r = this.el.getBoundingClientRect();
    this.drag = { sq, pe, startX: e.clientX, startY: e.clientY, moved: false, wasSelected, size: r.width / 8, rect: r, over: null, id: e.pointerId };
    this._paintSquares();
  }

  _moveDrag(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (!d.moved && dist < 6) return;
    e.preventDefault();
    if (!d.moved) {
      d.moved = true;
      d.pe.el.classList.add("dragging");
    }
    const x = e.clientX - d.rect.left - d.size / 2;
    const y = e.clientY - d.rect.top - d.size / 2;
    // Beim Ziehen per Finger die Figur etwas über den Finger heben
    const lift = e.pointerType === "touch" ? d.size * 0.35 : 0;
    d.pe.el.style.transform = `translate(${x}px, ${y - lift}px) scale(1.15)`;
    const over = this._squareFromPoint(e.clientX, e.clientY - lift);
    if (over !== d.over) {
      d.over = over;
      this._paintSquares();
    }
  }

  _up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    d.pe.el.classList.remove("dragging");
    if (d.moved) {
      const target = d.over;
      if (target && target !== d.sq && this._legal(d.sq, target).length) {
        this._place(d.pe.el, target); // sofort am Ziel ablegen, kein Zurückgleiten
        d.pe.el.classList.add("dropped");
        setTimeout(() => d.pe.el.classList.remove("dropped"), 50);
        this._tryMove(d.sq, target, true);
        return;
      }
      this._place(d.pe.el, d.sq);
      this._paintSquares();
      return;
    }
    // Nur angetippt: zweites Antippen hebt die Auswahl auf
    if (d.wasSelected) this.selected = null;
    this._paintSquares();
  }

  _cancelDrag() {
    if (!this.drag) return;
    this._place(this.drag.pe.el, this.drag.sq);
    this.drag.pe.el.classList.remove("dragging");
    this.drag = null;
    this._paintSquares();
  }

  _legal(from, to) {
    return this.game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  }

  _tryMove(from, to) {
    const legal = this._legal(from, to);
    this.selected = null;
    if (legal.some((m) => m.promotion)) {
      this._askPromotion(from, to);
      return;
    }
    this._paintSquares();
    this.onMove({ from, to });
  }

  _askPromotion(from, to) {
    const color = this.game.turn();
    const { col, row } = this._pos(to);
    this.promoEl.innerHTML = ["q", "r", "b", "n"]
      .map((t) => `<button type="button" data-t="${t}" aria-label="${NAMES[t]}">${pieceSvg(t, color)}</button>`)
      .join("") + `<button type="button" data-t="" class="cancel" aria-label="Abbrechen">✕</button>`;
    this.promoEl.style.left = `${col * 12.5}%`;
    this.promoEl.classList.toggle("up", row > 3);
    this.promoEl.hidden = false;
    const done = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      this.promoEl.hidden = true;
      this.promoEl.removeEventListener("click", done);
      this.render(this.game, { animate: true });
      if (b.dataset.t) this.onMove({ from, to, promotion: b.dataset.t });
    };
    this.promoEl.addEventListener("click", done);
  }
}
