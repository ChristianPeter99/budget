import { cssOracle } from './cssOracle';
import { expect, type Page } from '@playwright/test';

/** Feste Uhrzeit für alle Referenzbilder */
export const NOW = new Date('2026-11-15T10:00:00+01:00');

export async function open(page: Page, opts: { tall?: boolean; width?: number; edge?: boolean; view?: 'grid' | 'list' } = {}) {
  await page.setViewportSize({ width: opts.width ?? 390, height: opts.tall ? 2200 : 844 });
  await page.clock.setFixedTime(NOW);
  // Reproduzierbare IDs (nur im Test-Browser): Buchungen mit gleichem Datum und gleicher Anlagezeit stehen in ID-Reihenfolge
  await page.addInitScript(() => {
    // Zustand über Neuladen hinweg behalten, sonst entstehen nach einem Reload dieselben IDs erneut
    let a = Number(sessionStorage.getItem('visSeed') ?? 12345);
    const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; sessionStorage.setItem('visSeed', String(a)); let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = Math.floor(rnd() * 16); return (ch === 'x' ? r : (r & 3) | 8).toString(16); }) as ReturnType<Crypto['randomUUID']>;
  });
  if (opts.view) await page.addInitScript((v) => localStorage.setItem('budget.catview.v1', JSON.stringify({ alltag: v, fix: v })), opts.view);
  await page.goto('/');
  if (opts.edge) await page.addStyleTag({ content: ':root{--edge:14px !important}' });
  await expect(page.locator('h1').first()).toBeVisible();
  await settle(page);
}
/** Warten, bis Zähl- und Einblend-Animationen durch sind */
export const settle = (page: Page) => page.waitForTimeout(1200);
export const shot = async (page: Page, name: string) => { await cssOracle(page, name); await expect(page).toHaveScreenshot(`${name}.png`); };
export const nav = (page: Page, name: string) => page.locator('nav').getByRole('button', { name, exact: true }).click().then(() => settle(page));
export async function more(page: Page, item: RegExp) { await nav(page, 'Mehr'); await page.getByRole('button', { name: item }).first().click(); await settle(page); }

/**
 * Reichere Daten zusätzlich zu den Beispieldaten: Alltag über drei Monate, Budgets (eins überschritten), Sparkonto,
 * Depot, Sparziel und gemeinsames Konto mit eigenen Buchungen. Alles mit festen IDs und Zeiten.
 */
export async function enrich(page: Page) {
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open('budget-app'); q.onsuccess = () => r(q.result); });
    const all = <T,>(s: string): Promise<T[]> => new Promise((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result as T[]); });
    type C = { id: string; name: string; group: string; kind: string; parentId: string | null; scope?: string };
    const cats = await all<C>('categories');
    const sub = (top: string, name: string) => { const t = cats.find((c) => c.name === top && !c.parentId)!; return cats.find((c) => c.parentId === t.id && c.name === name)!.id; };
    const plan: [string, string, string, number, string][] = [
      ['2026-11-02', 'Lebensmittel', 'Einkaufen', 4590, 'REWE Markt'], ['2026-11-03', 'Lebensmittel', 'Bäcker', 640, 'Bäckerei Huber'],
      ['2026-11-04', 'Auto', 'Benzin', 7094, 'Shell'], ['2026-11-05', 'Lebensmittel', 'Kantine', 820, 'Kantine'],
      ['2026-11-06', 'Freizeit', 'Kino', 1450, 'Kino Mathäser'], ['2026-11-07', 'Lebensmittel', 'Einkaufen', 12480, 'Edeka'],
      ['2026-11-08', 'Gesundheit', 'Apotheke', 1299, 'Apotheke am Markt'], ['2026-11-09', 'Lebensmittel', 'Essen gehen', 3800, 'Pizzeria'],
      ['2026-11-10', 'Bekleidung', 'Schuhe', 8999, 'Schuhhaus'], ['2026-11-11', 'Lebensmittel', 'Einkaufen', 9870, 'Aldi Süd'],
      ['2026-11-12', 'Sport', 'Sport', 2500, 'Kletterhalle'], ['2026-11-13', 'Sonstiges', 'Online', 3499, 'Onlineshop'],
      ['2026-11-14', 'Auto', 'Parken', 400, 'Parkhaus'], ['2026-11-15', 'Lebensmittel', 'Einkaufen', 2310, 'Lidl'],
      ['2026-10-05', 'Lebensmittel', 'Einkaufen', 15400, 'REWE Markt'], ['2026-10-12', 'Auto', 'Benzin', 6550, 'Aral'],
      ['2026-10-19', 'Freizeit', 'Ausflüge', 18000, 'Wochenendausflug'], ['2026-10-26', 'Gesundheit', 'Friseur', 3200, 'Friseur'],
      ['2026-09-08', 'Lebensmittel', 'Einkaufen', 21000, 'Wocheneinkäufe'], ['2026-09-20', 'Sonstiges', 'Urlaub', 64000, 'Ferienwohnung']
    ];
    const t = db.transaction(['transactions', 'budgets', 'settings', 'depotEntries'], 'readwrite');
    plan.forEach(([date, top, name, cents, text], i) => t.objectStore('transactions').put({ id: `vis-tx-${i}`, date, type: 'expense', amountCents: cents, categoryId: sub(top, name), description: text, createdAt: `${date}T12:00:${String(i).padStart(2, '0')}.000Z` }));
    const topId = (n: string) => cats.find((c) => c.name === n && !c.parentId)!.id;
    t.objectStore('budgets').put({ id: 'vis-b-1', scope: 'category', monthKey: 'default', categoryId: topId('Lebensmittel'), amountCents: 30000 });
    t.objectStore('budgets').put({ id: 'vis-b-2', scope: 'category', monthKey: 'default', categoryId: topId('Auto'), amountCents: 15000 });
    t.objectStore('budgets').put({ id: 'vis-b-3', scope: 'month', monthKey: 'default', amountCents: 120000 });
    t.objectStore('depotEntries').put({ id: 'vis-d-1', date: '2026-06-30', valueCents: 1180000, createdAt: '2026-06-30T12:00:00.000Z' });
    t.objectStore('depotEntries').put({ id: 'vis-d-2', date: '2026-10-31', valueCents: 1294550, createdAt: '2026-10-31T12:00:00.000Z' });
    const s = t.objectStore('settings');
    const rec: { key: string; value: Record<string, unknown> } = await new Promise((r) => { const q = s.get('app'); q.onsuccess = () => r(q.result); });
    rec.value.savingsBalanceCents = 845000; rec.value.savingsBalanceDate = '2026-10-31';
    rec.value.savingsHistory = [{ date: '2026-04-30', cents: 610000 }, { date: '2026-10-31', cents: 845000 }];
    rec.value.savingsGoals = [{ id: 'vis-g-1', name: 'Urlaub', targetCents: 200000, savedCents: 45000, dueMonth: '2027-06', createdAt: '2026-05-01T12:00:00.000Z', lastBookedMonth: '2026-11' }];
    rec.value.joint = { enabled: true, name: 'Haushaltskonto', partnerName: 'Alex', categoryId: null, partnerDefaultCents: 40000, partnerByMonth: {} };
    s.put(rec);
    await new Promise((r) => { t.oncomplete = r; });
    db.close();
  });
  // Neu laden: die App legt die Kategorien des Haushaltskontos an; dann Buchungen dort
  await page.reload();
  await expect(page.locator('h1').first()).toBeVisible();
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open('budget-app'); q.onsuccess = () => r(q.result); });
    const cats: { id: string; scope?: string; parentId: string | null; kind: string }[] = await new Promise((r) => { const q = db.transaction('categories').objectStore('categories').getAll(); q.onsuccess = () => r(q.result); });
    const hh = cats.filter((c) => c.scope === 'joint' && c.kind === 'expense');
    const t = db.transaction('transactions', 'readwrite');
    [['2026-11-03', 6230, 'Wocheneinkauf'], ['2026-11-08', 2890, 'Drogerie'], ['2026-11-12', 11240, 'Großeinkauf']].forEach(([date, cents, text], i) =>
      t.objectStore('transactions').put({ id: `vis-j-${i}`, date, type: 'expense', amountCents: cents, categoryId: hh[i % hh.length]!.id, description: text, createdAt: `${date}T13:00:00.000Z`, account: 'joint' }));
    await new Promise((r) => { t.oncomplete = r; });
    db.close();
  });
  await page.reload();
  await expect(page.locator('h1').first()).toBeVisible();
  await settle(page);
}
