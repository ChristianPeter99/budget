import { expect, test } from '@playwright/test';
import { demoData, thisMonth } from '../tests/demo';
import type { BackupData, Transaction } from '../src/domain/types';

/**
 * Viele Buchungen: 5.000 Ausgaben und Einnahmen über zwei Jahre. Ein Reiterwechsel (Tipp bis zum nächsten
 * gezeichneten Bild) soll unter 100 ms bleiben. Gemessen wird im Browser, ohne Animationen mitzuzählen.
 */
function bigData(n = 5000): BackupData {
  const d = demoData(thisMonth());
  const leaf = d.categories.filter((c) => c.kind === 'expense' && c.parentId !== null && c.scope !== 'joint');
  const now = new Date();
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const txs: Transaction[] = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Math.floor(rnd() * 730));
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const c = leaf[Math.floor(rnd() * leaf.length)]!;
    txs.push({ id: `perf-${i}`, date: iso, type: 'expense', amountCents: 100 + Math.floor(rnd() * 9000), categoryId: c.id, description: `Buchung ${i}`, createdAt: `${iso}T12:00:00.000Z` } as Transaction);
  }
  return { ...d, transactions: [...d.transactions, ...txs] };
}

test.use({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'seedDemo', value: JSON.stringify(bigData()) }, { name: 'budget.catview.v1', value: JSON.stringify({ alltag: 'list', fix: 'list' }) }] }] } });

test('Reiterwechsel bei 5.000 Buchungen unter 100 ms', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const rate = Number(process.env.CPU_SLOW ?? 1);
  if (rate > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
  await page.goto('/');
  await expect(page.locator('.ovcenter')).toBeVisible();
  // Daten wirklich geladen?
  const count = await page.evaluate(() => new Promise<number>((res, rej) => { const r = indexedDB.open('budget-app'); r.onsuccess = () => { const q = r.result.transaction('transactions').objectStore('transactions').count(); q.onsuccess = () => res(q.result); q.onerror = rej; }; r.onerror = rej; }));
  expect(count).toBeGreaterThanOrEqual(5000);
  const tabs = ['Alltag', 'Buchungen', 'Fixkosten', 'Mehr', 'Übersicht'];
  const times: Record<string, number[]> = {};
  for (let round = 0; round < 3; round++) {
    for (const name of tabs) {
      const ms = await page.evaluate(async (name) => {
        const b = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find((x) => x.getAttribute('aria-label') === name || x.textContent?.trim() === name);
        if (!b) throw new Error('Reiter fehlt: ' + name);
        const t0 = performance.now();
        b.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      }, name);
      (times[name] ??= []).push(ms);
      await page.waitForTimeout(300);
    }
  }
  const median = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, [...v].sort((a, b) => a - b)[1]!]));
  console.log('Reiterwechsel (Median, ms):', JSON.stringify(median));
  for (const [k, v] of Object.entries(median)) expect(v, k).toBeLessThan(100);
});
