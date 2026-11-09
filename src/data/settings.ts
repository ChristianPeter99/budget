// Einstellungen und Stände des Sparkontos.
import type { Db } from './schema';
import { AppError, DEFAULT_SETTINGS } from '../domain/types';
import type { SavingsEntry, Settings } from '../domain/types';
import { validateBackupData } from '../domain/validate';
import { abortTx } from './internal';
import { savingsEntries } from '../domain/savings';
import { isValidISODate } from '../domain/dates';
import { MAX_CENTS } from '../domain/money';

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
