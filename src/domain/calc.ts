import type { Budget, CatGroup, Category, Recurring, Settings, Transaction, TxType } from './types';
import { percentOf } from './money';
import { monthKeyOf, shiftMonth } from './dates';

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

export function childrenOf(cats: Category[], id: string): Category[] {
  return cats.filter((c) => c.parentId === id).sort((a, b) => a.sort - b.sort);
}
/** Kategorie plus ihre Unterkategorien */
export function categoryFamily(cats: Category[], id: string): Set<string> {
  return new Set([id, ...childrenOf(cats, id).map((c) => c.id)]);
}
export function topLevel(cats: Category[], kind?: TxType): Category[] {
  return cats.filter((c) => c.parentId === null && (!kind || c.kind === kind)).sort((a, b) => a.sort - b.sort);
}
export function categoryName(cats: Category[], id: string): string {
  const c = cats.find((x) => x.id === id);
  if (!c) return 'Unbekannt';
  const p = c.parentId ? cats.find((x) => x.id === c.parentId) : undefined;
  return p && p.name !== c.name ? `${p.name} › ${c.name}` : c.name;
}
export function groupOfCategory(cats: Category[], id: string): CatGroup | undefined {
  return cats.find((c) => c.id === id)?.group;
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

/**
 * „Noch verfügbar“ im Monat – dieselbe Zahl auf der Übersicht, im Alltag und beim Erfassen:
 * Einnahmen des Monats minus alle Ausgaben des Monats (Fixkosten, Alltag, Sparen).
 * Ist noch keine Einnahme gebucht, zählt das hinterlegte Gehalt (expected = true).
 * Das Alltag-Budget ist dann: Einnahmen − Fixkosten − Sparen (= verfügbar + bisherige Alltagsausgaben).
 */
export function monthAvailable(monthTxs: Transaction[], s: Settings, month?: string, salaryStart?: string | null): { incomeCents: number; expected: boolean; expenseCents: number; availableCents: number } {
  const sum = summarize(monthTxs);
  // Das hinterlegte Gehalt gilt nur ab dem „Gilt ab“ der Gehalts-Vorlage – davor zählt nur, was wirklich gebucht ist
  const beforeSalary = !!month && !!salaryStart && month < salaryStart;
  const expected = sum.incomeCents === 0 && s.expectedIncomeCents > 0 && !beforeSalary;
  const incomeCents = expected ? s.expectedIncomeCents : sum.incomeCents;
  return { incomeCents, expected, expenseCents: sum.expenseCents, availableCents: incomeCents - sum.expenseCents };
}

/** „Gilt ab“ der aktiven Gehalts-Vorlage (Kategorie „Gehalt“, sonst erste aktive Einnahmen-Vorlage), sonst null. */
export function salaryStartMonth(recurring: Recurring[], cats: Category[]): string | null {
  const inc = recurring.filter((r) => r.type === 'income' && r.active);
  const r = inc.find((x) => cats.find((c) => c.id === x.categoryId)?.name === 'Gehalt') ?? inc[0];
  return r?.startMonth ?? null;
}

/** Richtwerte aus erwartetem Einkommen und Aufteilung (in ganzen Cent). */
export function groupTargets(s: Settings): { fix: number; alltag: number; spar: number; rest: number } {
  const fix = percentOf(s.expectedIncomeCents, s.split.fix);
  const alltag = percentOf(s.expectedIncomeCents, s.split.alltag);
  const spar = percentOf(s.expectedIncomeCents, s.split.spar);
  return { fix, alltag, spar, rest: s.expectedIncomeCents - fix - alltag - spar };
}

/** Nächste Fälligkeit einer jährlichen Vorlage mit Fälligkeitsmonat: Monatsschlüssel und Abstand in Monaten (0 = dieser Monat). */
export function nextDue(r: { interval?: string; dueMonth?: number; active: boolean }, today: string): { month: string; monthsAway: number } | null {
  if (r.interval !== 'yearly' || !r.dueMonth || !r.active) return null;
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const year = r.dueMonth >= m ? y : y + 1;
  const monthsAway = (year - y) * 12 + (r.dueMonth - m);
  return { month: `${String(year).padStart(4, '0')}-${String(r.dueMonth).padStart(2, '0')}`, monthsAway };
}

/** Monatsanteil eines Jahresbetrags. Der Rest (Cent) wird auf die ersten Monate verteilt, damit die Jahressumme exakt stimmt. */
export function yearlyShare(yearlyCents: number, monthKey: string): number {
  const m = Number(monthKey.slice(5, 7)) - 1;
  const base = Math.floor(yearlyCents / 12);
  return base + (m < yearlyCents % 12 ? 1 : 0);
}

export interface ReserveStatus {
  yearlyCents: number;
  /** im laufenden Zyklus bereits gebuchte Monatsanteile (bis einschließlich aktuellem Monat) */
  savedCents: number;
  /** gebucht + noch kommende Anteile bis zum Fälligkeitsmonat */
  expectedAtDueCents: number;
  /** was bei Fälligkeit voraussichtlich fehlt (z. B. weil die Vorlage erst im Zyklus angelegt wurde) */
  shortfallCents: number;
  due: { month: string; monthsAway: number };
}

/**
 * Rücklage einer jährlichen Zahlung: Ein Zyklus sind die 12 Monate bis einschließlich Fälligkeitsmonat.
 * Gezählt werden die tatsächlich gebuchten Monatsanteile dieser Vorlage, nicht theoretische Werte.
 */
export function reserveStatus(r: Recurring, txs: Transaction[], today: string): ReserveStatus | null {
  const due = nextDue(r, today);
  if (!due || !r.yearlyCents) return null;
  const cycleStart = shiftMonth(due.month, -11);
  const cur = monthKeyOf(today);
  let saved = 0;
  for (const t of txs) {
    if (t.recurringId !== r.id) continue;
    const m = monthKeyOf(t.date);
    if (m >= cycleStart && m <= cur) saved += t.amountCents;
  }
  let future = 0;
  for (let m = shiftMonth(cur, 1), g = 0; m <= due.month && g < 13; m = shiftMonth(m, 1), g++) {
    if (m >= r.startMonth && (!r.endMonth || m <= r.endMonth)) future += yearlyShare(r.yearlyCents, m);
  }
  const expected = saved + future;
  return { yearlyCents: r.yearlyCents, savedCents: saved, expectedAtDueCents: expected, shortfallCents: Math.max(0, r.yearlyCents - expected), due };
}

/** Summe einer Kategorie (inkl. Unterkategorien) je Monat, die letzten n Monate bis endMonth. */
export function categorySeries(txs: Transaction[], cats: Category[], categoryId: string, endMonth: string, n = 12): { month: string; cents: number }[] {
  const fam = categoryFamily(cats, categoryId);
  const months = Array.from({ length: n }, (_, i) => shiftMonth(endMonth, i - (n - 1)));
  const map = new Map(months.map((m) => [m, 0]));
  for (const t of txs) {
    if (t.type !== 'expense' || !fam.has(t.categoryId)) continue;
    const m = monthKeyOf(t.date);
    if (map.has(m)) map.set(m, (map.get(m) ?? 0) + t.amountCents);
  }
  return months.map((m) => ({ month: m, cents: map.get(m) ?? 0 }));
}

export interface JointMonth {
  myCents: number; partnerCents: number; budgetCents: number; spentCents: number;
  /** Rest nur dieses Monats (Einzahlungen − Ausgaben) */
  leftCents: number;
  /** Übertrag aus den Vormonaten (kann negativ sein) */
  carryCents: number;
  /** verfügbar = Übertrag + Einzahlungen − Ausgaben */
  availableCents: number;
}

/**
 * Gemeinsames Konto für einen Monat. Eigener Beitrag = tatsächlich gebuchte Beiträge (Kategorie des Beitrags) in diesem
 * Monat, sonst der Betrag der aktiven Vorlage. Beitrag der anderen Person = Monatswert oder üblicher Betrag.
 */
export function jointMonth(own: Transaction[], joint: Transaction[], recurring: Recurring[], s: Settings, monthKey: string): JointMonth | null {
  const j = s.joint;
  if (!j || !j.enabled) return null;
  const tpl = recurring.find((r) => r.categoryId === j.categoryId && r.active);
  const myBy = new Map<string, number>(), spentBy = new Map<string, number>();
  for (const t of own) if (t.type === 'expense' && t.categoryId === j.categoryId) myBy.set(monthKeyOf(t.date), (myBy.get(monthKeyOf(t.date)) ?? 0) + t.amountCents);
  for (const t of joint) spentBy.set(monthKeyOf(t.date), (spentBy.get(monthKeyOf(t.date)) ?? 0) + t.amountCents);
  const one = (m: string) => {
    const my = myBy.has(m) ? (myBy.get(m) as number) : (tpl?.amountCents ?? 0);
    const partner = j.partnerByMonth[m] ?? j.partnerDefaultCents;
    const spent = spentBy.get(m) ?? 0;
    return { my, partner, spent };
  };
  // Startmonat des Übertrags: gesetzt, sonst der früheste Monat mit Beitrag oder gemeinsamer Ausgabe
  const known = [...myBy.keys(), ...spentBy.keys()].sort();
  const start = j.startMonth ?? known[0] ?? monthKey;
  let carry = 0;
  for (let m = start, g = 0; m < monthKey && g < 1200; m = shiftMonth(m, 1), g++) {
    // Monate ohne Beitragsbuchung vor dem aktuellen zählen nur ihre tatsächlichen Werte (kein Vorlagenbetrag)
    const o = one(m);
    const my = myBy.get(m) ?? 0;
    carry += my + o.partner - o.spent;
  }
  const cur = one(monthKey);
  const budget = cur.my + cur.partner;
  return {
    myCents: cur.my, partnerCents: cur.partner, budgetCents: budget, spentCents: cur.spent,
    leftCents: budget - cur.spent, carryCents: carry, availableCents: carry + budget - cur.spent
  };
}

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
