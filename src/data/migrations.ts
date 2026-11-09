// Migrationen der Datenbank von Version 1 bis 8.
import type { IDBPTransaction, StoreNames } from 'idb';
import { DB_VERSION } from './schema';
import type { BudgetDB, Db } from './schema';
import { DEFAULT_SETTINGS, newId } from '../domain/types';
import type { Settings } from '../domain/types';
import { todayISO } from '../domain/dates';

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
