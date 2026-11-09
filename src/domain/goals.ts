// Sparziele: Plan, Stand, Monatsbetrag.
import type { SavingsGoal, Transaction } from './types';
import { currentMonthKey, monthLabel } from './dates';
import { formatEUR0 } from './money';

/**
 * Plan für ein Sparziel ab dem aktuellen Monat: fehlender Betrag, Monate bis zum Ziel (aktueller und Zielmonat
 * eingeschlossen) und nötige Rate pro Monat (aufgerundet auf ganze Cent). Überfällig = Zielmonat liegt zurück.
 */
export function goalPlan(g: { targetCents: number; savedCents: number; dueMonth: string }, currentMonth: string): {
  remainingCents: number; monthsLeft: number; perMonthCents: number; ratio: number; done: boolean; overdue: boolean;
} {
  const remainingCents = Math.max(0, g.targetCents - g.savedCents);
  const [cy, cm] = currentMonth.split('-').map(Number) as [number, number];
  const [dy, dm] = g.dueMonth.split('-').map(Number) as [number, number];
  const diff = (dy - cy) * 12 + (dm - cm);
  const done = remainingCents === 0;
  const overdue = !done && diff < 0;
  const monthsLeft = Math.max(0, diff + 1);
  const perMonthCents = done ? 0 : monthsLeft > 0 ? Math.ceil(remainingCents / monthsLeft) : remainingCents;
  return { remainingCents, monthsLeft, perMonthCents, ratio: g.targetCents > 0 ? Math.min(1, g.savedCents / g.targetCents) : 0, done, overdue };
}

/** Angespart eines Sparziels: eigener Betrag (Start + Extras) plus alle automatischen Buchungen für das Ziel. */
export function goalSaved(g: { id: string; savedCents: number }, txs: Transaction[]): number {
  return g.savedCents + txs.reduce((a, t) => (t.goalId === g.id ? a + t.amountCents : a), 0);
}

/**
 * Monatsbetrag eines Sparziels für den Monat: die gebuchte Summe, falls schon gebucht, sonst der geplante Betrag
 * (Rest ÷ verbleibende Monate, auf ganze Euro aufgerundet). 0, wenn erreicht oder Zielmonat vorbei.
 */
export function goalMonthly(g: { id: string; savedCents: number; targetCents: number; dueMonth: string; auto?: boolean }, txs: Transaction[], month: string): number {
  const booked = txs.reduce((a, t) => (t.goalId === g.id && t.date.slice(0, 7) === month ? a + t.amountCents : a), 0);
  if (booked > 0) return booked;
  const p = goalPlan({ ...g, savedCents: goalSaved(g, txs) }, month);
  if (p.done || p.overdue) return 0;
  return Math.min(p.remainingCents, Math.ceil(p.perMonthCents / 100) * 100);
}

/** Sparziel mit tatsächlichem Stand: savedCents = eigener Betrag + automatische Buchungen; monthly = Betrag dieses Monats. */
export type EffGoal = SavingsGoal & { ownCents: number; autoCents: number; monthly: number };

export function effectiveGoals(goals: SavingsGoal[], txs: Transaction[], month = currentMonthKey()): EffGoal[] {
  return goals.map((g) => {
    const total = goalSaved(g, txs);
    return { ...g, savedCents: total, ownCents: g.savedCents, autoCents: total - g.savedCents, monthly: goalMonthly(g, txs, month) };
  });
}

/** Kurztext zum Stand eines Ziels: Monatsbetrag (automatisch oder nötig), erreicht oder überfällig. */
export function goalLine(g: SavingsGoal & { monthly?: number }, month = currentMonthKey()): { text: string; tone: '' | 'pos' | 'warn' } {
  const p = goalPlan(g, month);
  if (p.done) return { text: 'Ziel erreicht', tone: 'pos' };
  if (p.overdue) return { text: `Zielmonat vorbei · es fehlen ${formatEUR0(p.remainingCents)}`, tone: 'warn' };
  const m = g.monthly ?? Math.ceil(p.perMonthCents / 100) * 100;
  return g.auto === false
    ? { text: `${formatEUR0(m)} pro Monat nötig bis ${monthLabel(g.dueMonth)}`, tone: '' }
    : { text: `${formatEUR0(m)} pro Monat · automatisch bis ${monthLabel(g.dueMonth)}`, tone: '' };
}

/** Offene Ziele zuerst (nach Zielmonat), erreichte am Ende. */
export function sortGoals<T extends SavingsGoal>(gs: T[]): T[] {
  return [...gs].sort((a, b) => Number(a.savedCents >= a.targetCents) - Number(b.savedCents >= b.targetCents) || a.dueMonth.localeCompare(b.dueMonth) || a.name.localeCompare(b.name));
}
