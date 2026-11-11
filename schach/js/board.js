// Digitales Brett: zeigt die Stellung, markiert Züge und erlaubt Züge per Antippen.

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";

export class BoardView {
  constructor(el) {
    this.el = el;
    this.orientation = "w";
    this.selected = null;
    this.onMove = () => {}; // ({from, to}) => void
    this.game = null;
    this.highlights = { last: null, hint: null };
    el.addEventListener("click", (e) => {
      const sq = e.target.closest("[data-sq]")?.dataset.sq;
      if (sq) this._click(sq);
    });
  }

  setOrientation(c) {
    this.orientation = c;
    this.render();
  }

  render(game = this.game) {
    this.game = game;
    if (!game) return;
    const board = game.board(); // [rank8..rank1][a..h]
    const rows = this.orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    const cols = this.orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    const targets = new Set(this.selected ? game.moves({ square: this.selected, verbose: true }).map((m) => m.to) : []);
    const { last, hint } = this.highlights;
    let html = "";
    for (const r of rows) {
      for (const c of cols) {
        const sq = FILES[c] + (8 - r);
        const piece = board[r][c];
        const dark = (r + c) % 2 === 1;
        const cls = [
          "sq",
          dark ? "dark" : "light",
          last && (last.from === sq || last.to === sq) ? "last" : "",
          hint && (hint.from === sq || hint.to === sq) ? "hint" : "",
          hint && hint.to === sq ? "hint-to" : "",
          this.selected === sq ? "sel" : "",
          targets.has(sq) ? (piece ? "target cap" : "target") : "",
        ].join(" ");
        const label =
          (c === cols[0] ? `<span class="rank">${8 - r}</span>` : "") +
          (r === rows[7] ? `<span class="file">${FILES[c]}</span>` : "");
        const p = piece ? `<span class="pc ${piece.color}">${GLYPH[piece.type]}</span>` : "";
        html += `<div class="${cls}" data-sq="${sq}">${label}${p}</div>`;
      }
    }
    this.el.innerHTML = html;
  }

  setHighlights(h) {
    this.highlights = { ...this.highlights, ...h };
    this.render();
  }

  _click(sq) {
    const game = this.game;
    if (!game) return;
    const piece = game.get(sq);
    if (this.selected) {
      if (sq === this.selected) {
        this.selected = null;
      } else if (game.moves({ square: this.selected, verbose: true }).some((m) => m.to === sq)) {
        const from = this.selected;
        this.selected = null;
        this.render();
        this.onMove({ from, to: sq });
        return;
      } else if (piece && piece.color === game.turn()) {
        this.selected = sq;
      } else {
        this.selected = null;
      }
    } else if (piece && piece.color === game.turn()) {
      this.selected = sq;
    }
    this.render();
  }
}
