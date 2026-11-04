# Bestandsaufnahme (Phase 1 & 2)

Ausgangslage: Es gab eine einzelne Datei `index.html` (Vanilla-JS, `localStorage`, Kommazahlen als Float, Service Worker „network-first“) sowie ein Design-Mockup. Bewertung gegen die Anforderungen:

| Anforderung | Status Altbestand | Maßnahme |
|---|---|---|
| TypeScript / React / Vite | nicht umgesetzt | Neues Projekt `budget-pwa` |
| IndexedDB (idb), Migrationen | nicht umgesetzt (localStorage, keine Versionierung) | `src/db`, DB_VERSION 2, getestete Migration v1→v2 |
| Geld als Ganzzahl-Cent | **fehlerhaft** (Float, Rundungsfehler) | `domain/money.ts`, nur Cent-Integer |
| Lokale Daten, keine UTC-Fehler | teilweise (`toISOString` kann Tage verschieben) | `domain/dates.ts`, nur lokale Datums-Strings |
| Offline / PWA | teilweise (kein Precache) | vite-plugin-pwa + Workbox-Precache, Update-Hinweis |
| Buchungen CRUD, eigene Kategorien, Budgets | teilweise (keine Monats-/Kategorie-Budgets, keine eigenen Kategorien) | vollständig neu |
| Filter, Auswertung | teilweise | Zeitraum/Typ/Kategorie/Suche, 12-Monats-Diagramm |
| Backup / Restore | **nicht umgesetzt**; ein unverschlüsselter Export wäre sicherheitskritisch | PBKDF2-SHA256 600 000 + AES-256-GCM (Web Crypto), atomarer Import, Sicherung vor Import |
| Tests | nicht umgesetzt | Vitest (30), Playwright (2) |
| Keine Drittanbieter-Ressourcen, kein Tracking | korrekt | beibehalten |

Architektur: `domain` (reine Logik) → `db` (Persistenz) → `backup` (Krypto/Format) → `state` (React-Store) → `ui`. Fehlertexte enthalten nie Finanzdaten; es wird nichts geloggt.
