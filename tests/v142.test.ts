import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { getSettings } from '../src/data/settings';
import { runGoals, saveGoal } from '../src/data/goals';
import { goalMonthly, goalSaved } from '../src/domain/goals';
import { currentMonthKey, shiftMonth } from '../src/domain/dates';
import { validateBackupData } from '../src/domain/validate';
import type { Transaction } from '../src/domain/types';
import { demoData } from './demo';

const goalTxs = async (db: Awaited<ReturnType<typeof freshDb>>) => ((await db.getAll('transactions')) as Transaction[]).filter((t) => t.goalId);

describe('Sparziel on top (v1.42)', () => {
  it('bucht ab dem aktuellen Monat jeden Monat einmal den nötigen Betrag als Sparen', async () => {
    const db = await freshDb();
    const m0 = currentMonthKey();
    await seedIfEmpty(db, demoData(m0));
    const g = await saveGoal(db, null, { name: 'Urlaub', targetCents: 120000, savedCents: 0, dueMonth: shiftMonth(m0, 5) });
    expect(await runGoals(db, m0)).toBe(1);
    expect(await runGoals(db, m0)).toBe(0); // nicht doppelt
    let txs = await goalTxs(db);
    expect(txs).toHaveLength(1);
    const cats = await db.getAll('categories');
    expect(cats.find((c) => c.id === txs[0]!.categoryId)?.group).toBe('spar');
    expect(txs[0]).toMatchObject({ type: 'expense', amountCents: 20000, description: 'Sparziel: Urlaub', goalId: g.id });
    expect(txs[0]!.date.slice(0, 7)).toBe(m0);
    // zwei Monate später: holt den Monat dazwischen nach, Rate neu berechnet (aufgerundet auf volle Euro)
    expect(await runGoals(db, shiftMonth(m0, 2))).toBe(2);
    txs = await goalTxs(db);
    expect(txs.map((t) => t.amountCents)).toEqual([20000, 20000, 20000]);
    expect(goalSaved(g, txs)).toBe(60000);
    // bis zum Zielmonat und nicht darüber hinaus
    await runGoals(db, shiftMonth(m0, 10));
    txs = await goalTxs(db);
    expect(goalSaved(g, txs)).toBe(120000);
    expect(txs).toHaveLength(6);
  });

  it('rechnet mit eigenem Betrag, rundet auf und stoppt bei erreichtem Ziel', async () => {
    const db = await freshDb();
    const m0 = currentMonthKey();
    await seedIfEmpty(db, demoData(m0));
    const g = await saveGoal(db, null, { name: 'Rad', targetCents: 100000, savedCents: 40000, dueMonth: shiftMonth(m0, 6) });
    await runGoals(db, m0);
    const txs = await goalTxs(db);
    expect(txs[0]!.amountCents).toBe(8600); // 600 € / 7 Monate = 85,71 → 86 €
    expect(goalMonthly(g, txs, m0)).toBe(8600);
    await saveGoal(db, g.id, { name: 'Rad', targetCents: 100000, savedCents: 100000 - 8600, dueMonth: shiftMonth(m0, 6) });
    expect(await runGoals(db, shiftMonth(m0, 1))).toBe(0);
  });

  it('bucht nichts bei „Automatisch ansparen“ aus, nichts rückwirkend und eine gelöschte Buchung nicht erneut', async () => {
    const db = await freshDb();
    const m0 = currentMonthKey();
    await seedIfEmpty(db, demoData(m0));
    await saveGoal(db, null, { name: 'Aus', targetCents: 50000, savedCents: 0, dueMonth: shiftMonth(m0, 3), auto: false });
    expect(await runGoals(db, shiftMonth(m0, 1))).toBe(0);
    const g = await saveGoal(db, null, { name: 'Neu', targetCents: 50000, savedCents: 0, dueMonth: shiftMonth(m0, 3) });
    await runGoals(db, m0);
    const [t] = await goalTxs(db);
    expect(t!.date.slice(0, 7)).toBe(m0); // nicht vor dem Anlegemonat
    await db.delete('transactions', t!.id);
    expect(await runGoals(db, m0)).toBe(0);
    // Backup mit goalId und Ziel-Zustand bleibt gültig
    await runGoals(db, shiftMonth(m0, 1));
    const check = validateBackupData(await exportAll(db));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.data.transactions.some((x) => x.goalId === g.id)).toBe(true);
      expect(check.data.settings.savingsGoals?.find((x) => x.id === g.id)).toMatchObject({ auto: true, lastBookedMonth: shiftMonth(m0, 1) });
    }
    expect((await getSettings(db)).savingsGoals?.find((x) => x.name === 'Aus')?.auto).toBe(false);
  });
});
