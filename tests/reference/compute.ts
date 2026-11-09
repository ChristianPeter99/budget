/**
 * Rechen-Referenz (Stand v1.78.5): viele zufällige, aber reproduzierbare Datensätze laufen durch alle
 * Rechenfunktionen. Das Ergebnis liegt als JSON in tests/fixtures/calc-reference-v1.78.5.json. Die
 * Neuimplementierung muss für jeden Datensatz centgenau dasselbe liefern (siehe calc-reference.test.ts).
 * Hier nur die Importe anpassen, wenn Funktionen umziehen – nie die Aufrufe.
 */

import { demoData } from '../demo';
import type { BackupData, Budget, Category, Recurring, SavingsGoal, Settings, Transaction } from '../../src/domain/types';
import { areaSlices, subRows } from '../../src/domain/areas';
import type { DonutArea } from '../../src/domain/areas';
import { dueDistance, sortRecurring } from '../../src/domain/recurring';
import { effectiveGoals, goalLine, sortGoals } from '../../src/domain/goals';
import { lastEntryLabel } from '../../src/domain/transactions';
import { savingsEstimate, wealthSeries } from '../../src/domain/savings';
import { dayTone } from '../../src/features/alltag/Calendar';
import * as categories from '../../src/domain/categories';

import * as budget from '../../src/domain/budget';
import * as transactions from '../../src/domain/transactions';
import * as month from '../../src/domain/month';
import * as recurring from '../../src/domain/recurring';
import * as joint from '../../src/domain/joint';
import * as goals from '../../src/domain/goals';

/** früher alles in domain/calc.ts – hier wieder zusammengefasst, damit die Aufrufe unten unverändert bleiben */
const calc = { ...categories, ...transactions, ...budget, ...month, ...recurring, ...joint, ...goals };

/** kleiner Zufallsgenerator mit festem Startwert (mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)]!, chance: (p: number) => next() < p };
}

export const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
export const TODAYS = ['2026-11-15', '2027-01-03'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Feste IDs statt Zufalls-UUIDs: jede UUID wird in der Reihenfolge ihres Auftretens zu id-<n> */
function stableIds<T>(x: T): T {
  const map = new Map<string, string>();
  const s = JSON.stringify(x).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => { if (!map.has(u)) map.set(u, `id-${map.size + 1}`); return map.get(u)!; });
  return JSON.parse(s.replace(/"createdAt":"[^"]*"/g, '"createdAt":"2025-10-01T08:00:00.000Z"')) as T;
}

export interface Dataset extends BackupData { jointTransactions: Transaction[] }

export function makeDataset(seed: number): Dataset {
  const r = rng(seed);
  const base = stableIds(demoData('2025-12'));
  const cats: Category[] = base.categories;
  // gemeinsames Konto: eigene Kategorienliste
  const hhTop: Category = { id: 'hh-1', name: 'Haushalt', kind: 'expense', group: 'alltag', parentId: null, archived: false, sort: 900, createdAt: '2025-10-01T08:00:00.000Z', scope: 'joint' };
  const hhSub: Category = { ...hhTop, id: 'hh-2', name: 'Lebensmittel', parentId: 'hh-1', sort: 901 };
  cats.push(hhTop, hhSub);
  if (r.chance(0.3)) { const c = r.pick(cats.filter((x) => x.parentId)); c.archived = true; }
  const expense = cats.filter((c) => c.kind === 'expense' && !c.scope);
  const income = cats.filter((c) => c.kind === 'income');
  const recurring: Recurring[] = base.recurring.map((x, i) => {
    const y = r.chance(0.2) && x.type === 'expense';
    const amt = r.chance(0.5) ? x.amountCents : r.int(100, 90000);
    const rec: Recurring = { ...x, amountCents: amt, day: r.int(1, 28), active: !r.chance(0.08), startMonth: r.pick(['2025-11', '2025-12', '2026-03', '2026-11']) };
    if (x.type === 'income') { rec.amountCents = r.int(150000, 420000); rec.startMonth = r.pick(['2025-11', '2026-02', '2026-11', '2026-12']); }
    if (y) { rec.interval = 'yearly'; rec.yearlyCents = r.int(1200, 120000); rec.amountCents = Math.round(rec.yearlyCents / 12); if (r.chance(0.7)) rec.dueMonth = r.int(1, 12); }
    if (r.chance(0.1)) rec.endMonth = r.pick(['2026-06', '2026-11', '2027-01']);
    if (r.chance(0.3)) rec.sort = i;
    return rec;
  });
  const own: Transaction[] = [], joint: Transaction[] = [];
  const n = r.int(0, 260);
  for (let i = 0; i < n; i++) {
    const m = r.pick(MONTHS.slice(0, 14));
    const date = `${m}-${pad(r.int(1, 28))}`;
    const isInc = r.chance(0.08);
    const c = isInc ? r.pick(income) : r.pick(expense);
    const t: Transaction = { id: `t-${i}`, date, type: isInc ? 'income' : 'expense', amountCents: isInc ? r.int(1000, 400000) : r.int(1, 25000), categoryId: c.id, description: r.pick(['REWE', 'Aldi', 'Shell', 'Miete', 'Netflix', 'Kino', '', 'Bäcker Huber', 'Amazon Marketplace']), createdAt: `${date}T09:${pad(r.int(0, 59))}:00.000Z` };
    if (r.chance(0.1)) { const rec = r.pick(recurring); t.recurringId = rec.id; }
    own.push(t);
  }
  const nj = r.chance(0.5) ? r.int(0, 60) : 0;
  for (let i = 0; i < nj; i++) {
    const m = r.pick(MONTHS.slice(0, 14));
    const date = `${m}-${pad(r.int(1, 28))}`;
    joint.push({ id: `j-${i}`, date, type: 'expense', amountCents: r.int(50, 15000), categoryId: r.pick([hhTop.id, hhSub.id]), description: 'Haushalt', createdAt: `${date}T10:00:00.000Z`, account: 'joint' });
  }
  const budgets: Budget[] = [];
  if (r.chance(0.6)) budgets.push({ id: 'b-m', scope: 'month', monthKey: 'default', amountCents: r.int(50000, 300000) });
  for (const c of expense.filter((x) => !x.parentId && x.group === 'alltag')) {
    if (r.chance(0.35)) budgets.push({ id: `b-${c.id}`, scope: 'category', monthKey: 'default', categoryId: c.id, amountCents: r.int(2000, 60000) });
    if (r.chance(0.15)) budgets.push({ id: `b-${c.id}-x`, scope: 'category', monthKey: r.pick(MONTHS), categoryId: c.id, amountCents: r.int(0, 60000) });
  }
  const goals: SavingsGoal[] = [];
  for (let i = 0; i < r.int(0, 3); i++) {
    goals.push({ id: `g-${i}`, name: `Ziel ${i}`, targetCents: r.int(10000, 900000), savedCents: r.int(0, 300000), dueMonth: r.pick(['2026-08', '2026-12', '2027-06', '2028-01']), createdAt: '2025-10-01T08:00:00.000Z', ...(r.chance(0.3) ? { auto: false } : {}), ...(r.chance(0.5) ? { lastBookedMonth: r.pick(['2026-10', '2026-11']) } : {}) });
    for (let k = 0; k < r.int(0, 4); k++) own.push({ id: `tg-${i}-${k}`, date: `${r.pick(MONTHS.slice(0, 13))}-01`, type: 'expense', amountCents: r.int(1000, 50000), categoryId: cats.find((c) => c.group === 'spar' && c.parentId)!.id, description: 'Sparziel', createdAt: '2025-10-01T08:00:00.000Z', goalId: `g-${i}` });
  }
  const jointOn = r.chance(0.5);
  const settings: Settings = {
    expectedIncomeCents: r.chance(0.7) ? r.int(150000, 420000) : 0,
    split: { fix: r.int(20, 50), alltag: r.int(20, 50), spar: r.int(0, 25) },
    savingsBalanceCents: r.int(0, 2000000), savingsBalanceDate: r.chance(0.7) ? r.pick(['2026-03-01', '2026-10-31', '2026-11-10']) : null,
    savingsHistory: r.chance(0.5) ? [{ date: '2026-01-15', cents: r.int(0, 900000) }, { date: '2026-06-30', cents: r.int(0, 1500000) }] : undefined,
    accountName: 'C24', backupReminderDays: 30,
    savingsGoals: goals,
    ...(jointOn ? { joint: { enabled: true, name: 'Haushaltskonto', partnerName: 'P', categoryId: expense.find((c) => c.group === 'alltag' && !c.parentId)!.id, partnerDefaultCents: r.int(0, 80000), partnerByMonth: r.chance(0.5) ? { '2026-10': r.int(0, 90000) } : {}, ...(r.chance(0.5) ? { startMonth: r.pick(['2026-01', '2026-09']) } : {}) } } : {})
  };
  if (!settings.savingsHistory) delete settings.savingsHistory;
  const depotEntries = r.chance(0.5) ? [{ id: 'd-1', date: '2026-02-01', valueCents: r.int(0, 900000), createdAt: '2025-10-01T08:00:00.000Z' }, { id: 'd-2', date: '2026-09-15', valueCents: r.int(0, 900000), createdAt: '2025-10-01T08:00:00.000Z' }] : [];
  return { categories: cats, transactions: own, jointTransactions: joint, budgets, recurring, recurringRuns: [], depotEntries, settings };
}

const entries = <K, V>(m: Map<K, V>) => [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

/** Alle Rechenergebnisse eines Datensatzes */
export function computeAll(d: Dataset): unknown {
  const cats = d.categories, own = d.transactions, s = d.settings, rec = d.recurring;
  const tops = calc.topLevel(cats, 'expense').filter((c) => !c.scope);
  const inMonth = (m: string) => own.filter((t) => t.date.startsWith(m));
  const salaryStart = calc.salaryStartMonth(rec, cats);
  const out: Record<string, unknown> = {};
  out.summarize = calc.summarize(own);
  out.salaryStart = salaryStart;
  out.groupTargets = calc.groupTargets(s);
  out.sortedIds = calc.sortTransactions(own).map((t) => t.id);
  out.monthSeries = calc.monthSeries(own, '2026-11', 12);
  out.categorySeries = tops.map((c) => calc.categorySeries(own, cats, c.id, '2026-11', 12));
  out.filters = ['rewe', '12', '12,50', 'Kino', '>50', 'shell 7', '-3'].map((q) => [q, calc.amountQuery(q), calc.filterTransactions(own, cats, { q }).map((t) => t.id)]);
  out.filterRange = calc.filterTransactions(own, cats, { from: '2026-03-01', to: '2026-05-31', type: 'expense' }).map((t) => t.id);
  out.filterCat = tops.slice(0, 3).map((c) => calc.filterTransactions(own, cats, { categoryId: c.id }).length);
  out.sortRecurring = sortRecurring(rec).map((x) => x.id);
  out.dueDistance = Array.from({ length: 15 }, (_, i) => dueDistance(i));
  out.reserve = TODAYS.map((today) => rec.map((x) => [x.id, calc.reserveStatus(x, own, today), calc.nextDue(x, today)]));
  out.yearlyShare = [1200, 1201, 99999, 7].map((c) => MONTHS.map((m) => calc.yearlyShare(c, m)));
  out.goals = MONTHS.map((m) => effectiveGoals(s.savingsGoals ?? [], own, m).map((g) => [g.id, g.monthly, goalLine(g, m), calc.goalPlan(g, m), calc.goalSaved(g, own), calc.goalMonthly(g, own, m)]));
  out.sortGoals = sortGoals(s.savingsGoals ?? []).map((g) => g.id);
  out.lastEntry = [lastEntryLabel(own, new Date('2026-11-15T10:00:00')), lastEntryLabel(own, new Date('2027-01-03T10:00:00'))];
  out.savings = TODAYS.map((today) => [savingsEstimate({ ...d, jointTransactions: d.jointTransactions, lastBackupAt: null }, today), wealthSeries({ ...d, jointTransactions: d.jointTransactions, lastBackupAt: null }, today)]);
  out.dayTone = [0, 1, 500, 2000, 9000, 40000].map((c) => [dayTone(c, 3000), dayTone(c, 0)]);
  out.perMonth = MONTHS.map((m) => {
    const txs = inMonth(m);
    const areas: DonutArea[] = ['fix', 'alltag', 'spar', 'inc'];
    return {
      m,
      byGroup: calc.expenseByGroup(txs, cats),
      byTop: entries(calc.totalsByTopCategory(txs, cats, 'expense')),
      byCat: entries(calc.totalsByCategory(txs, 'expense')),
      incTop: entries(calc.totalsByTopCategory(txs, cats, 'income')),
      budgets: [calc.resolveBudget(d.budgets, m, 'month'), ...tops.map((c) => calc.resolveBudget(d.budgets, m, 'category', c.id))],
      status: tops.map((c) => { const b = calc.resolveBudget(d.budgets, m, 'category', c.id); return b === null ? null : calc.budgetStatus(calc.totalsByTopCategory(txs, cats, 'expense').get(c.id) ?? 0, b); }),
      available: TODAYS.map((today) => calc.monthAvailable(txs, s, m, salaryStart, today)),
      availableNoSalary: calc.monthAvailable(txs, s),
      fixedPlan: calc.fixedPlan(rec, cats, m),
      outlook: calc.monthOutlook(rec, cats, s, m),
      free: TODAYS.map((today) => [calc.monthFree(own, cats, s, rec, m, today.slice(0, 7)), calc.freeOf(own, cats, s, rec, m, today.slice(0, 7))]),
      joint: calc.jointMonth(own, d.jointTransactions, rec, s, m),
      jointFree: TODAYS.map((today) => calc.jointFreeOf(own, d.jointTransactions, rec, s, m, today.slice(0, 7))),
      slices: areas.map((a) => areaSlices(txs, cats, a)),
      slicesHh: areaSlices(d.jointTransactions.filter((t) => t.date.startsWith(m)), cats, 'hh'),
      subRows: tops.slice(0, 4).map((c) => subRows(txs, cats, 'alltag', c.id))
    };
  });
  out.perYear = ['2025', '2026', '2027'].map((y) => TODAYS.map((today) => [calc.freeOf(own, cats, s, rec, y, today.slice(0, 7)), calc.jointFreeOf(own, d.jointTransactions, rec, s, y, today.slice(0, 7))]));
  return out;
}

export const DATASETS = 40;
export function computeReference(): unknown[] {
  return Array.from({ length: DATASETS }, (_, i) => computeAll(makeDataset(1000 + i)));
}
