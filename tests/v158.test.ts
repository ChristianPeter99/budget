import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { exportAll, importTransactions, seedIfEmpty } from '../src/db/repo';
import { currentMonthKey, shiftMonth } from '../src/domain/dates';
import { detectRecurring, parseStatement } from '../src/import/csv';
import { fixFromCandidates, makeFixRow, memberKeys, saveFixRows, willSave, withMembers } from '../src/ui/FixImport';
import { iconInk, subRows, areaSlices } from '../src/ui/Donut';

const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// Erfundener Auszug: Miete und Fitnessclub in den letzten 4 Monaten, dazu Einkäufe beim selben Bäcker
function csv(): string {
  const rows = ['Buchungstag;Empfänger;Verwendungszweck;Betrag'];
  const cur = currentMonthKey();
  for (let i = 4; i >= 1; i--) {
    const m = shiftMonth(cur, -i);
    rows.push(`${de(m + '-01')};Hausverwaltung Beispiel;Miete;-850,00`);
    rows.push(`${de(m + '-05')};Muster Fitnessclub;Beitrag;-29,90`);
    rows.push(`${de(m + '-0' + (i + 2))};Bäckerei Korn;Einkauf;-${3 + i},50`);
    rows.push(`${de(m + '-2' + i)};Bäckerei Korn;Einkauf;-${5 + i},10`);
  }
  return rows.join('\n');
}

describe('Ein Upload: Buchungen und Fixkosten zusammen (v1.58)', () => {
  it('Vorlagen übernehmen die importierten Buchungen – keine doppelten, ab jetzt bucht die App selbst', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, currentMonthKey());
    const d0 = await exportAll(db);
    const res = await parseStatement(csv());
    const found = detectRecurring(res.candidates);
    expect(found.map((f) => f.name).sort()).toEqual(['Hausverwaltung Beispiel', 'Muster Fitnessclub']);
    const rows = found.map((f) => makeFixRow(f, res.candidates, d0.categories, d0.recurring, {}));
    for (const r of rows) { expect(r.keys).toHaveLength(4); expect(r.on).toBe(true); expect(r.cat).toBeTruthy(); }
    // Bäcker gehört zu keiner Fixkosten-Zahlung
    const fixKeys = new Set(rows.flatMap((r) => r.keys));
    expect(res.candidates.filter((c) => c.payee.startsWith('Bäckerei')).some((c) => fixKeys.has(c.key))).toBe(false);

    const catOf = new Map(rows.flatMap((r) => r.keys.map((k) => [k, r.cat] as const)));
    const items = res.candidates.filter((c) => fixKeys.has(c.key)).map((c) => ({ date: c.date, type: 'expense' as const, amountCents: c.amountCents, categoryId: catOf.get(c.key)!, description: c.payee, importId: c.key }));
    await importTransactions(db, items, {});
    expect(await saveFixRows(db, rows)).toBe(2);
    const d = await exportAll(db);
    expect(d.recurring.filter((r) => r.name === 'Hausverwaltung Beispiel')).toHaveLength(1);
    const rent = d.transactions.filter((t) => t.amountCents === 85000);
    // 4 importierte + der laufende Monat (von der Vorlage); der letzte importierte Monat ist der Vorlage zugeordnet
    expect(rent).toHaveLength(5);
    const last = shiftMonth(currentMonthKey(), -1);
    expect(rent.filter((t) => t.date.startsWith(last))).toHaveLength(1);
    expect(rent.find((t) => t.date.startsWith(last))!.recurringId).toBeTruthy();
    expect(rent.filter((t) => t.date.startsWith(currentMonthKey()))).toHaveLength(1);

    // Zweiter Import derselben Datei: schon in Fixkosten, nichts wird neu angelegt
    const again = detectRecurring(res.candidates).map((f) => makeFixRow(f, res.candidates, d.categories, d.recurring, {}));
    expect(again.every((r) => r.same && !willSave(r))).toBe(true);
    expect(await saveFixRows(db, again)).toBe(0);
  });

  it('von Hand markiert: Zahlung aus den Zeilen eines Händlers', async () => {
    const res = await parseStatement(csv());
    const list = res.candidates.filter((c) => c.payee.startsWith('Hausverwaltung'));
    const f = fixFromCandidates(list);
    expect(f).toMatchObject({ interval: 'monthly', amountCents: 85000, count: 4, day: 1 });
    expect(memberKeys(f, res.candidates)).toHaveLength(4);
  });
});

describe('Kategorie-Kreis mit Symbolen (v1.58)', () => {
  it('Abschnitte tragen Symbole, Unterkategorien aufgeschlüsselt, helle Töne mit dunklem Symbol', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, currentMonthKey());
    const { categories: cats } = await exportAll(db);
    const leb = cats.find((c) => c.name === 'Lebensmittel' && !c.parentId)!;
    const kids = cats.filter((c) => c.parentId === leb.id);
    const tx = (categoryId: string, amountCents: number) => ({ id: categoryId + amountCents, type: 'expense', amountCents, categoryId, date: '2026-05-01', description: '', createdAt: '' }) as never;
    const txs = [tx(kids[0]!.id, 3000), tx(kids[1]!.id, 1000), tx(leb.id, 500)];
    const s = areaSlices(txs, cats, 'alltag');
    expect(s[0]!.icon).toBeTruthy();
    expect(s[0]!.icon).not.toBe('dots');
    const sub = subRows(txs, cats, 'alltag', leb.id);
    expect(sub.map((r) => r.cents)).toEqual([3000, 1000, 500]);
    expect(sub[2]!.name).toBe('Ohne Unterkategorie');
    expect(iconInk('alltag', 0)).toBe('#fff');
    expect(iconInk('inc', 0)).toBe('#0E0F12');
  });
});

describe('Bündel am Händlernamen (v1.58)', () => {
  it('erkennt Cafés, Bäckereien, Drogerien, Lieferdienste, ÖPNV ohne Bank-Kategorie', async () => {
    const { assignBlocks, nameBlock } = await import('../src/import/csv');
    const res = await parseStatement(['Buchungsdatum;Betrag;Zahlungsempfänger',
      '01.10.2026;-3,40;STARBUCKS 1234', '02.10.2026;-2,90;Cafe am Markt', '03.10.2026;-3,10;Bäckerei Huber', '04.10.2026;-2,10;Backhaus Muster',
      '05.10.2026;-12,00;dm-drogerie markt', '06.10.2026;-8,00;Rossmann 123', '07.10.2026;-23,00;Lieferando.de', '08.10.2026;-18,00;Wolt Munich',
      '09.10.2026;-3,70;MVG Automat', '10.10.2026;-49,00;DB Vertrieb GmbH', '11.10.2026;-40,00;Muster Elektro GmbH'].join('\n'));
    const b = assignBlocks(res.candidates);
    const t = (p: string) => b.get(res.candidates.find((c) => c.payee.startsWith(p))!.key)?.title ?? null;
    expect([t('STARBUCKS'), t('Cafe am'), t('Bäckerei'), t('Backhaus'), t('dm'), t('Rossmann'), t('Lieferando'), t('Wolt'), t('MVG'), t('DB'), t('Muster Elektro')])
      .toEqual(['Cafés & Kaffee', 'Cafés & Kaffee', 'Bäckereien', 'Bäckereien', 'Drogerien', 'Drogerien', 'Lieferdienste', 'Lieferdienste', 'Bahn, Bus & Fahrdienste', 'Bahn, Bus & Fahrdienste', null]);
    expect(nameBlock(res.candidates.find((c) => c.payee.startsWith('Muster'))!)).toBeNull();
  });
});

describe('Fixkosten-Vorlage mit gewähltem Beginn (v1.59.2)', () => {
  it('startet im gewählten Monat statt im Monat der letzten Zahlung', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, currentMonthKey());
    const d0 = await exportAll(db);
    const res = await parseStatement(csv());
    const f = fixFromCandidates(res.candidates.filter((c) => c.payee.startsWith('Hausverwaltung')));
    const next = shiftMonth(currentMonthKey(), 1);
    const row = { ...makeFixRow(f, res.candidates, d0.categories, d0.recurring, {}), start: next };
    expect(await saveFixRows(db, [row])).toBe(1);
    const d = await exportAll(db);
    expect(d.recurring.find((r) => r.name === 'Hausverwaltung Beispiel')?.startMonth).toBe(next);
    expect(d.transactions.filter((t) => t.amountCents === 85000)).toHaveLength(0);
  });
});

describe('Fixkosten: Zusatzkäufe beim selben Händler abwählen (v1.59.3)', () => {
  it('der Vorlagenbetrag kommt nur aus den gewählten Buchungen', async () => {
    const res = await parseStatement(['Buchungsdatum;Betrag;Zahlungsempfänger', '01.08.2026;-29,90;Muster Fitness', '15.08.2026;-4,50;Muster Fitness', '01.09.2026;-29,90;Muster Fitness', '20.09.2026;-12,00;Muster Fitness'].join('\n'));
    const all = res.candidates;
    const f = fixFromCandidates(all);
    expect(f.amountCents).toBe(1200); // zuletzt ein Zusatzkauf
    const row = { ...makeFixRow(f, all, [], [], {}, all.map((c) => c.key)), manual: true };
    const fee = all.filter((c) => c.amountCents === 2990);
    const r2 = withMembers(row, fee);
    expect(r2.f).toMatchObject({ amountCents: 2990, count: 2, last: '2026-09-01', varies: false });
    expect(r2.keys).toHaveLength(2);
    expect(withMembers(row, []).keys).toHaveLength(0);
    expect(willSave({ ...r2, cat: 'x' })).toBe(true);
    expect(willSave({ ...r2, cat: 'x', on: false })).toBe(false);
  });
});

describe('Zwei Verträge beim selben Empfänger (v1.59.4)', () => {
  const huk = () => parseStatement(['Buchungsdatum;Betrag;Zahlungsempfänger;Verwendungszweck',
    ...['08', '09', '10'].flatMap((m) => [`03.${m}.2026;-5,80;HUK-COBURG;Haftpflichtversicherung 123`, `03.${m}.2026;-12,40;HUK-COBURG;Reiseversicherung 456`])].join('\n'));

  it('erkennt Haftpflicht und Reiseversicherung als zwei Fixkosten mit eigenem Namen', async () => {
    const res = await huk();
    const found = detectRecurring(res.candidates);
    expect(found.map((f) => [f.name, f.amountCents, f.keys?.length]).sort()).toEqual([
      ['HUK-COBURG · Haftpflichtversicherung', 580, 3], ['HUK-COBURG · Reiseversicherung', 1240, 3]]);
  });

  it('eine vorhandene HUK-Vorlage fürs Auto gilt nicht als „schon vorhanden“ und wird nicht überschrieben', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, currentMonthKey());
    const d0 = await exportAll(db);
    const fixCat = d0.categories.find((c) => c.name === 'Versicherungen')!;
    const { saveRecurring } = await import('../src/db/repo');
    await saveRecurring(db, null, { name: 'HUK-COBURG', type: 'expense', categoryId: fixCat.id, startMonth: '2026-01', day: 1, active: true, amountCents: 4500 }, currentMonthKey());
    const d1 = await exportAll(db);
    const res = await huk();
    // nur die HUK-Vorlage betrachten (die Startdaten enthalten u. a. eine „Haftpflichtversicherung“)
    const rows = detectRecurring(res.candidates).map((f) => makeFixRow(f, res.candidates, d1.categories, d1.recurring.filter((r) => r.name === 'HUK-COBURG'), {}));
    expect(rows.every((r) => !r.old && r.on)).toBe(true);
    expect(await saveFixRows(db, rows)).toBe(2);
    const d2 = await exportAll(db);
    expect(d2.recurring.find((r) => r.name === 'HUK-COBURG')?.amountCents).toBe(4500);
    expect(d2.recurring.filter((r) => r.name.startsWith('HUK-COBURG'))).toHaveLength(3);
  });

  it('Bäcker mit wechselnden Beträgen wird nicht in „Verträge“ zerlegt', async () => {
    const res = await parseStatement(['Buchungsdatum;Betrag;Zahlungsempfänger',
      ...['08', '09', '10'].flatMap((m) => [`03.${m}.2026;-3,10;Bäckerei Huber`, `17.${m}.2026;-8,40;Bäckerei Huber`])].join('\n'));
    expect(detectRecurring(res.candidates)).toEqual([]);
  });
});
