import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { deleteGoal, exportAll, getSettings, restoreGoal, saveGoal, saveRecurring, seedIfEmpty } from '../src/db/repo';
import { goalPlan } from '../src/domain/calc';
import { validateBackupData } from '../src/domain/validate';

describe('Sparziele (v1.35)', () => {
  it('rechnet die nötige Monatsrate inkl. aktuellem und Zielmonat', () => {
    expect(goalPlan({ targetCents: 150000, savedCents: 40000, dueMonth: '2027-05' }, '2026-11')).toMatchObject({ remainingCents: 110000, monthsLeft: 7, perMonthCents: 15715, done: false, overdue: false });
    expect(goalPlan({ targetCents: 1000, savedCents: 1000, dueMonth: '2026-01' }, '2026-11')).toMatchObject({ done: true, overdue: false, perMonthCents: 0 });
    expect(goalPlan({ targetCents: 1000, savedCents: 0, dueMonth: '2026-10' }, '2026-11')).toMatchObject({ overdue: true, perMonthCents: 1000 });
  });
  it('speichert, ändert, löscht und stellt wieder her; übersteht Backup-Prüfung', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, '2026-11');
    const g = await saveGoal(db, null, { name: ' Urlaub ', targetCents: 150000, savedCents: 0, dueMonth: '2027-06' });
    await saveGoal(db, g.id, { name: 'Urlaub', targetCents: 150000, savedCents: 20000, dueMonth: '2027-06' });
    let s = await getSettings(db);
    expect(s.savingsGoals).toHaveLength(1);
    expect(s.savingsGoals![0]).toMatchObject({ name: 'Urlaub', savedCents: 20000 });
    const check = validateBackupData(await exportAll(db));
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.data.settings.savingsGoals).toHaveLength(1);
    const removed = await deleteGoal(db, g.id);
    expect((await getSettings(db)).savingsGoals).toHaveLength(0);
    await restoreGoal(db, removed!);
    s = await getSettings(db);
    expect(s.savingsGoals).toHaveLength(1);
    await expect(saveGoal(db, null, { name: 'X', targetCents: 0, savedCents: 0, dueMonth: '2027-01' })).rejects.toThrow();
  });
});

describe('Kündigungsfrist (v1.35)', () => {
  it('ist optional, wird gespeichert, geleert und im Backup geprüft', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, '2026-11');
    const cat = (await db.getAll('categories')).find((c) => c.group === 'fix' && c.parentId === null)!;
    const base = { name: 'Handy', type: 'expense' as const, amountCents: 1500, categoryId: cat.id, startMonth: '2026-11', day: 1, active: true };
    const r = await saveRecurring(db, null, { ...base, notice: ' 3 Monate zum Laufzeitende ' }, '2026-11');
    expect(r.notice).toBe('3 Monate zum Laufzeitende');
    const check = validateBackupData(await exportAll(db));
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.data.recurring.find((x) => x.id === r.id)?.notice).toBe('3 Monate zum Laufzeitende');
    // ohne Angabe bleibt sie erhalten, leer entfernt sie
    expect((await saveRecurring(db, r.id, base, '2026-11')).notice).toBe('3 Monate zum Laufzeitende');
    expect((await saveRecurring(db, r.id, { ...base, notice: '' }, '2026-11')).notice).toBeUndefined();
  });
});

import { amountQuery } from '../src/domain/calc';
describe('Suche nach Betrag (v1.37)', () => {
  it('erkennt Beträge in deutscher und englischer Schreibweise', () => {
    expect(amountQuery('12,50')).toEqual({ cents: 1250, exact: true });
    expect(amountQuery('12.5 €')).toEqual({ cents: 1250, exact: true });
    expect(amountQuery('12')).toEqual({ cents: 1200, exact: false });
    expect(amountQuery('1.250')).toEqual({ cents: 125000, exact: false });
    expect(amountQuery('1.250,00')).toEqual({ cents: 125000, exact: true });
    expect(amountQuery('Rewe')).toBeNull();
    expect(amountQuery('12,505')).toBeNull();
  });
});
