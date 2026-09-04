/* ===================== Mein Finanzplaner ===================== */
"use strict";

const STORAGE_KEY = "finanzplaner_v1";
const VERSION_KEY = "finanzplaner_last_seen_version";

const APP_VERSION = "1.5.0";
const CHANGELOG = [
  {
    version: "1.5.0",
    date: "2026-09-04",
    changes: [
      "Die App prüft jetzt regelmäßig im Hintergrund (alle 5 Minuten, solange die Seite offen ist), ob eine neue Version veröffentlicht wurde, und zeigt dann unten einen Hinweis mit \"Aktualisieren\" oder \"Später\".",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-04",
    changes: [
      "Keine Beispiel-Buchungen mehr beim ersten Start: die App startet leer und führt dich direkt zum einmaligen Eintragen deines echten Kontostands.",
      "\"Kontostand abgleichen\" ist jetzt unter ⚙️ Einstellungen zu finden – für die Ersteinrichtung und für den Fall, dass du mal vergessen hast, etwas einzutragen. Im Alltag reichen normale Einnahmen/Ausgaben unter \"Transaktionen\".",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-09-04",
    changes: [
      "Spar-Start läuft jetzt automatisch ab der ersten Einzahlung auf ein Konto (statt eines festen Datums) – lässt sich bei Bedarf im Konten-Tab weiter manuell überschreiben.",
      "Mobile Ansicht überarbeitet: Diagramm und Tabellen passen sich jetzt der Bildschirmbreite an (kein Verrutschen mehr auf Handy/iPad).",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-09-04",
    changes: [
      "Versionsverlauf: Die App merkt sich, welche Version du zuletzt gesehen hast, und zeigt beim Öffnen an, was sich geändert hat.",
      "Sparziele haben jetzt einen \"Spar-Start\" (Standard: 1. September). Die App vergleicht den Soll-Stand (verstrichene Zeit) mit dem Ist-Stand (Kontostand) statt nur grob zu schätzen.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-09-04",
    changes: [
      "Neu: \"Kontostand abgleichen\" – trag den Kontostand aus deiner Banking-App ein, die Differenz zum bisher erfassten Stand wird automatisch verteilt bzw. abgezogen.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-03",
    changes: [
      "Erste Version: Konten mit Sparzielen, Geld verteilen nach Prozentsätzen, Transaktionen, Kontostand-Verlauf, Backup/Import.",
    ],
  },
];

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

const fmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const fmtDate = (iso) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- State ---------- */
let state = loadState();

function seedState() {
  const t = todayISO();
  const nextSept = nextOccurrence("09-01");
  const urlaubDate = shiftDays(t, 270);
  return {
    accounts: [
      { id: "girokonto", name: "Girokonto (frei verfügbar)", emoji: "💳", color: "#64748b", isDefault: true, distributionPercent: 10, goal: null },
      { id: "sparkonto", name: "Sparkonto", emoji: "🐷", color: "#16a34a", isDefault: false, distributionPercent: 50, goal: null },
      { id: "auto-versicherung", name: "Auto: Versicherung & Steuer", emoji: "🚗", color: "#dc2626", isDefault: false, distributionPercent: 15, goal: { amount: 1350, date: nextSept, recurrence: "yearly", startDate: null } },
      { id: "auto-reparatur", name: "Auto: Reifen, Ölwechsel & Reparaturen", emoji: "🔧", color: "#ea580c", isDefault: false, distributionPercent: 10, goal: { amount: 400, date: null, recurrence: "none", startDate: null } },
      { id: "urlaub", name: "Urlaub", emoji: "✈️", color: "#0284c7", isDefault: false, distributionPercent: 10, goal: { amount: 600, date: urlaubDate, recurrence: "once", startDate: null } },
      { id: "party", name: "Party & Spaß", emoji: "🎉", color: "#9333ea", isDefault: false, distributionPercent: 5, goal: { amount: 150, date: null, recurrence: "none", startDate: null } },
    ],
    // Bewusst leer: der Nutzer trägt seinen echten Kontostand einmalig über
    // "Einstellungen → Kontostand abgleichen" ein, statt mit Beispiel-Buchungen zu starten.
    transactions: [],
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("Konnte gespeicherte Daten nicht lesen, starte neu.", e);
    }
  }
  const fresh = seedState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- Date helpers ---------- */
function shiftDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function addYears(iso, years) {
  const d = new Date(iso + "T00:00:00");
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}
function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00");
  const b = new Date(toISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
// next occurrence of a "MM-DD" from today (this year if still ahead, else next year)
function nextOccurrence(mmdd) {
  const t = todayISO();
  const year = t.slice(0, 4);
  let candidate = `${year}-${mmdd}`;
  if (candidate <= t) candidate = `${parseInt(year, 10) + 1}-${mmdd}`;
  return candidate;
}

/* ---------- Derived data ---------- */
function getBalance(accountId) {
  return state.transactions
    .filter((tx) => tx.accountId === accountId)
    .reduce((sum, tx) => sum + tx.amount, 0);
}
function getTotalBalance() {
  return state.accounts.reduce((sum, a) => sum + getBalance(a.id), 0);
}
function getDefaultAccount() {
  return state.accounts.find((a) => a.isDefault) || state.accounts[0];
}
function avgMonthlyContribution(accountId, days = 90) {
  const cutoff = shiftDays(todayISO(), -days);
  const sum = state.transactions
    .filter((tx) => tx.accountId === accountId && tx.date >= cutoff && tx.amount > 0)
    .reduce((s, tx) => s + tx.amount, 0);
  return sum / (days / 30.44);
}

// Datum der letzten "Fixkosten bezahlt"-Buchung eines Kontos (Ende des vorherigen Sparzyklus).
function lastPaymentDate(accountId) {
  const dates = state.transactions
    .filter((tx) => tx.accountId === accountId && tx.category === "Fixkosten bezahlt")
    .map((tx) => tx.date)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

// Datum der ersten Einzahlung auf ein Konto (optional erst nach einem bestimmten Datum,
// z.B. nach der letzten Zahlung eines wiederkehrenden Ziels).
function firstContributionDate(accountId, afterDate) {
  const dates = state.transactions
    .filter((tx) => tx.accountId === accountId && tx.amount > 0 && (!afterDate || tx.date > afterDate))
    .map((tx) => tx.date)
    .sort();
  return dates.length ? dates[0] : null;
}

// Der tatsächliche Spar-Start für ein Ziel: eine manuell gesetzte Überschreibung hat
// Vorrang, sonst gilt automatisch das Datum der ersten Einzahlung (nach einer eventuellen
// letzten Zahlung, bei wiederkehrenden Zielen). Ohne bisherige Einzahlung gibt's noch
// keinen Start (null).
function effectiveGoalStart(account) {
  const g = account.goal;
  if (!g) return null;
  if (g.startDate) return g.startDate;
  return firstContributionDate(account.id, lastPaymentDate(account.id));
}

function goalStatus(account) {
  if (!account.goal || !account.goal.amount) return null;
  const g = account.goal;
  const balance = getBalance(account.id);
  const remaining = Math.max(g.amount - balance, 0);
  const reached = balance >= g.amount;
  let daysLeft = null,
    neededPerMonth = null,
    trackLabel = null,
    trackClass = "ok",
    expectedPct = null,
    expectedAmount = null;

  const start = effectiveGoalStart(account);

  if (reached) {
    trackLabel = "Ziel erreicht 🎉";
    trackClass = "done";
  } else if (g.date) {
    daysLeft = daysBetween(todayISO(), g.date);
    if (daysLeft < 0) {
      trackLabel = "Überfällig!";
      trackClass = "bad";
    } else {
      const monthsLeft = Math.max(daysLeft / 30.44, 0.1);
      neededPerMonth = remaining / monthsLeft;

      if (start && start < g.date) {
        const totalDays = Math.max(daysBetween(start, g.date), 1);
        const elapsedDays = Math.min(Math.max(daysBetween(start, todayISO()), 0), totalDays);
        expectedPct = (elapsedDays / totalDays) * 100;
        expectedAmount = g.amount * (elapsedDays / totalDays);
        if (balance >= expectedAmount * 1.1) {
          trackLabel = "Voraus";
          trackClass = "ok";
        } else if (balance >= expectedAmount) {
          trackLabel = "Auf Kurs";
          trackClass = "ok";
        } else {
          trackLabel = "Aufholbedarf";
          trackClass = "warn";
        }
      } else {
        const avg = avgMonthlyContribution(account.id);
        if (avg + 0.5 >= neededPerMonth) {
          trackLabel = "Auf Kurs";
          trackClass = "ok";
        } else {
          trackLabel = "Aufholbedarf";
          trackClass = "warn";
        }
      }
    }
  } else {
    trackLabel = "Sparziel (offen)";
    trackClass = "ok";
  }

  return {
    balance,
    remaining,
    reached,
    daysLeft,
    neededPerMonth,
    trackLabel,
    trackClass,
    pct: Math.min(100, (balance / g.amount) * 100),
    expectedPct: expectedPct != null ? Math.min(100, expectedPct) : null,
    expectedAmount,
    start,
  };
}

/* ===================== Rendering ===================== */

function renderAll() {
  renderHeader();
  renderOverview();
  renderDistributeTab();
  renderAccountsTab();
  renderTransactionsTab();
  renderSettingsTab();
  renderVersionHistory();
}

function renderHeader() {
  document.getElementById("totalBalance").textContent = fmt.format(getTotalBalance());
}

/* ---- Übersicht ---- */
function renderOverview() {
  document.getElementById("onboardingHint").hidden = state.transactions.length > 0;

  const total = getTotalBalance();
  const goalsWithDate = state.accounts.filter((a) => a.goal && a.goal.date);
  const soonest = goalsWithDate
    .slice()
    .sort((a, b) => a.goal.date.localeCompare(b.goal.date))[0];

  const summaryRow = document.getElementById("summaryRow");
  summaryRow.innerHTML = "";
  summaryRow.appendChild(
    tile("Gesamtvermögen", fmt.format(total))
  );
  summaryRow.appendChild(tile("Konten", state.accounts.length));
  summaryRow.appendChild(
    tile(
      "Nächste Fälligkeit",
      soonest ? `${soonest.emoji} ${daysBetween(todayISO(), soonest.goal.date)} Tage` : "—"
    )
  );

  drawBalanceChart();
  renderUpcoming();
  renderAccountCards();
}

function tile(label, value) {
  const div = document.createElement("div");
  div.className = "summary-tile";
  div.innerHTML = `<div class="num">${value}</div><div class="lbl">${label}</div>`;
  return div;
}

function renderUpcoming() {
  const list = document.getElementById("upcomingList");
  list.innerHTML = "";
  const withDate = state.accounts
    .filter((a) => a.goal && a.goal.date)
    .slice()
    .sort((a, b) => a.goal.date.localeCompare(b.goal.date));

  if (!withDate.length) {
    list.innerHTML = `<p class="empty-hint">Keine Konten mit Fälligkeitsdatum. Leg unter "Konten" ein Sparziel mit Datum an (z.B. Auto-Versicherung).</p>`;
    return;
  }

  withDate.forEach((a) => {
    const s = goalStatus(a);
    const days = s.daysLeft;
    const item = document.createElement("div");
    item.className = "upcoming-item";
    item.innerHTML = `
      <div class="u-main">
        <span class="u-title">${a.emoji} ${a.name}</span>
        <span class="u-sub">Ziel: ${fmt.format(a.goal.amount)} am ${fmtDate(a.goal.date)} ${a.goal.recurrence === "yearly" ? "(jährlich)" : ""} ${s.start ? `· Spar-Start ${fmtDate(s.start)}${a.goal.startDate ? "" : " (automatisch)"}` : "· noch keine Einzahlung"}</span>
        <span class="u-sub">Gespart: ${fmt.format(s.balance)} ${s.expectedAmount != null ? `· Soll heute: ${fmt.format(s.expectedAmount)}` : s.neededPerMonth != null ? `· benötigt ca. ${fmt.format(s.neededPerMonth)}/Monat` : ""}</span>
      </div>
      <div class="u-right">
        <span class="badge ${s.trackClass}">${days != null ? (days >= 0 ? days + " Tage · " : "") : ""}${s.trackLabel}</span>
        ${!s.reached ? `<button class="btn-secondary pay-btn" data-id="${a.id}">Als bezahlt buchen</button>` : ""}
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll(".pay-btn").forEach((btn) =>
    btn.addEventListener("click", () => payGoal(btn.dataset.id))
  );
}

function payGoal(accountId) {
  const a = state.accounts.find((x) => x.id === accountId);
  if (!a || !a.goal) return;
  const ok = confirm(
    `${a.goal.amount.toFixed(2)} € von "${a.name}" jetzt als bezahlt buchen?`
  );
  if (!ok) return;
  state.transactions.push({
    id: uid(),
    date: todayISO(),
    accountId: a.id,
    amount: -a.goal.amount,
    category: "Fixkosten bezahlt",
    note: a.name,
    createdAt: Date.now(),
  });
  if (a.goal.recurrence === "yearly") {
    if (a.goal.startDate) a.goal.startDate = addYears(a.goal.startDate, 1);
    a.goal.date = addYears(a.goal.date, 1);
  } else {
    a.goal = null;
  }
  saveState();
  renderAll();
  toast("Zahlung gebucht.");
}

function renderAccountCards() {
  const grid = document.getElementById("accountCards");
  grid.innerHTML = "";
  state.accounts.forEach((a) => {
    const balance = getBalance(a.id);
    const s = goalStatus(a);
    const card = document.createElement("div");
    card.className = "account-card";
    card.style.borderLeftColor = a.color;
    card.innerHTML = `
      <div class="acc-head">
        <span class="acc-name">${a.emoji} ${a.name}</span>
        <span>${a.distributionPercent}%</span>
      </div>
      <div class="acc-balance">${fmt.format(balance)}</div>
      ${
        s
          ? `<div class="progress-outer">
               <div class="progress-inner" style="width:${s.pct}%;background:${a.color}"></div>
               ${s.expectedPct != null ? `<div class="progress-marker" style="left:${s.expectedPct}%" title="Soll heute: ${fmt.format(s.expectedAmount)}"></div>` : ""}
             </div>
             <div class="acc-goal-meta">
               <span>Ziel: ${fmt.format(a.goal.amount)}${a.goal.date ? " · " + fmtDate(a.goal.date) : ""}</span>
               <span>${s.pct.toFixed(0)}%</span>
             </div>
             ${s.expectedAmount != null ? `<div class="acc-goal-meta"><span>Soll heute: ${fmt.format(s.expectedAmount)}</span></div>` : ""}
             <span class="badge ${s.trackClass}">${s.trackLabel}</span>`
          : `<div class="acc-goal-meta"><span>Kein Sparziel gesetzt</span></div>`
      }
    `;
    grid.appendChild(card);
  });
}

/* ---- Balance chart (canvas line chart, cumulative total) ---- */
function drawBalanceChart() {
  const canvas = document.getElementById("balanceChart");
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(240, Math.round(canvas.parentElement.clientWidth));
  const H = Math.max(160, Math.min(260, Math.round(W * 0.29)));
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const events = state.transactions
    .slice()
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date.localeCompare(b.date)));

  if (!events.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px sans-serif";
    ctx.fillText("Noch keine Buchungen vorhanden.", 20, H / 2);
    return;
  }

  // build cumulative points per date
  let running = 0;
  const points = [];
  let lastDate = null;
  events.forEach((tx) => {
    running += tx.amount;
    if (tx.date === lastDate) {
      points[points.length - 1].value = running;
    } else {
      points.push({ date: tx.date, value: running });
      lastDate = tx.date;
    }
  });
  // ensure a point at "today" so the line reaches the right edge
  if (points[points.length - 1].date !== todayISO()) {
    points.push({ date: todayISO(), value: running });
  }

  const padL = 60, padR = 20, padT = 20, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const values = points.map((p) => p.value);
  let minV = Math.min(0, ...values);
  let maxV = Math.max(...values, 1);
  if (maxV === minV) maxV = minV + 1;

  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const span = Math.max(t1 - t0, 1);

  const xFor = (d) => padL + ((new Date(d).getTime() - t0) / span) * plotW;
  const yFor = (v) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;

  // axes / gridlines
  ctx.strokeStyle = "#e4e8ef";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px sans-serif";
  ctx.lineWidth = 1;
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = minV + ((maxV - minV) * i) / steps;
    const y = yFor(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(fmt.format(v), 4, y + 4);
  }

  // line
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xFor(p.date), y = yFor(p.value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // fill under line
  ctx.lineTo(xFor(points[points.length - 1].date), padT + plotH);
  ctx.lineTo(xFor(points[0].date), padT + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(37,99,235,0.08)";
  ctx.fill();

  // date labels (first / last)
  ctx.fillStyle = "#64748b";
  ctx.fillText(fmtDate(points[0].date), padL, H - 8);
  ctx.textAlign = "right";
  ctx.fillText(fmtDate(points[points.length - 1].date), W - padR, H - 8);
  ctx.textAlign = "left";
}

/* ---- Verteilen ---- */
function computeDistribution(amount) {
  const distAccounts = state.accounts.filter((a) => !a.isDefault && a.distributionPercent > 0);
  const usedPct = distAccounts.reduce((s, a) => s + a.distributionPercent, 0);
  const cappedPct = Math.min(usedPct, 100);
  const scale = usedPct > 100 ? 100 / usedPct : 1;

  const rows = distAccounts.map((a) => ({
    account: a,
    pct: a.distributionPercent * scale,
    amount: amount * (a.distributionPercent * scale) / 100,
  }));
  const allocated = rows.reduce((s, r) => s + r.amount, 0);
  const remainder = Math.max(amount - allocated, 0);
  const def = getDefaultAccount();
  rows.push({ account: def, pct: 100 - cappedPct, amount: remainder, isRemainder: true });
  return rows;
}

function renderDistributeTab() {
  document.getElementById("distDate").value = todayISO();
  renderDistHistory();
}

function renderSettingsTab() {
  if (!document.getElementById("reconcileDate").value) {
    document.getElementById("reconcileDate").value = todayISO();
  }
  document.getElementById("trackedTotalHint").textContent = fmt.format(getTotalBalance());
  const lastReconcile = state.transactions
    .filter((tx) => tx.category === "Kontostand-Abgleich")
    .map((tx) => tx.date)
    .sort()
    .pop();
  document.getElementById("lastReconcileHint").textContent = lastReconcile ? fmtDate(lastReconcile) : "noch nie";
}

/* ---- Kontostand abgleichen ---- */
function renderReconcilePreview(newTotal) {
  const box = document.getElementById("reconcilePreview");
  if (isNaN(newTotal) || newTotal < 0) {
    box.innerHTML = "";
    return;
  }
  const tracked = getTotalBalance();
  const diff = Math.round((newTotal - tracked) * 100) / 100;

  if (Math.abs(diff) < 0.01) {
    box.innerHTML = `<p class="empty-hint">Stimmt genau überein – keine Buchung nötig.</p>`;
    return;
  }
  if (diff > 0) {
    const rows = computeDistribution(diff);
    box.innerHTML =
      `<div class="dist-row"><span>Neues Geld</span><span>${fmt.format(diff)}</span></div>` +
      rows
        .map(
          (r) =>
            `<div class="dist-row"><span>${r.account.emoji} ${r.account.name} (${r.pct.toFixed(0)}%)</span><span>${fmt.format(r.amount)}</span></div>`
        )
        .join("");
  } else {
    const def = getDefaultAccount();
    box.innerHTML = `<div class="dist-row"><span>Nicht einzeln erfasste Ausgaben</span><span>${fmt.format(diff)}</span></div>
      <div class="dist-row"><span>Wird abgezogen von: ${def.emoji} ${def.name}</span><span>${fmt.format(diff)}</span></div>`;
  }
}

function reconcileBalance(newTotal, date) {
  const tracked = getTotalBalance();
  const diff = Math.round((newTotal - tracked) * 100) / 100;
  if (Math.abs(diff) < 0.01) {
    toast("Stimmt schon überein.");
    return;
  }
  if (diff > 0) {
    const rows = computeDistribution(diff);
    rows.forEach((r) => {
      if (r.amount <= 0) return;
      state.transactions.push({
        id: uid(),
        date,
        accountId: r.account.id,
        amount: r.amount,
        category: "Kontostand-Abgleich",
        note: "Neues Geld laut Bank-Abgleich",
        createdAt: Date.now(),
      });
    });
  } else {
    const def = getDefaultAccount();
    state.transactions.push({
      id: uid(),
      date,
      accountId: def.id,
      amount: diff,
      category: "Kontostand-Abgleich",
      note: "Nicht einzeln erfasste Ausgaben laut Bank-Abgleich",
      createdAt: Date.now(),
    });
  }
  saveState();
  renderAll();
  toast(diff > 0 ? `${fmt.format(diff)} verteilt.` : `${fmt.format(Math.abs(diff))} vom Girokonto abgezogen.`);
}

function renderDistPreview(amount) {
  const box = document.getElementById("distPreview");
  if (!amount || amount <= 0) {
    box.innerHTML = "";
    return;
  }
  const rows = computeDistribution(amount);
  box.innerHTML =
    rows
      .map(
        (r) =>
          `<div class="dist-row"><span>${r.account.emoji} ${r.account.name} (${r.pct.toFixed(0)}%)</span><span>${fmt.format(r.amount)}</span></div>`
      )
      .join("") + `<div class="dist-row"><span>Gesamt</span><span>${fmt.format(amount)}</span></div>`;
}

function renderDistHistory() {
  const box = document.getElementById("distHistory");
  const rows = state.transactions
    .filter((tx) => tx.category === "Verteilung")
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .slice(0, 20);
  if (!rows.length) {
    box.innerHTML = `<p class="empty-hint">Noch keine Verteilungen gebucht.</p>`;
    return;
  }
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Konto</th><th>Betrag</th><th>Notiz</th></tr></thead><tbody>${rows
    .map((tx) => {
      const acc = state.accounts.find((a) => a.id === tx.accountId);
      return `<tr>
        <td data-label="Datum">${fmtDate(tx.date)}</td>
        <td data-label="Konto">${acc ? acc.emoji + " " + acc.name : "?"}</td>
        <td data-label="Betrag" class="amount-pos">${fmt.format(tx.amount)}</td>
        <td data-label="Notiz">${tx.note || ""}</td>
      </tr>`;
    })
    .join("")}</tbody></table></div>`;
}

/* ---- Konten ---- */
function renderAccountsTab() {
  const total = state.accounts.reduce((s, a) => s + (a.isDefault ? 0 : a.distributionPercent), 0);
  document.getElementById("pctTotal").textContent = total + "%";

  const list = document.getElementById("accountEditList");
  list.innerHTML = "";
  state.accounts.forEach((a) => {
    const card = document.createElement("div");
    card.className = "account-edit-card" + (a.goal ? " has-goal" : "");
    card.dataset.id = a.id;
    card.innerHTML = `
      <div class="row">
        <label>Emoji <input type="text" class="f-emoji" value="${a.emoji}" maxlength="4" style="width:50px"></label>
        <label>Name <input type="text" class="f-name" value="${a.name}" style="min-width:200px"></label>
        <label>Farbe <input type="color" class="f-color" value="${a.color}"></label>
        <label>Verteil-% <input type="number" class="f-pct" min="0" max="100" value="${a.distributionPercent}" ${a.isDefault ? "disabled title='Standardkonto erhält den Rest automatisch'" : ""}></label>
        <label><input type="checkbox" class="f-hasgoal" ${a.goal ? "checked" : ""}> Sparziel</label>
      </div>
      <div class="row goal-fields">
        <label>Zielbetrag (€) <input type="number" class="f-goal-amount" min="0" step="1" value="${a.goal ? a.goal.amount : ""}"></label>
        <label>Zieldatum <input type="date" class="f-goal-date" value="${a.goal && a.goal.date ? a.goal.date : ""}"></label>
        <label>Wiederholung
          <select class="f-goal-recurrence">
            <option value="none" ${a.goal && a.goal.recurrence === "none" ? "selected" : ""}>Einmalig / offen</option>
            <option value="once" ${a.goal && a.goal.recurrence === "once" ? "selected" : ""}>Einmalig mit Datum</option>
            <option value="yearly" ${a.goal && a.goal.recurrence === "yearly" ? "selected" : ""}>Jährlich</option>
          </select>
        </label>
        <label class="f-goal-start-wrap">Spar-Start überschreiben (leer = automatisch ab 1. Einzahlung)
          <input type="date" class="f-goal-start" value="${a.goal && a.goal.startDate ? a.goal.startDate : ""}">
          ${a.goal && !a.goal.startDate ? `<span class="empty-hint">${(() => { const auto = effectiveGoalStart(a); return auto ? "aktuell automatisch: " + fmtDate(auto) : "noch keine Einzahlung erfasst"; })()}</span>` : ""}
        </label>
      </div>
      <div class="card-actions">
        <span class="empty-hint">Kontostand: ${fmt.format(getBalance(a.id))}</span>
        <button class="btn-secondary btn-save">Speichern</button>
        ${a.isDefault ? "" : `<button class="btn-danger btn-delete">Löschen</button>`}
      </div>
    `;
    list.appendChild(card);

    card.querySelector(".f-hasgoal").addEventListener("change", (e) => {
      card.classList.toggle("has-goal", e.target.checked);
    });

    const recurrenceSelect = card.querySelector(".f-goal-recurrence");
    const startWrap = card.querySelector(".f-goal-start-wrap");
    const updateStartVisibility = () => {
      startWrap.style.display = recurrenceSelect.value === "none" ? "none" : "";
    };
    updateStartVisibility();
    recurrenceSelect.addEventListener("change", updateStartVisibility);

    card.querySelector(".btn-save").addEventListener("click", () => saveAccountCard(a.id, card));
    const delBtn = card.querySelector(".btn-delete");
    if (delBtn) delBtn.addEventListener("click", () => deleteAccount(a.id));
  });

  // refresh account selects elsewhere
  fillAccountSelect(document.getElementById("txAccount"), false);
  fillAccountSelect(document.getElementById("txFilter"), true);
}

function saveAccountCard(id, card) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  a.emoji = card.querySelector(".f-emoji").value.trim() || "💰";
  a.name = card.querySelector(".f-name").value.trim() || "Konto";
  a.color = card.querySelector(".f-color").value;
  if (!a.isDefault) {
    let pct = parseFloat(card.querySelector(".f-pct").value);
    if (isNaN(pct) || pct < 0) pct = 0;
    a.distributionPercent = pct;
  }
  const hasGoal = card.querySelector(".f-hasgoal").checked;
  if (hasGoal) {
    const amount = parseFloat(card.querySelector(".f-goal-amount").value);
    const date = card.querySelector(".f-goal-date").value || null;
    const recurrence = card.querySelector(".f-goal-recurrence").value;
    if (!amount || amount <= 0) {
      alert("Bitte einen gültigen Zielbetrag angeben.");
      return;
    }
    const finalDate = recurrence === "none" ? null : date;
    const startDate = card.querySelector(".f-goal-start").value || null;
    a.goal = { amount, date: finalDate, recurrence, startDate: finalDate ? startDate : null };
  } else {
    a.goal = null;
  }
  saveState();
  renderAll();
  toast("Konto gespeichert.");
}

function deleteAccount(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  const balance = getBalance(id);
  const msg =
    balance !== 0
      ? `"${a.name}" hat noch ${fmt.format(balance)}. Dieser Betrag wird auf "${getDefaultAccount().name}" übertragen. Konto wirklich löschen?`
      : `Konto "${a.name}" wirklich löschen?`;
  if (!confirm(msg)) return;

  if (balance !== 0) {
    const def = getDefaultAccount();
    state.transactions.push({ id: uid(), date: todayISO(), accountId: id, amount: -balance, category: "Kontoauflösung", note: `Übertrag nach ${def.name}`, createdAt: Date.now() });
    state.transactions.push({ id: uid(), date: todayISO(), accountId: def.id, amount: balance, category: "Kontoauflösung", note: `Übertrag von ${a.name}`, createdAt: Date.now() });
  }
  state.accounts = state.accounts.filter((x) => x.id !== id);
  saveState();
  renderAll();
  toast("Konto gelöscht.");
}

function addAccount() {
  const id = uid();
  state.accounts.push({
    id,
    name: "Neues Konto",
    emoji: "💰",
    color: "#2563eb",
    isDefault: false,
    distributionPercent: 0,
    goal: null,
  });
  saveState();
  renderAccountsTab();
  const card = document.querySelector(`.account-edit-card[data-id="${id}"] .f-name`);
  if (card) {
    card.focus();
    card.select();
  }
}

function fillAccountSelect(select, includeAll) {
  const prev = select.value;
  select.innerHTML = "";
  if (includeAll) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Alle";
    select.appendChild(opt);
  }
  state.accounts.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.emoji} ${a.name}`;
    select.appendChild(opt);
  });
  if ([...select.options].some((o) => o.value === prev)) select.value = prev;
}

/* ---- Transaktionen ---- */
function renderTransactionsTab() {
  fillAccountSelect(document.getElementById("txAccount"), false);
  fillAccountSelect(document.getElementById("txFilter"), true);
  if (!document.getElementById("txDate").value) document.getElementById("txDate").value = todayISO();
  renderTxTable();
}

function renderTxTable() {
  const filter = document.getElementById("txFilter").value;
  const tbody = document.getElementById("txTableBody");
  const rows = state.transactions
    .filter((tx) => !filter || tx.accountId === filter)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-hint">Keine Transaktionen.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((tx) => {
      const acc = state.accounts.find((a) => a.id === tx.accountId);
      const cls = tx.amount >= 0 ? "amount-pos" : "amount-neg";
      return `<tr>
        <td data-label="Datum">${fmtDate(tx.date)}</td>
        <td data-label="Konto">${acc ? acc.emoji + " " + acc.name : "(gelöscht)"}</td>
        <td data-label="Kategorie">${tx.category || ""}</td>
        <td data-label="Notiz">${tx.note || ""}</td>
        <td data-label="Betrag" class="${cls}">${fmt.format(tx.amount)}</td>
        <td data-label=""><button class="icon-btn tx-delete" data-id="${tx.id}" title="Löschen">✕</button></td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".tx-delete").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!confirm("Diese Buchung löschen?")) return;
      state.transactions = state.transactions.filter((t) => t.id !== btn.dataset.id);
      saveState();
      renderAll();
    })
  );
}

/* ---- Versionsverlauf ---- */
function renderVersionTag() {
  document.getElementById("versionTag").textContent = "v" + APP_VERSION;
}

function renderVersionHistory() {
  const box = document.getElementById("versionHistory");
  box.innerHTML = CHANGELOG.map(
    (v) => `
      <div class="version-entry">
        <div class="version-entry-head"><strong>v${v.version}</strong><span>${fmtDate(v.date)}</span></div>
        <ul>${v.changes.map((c) => `<li>${c}</li>`).join("")}</ul>
      </div>`
  ).join("");
}

function checkForUpdate() {
  const lastSeen = localStorage.getItem(VERSION_KEY);
  if (lastSeen === APP_VERSION) return;

  const newEntries = lastSeen
    ? CHANGELOG.filter((v) => compareVersions(v.version, lastSeen) > 0)
    : [CHANGELOG[0]];

  if (!newEntries.length) {
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    return;
  }

  const body = document.getElementById("updateModalBody");
  body.innerHTML =
    (lastSeen ? "" : `<p class="hint">Willkommen! Das ist die aktuelle Version deines Finanzplaners:</p>`) +
    newEntries
      .map(
        (v) => `
        <div class="version-entry">
          <div class="version-entry-head"><strong>v${v.version}</strong><span>${fmtDate(v.date)}</span></div>
          <ul>${v.changes.map((c) => `<li>${c}</li>`).join("")}</ul>
        </div>`
      )
      .join("");

  document.getElementById("updateModalOverlay").hidden = false;
}

function closeUpdateModal() {
  document.getElementById("updateModalOverlay").hidden = true;
  localStorage.setItem(VERSION_KEY, APP_VERSION);
}

/* ---- Regelmäßige Prüfung auf eine neu veröffentlichte Version ---- */
// Merkt sich (nur für diese Session), welche Version schon "Später" geklickt wurde,
// damit nicht bei jeder Prüfung erneut genervt wird.
let dismissedServerVersion = null;

async function checkForServerUpdate() {
  if (document.hidden) return;
  try {
    const res = await fetch("js/app.js?_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const text = await res.text();
    const match = text.match(/APP_VERSION\s*=\s*"([^"]+)"/);
    if (!match) return;
    const serverVersion = match[1];
    if (compareVersions(serverVersion, APP_VERSION) > 0 && serverVersion !== dismissedServerVersion) {
      showServerUpdateBanner(serverVersion);
    }
  } catch (e) {
    // Kein Netzwerk, offline oder lokal per file:// geöffnet – einfach ignorieren.
  }
}

function showServerUpdateBanner(serverVersion) {
  const banner = document.getElementById("serverUpdateBanner");
  document.getElementById("serverUpdateText").textContent =
    `🔄 Neue Version v${serverVersion} verfügbar (du nutzt gerade v${APP_VERSION})`;
  banner.dataset.version = serverVersion;
  banner.hidden = false;
}

function startServerUpdateChecks() {
  setTimeout(checkForServerUpdate, 20000);
  setInterval(checkForServerUpdate, 5 * 60 * 1000);
}

/* ===================== Events ===================== */

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function setupForms() {
  document.getElementById("reconcileAmount").addEventListener("input", (e) => {
    renderReconcilePreview(parseFloat(e.target.value));
  });

  document.getElementById("reconcileForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const newTotal = parseFloat(document.getElementById("reconcileAmount").value);
    const date = document.getElementById("reconcileDate").value || todayISO();
    if (isNaN(newTotal) || newTotal < 0) return;
    reconcileBalance(newTotal, date);
    document.getElementById("reconcileAmount").value = "";
    document.getElementById("reconcilePreview").innerHTML = "";
  });

  document.getElementById("distAmount").addEventListener("input", (e) => {
    renderDistPreview(parseFloat(e.target.value));
  });

  document.getElementById("distributeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById("distAmount").value);
    const source = document.getElementById("distSource").value;
    const date = document.getElementById("distDate").value || todayISO();
    if (!amount || amount <= 0) return;
    const rows = computeDistribution(amount);
    rows.forEach((r) => {
      if (r.amount <= 0) return;
      state.transactions.push({
        id: uid(),
        date,
        accountId: r.account.id,
        amount: r.amount,
        category: "Verteilung",
        note: source,
        createdAt: Date.now(),
      });
    });
    saveState();
    document.getElementById("distAmount").value = "";
    document.getElementById("distPreview").innerHTML = "";
    renderAll();
    toast(`${fmt.format(amount)} verteilt.`);
  });

  document.getElementById("addAccountBtn").addEventListener("click", addAccount);

  document.getElementById("onboardingGoBtn").addEventListener("click", () => {
    switchTab("einstellungen");
    document.getElementById("reconcileAmount").focus();
  });

  document.getElementById("txForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const accountId = document.getElementById("txAccount").value;
    const type = document.getElementById("txType").value;
    let amount = parseFloat(document.getElementById("txAmount").value);
    const date = document.getElementById("txDate").value || todayISO();
    const category = document.getElementById("txCategory").value.trim() || "Sonstiges";
    const note = document.getElementById("txNote").value.trim();
    if (!accountId || !amount || amount <= 0) return;
    if (type === "out") amount = -amount;
    state.transactions.push({ id: uid(), date, accountId, amount, category, note, createdAt: Date.now() });
    saveState();
    document.getElementById("txForm").reset();
    document.getElementById("txDate").value = todayISO();
    renderAll();
    toast("Buchung gespeichert.");
  });

  document.getElementById("txFilter").addEventListener("change", renderTxTable);

  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finanzplaner-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.accounts || !data.transactions) throw new Error("Ungültiges Format");
        if (!confirm("Aktuelle Daten mit dieser Backup-Datei überschreiben?")) return;
        state = data;
        saveState();
        renderAll();
        toast("Backup importiert.");
      } catch (err) {
        alert("Datei konnte nicht gelesen werden: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("Wirklich ALLE Daten löschen und mit Beispieldaten neu starten?")) return;
    state = seedState();
    saveState();
    renderAll();
    toast("Zurückgesetzt.");
  });

  document.getElementById("updateModalClose").addEventListener("click", closeUpdateModal);

  document.getElementById("serverUpdateReloadBtn").addEventListener("click", () => {
    location.href = location.pathname + "?refresh=" + Date.now();
  });
  document.getElementById("serverUpdateDismissBtn").addEventListener("click", () => {
    dismissedServerVersion = document.getElementById("serverUpdateBanner").dataset.version;
    document.getElementById("serverUpdateBanner").hidden = true;
  });
}

/* ===================== Init ===================== */
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupForms();
  renderAll();
  renderVersionTag();
  checkForUpdate();
  startServerUpdateChecks();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawBalanceChart, 150);
  });
});
