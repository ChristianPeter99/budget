import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { addCategory, deleteCategory, setCategoryArchived } from '../src/data/categories';
import { addTransaction, deleteTransaction, updateTransaction } from '../src/data/transactions';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { runRecurring, saveRecurring, deleteRecurring } from '../src/data/recurring';
import { setBudget } from '../src/data/budgets';
import { openBudgetDb } from '../src/data/schema';
import { budgetStatus, groupTargets, resolveBudget } from '../src/domain/budget';
import { expenseByGroup, filterTransactions, monthSeries, summarize, totalsByTopCategory } from '../src/domain/transactions';
import { AppError } from '../src/domain/types';
import { demoData } from './demo';

async function seeded() {
  const db = await freshDb();
  await seedIfEmpty(db, demoData('2026-10'));
  const data = await exportAll(db);
  const cat = (name: string, parent?: string) => data.categories.find((c) => c.name === name && (parent ? data.categories.find((p) => p.id === c.parentId)?.name === parent : true))!;
  return { db, data, cat };
}

describe('Buchungen speichern, ändern, löschen', () => {
  it('speichert Einnahmen und Ausgaben als ganzzahlige Cent und berechnet den Saldo', async () => {
    const { db, cat } = await seeded();
    await addTransaction(db, { date: '2026-10-05', type: 'income', amountCents: 250000, categoryId: cat('Sonstige Einnahmen').id, description: 'Bonus' });
    await addTransaction(db, { date: '2026-10-06', type: 'expense', amountCents: 1999, categoryId: cat('Kantine').id, description: '' });
    await addTransaction(db, { date: '2026-10-07', type: 'expense', amountCents: 1, categoryId: cat('Kantine').id, description: '' });
    const all = (await exportAll(db)).transactions.filter((t) => !t.recurringId);
    expect(all.every((t) => Number.isInteger(t.amountCents))).toBe(true);
    const s = summarize(all);
    expect(s).toEqual({ incomeCents: 250000, expenseCents: 2000, saldoCents: 248000 });
  });

  it('bearbeitet und löscht zuverlässig', async () => {
    const { db, cat } = await seeded();
    const t = await addTransaction(db, { date: '2026-10-06', type: 'expense', amountCents: 840, categoryId: cat('Kantine').id, description: 'Mittag' });
    const u = await updateTransaction(db, t.id, { date: '2026-10-07', type: 'expense', amountCents: 910, categoryId: cat('Bäcker').id, description: 'Frühstück' });
    expect(u.updatedAt).toBeTruthy();
    expect(u.createdAt).toBe(t.createdAt);
    expect((await exportAll(db)).transactions.find((x) => x.id === t.id)).toMatchObject({ amountCents: 910, date: '2026-10-07' });
    await deleteTransaction(db, t.id);
    expect((await exportAll(db)).transactions.find((x) => x.id === t.id)).toBeUndefined();
  });

  it('lehnt ungültige Eingaben ab, ohne etwas zu speichern', async () => {
    const { db, cat } = await seeded();
    const before = (await exportAll(db)).transactions.length;
    const base = { date: '2026-10-06', type: 'expense' as const, amountCents: 100, categoryId: cat('Kantine').id, description: '' };
    await expect(addTransaction(db, { ...base, amountCents: 0 })).rejects.toBeInstanceOf(AppError);
    await expect(addTransaction(db, { ...base, amountCents: -5 })).rejects.toBeInstanceOf(AppError);
    await expect(addTransaction(db, { ...base, amountCents: 1.5 })).rejects.toBeInstanceOf(AppError);
    await expect(addTransaction(db, { ...base, amountCents: Number.NaN })).rejects.toBeInstanceOf(AppError);
    await expect(addTransaction(db, { ...base, date: '2026-02-30' })).rejects.toBeInstanceOf(AppError);
    await expect(addTransaction(db, { ...base, categoryId: 'gibt-es-nicht' })).rejects.toBeInstanceOf(AppError);
    await expect(addTransaction(db, { ...base, type: 'income' })).rejects.toBeInstanceOf(AppError); // Kategorie ist eine Ausgabenkategorie
    expect((await exportAll(db)).transactions.length).toBe(before);
  });
});

describe('Monatsübersicht, Filter, Budgets', () => {
  it('berechnet Monats- und Kategorieauswertung korrekt, auch über Monatsgrenzen', async () => {
    const { db, data, cat } = await seeded();
    const add = (date: string, cents: number, c: string) => addTransaction(db, { date, type: 'expense', amountCents: cents, categoryId: cat(c).id, description: '' });
    await add('2026-09-30', 1000, 'Kantine');
    await add('2026-10-01', 2000, 'Kantine');
    await add('2026-10-31', 3000, 'Einkaufen');
    await add('2026-11-01', 4000, 'Einkaufen');
    const txs = (await exportAll(db)).transactions;
    const oct = filterTransactions(txs, data.categories, { from: '2026-10-01', to: '2026-10-31', type: 'expense' }).filter((t) => !t.recurringId);
    expect(oct.map((t) => t.amountCents).sort()).toEqual([2000, 3000]);
    const leb = cat('Lebensmittel').id;
    const byTop = totalsByTopCategory(oct, data.categories, 'expense');
    expect(byTop.get(leb)).toBe(5000);
    const series = monthSeries(txs.filter((t) => !t.recurringId), '2026-11', 3);
    expect(series.map((p) => [p.month, p.expenseCents])).toEqual([['2026-09', 1000], ['2026-10', 5000], ['2026-11', 4000]]);
    // Filter nach Hauptkategorie schließt Unterkategorien ein
    expect(filterTransactions(txs, data.categories, { categoryId: leb }).length).toBe(4);
  });

  it('vergleicht Ausgaben mit Kategorien- und Monatsbudgets (Monatswert überschreibt Standard)', async () => {
    const { db, cat } = await seeded();
    const bargeld = cat('Bargeld').id;
    await addTransaction(db, { date: '2026-10-10', type: 'expense', amountCents: 5000, categoryId: cat('Auszahlung').id, description: '' });
    let budgets = (await exportAll(db)).budgets;
    expect(resolveBudget(budgets, '2026-10', 'category', bargeld)).toBeNull(); // Startdaten enthalten keine Budgets
    await setBudget(db, { scope: 'category', monthKey: 'default', categoryId: bargeld, amountCents: 10000 });
    await setBudget(db, { scope: 'category', monthKey: '2026-10', categoryId: bargeld, amountCents: 4000 });
    await setBudget(db, { scope: 'month', monthKey: 'default', amountCents: 200000 });
    budgets = (await exportAll(db)).budgets;
    expect(resolveBudget(budgets, '2026-10', 'category', bargeld)).toBe(4000);
    expect(resolveBudget(budgets, '2026-11', 'category', bargeld)).toBe(10000);
    expect(resolveBudget(budgets, '2026-11', 'month')).toBe(200000);
    expect(budgetStatus(5000, 4000)).toMatchObject({ over: true, remainingCents: -1000 });
    expect(budgetStatus(2000, 4000)).toMatchObject({ over: false, remainingCents: 2000, ratio: 0.5 });
    // Budget ist nicht dasselbe wie Ausgabe: es ändert den Saldo nicht
    const before = summarize((await exportAll(db)).transactions).saldoCents;
    await setBudget(db, { scope: 'category', monthKey: 'default', categoryId: bargeld, amountCents: 99900 });
    expect(summarize((await exportAll(db)).transactions).saldoCents).toBe(before);
    await setBudget(db, { scope: 'category', monthKey: '2026-10', categoryId: bargeld, amountCents: null });
    expect(resolveBudget((await exportAll(db)).budgets, '2026-10', 'category', bargeld)).toBe(99900);
  });

  it('berechnet die Richtwerte der Aufteilung in ganzen Cent', async () => {
    const { data } = await seeded();
    const t = groupTargets(data.settings);
    expect(t).toEqual({ fix: 114000, alltag: 114000, spar: 42750, rest: 14250 });
  });
});

describe('Kategorien', () => {
  it('verhindert Duplikate, löscht nur Unbenutztes und archiviert Benutztes', async () => {
    const { db, cat } = await seeded();
    const sport = cat('Sport').id;
    const neu = await addCategory(db, { name: 'Haustier', kind: 'expense', group: 'alltag', parentId: null });
    await expect(addCategory(db, { name: 'haustier', kind: 'expense', group: 'alltag', parentId: null })).rejects.toBeInstanceOf(AppError);
    const kind = await addCategory(db, { name: 'Futter', kind: 'expense', group: 'alltag', parentId: neu.id });
    await expect(addCategory(db, { name: 'Zu tief', kind: 'expense', group: 'alltag', parentId: kind.id })).rejects.toBeInstanceOf(AppError);
    await addTransaction(db, { date: '2026-10-02', type: 'expense', amountCents: 1500, categoryId: kind.id, description: '' });
    await expect(deleteCategory(db, neu.id)).rejects.toBeInstanceOf(AppError); // wird verwendet
    await setCategoryArchived(db, neu.id, true);
    const data = await exportAll(db);
    expect(data.categories.find((c) => c.id === kind.id)?.archived).toBe(true); // Unterkategorie folgt
    expect(data.transactions.some((t) => t.categoryId === kind.id)).toBe(true); // Buchung bleibt zugeordnet
    await expect(addTransaction(db, { date: '2026-10-03', type: 'expense', amountCents: 100, categoryId: kind.id, description: '' })).rejects.toBeInstanceOf(AppError);
    await deleteCategory(db, sport); // ungenutzt → erlaubt
    expect((await exportAll(db)).categories.some((c) => c.id === sport)).toBe(false);
  });
});

describe('Wiederkehrende Buchungen', () => {
  it('erzeugt Buchungen idempotent und nicht erneut nach manuellem Löschen', async () => {
    const { db } = await seeded();
    const first = await runRecurring(db, '2026-10');
    expect(first).toBe(18); // Gehalt + 16 Fixkosten + Sparrate
    expect(await runRecurring(db, '2026-10')).toBe(0);
    const data = await exportAll(db);
    const g = summarize(data.transactions);
    expect(g.incomeCents).toBe(285000);
    expect(g.expenseCents).toBe(109712 + 30000); // Fixkosten 1.097,12 € + Sparrate 300 €
    expect(expenseByGroup(data.transactions, data.categories)).toEqual({ fix: 109712, alltag: 0, spar: 30000 });
    // einzelne erzeugte Buchung löschen → kommt nicht zurück
    const miete = data.transactions.find((t) => t.description === 'Miete')!;
    await deleteTransaction(db, miete.id);
    expect(await runRecurring(db, '2026-10')).toBe(0);
    // Folgemonat erzeugt wieder alle
    expect(await runRecurring(db, '2026-11')).toBe(18);
  });

  it('pausierte Vorlagen erzeugen nichts; Löschen der Vorlage behält Buchungen', async () => {
    const { db, data } = await seeded();
    const sp = data.recurring.find((r) => r.name === 'Musik-Abo')!;
    await saveRecurring(db, sp.id, { name: 'Musik-Abo', type: 'expense', amountCents: 1099, categoryId: sp.categoryId, startMonth: sp.startMonth, day: 1, active: false }, '2026-10');
    expect(await runRecurring(db, '2026-12')).toBe(3 * 17);
    await saveRecurring(db, sp.id, { name: 'Musik-Abo', type: 'expense', amountCents: 1099, categoryId: sp.categoryId, startMonth: sp.startMonth, day: 1, active: true }, '2026-12');
    expect(await runRecurring(db, '2026-12')).toBe(1); // nur Dezember, keine Nachbuchung der Pause
    await deleteRecurring(db, sp.id);
    const after = await exportAll(db);
    expect(after.recurring.some((r) => r.id === sp.id)).toBe(false);
    expect(after.transactions.filter((t) => t.description === 'Musik-Abo').every((t) => t.recurringId === undefined)).toBe(true);
    expect(after.transactions.filter((t) => t.description === 'Musik-Abo').length).toBe(1);
  });
});

describe('Neustart', () => {
  it('lädt gespeicherte Daten nach dem erneuten Öffnen der Datenbank', async () => {
    const name = `restart-${Date.now()}`;
    let db = await openBudgetDb(name);
    await seedIfEmpty(db, demoData('2026-10'));
    const cats = (await exportAll(db)).categories;
    await addTransaction(db, { date: '2026-10-09', type: 'expense', amountCents: 1234, categoryId: cats.find((c) => c.name === 'Kino')!.id, description: 'Film' });
    db.close();
    db = await openBudgetDb(name); // „App neu gestartet“
    expect(await seedIfEmpty(db, demoData('2026-10'))).toBe(false); // keine doppelten Startdaten
    const data = await exportAll(db);
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]).toMatchObject({ amountCents: 1234, description: 'Film', date: '2026-10-09' });
    expect(data.categories.length).toBeGreaterThan(20);
  });
});
