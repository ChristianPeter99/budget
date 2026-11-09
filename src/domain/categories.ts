// Kategorien: Baum, Namen, Bereich, Symbol.
import type { CatGroup, Category, TxType } from './types';

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

export function catIcon(cats: Category[], c: Category): string {
  const top = c.parentId ? cats.find((x) => x.id === c.parentId) : c;
  return c.icon ?? top?.icon ?? top?.name ?? 'dots';
}
