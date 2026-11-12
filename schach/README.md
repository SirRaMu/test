# ♞ Schach-Eröffnungstrainer mit Claude

Eine Web-App, die dir Schacheröffnungen am **echten Brett** beibringt:
Handy-Kamera aufs Brett richten, mit dem Trainer **sprechen**, und Claude erkennt,
welche Züge du ausführst, sagt dir, was du ziehen sollst, und erklärt die Ideen.

## Was die App kann

- **14 Eröffnungen, 37 Varianten** mit deutscher Erklärung zu jedem Zug,
  u. a. Albin-Gegengambit, Evans-Gambit, Dänisches Gambit, Königsgambit,
  Italienisch, Spanisch, Schottisch, Fried Liver, Sizilianisch (Najdorf),
  Französisch, Caro-Kann, Damengambit, Londoner System, Skandinavisch.
- **Lernmodus:** Der Trainer sagt jeden Zug an (und zeigt ihn auf dem Brett), auch die
  Züge des Gegners, die du dann für ihn ausführst.
- **Abfragemodus:** Du spielst die Variante aus dem Gedächtnis. „Tipp“ verrät erst die
  Figur, dann den Zug.
- **Mitspieler-Modus:** Jemand spielt frei gegen dich. Verlässt er die Theorie, erklärt
  Claude den Zug und schlägt deine Antwort vor.
- **Gegen Claude spielen:** Nach jeder Eröffnung „♟️ Weiterspielen gegen Claude“ – oder
  im Menü direkt eine **freie Partie** starten. Claude sagt seine Züge an (du führst sie
  für ihn auf dem Brett aus), kommentiert deine Züge, und „Tipp“ liefert einen Vorschlag.
- **Kamera-Erkennung:** Die App merkt selbst, wann deine Hand übers Brett geht und wann
  sie wieder weg ist. Dann schickt sie ein Vorher/Nachher-Foto an Claude, das den
  gespielten Zug unter den legalen Zügen heraussucht.
- **Sprechen:** 🎤 antippen und einfach reden:
  - Züge: „e4“, „Springer f3“, „Läufer schlägt c6“, „kurze Rochade“
  - Befehle: „erledigt“ / „ok“ (Zug ausgeführt), „Tipp“, „nochmal“, „zurück“, „stopp“
  - Alles andere ist eine Frage an den Trainer: „Warum spielt man hier c3?“
- Wenn der Trainer fertig gesprochen hat, kommt ein kurzer **Ton** und „🟢 Du kannst jetzt
  sprechen“ – du kannst jederzeit reden, ohne etwas anzutippen.
- Der Trainer **spricht** alle Ansagen und Antworten laut aus (abschaltbar).
- **Digitales Brett:** Figuren per Finger, Maus oder Stift ziehen oder antippen; Züge
  gleiten animiert, farbige Pfeile zeigen deinen Zug (grün), den Gegnerzug (orange) und
  Claudes Vorschläge (blau); bei der Bauernumwandlung wählst du die Figur.
- **Zugfolge & Erklärungen:** Jeder Zug mit Erklärung zum Antippen, dazu ◀ ▶ zum
  Durchblättern der ganzen Variante. Machst du einen Fehler, erklärt Claude, warum
  der Theoriezug besser ist.
- **Passt sich dem Gerät an:** Handy (eine Spalte), iPad hochkant (Brett + Seitenleiste),
  iPad quer / Laptop (Brett so groß wie möglich) und PC (Zugliste – Brett – Trainer).
  Am PC gibt es Tastenkürzel (Leertaste, T, W, N, Z, ←/→, M) und Fotos lassen sich
  per Drag & Drop auf die Kamera-Fläche ziehen.
- Fortschritt (fehlerfrei gespielte Varianten) wird lokal gespeichert.

## Zwei Wege, die App zu nutzen

| | Über dein Claude-Abo (claude.ai) | Mit API-Schlüssel (GitHub Pages) |
|---|---|---|
| Kosten | über dein Claude-Konto, nichts extra | ca. 1–2 Cent pro erkanntem Zug |
| Kamera | Foto pro Zug (📸-Knopf) | Live: Handy hinstellen, erkennt Züge selbst |
| Sprechen | Mikrofon antippen, dann sprechen | Dauerhaft zuhören |
| Stimme | Claudes Stimme (im Chrome-Browser) | Browser-Stimme |

Die App erkennt selbst, wo sie läuft. Auf claude.ai nutzt sie automatisch dein Konto
(Claude fragt einmal um Erlaubnis); Live-Kamera und Dauer-Mikrofon sind dort aus
Sicherheitsgründen gesperrt. Am besten öffnest du den claude.ai-Link in **Chrome**
(Android) – in der Claude-App fehlen Spracheingabe und -ausgabe.

## Einrichtung (API-Schlüssel-Variante)

1. **Claude-API-Schlüssel besorgen** auf <https://console.anthropic.com/settings/keys>
   (braucht ein Anthropic-Konto mit etwas Guthaben). In der App unter ⚙️ eintragen,
   „Verbindung testen“ und speichern. Der Schlüssel bleibt nur in deinem Browser.
   Kosten grob: 1–2 Cent pro per Kamera erkanntem Zug mit Claude Opus 5.5,
   mit Sonnet 5.5 etwa die Hälfte. Fragen kosten weniger als einen Cent.
2. **Über https öffnen.** Kamera und Mikrofon funktionieren im Browser nur über
   `https://` (oder `localhost`). Am einfachsten über GitHub Pages:
   `https://<dein-name>.github.io/<repo>/schach/`
3. **Handy aufstellen:** Kamera so, dass das ganze Brett zu sehen ist, am besten
   schräg von oben von der weißen Seite. Unter ⚙️ die Kamera-Perspektive einstellen.
4. Eröffnung wählen → Variante → **Training starten** → 📷 Kamera starten → 🎤 antippen.

Empfohlene Browser: **Chrome auf Android** (alles funktioniert) oder **Safari auf dem
iPhone** (Spracherkennung je nach iOS-Version eingeschränkt, dann unten tippen).

Ohne API-Schlüssel geht der Trainer auch: Züge per Sprache, Antippen auf dem
digitalen Brett oder „✅ Zug ausgeführt“ bestätigen. Nur Kamera-Erkennung und
Fragen an Claude brauchen den Schlüssel.

## Technik

- Reines HTML/CSS/JavaScript, kein Build-Schritt.
- Schachregeln: [chess.js](https://github.com/jhlywa/chess.js) (lokal unter `vendor/`, BSD-Lizenz).
- KI: offizielles Anthropic-SDK (`@anthropic-ai/sdk`), direkt aus dem Browser geladen.
  Standardmodell `claude-opus-5-5`; mit serverseitigem Fallback, falls ein Modell
  eine Anfrage ablehnt.
- Sprache: Web Speech API (Spracherkennung und Sprachausgabe des Browsers).
- claude.ai-Version bauen: `python3 schach/tools/build-artifact.py ZIELORDNER`
- Tests: `node schach/tests/validate-openings.mjs` (prüft alle Varianten auf legale Züge)
  und `node schach/tests/speech-parse.mjs` (deutscher Zug-Parser).
