# Budget

Private Haushaltsbuch-App für das iPhone, als Web-App (PWA) zum Installieren auf dem Home-Bildschirm.
Alle Daten bleiben auf dem Gerät. Es gibt keinen Server, kein Tracking und keine Bankanbindung.

## Was die App kann
- **Übersicht:** Was im Monat noch verfügbar ist, aufgeteilt auf Fixkosten, Alltag und Sparen
- **Alltag:** Ausgaben nach Kategorien mit Budget-Balken, eigener Reihenfolge oder Sortierung nach Betrag
- **Buchungen:** Liste mit Suche und Filter; gedrückt halten für Bearbeiten, Duplizieren, Löschen
- **Fixkosten:** Wiederkehrende Zahlungen (monatlich oder jährlich), werden jeden Monat automatisch gebucht
- **Mehr:** Sparen & Depot, gemeinsames Konto, CSV-Import, Auswertung, Kategorien, Gehalt, Budgets, Daten & Backup

## Auf dem iPhone installieren
1. Die App-Adresse (GitHub Pages dieses Repositorys) **in Safari** öffnen.
2. Teilen-Symbol → „Zum Home-Bildschirm“ → Hinzufügen.
3. Einmal mit Internet starten, danach läuft die App auch offline.

Safari und die Home-Bildschirm-App haben getrennte Daten, deshalb nur die Home-Bildschirm-App benutzen.

## Daten und Backup
- Gespeichert wird lokal im Browser (IndexedDB). Geschützt sind die Daten durch die Gerätesperre des iPhones.
- Unter **Mehr › Daten & Backup** lässt sich ein verschlüsseltes Backup erstellen (AES-256-GCM, Passwort wird nie gespeichert) und wieder einspielen. Ein automatisches Backup und eine Synchronisation zwischen Geräten gibt es nicht, deshalb regelmäßig sichern.

## Updates
Jeder Push auf `main` wird per GitHub Actions getestet, gebaut und auf GitHub Pages veröffentlicht.
Die App meldet dann „Neue App-Version bereit“ → „Aktualisieren“. Die Daten bleiben dabei erhalten.

## Entwicklung
```
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit-Tests (Vitest)
npm run build      # Typprüfung und Build nach dist/
npm run e2e        # Browser-Tests (Playwright, Chromium)
npm run e2e:webkit # Tests mit der Safari-Engine (Linux)
```
Technik: React, TypeScript, Vite, vite-plugin-pwa. Beträge werden als ganze Cent gespeichert.
Die Versionsnummer steht in `src/version.ts`, `package.json` und `public/version.json`.
