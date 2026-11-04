import { expect, test } from '@playwright/test';
import { APP_VERSION } from '../src/version';

test('Einstellungen: Nach Update suchen meldet die aktuelle Version', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Daten & Backup/ }).click();
  await expect(page.getByRole('heading', { name: 'App-Version' })).toBeVisible();
  await page.getByRole('button', { name: 'Nach Update suchen' }).click();
  await expect(page.getByText('Du hast die neueste Version.')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.kv', { hasText: 'Auf dem Server' })).toContainText(APP_VERSION);
});

test('Zahlenfeld ist dezent, aber jede Taste mindestens 44 pt hoch', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  const keys = page.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button');
  // Zahlenfeld erscheint erst nach Tipp auf den Betrag, unten im Vordergrund ohne Scrollen
  await expect(keys).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  await expect(keys).toHaveCount(12);
  for (const k of await keys.all()) await expect(k).toBeInViewport();
  await page.waitForTimeout(400); // Einblend-Animation abwarten
  for (const box of await keys.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(keys).toHaveCount(0);
  // Kategorie-Chips bleiben ohne Scrollen sichtbar
  await expect(page.getByText('Kategorie', { exact: true })).toBeInViewport();
});
