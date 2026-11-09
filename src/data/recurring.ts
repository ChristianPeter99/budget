// Wiederkehrende Buchungen (Fixkosten, Gehalt, Sparrate) speichern und nachbuchen.
import type { Db } from './schema';
import { abortTx } from './internal';
import { AppError, DEFAULT_SETTINGS, newId } from '../domain/types';
import type { Recurring, Transaction, TxType } from '../domain/types';
import { validateAmountCents, validateName } from '../domain/validate';
import { isValidMonthKey, shiftMonth } from '../domain/dates';
import { yearlyShare } from '../domain/recurring';

/** Reihenfolge von Fixkosten-Positionen (innerhalb einer Hauptkategorie) */
export async function setRecurringOrder(db: Db, ids: string[]): Promise<void> {
  const tx = db.transaction('recurring', 'readwrite');
  for (let k = 0; k < ids.length; k++) {
    const r = await tx.store.get(ids[k] as string);
    if (!r) { abortTx(tx); throw new AppError('Die Vorlage wurde nicht gefunden.'); }
    if (r.sort !== k) await tx.store.put({ ...r, sort: k });
  }
  await tx.done;
}

/* ───────── Wiederkehrende Buchungen ───────── */

export interface RecurringInput {
  name: string; type: TxType; categoryId: string; startMonth: string; day: number; active: boolean;
  /** Monatlich: Betrag pro Monat. Jährlich: Jahresbetrag, der auf 12 Monate verteilt wird. */
  interval?: 'monthly' | 'yearly';
  amountCents: number;
  /** Nur jährlich: Monat 1–12, in dem die Zahlung anfällt (optional) */
  dueMonth?: number | null;
  /** Kündigungsfrist (optional, freier Text); leer = keine */
  notice?: string | null;
}

export async function saveRecurring(db: Db, id: string | null, input: RecurringInput, currentMonth: string): Promise<Recurring> {
  const name = validateName(input.name, 'Namen');
  const amountCents = validateAmountCents(input.amountCents);
  if (!isValidMonthKey(input.startMonth)) throw new AppError('Ungültiger Startmonat.');
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 28) throw new AppError('Der Tag muss zwischen 1 und 28 liegen.');
  const tx = db.transaction(['recurring', 'categories'], 'readwrite');
  const cat = await tx.objectStore('categories').get(input.categoryId);
  if (!cat || cat.kind !== input.type) { abortTx(tx); throw new AppError('Die Kategorie passt nicht zur Art der Buchung.'); }
  const old = id ? await tx.objectStore('recurring').get(id) : undefined;
  if (id && !old) { abortTx(tx); throw new AppError('Die Vorlage wurde nicht gefunden.'); }
  let startMonth = input.startMonth;
  // Wer eine pausierte Vorlage wieder aktiviert, bekommt keine nachträglichen Buchungen für die Pause –
  // außer der Beginn („Gilt ab“) wurde dabei bewusst geändert.
  if (old && !old.active && input.active && startMonth < currentMonth && startMonth === old.startMonth) startMonth = currentMonth;
  const yearly = input.interval === 'yearly';
  if (yearly && amountCents < 12) { abortTx(tx); throw new AppError('Der Jahresbetrag muss mindestens 0,12 € betragen.'); }
  const r: Recurring = {
    id: old?.id ?? newId(), name, type: input.type, amountCents: yearly ? Math.round(amountCents / 12) : amountCents,
    categoryId: input.categoryId, startMonth, day: input.day, active: input.active, createdAt: old?.createdAt ?? new Date().toISOString()
  };
  if (yearly) {
    r.interval = 'yearly'; r.yearlyCents = amountCents;
    if (input.dueMonth != null) {
      if (!Number.isInteger(input.dueMonth) || input.dueMonth < 1 || input.dueMonth > 12) { abortTx(tx); throw new AppError('Bitte wähle einen gültigen Fälligkeitsmonat.'); }
      r.dueMonth = input.dueMonth;
    }
  }
  if (old?.endMonth && old.endMonth >= startMonth) r.endMonth = old.endMonth;
  if (old?.sort !== undefined) r.sort = old.sort;
  const notice = input.notice === undefined ? old?.notice : (input.notice ?? '').trim();
  if (notice) {
    if (notice.length > 80) { abortTx(tx); throw new AppError('Die Kündigungsfrist darf höchstens 80 Zeichen lang sein.'); }
    r.notice = notice;
  }
  await tx.objectStore('recurring').put(r);
  await tx.done;
  return r;
}

/** Entfernt die Vorlage. Bereits erzeugte Buchungen bleiben erhalten (ohne Verweis auf die Vorlage). */
export async function deleteRecurring(db: Db, id: string): Promise<void> {
  const tx = db.transaction(['recurring', 'recurringRuns', 'transactions'], 'readwrite');
  for (const t of await tx.objectStore('transactions').getAll()) {
    if (t.recurringId === id) { const { recurringId: _r, ...rest } = t; void _r; await tx.objectStore('transactions').put(rest); }
  }
  for (const run of await tx.objectStore('recurringRuns').index('by-recurring').getAll(id)) await tx.objectStore('recurringRuns').delete(run.key);
  await tx.objectStore('recurring').delete(id);
  await tx.done;
}

/**
 * Erzeugt fehlende Buchungen aller aktiven Vorlagen bis einschließlich currentMonth.
 * Idempotent: pro Vorlage und Monat höchstens eine Buchung. Wer eine erzeugte Buchung löscht,
 * bekommt sie nicht erneut (der Merker in recurringRuns bleibt bestehen).
 */
export async function runRecurring(db: Db, currentMonth: string): Promise<number> {
  const tx = db.transaction(['recurring', 'recurringRuns', 'transactions', 'categories'], 'readwrite');
  const recs = await tx.objectStore('recurring').getAll();
  const have = new Set((await tx.objectStore('recurringRuns').getAll()).map((r) => r.key));
  const cats = new Set((await tx.objectStore('categories').getAll()).map((c) => c.id));
  let created = 0;
  const now = new Date().toISOString();
  // Bestehende Buchungen nur laden, wenn wirklich etwas nachzubuchen ist
  let existing: Transaction[] | null = null;
  for (const r of recs) {
    if (!r.active || !cats.has(r.categoryId)) continue;
    const last = r.endMonth && r.endMonth < currentMonth ? r.endMonth : currentMonth;
    for (let m = r.startMonth, guard = 0; m <= last && guard < 600; m = shiftMonth(m, 1), guard++) {
      const key = `${r.id}:${m}`;
      if (have.has(key)) continue;
      const amountCents = r.interval === 'yearly' && r.yearlyCents ? yearlyShare(r.yearlyCents, m) : r.amountCents;
      // Ist die Ausgabe in diesem Monat schon gebucht (z. B. per CSV importiert oder von Hand), wird sie
      // der Vorlage zugeordnet statt doppelt gebucht: gleiche Art, gleiche Kategorie, gleicher Betrag.
      existing ??= (await tx.objectStore('transactions').getAll()) as Transaction[];
      const match = existing.find((t) => !t.recurringId && !t.goalId && !t.account && t.type === r.type && t.categoryId === r.categoryId
        && t.amountCents === amountCents && t.date.slice(0, 7) === m);
      if (match) {
        match.recurringId = r.id;
        await tx.objectStore('transactions').put(match);
      } else {
        const t: Transaction = {
          id: newId(), date: `${m}-${String(r.day).padStart(2, '0')}`, type: r.type, amountCents,
          categoryId: r.categoryId, description: r.name, createdAt: now, recurringId: r.id
        };
        await tx.objectStore('transactions').add(t);
        existing.push(t);
      }
      await tx.objectStore('recurringRuns').put({ key, recurringId: r.id, month: m, createdAt: now });
      created++;
    }
  }
  await tx.done;
  return created;
}

/* ───────── Gehalt (Basis der Aufteilung) ───────── */

/**
 * Setzt das monatliche Gehalt: aktualisiert die Gehalts-Vorlage (oder legt sie an) und die Basis der Aufteilung
 * in einer Transaktion. Bereits gebuchte Monate bleiben unverändert.
 */
export async function saveSalary(db: Db, amountCents: number, day: number, currentMonth: string, startMonth?: string): Promise<void> {
  const amount = validateAmountCents(amountCents);
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new AppError('Der Tag muss zwischen 1 und 28 liegen.');
  if (startMonth !== undefined && !isValidMonthKey(startMonth)) throw new AppError('Ungültiger Startmonat.');
  const tx = db.transaction(['recurring', 'categories', 'settings'], 'readwrite');
  const cats = await tx.objectStore('categories').getAll();
  const salaryCat = cats.find((c) => c.kind === 'income' && c.parentId === null && c.name === 'Gehalt') ?? cats.find((c) => c.kind === 'income' && !c.archived);
  if (!salaryCat) { abortTx(tx); throw new AppError('Lege zuerst eine Einnahmen-Kategorie an.'); }
  const recs = await tx.objectStore('recurring').getAll();
  const existing = recs.find((r) => r.type === 'income' && r.categoryId === salaryCat.id) ?? recs.find((r) => r.type === 'income');
  const r: Recurring = existing
    ? { ...existing, amountCents: amount, day, active: true, startMonth: startMonth ?? existing.startMonth }
    : { id: newId(), name: 'Gehalt', type: 'income', amountCents: amount, categoryId: salaryCat.id, startMonth: startMonth ?? currentMonth, day, active: true, createdAt: new Date().toISOString() };
  // Pausiertes Gehalt wieder aktiv: keine Nachbuchung für die Pause – außer „Gilt ab“ wurde bewusst geändert
  if (existing && !existing.active && r.startMonth < currentMonth && r.startMonth === existing.startMonth) r.startMonth = currentMonth;
  await tx.objectStore('recurring').put(r);
  const s = (await tx.objectStore('settings').get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  await tx.objectStore('settings').put({ key: 'app', value: { ...s, expectedIncomeCents: amount } });
  await tx.done;
}
