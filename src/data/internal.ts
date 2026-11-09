// Gemeinsame Helfer der Datenschicht (Transaktionen, Gesamtstand lesen und schreiben).
import type { AnyTx } from './schema';
import { DEFAULT_SETTINGS } from '../domain/types';
import type { BackupData } from '../domain/types';

/** Bricht eine Transaktion ab, ohne dass daraus eine unbehandelte Promise-Ablehnung entsteht. */
export function abortTx(tx: { abort: () => void; done: Promise<void> }): void {
  tx.done.catch(() => undefined);
  tx.abort();
}

export const DATA_STORES = ['categories', 'transactions', 'budgets', 'recurring', 'recurringRuns', 'depotEntries', 'settings'] as const;
export const ALL_STORES = [...DATA_STORES, 'meta'] as const;

export async function readAll(tx: AnyTx): Promise<BackupData> {
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

export async function writeData(tx: AnyTx, data: BackupData): Promise<void> {
  for (const c of data.categories) await tx.objectStore('categories').put(c);
  for (const t of data.transactions) await tx.objectStore('transactions').put(t);
  for (const b of data.budgets) await tx.objectStore('budgets').put(b);
  for (const r of data.recurring) await tx.objectStore('recurring').put(r);
  for (const r of data.recurringRuns) await tx.objectStore('recurringRuns').put(r);
  for (const d of data.depotEntries) await tx.objectStore('depotEntries').put(d);
  await tx.objectStore('settings').put({ key: 'app', value: data.settings });
  await tx.objectStore('meta').put({ key: 'seeded', value: true });
}
