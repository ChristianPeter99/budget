import { expect, test } from '@playwright/test';

test('Fehlen Programmdateien, erscheint statt eines leeren Bildschirms ein Hinweis mit „Neu laden“', async ({ page }) => {
  await page.route('**/assets/*.js', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await expect(page.getByText('Budget startet nicht')).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('link', { name: 'Neu laden' })).toBeVisible();
  await page.unroute('**/assets/*.js');
  await page.getByRole('link', { name: 'Neu laden' }).click();
  await expect(page.locator('.nav')).toBeVisible();
});

test('Neu installieren ändert nichts, wenn der Server unvollständig ist; Update-Hinweis bei neuerer Server-Version', async ({ page }) => {
  await page.goto('/');
  await page.route('**/version.json*', (r) => r.fulfill({ body: '{"version":"99.0.0"}', contentType: 'application/json' }));
  await page.route('**/assets/*?r=*', (r) => r.fulfill({ status: 404, body: '' }));
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Daten & Backup/ }).click();
  await page.getByRole('button', { name: 'Nach Updates suchen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'liegt auf dem Server' })).toContainText('99.0.0', { timeout: 40000 });
  await page.getByRole('button', { name: /Update hängt/ }).click();
  await page.getByRole('button', { name: 'Neu installieren', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Es wurde nichts verändert');
  await expect(page.locator('.nav')).toBeVisible();
});
