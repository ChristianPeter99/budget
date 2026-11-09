// Wiederkehrende Buchungen: Fälligkeit, Jahresbeträge, Rücklage, Reihenfolge.
import type { Recurring, Transaction } from './types';
import { monthKeyOf, shiftMonth } from './dates';

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

/** „diesen Monat“, „nächsten Monat“, „in 5 Monaten“ */
export function dueDistance(monthsAway: number): string {
  return monthsAway === 0 ? 'diesen Monat' : monthsAway === 1 ? 'nächsten Monat' : `in ${monthsAway} Monaten`;
}

/** Positionen: eigene Reihenfolge (per Ziehen), sonst nach Betrag */
export function sortRecurring(rs: Recurring[]): Recurring[] {
  return [...rs].sort((a, b) => (a.sort ?? 1e9) - (b.sort ?? 1e9) || b.amountCents - a.amountCents);
}
