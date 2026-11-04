import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { Budget, Category, DepotEntry, Recurring, RecurringRun, Settings, Transaction } from '../domain/types';
import { DEFAULT_SETTINGS, newId } from '../domain/types';
import { todayISO } from '../domain/dates';

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

/**
 * Schrittweise Migrationen. Bestehende Datensätze werden nie gelöscht: jede Stufe legt nur Neues an
 * oder transformiert vorhandene Daten. `newVersion` erlaubt Tests, ältere Schemas gezielt zu erzeugen.
 */
export function upgradeSchema(db: Db, oldVersion: number, newVersion: number | null, tx: UpgradeTx): void {
  const target = newVersion ?? DB_VERSION;
  if (oldVersion < 1 && target >= 1) {
    const t = db.createObjectStore('transactions', { keyPath: 'id' });
    t.createIndex('by-date', 'date');
    t.createIndex('by-category', 'categoryId');
    db.createObjectStore('categories', { keyPath: 'id' });
    db.createObjectStore('budgets', { keyPath: 'id' });
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('meta', { keyPath: 'key' });
  }
  if (oldVersion < 2 && target >= 2) {
    db.createObjectStore('recurring', { keyPath: 'id' });
    const runs = db.createObjectStore('recurringRuns', { keyPath: 'key' });
    runs.createIndex('by-recurring', 'recurringId');
  }
  if (oldVersion < 3 && target >= 3) {
    const d = db.createObjectStore('depotEntries', { keyPath: 'id' });
    d.createIndex('by-date', 'date', { unique: true });
    // Datenumbau läuft in derselben Upgrade-Transaktion. Schlägt er fehl, wird das Upgrade abgebrochen
    // und die Datenbank bleibt auf dem alten Stand.
    migrateDataToV3(tx).catch(() => { try { tx.abort(); } catch { /* bereits beendet */ } });
  }
  // Schema 8: Haushaltskonto mit eigener Kategorienliste (Category.scope = 'joint'); Umhängen alter Buchungen
  //           erledigt ensureHouseholdCategories beim Start (idempotent), keine Strukturänderung.
  // Schema 7: CSV-Import (Transaction.importId, settings.importRules), kein Datenumbau.
  // Schema 6: optionaler Übertrags-Startmonat des gemeinsamen Kontos (settings.joint.startMonth), kein Datenumbau.
  // Schema 5: optionales Konto 'joint' an Buchungen und settings.joint. Ebenfalls ohne Datenumbau;
  // bestehende Buchungen gehören automatisch zum eigenen Konto.
  // Schema 4: optionales Feld dueMonth an jährlichen Vorlagen. Keine Strukturänderung und kein Datenumbau nötig;
  // die Versionserhöhung sorgt dafür, dass ältere App-Versionen Backups mit Fälligkeitsmonat ablehnen statt ihn zu verlieren.
  void tx.objectStore('meta').put({ key: 'schemaVersion', value: target });
}

type UpgradeTx = IDBPTransaction<BudgetDB, StoreNames<BudgetDB>[], 'versionchange'>;

/**
 * Schema 2 → 3:
 * - bisheriger Einzelwert settings.depotCents wird erster Eintrag im Depot-Verlauf (heutiges Datum)
 * - neue Einstellungsfelder bekommen Standardwerte (Kontoname „C24“ für Installationen aus den Startdaten)
 * - das in den Startdaten angelegte Bargeld-Budget (100 €) wird entfernt; Bargeld ist eine normale Alltags-Kategorie
 */
async function migrateDataToV3(tx: UpgradeTx): Promise<void> {
  const settingsStore = tx.objectStore('settings');
  const rec = await settingsStore.get('app');
  const seeded = (await tx.objectStore('meta').get('seeded'))?.value === true;
  if (rec) {
    const old = rec.value as Partial<Settings> & { depotCents?: number };
    const now = new Date().toISOString();
    if (typeof old.depotCents === 'number' && old.depotCents > 0) {
      await tx.objectStore('depotEntries').put({ id: newId(), date: todayISO(), valueCents: old.depotCents, createdAt: now });
    }
    const next: Settings = {
      ...DEFAULT_SETTINGS,
      expectedIncomeCents: old.expectedIncomeCents ?? 0,
      split: old.split ?? DEFAULT_SETTINGS.split,
      accountName: seeded ? 'C24' : ''
    };
    await settingsStore.put({ key: 'app', value: next });
  }
  const cats = await tx.objectStore('categories').getAll();
  const bargeld = new Set(cats.filter((c) => c.parentId === null && c.name === 'Bargeld').map((c) => c.id));
  for (const b of await tx.objectStore('budgets').getAll()) {
    if (b.scope === 'category' && b.monthKey === 'default' && b.amountCents === 10000 && b.categoryId && bargeld.has(b.categoryId)) {
      await tx.objectStore('budgets').delete(b.id);
    }
  }
}

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
