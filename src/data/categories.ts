// Kategorien verwalten: anlegen, umbenennen, sortieren, verschieben, zusammenführen.
import { AppError, isHouseholdCat, newId } from '../domain/types';
import type { CatGroup, Category, Settings, TxType } from '../domain/types';
import type { Db } from './schema';
import { validateName } from '../domain/validate';
import { abortTx } from './internal';
import { CAT_ICON_KEYS } from '../domain/catIcons';

/* ───────── Kategorien ───────── */

export interface CategoryInput { name: string; kind: TxType; group: CatGroup; parentId: string | null; /** 'joint' = Liste des Haushaltskontos */ scope?: 'joint' }

export async function addCategory(db: Db, input: CategoryInput): Promise<Category> {
  const name = validateName(input.name, 'Namen');
  const tx = db.transaction('categories', 'readwrite');
  const all = await tx.store.getAll();
  let kind = input.kind, group = input.group, household = input.scope === 'joint';
  if (input.parentId) {
    const p = all.find((c) => c.id === input.parentId);
    if (!p || p.parentId !== null) { abortTx(tx); throw new AppError('Die Oberkategorie ist ungültig. Es sind nur zwei Ebenen möglich.'); }
    kind = p.kind; group = p.group; household = isHouseholdCat(p);
  }
  if (household) { kind = 'expense'; group = 'alltag'; }
  if (all.some((c) => c.parentId === input.parentId && c.kind === kind && isHouseholdCat(c) === household && (input.parentId !== null || c.group === group) && c.name.toLowerCase() === name.toLowerCase())) {
    abortTx(tx); throw new AppError('Diese Kategorie gibt es bereits.');
  }
  const c: Category = { id: newId(), name, kind, group, parentId: input.parentId, archived: false, sort: Math.max(-1, ...all.map((x) => x.sort)) + 1, createdAt: new Date().toISOString() };
  if (household) c.scope = 'joint';
  await tx.store.add(c);
  await tx.done;
  return c;
}

export async function renameCategory(db: Db, id: string, name: string): Promise<void> {
  const n = validateName(name, 'Namen');
  const tx = db.transaction('categories', 'readwrite');
  const c = await tx.store.get(id);
  if (!c) { abortTx(tx); throw new AppError('Die Kategorie wurde nicht gefunden.'); }
  await tx.store.put({ ...c, name: n });
  await tx.done;
}

/** Symbol einer Kategorie setzen; null = wieder Symbol nach Name. */
export async function setCategoryIcon(db: Db, id: string, icon: string | null): Promise<void> {
  if (icon !== null && !CAT_ICON_KEYS.has(icon)) throw new AppError('Unbekanntes Symbol.');
  const tx = db.transaction('categories', 'readwrite');
  const c = await tx.store.get(id);
  if (!c) { abortTx(tx); throw new AppError('Die Kategorie wurde nicht gefunden.'); }
  const next = { ...c };
  if (icon === null) delete next.icon; else next.icon = icon;
  await tx.store.put(next);
  await tx.done;
}

/** Archivierte Kategorien bleiben in alten Buchungen erhalten, erscheinen aber nicht mehr in der Auswahl. */
export async function setCategoryArchived(db: Db, id: string, archived: boolean): Promise<void> {
  const tx = db.transaction('categories', 'readwrite');
  const all = await tx.store.getAll();
  const c = all.find((x) => x.id === id);
  if (!c) { abortTx(tx); throw new AppError('Die Kategorie wurde nicht gefunden.'); }
  const ids = new Set([id, ...all.filter((x) => x.parentId === id).map((x) => x.id)]);
  if (!archived && c.parentId) {
    const p = all.find((x) => x.id === c.parentId);
    if (p?.archived) { abortTx(tx); throw new AppError('Reaktiviere zuerst die Oberkategorie.'); }
  }
  for (const x of all) if (ids.has(x.id)) await tx.store.put({ ...x, archived });
  await tx.done;
}

/** Löscht nur ungenutzte Kategorien. Sonst bleibt alles unverändert und es erscheint ein Hinweis. */
export async function deleteCategory(db: Db, id: string): Promise<void> {
  const tx = db.transaction(['categories', 'transactions', 'recurring', 'budgets'], 'readwrite');
  const cats = await tx.objectStore('categories').getAll();
  const family = new Set([id, ...cats.filter((c) => c.parentId === id).map((c) => c.id)]);
  const used = (await tx.objectStore('transactions').getAll()).some((t) => family.has(t.categoryId))
    || (await tx.objectStore('recurring').getAll()).some((r) => family.has(r.categoryId));
  if (used) { abortTx(tx); throw new AppError('Diese Kategorie wird verwendet und kann nicht gelöscht werden. Du kannst sie archivieren.'); }
  for (const b of await tx.objectStore('budgets').getAll()) if (b.categoryId && family.has(b.categoryId)) await tx.objectStore('budgets').delete(b.id);
  for (const f of family) await tx.objectStore('categories').delete(f);
  await tx.done;
}

/** Kategorie des eigenen Beitrags zum gemeinsamen Konto: darf weder verschoben, umgruppiert noch zusammengeführt werden. */
async function isJointCategory(tx: { objectStore: (n: 'settings') => { get: (k: string) => Promise<{ value: Settings } | undefined> } }, id: string): Promise<boolean> {
  const s = (await tx.objectStore('settings').get('app'))?.value;
  return !!s?.joint?.categoryId && s.joint.categoryId === id;
}

/**
 * Neue Reihenfolge per Ziehen: `ids` sind alle Geschwister (gleiche Oberkategorie und Art) in der gewünschten Reihenfolge.
 * Fehlende Geschwister behalten ihren Platz am Ende. Eine Transaktion.
 */
export async function setCategoryOrder(db: Db, ids: string[]): Promise<void> {
  const tx = db.transaction('categories', 'readwrite');
  const all = await tx.store.getAll();
  const first = all.find((x) => x.id === ids[0]);
  if (!first) { abortTx(tx); throw new AppError('Die Kategorie wurde nicht gefunden.'); }
  const sib = all.filter((x) => x.parentId === first.parentId && x.kind === first.kind).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'));
  if (ids.some((id) => !sib.some((x) => x.id === id))) { abortTx(tx); throw new AppError('Die Reihenfolge passt nicht zu den Kategorien.'); }
  const order = [...ids, ...sib.filter((x) => !ids.includes(x.id)).map((x) => x.id)];
  const base = Math.min(...sib.map((x) => x.sort));
  for (let k = 0; k < order.length; k++) { const x = sib.find((c) => c.id === order[k]) as Category; if (x.sort !== base + k) await tx.store.put({ ...x, sort: base + k }); }
  await tx.done;
}

/**
 * Hängt eine Kategorie um: newParentId = Hauptkategorie (wird Unterkategorie) oder null (wird Hauptkategorie).
 * Gruppe und Art folgen der neuen Oberkategorie. Eine Hauptkategorie mit Unterkategorien kann nicht untergeordnet
 * werden (höchstens zwei Ebenen). Wird eine Hauptkategorie untergeordnet, entfallen ihre Kategorie-Budgets.
 */
export async function setCategoryParent(db: Db, id: string, newParentId: string | null): Promise<void> {
  const tx = db.transaction(['categories', 'budgets', 'settings'], 'readwrite');
  const all = await tx.objectStore('categories').getAll();
  const c = all.find((x) => x.id === id);
  if (!c) { abortTx(tx); throw new AppError('Die Kategorie wurde nicht gefunden.'); }
  if (await isJointCategory(tx as never, id)) { abortTx(tx); throw new AppError('Die Kategorie des gemeinsamen Kontos kann nicht verschoben werden.'); }
  if (newParentId === c.parentId) { await tx.done; return; }
  const maxSort = (pid: string | null) => Math.max(-1, ...all.filter((x) => x.parentId === pid).map((x) => x.sort)) + 1;
  if (newParentId === null) {
    await tx.objectStore('categories').put({ ...c, parentId: null, sort: maxSort(null) });
    await tx.done; return;
  }
  const p = all.find((x) => x.id === newParentId);
  if (!p || p.parentId !== null || p.id === id) { abortTx(tx); throw new AppError('Bitte wähle eine Hauptkategorie als Ziel.'); }
  if (p.kind !== c.kind) { abortTx(tx); throw new AppError('Einnahmen- und Ausgaben-Kategorien lassen sich nicht mischen.'); }
  if (isHouseholdCat(p) !== isHouseholdCat(c)) { abortTx(tx); throw new AppError('Kategorien des Haushaltskontos und des eigenen Kontos lassen sich nicht mischen.'); }
  if (await isJointCategory(tx as never, p.id)) { abortTx(tx); throw new AppError('Unter die Kategorie des gemeinsamen Kontos lassen sich keine Kategorien hängen.'); }
  if (all.some((x) => x.parentId === id)) { abortTx(tx); throw new AppError('Diese Kategorie hat Unterkategorien und kann deshalb nicht untergeordnet werden.'); }
  if (c.parentId === null) for (const b of await tx.objectStore('budgets').getAll()) if (b.categoryId === id) await tx.objectStore('budgets').delete(b.id);
  await tx.objectStore('categories').put({ ...c, parentId: p.id, group: p.group, sort: maxSort(p.id) });
  await tx.done;
}

/** Wechselt die Gruppe (Fixkosten/Alltag/Sparen) einer Hauptkategorie samt Unterkategorien. */
export async function setCategoryGroup(db: Db, id: string, group: CatGroup): Promise<void> {
  if (group !== 'fix' && group !== 'alltag' && group !== 'spar') throw new AppError('Ungültige Gruppe.');
  const tx = db.transaction(['categories', 'settings'], 'readwrite');
  const all = await tx.objectStore('categories').getAll();
  const c = all.find((x) => x.id === id);
  if (!c || c.parentId !== null || c.kind !== 'expense') { abortTx(tx); throw new AppError('Die Gruppe lässt sich nur für Ausgaben-Hauptkategorien ändern.'); }
  if (await isJointCategory(tx as never, id)) { abortTx(tx); throw new AppError('Die Kategorie des gemeinsamen Kontos bleibt im Alltag.'); }
  if (isHouseholdCat(c)) { abortTx(tx); throw new AppError('Kategorien des Haushaltskontos gehören immer zum Alltag.'); }
  for (const x of all) if (x.id === id || x.parentId === id) await tx.objectStore('categories').put({ ...x, group });
  await tx.done;
}

/**
 * Führt die Kategorie sourceId in targetId zusammen (eine Transaktion): Buchungen, Vorlagen und Budgets werden
 * umgehängt, danach wird die Quelle gelöscht. Quelle darf keine Unterkategorien haben; das Ziel muss buchbar sein
 * (Unterkategorie oder Hauptkategorie ohne Unterkategorien). Gibt die Anzahl umgebuchter Buchungen zurück.
 */
export async function mergeCategory(db: Db, sourceId: string, targetId: string): Promise<number> {
  const tx = db.transaction(['categories', 'transactions', 'recurring', 'budgets', 'settings'], 'readwrite');
  const all = await tx.objectStore('categories').getAll();
  const src = all.find((x) => x.id === sourceId), dst = all.find((x) => x.id === targetId);
  const fail = (m: string) => { abortTx(tx); return new AppError(m); };
  if (!src || !dst || src.id === dst.id) throw fail('Bitte wähle zwei verschiedene Kategorien.');
  if (src.kind !== dst.kind) throw fail('Einnahmen- und Ausgaben-Kategorien lassen sich nicht zusammenführen.');
  if (isHouseholdCat(src) !== isHouseholdCat(dst)) throw fail('Kategorien des Haushaltskontos und des eigenen Kontos lassen sich nicht zusammenführen.');
  if (all.some((x) => x.parentId === src.id)) throw fail('Führe zuerst die Unterkategorien zusammen oder verschiebe sie.');
  if (all.some((x) => x.parentId === dst.id)) throw fail('Das Ziel hat Unterkategorien. Wähle eine davon als Ziel.');
  if ((await isJointCategory(tx as never, src.id)) || (await isJointCategory(tx as never, dst.id))) throw fail('Die Kategorie des gemeinsamen Kontos kann nicht zusammengeführt werden.');
  let moved = 0;
  for (const t of await tx.objectStore('transactions').getAll()) if (t.categoryId === src.id) { await tx.objectStore('transactions').put({ ...t, categoryId: dst.id }); moved++; }
  for (const r of await tx.objectStore('recurring').getAll()) if (r.categoryId === src.id) await tx.objectStore('recurring').put({ ...r, categoryId: dst.id });
  const budgets = await tx.objectStore('budgets').getAll();
  for (const b of budgets) {
    if (b.categoryId !== src.id) continue;
    await tx.objectStore('budgets').delete(b.id);
    // Budget des Ziels hat Vorrang; nur übernehmen, wenn das Ziel für diesen Monat noch keins hat
    if (dst.parentId === null && !budgets.some((x) => x.categoryId === dst.id && x.monthKey === b.monthKey)) {
      await tx.objectStore('budgets').put({ ...b, id: `cat:${dst.id}:${b.monthKey}`, categoryId: dst.id });
    }
  }
  await tx.objectStore('categories').delete(src.id);
  await tx.done;
  return moved;
}
