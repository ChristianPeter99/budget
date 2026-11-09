import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { openBudgetDb } from '../src/data/schema';
import type { Db } from '../src/data/schema';
import { addDepotEntry } from '../src/data/depot';
import { addTransaction } from '../src/data/transactions';
import { ensureHouseholdCategories, saveJointSetup } from '../src/data/joint';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { runGoals, saveGoal } from '../src/data/goals';
import { runRecurring, saveRecurring } from '../src/data/recurring';
import { setBudget } from '../src/data/budgets';
import { createEncryptedBackup, openEncryptedBackup, restoreBackup } from '../src/data/backup/backup';
import { MIN_ITERATIONS } from '../src/data/backup/crypto';
import { demoData } from './demo';

/**
 * Datenkompatibilität mit v1.78.5: eine Datenbank und ein verschlüsseltes Backup, erzeugt mit v1.78.5, liegen als
 * Fixtures vor. Jede spätere Version muss beide unverändert lesen können (Daten bleiben gleich).
 * Neu erzeugen nur bewusst: COMPAT_UPDATE=1 npx vitest run compat
 */
const DB_FILE = 'tests/fixtures/db-v1.78.5.json';
const BACKUP_FILE = 'tests/fixtures/backup-v1.78.5.json';
const PASSWORD = 'test-passwort-1785';
const STORES = ['transactions', 'categories', 'budgets', 'settings', 'recurring', 'recurringRuns', 'depotEntries', 'meta'] as const;
type Dump = Record<(typeof STORES)[number], unknown[]>;

let n = 0;
const fresh = () => openBudgetDb(`compat-${Date.now()}-${n++}`);
async function dump(db: Db): Promise<Dump> {
  const out = {} as Dump;
  for (const s of STORES) out[s] = await db.getAll(s);
  return out;
}
const byId = <T,>(xs: T[]) => [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('Datenkompatibilität v1.78.5', () => {
  if (process.env.COMPAT_UPDATE === '1') {
    it('erzeugt Datenbank und Backup mit allen Datenarten', async () => {
      const db = await fresh();
      await seedIfEmpty(db, demoData('2026-09'));
      await saveJointSetup(db, { name: 'Haushaltskonto', partnerName: 'Alex', myCents: 40000, day: 1, partnerDefaultCents: 40000 }, '2026-09');
      await ensureHouseholdCategories(db);
      const cats = await db.getAll('categories');
      const hh = cats.find((c) => c.scope === 'joint' && c.kind === 'expense')!;
      const alltag = cats.find((c) => c.group === 'alltag' && c.parentId && !c.scope)!;
      const fixTop = cats.find((c) => c.group === 'fix' && !c.parentId)!;
      await addTransaction(db, { date: '2026-10-03', type: 'expense', amountCents: 2345, categoryId: alltag.id, description: 'REWE Markt' });
      await addTransaction(db, { date: '2026-10-04', type: 'expense', amountCents: 5678, categoryId: hh.id, description: 'Wocheneinkauf', account: 'joint' });
      await saveRecurring(db, null, { name: 'Kfz-Versicherung jährlich', type: 'expense', categoryId: fixTop.id, startMonth: '2026-01', day: 15, active: true, interval: 'yearly', amountCents: 48000, dueMonth: 3 }, '2026-09');
      await setBudget(db, { scope: 'category', monthKey: 'default', categoryId: alltag.parentId!, amountCents: 30000 });
      await setBudget(db, { scope: 'month', monthKey: '2026-10', amountCents: 150000 });
      await saveGoal(db, null, { name: 'Urlaub', targetCents: 200000, savedCents: 25000, dueMonth: '2027-06' });
      await addDepotEntry(db, '2026-08-31', 1234500);
      await runRecurring(db, '2026-11');
      await runGoals(db, '2026-11');
      writeFileSync(DB_FILE, JSON.stringify(await dump(db), null, 1));
      const b = await createEncryptedBackup(db, PASSWORD, MIN_ITERATIONS);
      writeFileSync(BACKUP_FILE, b.text);
    });
    return;
  }

  const raw = JSON.parse(readFileSync(DB_FILE, 'utf8')) as Dump;

  it('Fixture enthält alle Datenarten', () => {
    for (const s of STORES) expect(raw[s].length, s).toBeGreaterThan(0);
    const tx = raw.transactions as { account?: string; recurringId?: string; goalId?: string }[];
    expect(tx.some((t) => t.account === 'joint')).toBe(true);
    expect(tx.some((t) => t.recurringId)).toBe(true);
    expect(tx.some((t) => t.goalId)).toBe(true);
    expect((raw.recurring as { interval?: string }[]).some((r) => r.interval === 'yearly')).toBe(true);
  });

  it('Datenbank von v1.78.5 öffnet sich unverändert (Schema, alle Datensätze)', async () => {
    const db = await fresh();
    const tx = db.transaction([...STORES], 'readwrite');
    for (const s of STORES) for (const v of raw[s]) await tx.objectStore(s).put(v as never);
    await tx.done;
    db.close();
    // erneut öffnen wie beim App-Start: keine Migration darf etwas verändern
    const name = db.name;
    const again = await openBudgetDb(name);
    await ensureHouseholdCategories(again);
    const after = await dump(again);
    for (const s of STORES) expect(byId(after[s]), s).toEqual(byId(raw[s]));
  });

  it('Backup von v1.78.5: falsches Passwort ändert nichts, richtiges stellt alles wieder her', async () => {
    const text = readFileSync(BACKUP_FILE, 'utf8');
    await expect(openEncryptedBackup(text, 'falsch')).rejects.toThrow();
    const opened = await openEncryptedBackup(text, PASSWORD);
    const db = await fresh();
    await restoreBackup(db, opened);
    const data = await exportAll(db);
    const ref = raw as unknown as Record<string, unknown[]>;
    for (const k of ['transactions', 'categories', 'budgets', 'recurring', 'recurringRuns', 'depotEntries'] as const) expect(byId(data[k] as unknown[]), k).toEqual(byId(ref[k]!));
    expect(data.settings).toEqual((ref.settings![0] as { value: unknown }).value);
  });
});
