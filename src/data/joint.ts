// Gemeinsames Konto (Haushaltskonto) einrichten und verwalten.
import type { Db } from './schema';
import { AppError, DEFAULT_SETTINGS, isHouseholdCat, newId } from '../domain/types';
import type { Category, JointSettings, Recurring } from '../domain/types';
import { validateAmountCents } from '../domain/validate';
import { isValidMonthKey } from '../domain/dates';
import { abortTx } from './internal';

/* ───────── Kategorien des Haushaltskontos ───────── */

const HOUSEHOLD_STARTER: [string, string[]][] = [['Lebensmittel', ['Einkaufen', 'Getränke']], ['Haushalt', ['Drogerie', 'Putzmittel']]];

/**
 * Sorgt dafür, dass das Haushaltskonto eine eigene Kategorienliste hat (idempotent, eine Transaktion):
 * - Buchungen des Haushaltskontos, die noch auf Kategorien des eigenen Kontos zeigen (vor Version 1.12 oder aus
 *   älteren Backups), bekommen eine gleichnamige Kategorie in der Haushaltsliste.
 * - Ist das gemeinsame Konto eingerichtet, aber die Liste leer, werden ein paar Startkategorien angelegt.
 * Gibt die Zahl der umgehängten Buchungen zurück.
 */
export async function ensureHouseholdCategories(db: Db): Promise<number> {
  const tx = db.transaction(['categories', 'transactions', 'settings'], 'readwrite');
  const cs = tx.objectStore('categories');
  const all = await cs.getAll();
  const settings = (await tx.objectStore('settings').get('app'))?.value;
  const jointTx = (await tx.objectStore('transactions').getAll()).filter((t) => t.account === 'joint');
  let sort = Math.max(-1, ...all.map((x) => x.sort)) + 1;
  const now = new Date().toISOString();
  const find = (name: string, parentId: string | null) => all.find((c) => isHouseholdCat(c) && c.parentId === parentId && c.name.toLowerCase() === name.toLowerCase());
  const make = async (name: string, parentId: string | null): Promise<Category> => {
    const c: Category = { id: newId(), name, kind: 'expense', group: 'alltag', parentId, archived: false, sort: sort++, createdAt: now, scope: 'joint' };
    await cs.add(c); all.push(c); return c;
  };
  let moved = 0;
  for (const t of jointTx) {
    const c = all.find((x) => x.id === t.categoryId);
    if (!c || isHouseholdCat(c)) continue;
    const top = c.parentId ? all.find((x) => x.id === c.parentId) : c;
    if (!top) continue;
    const jTop = find(top.name, null) ?? await make(top.name, null);
    const target = c.parentId ? (find(c.name, jTop.id) ?? await make(c.name, jTop.id)) : jTop;
    await tx.objectStore('transactions').put({ ...t, categoryId: target.id });
    moved++;
  }
  if (settings?.joint?.enabled && !all.some(isHouseholdCat)) {
    for (const [top, subs] of HOUSEHOLD_STARTER) { const tp = await make(top, null); for (const s of subs) await make(s, tp.id); }
  }
  await tx.done;
  return moved;
}

/* ───────── Gemeinsames Konto ───────── */

export const JOINT_CATEGORY_NAME = 'Gemeinsames Konto';

export interface JointSetupInput { name: string; partnerName: string; myCents: number; day: number; partnerDefaultCents: number }

/**
 * Richtet das gemeinsame Konto ein oder ändert es (eine Transaktion):
 * Kategorie „Gemeinsames Konto“ (Alltag) für den eigenen Beitrag, monatliche Vorlage dafür, Einstellungen.
 * Bestehende Buchungen bleiben unverändert; ein geänderter Beitrag gilt ab dem nächsten erzeugten Monat.
 */
export async function saveJointSetup(db: Db, input: JointSetupInput, currentMonth: string): Promise<void> {
  const name = (input.name ?? '').trim() || 'Haushaltskonto';
  if (name.length > 40 || (input.partnerName ?? '').trim().length > 40) throw new AppError('Die Namen dürfen höchstens 40 Zeichen lang sein.');
  const my = validateAmountCents(input.myCents);
  if (!Number.isSafeInteger(input.partnerDefaultCents) || input.partnerDefaultCents < 0) throw new AppError('Bitte gib einen gültigen Beitrag der anderen Person ein.');
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 28) throw new AppError('Der Tag muss zwischen 1 und 28 liegen.');
  const tx = db.transaction(['categories', 'recurring', 'settings'], 'readwrite');
  const cats = await tx.objectStore('categories').getAll();
  const s = (await tx.objectStore('settings').get('app'))?.value ?? { ...DEFAULT_SETTINGS };
  let cat = (s.joint?.categoryId ? cats.find((c) => c.id === s.joint?.categoryId) : undefined)
    ?? cats.find((c) => c.parentId === null && c.kind === 'expense' && c.name === JOINT_CATEGORY_NAME);
  const now = new Date().toISOString();
  if (!cat) {
    cat = { id: newId(), name: JOINT_CATEGORY_NAME, kind: 'expense', group: 'alltag', parentId: null, archived: false, sort: -1, createdAt: now };
  } else if (cat.archived) {
    cat = { ...cat, archived: false };
  }
  await tx.objectStore('categories').put(cat);
  const recs = await tx.objectStore('recurring').getAll();
  const old = recs.find((r) => r.categoryId === cat.id && r.type === 'expense');
  const rec: Recurring = old
    ? { ...old, name: `Beitrag ${name}`, amountCents: my, day: input.day, active: true, startMonth: !old.active && old.startMonth < currentMonth ? currentMonth : old.startMonth }
    : { id: newId(), name: `Beitrag ${name}`, type: 'expense', amountCents: my, categoryId: cat.id, startMonth: currentMonth, day: input.day, active: true, createdAt: now };
  await tx.objectStore('recurring').put(rec);
  // Übertrag: bei Neueinrichtung oder Wiedereinschalten ab dem aktuellen Monat, sonst unverändert
  const startMonth = s.joint?.enabled ? (s.joint.startMonth ?? undefined) : currentMonth;
  const joint: JointSettings = { enabled: true, name, partnerName: (input.partnerName ?? '').trim(), categoryId: cat.id, partnerDefaultCents: input.partnerDefaultCents, partnerByMonth: s.joint?.partnerByMonth ?? {} };
  if (startMonth) joint.startMonth = startMonth;
  await tx.objectStore('settings').put({ key: 'app', value: { ...s, joint } });
  await tx.done;
}

/** Abweichender Beitrag der anderen Person für einen Monat (null = wieder der übliche Betrag). */
export async function setPartnerMonth(db: Db, monthKey: string, cents: number | null): Promise<void> {
  if (!isValidMonthKey(monthKey)) throw new AppError('Ungültiger Monat.');
  if (cents !== null && (!Number.isSafeInteger(cents) || cents < 0)) throw new AppError('Bitte gib einen gültigen Betrag ein.');
  const tx = db.transaction('settings', 'readwrite');
  const s = (await tx.store.get('app'))?.value;
  if (!s?.joint) { abortTx(tx); throw new AppError('Das gemeinsame Konto ist nicht eingerichtet.'); }
  const byMonth = { ...s.joint.partnerByMonth };
  if (cents === null) delete byMonth[monthKey]; else byMonth[monthKey] = cents;
  await tx.store.put({ key: 'app', value: { ...s, joint: { ...s.joint, partnerByMonth: byMonth } } });
  await tx.done;
}

/** Startet den Übertrag ab einem Monat neu (z. B. nach Abgleich mit dem echten Kontostand). */
export async function resetJointCarry(db: Db, monthKey: string): Promise<void> {
  if (!isValidMonthKey(monthKey)) throw new AppError('Ungültiger Monat.');
  const tx = db.transaction('settings', 'readwrite');
  const s = (await tx.store.get('app'))?.value;
  if (!s?.joint) { abortTx(tx); throw new AppError('Das gemeinsame Konto ist nicht eingerichtet.'); }
  await tx.store.put({ key: 'app', value: { ...s, joint: { ...s.joint, startMonth: monthKey } } });
  await tx.done;
}

/** Schaltet das gemeinsame Konto aus (Buchungen und Kategorie bleiben erhalten, der eigene Beitrag wird pausiert). */
export async function disableJoint(db: Db): Promise<void> {
  const tx = db.transaction(['recurring', 'settings'], 'readwrite');
  const s = (await tx.objectStore('settings').get('app'))?.value;
  if (!s?.joint) { await tx.done; return; }
  for (const r of await tx.objectStore('recurring').getAll()) {
    if (r.categoryId === s.joint.categoryId && r.active) await tx.objectStore('recurring').put({ ...r, active: false });
  }
  await tx.objectStore('settings').put({ key: 'app', value: { ...s, joint: { ...s.joint, enabled: false } } });
  await tx.done;
}
