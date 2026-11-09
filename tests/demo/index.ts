import { readFileSync } from 'node:fs';
import type { BackupData } from '../../src/domain/types';

/**
 * Erfundene Beispieldaten für die Tests (Kategorien, Gehalt, 16 Fixkosten, Sparrate) mit festen IDs.
 * Die App selbst enthält keine Beispieldaten: Tests übergeben sie über localStorage „seedDemo“ (JSON).
 * month = Startmonat der Vorlagen (wie bei einer Einrichtung in diesem Monat).
 */
export function demoJson(month: string): string {
  return readFileSync('tests/demo/demo-data.json', 'utf8').replace(/"__MONTH__"/g, JSON.stringify(month));
}
export function demoData(month: string): BackupData {
  return JSON.parse(demoJson(month)) as BackupData;
}

/** Aktueller Monat (lokale Zeit) – Startmonat der Vorlagen in den Browser-Tests */
export function thisMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** localStorage-Eintrag, mit dem die App beim ersten Start die Beispieldaten übernimmt */
export const demoStorage = (month = thisMonth()) => ({ name: 'seedDemo', value: demoJson(month) });
