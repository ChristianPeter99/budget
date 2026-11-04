import type { BackupData, Budget, Category, CatGroup, Recurring, TxType } from './types';
import { DEFAULT_SETTINGS, newId } from './types';

/**
 * Startdaten, abgeleitet aus dem bisherigen Excel-Haushaltsplan: Kategorien mit Bezeichnungen,
 * Fixkosten, Sparrate und Gehalt. Alles lässt sich in der App ändern.
 * Wiederkehrende Buchungen beginnen im angegebenen Monat (kein Rückwirkend-Erzeugen).
 */
export function buildSeed(startMonth: string): BackupData {
  const now = new Date().toISOString();
  const categories: Category[] = [];
  const recurring: Recurring[] = [];
  const budgets: Budget[] = [];
  let sort = 0;

  const top = (name: string, kind: TxType, group: CatGroup, children: string[] = []): Category => {
    const c: Category = { id: newId(), name, kind, group, parentId: null, archived: false, sort: sort++, createdAt: now };
    categories.push(c);
    for (const ch of children) categories.push({ id: newId(), name: ch, kind, group, parentId: c.id, archived: false, sort: sort++, createdAt: now });
    return c;
  };

  const gehalt = top('Gehalt', 'income', 'einnahme');
  top('Sonstige Einnahmen', 'income', 'einnahme');

  const wohnen = top('Wohnen', 'expense', 'fix');
  const mobil = top('Mobilität', 'expense', 'fix');
  const vers = top('Versicherungen', 'expense', 'fix');
  const abos = top('Abos & Verträge', 'expense', 'fix');

  top('Lebensmittel', 'expense', 'alltag', ['Einkaufen', 'Kantine', 'Essen gehen', 'Bäcker']);
  top('Gesundheit', 'expense', 'alltag', ['Arzt', 'Apotheke', 'DM', 'Friseur']);
  top('Auto', 'expense', 'alltag', ['Benzin', 'Wartung', 'Parken']);
  top('Bargeld', 'expense', 'alltag', ['Auszahlung']);
  top('Motorrad', 'expense', 'alltag', ['Benzin', 'Teile']);
  top('Sport', 'expense', 'alltag', ['Sport']);
  top('Bekleidung', 'expense', 'alltag', ['Schuhe']);
  top('Freizeit', 'expense', 'alltag', ['Hütte', 'Kino']);
  top('Sonstiges', 'expense', 'alltag', ['Amazon', 'Schlucht', 'Tracht', 'Sonstige', 'Urlaub', 'Ski']);

  const sparen = top('Sparen', 'expense', 'spar', ['Sparkonto']);
  const sparkonto = categories.find((c) => c.parentId === sparen.id)!;

  const rec = (name: string, type: TxType, amountCents: number, cat: Category) =>
    recurring.push({ id: newId(), name, type, amountCents, categoryId: cat.id, startMonth, day: 1, active: true, createdAt: now });

  rec('Gehalt', 'income', 317200, gehalt);
  rec('Miete', 'expense', 55000, wohnen);
  rec('GEZ', 'expense', 1800, wohnen);
  rec('Parkkarte Anwohner', 'expense', 300, wohnen);
  rec('Versicherung Auto', 'expense', 5000, mobil);
  rec('Versicherung Yamaha', 'expense', 1500, mobil);
  rec('Versicherung Asiawing', 'expense', 400, mobil);
  rec('Kfz-Steuer Auto', 'expense', 1300, mobil);
  rec('Kfz-Steuer Yamaha', 'expense', 300, mobil);
  rec('Kfz-Steuer Asiawing', 'expense', 200, mobil);
  rec('ADAC Ausland', 'expense', 200, mobil);
  rec('DAV', 'expense', 506, vers);
  rec('Haftpflichtversicherung', 'expense', 300, vers);
  rec('Fitnessstudio', 'expense', 2350, abos);
  rec('Handy Vertrag', 'expense', 550, abos);
  rec('Amazon Prime', 'expense', 400, abos);
  rec('Spotify', 'expense', 400, abos);
  rec('Sparrate', 'expense', 45000, sparkonto);

  return {
    categories, transactions: [], budgets, recurring, recurringRuns: [], depotEntries: [],
    settings: { ...DEFAULT_SETTINGS, expectedIncomeCents: 317200, accountName: 'C24', split: { fix: 40, alltag: 40, spar: 15 } }
  };
}
