import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { freshDb } from './helpers';
import { exportAll, runRecurring, saveRecurring, seedIfEmpty } from '../src/db/repo';
import { DB_VERSION, openBudgetDb, upgradeSchema } from '../src/db/db';
import type { BudgetDB } from '../src/db/db';
import { nextDue } from '../src/domain/calc';
import { validateBackupData } from '../src/domain/validate';
import { createEncryptedBackup, openEncryptedBackup } from '../src/backup/backup';
import { encryptText } from '../src/backup/crypto';

const PW = 'correct horse battery';

describe('Fälligkeitsmonat jährlicher Kosten (Schema 4)', () => {
  it('speichert den Fälligkeitsmonat, bucht weiter anteilig und übersteht ein Backup', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, '2026-01');
    const cat = (await exportAll(db)).categories.find((c) => c.name === 'Mobilität')!;
    const r = await saveRecurring(db, null, { name: 'Kfz-Versicherung', type: 'expense', amountCents: 46_000, interval: 'yearly', dueMonth: 3, categoryId: cat.id, startMonth: '2026-01', day: 1, active: true }, '2026-12');
    expect(r).toMatchObject({ interval: 'yearly', yearlyCents: 46_000, dueMonth: 3 });
    await runRecurring(db, '2026-12');
    expect((await exportAll(db)).transactions.filter((t) => t.recurringId === r.id).reduce((a, t) => a + t.amountCents, 0)).toBe(46_000);
    const opened = await openEncryptedBackup((await createEncryptedBackup(db, PW, 100_000)).text, PW);
    expect(opened.data.recurring.find((x) => x.id === r.id)?.dueMonth).toBe(3);
    // ohne Fälligkeitsmonat speichern entfernt ihn wieder
    const r2 = await saveRecurring(db, r.id, { name: 'Kfz-Versicherung', type: 'expense', amountCents: 46_000, interval: 'yearly', dueMonth: null, categoryId: cat.id, startMonth: '2026-01', day: 1, active: true }, '2026-12');
    expect(r2.dueMonth).toBeUndefined();
  });

  it('lehnt ungültige Fälligkeitsmonate ab', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, '2026-01');
    const data = await exportAll(db);
    const cat = data.categories.find((c) => c.name === 'Mobilität')!;
    await expect(saveRecurring(db, null, { name: 'X', type: 'expense', amountCents: 1200, interval: 'yearly', dueMonth: 13, categoryId: cat.id, startMonth: '2026-01', day: 1, active: true }, '2026-01')).rejects.toBeDefined();
    const bad = structuredClone(data);
    bad.recurring[1]!.dueMonth = 4; // monatliche Vorlage darf keinen Fälligkeitsmonat haben
    expect(validateBackupData(bad).ok).toBe(false);
  });

  it('berechnet die nächste Fälligkeit über den Jahreswechsel', () => {
    const r = { interval: 'yearly', dueMonth: 3, active: true };
    expect(nextDue(r, '2026-10-28')).toEqual({ month: '2027-03', monthsAway: 5 });
    expect(nextDue(r, '2026-03-31')).toEqual({ month: '2026-03', monthsAway: 0 });
    expect(nextDue({ ...r, dueMonth: 11 }, '2026-10-28')).toEqual({ month: '2026-11', monthsAway: 1 });
    expect(nextDue({ ...r, active: false }, '2026-10-28')).toBeNull();
    expect(nextDue({ interval: 'monthly', active: true }, '2026-10-28')).toBeNull();
  });

  it('migriert Schema 3 → 4 ohne Datenänderung und liest Backups aus Schema 3', async () => {
    const name = `migrate4-${Date.now()}`;
    const old = await openDB<BudgetDB>(name, 3, { upgrade(db, o, _n, tx) { upgradeSchema(db, o, 3, tx); } });
    await old.put('categories', { id: 'c', name: 'Mobilität', kind: 'expense', group: 'fix', parentId: null, archived: false, sort: 0, createdAt: 'x' });
    await old.put('recurring', { id: 'r', name: 'Kfz', type: 'expense', amountCents: 3833, interval: 'yearly', yearlyCents: 46_000, categoryId: 'c', startMonth: '2026-01', day: 1, active: true, createdAt: 'x' });
    old.close();
    const db = await openBudgetDb(name);
    expect(db.version).toBe(DB_VERSION);
    expect((await exportAll(db)).recurring).toHaveLength(1);
    expect((await exportAll(db)).recurring[0]!.dueMonth).toBeUndefined();

    const legacy = { app: 'budget-pwa', schemaVersion: 3, exportedAt: '2026-10-01T10:00:00.000Z', data: await exportAll(db) };
    const env = await encryptText(JSON.stringify(legacy), PW, 100_000);
    const opened = await openEncryptedBackup(JSON.stringify(env), PW);
    expect(opened.data.recurring).toHaveLength(1);
  });
});

import { categorySeries, reserveStatus } from '../src/domain/calc';
import type { Recurring, Transaction } from '../src/domain/types';

describe('Rücklagen jährlicher Zahlungen', () => {
  const rec: Recurring = { id: 'r', name: 'Kfz', type: 'expense', amountCents: 3833, interval: 'yearly', yearlyCents: 46_000, dueMonth: 3, categoryId: 'c', startMonth: '2025-01', day: 1, active: true, createdAt: 'x' };
  const booked = (months: string[]): Transaction[] => months.map((m, i) => ({ id: 't' + i, date: `${m}-01`, type: 'expense', amountCents: 46_000 / 12 > 0 ? (Number(m.slice(5)) - 1 < 46_000 % 12 ? 3834 : 3833) : 0, categoryId: 'c', description: '', createdAt: 'x', recurringId: 'r' }));
  const allMonths = (from: string, to: string) => { const out: string[] = []; for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5)); `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? (y++, m = 1) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`); return out; };

  it('zählt gebuchte Anteile im laufenden Zyklus und rechnet bis zur Fälligkeit hoch', () => {
    const st = reserveStatus(rec, booked(allMonths('2025-01', '2026-10')), '2026-10-28')!;
    expect(st.due).toEqual({ month: '2027-03', monthsAway: 5 });
    // Zyklus April 2026 bis März 2027: 7 Monate gebucht (Apr–Okt), 5 kommen noch.
    // 46.000 Cent / 12 = 3.833 Rest 4 → Januar bis April je 1 Cent mehr.
    expect(st.savedCents).toBe(3834 + 6 * 3833);
    expect(st.expectedAtDueCents).toBe(46_000);
    expect(st.shortfallCents).toBe(0);
  });

  it('meldet eine Lücke, wenn die Vorlage erst mitten im Zyklus angelegt wurde', () => {
    const late = { ...rec, startMonth: '2026-10' };
    const st = reserveStatus(late, booked(['2026-10']), '2026-10-28')!;
    expect(st.savedCents).toBe(3833);
    expect(st.expectedAtDueCents).toBe(3 * 3833 + 3 * 3834); // Okt–Dez je 3.833, Jan–Mär je 3.834
    expect(st.shortfallCents).toBe(46_000 - 23_001);
  });

  it('ist im Fälligkeitsmonat voll angespart', () => {
    const st = reserveStatus(rec, booked(allMonths('2025-01', '2027-03')), '2027-03-02')!;
    expect(st.due.monthsAway).toBe(0);
    expect(st.savedCents).toBe(46_000);
  });
});

describe('Kategorie-Verlauf', () => {
  it('summiert eine Hauptkategorie mit Unterkategorien je Monat', () => {
    const cats = [
      { id: 'leb', name: 'Lebensmittel', kind: 'expense' as const, group: 'alltag' as const, parentId: null, archived: false, sort: 0, createdAt: 'x' },
      { id: 'kan', name: 'Kantine', kind: 'expense' as const, group: 'alltag' as const, parentId: 'leb', archived: false, sort: 1, createdAt: 'x' }
    ];
    const tx = (id: string, date: string, c: string, a: number): Transaction => ({ id, date, type: 'expense', amountCents: a, categoryId: c, description: '', createdAt: 'x' });
    const s = categorySeries([tx('1', '2026-09-03', 'kan', 500), tx('2', '2026-09-20', 'leb', 250), tx('3', '2026-10-01', 'kan', 100), tx('4', '2025-09-01', 'kan', 999)], cats, 'leb', '2026-10', 3);
    expect(s).toEqual([{ month: '2026-08', cents: 0 }, { month: '2026-09', cents: 750 }, { month: '2026-10', cents: 100 }]);
  });
});
