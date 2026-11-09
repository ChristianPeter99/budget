import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { addCategory } from '../src/data/categories';
import { addDepotEntry } from '../src/data/depot';
import { exportAll, seedIfEmpty, wipeAll } from '../src/data/dataset';
import { getMeta, setMeta } from '../src/data/meta';
import { saveGoal } from '../src/data/goals';
import { currentMonthKey, shiftMonth } from '../src/domain/dates';
import { validateBackupData } from '../src/domain/validate';
import { demoData } from './demo';

describe('Alle Daten löschen (v1.55)', () => {
  it('setzt alles auf 0, lässt Standard-Kategorien und sichert den alten Stand', async () => {
    const db = await freshDb();
    const m = currentMonthKey();
    await seedIfEmpty(db, demoData(m));
    await addCategory(db, { name: 'Eigene', kind: 'expense', group: 'alltag', parentId: null });
    await addDepotEntry(db, `${m}-01`, 1234500);
    await saveGoal(db, null, { name: 'Urlaub', targetCents: 100000, savedCents: 0, dueMonth: shiftMonth(m, 4) });
    await setMeta(db, 'lastImport', { ids: ['x'], at: new Date().toISOString(), count: 1 });
    const before = await exportAll(db);
    expect(before.recurring.length).toBeGreaterThan(0);

    await wipeAll(db);
    const d = await exportAll(db);
    expect(validateBackupData(d).ok).toBe(true);
    expect(d.transactions).toHaveLength(0);
    expect(d.recurring).toHaveLength(0);
    expect(d.recurringRuns).toHaveLength(0);
    expect(d.budgets).toHaveLength(0);
    expect(d.depotEntries).toHaveLength(0);
    expect(d.settings.expectedIncomeCents).toBe(0);
    expect(d.settings.savingsBalanceCents).toBe(0);
    expect(d.settings.savingsGoals ?? []).toHaveLength(0);
    expect(d.settings.joint?.enabled ?? false).toBe(false);
    const names = d.categories.filter((c) => c.parentId === null).map((c) => `${c.group}:${c.name}`);
    expect(names).toEqual(expect.arrayContaining(['fix:Wohnen', 'fix:Mobilität', 'fix:Versicherungen', 'fix:Abos & Verträge', 'alltag:Lebensmittel', 'spar:Sparen', 'einnahme:Gehalt']));
    expect(names).not.toContain('alltag:Eigene');
    expect(await getMeta(db, 'lastImport')).toBeUndefined();
    // keine Kopie des vorherigen Stands mehr (Funktion entfallen)
    expect(await getMeta(db, 'preImportSnapshot')).toBeUndefined();
  });
});
