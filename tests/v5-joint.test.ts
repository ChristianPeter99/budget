import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { freshDb } from './helpers';
import { addTransaction, updateTransaction } from '../src/data/transactions';
import { disableJoint, ensureHouseholdCategories, saveJointSetup, setPartnerMonth } from '../src/data/joint';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { runRecurring } from '../src/data/recurring';
import { DB_VERSION, openBudgetDb } from '../src/data/schema';
import { upgradeSchema } from '../src/data/migrations';
import type { BudgetDB } from '../src/data/schema';
import { expenseByGroup, summarize } from '../src/domain/transactions';
import { jointMonth } from '../src/domain/joint';
import { validateBackupData } from '../src/domain/validate';
import { createEncryptedBackup, openEncryptedBackup } from '../src/data/backup/backup';
import { demoData } from './demo';

async function setup() {
  const db = await freshDb();
  await seedIfEmpty(db, demoData('2026-10'));
  await saveJointSetup(db, { name: 'Haushaltskonto', partnerName: 'Lena', myCents: 40_000, day: 1, partnerDefaultCents: 35_000 }, '2026-10');
  await runRecurring(db, '2026-10');
  await ensureHouseholdCategories(db);
  const d = await exportAll(db);
  const cat = (n: string) => d.categories.find((c) => c.name === n && !c.scope)!;
  const hcat = (n: string) => d.categories.find((c) => c.name === n && c.scope === 'joint')!;
  return { db, cat, hcat };
}
const split = (all: { account?: string }[]) => ({ own: all.filter((t) => !t.account), joint: all.filter((t) => t.account === 'joint') });

describe('Gemeinsames Konto', () => {
  it('bucht den eigenen Beitrag als Alltags-Ausgabe; gemeinsame Einkäufe zählen nicht im eigenen Budget', async () => {
    const { db, hcat } = await setup();
    const before = await exportAll(db);
    const ownBefore = split(before.transactions).own as typeof before.transactions;
    const beitrag = ownBefore.find((t) => t.categoryId === before.settings.joint!.categoryId)!;
    expect(beitrag).toMatchObject({ amountCents: 40_000, date: '2026-10-01' });
    expect(before.categories.find((c) => c.id === before.settings.joint!.categoryId)).toMatchObject({ name: 'Gemeinsames Konto', group: 'alltag' });
    const saldo = summarize(ownBefore).saldoCents;

    await addTransaction(db, { date: '2026-10-05', type: 'expense', amountCents: 8_550, categoryId: hcat('Einkaufen').id, description: 'Rewe', account: 'joint' });
    const after = await exportAll(db);
    const { own, joint } = split(after.transactions) as { own: typeof after.transactions; joint: typeof after.transactions };
    expect(summarize(own).saldoCents).toBe(saldo);
    expect(expenseByGroup(own, after.categories).alltag).toBe(40_000);
    expect(joint).toHaveLength(1);

    const m = jointMonth(own, joint, after.recurring, after.settings, '2026-10')!;
    expect(m).toEqual({ myCents: 40_000, partnerCents: 35_000, budgetCents: 75_000, spentCents: 8_550, leftCents: 66_450, carryCents: 0, availableCents: 66_450 });
  });

  it('unterstützt abweichende Beiträge der anderen Person je Monat', async () => {
    const { db } = await setup();
    await setPartnerMonth(db, '2026-10', 50_000);
    let d = await exportAll(db);
    let { own, joint } = split(d.transactions) as { own: typeof d.transactions; joint: typeof d.transactions };
    expect(jointMonth(own, joint, d.recurring, d.settings, '2026-10')!.partnerCents).toBe(50_000);
    expect(jointMonth(own, joint, d.recurring, d.settings, '2026-11')!.partnerCents).toBe(35_000);
    // November noch nicht gebucht → Betrag der Vorlage
    expect(jointMonth(own, joint, d.recurring, d.settings, '2026-11')!.myCents).toBe(40_000);
    await setPartnerMonth(db, '2026-10', null);
    d = await exportAll(db);
    ({ own, joint } = split(d.transactions) as { own: typeof d.transactions; joint: typeof d.transactions });
    expect(jointMonth(own, joint, d.recurring, d.settings, '2026-10')!.partnerCents).toBe(35_000);
  });

  it('ändern behält das Konto; nur Ausgaben dürfen gemeinsam sein; Ausschalten pausiert den Beitrag', async () => {
    const { db, cat, hcat } = await setup();
    const t = await addTransaction(db, { date: '2026-10-05', type: 'expense', amountCents: 100, categoryId: hcat('Drogerie').id, description: '', account: 'joint' });
    const u = await updateTransaction(db, t.id, { date: '2026-10-06', type: 'expense', amountCents: 200, categoryId: hcat('Drogerie').id, description: 'x', account: 'joint' });
    expect(u.account).toBe('joint');
    // Kategorie muss zum Konto passen
    await expect(updateTransaction(db, t.id, { date: '2026-10-06', type: 'expense', amountCents: 200, categoryId: hcat('Drogerie').id, description: 'x' })).rejects.toBeDefined();
    await expect(addTransaction(db, { date: '2026-10-05', type: 'expense', amountCents: 100, categoryId: cat('Bäcker').id, description: '', account: 'joint' })).rejects.toBeDefined();
    const v = await updateTransaction(db, t.id, { date: '2026-10-06', type: 'expense', amountCents: 200, categoryId: cat('Bäcker').id, description: 'x' });
    expect(v.account).toBeUndefined();
    await expect(addTransaction(db, { date: '2026-10-05', type: 'income', amountCents: 100, categoryId: cat('Gehalt').id, description: '', account: 'joint' })).rejects.toBeDefined();
    await disableJoint(db);
    const d = await exportAll(db);
    expect(d.settings.joint!.enabled).toBe(false);
    expect(d.recurring.find((r) => r.categoryId === d.settings.joint!.categoryId)!.active).toBe(false);
    // erneut einrichten nutzt dieselbe Kategorie und Vorlage
    await saveJointSetup(db, { name: 'Haushaltskonto', partnerName: '', myCents: 30_000, day: 1, partnerDefaultCents: 30_000 }, '2026-11');
    const e = await exportAll(db);
    expect(e.categories.filter((c) => c.name === 'Gemeinsames Konto')).toHaveLength(1);
    expect(e.recurring.filter((r) => r.categoryId === e.settings.joint!.categoryId)).toHaveLength(1);
  });

  it('übersteht Backup und Validierung; Schema 4 → 5 ohne Datenänderung', async () => {
    const { db, hcat } = await setup();
    await addTransaction(db, { date: '2026-10-05', type: 'expense', amountCents: 999, categoryId: hcat('Einkaufen').id, description: '', account: 'joint' });
    const opened = await openEncryptedBackup((await createEncryptedBackup(db, 'correct horse battery', 100_000)).text, 'correct horse battery');
    expect(opened.data).toEqual(await exportAll(db));
    const bad = structuredClone(opened.data);
    bad.settings.joint!.partnerByMonth = { '2026-13': 5 };
    expect(validateBackupData(bad).ok).toBe(false);

    const name = `migrate5-${Date.now()}`;
    const old = await openDB<BudgetDB>(name, 4, { upgrade(d, o, _n, tx) { upgradeSchema(d, o, 4, tx); } });
    await old.put('categories', { id: 'c', name: 'Lebensmittel', kind: 'expense', group: 'alltag', parentId: null, archived: false, sort: 0, createdAt: 'x' });
    await old.put('transactions', { id: 't', date: '2026-10-01', type: 'expense', amountCents: 5, categoryId: 'c', description: '', createdAt: 'x' });
    old.close();
    const nd = await openBudgetDb(name);
    expect(nd.version).toBe(DB_VERSION);
    expect((await exportAll(nd)).transactions[0]!.account).toBeUndefined();
  });
});
