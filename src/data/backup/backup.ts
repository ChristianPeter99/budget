import { isValidISODate, toISODate, todayISO } from '../../domain/dates';
import type { BackupData } from '../../domain/types';
import { DB_VERSION } from '../schema';
import type { Db } from '../schema';
import { BackupError, DEFAULT_ITERATIONS, decryptEnvelope, encryptText, parseEnvelope } from './crypto';
import type { BackupEnvelope } from './crypto';
import { exportAll, replaceAll } from '../dataset';
import { validateBackupData } from '../../domain/validate';
import { ensureHouseholdCategories } from '../joint';
import { setMeta } from '../meta';

const localDay = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : toISODate(d); };

export interface BackupPayload { app: 'budget-pwa'; schemaVersion: number; exportedAt: string; data: BackupData }

export interface BackupSummary {
  createdAt: string;
  schemaVersion: number;
  transactions: number;
  categories: number;
  budgets: number;
  recurring: number;
  firstDate: string | null;
  lastDate: string | null;
}

export function summarizeData(data: BackupData, createdAt: string, schemaVersion: number): BackupSummary {
  const dates = data.transactions.map((t) => t.date).sort();
  return {
    createdAt, schemaVersion,
    transactions: data.transactions.length, categories: data.categories.length, budgets: data.budgets.length, recurring: data.recurring.length,
    firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null
  };
}

/** Erzeugt den Dateiinhalt eines verschlüsselten Backups. Es wird nie unverschlüsselt ausgegeben. */
export async function createEncryptedBackup(db: Db, password: string, iterations: number = DEFAULT_ITERATIONS): Promise<{ filename: string; text: string }> {
  const data = await exportAll(db);
  const check = validateBackupData(data);
  if (!check.ok) throw new BackupError('invalid', 'Die vorhandenen Daten sind nicht konsistent. Das Backup wurde nicht erstellt.');
  const payload: BackupPayload = { app: 'budget-pwa', schemaVersion: DB_VERSION, exportedAt: new Date().toISOString(), data: check.data };
  const env = await encryptText(JSON.stringify(payload), password, iterations);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { filename: `budget-backup-${stamp}.json`, text: JSON.stringify(env) };
}

export interface OpenedBackup { envelope: BackupEnvelope; data: BackupData; summary: BackupSummary }

/**
 * Prüft Format und Version, entschlüsselt und validiert alles. Verändert keine gespeicherten Daten.
 * Wirft BackupError bei falschem Passwort, beschädigter Datei oder nicht unterstütztem Format.
 */
export async function openEncryptedBackup(text: string, password: string): Promise<OpenedBackup> {
  const envelope = parseEnvelope(text);
  const plain = await decryptEnvelope(envelope, password);
  let payload: unknown;
  try { payload = JSON.parse(plain); } catch { throw new BackupError('corrupt', 'Der Inhalt des Backups ist beschädigt.'); }
  const p = payload as Partial<BackupPayload> | null;
  if (!p || p.app !== 'budget-pwa' || typeof p.schemaVersion !== 'number') throw new BackupError('format', 'Der Inhalt gehört nicht zu dieser App.');
  if (p.schemaVersion > DB_VERSION) throw new BackupError('version', 'Dieses Backup stammt aus einer neueren App-Version. Bitte aktualisiere die App.');
  const raw = { ...((p.data ?? {}) as Record<string, unknown>) };
  // Ältere Schemas: v1 kannte keine Wiederkehrenden Buchungen, v1–2 keinen Depot-Verlauf (nur einen Einzelwert).
  if (p.schemaVersion < 2) { raw.recurring ??= []; raw.recurringRuns ??= []; }
  if (p.schemaVersion < 3 && raw.depotEntries === undefined) {
    const s = raw.settings as { depotCents?: unknown } | undefined;
    const exportedDay = typeof p.exportedAt === 'string' && isValidISODate(localDay(p.exportedAt)) ? localDay(p.exportedAt) : todayISO();
    raw.depotEntries = typeof s?.depotCents === 'number' && Number.isSafeInteger(s.depotCents) && s.depotCents > 0
      ? [{ id: `depot-${exportedDay}`, date: exportedDay, valueCents: s.depotCents, createdAt: p.exportedAt ?? new Date().toISOString() }]
      : [];
  }
  const check = validateBackupData(raw);
  if (!check.ok) throw new BackupError('invalid', 'Die Daten im Backup sind fehlerhaft: ' + check.errors.slice(0, 3).join(' '));
  return { envelope, data: check.data, summary: summarizeData(check.data, p.exportedAt ?? envelope.createdAt, p.schemaVersion) };
}

/** Ersetzt den gesamten Datenbestand atomar. Der bisherige Stand wird vorher lokal gesichert. */
export async function restoreBackup(db: Db, opened: OpenedBackup): Promise<void> {
  await replaceAll(db, opened.data);
  await ensureHouseholdCategories(db);
  await setMeta(db, 'lastRestoreAt', new Date().toISOString());
}
