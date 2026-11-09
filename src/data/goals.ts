// Sparziele speichern und monatlich automatisch ansparen.
import type { Db } from './schema';
import { AppError, DEFAULT_SETTINGS, newId } from '../domain/types';
import type { Category, SavingsGoal, Transaction } from '../domain/types';
import { validateName } from '../domain/validate';
import { MAX_CENTS } from '../domain/money';
import { currentMonthKey, isValidMonthKey, shiftMonth, todayISO } from '../domain/dates';
import { abortTx } from './internal';

/* ───────── Sparziele ───────── */

export interface GoalInput { name: string; targetCents: number; savedCents: number; dueMonth: string; auto?: boolean }

/** Sparziel anlegen (id = null) oder ändern. */
export async function saveGoal(db: Db, id: string | null, input: GoalInput): Promise<SavingsGoal> {
  const name = validateName(input.name, 'Namen');
  if (name.length > 40) throw new AppError('Der Name darf höchstens 40 Zeichen lang sein.');
  if (!Number.isInteger(input.targetCents) || input.targetCents < 1 || input.targetCents > MAX_CENTS) throw new AppError('Bitte gib einen gültigen Zielbetrag ein.');
  if (!Number.isInteger(input.savedCents) || input.savedCents < 0 || input.savedCents > MAX_CENTS) throw new AppError('Bitte gib einen gültigen angesparten Betrag ein.');
  if (!isValidMonthKey(input.dueMonth)) throw new AppError('Bitte wähle einen Zielmonat.');
  const tx = db.transaction('settings', 'readwrite');
  const cur = (await tx.store.get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  const goals = [...(cur.savingsGoals ?? [])];
  const i = id ? goals.findIndex((g) => g.id === id) : -1;
  if (id && i < 0) { abortTx(tx); throw new AppError('Das Sparziel wurde nicht gefunden.'); }
  if (!id && goals.length >= 50) { abortTx(tx); throw new AppError('Es sind höchstens 50 Sparziele möglich.'); }
  const old = i >= 0 ? (goals[i] as SavingsGoal) : undefined;
  const auto = input.auto ?? old?.auto ?? true;
  const g: SavingsGoal = { id: id ?? newId(), name, targetCents: input.targetCents, savedCents: input.savedCents, dueMonth: input.dueMonth, createdAt: old ? old.createdAt : new Date().toISOString(), auto };
  // Automatisch ansparen beginnt im aktuellen Monat – nie rückwirkend (auch nicht beim späteren Einschalten)
  if (auto) g.lastBookedMonth = old?.auto !== false && old?.lastBookedMonth ? old.lastBookedMonth : shiftMonth(currentMonthKey(), -1);
  else if (old?.lastBookedMonth) g.lastBookedMonth = old.lastBookedMonth;
  if (i >= 0) goals[i] = g; else goals.push(g);
  await tx.store.put({ key: 'app', value: { ...cur, savingsGoals: goals } });
  await tx.done;
  return g;
}

/**
 * „Sparziel on top“: Für jedes Ziel mit „Automatisch ansparen“ wird jeden Monat bis zum Zielmonat der nötige Betrag
 * (Rest ÷ verbleibende Monate, auf ganze Euro aufgerundet) als Sparen-Buchung angelegt – zusätzlich zur festen
 * Sparrate oder, ohne Sparrate, als Sparrate auf Zeit. Erreicht oder Zielmonat vorbei: keine Buchung mehr.
 * Bereits erledigte Monate merkt sich das Ziel (lastBookedMonth); eine gelöschte Buchung wird nicht nachgebucht.
 */
export async function runGoals(db: Db, currentMonth: string): Promise<number> {
  const tx = db.transaction(['settings', 'transactions', 'categories', 'recurring'], 'readwrite');
  const cur = (await tx.objectStore('settings').get('app'))?.value;
  const goals = cur?.savingsGoals ?? [];
  // Ziele ohne gemerkten Monat (vor Version 1.42 angelegt) starten im aktuellen Monat
  const startOf = (g: SavingsGoal) => g.lastBookedMonth ?? shiftMonth(currentMonth, -1);
  const due = goals.filter((g) => g.auto !== false && startOf(g) < currentMonth);
  if (!cur || due.length === 0) { await tx.done; return 0; }
  // Kategorie: die der festen Sparrate, sonst eine buchbare Sparen-Kategorie
  const cats = await tx.objectStore('categories').getAll();
  const recs = await tx.objectStore('recurring').getAll();
  const isLeaf = (c: Category) => !cats.some((x) => x.parentId === c.id);
  const spar = cats.filter((c) => c.kind === 'expense' && c.group === 'spar' && !c.archived && !c.scope);
  const fromRate = recs.find((r) => r.active && r.type === 'expense' && spar.some((c) => c.id === r.categoryId));
  const cat = (fromRate && spar.find((c) => c.id === fromRate.categoryId)) ?? spar.find(isLeaf);
  if (!cat) { await tx.done; return 0; }
  const all = (await tx.objectStore('transactions').getAll()) as Transaction[];
  const now = new Date().toISOString();
  let created = 0;
  const next = goals.map((g) => ({ ...g }));
  for (const g of next) {
    if (g.auto === false || startOf(g) >= currentMonth) continue;
    let saved = g.savedCents + all.filter((t) => t.goalId === g.id).reduce((a, t) => a + t.amountCents, 0);
    for (let m = shiftMonth(startOf(g), 1), guard = 0; m <= currentMonth && guard < 600; m = shiftMonth(m, 1), guard++) {
      g.lastBookedMonth = m;
      const remaining = g.targetCents - saved;
      if (remaining <= 0 || m > g.dueMonth) continue;
      const [my, mm] = m.split('-').map(Number) as [number, number];
      const [dy, dm] = g.dueMonth.split('-').map(Number) as [number, number];
      const monthsLeft = (dy - my) * 12 + (dm - mm) + 1;
      const amountCents = Math.min(remaining, Math.ceil(remaining / monthsLeft / 100) * 100);
      // Im Startmonat am Tag des Anlegens, danach am Monatsersten
      const created0 = g.createdAt.slice(0, 7) === m ? todayISO() : `${m}-01`;
      const t: Transaction = { id: newId(), date: created0 <= todayISO() ? created0 : `${m}-01`, type: 'expense', amountCents, categoryId: cat.id, description: `Sparziel: ${g.name}`, createdAt: now, goalId: g.id };
      await tx.objectStore('transactions').add(t);
      all.push(t);
      saved += amountCents;
      created++;
    }
  }
  await tx.objectStore('settings').put({ key: 'app', value: { ...cur, savingsGoals: next } });
  await tx.done;
  return created;
}

/** Sparziel löschen; gibt das gelöschte Ziel zurück (für „Rückgängig“). */
export async function deleteGoal(db: Db, id: string): Promise<SavingsGoal | undefined> {
  const tx = db.transaction('settings', 'readwrite');
  const cur = (await tx.store.get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  const g = (cur.savingsGoals ?? []).find((x) => x.id === id);
  await tx.store.put({ key: 'app', value: { ...cur, savingsGoals: (cur.savingsGoals ?? []).filter((x) => x.id !== id) } });
  await tx.done;
  return g;
}

/** Gelöschtes Sparziel wiederherstellen. */
export async function restoreGoal(db: Db, g: SavingsGoal): Promise<void> {
  const tx = db.transaction('settings', 'readwrite');
  const cur = (await tx.store.get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  if (!(cur.savingsGoals ?? []).some((x) => x.id === g.id)) await tx.store.put({ key: 'app', value: { ...cur, savingsGoals: [...(cur.savingsGoals ?? []), g] } });
  await tx.done;
}
