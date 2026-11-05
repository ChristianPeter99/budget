import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function addBooking(page: Page, digits: string[], sub: string, note: string) {
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Neue Buchung' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of digits) await page.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Lebensmittel', exact: true }).click();
  await page.getByRole('button', { name: sub, exact: true }).click();
  await page.getByPlaceholder('Optional').fill(note);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function longPress(page: Page, sel: import('@playwright/test').Locator) {
  const b = (await sel.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test('Neue Buchung gleitet in die Liste und leuchtet kurz', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['7'], 'Kantine', 'Frisch');
  await expect(page.locator('.swipe.fresh', { hasText: 'Frisch' })).toHaveCount(1);
});

test('Gedrückt halten: Menü mit Bearbeiten, Duplizieren, Löschen; Tipp danach öffnet nicht die Buchung', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['1', '9'], 'Kantine', 'Halten');
  const row = page.locator('.swipe .item', { hasText: 'Halten' });
  await longPress(page, row);
  const menu = page.getByRole('dialog', { name: 'Aktionen für Buchung' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Bearbeiten', 'Duplizieren', 'Löschen']);
  // kein Bearbeiten-Fenster durch das Loslassen
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Duplizieren → neues Fenster mit gleichem Betrag
  await longPress(page, row);
  await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true })).toHaveText('19,00 €');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.swipe .item', { hasText: 'Halten' })).toHaveCount(2);

  // Löschen mit Rückgängig
  await longPress(page, page.locator('.swipe .item', { hasText: 'Halten' }).first());
  await page.getByRole('menuitem', { name: 'Löschen' }).click();
  await expect(page.locator('.swipe .item', { hasText: 'Halten' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.swipe .item', { hasText: 'Halten' })).toHaveCount(2);
});

test('Gedrückt halten auch in den Buchungen einer Unterkategorie (Alltag)', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['5'], 'Kantine', 'Drill');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await page.getByRole('button', { name: /Buchungen Kantine aufklappen/ }).click();
  const row = page.locator('.clp.done .drill .item', { hasText: 'Drill' });
  await expect(row).toBeVisible();
  await longPress(page, row);
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  await expect(page.getByRole('dialog').getByPlaceholder('Optional')).toHaveValue('Drill');
});

test('Aufklappen ist weich und Zuklappen entfernt den Inhalt danach', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  const card = page.locator('.card', { has: page.locator('.ghead b', { hasText: /^Lebensmittel$/ }) });
  await expect(card.locator('.clp.done .subrow').first()).toBeVisible();
  await page.getByRole('button', { name: 'Lebensmittel zuklappen' }).click();
  await expect(card.locator('.clp.shut')).toHaveCount(1);
  await expect(card.locator('.subrow')).toHaveCount(0);
  await page.getByRole('button', { name: 'Lebensmittel aufklappen' }).click();
  await expect(card.locator('.clp.done .subrow').first()).toBeVisible();
});

test('Aktiven Reiter antippen: nach oben bzw. eine Ebene zurück', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  const view = page.locator('main.view');
  await view.evaluate((m) => { m.scrollTop = 400; });
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect.poll(() => view.evaluate((m) => m.scrollTop)).toBe(0);
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /Kategorien/ }).click();
  await expect(page.locator('main [data-pop]')).toBeVisible();
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mehr' })).toBeVisible();
});

test('Mehr-Unterseite: vom linken Rand nach rechts wischen geht zurück', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /Auswertung/ }).click();
  await expect(page.locator('main [data-pop]')).toBeVisible();
  const y = 400;
  // kurzer Zug federt zurück
  await page.mouse.move(6, y); await page.mouse.down();
  for (let i = 1; i <= 4; i++) { await page.mouse.move(6 + i * 12, y); await page.waitForTimeout(30); }
  await page.waitForTimeout(150);
  await page.mouse.up(); await page.waitForTimeout(500);
  await expect(page.locator('main [data-pop]')).toBeVisible();
  // weiter Zug → zurück zum Menü
  await page.mouse.move(6, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(6 + i * 20, y); await page.waitForTimeout(16); }
  await page.mouse.up();
  await expect(page.getByRole('heading', { level: 1, name: 'Mehr' })).toBeVisible();
  await expect(page.locator('main [data-pop]')).toHaveCount(0);
  // Reiter wurde nicht gewechselt
  await expect(page.locator('nav [aria-current="page"]')).toHaveAttribute('aria-label', 'Mehr');
});
