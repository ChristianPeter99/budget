// Budgets je Monat bzw. Kategorie.
import type { Db } from './schema';
import { isValidMonthKey } from '../domain/dates';
import { AppError } from '../domain/types';
import type { Budget } from '../domain/types';

/* ───────── Budgets ───────── */

export async function setBudget(db: Db, p: { scope: 'month' | 'category'; monthKey: string; categoryId?: string; amountCents: number | null }): Promise<void> {
  if (!(p.monthKey === 'default' || isValidMonthKey(p.monthKey))) throw new AppError('Ungültiger Monat.');
  const id = p.scope === 'month' ? `month:${p.monthKey}` : `cat:${p.categoryId}:${p.monthKey}`;
  // Auch ältere/fremde Datensätze mit gleichem Schlüssel entfernen, damit pro Budget genau ein Wert existiert.
  const dupes = (await db.getAll('budgets')).filter((b) => b.id !== id && b.scope === p.scope && b.monthKey === p.monthKey && b.categoryId === p.categoryId);
  for (const d of dupes) await db.delete('budgets', d.id);
  if (p.amountCents === null) { await db.delete('budgets', id); return; }
  if (!Number.isSafeInteger(p.amountCents) || p.amountCents < 0) throw new AppError('Bitte gib einen gültigen Betrag ein.');
  if (p.scope === 'category') {
    if (!p.categoryId || !(await db.get('categories', p.categoryId))) throw new AppError('Die Kategorie existiert nicht mehr.');
  }
  const b: Budget = { id, scope: p.scope, monthKey: p.monthKey, amountCents: p.amountCents };
  if (p.scope === 'category') b.categoryId = p.categoryId as string;
  await db.put('budgets', b);
}
