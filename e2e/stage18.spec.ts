import { expect, test } from '@playwright/test';

test('Fenster lässt sich nach unten wegziehen; kurzer Zug federt zurück', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Filter' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  // kurz ziehen → bleibt offen
  await page.mouse.move(195, 150); await page.mouse.down();
  for (let i = 1; i <= 3; i++) { await page.mouse.move(195, 150 + i * 15); await page.waitForTimeout(40); }
  await page.mouse.up(); await page.waitForTimeout(400);
  await expect(dlg).toBeVisible();
  // weit ziehen → schließt
  await page.mouse.move(195, 150); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(195, 150 + i * 20);
  await page.mouse.up();
  await expect(dlg).toHaveCount(0);
});

test('Buchungen: Tagesüberschrift klebt oben; leerer Monat zeigt ruhigen leeren Zustand', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await expect(page.locator('.dayh').first()).toHaveCSS('position', 'sticky');
  await page.getByRole('button', { name: 'Nächster Monat' }).click();
  await expect(page.locator('.emptystate')).toContainText('Noch keine Buchungen');
  await expect(page.locator('.fline')).toHaveCount(0);
  await page.locator('.emptystate').getByRole('button', { name: 'Neue Buchung' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Fenster: Ziehen auch auf Kategorie-Reihen; seitliches Wischen sperrt das Wegziehen', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Neue Buchung' }).click();
  const dlg = page.getByRole('dialog');
  const chips = dlg.locator('.chips').first();
  const b = (await chips.boundingBox())!;
  // seitlich, dann nach unten → bleibt offen
  await page.mouse.move(b.x + 300, b.y + b.height / 2); await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(b.x + 300 - i * 15, b.y + b.height / 2);
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 240, b.y + b.height / 2 + i * 25);
  await page.mouse.up(); await page.waitForTimeout(400);
  await expect(dlg).toBeVisible();
  // senkrecht auf der Reihe nach unten → schließt
  await page.mouse.move(b.x + 150, b.y + b.height / 2); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 150, b.y + b.height / 2 + i * 25);
  await page.mouse.up();
  await expect(dlg).toHaveCount(0);
});

test('Fixkosten: Kopf einer langen Kategorie bleibt beim Scrollen oben stehen', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect(page.locator('.card.flush > .ghead.ghx').first()).toHaveCSS('position', 'sticky');
});
