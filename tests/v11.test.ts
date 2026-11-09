import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { addSavingsEntry, deleteSavingsEntry, saveSettings } from '../src/data/settings';
import { ensureHouseholdCategories, saveJointSetup } from '../src/data/joint';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { importTransactions } from '../src/data/imports';
import { savingsEntries } from '../src/domain/savings';
import { validateBackupData } from '../src/domain/validate';
import { demoData } from './demo';

describe('Einstellungen speichern (Fehlerbehebung)', () => {
  it('funktioniert auch mit gemeinsamem Konto und gemerkten Import-Zuordnungen', async () => {
    const db = await freshDb(); await seedIfEmpty(db, demoData('2026-10'));
    await saveJointSetup(db, { name: 'Haushalt', partnerName: 'A', myCents: 30000, day: 1, partnerDefaultCents: 30000 }, '2026-10');
    const ek = (await exportAll(db)).categories.find((c) => c.name === 'Einkaufen')!.id;
    await importTransactions(db, [{ date: '2026-10-05', type: 'expense', amountCents: 100, categoryId: ek, description: 'x', importId: 'k1' }], { lidl: ek });
    const s = (await exportAll(db)).settings;
    await saveSettings(db, { ...s, accountName: 'Test' });
    expect((await exportAll(db)).settings.accountName).toBe('Test');
    await expect(saveSettings(db, { ...s, split: { fix: 60, alltag: 40, spar: 10 } })).rejects.toThrow('100 %');
  });
});

describe('Sparkonto-Stände', () => {
  it('erfasst Stände mit Datum, ersetzt am selben Tag, Löschen macht den vorherigen wieder aktuell', async () => {
    const db = await freshDb(); await seedIfEmpty(db, demoData('2026-10'));
    await addSavingsEntry(db, '2026-09-01', 500000);
    await addSavingsEntry(db, '2026-10-28', 520000);
    await addSavingsEntry(db, '2026-10-28', 521000);
    let s = (await exportAll(db)).settings;
    expect(savingsEntries(s)).toEqual([{ date: '2026-10-28', cents: 521000 }, { date: '2026-09-01', cents: 500000 }]);
    expect([s.savingsBalanceCents, s.savingsBalanceDate]).toEqual([521000, '2026-10-28']);
    expect(validateBackupData(await exportAll(db)).ok).toBe(true);
    await deleteSavingsEntry(db, '2026-10-28');
    s = (await exportAll(db)).settings;
    expect([s.savingsBalanceCents, s.savingsBalanceDate]).toEqual([500000, '2026-09-01']);
    await expect(addSavingsEntry(db, '2026-13-01', 1)).rejects.toBeDefined();
  });
  it('übernimmt den alten Einzelwert als ersten Eintrag', () => {
    expect(savingsEntries({ savingsBalanceCents: 1000, savingsBalanceDate: '2026-01-02' } as never)).toEqual([{ date: '2026-01-02', cents: 1000 }]);
  });
});

describe('Haushaltskonto mit eigener Kategorienliste', () => {
  it('hängt alte Haushaltsbuchungen in gleichnamige Haushaltskategorien um, legt Startkategorien an, ist idempotent', async () => {
    const { addTransaction: _a } = await import('../src/data/transactions');
    const { mergeCategory, addCategory } = await import('../src/data/categories');
    const db = await freshDb(); await seedIfEmpty(db, demoData('2026-10'));
    await saveJointSetup(db, { name: 'Haushalt', partnerName: '', myCents: 30000, day: 1, partnerDefaultCents: 30000 }, '2026-10');
    const own = (await exportAll(db)).categories;
    const kino = own.find((c) => c.name === 'Kino')!;
    // Altbestand simulieren: Haushaltsbuchung mit Kategorie des eigenen Kontos (wie vor Version 1.12)
    await db.put('transactions', { id: 'old1', date: '2026-10-02', type: 'expense', amountCents: 1200, categoryId: kino.id, description: 'Film', createdAt: 'x', account: 'joint' });
    expect(await ensureHouseholdCategories(db)).toBe(1);
    expect(await ensureHouseholdCategories(db)).toBe(0);
    const d = await exportAll(db);
    const h = d.categories.filter((c) => c.scope === 'joint');
    const t = d.transactions.find((x) => x.id === 'old1')!;
    const tc = h.find((c) => c.id === t.categoryId)!;
    expect(tc.name).toBe('Kino');
    expect(h.find((c) => c.id === tc.parentId)!.name).toBe('Freizeit');
    expect(h.some((c) => c.name === 'Einkaufen')).toBe(false); // Startliste nur, wenn noch gar keine Haushaltskategorie existiert
    expect(d.categories.find((c) => c.id === kino.id)).toBeDefined(); // eigene Kategorie bleibt
    expect(validateBackupData(d).ok).toBe(true);
    // neue Haushaltskategorie, Mischen mit eigener Liste verboten
    const hk = await addCategory(db, { name: 'Haustier', kind: 'expense', group: 'fix', parentId: null, scope: 'joint' });
    expect(hk).toMatchObject({ scope: 'joint', group: 'alltag' });
    const sub = await addCategory(db, { name: 'Futter', kind: 'expense', group: 'alltag', parentId: hk.id });
    expect(sub.scope).toBe('joint');
    await expect(mergeCategory(db, tc.id, kino.id)).rejects.toBeDefined();
    const bad = structuredClone(d); bad.categories.push({ ...own.find((c) => c.name === 'Einkaufen')!, id: 'z', parentId: h[0]!.id });
    expect(validateBackupData(bad).ok).toBe(false);
  });
  it('legt bei neu eingerichtetem Haushaltskonto Startkategorien an', async () => {
    const db = await freshDb(); await seedIfEmpty(db, demoData('2026-10'));
    await saveJointSetup(db, { name: 'Haushalt', partnerName: '', myCents: 30000, day: 1, partnerDefaultCents: 30000 }, '2026-10');
    await ensureHouseholdCategories(db);
    const h = (await exportAll(db)).categories.filter((c) => c.scope === 'joint').map((c) => c.name);
    expect(h).toEqual(expect.arrayContaining(['Lebensmittel', 'Einkaufen', 'Haushalt', 'Drogerie']));
  });
});

describe('Letzter Eintrag (Übersicht)', () => {
  it('zeigt heute/gestern mit Uhrzeit, ältere Einträge kurz mit Wochentag bzw. Jahr', async () => {
    const { lastEntryLabel } = await import('../src/domain/transactions');
    const mk = (d: Date) => [{ createdAt: d.toISOString() }] as never;
    const now = new Date();
    expect(lastEntryLabel(mk(now))).toMatch(/^Heute, \d\d:\d\d$/);
    const old = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14, 12);
    const label = lastEntryLabel(mk(old))!;
    if (old.getFullYear() === now.getFullYear()) expect(label).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa|So), \d{1,2}\.\d{1,2}\.$/);
    expect(lastEntryLabel(mk(new Date(now.getFullYear() - 1, 9, 8, 12)))).toBe(`8.10.${String(now.getFullYear() - 1).slice(2)}`);
  });
});
