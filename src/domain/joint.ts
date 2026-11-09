// Gemeinsames Konto: Monatsstand mit Übertrag.
import type { Recurring, Settings, Transaction } from './types';
import { currentMonthKey, monthKeyOf, shiftMonth } from './dates';

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

/** Haushaltskonto: „Noch verfügbar“ (mit Übertrag) für die Monatsauswahl; Jahr = Stand im letzten Monat. null = nichts gebucht. */
export function jointFreeOf(own: Transaction[], joint: Transaction[], recurring: Recurring[], s: Settings, prefix: string, today = currentMonthKey()): number | null {
  const months = prefix.length === 4 ? Array.from({ length: 12 }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`) : [prefix];
  let last: number | null = null;
  for (const m of months) {
    if (m > today) break;
    const jm = jointMonth(own, joint, recurring, s, m);
    if (!jm || (jm.budgetCents === 0 && jm.spentCents === 0 && !joint.some((t) => t.date.startsWith(m)))) continue;
    last = jm.availableCents;
  }
  return last;
}
