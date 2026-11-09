// Aufteilung eines Bereichs nach Kategorien (Kreisdiagramme).
import { isHouseholdCat } from './types';
import type { Category, Transaction } from './types';
import { catIcon } from './categories';

/** Ein Kreisabschnitt: Oberkategorie (Unterkategorien eingerechnet) mit Summe. „Weitere“ trägt die zusammengefassten in `members`. */
export interface Slice { id: string; name: string; cents: number; count: number; icon: string; cat?: Category; members?: Slice[] }

export type DonutArea = 'fix' | 'alltag' | 'spar' | 'hh' | 'inc';

/** Gehört die Buchung zum Bereich? Liefert die Oberkategorie (oder undefined, wenn nicht). */
function inArea(t: Transaction, byId: Map<string, Category>, area: DonutArea): { top?: Category; c?: Category } | null {
  const c = byId.get(t.categoryId);
  const top = c?.parentId ? byId.get(c.parentId) ?? c : c;
  if (area === 'inc') return t.type === 'income' ? { top, c } : null;
  if (t.type !== 'expense') return null;
  if (area === 'hh') return c && !isHouseholdCat(c) ? null : { top, c };
  return !top || top.group !== area || isHouseholdCat(top) ? null : { top, c };
}

/**
 * Summen je Oberkategorie eines Bereichs, größte zuerst. Ab `max` Abschnitten werden die kleinsten
 * zu „Weitere“ zusammengefasst, damit der Kreis lesbar bleibt.
 */
export function areaSlices(txs: Transaction[], cats: Category[], area: DonutArea, max = 7): Slice[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const sums = new Map<string, { cents: number; count: number }>();
  for (const t of txs) {
    const hit = inArea(t, byId, area);
    if (!hit) continue;
    const k = hit.top?.id ?? t.categoryId;
    const s = sums.get(k) ?? { cents: 0, count: 0 };
    s.cents += t.amountCents; s.count++;
    sums.set(k, s);
  }
  const all: Slice[] = [...sums.entries()].map(([id, s]) => {
    const cat = byId.get(id);
    return { id, name: cat?.name ?? 'Ohne Kategorie', cents: s.cents, count: s.count, cat, icon: cat ? catIcon(cats, cat) : 'dots' };
  }).filter((s) => s.cents > 0).sort((a, b) => b.cents - a.cents);
  if (all.length <= max) return all;
  const rest = all.slice(max - 1);
  return [...all.slice(0, max - 1), { id: 'rest', name: `Weitere (${rest.length})`, icon: 'dots', members: rest, cents: rest.reduce((a, s) => a + s.cents, 0), count: rest.reduce((a, s) => a + s.count, 0) }];
}

/** Aufteilung einer Oberkategorie nach Unterkategorien (Buchungen direkt auf der Oberkategorie als eigene Zeile). */
export function subRows(txs: Transaction[], cats: Category[], area: DonutArea, topId: string): { id: string; name: string; cents: number }[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const m = new Map<string, number>();
  for (const t of txs) {
    const hit = inArea(t, byId, area);
    if (!hit || (hit.top?.id ?? t.categoryId) !== topId) continue;
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amountCents);
  }
  const hasKids = cats.some((c) => c.parentId === topId);
  return [...m.entries()].map(([id, cents]) => ({ id, cents, name: id === topId ? (hasKids ? 'Ohne Unterkategorie' : 'Buchungen') : byId.get(id)?.name ?? '–' }))
    .filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents);
}
