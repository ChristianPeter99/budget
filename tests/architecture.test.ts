import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Abhängigkeiten nur nach unten: app → features → sheets → ui → state → data → domain.
 * - domain: reine Fachlogik, kennt weder React noch Datenbank noch Browser-Bibliotheken
 * - data: Datenbank, Backup und Datei-Einlesen; nutzt nur domain
 * - state: Store und App-Zustand (Update-Prüfung); nutzt data und domain, nie die Oberfläche
 * - ui: Bausteine ohne eigene Bereiche (Kopf, Blatt, Balken, Monatsauswahl …)
 * - sheets: Eingabeblätter, die mehrere Bereiche öffnen (Buchung, Vorlage, Sparziel)
 * - features: ein Ordner je Bereich; ein Bereich importiert nie aus einem anderen
 * - app: Rahmen mit Reitern, Wischen und dem Mehr-Menü; darf alles
 */
const SRC = resolve(__dirname, '../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Importe einer Datei als Pfad unter src (z. B. 'domain/money') bzw. 'pkg:<name>' */
function importsOf(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const specs = [...code.matchAll(/(?:^import[^'"]*from\s*|^export[^'"]*from\s*|import\()\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);
  return specs.map((s) => (s.startsWith('.') ? relative(SRC, resolve(dirname(file), s)).split(/[\\/]/).join('/') : `pkg:${s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]}`));
}
const top = (t: string) => t.split('/')[0] as string;

type Rule = (target: string, from: string) => boolean;
const layer = (...allowed: string[]): Rule => (t) => allowed.includes(top(t)) || allowed.includes(t);
const ALLOWED: Record<string, Rule> = {
  domain: layer('domain'),
  data: layer('domain', 'data', 'pkg:idb', 'pkg:pdfjs-dist'),
  state: layer('domain', 'data', 'state', 'version', 'pkg:react', 'pkg:workbox-window'),
  ui: layer('domain', 'state', 'ui', 'pkg:react', 'pkg:react-dom'),
  sheets: layer('domain', 'data', 'state', 'ui', 'sheets', 'pkg:react'),
  // eigener Bereich ja, fremde Bereiche nein
  features: (t, from) => layer('domain', 'data', 'state', 'ui', 'sheets', 'version', 'pkg:react', 'pkg:react-dom')(t, from)
    || (top(t) === 'features' && t.split('/')[1] === from.split('/')[1])
};

describe('Architektur', () => {
  for (const name of Object.keys(ALLOWED)) {
    it(`${name}/ importiert nur erlaubte Schichten`, () => {
      const bad: string[] = [];
      for (const f of files(join(SRC, name))) {
        const from = relative(SRC, f).split(/[\\/]/).join('/');
        for (const t of importsOf(f)) if (!ALLOWED[name]!(t, from)) bad.push(`${from} → ${t}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('erkennt verbotene Importe (Selbsttest)', () => {
    expect(ALLOWED.domain!('ui/Sheet', 'domain/x.ts')).toBe(false);
    expect(ALLOWED.data!('state/store', 'data/x.ts')).toBe(false);
    expect(ALLOWED.ui!('features/alltag/Alltag', 'ui/x.tsx')).toBe(false);
    expect(ALLOWED.features!('features/alltag/Calendar', 'features/alltag/Alltag.tsx')).toBe(true);
    expect(ALLOWED.features!('features/bookings/Bookings', 'features/alltag/Alltag.tsx')).toBe(false);
  });
});
