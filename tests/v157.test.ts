import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { addCategory } from '../src/data/categories';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { currentMonthKey } from '../src/domain/dates';
import { detectRecurring, guessFixCategory, parseStatement } from '../src/domain/statement';
import { areaSlices } from '../src/domain/areas';
import { findExisting, templateCents } from '../src/domain/fixDetect';
import type { Recurring, Transaction } from '../src/domain/types';
import { demoData } from './demo';

// Erfundener Kontoauszug über ein halbes Jahr (keine echten Daten)
function statement(): string {
  const head = 'Buchungstag;Empfänger;Verwendungszweck;Betrag';
  const rows: string[] = [];
  for (let m = 1; m <= 6; m++) {
    const mm = String(m).padStart(2, '0');
    rows.push(`01.${mm}.2026;Hausverwaltung Beispiel;Miete Whg 3;-850,00`);
    rows.push(`15.${mm}.2026;Netflix International B.V.;Abo;-13,99`);
    // Einkäufe: mehrmals im Monat, wechselnde Beträge → keine Fixkosten
    rows.push(`0${(m % 8) + 2}.${mm}.2026;REWE Markt;Einkauf;-${20 + m * 7},40`);
    rows.push(`2${m}.${mm}.2026;REWE Markt;Einkauf;-${11 + m * 3},15`);
  }
  for (const mm of ['01', '04']) rows.push(`10.${mm}.2026;Muster Versicherung AG;Kfz-Versicherung Beitrag;-120,00`);
  rows.push(`20.03.2026;Rundfunk ARD ZDF Beitragsservice;Rundfunkbeitrag;-55,08`);
  rows.push(`25.03.2026;Firma Beispiel;Gehalt;2.000,00`);
  return [head, ...rows].join('\n');
}

describe('Fixkosten aus CSV erkennen (v1.57)', () => {
  it('findet Miete, Abo, vierteljährliche Versicherung und Vertragsworte – keine Einkäufe, keine Einnahmen', async () => {
    const res = await parseStatement(statement());
    const found = detectRecurring(res.candidates);
    const by = (s: string) => found.find((f) => f.name.toLowerCase().includes(s));
    expect(by('hausverwaltung')).toMatchObject({ interval: 'monthly', amountCents: 85000, count: 6, day: 1 });
    expect(by('netflix')).toMatchObject({ interval: 'monthly', amountCents: 1399, day: 15 });
    expect(by('versicherung')).toMatchObject({ interval: 'quarterly', amountCents: 12000 });
    expect(by('rundfunk')).toBeTruthy();
    expect(by('rewe')).toBeUndefined();
    expect(by('firma')).toBeUndefined();
    // Vorlagen speichern vierteljährlich als Jahresbetrag
    expect(templateCents(by('versicherung')!)).toBe(48000);
    expect(templateCents(by('netflix')!)).toBe(1399);
  });

  it('rät eine passende Fixkosten-Kategorie und erkennt vorhandene Vorlagen', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, demoData(currentMonthKey()));
    const d = await exportAll(db);
    const found = detectRecurring((await parseStatement(statement())).candidates);
    const cat = (s: string) => d.categories.find((c) => c.id === guessFixCategory(found.find((f) => f.name.toLowerCase().includes(s))!, d.categories, {}));
    for (const s of ['hausverwaltung', 'netflix', 'versicherung']) {
      const c = cat(s);
      expect(c, s).toBeTruthy();
      expect(c!.group).toBe('fix');
    }
    const top = (s: string) => { const c = cat(s)!; return (c.parentId ? d.categories.find((x) => x.id === c.parentId)! : c).name; };
    expect(top('versicherung')).toMatch(/versicher/i);
    // gelernte Zuordnung hat Vorrang
    const other = d.categories.find((c) => c.group === 'fix' && c.kind === 'expense' && c.name === 'Mobilität')!;
    const nf = found.find((f) => f.name.toLowerCase().includes('netflix'))!;
    expect(guessFixCategory(nf, d.categories, { [nf.payeeKey]: other.id })).toBe(other.id);

    const rec = (name: string): Recurring => ({ id: name, name, type: 'expense', amountCents: 1399, categoryId: other.id, startMonth: '2026-01', day: 15, active: true, createdAt: '' });
    expect(findExisting(nf, [rec('Netflix')])?.id).toBe('Netflix');
    expect(findExisting(nf, [rec('Spotify')])).toBeUndefined();
  });
});

describe('Gleiche Kategorienamen in Alltag und Fixkosten (v1.57)', () => {
  it('erlaubt „Sport“ in Fixkosten, obwohl es „Sport“ in Alltag gibt – aber nicht doppelt im selben Bereich', async () => {
    const db = await freshDb();
    await addCategory(db, { name: 'Sport', kind: 'expense', group: 'alltag', parentId: null });
    const fix = await addCategory(db, { name: 'Sport', kind: 'expense', group: 'fix', parentId: null });
    expect(fix.group).toBe('fix');
    await expect(addCategory(db, { name: 'sport', kind: 'expense', group: 'fix', parentId: null })).rejects.toThrow('gibt es bereits');
    await expect(addCategory(db, { name: 'Sport', kind: 'expense', group: 'alltag', parentId: null })).rejects.toThrow('gibt es bereits');
  });
});

describe('Kategorien-Kreis (v1.57)', () => {
  it('summiert je Oberkategorie, größte zuerst, Rest als „Weitere“', async () => {
    const db = await freshDb();
    const cats = [] as Awaited<ReturnType<typeof addCategory>>[];
    for (let i = 0; i < 9; i++) cats.push(await addCategory(db, { name: `K${i}`, kind: 'expense', group: 'alltag', parentId: null }));
    const sub = await addCategory(db, { name: 'Unter', kind: 'expense', group: 'alltag', parentId: cats[0]!.id });
    const fixCat = await addCategory(db, { name: 'Miete', kind: 'expense', group: 'fix', parentId: null });
    const tx = (categoryId: string, amountCents: number): Transaction => ({ id: Math.random().toString(36), type: 'expense', amountCents, categoryId, date: '2026-05-01', note: '', createdAt: '' } as unknown as Transaction);
    const all = [...(await exportAll(db)).categories];
    const txs = [tx(cats[0]!.id, 100), tx(sub.id, 900), ...cats.slice(1).map((c, i) => tx(c.id, 500 - i * 10)), tx(fixCat.id, 85000)];
    const s = areaSlices(txs, all, 'alltag', 7);
    expect(s).toHaveLength(7);
    expect(s[0]).toMatchObject({ name: 'K0', cents: 1000, count: 2 });
    expect(s[6]!.id).toBe('rest');
    expect(s.reduce((a, x) => a + x.cents, 0)).toBe(1000 + [...Array(8)].reduce((a, _, i) => a + 500 - i * 10, 0));
    expect(areaSlices(txs, all, 'fix')).toEqual([expect.objectContaining({ name: 'Miete', cents: 85000 })]);
  });
});
