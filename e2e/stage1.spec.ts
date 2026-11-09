import { expect, test } from '@playwright/test';
import { pickDay } from './rangecal';
import type { Page } from '@playwright/test';

async function seedMany(page: Page, n: number) {
  await page.evaluate((N) => new Promise<void>((res, rej) => {
    const r = indexedDB.open('budget-app');
    r.onsuccess = () => {
      const db = r.result;
      const q = db.transaction('categories').objectStore('categories').getAll();
      q.onsuccess = () => {
        const leaves = (q.result as { id: string; kind: string; parentId: string | null }[]).filter((c) => c.kind === 'expense' && c.parentId);
        const tx = db.transaction('transactions', 'readwrite');
        const st = tx.objectStore('transactions');
        for (let i = 0; i < N; i++) {
          const d = new Date(2023, 0, 1); d.setDate(d.getDate() + (i % 1400));
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          st.put({ id: 'p' + i, date: iso, type: 'expense', amountCents: 100 + (i % 5000), categoryId: leaves[i % leaves.length]!.id, description: 'Test ' + i, createdAt: new Date().toISOString() });
        }
        tx.oncomplete = () => { db.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
    };
  }), n);
}

test('5.000 Buchungen: Gesamtliste und Suche bleiben schnell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await seedMany(page, 5000);
  await page.reload();
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Von–bis' }).click();
  await pickDay(page.getByRole('dialog'), '2023-01-01');
  await pickDay(page.getByRole('dialog'), '2026-12-31');
  let t = Date.now(); // gemessen wird die Liste, nicht das Blättern im Kalender
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();
  await expect(page.locator('.swipe').first()).toBeVisible();
  const listMs = Date.now() - t;
  expect(await page.locator('.swipe').count()).toBeLessThanOrEqual(240);
  t = Date.now();
  await page.getByLabel('Suchen').pressSequentially('Test 4999');
  await expect(page.locator('.swipe', { hasText: 'Test 4999' })).toBeVisible();
  const searchMs = Date.now() - t;
  await page.getByLabel('Suchen').fill('');
  await expect.poll(() => page.locator('.swipe').count()).toBe(120);
  // Nachladen beim Scrollen
  await page.locator('.view').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(() => page.locator('.swipe').count()).toBeGreaterThan(120);
  t = Date.now();
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  await expect(page.getByText('Noch verfügbar')).toBeVisible();
  const leaveMs = Date.now() - t;
  console.log(JSON.stringify({ listMs, searchMs, leaveMs }));
  expect(listMs).toBeLessThan(1500);
  expect(leaveMs).toBeLessThan(1500);
});

test('Monatswechsel bei offener App springt in den neuen Monat', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 31, 23, 58) });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Oktober 2026' })).toBeVisible();
  await page.clock.fastForward('05:00');
  await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
});

test('Keine Verstöße gegen die Content-Security-Policy auf allen Seiten', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await page.goto('/');
  await page.evaluate(() => document.addEventListener('securitypolicyviolation', (e) => console.error('Refused to ' + e.violatedDirective)));
  for (const tab of ['Alltag', 'Fixkosten', 'Mehr', 'Übersicht']) await page.getByRole('button', { name: tab, exact: true }).click();
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  for (const p of [/Sparen & Depot/, /Auswertung/, /^Wiederkehrende Einnahmen/, /Budgets/, /Daten & Backup/]) {
    await page.getByRole('button', { name: p }).click();
    await page.getByRole('button', { name: 'Zurück' }).or(page.getByRole('button', { name: 'Mehr' }).first()).first().click();
  }
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'self'");
  expect(violations).toEqual([]);
});

test('Backup zählt erst nach Bestätigung als gesichert', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Backup/ }).click();
  await expect(page.getByText('noch nie')).toBeVisible();
  await page.getByRole('button', { name: 'Backup erstellen' }).click();
  await page.getByLabel('Passwort').fill('sehr-langes-passwort');
  await page.getByLabel('Wiederholen').fill('sehr-langes-passwort');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Verschlüsseln/ }).click();
  await download;
  await page.getByRole('button', { name: 'Nein / weiß nicht' }).click();
  await expect(page.getByText('noch nie')).toBeVisible();
  await page.getByRole('button', { name: 'Backup erstellen' }).click();
  await page.getByLabel('Passwort').fill('sehr-langes-passwort');
  await page.getByLabel('Wiederholen').fill('sehr-langes-passwort');
  await page.getByRole('button', { name: /Verschlüsseln/ }).click();
  await page.getByRole('button', { name: 'Ja, gespeichert' }).click();
  await expect(page.getByText('noch nie')).toHaveCount(0);
  await expect(page.locator('.fhbig', { hasText: 'heute' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Datenschutz' })).toHaveCount(0);
});

test('Darstellungsfehler zeigt eine Meldung statt eines leeren Bildschirms', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(Intl.NumberFormat.prototype, 'format', { get() { throw new Error('Testfehler'); } }); });
  await page.getByRole('button', { name: 'Fixkosten', exact: true }).click();
  await expect(page.getByText('Diese Ansicht konnte nicht angezeigt werden.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neu laden' })).toBeVisible();
});
