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

## Was die App kann

- **Konten anlegen** – beliebig viele, z. B. Sparkonto, Auto-Versicherung,
  Auto-Reparaturen, Urlaub, Party. Jedes Konto hat eine Farbe, ein Emoji und
  optional ein **Sparziel** (Betrag + Datum, einmalig oder jährlich
  wiederkehrend wie die Auto-Versicherung/Steuer).
- **Geld verteilen** – Taschengeld oder Lohn eintragen, die App verteilt es
  automatisch nach den von dir festgelegten Prozentsätzen auf deine Konten
  (z. B. 60 % aufs Sparkonto). Der Rest landet automatisch im Girokonto.
- **Vorausschau** – Übersicht, wie viele Tage bis zur nächsten fälligen Kosten
  (z. B. 1.350 € Versicherung/Steuer am 1. September) verbleiben, wie viel
  schon zurückgelegt wurde und ob du "auf Kurs" bist oder "Aufholbedarf"
  hast (Vergleich: nötige monatliche Sparrate vs. dein bisheriger Schnitt).
- **Fällige Kosten bezahlen** – ein Klick bucht die Ausgabe vom passenden
  Konto; bei jährlichen Kosten springt das Fälligkeitsdatum automatisch ein
  Jahr weiter.
- **Transaktionen** – manuell Einnahmen/Ausgaben buchen (z. B. Reifen,
  Ölwechsel, Bremsen, Reparatur), filterbar je Konto.
- **Kontostand-Verlauf** als Diagramm, Fortschrittsbalken pro Sparziel.
- **Backup** – Export/Import als JSON-Datei, falls du den Browser wechselst
  oder ein Backup willst.

Die App startet beim ersten Mal mit ein paar Beispiel-Konten/-Buchungen, die
du jederzeit umbenennen, löschen oder ergänzen kannst (Tab "Konten").

## Technik

Reines HTML/CSS/JavaScript (keine Frameworks, keine externen Abhängigkeiten).
Alle Diagramme sind selbst mit `<canvas>` gezeichnet, damit die App auch ganz
ohne Internetverbindung läuft. Daten liegen ausschließlich lokal im Browser
(`localStorage`) – nichts wird irgendwohin gesendet.
