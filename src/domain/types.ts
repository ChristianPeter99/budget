// Datenmodell. Alle Geldbeträge sind ganzzahlige Cent-Beträge, alle Datumswerte lokale Kalendertage
// im Format "YYYY-MM-DD", Monatsschlüssel haben das Format "YYYY-MM".

export type TxType = 'income' | 'expense';
export type CatGroup = 'einnahme' | 'fix' | 'alltag' | 'spar';

export interface Category {
  id: string;
  name: string;
  kind: TxType;
  group: CatGroup;
  /** null = Hauptkategorie. Es gibt höchstens zwei Ebenen. */
  parentId: string | null;
  archived: boolean;
  sort: number;
  createdAt: string;
  /** 'joint' = Kategorie des gemeinsamen Haushaltskontos (eigene Liste, nur Ausgaben, Gruppe Alltag). Fehlt = eigenes Konto. */
  scope?: 'joint';
  /** Gewähltes Symbol (Schlüssel aus CAT_ICONS). Fehlt = Symbol nach Name. */
  icon?: string;
}

/** Gehört die Kategorie zur Liste des Haushaltskontos? */
export const isHouseholdCat = (c: { scope?: 'joint' } | undefined): boolean => c?.scope === 'joint';

/**
 * Bereich einer Kategorie für Auswahllisten: Alltag, Fixkosten, Sparen, gemeinsames Konto oder Einnahmen.
 * Erfassen, Kategorienverwaltung und CSV-Import zeigen immer nur die Kategorien eines Bereichs.
 */
export type CatArea = 'alltag' | 'fix' | 'spar' | 'joint' | 'einnahme';
export const catArea = (c: { scope?: 'joint'; kind: TxType; group: CatGroup }): CatArea =>
  isHouseholdCat(c) ? 'joint' : c.kind === 'income' ? 'einnahme' : c.group === 'alltag' ? 'alltag' : c.group === 'spar' ? 'spar' : 'fix';

export interface Transaction {
  id: string;
  date: string;
  type: TxType;
  amountCents: number;
  categoryId: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  /** gesetzt, wenn die Buchung automatisch aus einer Wiederkehrenden Buchung entstanden ist */
  recurringId?: string;
  /** 'joint' = Ausgabe vom gemeinsamen Konto; fehlt = eigenes Konto */
  account?: 'joint';
  /** Fingerabdruck der CSV-Zeile, aus der die Buchung importiert wurde (verhindert doppelten Import) */
  importId?: string;
  /** gesetzt, wenn die Buchung automatisch für ein Sparziel entstanden ist („Sparziel on top“) */
  goalId?: string;
}

/** Budget: 'month' = Gesamtbudget für Ausgaben, 'category' = Budget für eine Kategorie (inkl. Unterkategorien). */
export interface Budget {
  id: string;
  scope: 'month' | 'category';
  /** 'default' = gilt für alle Monate, sonst "YYYY-MM" = gilt nur für diesen Monat */
  monthKey: string;
  categoryId?: string;
  amountCents: number;
}

/** Vorlage für monatlich wiederkehrende Buchungen (Gehalt, Miete, Sparrate …). */
export interface Recurring {
  id: string;
  name: string;
  type: TxType;
  amountCents: number;
  categoryId: string;
  startMonth: string;
  endMonth?: string;
  /** Tag im Monat, 1 bis 28 */
  day: number;
  active: boolean;
  createdAt: string;
  /** 'yearly': Jahresbetrag wird auf 12 Monate verteilt (Monatsanteil in amountCents, Summe übers Jahr exakt). Fehlt = monatlich. */
  interval?: 'monthly' | 'yearly';
  /** Reihenfolge in der Fixkosten-Liste (von Hand per Ziehen; fehlt = nach Betrag) */
  sort?: number;
  /** Nur bei 'yearly': der eingegebene Jahresbetrag */
  yearlyCents?: number;
  /** Nur bei 'yearly': Monat (1–12), in dem die Zahlung tatsächlich anfällt (optional) */
  dueMonth?: number;
  /** Kündigungsfrist als freier Text, z. B. „3 Monate zum Laufzeitende“ (optional) */
  notice?: string;
}

/** Sparziel: Zielbetrag bis zu einem Monat; der angesparte Betrag wird von Hand gepflegt. */
export interface SavingsGoal {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  /** Zielmonat "YYYY-MM" */
  dueMonth: string;
  createdAt: string;
  /** Automatisch ansparen: jeden Monat bis zum Zielmonat eine Sparen-Buchung zusätzlich zur Sparrate (fehlt = an) */
  auto?: boolean;
  /** Letzter Monat, für den die automatische Buchung erledigt ist (verhindert Doppel- und Nachbuchungen) */
  lastBookedMonth?: string;
}

/** Merker, dass die Buchung einer Vorlage für einen Monat bereits erzeugt wurde. */
export interface RecurringRun {
  key: string;
  recurringId: string;
  month: string;
  createdAt: string;
}

export interface Settings {
  /** Erwartetes Monatseinkommen als Grundlage der Aufteilung */
  expectedIncomeCents: number;
  /** Anteile in Prozent (ganzzahlig); der Rest ist frei verfügbar */
  split: { fix: number; alltag: number; spar: number };
  /** Aktueller Kontostand des Sparkontos (von Hand gepflegt) und Datum dieser Angabe */
  savingsBalanceCents: number;
  savingsBalanceDate: string | null;
  /** Verlauf der erfassten Kontostände (Korrekturen), der neueste entspricht savingsBalance* */
  savingsHistory?: SavingsEntry[];
  /** Anzeigename des Kontos, z. B. „C24“ (leer = ausgeblendet) */
  accountName: string;
  /** Eigenes Konto für Fixkosten (leer/fehlt = wie accountName) */
  fixAccountName?: string;
  /** Nach wie vielen Tagen ohne Backup erinnert wird (0 = nie) */
  backupReminderDays: number;
  /** Gemeinsames Ausgabenkonto (optional) */
  joint?: JointSettings;
  /** Beim CSV-Import gemerkte Zuordnungen: normalisierter Empfänger → Kategorie */
  importRules?: Record<string, string>;
  /** Sparziele (optional) */
  savingsGoals?: SavingsGoal[];
}

/**
 * Gemeinsames Konto: Das Monatsbudget ist die Summe beider Einzahlungen. Der eigene Beitrag ist eine
 * wiederkehrende Buchung (Kategorie categoryId, Gruppe Alltag) und zählt damit in das eigene Budget.
 * Ausgaben vom gemeinsamen Konto (Transaction.account = 'joint') zählen nur hier, nie im eigenen Budget.
 */
export interface SavingsEntry { date: string; cents: number }

export interface JointSettings {
  enabled: boolean;
  /** Anzeigename, z. B. „Haushaltskonto“ */
  name: string;
  /** Name der anderen Person (optional) */
  partnerName: string;
  /** Kategorie des eigenen Beitrags */
  categoryId: string | null;
  /** üblicher Beitrag der anderen Person pro Monat */
  partnerDefaultCents: number;
  /** abweichende Beiträge der anderen Person je Monat ("YYYY-MM" → Cent) */
  partnerByMonth: Record<string, number>;
  /** Ab diesem Monat wird der Rest von Monat zu Monat übertragen (fehlt = ab der ersten Buchung) */
  startMonth?: string;
}

/** Ein von Hand erfasster Depotstand zu einem Datum (höchstens einer pro Tag). */
export interface DepotEntry {
  id: string;
  date: string;
  valueCents: number;
  createdAt: string;
}

export interface BackupData {
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  recurring: Recurring[];
  recurringRuns: RecurringRun[];
  depotEntries: DepotEntry[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  expectedIncomeCents: 0,
  split: { fix: 40, alltag: 40, spar: 15 },
  savingsBalanceCents: 0,
  savingsBalanceDate: null,
  accountName: '',
  backupReminderDays: 30
};

/** Fehler mit einer Meldung, die dem Nutzer direkt angezeigt werden darf (enthält nie Finanzdaten). */
export class AppError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = 'AppError';
    this.userMessage = userMessage;
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
