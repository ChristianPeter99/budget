// Datenbank „budget-app“: Name, Version und Tabellen. Schema und Datenformat bleiben unverändert (Rückweg zur alten Version).
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { Budget, Category, DepotEntry, Recurring, RecurringRun, Settings, Transaction } from '../domain/types';
import { upgradeSchema } from './migrations';

export const DB_NAME = 'budget-app';
/** Aktuelle Schema-Version. Bei jeder Änderung am Datenmodell erhöhen und in upgradeSchema() eine Migration ergänzen. */
export const DB_VERSION = 8;

export interface SettingsRecord { key: 'app'; value: Settings }
export interface MetaRecord { key: string; value: unknown }

export interface BudgetDB extends DBSchema {
  transactions: { key: string; value: Transaction; indexes: { 'by-date': string; 'by-category': string } };
  categories: { key: string; value: Category };
  budgets: { key: string; value: Budget };
  settings: { key: string; value: SettingsRecord };
  recurring: { key: string; value: Recurring };
  recurringRuns: { key: string; value: RecurringRun; indexes: { 'by-recurring': string } };
  depotEntries: { key: string; value: DepotEntry; indexes: { 'by-date': string } };
  meta: { key: string; value: MetaRecord };
}
export type Db = IDBPDatabase<BudgetDB>;
export type AnyTx = IDBPTransaction<BudgetDB, StoreNames<BudgetDB>[], 'readwrite'>;

export async function openBudgetDb(name: string = DB_NAME): Promise<Db> {
  return openDB<BudgetDB>(name, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      upgradeSchema(db, oldVersion, newVersion, tx);
    },
    blocking(_cur, _next, event) {
      // Eine neuere App-Version (z. B. nach einem Update in einem anderen Fenster) möchte die Datenbank aktualisieren:
      // Verbindung sofort freigeben und dieses Fenster mit der neuen Version neu laden. Sonst hinge die neue Version beim Start.
      try { (event.target as IDBDatabase).close(); } catch { /* schon geschlossen */ }
      if (typeof window !== 'undefined' && name === DB_NAME) window.location.reload();
    }
  });
}
