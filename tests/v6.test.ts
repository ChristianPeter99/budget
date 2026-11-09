import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { addTransaction } from '../src/data/transactions';
import { ensureHouseholdCategories, resetJointCarry, saveJointSetup } from '../src/data/joint';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { mergeCategory, setCategoryGroup, setCategoryOrder, setCategoryParent } from '../src/data/categories';
import { runRecurring, saveRecurring } from '../src/data/recurring';
import { setBudget } from '../src/data/budgets';
import { jointMonth } from '../src/domain/joint';
import { validateBackupData } from '../src/domain/validate';
import { demoData } from './demo';

async function seeded() {
  const db = await freshDb();
  await seedIfEmpty(db, demoData('2026-10'));
  const get = async () => exportAll(db);
  const cat = async (n: string) => (await get()).categories.find((c) => c.name === n)!;
  return { db, get, cat };
}

describe('Kategorien verwalten', () => {
  it('ändert die Reihenfolge innerhalb einer Ebene', async () => {
    const { db, get, cat } = await seeded();
    const order = async () => (await get()).categories.filter((c) => c.parentId === null && c.group === 'alltag').sort((a, b) => a.sort - b.sort).map((c) => c.name);
    const before = await order();
    // Ziehen in der Liste speichert die neue Reihenfolge der sichtbaren Kategorien
    const ids = await Promise.all([before[1]!, before[0]!, ...before.slice(2)].map(async (n) => (await cat(n)).id));
    await setCategoryOrder(db, ids);
    const after = await order();
    expect(after.slice(0, 2)).toEqual([before[1], before[0]]);
    expect(after.slice(2)).toEqual(before.slice(2));
  });

  it('verschiebt eine Unterkategorie samt Buchungen in eine andere Gruppe', async () => {
    const { db, get, cat } = await seeded();
    const kantine = await cat('Kantine');
    await addTransaction(db, { date: '2026-10-02', type: 'expense', amountCents: 500, categoryId: kantine.id, description: '' });
    await setCategoryParent(db, kantine.id, (await cat('Freizeit')).id);
    const d = await get();
    const k = d.categories.find((c) => c.id === kantine.id)!;
    expect(k.parentId).toBe((await cat('Freizeit')).id);
    expect(d.transactions.find((t) => t.categoryId === kantine.id)).toBeDefined();
    // zur Hauptkategorie machen
    await setCategoryParent(db, kantine.id, null);
    expect((await cat('Kantine')).parentId).toBeNull();
    // Hauptkategorie mit Unterkategorien lässt sich nicht unterordnen
    await expect(setCategoryParent(db, (await cat('Lebensmittel')).id, (await cat('Auto')).id)).rejects.toBeDefined();
    // Einnahmen und Ausgaben nicht mischen
    await expect(setCategoryParent(db, kantine.id, (await cat('Gehalt')).id)).rejects.toBeDefined();
    expect(validateBackupData(await get()).ok).toBe(true);
  });

  it('wechselt die Gruppe einer Hauptkategorie mit allen Unterkategorien', async () => {
    const { db, get, cat } = await seeded();
    await setCategoryGroup(db, (await cat('Bargeld')).id, 'fix');
    const d = await get();
    expect(d.categories.filter((c) => c.name === 'Bargeld' || c.name === 'Auszahlung').map((c) => c.group)).toEqual(['fix', 'fix']);
    await expect(setCategoryGroup(db, (await cat('Auszahlung')).id, 'alltag')).rejects.toBeDefined();
  });

  it('führt zusammen: Buchungen, Vorlagen und Budgets wandern mit, Quelle ist weg', async () => {
    const { db, get, cat } = await seeded();
    const baecker = await cat('Bäcker'), einkaufen = await cat('Einkaufen');
    await addTransaction(db, { date: '2026-10-02', type: 'expense', amountCents: 300, categoryId: baecker.id, description: 'Brezen' });
    await saveRecurring(db, null, { name: 'Brot-Abo', type: 'expense', amountCents: 1000, categoryId: baecker.id, startMonth: '2026-10', day: 5, active: true }, '2026-10');
    const n = await mergeCategory(db, baecker.id, einkaufen.id);
    expect(n).toBe(1);
    const d = await get();
    expect(d.categories.find((c) => c.id === baecker.id)).toBeUndefined();
    expect(d.transactions.filter((t) => t.categoryId === einkaufen.id)).toHaveLength(1);
    expect(d.recurring.find((r) => r.name === 'Brot-Abo')!.categoryId).toBe(einkaufen.id);
    expect(validateBackupData(d).ok).toBe(true);
    // Hauptkategorie mit Budget in andere Hauptkategorie ohne Unterkategorien
    const bek = await cat('Bekleidung');
    await setBudget(db, { scope: 'category', monthKey: 'default', categoryId: (await cat('Sonstiges')).id, amountCents: 5000 });
    await expect(mergeCategory(db, bek.id, (await cat('Sonstiges')).id)).rejects.toBeDefined(); // Quelle hat Unterkategorien
  });

  it('schützt die Kategorie des gemeinsamen Kontos', async () => {
    const { db, get } = await seeded();
    await saveJointSetup(db, { name: 'Haushaltskonto', partnerName: '', myCents: 40_000, day: 1, partnerDefaultCents: 30_000 }, '2026-10');
    const jc = (await get()).settings.joint!.categoryId!;
    await expect(setCategoryGroup(db, jc, 'fix')).rejects.toBeDefined();
    await expect(setCategoryParent(db, jc, (await get()).categories.find((c) => c.name === 'Auto')!.id)).rejects.toBeDefined();
    await expect(mergeCategory(db, jc, (await get()).categories.find((c) => c.name === 'Kino')!.id)).rejects.toBeDefined();
  });
});

describe('Übertrag gemeinsames Konto', () => {
  it('überträgt den Rest in den Folgemonat und lässt sich neu starten', async () => {
    const { db, get } = await seeded();
    await saveJointSetup(db, { name: 'Haushaltskonto', partnerName: 'Lena', myCents: 40_000, day: 1, partnerDefaultCents: 35_000 }, '2026-10');
    await runRecurring(db, '2026-11');
    await ensureHouseholdCategories(db);
    const ek = (await get()).categories.find((c) => c.name === 'Einkaufen' && c.scope === 'joint')!.id;
    await addTransaction(db, { date: '2026-10-10', type: 'expense', amountCents: 60_000, categoryId: ek, description: '', account: 'joint' });
    await addTransaction(db, { date: '2026-11-10', type: 'expense', amountCents: 10_000, categoryId: ek, description: '', account: 'joint' });
    const j = async (m: string) => { const d = await get(); return jointMonth(d.transactions.filter((t) => !t.account), d.transactions.filter((t) => t.account === 'joint'), d.recurring, d.settings, m)!; };
    expect((await j('2026-10')).availableCents).toBe(15_000);
    const nov = await j('2026-11');
    expect(nov.carryCents).toBe(15_000);
    expect(nov.availableCents).toBe(15_000 + 75_000 - 10_000);
    await resetJointCarry(db, '2026-11');
    expect((await j('2026-11')).carryCents).toBe(0);
  });
});
