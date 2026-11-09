// Buchungen filtern, sortieren, suchen und summieren.
import type { Category, Transaction, TxType } from './types';
import { categoryFamily, categoryName, groupOfCategory } from './categories';
import { dayLabel, monthKeyOf, shiftMonth, todayISO } from './dates';

export interface Summary { incomeCents: number; expenseCents: number; saldoCents: number }

/** Saldo = Einnahmen − Ausgaben, immer aus den gespeicherten Buchungen berechnet. */
export function summarize(txs: Transaction[]): Summary {
  let income = 0, expense = 0;
  for (const t of txs) {
    if (t.type === 'income') income += t.amountCents; else expense += t.amountCents;
  }
  return { incomeCents: income, expenseCents: expense, saldoCents: income - expense };
}

export interface TxFilter {
  from?: string; to?: string; type?: TxType; categoryId?: string; q?: string;
}

/**
 * Suchtext als Betrag deuten: „12,50“, „12.50“, „12,5 €“ → genau dieser Betrag; „12“ → alle Beträge von 12,00 bis 12,99;
 * „1.250“ / „1.250,00“ → Tausenderpunkt. Kein Betrag → null.
 */
export function amountQuery(q: string): { cents: number; exact: boolean } | null {
  const s = q.replace(/€/g, '').replace(/\s/g, '');
  let m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) m = /^(\d+)\.(\d{1,2})$/.exec(s);
  if (!m) return null;
  const euros = Number((m[1] as string).replace(/\./g, ''));
  if (!Number.isSafeInteger(euros)) return null;
  if (m[2] === undefined) return { cents: euros * 100, exact: false };
  return { cents: euros * 100 + Number((m[2] as string).padEnd(2, '0')), exact: true };
}

export function filterTransactions(txs: Transaction[], cats: Category[], f: TxFilter): Transaction[] {
  const fam = f.categoryId ? categoryFamily(cats, f.categoryId) : null;
  const q = f.q?.trim().toLowerCase();
  // Namen einmal vorberechnen statt je Buchung zu suchen (wichtig bei vielen Buchungen).
  const names = q ? new Map(cats.map((c) => [c.id, categoryName(cats, c.id).toLowerCase()])) : null;
  // Sieht der Suchtext wie ein Betrag aus, passen auch Buchungen mit genau diesem Betrag (bzw. diesem Euro-Betrag)
  const amt = q ? amountQuery(q) : null;
  const amtHit = (c: number) => !!amt && (amt.exact ? c === amt.cents : Math.floor(c / 100) * 100 === amt.cents);
  return txs.filter((t) => {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.type && t.type !== f.type) return false;
    if (fam && !fam.has(t.categoryId)) return false;
    if (q && !(t.description.toLowerCase().includes(q) || (names?.get(t.categoryId) ?? '').includes(q) || amtHit(t.amountCents))) return false;
    return true;
  });
}

export function sortTransactions(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
}

/** Summe je Hauptkategorie (Unterkategorien eingerechnet) für Ausgaben bzw. Einnahmen. */
export function totalsByTopCategory(txs: Transaction[], cats: Category[], type: TxType): Map<string, number> {
  const res = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== type) continue;
    const c = cats.find((x) => x.id === t.categoryId);
    const top = c?.parentId ?? c?.id ?? t.categoryId;
    res.set(top, (res.get(top) ?? 0) + t.amountCents);
  }
  return res;
}
/** Summe je Kategorie genau wie gebucht (ohne Rollup) */
export function totalsByCategory(txs: Transaction[], type: TxType): Map<string, number> {
  const res = new Map<string, number>();
  for (const t of txs) if (t.type === type) res.set(t.categoryId, (res.get(t.categoryId) ?? 0) + t.amountCents);
  return res;
}

export function expenseByGroup(txs: Transaction[], cats: Category[]): Record<'fix' | 'alltag' | 'spar', number> {
  const out = { fix: 0, alltag: 0, spar: 0 };
  for (const t of txs) {
    if (t.type !== 'expense') continue;
    const g = groupOfCategory(cats, t.categoryId);
    if (g === 'fix' || g === 'alltag' || g === 'spar') out[g] += t.amountCents;
  }
  return out;
}

export interface MonthPoint { month: string; incomeCents: number; expenseCents: number }
/** Die letzten n Monate bis einschließlich endMonth (älteste zuerst). */
export function monthSeries(txs: Transaction[], endMonth: string, n = 12): MonthPoint[] {
  const months = Array.from({ length: n }, (_, i) => shiftMonth(endMonth, i - (n - 1)));
  const map = new Map(months.map((m) => [m, { month: m, incomeCents: 0, expenseCents: 0 }]));
  for (const t of txs) {
    const p = map.get(monthKeyOf(t.date));
    if (!p) continue;
    if (t.type === 'income') p.incomeCents += t.amountCents; else p.expenseCents += t.amountCents;
  }
  return months.map((m) => map.get(m)!);
}

/** Summe einer Kategorie (inkl. Unterkategorien) je Monat, die letzten n Monate bis endMonth. */
export function categorySeries(txs: Transaction[], cats: Category[], categoryId: string, endMonth: string, n = 12, type: TxType = 'expense'): { month: string; cents: number }[] {
  const fam = categoryFamily(cats, categoryId);
  const months = Array.from({ length: n }, (_, i) => shiftMonth(endMonth, i - (n - 1)));
  const map = new Map(months.map((m) => [m, 0]));
  for (const t of txs) {
    if (t.type !== type || !fam.has(t.categoryId)) continue;
    const m = monthKeyOf(t.date);
    if (map.has(m)) map.set(m, (map.get(m) ?? 0) + t.amountCents);
  }
  return months.map((m) => ({ month: m, cents: map.get(m) ?? 0 }));
}

/** „Heute, 18:42“ / „Gestern, 18:42“; älter: „Mi, 8.10.“; Vorjahr: „8.10.25“ – passt immer in die schmale Spalte. */
export function lastEntryLabel(txs: Transaction[], now = new Date()): string | null {
  let best: Transaction | null = null;
  for (const t of txs) if (!best || t.createdAt > best.createdAt) best = t;
  if (!best) return null;
  const d = new Date(best.createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (iso === todayISO()) return `Heute, ${time}`;
  if (dayLabel(iso) === 'Gestern') return `Gestern, ${time}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
  return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
}

export interface TxPreset { categoryId?: string; type?: TxType; amountCents?: number; description?: string; account?: 'joint'; date?: string }

/** Vorlage für „Duplizieren“: gleiche Kategorie, Art, Betrag und Beschreibung, aber heutiges Datum. */
export function duplicatePreset(tx: Transaction): TxPreset {
  return { categoryId: tx.categoryId, type: tx.type, amountCents: tx.amountCents, description: tx.description, ...(tx.account === 'joint' ? { account: 'joint' as const } : {}) };
}
