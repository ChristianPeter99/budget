// Monatszahlen: „Noch verfügbar“, erwartetes Gehalt, Fixkosten als Monatsbetrag, Ausblick.
import { isHouseholdCat } from './types';
import type { Category, Recurring, Settings, Transaction } from './types';
import { expenseByGroup, filterTransactions, summarize } from './transactions';
import { currentMonthKey, monthRange } from './dates';
import { groupOfCategory } from './categories';

/**
 * „Noch verfügbar“ im Monat – dieselbe Zahl auf der Übersicht, im Alltag und beim Erfassen:
 * Einnahmen des Monats minus alle Ausgaben des Monats (Fixkosten, Alltag, Sparen).
 * Ist noch keine Einnahme gebucht, zählt das hinterlegte Gehalt (expected = true).
 * Das Alltag-Budget ist dann: Einnahmen − Fixkosten − Sparen (= verfügbar + bisherige Alltagsausgaben).
 */
export function monthAvailable(monthTxs: Transaction[], s: Settings, month?: string, salaryStart?: string | null, today?: string): { incomeCents: number; expected: boolean; expenseCents: number; availableCents: number } {
  const sum = summarize(monthTxs);
  // Das hinterlegte Gehalt gilt nur ab dem „Gilt ab“ der Gehalts-Vorlage – davor zählt nur, was wirklich gebucht ist
  const beforeSalary = !!month && !!salaryStart && month < salaryStart;
  // Künftige Monate: Das Gehalt zählt erst, wenn es gebucht ist (wie die Fixkosten-Buchungen)
  const future = !!month && month > (today ?? currentMonthKey());
  const expected = sum.incomeCents === 0 && s.expectedIncomeCents > 0 && !beforeSalary && !future;
  const incomeCents = expected ? s.expectedIncomeCents : sum.incomeCents;
  return { incomeCents, expected, expenseCents: sum.expenseCents, availableCents: incomeCents - sum.expenseCents };
}

/** „Gilt ab“ der aktiven Gehalts-Vorlage (Kategorie „Gehalt“, sonst erste aktive Einnahmen-Vorlage), sonst null. */
export function salaryStartMonth(recurring: Recurring[], cats: Category[]): string | null {
  const inc = recurring.filter((r) => r.type === 'income' && r.active);
  const r = inc.find((x) => cats.find((c) => c.id === x.categoryId)?.name === 'Gehalt') ?? inc[0];
  return r?.startMonth ?? null;
}

/**
 * Fixkosten als fester Monatsbetrag: Summe der aktiven Fixkosten-Vorlagen des Monats (jährliche mit ihrem Monatsanteil).
 * So überweist man jeden Monat denselben Betrag aufs Fixkosten-Konto – unabhängig davon, wann tatsächlich abgebucht wird.
 * null, wenn es im Monat keine Fixkosten-Vorlage gibt.
 */
export function fixedPlan(recurring: Recurring[], cats: Category[], month: string): { cents: number; count: number } | null {
  let cents = 0, count = 0;
  for (const r of recurring) {
    if (r.type !== 'expense' || !r.active || r.startMonth > month || (r.endMonth && r.endMonth < month)) continue;
    if (groupOfCategory(cats, r.categoryId) !== 'fix') continue;
    const c = cats.find((x) => x.id === r.categoryId);
    if (c && isHouseholdCat(c)) continue;
    cents += r.amountCents; count++;
  }
  return count ? { cents, count } : null;
}

/**
 * Ausblick für einen künftigen Monat: was voraussichtlich gebucht wird – Einnahmen und Sparen aus den Vorlagen,
 * Fixkosten als fester Monatsbetrag. Gehalt ohne Vorlage: das hinterlegte Gehalt (ab „Gilt ab“).
 */
export function monthOutlook(recurring: Recurring[], cats: Category[], s: Settings, month: string): { incomeCents: number; fixCents: number; sparCents: number } {
  const live = (r: Recurring) => r.active && r.startMonth <= month && (!r.endMonth || r.endMonth >= month);
  const inc = recurring.filter((r) => r.type === 'income' && live(r) && !isHouseholdCat(cats.find((c) => c.id === r.categoryId) ?? ({} as Category)));
  const salaryStart = salaryStartMonth(recurring, cats);
  const incomeCents = inc.length ? inc.reduce((a, r) => a + r.amountCents, 0) : (s.expectedIncomeCents > 0 && (!salaryStart || month >= salaryStart) ? s.expectedIncomeCents : 0);
  const sparCents = recurring.filter((r) => r.type === 'expense' && live(r) && groupOfCategory(cats, r.categoryId) === 'spar').reduce((a, r) => a + r.amountCents, 0);
  return { incomeCents, fixCents: fixedPlan(recurring, cats, month)?.cents ?? 0, sparCents };
}

/** Alle Zahlen eines Monats, wie die Übersicht sie zeigt. */
export interface MonthFigures {
  /** Buchungen des Monats (eigenes Konto) */
  txs: Transaction[];
  /** tatsächlich gebuchte Ausgaben des Monats */
  bookedExpenseCents: number;
  /** Einnahmen: gebucht, sonst erwartetes Gehalt, bei künftigen Monaten der Ausblick */
  incomeCents: number;
  /** Gehalt noch nicht gebucht, aber erwartet */
  expected: boolean;
  /** künftiger Monat ohne gebuchte Einnahme: Zahlen aus den Vorlagen */
  outlook: boolean;
  /** Fixkosten als fester Monatsbetrag der Vorlagen (null: tatsächliche Abbuchungen zählen) */
  plan: { cents: number; count: number } | null;
  /** Bereiche wie angezeigt (Fixkosten als Monatsbetrag, Sparen im Ausblick mindestens die Sparrate) */
  groups: { fix: number; alltag: number; spar: number };
  /** Ausgaben wie angezeigt */
  expenseCents: number;
  /** „Noch verfügbar“ */
  availableCents: number;
  /** im Monat nichts gebucht */
  empty: boolean;
}

/**
 * „Noch verfügbar“ eines Monats: Einnahmen (sonst erwartetes Gehalt, bei künftigen Monaten der Ausblick) minus
 * Ausgaben, Fixkosten als fester Monatsbetrag der Vorlagen. Übersicht, Monatsauswahl und Ausblick nutzen diese eine Rechnung.
 */
export function monthFigures(all: Transaction[], cats: Category[], s: Settings, recurring: Recurring[], month: string, today = currentMonthKey()): MonthFigures {
  const { from, to } = monthRange(month);
  const txs = filterTransactions(all, cats, { from, to });
  const sum = summarize(txs);
  const booked = monthAvailable(txs, s, month, salaryStartMonth(recurring, cats), today);
  // Ausblick: künftiger Monat ohne gebuchte Einnahme – Gehalt, Fixkosten und Sparrate aus den Vorlagen
  const ol = month > today && booked.incomeCents === 0 ? monthOutlook(recurring, cats, s, month) : null;
  const outlook = !!ol && ol.incomeCents > 0;
  const incomeCents = outlook ? ol!.incomeCents : booked.incomeCents;
  const actual = expenseByGroup(txs, cats);
  // Künftige Monate: nur was schon gebucht ist – Gehalt und Fixkosten kommen erst mit dem Monat dazu
  const plan = month <= today || outlook ? fixedPlan(recurring, cats, month) : null;
  const groups = { ...actual, fix: plan ? plan.cents : actual.fix, spar: outlook ? Math.max(actual.spar, ol!.sparCents) : actual.spar };
  const expenseCents = sum.expenseCents - actual.fix + groups.fix - actual.spar + groups.spar;
  return {
    txs, bookedExpenseCents: sum.expenseCents, incomeCents, expected: booked.expected, outlook, plan, groups,
    expenseCents, availableCents: incomeCents - expenseCents, empty: txs.length === 0
  };
}

/** Kurzform von monthFigures für Listen und Tests. */
export function monthFree(all: Transaction[], cats: Category[], s: Settings, recurring: Recurring[], month: string, today = currentMonthKey()): { availableCents: number; outlook: boolean; empty: boolean } {
  const f = monthFigures(all, cats, s, recurring, month, today);
  return { availableCents: f.availableCents, outlook: f.outlook, empty: f.empty };
}

/** „Noch verfügbar“ für die Monatsauswahl: null = nichts gebucht (bzw. künftig). Jahr ('2026') = Summe der Monate. */
export function freeOf(all: Transaction[], cats: Category[], s: Settings, recurring: Recurring[], prefix: string, today = currentMonthKey()): number | null {
  const months = prefix.length === 4 ? Array.from({ length: 12 }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`) : [prefix];
  let total = 0, any = false;
  for (const m of months) {
    if (m > today) continue;
    const f = monthFree(all, cats, s, recurring, m, today);
    if (f.empty) continue;
    total += f.availableCents; any = true;
  }
  return any ? total : null;
}
