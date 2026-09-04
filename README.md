# 💶 Mein Finanzplaner

Eine kleine, lokal laufende Web-App, um als Azubi/Abiturient den Überblick über
Taschengeld, Job-Einkommen, Auto-Kosten, Sparziele und Urlaub/Party-Budget zu
behalten. Läuft komplett im Browser, keine Installation, keine Cloud – alle
Daten bleiben auf deinem Rechner (`localStorage`).

## Starten

**Variante 1 (einfachste):** `index.html` direkt doppelklicken / im Browser öffnen.

**Variante 2 (empfohlen, falls der Browser localStorage bei `file://` blockiert):**

```bash
python3 serve.py
```

Öffnet automatisch `http://localhost:8765` im Browser. Alternativer Port: `python3 serve.py 9000`.

Voraussetzung: Python 3 (ist auf den meisten Rechnern schon installiert). Es
wird sonst nichts benötigt – kein `npm install`, keine Internetverbindung.

## Erste Schritte

Die App startet mit ein paar Beispiel-Konten (Sparkonto, Auto-Versicherung,
Urlaub, Party – umbenennbar/löschbar im Tab "Konten"), aber **ohne** Beispiel-
Buchungen. Trag als Erstes unter **⚙️ Einstellungen → Kontostand abgleichen**
einmalig deinen echten, aktuellen Kontostand ein (z. B. aus deiner Sparkassen-
App). Ab dann reicht es, Einnahmen zu verteilen und Ausgaben einzutragen
unter "💰 Einnahme & Ausgabe". Falls du mal etwas zu buchen vergisst und der
Kontostand nicht mehr stimmt, kannst du unter Einstellungen jederzeit neu
abgleichen – die App bucht dann nur die Differenz nach.

## Was die App kann

- **Konten anlegen** – beliebig viele, z. B. Sparkonto, Auto-Versicherung,
  Auto-Reparaturen, Urlaub, Party. Jedes Konto hat eine Farbe, ein Emoji und
  optional ein **Sparziel** (Betrag + Datum, einmalig oder jährlich
  wiederkehrend wie die Auto-Versicherung/Steuer).
- **Einnahme verteilen** – Taschengeld oder Lohn eintragen, die App verteilt
  es automatisch nach den von dir festgelegten Prozentsätzen auf deine Konten
  (z. B. 60 % aufs Sparkonto). Der Rest landet automatisch im Girokonto.
- **Ausgabe buchen** – einfach den Betrag eintragen (z. B. Kino, Essen), kein
  Konto auswählen nötig: die App bucht ihn direkt vom frei verfügbaren
  Girokonto ab. Die Konten sind schließlich kein echtes Konto-Hin-und-Her,
  sondern nur die Aufteilung deines einen Gesamtguthabens.
- **Vorausschau** – Der Spar-Start eines Ziels wird automatisch ab der ersten
  Einzahlung erkannt (manuell überschreibbar). Die App zeigt Tage bis zur
  Fälligkeit (z. B. 1.350 € Versicherung/Steuer am 1. September), Soll- vs.
  Ist-Stand, ob du "auf Kurs" bist oder "Aufholbedarf" hast, und über den
  ℹ️-Button bei jedem Sparziel genau, wie viel du noch täglich/monatlich
  einzahlen musst.
- **Fällige Kosten bezahlen** – ein Klick bucht die Ausgabe vom passenden
  Sparziel-Konto; bei jährlichen Kosten springt das Fälligkeitsdatum
  automatisch ein Jahr weiter.
- **Kontostand-Verlauf** als Diagramm, Fortschrittsbalken pro Sparziel.
- **Einstellungen** – Kontostand abgleichen (Ersteinrichtung/Korrektur),
  Backup-Export/Import als JSON, Versionsverlauf, komplettes Zurücksetzen.

## Technik

Reines HTML/CSS/JavaScript (keine Frameworks, keine externen Abhängigkeiten).
Alle Diagramme sind selbst mit `<canvas>` gezeichnet, damit die App auch ganz
ohne Internetverbindung läuft. Daten liegen ausschließlich lokal im Browser
(`localStorage`) – nichts wird irgendwohin gesendet.
