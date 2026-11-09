// Import aus Kontoauszügen übernehmen und rückgängig machen.
import { AppError, DEFAULT_SETTINGS, isHouseholdCat, newId } from '../domain/types';
import type { Transaction, TxType } from '../domain/types';
import type { Db } from './schema';
import { cleanTx } from './transactions';
import { abortTx } from './internal';
import { templateCents, willSave } from '../domain/fixDetect';
import type { FixRow } from '../domain/fixDetect';
import { currentMonthKey } from '../domain/dates';
import { runRecurring, saveRecurring } from './recurring';

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

/** Vorlagen speichern: Beginn im Monat der letzten Zahlung (die importierten Buchungen werden ihr zugeordnet). */
export async function saveFixRows(db: Db, rows: FixRow[]): Promise<number> {
  const cur = currentMonthKey();
  let n = 0;
  for (const r of rows) {
    if (!willSave(r)) continue;
    const { f } = r;
    const lastMonth = f.last.slice(0, 7);
    await saveRecurring(db, r.old?.id ?? null, {
      name: r.old?.name ?? f.name, type: 'expense', categoryId: r.cat,
      startMonth: r.old ? r.old.startMonth : r.start ?? (lastMonth > cur ? cur : lastMonth),
      day: Math.min(28, Math.max(1, r.old?.day ?? f.day)), active: r.old?.active ?? true,
      interval: f.interval === 'monthly' ? 'monthly' : 'yearly', amountCents: templateCents(f),
      dueMonth: f.interval === 'yearly' ? f.dueMonth : null, notice: r.old?.notice ?? null
    }, cur);
    n++;
  }
  if (n) await runRecurring(db, cur);
  return n;
}
