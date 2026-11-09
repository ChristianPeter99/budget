// Buchungen anlegen, ändern, löschen und wiederherstellen.
import { AppError, isHouseholdCat, newId } from '../domain/types';
import type { Transaction, TxType } from '../domain/types';
import type { Db } from './schema';
import { isValidISODate } from '../domain/dates';
import { validateAmountCents } from '../domain/validate';
import { abortTx } from './internal';

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
export function cleanTx(i: TxInput): TxInput {
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
