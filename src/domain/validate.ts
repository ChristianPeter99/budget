import { AppError } from './types';
import type { BackupData, Budget, Category, CatGroup, DepotEntry, Recurring, RecurringRun, SavingsGoal, Settings, Transaction, TxType } from './types';
import { MAX_CENTS } from './money';
import { CAT_ICON_KEYS } from './catIcons';
import { isValidISODate, isValidMonthKey } from './dates';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0, max = MAX_CENTS): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isKind = (v: unknown): v is TxType => v === 'income' || v === 'expense';
const GROUPS: CatGroup[] = ['einnahme', 'fix', 'alltag', 'spar'];

export function validateAmountCents(v: unknown): number {
  if (!isInt(v, 1)) throw new AppError('Bitte gib einen gültigen Betrag größer als 0 ein (höchstens zwei Nachkommastellen).');
  return v;
}
export function validateName(v: unknown, what = 'Name'): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new AppError(`Bitte gib einen ${what} ein.`);
  if (s.length > 60) throw new AppError(`Der ${what} darf höchstens 60 Zeichen lang sein.`);
  return s;
}

function validJoint(j: unknown, cats: Map<string, Category>): boolean {
  if (!isObj(j) || typeof j.enabled !== 'boolean' || !isStr(j.name, 40) || !isStr(j.partnerName, 40)) return false;
  if (!(j.categoryId === null || (typeof j.categoryId === 'string' && cats.has(j.categoryId)))) return false;
  if (!isInt(j.partnerDefaultCents) || !isObj(j.partnerByMonth)) return false;
  if (j.startMonth !== undefined && !isValidMonthKey(j.startMonth)) return false;
  const entries = Object.entries(j.partnerByMonth);
  return entries.length <= 1200 && entries.every(([k, v]) => isValidMonthKey(k) && isInt(v));
}

export type BackupCheck = { ok: true; data: BackupData } | { ok: false; errors: string[] };

/**
 * Prüft ein Backup-Datenobjekt vollständig (Typen, eindeutige IDs, Beträge, Datumswerte, Referenzen)
 * und liefert eine bereinigte Kopie, die nur bekannte Felder enthält.
 */
export function validateBackupData(raw: unknown): BackupCheck {
  const errors: string[] = [];
  const err = (m: string) => { if (errors.length < 12) errors.push(m); };
  if (!isObj(raw)) return { ok: false, errors: ['Die Daten haben kein gültiges Format.'] };
  const arr = (k: string, optional = false): unknown[] => {
    const v = raw[k];
    if (v === undefined && optional) return [];
    if (!Array.isArray(v)) { err(`„${k}“ fehlt oder ist keine Liste.`); return []; }
    return v;
  };

  const categories: Category[] = [];
  const catById = new Map<string, Category>();
  for (const c of arr('categories')) {
    if (!isObj(c)) { err('Eine Kategorie ist ungültig.'); continue; }
    if (!isStr(c.id, 100) || !c.id || catById.has(c.id)) { err('Kategorie mit fehlender oder doppelter ID.'); continue; }
    if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60) { err('Kategorie mit ungültigem Namen.'); continue; }
    if (!isKind(c.kind) || !GROUPS.includes(c.group as CatGroup)) { err('Kategorie mit ungültiger Art oder Gruppe.'); continue; }
    if (!(c.parentId === null || isStr(c.parentId, 100))) { err('Kategorie mit ungültiger Oberkategorie.'); continue; }
    if (typeof c.archived !== 'boolean' || !isInt(c.sort, -1_000_000, 1_000_000) || !isStr(c.createdAt, 40)) { err('Kategorie mit ungültigen Feldern.'); continue; }
    if (c.scope !== undefined && !(c.scope === 'joint' && c.kind === 'expense' && c.group === 'alltag')) { err('Kategorie mit ungültiger Zuordnung zum Haushaltskonto.'); continue; }
    const cat: Category = { id: c.id, name: c.name.trim(), kind: c.kind, group: c.group as CatGroup, parentId: c.parentId as string | null, archived: c.archived, sort: c.sort, createdAt: c.createdAt };
    if (c.scope === 'joint') cat.scope = 'joint';
    // Unbekannte Symbole werden ignoriert (Symbol nach Name), statt das Backup abzulehnen
    if (typeof c.icon === 'string' && CAT_ICON_KEYS.has(c.icon)) cat.icon = c.icon;
    categories.push(cat);
    catById.set(cat.id, cat);
  }
  for (const c of categories) {
    if (c.parentId === null) continue;
    const p = catById.get(c.parentId);
    if (!p || p.id === c.id) err('Eine Kategorie verweist auf eine nicht vorhandene Oberkategorie.');
    else if (p.parentId !== null) err('Kategorien dürfen höchstens zwei Ebenen haben.');
    else if (p.kind !== c.kind) err('Unterkategorie und Oberkategorie haben unterschiedliche Arten.');
    else if (p.scope !== c.scope) err('Unterkategorie und Oberkategorie gehören zu verschiedenen Konten.');
  }

  const transactions: Transaction[] = [];
  const txIds = new Set<string>();
  const recIdsRaw = new Set<string>();
  for (const r of arr('recurring')) if (isObj(r) && isStr(r.id, 100)) recIdsRaw.add(r.id);
  for (const t of arr('transactions')) {
    if (!isObj(t)) { err('Eine Buchung ist ungültig.'); continue; }
    if (!isStr(t.id, 100) || !t.id || txIds.has(t.id)) { err('Buchung mit fehlender oder doppelter ID.'); continue; }
    if (!isValidISODate(t.date)) { err('Buchung mit ungültigem Datum.'); continue; }
    if (!isKind(t.type)) { err('Buchung mit ungültiger Art.'); continue; }
    if (!isInt(t.amountCents, 1)) { err('Buchung mit ungültigem Betrag.'); continue; }
    const cat = typeof t.categoryId === 'string' ? catById.get(t.categoryId) : undefined;
    if (!cat) { err('Buchung verweist auf eine nicht vorhandene Kategorie.'); continue; }
    if (cat.kind !== t.type) { err('Buchungsart und Kategorie passen nicht zusammen.'); continue; }
    if (!isStr(t.description, 200) || !isStr(t.createdAt, 40) || !(t.updatedAt === undefined || isStr(t.updatedAt, 40))) { err('Buchung mit ungültigen Feldern.'); continue; }
    if (t.recurringId !== undefined && (!isStr(t.recurringId, 100) || !recIdsRaw.has(t.recurringId))) { err('Buchung verweist auf eine nicht vorhandene Wiederkehrende Buchung.'); continue; }
    txIds.add(t.id);
    const tx: Transaction = { id: t.id, date: t.date, type: t.type, amountCents: t.amountCents, categoryId: t.categoryId as string, description: t.description, createdAt: t.createdAt };
    if (t.updatedAt !== undefined) tx.updatedAt = t.updatedAt;
    if (t.recurringId !== undefined) tx.recurringId = t.recurringId;
    if (t.account !== undefined) {
      if (t.account !== 'joint' || t.type !== 'expense') { err('Buchung mit ungültigem Konto.'); continue; }
      tx.account = 'joint';
    }
    if (t.importId !== undefined) {
      if (!isStr(t.importId, 64) || !t.importId) { err('Buchung mit ungültiger Import-Kennung.'); continue; }
      tx.importId = t.importId;
    }
    transactions.push(tx);
  }

  const budgets: Budget[] = [];
  const bIds = new Set<string>();
  for (const b of arr('budgets')) {
    if (!isObj(b)) { err('Ein Budget ist ungültig.'); continue; }
    if (!isStr(b.id, 120) || !b.id || bIds.has(b.id)) { err('Budget mit fehlender oder doppelter ID.'); continue; }
    if (b.scope !== 'month' && b.scope !== 'category') { err('Budget mit ungültigem Typ.'); continue; }
    if (!(b.monthKey === 'default' || isValidMonthKey(b.monthKey))) { err('Budget mit ungültigem Monat.'); continue; }
    if (!isInt(b.amountCents)) { err('Budget mit ungültigem Betrag.'); continue; }
    if (b.scope === 'category' && !(typeof b.categoryId === 'string' && catById.has(b.categoryId))) { err('Budget verweist auf eine nicht vorhandene Kategorie.'); continue; }
    if (b.scope === 'month' && b.categoryId !== undefined) { err('Monatsbudget darf keine Kategorie enthalten.'); continue; }
    bIds.add(b.id);
    const bud: Budget = { id: b.id, scope: b.scope, monthKey: b.monthKey as string, amountCents: b.amountCents };
    if (b.scope === 'category') bud.categoryId = b.categoryId as string;
    budgets.push(bud);
  }

  const recurring: Recurring[] = [];
  const rIds = new Set<string>();
  for (const r of arr('recurring')) {
    if (!isObj(r)) { err('Eine Wiederkehrende Buchung ist ungültig.'); continue; }
    if (!isStr(r.id, 100) || !r.id || rIds.has(r.id)) { err('Wiederkehrende Buchung mit fehlender oder doppelter ID.'); continue; }
    const cat = typeof r.categoryId === 'string' ? catById.get(r.categoryId) : undefined;
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 60 || !isKind(r.type) || !isInt(r.amountCents, 1)
      || !cat || cat.kind !== r.type || !isValidMonthKey(r.startMonth)
      || !(r.endMonth === undefined || (isValidMonthKey(r.endMonth) && r.endMonth >= r.startMonth))
      || !isInt(r.day, 1, 28) || typeof r.active !== 'boolean' || !isStr(r.createdAt, 40)) { err('Wiederkehrende Buchung mit ungültigen Feldern oder Kategorie.'); continue; }
    if (!(r.interval === undefined || r.interval === 'monthly' || r.interval === 'yearly')
      || (r.interval === 'yearly' && !isInt(r.yearlyCents, 1)) || (r.interval !== 'yearly' && r.yearlyCents !== undefined)
      || (r.dueMonth !== undefined && (r.interval !== 'yearly' || !isInt(r.dueMonth, 1, 12)))) { err('Wiederkehrende Buchung mit ungültigem Intervall.'); continue; }
    if (r.sort !== undefined && !isInt(r.sort, 0, 100_000)) { err('Wiederkehrende Buchung mit ungültiger Reihenfolge.'); continue; }
    if (r.notice !== undefined && !(isStr(r.notice, 80) && r.notice.trim())) { err('Wiederkehrende Buchung mit ungültiger Kündigungsfrist.'); continue; }
    rIds.add(r.id);
    const rec: Recurring = { id: r.id, name: r.name.trim(), type: r.type, amountCents: r.amountCents, categoryId: r.categoryId as string, startMonth: r.startMonth, day: r.day, active: r.active, createdAt: r.createdAt };
    if (r.endMonth !== undefined) rec.endMonth = r.endMonth;
    if (r.sort !== undefined) rec.sort = r.sort as number;
    if (r.notice !== undefined) rec.notice = (r.notice as string).trim();
    if (r.interval === 'yearly') { rec.interval = 'yearly'; rec.yearlyCents = r.yearlyCents as number; if (r.dueMonth !== undefined) rec.dueMonth = r.dueMonth as number; }
    recurring.push(rec);
  }

  const recurringRuns: RecurringRun[] = [];
  const runKeys = new Set<string>();
  for (const r of arr('recurringRuns', true)) {
    if (!isObj(r) || !isStr(r.key, 140) || !r.key || runKeys.has(r.key) || !isStr(r.recurringId, 100) || !rIds.has(r.recurringId)
      || !isValidMonthKey(r.month) || !isStr(r.createdAt, 40)) { err('Ungültiger Eintrag bei den Wiederkehrenden Buchungen.'); continue; }
    runKeys.add(r.key);
    recurringRuns.push({ key: r.key, recurringId: r.recurringId, month: r.month, createdAt: r.createdAt });
  }
  for (const t of transactions) {
    // Buchungen mit recurringId müssen zu einer vorhandenen Vorlage gehören (oben geprüft).
    if (t.recurringId && !rIds.has(t.recurringId)) err('Buchung verweist auf eine unbekannte Vorlage.');
  }

  const depotEntries: DepotEntry[] = [];
  const dIds = new Set<string>();
  const dDates = new Set<string>();
  for (const d of arr('depotEntries', true)) {
    if (!isObj(d) || !isStr(d.id, 100) || !d.id || dIds.has(d.id) || !isValidISODate(d.date) || dDates.has(d.date)
      || !isInt(d.valueCents) || !isStr(d.createdAt, 40)) { err('Ungültiger Depot-Eintrag.'); continue; }
    dIds.add(d.id); dDates.add(d.date);
    depotEntries.push({ id: d.id, date: d.date, valueCents: d.valueCents, createdAt: d.createdAt });
  }

  // Neuere Felder sind optional, damit ältere Stände (Schema 1–2) gültig bleiben. depotCents (Schema ≤ 2) wird ignoriert;
  // die Übernahme in den Depot-Verlauf erledigen Migration bzw. Backup-Import.
  let settings: Settings | undefined;
  const s = raw.settings;
  if (!isObj(s) || !isInt(s.expectedIncomeCents) || !isObj(s.split)
    || !isInt(s.split.fix, 0, 100) || !isInt(s.split.alltag, 0, 100) || !isInt(s.split.spar, 0, 100)
    || s.split.fix + s.split.alltag + s.split.spar > 100
    || (s.depotCents !== undefined && !isInt(s.depotCents))
    || (s.savingsBalanceCents !== undefined && !isInt(s.savingsBalanceCents))
    || (s.savingsBalanceDate !== undefined && s.savingsBalanceDate !== null && !isValidISODate(s.savingsBalanceDate))
    || (s.savingsHistory !== undefined && !(Array.isArray(s.savingsHistory) && s.savingsHistory.length <= 400
      && s.savingsHistory.every((e: unknown) => isObj(e) && isValidISODate(e.date) && isInt(e.cents, 0, MAX_CENTS))
      && new Set(s.savingsHistory.map((e: { date: string }) => e.date)).size === s.savingsHistory.length))
    || (s.accountName !== undefined && !isStr(s.accountName, 30))
    || (s.fixAccountName !== undefined && !isStr(s.fixAccountName, 30))
    || (s.backupReminderDays !== undefined && !isInt(s.backupReminderDays, 0, 365))
    || (s.joint !== undefined && !validJoint(s.joint, catById))
    || (s.importRules !== undefined && !(isObj(s.importRules) && Object.keys(s.importRules).length <= 5000
      && Object.entries(s.importRules).every(([k, v]) => k.length <= 80 && typeof v === 'string' && catById.has(v))))
    || (s.savingsGoals !== undefined && !validGoals(s.savingsGoals))) err('Die Einstellungen sind ungültig.');
  else settings = {
    expectedIncomeCents: s.expectedIncomeCents,
    split: { fix: s.split.fix, alltag: s.split.alltag, spar: s.split.spar },
    savingsBalanceCents: (s.savingsBalanceCents as number | undefined) ?? 0,
    savingsBalanceDate: (s.savingsBalanceDate as string | null | undefined) ?? null,
    accountName: ((s.accountName as string | undefined) ?? '').trim(),
    backupReminderDays: (s.backupReminderDays as number | undefined) ?? 30
  };
  if (settings && isObj(s) && typeof s.fixAccountName === 'string' && s.fixAccountName.trim()) settings.fixAccountName = s.fixAccountName.trim();
  if (settings && isObj(s) && s.savingsHistory !== undefined) settings.savingsHistory = (s.savingsHistory as { date: string; cents: number }[]).map((e) => ({ date: e.date, cents: e.cents }));
  if (settings && isObj(s) && s.importRules !== undefined) settings.importRules = { ...(s.importRules as Record<string, string>) };
  if (settings && isObj(s) && s.savingsGoals !== undefined) settings.savingsGoals = (s.savingsGoals as SavingsGoal[]).map((g) => ({ id: g.id, name: g.name.trim(), targetCents: g.targetCents, savedCents: g.savedCents, dueMonth: g.dueMonth, createdAt: g.createdAt }));
  if (settings && isObj(s) && s.joint !== undefined) {
    const j = s.joint as Record<string, unknown>;
    settings.joint = {
      enabled: j.enabled as boolean, name: (j.name as string).trim(), partnerName: (j.partnerName as string).trim(),
      categoryId: j.categoryId as string | null, partnerDefaultCents: j.partnerDefaultCents as number,
      partnerByMonth: { ...(j.partnerByMonth as Record<string, number>) }
    };
    if (j.startMonth !== undefined) settings.joint.startMonth = j.startMonth as string;
  }

  if (errors.length || !settings) return { ok: false, errors: errors.length ? errors : ['Die Einstellungen fehlen.'] };
  return { ok: true, data: { categories, transactions, budgets, recurring, recurringRuns, depotEntries, settings } };
}

/** Sparziele: höchstens 50, eindeutige IDs, Name 1–40 Zeichen, Beträge in Cent, Zielmonat gültig. */
function validGoals(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > 50) return false;
  const ids = new Set<string>();
  for (const g of v) {
    if (!isObj(g) || !isStr(g.id, 100) || !g.id || ids.has(g.id) || typeof g.name !== 'string' || !g.name.trim() || g.name.length > 40
      || !isInt(g.targetCents, 1, MAX_CENTS) || !isInt(g.savedCents, 0, MAX_CENTS) || !isValidMonthKey(g.dueMonth) || !isStr(g.createdAt, 40)) return false;
    ids.add(g.id);
  }
  return true;
}
