// Anbindung an Claude (Anthropic API) direkt aus dem Browser mit dem offiziellen SDK.
// Der API-Schlüssel bleibt ausschließlich im localStorage dieses Browsers und wird nur
// an api.anthropic.com geschickt.

import { blobToBase64 } from "./camera.js";

const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 – beste Bilderkennung (Standard)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 – schneller, günstiger" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 – am günstigsten, ungenauer" },
];

let sdk = null;
async function loadSdk() {
  if (!sdk) sdk = await import(SDK_URL);
  return sdk;
}

export class Coach {
  constructor() {
    this.apiKey = "";
    this.model = MODELS[0].id;
    this.client = null;
    this.history = []; // Gesprächsverlauf für Fragen
  }

  get ready() {
    return !!this.apiKey;
  }

  configure({ apiKey, model }) {
    if (apiKey !== undefined && apiKey !== this.apiKey) {
      this.apiKey = apiKey.trim();
      this.client = null;
    }
    if (model) this.model = model;
  }

  async _client() {
    if (!this.apiKey) throw new CoachError("no_key", "Bitte zuerst in den Einstellungen deinen Claude-API-Schlüssel eintragen.");
    if (!this.client) {
      const { default: Anthropic } = await loadSdk();
      this.client = new Anthropic({ apiKey: this.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    }
    return this.client;
  }

  /** Ein Aufruf mit Fehlerbehandlung, Refusal-Fallback und optionalem JSON-Schema. */
  async _create({ system, messages, effort = "low", schema = null, maxTokens = 4000 }) {
    const client = await this._client();
    const { default: Anthropic } = await loadSdk();
    // Server-seitiger Fallback, falls ein Modell eine Anfrage ablehnt (nur Opus/Sonnet)
    const withFallback = this.model !== "claude-haiku-5-5";
    const params = {
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
      ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    };
    let res;
    try {
      res = await client.beta.messages.create(params);
    } catch (e) {
      throw translateError(e, Anthropic);
    }
    if (res.stop_reason === "refusal") throw new CoachError("refusal", "Claude hat diese Anfrage abgelehnt.");
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!schema) return text;
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new CoachError("bad_json", "Die Antwort der KI war nicht lesbar.");
    }
  }

  /** Testet den Schlüssel mit einer Mini-Anfrage. */
  async ping() {
    return this._create({ system: "Antworte nur mit OK.", messages: [{ role: "user", content: "Test" }], maxTokens: 200 });
  }

  /**
   * Erkennt anhand von zwei Kamerabildern (vorher/nachher), welcher Zug auf dem echten Brett gespielt wurde.
   * Die KI muss nur zwischen den legalen Zügen wählen – das macht die Erkennung sehr zuverlässig.
   */
  async detectMove({ before, after, game, expected, perspective }) {
    const legal = game.moves({ verbose: true });
    const legalList = legal.map((m) => `${m.san} (${m.from}-${m.to})`).join(", ");
    const turn = game.turn() === "w" ? "Weiß" : "Schwarz";
    const [b64Before, b64After] = await Promise.all([blobToBase64(before), blobToBase64(after)]);

    const system =
      "Du wertest Fotos eines echten Schachbretts aus. Du bekommst ein Foto VOR und ein Foto NACH einem möglichen Zug " +
      "sowie die exakte Stellung vor dem Zug. Bestimme, welcher der legalen Züge ausgeführt wurde, indem du vergleichst, " +
      "welche Felder sich verändert haben (Figur verschwunden / neu erschienen). Hände, Arme oder Schatten im Bild sind kein Zug. " +
      "Wenn im NACH-Bild noch eine Hand über dem Brett ist, das Brett verdeckt ist oder sich keine Figur bewegt hat, antworte mit move = \"none\". " +
      "Antworte ausschließlich im geforderten JSON-Format.";

    const text =
      `Stellung VOR dem Zug (FEN): ${game.fen()}\n` +
      `Brett als Text (Weiß = Großbuchstaben, Reihe 8 oben):\n${game.ascii()}\n` +
      `Am Zug ist: ${turn}.\n` +
      `Kameraperspektive: ${perspective}.\n` +
      `Legale Züge (SAN mit Start- und Zielfeld): ${legalList}\n` +
      (expected ? `Hinweis: Laut Trainingsplan wird wahrscheinlich ${expected.san} (${expected.from}-${expected.to}) gespielt – prüfe aber unabhängig, was die Bilder zeigen.\n` : "") +
      "Gib in 'move' genau einen SAN-Zug aus der Liste oder \"none\" zurück, in 'confidence' deine Sicherheit von 0 bis 1 " +
      "und in 'observation' einen kurzen deutschen Satz, was du gesehen hast.";

    const out = await this._create({
      system,
      effort: "low",
      maxTokens: 3000,
      schema: {
        type: "object",
        properties: {
          move: { type: "string" },
          confidence: { type: "number" },
          observation: { type: "string" },
        },
        required: ["move", "confidence", "observation"],
        additionalProperties: false,
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Foto VORHER:" },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64Before } },
            { type: "text", text: "Foto NACHHER:" },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64After } },
            { type: "text", text },
          ],
        },
      ],
    });
    const mv = legal.find((m) => m.san === out.move || m.san.replace(/[+#]/g, "") === String(out.move).replace(/[+#]/g, ""));
    return { move: mv || null, confidence: Number(out.confidence) || 0, observation: out.observation || "" };
  }

  _systemCoach(ctx) {
    return (
      "Du bist ein freundlicher, geduldiger Schachtrainer und sprichst Deutsch. Du bringst dem Nutzer Schacheröffnungen bei. " +
      "Der Nutzer spielt an einem echten Brett, eine App verbindet dich mit Kamera und Mikrofon. " +
      "Deine Antworten werden laut vorgelesen: Schreibe deshalb natürlich gesprochene Sätze ohne Markdown, ohne Aufzählungszeichen, " +
      "ohne Emojis und ohne Zugnummern. Nenne Züge ausgeschrieben auf Deutsch (z. B. \"Springer nach f3\", \"Läufer schlägt auf c6\"). " +
      "Fasse dich kurz: meist zwei bis fünf Sätze, außer der Nutzer bittet ausdrücklich um eine ausführliche Erklärung. " +
      "Erkläre Ideen und Pläne statt nur Züge, und sei ehrlich, wenn eine Stellung unklar ist.\n\n" +
      "Aktueller Trainingsstand:\n" + ctx
    );
  }

  /** Freie Frage an den Trainer. ctx = Text mit aktueller Eröffnung/Stellung. */
  async ask(question, ctx) {
    this.history.push({ role: "user", content: question });
    if (this.history.length > 16) this.history = this.history.slice(-16);
    while (this.history.length && this.history[0].role !== "user") this.history.shift();
    try {
      const answer = await this._create({ system: this._systemCoach(ctx), messages: this.history, effort: "low", maxTokens: 4000 });
      this.history.push({ role: "assistant", content: answer || "…" });
      return answer;
    } catch (e) {
      this.history.pop();
      throw e;
    }
  }

  resetConversation() {
    this.history = [];
  }

  /**
   * Außerhalb des Eröffnungsbuchs:
   *  role "advice":   Kommentar + bester Zug für den Nutzer (Vorschlag)
   *  role "opponent": Claude spielt selbst die Gegenseite und kommentiert den letzten Zug des Nutzers
   */
  async playOrAdvise({ game, ctx, userSide, role = "advice" }) {
    const legal = game.moves({ verbose: true });
    const side = game.turn() === "w" ? "Weiß" : "Schwarz";
    const user = userSide === "w" ? "Weiß" : "Schwarz";
    const task =
      role === "opponent"
        ? `Du spielst jetzt selbst als Gegner ${side} gegen den Nutzer (${user}) am echten Brett. ` +
          "Spiele einen guten, lehrreichen Zug wie ein starker Vereinsspieler – keine absichtlichen Fehler, aber auch keine unnötig komplizierten Züge. " +
          "Schreibe in 'comment' 1–3 gesprochene Sätze: kurz, wie der letzte Zug des Nutzers war (ehrlich, mit Tipp falls schwach), und was du mit deinem Zug vorhast. " +
          "Nenne deinen Zug im Kommentar NICHT, er wird separat angesagt. Gib in 'move' deinen Zug als SAN aus der Liste an."
        : `Der Nutzer spielt ${user} und ist am Zug. Erkläre in 'comment' kurz (gesprochen, 2–4 Sätze), was der letzte Zug des Gegners bedeutet und welcher Plan jetzt sinnvoll ist. ` +
          "Gib in 'move' den besten Zug für den Nutzer als SAN aus der Liste an.";
    const out = await this._create({
      system: this._systemCoach(ctx),
      effort: "medium",
      maxTokens: 8000,
      schema: {
        type: "object",
        properties: { comment: { type: "string" }, move: { type: "string" } },
        required: ["comment", "move"],
        additionalProperties: false,
      },
      messages: [
        {
          role: "user",
          content:
            `Stellung (FEN): ${game.fen()}\n${game.ascii()}\n` +
            `Bisherige Züge: ${game.history().join(" ")}\n` +
            `Am Zug: ${side}. Legale Züge: ${legal.map((m) => m.san).join(", ")}\n` +
            task,
        },
      ],
    });
    const norm = (x) => String(x).replace(/[+#!?]/g, "").trim();
    const mv = legal.find((m) => norm(m.san) === norm(out.move));
    return { comment: out.comment || "", move: mv || null };
  }
}

export class CoachError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function translateError(e, Anthropic) {
  if (e instanceof CoachError) return e;
  if (Anthropic.AuthenticationError && e instanceof Anthropic.AuthenticationError)
    return new CoachError("auth", "Der API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.");
  if (Anthropic.PermissionDeniedError && e instanceof Anthropic.PermissionDeniedError)
    return new CoachError("permission", "Der API-Schlüssel hat keine Berechtigung für dieses Modell.");
  if (Anthropic.NotFoundError && e instanceof Anthropic.NotFoundError)
    return new CoachError("model", "Das gewählte Modell ist nicht verfügbar. Bitte in den Einstellungen ein anderes wählen.");
  if (Anthropic.RateLimitError && e instanceof Anthropic.RateLimitError)
    return new CoachError("rate", "Zu viele Anfragen gerade – bitte kurz warten.");
  if (Anthropic.BadRequestError && e instanceof Anthropic.BadRequestError) {
    const msg = e?.error?.error?.message || e.message || "";
    if (/credit|billing|balance/i.test(msg)) return new CoachError("billing", "Dein Anthropic-Konto hat kein Guthaben mehr.");
    return new CoachError("bad_request", "Anfrage abgelehnt: " + msg);
  }
  if (Anthropic.APIConnectionError && e instanceof Anthropic.APIConnectionError)
    return new CoachError("network", "Keine Verbindung zu Claude. Bitte Internet prüfen.");
  if (Anthropic.APIError && e instanceof Anthropic.APIError && e.status >= 500)
    return new CoachError("server", "Claude ist gerade überlastet – bitte gleich nochmal versuchen.");
  return new CoachError("unknown", e?.message || String(e));
}
