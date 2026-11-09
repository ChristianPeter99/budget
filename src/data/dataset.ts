// Gesamter Datenbestand: lesen, ersetzen (Backup), erster Start, alles löschen.
import type { AnyTx, Db } from './schema';
import { AppError } from '../domain/types';
import type { BackupData } from '../domain/types';
import { ALL_STORES, DATA_STORES, abortTx, readAll, writeData } from './internal';
import { validateBackupData } from '../domain/validate';
import { buildEmpty } from '../domain/seed';

/** Konsistenter Gesamtstand (eine Lese-Transaktion über alle Datenbereiche). */
export async function exportAll(db: Db): Promise<BackupData> {
  const tx = db.transaction([...ALL_STORES], 'readonly');
  const data = await readAll(tx as unknown as AnyTx);
  await tx.done;
  return data;
}

/* ───────── Gesamtstand ersetzen ───────── */

/**
 * Ersetzt alle Daten in EINER Transaktion (Backup wiederherstellen, alles löschen).
 * Schlägt irgendein Schritt fehl, wird die Transaktion verworfen und die vorhandenen Daten bleiben unverändert.
 */
export async function replaceAll(db: Db, input: BackupData): Promise<void> {
  const check = validateBackupData(input);
  if (!check.ok) throw new AppError('Die Daten sind nicht gültig und wurden nicht übernommen.');
  const data = check.data;
  const tx = db.transaction([...ALL_STORES], 'readwrite') as unknown as AnyTx;
  try {
    for (const s of DATA_STORES) await tx.objectStore(s).clear();
    await writeData(tx, data);
    await tx.objectStore('meta').delete(OLD_SNAPSHOT_KEY);
    await tx.done;
  } catch (e) {
    try { abortTx(tx); } catch { /* Transaktion ist bereits beendet */ }
    throw e instanceof AppError ? e : new AppError('Die Daten konnten nicht gespeichert werden. Es wurde nichts verändert.');
  }
}

/** Bis 1.78: Kopie des Stands vor Import/Wiederherstellen. Die Funktion ist entfallen; alte Kopien werden beim Start entfernt. */
const OLD_SNAPSHOT_KEY = 'preImportSnapshot';
export async function dropOldSnapshot(db: Db): Promise<void> {
  if (await db.getKey('meta', OLD_SNAPSHOT_KEY)) await db.delete('meta', OLD_SNAPSHOT_KEY);
}

/**
 * Erster Start: leere App mit Standard-Kategorien (keine Buchungen, kein Gehalt, keine Fixkosten) –
 * nur bei einer leeren, noch nie befüllten Datenbank. Tests übergeben stattdessen ihre Beispieldaten.
 */
export async function seedIfEmpty(db: Db, data: BackupData = buildEmpty()): Promise<boolean> {
  const tx = db.transaction([...ALL_STORES], 'readwrite') as unknown as AnyTx;
  const seeded = await tx.objectStore('meta').get('seeded');
  const count = await tx.objectStore('categories').count();
  if (seeded?.value || count > 0) { await tx.done; return false; }
  await writeData(tx, data);
  await tx.done;
  return true;
}

/** Alle Daten löschen: leere App mit Standard-Kategorien. */
export async function wipeAll(db: Db): Promise<void> {
  await replaceAll(db, buildEmpty());
  await db.delete('meta', 'lastImport');
}
