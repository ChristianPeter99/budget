import type { BackupData, Category, CatGroup, TxType } from './types';
import { DEFAULT_SETTINGS, newId } from './types';

/**
 * Erster Start und „Alle Daten löschen“: leere App mit soliden Standard-Kategorien – keine Buchungen, keine Fixkosten-Beträge,
 * keine Sparrate, keine Sparziele, keine Stände, keine Budgets, Einstellungen auf Anfang.
 * Die Fixkosten-Kategorien bleiben wie bisher, im Alltag die gängigsten Bereiche.
 */
export function buildEmpty(): BackupData {
  const now = new Date().toISOString();
  const categories: Category[] = [];
  let sort = 0;
  const top = (name: string, kind: TxType, group: CatGroup, children: string[] = []) => {
    const c: Category = { id: newId(), name, kind, group, parentId: null, archived: false, sort: sort++, createdAt: now };
    categories.push(c);
    for (const ch of children) categories.push({ id: newId(), name: ch, kind, group, parentId: c.id, archived: false, sort: sort++, createdAt: now });
  };
  top('Gehalt', 'income', 'einnahme');
  top('Sonstige Einnahmen', 'income', 'einnahme');

  top('Wohnen', 'expense', 'fix');
  top('Mobilität', 'expense', 'fix');
  top('Versicherungen', 'expense', 'fix');
  top('Abos & Verträge', 'expense', 'fix');

  top('Lebensmittel', 'expense', 'alltag', ['Einkaufen', 'Essen gehen', 'Bäcker', 'Kantine']);
  top('Gesundheit', 'expense', 'alltag', ['Arzt', 'Apotheke', 'Drogerie']);
  top('Unterwegs', 'expense', 'alltag', ['Tanken', 'Öffentliche', 'Parken']);
  top('Freizeit', 'expense', 'alltag', ['Sport', 'Kultur', 'Hobby']);
  top('Shopping', 'expense', 'alltag', ['Kleidung', 'Elektronik', 'Online']);
  top('Bargeld', 'expense', 'alltag', ['Auszahlung']);
  top('Sonstiges', 'expense', 'alltag', ['Geschenke', 'Urlaub', 'Sonstige']);

  top('Sparen', 'expense', 'spar', ['Sparkonto']);

  return { categories, transactions: [], budgets: [], recurring: [], recurringRuns: [], depotEntries: [], settings: { ...DEFAULT_SETTINGS } };
}
