// Budgets und Richtwerte.
import type { Budget, Settings } from './types';
import { percentOf } from './money';

/** Budget für einen Monat: Monatsangabe überschreibt den Standard. */
export function resolveBudget(budgets: Budget[], monthKey: string, scope: 'month' | 'category', categoryId?: string): number | null {
  const m = budgets.filter((b) => b.scope === scope && (scope === 'month' || b.categoryId === categoryId));
  const specific = m.find((b) => b.monthKey === monthKey);
  if (specific) return specific.amountCents;
  const def = m.find((b) => b.monthKey === 'default');
  return def ? def.amountCents : null;
}

export interface BudgetStatus { spentCents: number; budgetCents: number; remainingCents: number; ratio: number; over: boolean }
export function budgetStatus(spentCents: number, budgetCents: number): BudgetStatus {
  return {
    spentCents, budgetCents, remainingCents: budgetCents - spentCents,
    ratio: budgetCents > 0 ? spentCents / budgetCents : spentCents > 0 ? Infinity : 0,
    over: spentCents > budgetCents
  };
}

/** Richtwerte aus erwartetem Einkommen und Aufteilung (in ganzen Cent). */
export function groupTargets(s: Settings): { fix: number; alltag: number; spar: number; rest: number } {
  const fix = percentOf(s.expectedIncomeCents, s.split.fix);
  const alltag = percentOf(s.expectedIncomeCents, s.split.alltag);
  const spar = percentOf(s.expectedIncomeCents, s.split.spar);
  return { fix, alltag, spar, rest: s.expectedIncomeCents - fix - alltag - spar };
}
