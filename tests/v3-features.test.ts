import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { freshDb } from './helpers';
import { addDepotEntry, deleteDepotEntry } from '../src/data/depot';
import { addTransaction, deleteTransactions, restoreTransactions } from '../src/data/transactions';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { runRecurring, saveRecurring, saveSalary } from '../src/data/recurring';
import { yearlyShare } from '../src/domain/recurring';
import { DB_VERSION, openBudgetDb } from '../src/data/schema';
import { upgradeSchema } from '../src/data/migrations';
import type { BudgetDB } from '../src/data/schema';
import { createEncryptedBackup, openEncryptedBackup } from '../src/data/backup/backup';
import { encryptText } from '../src/data/backup/crypto';
import { todayISO } from '../src/domain/dates';
import { demoData } from './demo';

const FAST = 100_000;
const PW = 'correct horse battery';

async function seeded() {
  const db = await freshDb();
  await seedIfEmpty(db, demoData('2026-10'));
  const data = await exportAll(db);
  const cat = (name: string) => data.categories.find((c) => c.name === name)!;
  return { db, cat };
}

describe('Migration Schema 2 → 3', () => {
  it('übernimmt den Depotwert in den Verlauf, ergänzt Einstellungen und entfernt nur das Start-Bargeld-Budget', async () => {
    const name = `migrate3-${Date.now()}`;
    const old = await openDB<BudgetDB>(name, 2, { upgrade(db, o, _n, tx) { upgradeSchema(db, o, 2, tx); } });
    expect([...old.objectStoreNames]).not.toContain('depotEntries');
    const bar = { id: 'bar', name: 'Bargeld', kind: 'expense' as const, group: 'alltag' as const, parentId: null, archived: false, sort: 0, createdAt: 'x' };
    const leb = { ...bar, id: 'leb', name: 'Lebensmittel', sort: 1 };
    await old.put('categories', bar);
    await old.put('categories', leb);
    await old.put('budgets', { id: 'b1', scope: 'category', monthKey: 'default', categoryId: 'bar', amountCents: 10000 });
    await old.put('budgets', { id: 'b2', scope: 'category', monthKey: 'default', categoryId: 'leb', amountCents: 25000 });
    await old.put('budgets', { id: 'b3', scope: 'category', monthKey: '2026-10', categoryId: 'bar', amountCents: 5000 });
    await old.put('transactions', { id: 't1', date: '2026-10-01', type: 'expense', amountCents: 123, categoryId: 'leb', description: '', createdAt: 'x' });
    await old.put('settings', { key: 'app', value: { expectedIncomeCents: 285000, depotCents: 4_200_000, split: { fix: 40, alltag: 40, spar: 15 } } as never });
    await old.put('meta', { key: 'seeded', value: true });
    old.close();

    const db = await openBudgetDb(name);
    expect(db.version).toBe(DB_VERSION);
    const data = await exportAll(db);
    expect(data.depotEntries).toHaveLength(1);
    expect(data.depotEntries[0]).toMatchObject({ date: todayISO(), valueCents: 4_200_000 });
    expect(data.settings).toEqual({ expectedIncomeCents: 285000, split: { fix: 40, alltag: 40, spar: 15 }, savingsBalanceCents: 0, savingsBalanceDate: null, accountName: 'C24', backupReminderDays: 30 });
    expect(data.budgets.map((b) => b.id).sort()).toEqual(['b2', 'b3']);
    expect(data.transactions).toHaveLength(1);
  });
});

describe('Jährliche Fixkosten', () => {
  it('verteilt den Jahresbetrag auf 12 Monate, die Jahressumme stimmt auf den Cent', async () => {
    expect(Array.from({ length: 12 }, (_, i) => yearlyShare(5000, `2026-${String(i + 1).padStart(2, '0')}`)).reduce((a, b) => a + b, 0)).toBe(5000);
    expect(yearlyShare(5000, '2026-01')).toBe(417);
    expect(yearlyShare(5000, '2026-12')).toBe(416);
    const { db, cat } = await seeded();
    const r = await saveRecurring(db, null, { name: 'Kfz-Versicherung', type: 'expense', amountCents: 46_000, interval: 'yearly', categoryId: cat('Mobilität').id, startMonth: '2026-01', day: 1, active: true }, '2026-12');
    expect(r).toMatchObject({ interval: 'yearly', yearlyCents: 46_000, amountCents: 3833 });
    await runRecurring(db, '2026-12');
    const booked = (await exportAll(db)).transactions.filter((t) => t.recurringId === r.id);
    expect(booked).toHaveLength(12);
    expect(booked.reduce((a, t) => a + t.amountCents, 0)).toBe(46_000);
  });
});

describe('Gehalt, Depot, Löschen mit Rückgängig', () => {
  it('Gehalt ändert Vorlage und Basis der Aufteilung gemeinsam', async () => {
    const { db } = await seeded();
    await saveSalary(db, 350_000, 1, '2026-10');
    const d = await exportAll(db);
    expect(d.settings.expectedIncomeCents).toBe(350_000);
    expect(d.recurring.filter((r) => r.type === 'income')).toHaveLength(1);
    expect(d.recurring.find((r) => r.type === 'income')!.amountCents).toBe(350_000);
  });

  it('erfasst höchstens einen Depotstand pro Tag und kann ihn löschen', async () => {
    const { db } = await seeded();
    await addDepotEntry(db, '2026-10-01', 9_000_000);
    await addDepotEntry(db, '2026-10-28', 4_200_000);
    await addDepotEntry(db, '2026-10-28', 10_050_000);
    let d = await exportAll(db);
    expect(d.depotEntries.map((e) => [e.date, e.valueCents])).toEqual([['2026-10-01', 9_000_000], ['2026-10-28', 10_050_000]]);
    await deleteDepotEntry(db, d.depotEntries[0]!.id);
    d = await exportAll(db);
    expect(d.depotEntries).toHaveLength(1);
  });

  it('löscht mehrere Buchungen auf einmal und stellt sie unverändert wieder her', async () => {
    const { db, cat } = await seeded();
    const a = await addTransaction(db, { date: '2026-10-02', type: 'expense', amountCents: 100, categoryId: cat('Kantine').id, description: 'a' });
    const b = await addTransaction(db, { date: '2026-10-03', type: 'expense', amountCents: 200, categoryId: cat('Kantine').id, description: 'b' });
    const before = (await exportAll(db)).transactions;
    const removed = await deleteTransactions(db, [a.id, b.id, 'gibt-es-nicht']);
    expect(removed).toHaveLength(2);
    expect((await exportAll(db)).transactions).toHaveLength(before.length - 2);
    await restoreTransactions(db, removed);
    expect((await exportAll(db)).transactions.sort((x, y) => x.id.localeCompare(y.id))).toEqual(before.sort((x, y) => x.id.localeCompare(y.id)));
  });
});

describe('Backup mit Depot-Verlauf', () => {
  it('sichert den Depot-Verlauf mit und übernimmt den Einzelwert aus alten Backups (Schema 2)', async () => {
    const { db } = await seeded();
    await addDepotEntry(db, '2026-09-30', 9_500_000);
    const opened = await openEncryptedBackup((await createEncryptedBackup(db, PW, FAST)).text, PW);
    expect(opened.data.depotEntries).toEqual((await exportAll(db)).depotEntries);

    const legacy = { app: 'budget-pwa', schemaVersion: 2, exportedAt: '2026-09-15T10:00:00.000Z', data: {
      categories: [], transactions: [], budgets: [], recurring: [], recurringRuns: [],
      settings: { expectedIncomeCents: 1000, depotCents: 7_000_000, split: { fix: 40, alltag: 40, spar: 15 } }
    } };
    const env = await encryptText(JSON.stringify(legacy), PW, FAST);
    const old = await openEncryptedBackup(JSON.stringify(env), PW);
    expect(old.data.depotEntries).toMatchObject([{ date: '2026-09-15', valueCents: 7_000_000 }]);
    expect(old.data.settings.accountName).toBe('');
  });
});
