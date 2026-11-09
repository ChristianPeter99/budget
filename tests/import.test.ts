import { describe, expect, it } from 'vitest';
import sample from './fixtures/c24-beispiel.csv?raw';
import { freshDb } from './helpers';
import { addTransaction } from '../src/data/transactions';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { importTransactions, undoImport } from '../src/data/imports';
import { findDuplicates, parseDate, parseSignedAmount, parseStatement, suggestCategory } from '../src/domain/statement';
import { validateBackupData } from '../src/domain/validate';
import { demoData } from './demo';

describe('CSV einlesen', () => {
  it('erkennt Format, Beträge, Kaufdatum und Zeilenarten', async () => {
    const r = await parseStatement(sample);
    expect(r.format).toBe('c24');
    expect(r.skippedLines).toBe(1);
    expect(r.candidates).toHaveLength(15);
    const kinds = r.candidates.reduce<Record<string, number>>((a, c) => ({ ...a, [c.kind]: (a[c.kind] ?? 0) + 1 }), {});
    expect(kinds).toEqual({ roundup: 1, expense: 11, transfer: 2, credit: 1 });
    const aral = r.candidates.find((c) => c.payee === 'Aral')!;
    expect(aral).toMatchObject({ date: '2026-10-25', bookingDate: '2026-10-27', amountCents: 780, bankSub: 'Tanken' });
    // PayPal: der eigentliche Shop wird als Empfänger angezeigt
    expect(r.candidates.find((c) => c.amountCents === 6240)!.payee).toBe('Beispielshop');
    // zwei identische Zeilen bekommen unterschiedliche Fingerabdrücke
    const v = r.candidates.filter((c) => c.payee === 'Vereinsheim');
    expect(v).toHaveLength(2);
    expect(v[0]!.key).not.toBe(v[1]!.key);
    // gleiche Datei → gleiche Fingerabdrücke
    const again = await parseStatement(sample);
    expect(again.candidates.map((c) => c.key)).toEqual(r.candidates.map((c) => c.key));
  });

  it('parst Beträge und Daten robust', () => {
    expect(parseSignedAmount('"-1.234,56 €"'.replace(/"/g, ''))).toBe(-123456);
    expect(parseSignedAmount('12,5')).toBe(1250);
    expect(parseSignedAmount('-12.50')).toBe(-1250);
    expect(parseSignedAmount('abc')).toBeNull();
    expect(parseDate('01.02.26')).toBe('2026-02-01');
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
  });

  it('liest Semikolon-CSV anderer Banken über Spaltennamen', async () => {
    const r = await parseStatement('Buchungstag;Empfänger;Verwendungszweck;Betrag\n05.10.2026;REWE Markt;Einkauf;-23,40\n06.10.2026;Arbeitgeber;Gehalt;2.500,00\n');
    expect(r.format).toBe('generic');
    expect(r.candidates.map((c) => [c.payee, c.kind, c.amountCents])).toEqual([['REWE Markt', 'expense', 2340], ['Arbeitgeber', 'credit', 250000]]);
  });

  it('weist Dateien ohne Datum/Betrag ab', async () => {
    await expect(parseStatement('a,b\n1,2\n')).rejects.toThrow();
  });
});

describe('Vorschläge und Duplikate', () => {
  it('schlägt Kategorien aus Namen, Bank-Kategorie und gemerkten Regeln vor', async () => {
    const db = await freshDb(); await seedIfEmpty(db, demoData('2026-10'));
    const cats = (await exportAll(db)).categories;
    const name = (id?: string) => cats.find((c) => c.id === id)?.name;
    const r = await parseStatement(sample);
    const by = (p: string) => r.candidates.find((c) => c.payee === p)!;
    expect(name(suggestCategory(by('Lidl'), cats, {})?.categoryId)).toBe('Einkaufen');
    expect(name(suggestCategory(by('Backhaus Muster'), cats, {})?.categoryId)).toBe('Bäcker');
    expect(name(suggestCategory(by('KANTINE MUSTER'), cats, {})?.categoryId)).toBe('Kantine');
    expect(name(suggestCategory(by('Aral'), cats, {})?.categoryId)).toBe('Benzin');
    expect(name(suggestCategory(by('Amazon'), cats, {})?.categoryId)).toBe('Online');
    expect(suggestCategory(by('Beispielshop'), cats, {})).toBeNull();
    const kino = cats.find((c) => c.name === 'Kino')!.id;
    expect(suggestCategory(by('Beispielshop'), cats, { [by('Beispielshop').payeeKey]: kino })).toEqual({ categoryId: kino, source: 'gemerkt' });
  });

  it('erkennt schon erfasste Ausgaben (gleiches Datum oder bis 3 Tage daneben) und schon importierte Zeilen', async () => {
    const db = await freshDb(); await seedIfEmpty(db, demoData('2026-10'));
    const cats = (await exportAll(db)).categories;
    const ek = cats.find((c) => c.name === 'Einkaufen')!.id;
    await addTransaction(db, { date: '2026-10-22', type: 'expense', amountCents: 4127, categoryId: ek, description: 'Lidl' });
    await addTransaction(db, { date: '2026-10-19', type: 'expense', amountCents: 1958, categoryId: ek, description: 'Lidl' });
    const r = await parseStatement(sample);
    const d = findDuplicates(r.candidates, (await exportAll(db)).transactions);
    const st = (amt: number) => d.get(r.candidates.find((c) => c.amountCents === amt)!.key)!.state;
    expect(st(4127)).toBe('same');
    expect(st(1958)).toBe('maybe');
    expect(st(2265)).toBe('none');
  });
});

describe('Übernehmen und rückgängig', () => {
  it('importiert atomar, merkt Regeln, verhindert Doppelimport und lässt sich zurücknehmen', async () => {
    const db = await freshDb(); await seedIfEmpty(db, demoData('2026-10'));
    const cats = (await exportAll(db)).categories;
    const ek = cats.find((c) => c.name === 'Einkaufen')!.id;
    const r = await parseStatement(sample);
    const lidl = r.candidates.filter((c) => c.payee === 'Lidl');
    const items = lidl.map((c) => ({ date: c.date, type: 'expense' as const, amountCents: c.amountCents, categoryId: ek, description: c.payee, importId: c.key }));
    const ids = await importTransactions(db, items, { [lidl[0]!.payeeKey]: ek });
    expect(ids).toHaveLength(2);
    let d = await exportAll(db);
    expect(d.settings.importRules).toEqual({ lidl: ek });
    expect(validateBackupData(d).ok).toBe(true);
    expect(await importTransactions(db, items, {})).toEqual([]); // zweites Mal: nichts
    const dup = findDuplicates(r.candidates, d.transactions);
    expect(dup.get(lidl[0]!.key)!.state).toBe('imported');
    // ungültige Kategorie → nichts importiert
    const top = cats.find((c) => c.name === 'Lebensmittel')!.id; // hat Unterkategorien, nicht buchbar
    const bad = r.candidates.filter((c) => c.payee === 'Edeka').map((c) => ({ date: c.date, type: 'expense' as const, amountCents: c.amountCents, categoryId: top, description: '', importId: c.key }));
    await expect(importTransactions(db, bad, {})).rejects.toBeDefined();
    expect((await exportAll(db)).transactions.filter((t) => t.importId)).toHaveLength(2);
    expect(await undoImport(db, ids)).toBe(2);
    d = await exportAll(db);
    expect(d.transactions.filter((t) => t.importId)).toHaveLength(0);
  });
});

// Optional: echte Datei nur lokal prüfen (wird nicht ins Projekt übernommen): REAL_CSV=/pfad/datei.csv npx vitest run
const realPath = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.REAL_CSV;
describe.skipIf(!realPath)('Echte Datei (nur lokal)', () => {
  it('liest die echte C24-Datei', async () => {
    const fs = await import(/* @vite-ignore */ 'node:' + 'fs');
    const text = (fs as unknown as { readFileSync: (p: string, e: string) => string }).readFileSync(realPath as string, 'utf8');
    const r = await parseStatement(text);
    const kinds = r.candidates.reduce<Record<string, number>>((a, c) => ({ ...a, [c.kind]: (a[c.kind] ?? 0) + 1 }), {});
    const db = await freshDb(); await seedIfEmpty(db, demoData('2026-10'));
    const cats = (await exportAll(db)).categories;
    const sug = r.candidates.filter((c) => c.kind === 'expense').map((c) => suggestCategory(c, cats, {}));
    console.log(JSON.stringify({ rows: r.candidates.length, skipped: r.skippedLines, kinds, withSuggestion: sug.filter(Boolean).length, groups: new Set(r.candidates.filter((c) => c.kind === 'expense').map((c) => c.payeeKey)).size }));
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});

describe('Backup mit Import-Daten', () => {
  it('nimmt importId und gemerkte Zuordnungen mit und lehnt fehlerhafte Regeln ab', async () => {
    const { createEncryptedBackup, openEncryptedBackup, restoreBackup } = await import('../src/data/backup/backup');
    const db = await freshDb(); await seedIfEmpty(db, demoData('2026-10'));
    const ek = (await exportAll(db)).categories.find((c) => c.name === 'Einkaufen')!.id;
    await importTransactions(db, [{ date: '2026-10-05', type: 'expense', amountCents: 999, categoryId: ek, description: 'Lidl', importId: 'abc123' }], { lidl: ek });
    const file = await createEncryptedBackup(db, 'sehr-geheimes-pw', 100_000);
    const opened = await openEncryptedBackup(file.text, 'sehr-geheimes-pw');
    const db2 = await freshDb();
    await restoreBackup(db2, opened);
    const d = await exportAll(db2);
    expect(d.transactions.find((t) => t.importId === 'abc123')?.amountCents).toBe(999);
    expect(d.settings.importRules).toEqual({ lidl: ek });
    const bad = { ...d, settings: { ...d.settings, importRules: { lidl: 'gibt-es-nicht' } } };
    expect(validateBackupData(bad).ok).toBe(false);
  });
});

describe('Sammel-Blöcke', () => {
  it('fasst Supermärkte und Tankstellen zusammen', async () => {
    const { blockOf } = await import('../src/domain/statement');
    const r = await parseStatement(sample);
    const t = (p: string) => blockOf(r.candidates.find((c) => c.payee === p)!)?.title ?? null;
    expect([t('Lidl'), t('Kaufland'), t('Edeka'), t('Aral'), t('Amazon'), t('Backhaus Muster')]).toEqual(['Supermärkte', 'Supermärkte', 'Supermärkte', 'Tankstellen', null, null]);
  });
});

describe('Blöcke nach Bank-Unterkategorie', () => {
  it('bündelt eine Unterkategorie erst ab zwei verschiedenen Händlern, nie „Weitere Ausgaben“', async () => {
    const { assignBlocks } = await import('../src/domain/statement');
    const r = await parseStatement(`Buchungsdatum,Betrag,Zahlungsempfänger,Kategorie,Unterkategorie
01.10.2026,"-10,00",Pizzeria Roma,Restaurant/ Café/ Bar,Restaurant/ Café/ Bar
02.10.2026,"-12,00",Café Blau,Restaurant/ Café/ Bar,Restaurant/ Café/ Bar
03.10.2026,"-3,00",Bäckerei Huber,Lebensmittel,Bäckerei
04.10.2026,"-3,20",Bäckerei Huber,Lebensmittel,Bäckerei
05.10.2026,"-9,00",Shop A,Weitere Ausgaben,Weitere Ausgaben
06.10.2026,"-9,00",Shop B,Weitere Ausgaben,Weitere Ausgaben
07.10.2026,"-50,00",Aral,Mobilität,Tanken
`);
    const b = assignBlocks(r.candidates);
    const t = (p: string) => b.get(r.candidates.find((c) => c.payee === p)!.key)?.title ?? null;
    expect([t('Pizzeria Roma'), t('Café Blau'), t('Bäckerei Huber'), t('Shop A'), t('Aral')]).toEqual(['Restaurants, Cafés & Bars', 'Restaurants, Cafés & Bars', null, null, 'Tankstellen']);
    expect(r.candidates[0]!.raw).toMatchObject({ payee: 'Pizzeria Roma', amountText: '-10,00' });
  });
});

describe('Retouren', () => {
  it('paart Gutschrift und frühere Ausgabe mit gleichem Betrag beim selben Händler', async () => {
    const { findReturns } = await import('../src/domain/statement');
    const r = await parseStatement(`Buchungsdatum,Betrag,Zahlungsempfänger,Kategorie,Unterkategorie
01.10.2026,"-49,99",Amazon,Shopping,Online-Shopping
02.10.2026,"-49,99",Zalando,Shopping,Bekleidung
03.10.2026,"-20,00",Amazon,Shopping,Online-Shopping
10.10.2026,"49,99",AMAZON PAYMENTS EUROPE,Weitere Einnahmen,Weitere Einnahmen
11.10.2026,"20,00",Kino Muster,Weitere Einnahmen,Weitere Einnahmen
30.09.2026,"5,00",Amazon,Weitere Einnahmen,Weitere Einnahmen
`);
    const m = findReturns(r.candidates);
    const k = (payee: string, amt: number) => r.candidates.find((c) => c.payee.startsWith(payee) && c.amountCents === amt && c.kind === 'credit')!.key;
    const e = (payee: string, amt: number) => r.candidates.find((c) => c.payee === payee && c.amountCents === amt && c.kind === 'expense')!.key;
    expect(m.get(k('AMAZON', 4999))).toBe(e('Amazon', 4999)); // gleicher Händler, nicht Zalando
    expect(m.get(e('Amazon', 4999))).toBe(k('AMAZON', 4999));
    expect(m.has(k('Kino', 2000))).toBe(false); // anderer Händler, andere Kategorie
    expect(m.has(k('Amazon', 500))).toBe(false); // keine frühere Ausgabe
    expect(m.has(e('Zalando', 4999))).toBe(false);
  });
});
