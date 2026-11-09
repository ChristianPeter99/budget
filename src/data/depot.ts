// Depotstände.
import type { Db } from './schema';
import { AppError, newId } from '../domain/types';
import type { DepotEntry } from '../domain/types';
import { isValidISODate } from '../domain/dates';

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
