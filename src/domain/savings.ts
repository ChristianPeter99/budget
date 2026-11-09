// Sparkonto und Depot: geschätzter Stand und Verlauf.
import { todayISO } from './dates';
import type { BackupData, SavingsEntry, Settings } from './types';

/** Was die Sparrechnungen aus dem Datenbestand brauchen */
export type SavingsData = Pick<BackupData, 'settings' | 'categories' | 'transactions' | 'depotEntries'>;

/** Sparkonto heute geschätzt: letzter erfasster Kontostand plus seitdem gebuchte Sparraten (bis heute). */
export function savingsEstimate<D extends SavingsData>(data: D, today = todayISO()): { cents: number; known: boolean } {
  const s = data.settings;
  const isSpar = (catId: string) => data.categories.find((c) => c.id === catId)?.group === 'spar';
  if (!s.savingsBalanceDate) return { cents: 0, known: false };
  const since = data.transactions.filter((t) => t.type === 'expense' && isSpar(t.categoryId) && t.date > (s.savingsBalanceDate as string) && t.date <= today).reduce((a, t) => a + t.amountCents, 0);
  return { cents: s.savingsBalanceCents + since, known: true };
}

/** Verlauf Gesamt (Sparkonto + Depot): an jedem Tag mit einem Eintrag der jeweils letzte bekannte Stand beider Konten, heute als letzter Punkt. */
export function wealthSeries<D extends SavingsData>(data: D, today = todayISO()): { date: string; cents: number }[] {
  const depot = [...data.depotEntries].sort((a, b) => a.date.localeCompare(b.date));
  const savHist = [...savingsEntries(data.settings)].sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set([...savHist.map((e) => e.date), ...depot.map((e) => e.date)])].filter((d) => d <= today).sort();
  const latest = <T extends { date: string }>(xs: T[], d: string): T | undefined => { let r: T | undefined; for (const x of xs) { if (x.date <= d) r = x; else break; } return r; };
  const out = dates.map((d) => ({ date: d, cents: (latest(savHist, d)?.cents ?? 0) + (latest(depot, d)?.valueCents ?? 0) }));
  const total = savingsEstimate(data, today).cents + (depot[depot.length - 1]?.valueCents ?? 0);
  if (out.length > 0 && (out[out.length - 1] as { date: string }).date < today) out.push({ date: today, cents: total });
  return out;
}

/* ───────── Sparkonto-Stände ───────── */

/** Alle Stände des Sparkontos, neueste zuerst. Ältere Installationen haben nur den letzten Stand. */
export function savingsEntries(s: Settings): SavingsEntry[] {
  const h = s.savingsHistory ?? (s.savingsBalanceDate ? [{ date: s.savingsBalanceDate, cents: s.savingsBalanceCents }] : []);
  return [...h].sort((a, b) => b.date.localeCompare(a.date));
}
