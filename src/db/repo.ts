import { CAT_ICON_KEYS } from '../domain/catIcons';
import type { AnyTx, Db } from './db';
import { DB_VERSION } from './db';
import type { BackupData, Budget, Category, CatGroup, DepotEntry, JointSettings, Recurring, SavingsEntry, SavingsGoal, Settings, Transaction, TxType } from '../domain/types';
import { AppError, DEFAULT_SETTINGS, isHouseholdCat, newId } from '../domain/types';
import { isValidISODate, isValidMonthKey, shiftMonth } from '../domain/dates';
import { validateAmountCents, validateBackupData, validateName } from '../domain/validate';
import { yearlyShare } from '../domain/calc';
import { buildSeed } from '../domain/seed';
import { MAX_CENTS } from '../domain/money';

/** Bricht eine Transaktion ab, ohne dass daraus eine unbehandelte Promise-Ablehnung entsteht. */
function abortTx(tx: { abort: () => void; done: Promise<void> }): void {
  tx.done.catch(() => undefined);
  tx.abort();
}

const DATA_STORES = ['categories', 'transactions', 'budgets', 'recurring', 'recurringRuns', 'depotEntries', 'settings'] as const;
const ALL_STORES = [...DATA_STORES, 'meta'] as const;

async function readAll(tx: AnyTx): Promise<BackupData> {
  const [categories, transactions, budgets, recurring, recurringRuns, depotEntries, settingsRec] = await Promise.all([
    tx.objectStore('categories').getAll(),
    tx.objectStore('transactions').getAll(),
    tx.objectStore('budgets').getAll(),
    tx.objectStore('recurring').getAll(),
    tx.objectStore('recurringRuns').getAll(),
    tx.objectStore('depotEntries').index('by-date').getAll(),
    tx.objectStore('settings').get('app')
  ]);
  return { categories, transactions, budgets, recurring, recurringRuns, depotEntries, settings: settingsRec?.value ?? { ...DEFAULT_SETTINGS } };
}

/** Konsistenter Gesamtstand (eine Lese-Transaktion über alle Datenbereiche). */
export async function exportAll(db: Db): Promise<BackupData> {
  const tx = db.transaction([...ALL_STORES], 'readonly');
  const data = await readAll(tx as unknown as AnyTx);
  await tx.done;
  return data;
}

export async function getMeta<T = unknown>(db: Db, key: string): Promise<T | undefined> {
  return (await db.get('meta', key))?.value as T | undefined;
}
export async function setMeta(db: Db, key: string, value: unknown): Promise<void> {
  await db.put('meta', { key, value });
}

export async function getSettings(db: Db): Promise<Settings> {
  return (await db.get('settings', 'app'))?.value ?? { ...DEFAULT_SETTINGS };
}
export async function saveSettings(db: Db, s: Settings): Promise<void> {
  // Mit den echten Kategorien prüfen: Gemeinsames Konto und gemerkte Import-Zuordnungen verweisen auf Kategorien.
  // (Früher wurde mit einer leeren Kategorienliste geprüft – dann schlug jedes Speichern fehl, sobald das gemeinsame
  // Konto eingerichtet oder ein CSV-Import gemacht war.)
  const tx = db.transaction(['categories', 'settings'], 'readwrite');
  const categories = await tx.objectStore('categories').getAll();
  const check = validateBackupData({ categories, transactions: [], budgets: [], recurring: [], recurringRuns: [], depotEntries: [], settings: s });
  if (!check.ok) {
    abortTx(tx);
    const sum = s.split.fix + s.split.alltag + s.split.spar;
    throw new AppError(sum > 100 ? 'Die Anteile dürfen zusammen höchstens 100 % ergeben.' : 'Die Einstellungen konnten nicht gespeichert werden, weil ein Wert ungültig ist. Es wurde nichts verändert.');
  }
  await tx.objectStore('settings').put({ key: 'app', value: check.data.settings });
  await tx.done;
}

/* ───────── Sparkonto-Stände ───────── */

/** Alle Stände des Sparkontos, neueste zuerst. Ältere Installationen haben nur den letzten Stand. */
export function savingsEntries(s: Settings): SavingsEntry[] {
  const h = s.savingsHistory ?? (s.savingsBalanceDate ? [{ date: s.savingsBalanceDate, cents: s.savingsBalanceCents }] : []);
  return [...h].sort((a, b) => b.date.localeCompare(a.date));
}

async function writeSavings(db: Db, change: (h: SavingsEntry[]) => SavingsEntry[]): Promise<void> {
  const tx = db.transaction('settings', 'readwrite');
  const cur = (await tx.store.get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  const h = change(savingsEntries(cur)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 400);
  const latest = h[0];
  await tx.store.put({ key: 'app', value: { ...cur, savingsHistory: h, savingsBalanceCents: latest?.cents ?? 0, savingsBalanceDate: latest?.date ?? null } });
  await tx.done;
}

/** Kontostand des Sparkontos zu einem Datum (Korrektur). Pro Tag ein Eintrag; ein zweiter ersetzt den ersten. */
export async function addSavingsEntry(db: Db, date: string, cents: number): Promise<void> {
  if (!isValidISODate(date)) throw new AppError('Ungültiges Datum.');
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_CENTS) throw new AppError('Bitte gib einen gültigen Kontostand ein.');
  await writeSavings(db, (h) => [...h.filter((e) => e.date !== date), { date, cents }]);
}

export async function deleteSavingsEntry(db: Db, date: string): Promise<void> {
  await writeSavings(db, (h) => h.filter((e) => e.date !== date));
}

/* ───────── Sparziele ───────── */

export interface GoalInput { name: string; targetCents: number; savedCents: number; dueMonth: string }

/** Sparziel anlegen (id = null) oder ändern. */
export async function saveGoal(db: Db, id: string | null, input: GoalInput): Promise<SavingsGoal> {
  const name = validateName(input.name, 'Namen');
  if (name.length > 40) throw new AppError('Der Name darf höchstens 40 Zeichen lang sein.');
  if (!Number.isInteger(input.targetCents) || input.targetCents < 1 || input.targetCents > MAX_CENTS) throw new AppError('Bitte gib einen gültigen Zielbetrag ein.');
  if (!Number.isInteger(input.savedCents) || input.savedCents < 0 || input.savedCents > MAX_CENTS) throw new AppError('Bitte gib einen gültigen angesparten Betrag ein.');
  if (!isValidMonthKey(input.dueMonth)) throw new AppError('Bitte wähle einen Zielmonat.');
  const tx = db.transaction('settings', 'readwrite');
  const cur = (await tx.store.get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  const goals = [...(cur.savingsGoals ?? [])];
  const i = id ? goals.findIndex((g) => g.id === id) : -1;
  if (id && i < 0) { abortTx(tx); throw new AppError('Das Sparziel wurde nicht gefunden.'); }
  if (!id && goals.length >= 50) { abortTx(tx); throw new AppError('Es sind höchstens 50 Sparziele möglich.'); }
  const g: SavingsGoal = { id: id ?? newId(), name, targetCents: input.targetCents, savedCents: input.savedCents, dueMonth: input.dueMonth, createdAt: i >= 0 ? (goals[i] as SavingsGoal).createdAt : new Date().toISOString() };
  if (i >= 0) goals[i] = g; else goals.push(g);
  await tx.store.put({ key: 'app', value: { ...cur, savingsGoals: goals } });
  await tx.done;
  return g;
}

/** Sparziel löschen; gibt das gelöschte Ziel zurück (für „Rückgängig“). */
export async function deleteGoal(db: Db, id: string): Promise<SavingsGoal | undefined> {
  const tx = db.transaction('settings', 'readwrite');
  const cur = (await tx.store.get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  const g = (cur.savingsGoals ?? []).find((x) => x.id === id);
  await tx.store.put({ key: 'app', value: { ...cur, savingsGoals: (cur.savingsGoals ?? []).filter((x) => x.id !== id) } });
  await tx.done;
  return g;
}

/** Gelöschtes Sparziel wiederherstellen. */
export async function restoreGoal(db: Db, g: SavingsGoal): Promise<void> {
  const tx = db.transaction('settings', 'readwrite');
  const cur = (await tx.store.get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  if (!(cur.savingsGoals ?? []).some((x) => x.id === g.id)) await tx.store.put({ key: 'app', value: { ...cur, savingsGoals: [...(cur.savingsGoals ?? []), g] } });
  await tx.done;
}

/* ───────── Buchungen ───────── */

export interface TxInput { date: string; type: TxType; amountCents: number; categoryId: string; description: string; account?: 'joint' }

const SCOPE_MSG = 'Die Kategorie gehört zum anderen Konto. Haushaltskonto und eigenes Konto haben getrennte Kategorien.';
async function checkCategoryFor(db: Db, categoryId: string, type: TxType, allowArchived: boolean, account?: 'joint'): Promise<void> {
  const cat = await db.get('categories', categoryId);
  if (!cat) throw new AppError('Die gewählte Kategorie existiert nicht mehr.');
  if (cat.kind !== type) throw new AppError('Die Kategorie passt nicht zur Buchungsart (Einnahme/Ausgabe).');
  if (cat.archived && !allowArchived) throw new AppError('Die gewählte Kategorie ist archiviert.');
  if (isHouseholdCat(cat) !== (account === 'joint')) throw new AppError(SCOPE_MSG);
}
function cleanTx(i: TxInput): TxInput {
  if (!isValidISODate(i.date)) throw new AppError('Bitte wähle ein gültiges Datum.');
  if (i.type !== 'income' && i.type !== 'expense') throw new AppError('Ungültige Buchungsart.');
  const description = (i.description ?? '').trim();
  if (description.length > 200) throw new AppError('Die Beschreibung darf höchstens 200 Zeichen lang sein.');
  if (i.account !== undefined && (i.account !== 'joint' || i.type !== 'expense')) throw new AppError('Vom gemeinsamen Konto können nur Ausgaben gebucht werden.');
  const out: TxInput = { date: i.date, type: i.type, amountCents: validateAmountCents(i.amountCents), categoryId: i.categoryId, description };
  if (i.account === 'joint') out.account = 'joint';
  return out;
}

export async function addTransaction(db: Db, input: TxInput): Promise<Transaction> {
  const i = cleanTx(input);
  await checkCategoryFor(db, i.categoryId, i.type, false, i.account);
  const t: Transaction = { id: newId(), createdAt: new Date().toISOString(), ...i };
  await db.add('transactions', t);
  return t;
}

export async function updateTransaction(db: Db, id: string, input: TxInput): Promise<Transaction> {
  const i = cleanTx(input);
  const tx = db.transaction(['transactions', 'categories'], 'readwrite');
  const old = await tx.objectStore('transactions').get(id);
  if (!old) { abortTx(tx); throw new AppError('Die Buchung wurde nicht gefunden.'); }
  const cat = await tx.objectStore('categories').get(i.categoryId);
  if (!cat || cat.kind !== i.type) { abortTx(tx); throw new AppError('Die Kategorie passt nicht zur Buchungsart.'); }
  if (cat.archived && old.categoryId !== i.categoryId) { abortTx(tx); throw new AppError('Die gewählte Kategorie ist archiviert.'); }
  if (isHouseholdCat(cat) !== (i.account === 'joint')) { abortTx(tx); throw new AppError(SCOPE_MSG); }
  const t: Transaction = { ...old, ...i, updatedAt: new Date().toISOString() };
  if (!i.account) delete t.account;
  await tx.objectStore('transactions').put(t);
  await tx.done;
  return t;
}

export async function deleteTransaction(db: Db, id: string): Promise<void> {
  await db.delete('transactions', id);
}

/** Löscht mehrere Buchungen in einer Transaktion (alles oder nichts) und gibt die gelöschten Datensätze zurück (für „Rückgängig“). */
export async function deleteTransactions(db: Db, ids: string[]): Promise<Transaction[]> {
  const tx = db.transaction('transactions', 'readwrite');
  const removed: Transaction[] = [];
  for (const id of ids) {
    const t = await tx.store.get(id);
    if (!t) continue;
    removed.push(t);
    await tx.store.delete(id);
  }
  await tx.done;
  return removed;
}

/** Stellt zuvor gelöschte Buchungen unverändert wieder her (gleiche IDs). Verweise auf gelöschte Vorlagen/Kategorien werden geprüft. */
export async function restoreTransactions(db: Db, txs: Transaction[]): Promise<void> {
  const tx = db.transaction(['transactions', 'categories', 'recurring'], 'readwrite');
  for (const t of txs) {
    const cat = await tx.objectStore('categories').get(t.categoryId);
    if (!cat || cat.kind !== t.type) { abortTx(tx); throw new AppError('Die Buchung kann nicht wiederhergestellt werden, weil ihre Kategorie fehlt.'); }
    const rec: Transaction = { ...t };
    if (rec.recurringId && !(await tx.objectStore('recurring').get(rec.recurringId))) delete rec.recurringId;
    await tx.objectStore('transactions').put(rec);
  }
  await tx.done;
}

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
  if (all.some((c) => c.parentId === input.parentId && c.kind === kind && isHouseholdCat(c) === household && c.name.toLowerCase() === name.toLowerCase())) {
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

/** Verschiebt eine Kategorie innerhalb ihrer Ebene um eine Position nach oben (-1) oder unten (+1). */
export async function moveCategoryOrder(db: Db, id: string, dir: -1 | 1): Promise<void> {
  const tx = db.transaction('categories', 'readwrite');
  const all = await tx.store.getAll();
  const c = all.find((x) => x.id === id);
  if (!c) { abortTx(tx); throw new AppError('Die Kategorie wurde nicht gefunden.'); }
  const sib = all.filter((x) => x.parentId === c.parentId && x.kind === c.kind).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'));
  const i = sib.findIndex((x) => x.id === id), j = i + dir;
  if (j < 0 || j >= sib.length) { await tx.done; return; }
  // Lückenlos neu nummerieren und die beiden tauschen (robust auch bei doppelten sort-Werten)
  [sib[i], sib[j]] = [sib[j] as Category, sib[i] as Category];
  const base = Math.min(...sib.map((x) => x.sort));
  for (let k = 0; k < sib.length; k++) { const x = sib[k] as Category; if (x.sort !== base + k) await tx.store.put({ ...x, sort: base + k }); }
  await tx.done;
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

/** Reihenfolge von Fixkosten-Positionen (innerhalb einer Hauptkategorie) */
export async function setRecurringOrder(db: Db, ids: string[]): Promise<void> {
  const tx = db.transaction('recurring', 'readwrite');
  for (let k = 0; k < ids.length; k++) {
    const r = await tx.store.get(ids[k] as string);
    if (!r) { abortTx(tx); throw new AppError('Die Vorlage wurde nicht gefunden.'); }
    if (r.sort !== k) await tx.store.put({ ...r, sort: k });
  }
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

/* ───────── Budgets ───────── */

export async function setBudget(db: Db, p: { scope: 'month' | 'category'; monthKey: string; categoryId?: string; amountCents: number | null }): Promise<void> {
  if (!(p.monthKey === 'default' || isValidMonthKey(p.monthKey))) throw new AppError('Ungültiger Monat.');
  const id = p.scope === 'month' ? `month:${p.monthKey}` : `cat:${p.categoryId}:${p.monthKey}`;
  // Auch ältere/fremde Datensätze mit gleichem Schlüssel entfernen, damit pro Budget genau ein Wert existiert.
  const dupes = (await db.getAll('budgets')).filter((b) => b.id !== id && b.scope === p.scope && b.monthKey === p.monthKey && b.categoryId === p.categoryId);
  for (const d of dupes) await db.delete('budgets', d.id);
  if (p.amountCents === null) { await db.delete('budgets', id); return; }
  if (!Number.isSafeInteger(p.amountCents) || p.amountCents < 0) throw new AppError('Bitte gib einen gültigen Betrag ein.');
  if (p.scope === 'category') {
    if (!p.categoryId || !(await db.get('categories', p.categoryId))) throw new AppError('Die Kategorie existiert nicht mehr.');
  }
  const b: Budget = { id, scope: p.scope, monthKey: p.monthKey, amountCents: p.amountCents };
  if (p.scope === 'category') b.categoryId = p.categoryId as string;
  await db.put('budgets', b);
}

/* ───────── Wiederkehrende Buchungen ───────── */

export interface RecurringInput {
  name: string; type: TxType; categoryId: string; startMonth: string; day: number; active: boolean;
  /** Monatlich: Betrag pro Monat. Jährlich: Jahresbetrag, der auf 12 Monate verteilt wird. */
  interval?: 'monthly' | 'yearly';
  amountCents: number;
  /** Nur jährlich: Monat 1–12, in dem die Zahlung anfällt (optional) */
  dueMonth?: number | null;
  /** Kündigungsfrist (optional, freier Text); leer = keine */
  notice?: string | null;
}

export { yearlyShare } from '../domain/calc';

export async function saveRecurring(db: Db, id: string | null, input: RecurringInput, currentMonth: string): Promise<Recurring> {
  const name = validateName(input.name, 'Namen');
  const amountCents = validateAmountCents(input.amountCents);
  if (!isValidMonthKey(input.startMonth)) throw new AppError('Ungültiger Startmonat.');
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 28) throw new AppError('Der Tag muss zwischen 1 und 28 liegen.');
  const tx = db.transaction(['recurring', 'categories'], 'readwrite');
  const cat = await tx.objectStore('categories').get(input.categoryId);
  if (!cat || cat.kind !== input.type) { abortTx(tx); throw new AppError('Die Kategorie passt nicht zur Art der Buchung.'); }
  const old = id ? await tx.objectStore('recurring').get(id) : undefined;
  if (id && !old) { abortTx(tx); throw new AppError('Die Vorlage wurde nicht gefunden.'); }
  let startMonth = input.startMonth;
  // Wer eine pausierte Vorlage wieder aktiviert, bekommt keine nachträglichen Buchungen für die Pause –
  // außer der Beginn („Gilt ab“) wurde dabei bewusst geändert.
  if (old && !old.active && input.active && startMonth < currentMonth && startMonth === old.startMonth) startMonth = currentMonth;
  const yearly = input.interval === 'yearly';
  if (yearly && amountCents < 12) { abortTx(tx); throw new AppError('Der Jahresbetrag muss mindestens 0,12 € betragen.'); }
  const r: Recurring = {
    id: old?.id ?? newId(), name, type: input.type, amountCents: yearly ? Math.round(amountCents / 12) : amountCents,
    categoryId: input.categoryId, startMonth, day: input.day, active: input.active, createdAt: old?.createdAt ?? new Date().toISOString()
  };
  if (yearly) {
    r.interval = 'yearly'; r.yearlyCents = amountCents;
    if (input.dueMonth != null) {
      if (!Number.isInteger(input.dueMonth) || input.dueMonth < 1 || input.dueMonth > 12) { abortTx(tx); throw new AppError('Bitte wähle einen gültigen Fälligkeitsmonat.'); }
      r.dueMonth = input.dueMonth;
    }
  }
  if (old?.endMonth && old.endMonth >= startMonth) r.endMonth = old.endMonth;
  if (old?.sort !== undefined) r.sort = old.sort;
  const notice = input.notice === undefined ? old?.notice : (input.notice ?? '').trim();
  if (notice) {
    if (notice.length > 80) { abortTx(tx); throw new AppError('Die Kündigungsfrist darf höchstens 80 Zeichen lang sein.'); }
    r.notice = notice;
  }
  await tx.objectStore('recurring').put(r);
  await tx.done;
  return r;
}

/** Entfernt die Vorlage. Bereits erzeugte Buchungen bleiben erhalten (ohne Verweis auf die Vorlage). */
export async function deleteRecurring(db: Db, id: string): Promise<void> {
  const tx = db.transaction(['recurring', 'recurringRuns', 'transactions'], 'readwrite');
  for (const t of await tx.objectStore('transactions').getAll()) {
    if (t.recurringId === id) { const { recurringId: _r, ...rest } = t; void _r; await tx.objectStore('transactions').put(rest); }
  }
  for (const run of await tx.objectStore('recurringRuns').index('by-recurring').getAll(id)) await tx.objectStore('recurringRuns').delete(run.key);
  await tx.objectStore('recurring').delete(id);
  await tx.done;
}

/**
 * Erzeugt fehlende Buchungen aller aktiven Vorlagen bis einschließlich currentMonth.
 * Idempotent: pro Vorlage und Monat höchstens eine Buchung. Wer eine erzeugte Buchung löscht,
 * bekommt sie nicht erneut (der Merker in recurringRuns bleibt bestehen).
 */
export async function runRecurring(db: Db, currentMonth: string): Promise<number> {
  const tx = db.transaction(['recurring', 'recurringRuns', 'transactions', 'categories'], 'readwrite');
  const recs = await tx.objectStore('recurring').getAll();
  const have = new Set((await tx.objectStore('recurringRuns').getAll()).map((r) => r.key));
  const cats = new Set((await tx.objectStore('categories').getAll()).map((c) => c.id));
  let created = 0;
  const now = new Date().toISOString();
  // Bestehende Buchungen nur laden, wenn wirklich etwas nachzubuchen ist
  let existing: Transaction[] | null = null;
  for (const r of recs) {
    if (!r.active || !cats.has(r.categoryId)) continue;
    const last = r.endMonth && r.endMonth < currentMonth ? r.endMonth : currentMonth;
    for (let m = r.startMonth, guard = 0; m <= last && guard < 600; m = shiftMonth(m, 1), guard++) {
      const key = `${r.id}:${m}`;
      if (have.has(key)) continue;
      const amountCents = r.interval === 'yearly' && r.yearlyCents ? yearlyShare(r.yearlyCents, m) : r.amountCents;
      // Ist die Ausgabe in diesem Monat schon gebucht (z. B. per CSV importiert oder von Hand), wird sie
      // der Vorlage zugeordnet statt doppelt gebucht: gleiche Art, gleiche Kategorie, gleicher Betrag.
      existing ??= (await tx.objectStore('transactions').getAll()) as Transaction[];
      const match = existing.find((t) => !t.recurringId && !t.account && t.type === r.type && t.categoryId === r.categoryId
        && t.amountCents === amountCents && t.date.slice(0, 7) === m);
      if (match) {
        match.recurringId = r.id;
        await tx.objectStore('transactions').put(match);
      } else {
        const t: Transaction = {
          id: newId(), date: `${m}-${String(r.day).padStart(2, '0')}`, type: r.type, amountCents,
          categoryId: r.categoryId, description: r.name, createdAt: now, recurringId: r.id
        };
        await tx.objectStore('transactions').add(t);
        existing.push(t);
      }
      await tx.objectStore('recurringRuns').put({ key, recurringId: r.id, month: m, createdAt: now });
      created++;
    }
  }
  await tx.done;
  return created;
}

/* ───────── Gehalt (Basis der Aufteilung) ───────── */

/**
 * Setzt das monatliche Gehalt: aktualisiert die Gehalts-Vorlage (oder legt sie an) und die Basis der Aufteilung
 * in einer Transaktion. Bereits gebuchte Monate bleiben unverändert.
 */
export async function saveSalary(db: Db, amountCents: number, day: number, currentMonth: string, startMonth?: string): Promise<void> {
  const amount = validateAmountCents(amountCents);
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new AppError('Der Tag muss zwischen 1 und 28 liegen.');
  if (startMonth !== undefined && !isValidMonthKey(startMonth)) throw new AppError('Ungültiger Startmonat.');
  const tx = db.transaction(['recurring', 'categories', 'settings'], 'readwrite');
  const cats = await tx.objectStore('categories').getAll();
  const salaryCat = cats.find((c) => c.kind === 'income' && c.parentId === null && c.name === 'Gehalt') ?? cats.find((c) => c.kind === 'income' && !c.archived);
  if (!salaryCat) { abortTx(tx); throw new AppError('Lege zuerst eine Einnahmen-Kategorie an.'); }
  const recs = await tx.objectStore('recurring').getAll();
  const existing = recs.find((r) => r.type === 'income' && r.categoryId === salaryCat.id) ?? recs.find((r) => r.type === 'income');
  const r: Recurring = existing
    ? { ...existing, amountCents: amount, day, active: true, startMonth: startMonth ?? existing.startMonth }
    : { id: newId(), name: 'Gehalt', type: 'income', amountCents: amount, categoryId: salaryCat.id, startMonth: startMonth ?? currentMonth, day, active: true, createdAt: new Date().toISOString() };
  // Pausiertes Gehalt wieder aktiv: keine Nachbuchung für die Pause – außer „Gilt ab“ wurde bewusst geändert
  if (existing && !existing.active && r.startMonth < currentMonth && r.startMonth === existing.startMonth) r.startMonth = currentMonth;
  await tx.objectStore('recurring').put(r);
  const s = (await tx.objectStore('settings').get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  await tx.objectStore('settings').put({ key: 'app', value: { ...s, expectedIncomeCents: amount } });
  await tx.done;
}

/* ───────── CSV-Import ───────── */

export interface ImportItem { date: string; type: TxType; amountCents: number; categoryId: string; description: string; importId: string; account?: 'joint' }

/**
 * Übernimmt geprüfte CSV-Zeilen in EINER Transaktion (alles oder nichts) und merkt sich die Zuordnungen
 * (Empfänger → Kategorie). Zeilen, deren importId schon existiert, werden übersprungen. Gibt die neuen IDs zurück.
 */
export async function importTransactions(db: Db, items: ImportItem[], rules: Record<string, string>): Promise<string[]> {
  if (items.length > 5000) throw new AppError('Zu viele Buchungen auf einmal.');
  const clean = items.map((i) => {
    const t = cleanTx({ date: i.date, type: i.type, amountCents: i.amountCents, categoryId: i.categoryId, description: i.description, ...(i.account ? { account: i.account } : {}) });
    if (typeof i.importId !== 'string' || !i.importId || i.importId.length > 64) throw new AppError('Ungültige Import-Kennung.');
    return { ...t, importId: i.importId };
  });
  const tx = db.transaction(['transactions', 'categories', 'settings'], 'readwrite');
  const cats = new Map((await tx.objectStore('categories').getAll()).map((c) => [c.id, c]));
  const existing = new Set((await tx.objectStore('transactions').getAll()).map((t) => t.importId).filter(Boolean));
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (const i of clean) {
    if (existing.has(i.importId)) continue;
    const c = cats.get(i.categoryId);
    if (!c || c.kind !== i.type || isHouseholdCat(c) !== (i.account === 'joint') || [...cats.values()].some((x) => x.parentId === c.id)) { abortTx(tx); throw new AppError('Eine gewählte Kategorie passt nicht. Es wurde nichts importiert.'); }
    const t: Transaction = { id: newId(), createdAt: now, ...i };
    await tx.objectStore('transactions').add(t);
    existing.add(i.importId);
    ids.push(t.id);
  }
  const s = (await tx.objectStore('settings').get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  const merged = { ...(s.importRules ?? {}) };
  for (const [k, v] of Object.entries(rules)) if (k && k.length <= 80 && cats.has(v)) merged[k] = v;
  await tx.objectStore('settings').put({ key: 'app', value: { ...s, importRules: merged } });
  await tx.done;
  return ids;
}

/** Nimmt einen Import zurück: löscht genau die dabei angelegten Buchungen (eine Transaktion). */
export async function undoImport(db: Db, ids: string[]): Promise<number> {
  const tx = db.transaction('transactions', 'readwrite');
  let n = 0;
  for (const id of ids) { const t = await tx.store.get(id); if (t?.importId) { await tx.store.delete(id); n++; } }
  await tx.done;
  return n;
}

/* ───────── Kategorien des Haushaltskontos ───────── */

const HOUSEHOLD_STARTER: [string, string[]][] = [['Lebensmittel', ['Einkaufen', 'Getränke']], ['Haushalt', ['Drogerie', 'Putzmittel']]];

/**
 * Sorgt dafür, dass das Haushaltskonto eine eigene Kategorienliste hat (idempotent, eine Transaktion):
 * - Buchungen des Haushaltskontos, die noch auf Kategorien des eigenen Kontos zeigen (vor Version 1.12 oder aus
 *   älteren Backups), bekommen eine gleichnamige Kategorie in der Haushaltsliste.
 * - Ist das gemeinsame Konto eingerichtet, aber die Liste leer, werden ein paar Startkategorien angelegt.
 * Gibt die Zahl der umgehängten Buchungen zurück.
 */
export async function ensureHouseholdCategories(db: Db): Promise<number> {
  const tx = db.transaction(['categories', 'transactions', 'settings'], 'readwrite');
  const cs = tx.objectStore('categories');
  const all = await cs.getAll();
  const settings = (await tx.objectStore('settings').get('app'))?.value;
  const jointTx = (await tx.objectStore('transactions').getAll()).filter((t) => t.account === 'joint');
  let sort = Math.max(-1, ...all.map((x) => x.sort)) + 1;
  const now = new Date().toISOString();
  const find = (name: string, parentId: string | null) => all.find((c) => isHouseholdCat(c) && c.parentId === parentId && c.name.toLowerCase() === name.toLowerCase());
  const make = async (name: string, parentId: string | null): Promise<Category> => {
    const c: Category = { id: newId(), name, kind: 'expense', group: 'alltag', parentId, archived: false, sort: sort++, createdAt: now, scope: 'joint' };
    await cs.add(c); all.push(c); return c;
  };
  let moved = 0;
  for (const t of jointTx) {
    const c = all.find((x) => x.id === t.categoryId);
    if (!c || isHouseholdCat(c)) continue;
    const top = c.parentId ? all.find((x) => x.id === c.parentId) : c;
    if (!top) continue;
    const jTop = find(top.name, null) ?? await make(top.name, null);
    const target = c.parentId ? (find(c.name, jTop.id) ?? await make(c.name, jTop.id)) : jTop;
    await tx.objectStore('transactions').put({ ...t, categoryId: target.id });
    moved++;
  }
  if (settings?.joint?.enabled && !all.some(isHouseholdCat)) {
    for (const [top, subs] of HOUSEHOLD_STARTER) { const tp = await make(top, null); for (const s of subs) await make(s, tp.id); }
  }
  await tx.done;
  return moved;
}

/* ───────── Gemeinsames Konto ───────── */

export const JOINT_CATEGORY_NAME = 'Gemeinsames Konto';

export interface JointSetupInput { name: string; partnerName: string; myCents: number; day: number; partnerDefaultCents: number }

/**
 * Richtet das gemeinsame Konto ein oder ändert es (eine Transaktion):
 * Kategorie „Gemeinsames Konto“ (Alltag) für den eigenen Beitrag, monatliche Vorlage dafür, Einstellungen.
 * Bestehende Buchungen bleiben unverändert; ein geänderter Beitrag gilt ab dem nächsten erzeugten Monat.
 */
export async function saveJointSetup(db: Db, input: JointSetupInput, currentMonth: string): Promise<void> {
  const name = (input.name ?? '').trim() || 'Haushaltskonto';
  if (name.length > 40 || (input.partnerName ?? '').trim().length > 40) throw new AppError('Die Namen dürfen höchstens 40 Zeichen lang sein.');
  const my = validateAmountCents(input.myCents);
  if (!Number.isSafeInteger(input.partnerDefaultCents) || input.partnerDefaultCents < 0) throw new AppError('Bitte gib einen gültigen Beitrag der anderen Person ein.');
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 28) throw new AppError('Der Tag muss zwischen 1 und 28 liegen.');
  const tx = db.transaction(['categories', 'recurring', 'settings'], 'readwrite');
  const cats = await tx.objectStore('categories').getAll();
  const s = (await tx.objectStore('settings').get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  let cat = (s.joint?.categoryId ? cats.find((c) => c.id === s.joint?.categoryId) : undefined)
    ?? cats.find((c) => c.parentId === null && c.kind === 'expense' && c.name === JOINT_CATEGORY_NAME);
  const now = new Date().toISOString();
  if (!cat) {
    cat = { id: newId(), name: JOINT_CATEGORY_NAME, kind: 'expense', group: 'alltag', parentId: null, archived: false, sort: -1, createdAt: now };
  } else if (cat.archived) {
    cat = { ...cat, archived: false };
  }
  await tx.objectStore('categories').put(cat);
  const recs = await tx.objectStore('recurring').getAll();
  const old = recs.find((r) => r.categoryId === cat.id && r.type === 'expense');
  const rec: Recurring = old
    ? { ...old, name: `Beitrag ${name}`, amountCents: my, day: input.day, active: true, startMonth: !old.active && old.startMonth < currentMonth ? currentMonth : old.startMonth }
    : { id: newId(), name: `Beitrag ${name}`, type: 'expense', amountCents: my, categoryId: cat.id, startMonth: currentMonth, day: input.day, active: true, createdAt: now };
  await tx.objectStore('recurring').put(rec);
  // Übertrag: bei Neueinrichtung oder Wiedereinschalten ab dem aktuellen Monat, sonst unverändert
  const startMonth = s.joint?.enabled ? (s.joint.startMonth ?? undefined) : currentMonth;
  const joint: JointSettings = { enabled: true, name, partnerName: (input.partnerName ?? '').trim(), categoryId: cat.id, partnerDefaultCents: input.partnerDefaultCents, partnerByMonth: s.joint?.partnerByMonth ?? {} };
  if (startMonth) joint.startMonth = startMonth;
  await tx.objectStore('settings').put({ key: 'app', value: { ...s, joint } });
  await tx.done;
}

/** Abweichender Beitrag der anderen Person für einen Monat (null = wieder der übliche Betrag). */
export async function setPartnerMonth(db: Db, monthKey: string, cents: number | null): Promise<void> {
  if (!isValidMonthKey(monthKey)) throw new AppError('Ungültiger Monat.');
  if (cents !== null && (!Number.isSafeInteger(cents) || cents < 0)) throw new AppError('Bitte gib einen gültigen Betrag ein.');
  const tx = db.transaction('settings', 'readwrite');
  const s = (await tx.store.get('app'))?.value;
  if (!s?.joint) { abortTx(tx); throw new AppError('Das gemeinsame Konto ist nicht eingerichtet.'); }
  const byMonth = { ...s.joint.partnerByMonth };
  if (cents === null) delete byMonth[monthKey]; else byMonth[monthKey] = cents;
  await tx.store.put({ key: 'app', value: { ...s, joint: { ...s.joint, partnerByMonth: byMonth } } });
  await tx.done;
}

/** Startet den Übertrag ab einem Monat neu (z. B. nach Abgleich mit dem echten Kontostand). */
export async function resetJointCarry(db: Db, monthKey: string): Promise<void> {
  if (!isValidMonthKey(monthKey)) throw new AppError('Ungültiger Monat.');
  const tx = db.transaction('settings', 'readwrite');
  const s = (await tx.store.get('app'))?.value;
  if (!s?.joint) { abortTx(tx); throw new AppError('Das gemeinsame Konto ist nicht eingerichtet.'); }
  await tx.store.put({ key: 'app', value: { ...s, joint: { ...s.joint, startMonth: monthKey } } });
  await tx.done;
}

/** Schaltet das gemeinsame Konto aus (Buchungen und Kategorie bleiben erhalten, der eigene Beitrag wird pausiert). */
export async function disableJoint(db: Db): Promise<void> {
  const tx = db.transaction(['recurring', 'settings'], 'readwrite');
  const s = (await tx.objectStore('settings').get('app'))?.value;
  if (!s?.joint) { await tx.done; return; }
  for (const r of await tx.objectStore('recurring').getAll()) {
    if (r.categoryId === s.joint.categoryId && r.active) await tx.objectStore('recurring').put({ ...r, active: false });
  }
  await tx.objectStore('settings').put({ key: 'app', value: { ...s, joint: { ...s.joint, enabled: false } } });
  await tx.done;
}

/* ───────── Depot-Verlauf ───────── */

/** Erfasst einen Depotstand. Pro Tag gibt es höchstens einen Eintrag; ein zweiter am selben Tag ersetzt den ersten. */
export async function addDepotEntry(db: Db, date: string, valueCents: number): Promise<DepotEntry> {
  if (!isValidISODate(date)) throw new AppError('Bitte wähle ein gültiges Datum.');
  if (!Number.isSafeInteger(valueCents) || valueCents < 0 || valueCents > 9_999_999_999) throw new AppError('Bitte gib einen gültigen Depotwert ein.');
  const tx = db.transaction('depotEntries', 'readwrite');
  const same = await tx.store.index('by-date').get(date);
  const e: DepotEntry = { id: same?.id ?? newId(), date, valueCents, createdAt: new Date().toISOString() };
  await tx.store.put(e);
  await tx.done;
  return e;
}
export async function deleteDepotEntry(db: Db, id: string): Promise<void> {
  await db.delete('depotEntries', id);
}

/* ───────── Gesamtstand ersetzen, Sicherung vor dem Import ───────── */

export interface PreImportSnapshot { createdAt: string; schemaVersion: number; data: BackupData }

/**
 * Ersetzt alle Daten in EINER Transaktion. Vorher wird der bisherige Stand als lokale Sicherung abgelegt.
 * Schlägt irgendein Schritt fehl, wird die Transaktion verworfen und die vorhandenen Daten bleiben unverändert.
 */
export async function replaceAll(db: Db, input: BackupData, opts: { keepSnapshot?: boolean } = {}): Promise<void> {
  const check = validateBackupData(input);
  if (!check.ok) throw new AppError('Die Daten sind nicht gültig und wurden nicht übernommen.');
  const data = check.data;
  const tx = db.transaction([...ALL_STORES], 'readwrite') as unknown as AnyTx;
  try {
    if (opts.keepSnapshot !== false) {
      const prev = await readAll(tx);
      const snap: PreImportSnapshot = { createdAt: new Date().toISOString(), schemaVersion: DB_VERSION, data: prev };
      await tx.objectStore('meta').put({ key: 'preImportSnapshot', value: snap });
    }
    for (const s of DATA_STORES) await tx.objectStore(s).clear();
    for (const c of data.categories) await tx.objectStore('categories').put(c);
    for (const t of data.transactions) await tx.objectStore('transactions').put(t);
    for (const b of data.budgets) await tx.objectStore('budgets').put(b);
    for (const r of data.recurring) await tx.objectStore('recurring').put(r);
    for (const r of data.recurringRuns) await tx.objectStore('recurringRuns').put(r);
    for (const d of data.depotEntries) await tx.objectStore('depotEntries').put(d);
    await tx.objectStore('settings').put({ key: 'app', value: data.settings });
    await tx.objectStore('meta').put({ key: 'seeded', value: true });
    await tx.done;
  } catch (e) {
    try { abortTx(tx); } catch { /* Transaktion ist bereits beendet */ }
    throw e instanceof AppError ? e : new AppError('Die Daten konnten nicht gespeichert werden. Es wurde nichts verändert.');
  }
}

export async function getPreImportSnapshot(db: Db): Promise<PreImportSnapshot | undefined> {
  return getMeta<PreImportSnapshot>(db, 'preImportSnapshot');
}

/** Spielt die Sicherung wieder ein, die vor dem letzten Import automatisch angelegt wurde. */
export async function restorePreImportSnapshot(db: Db): Promise<void> {
  const snap = await getPreImportSnapshot(db);
  if (!snap) throw new AppError('Es gibt keine Sicherung vor einem Import.');
  await replaceAll(db, snap.data, { keepSnapshot: false });
  await ensureHouseholdCategories(db);
}

/** Legt Startdaten an, aber nur bei einer leeren, noch nie befüllten Datenbank. */
export async function seedIfEmpty(db: Db, startMonth: string): Promise<boolean> {
  const tx = db.transaction([...ALL_STORES], 'readwrite') as unknown as AnyTx;
  const seeded = await tx.objectStore('meta').get('seeded');
  const count = await tx.objectStore('categories').count();
  if (seeded?.value || count > 0) { await tx.done; return false; }
  const seed = buildSeed(startMonth);
  for (const c of seed.categories) await tx.objectStore('categories').put(c);
  for (const b of seed.budgets) await tx.objectStore('budgets').put(b);
  for (const r of seed.recurring) await tx.objectStore('recurring').put(r);
  await tx.objectStore('settings').put({ key: 'app', value: seed.settings });
  await tx.objectStore('meta').put({ key: 'seeded', value: true });
  await tx.done;
  return true;
}

/** Setzt die App auf die Startdaten zurück (alle eigenen Daten gehen verloren; die Sicherung vor dem Löschen bleibt lokal erhalten). */
export async function resetToSeed(db: Db, startMonth: string): Promise<void> {
  await replaceAll(db, buildSeed(startMonth));
}
