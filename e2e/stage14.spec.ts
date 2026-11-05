import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

async function swipe(page: Page, el: Locator, dir: -1 | 1) {
  const b = (await el.boundingBox())!;
  const y = b.y + b.height / 2, x0 = b.x + b.width / 2 - dir * 80;
  await page.mouse.move(x0, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + dir * 20 * i, y);
  await page.mouse.up();
}

test('Übersicht: Monat per Wischen im Kopf, sonst Reiterwechsel; Ring mit Ecken und Details', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  if (await ok.count()) await ok.first().click();
  const h1 = page.locator('h1').first();
  const start = await h1.innerText();
  const nav = page.locator('nav');
  // Wischen im Kopf (Monatsname) wechselt den Monat
  await swipe(page, h1, -1);
  await expect(h1).not.toHaveText(start);
  await expect(nav.getByRole('button', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
  await swipe(page, h1, 1);
  await expect(h1).toHaveText(start);
  // Wischen auf dem Inhalt blättert zwischen den Reitern
  await swipe(page, page.locator('.ovcorner.bl'), -1);
  await expect(nav.getByRole('button', { name: 'Alltag' })).toHaveAttribute('aria-current', 'page');
  // feststehende Kopfzeile: nach dem Einrasten keine Kopie mehr, echter Kopf sichtbar
  await expect(page.locator('.headlayer > *')).toHaveCount(0);
  await expect(page.locator('main.view .hd')).toBeVisible();
  await expect(page.locator('main.view .kick')).toContainText('Alltag');
  await expect(page.locator('.pageghost')).toHaveCount(0);
  await swipe(page, page.locator('.catbar'), -1);
  await expect(nav.getByRole('button', { name: 'Buchungen' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.pageghost')).toHaveCount(0);
  await swipe(page, page.locator('.fline'), 1);
  await expect(nav.getByRole('button', { name: 'Alltag' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.pageghost')).toHaveCount(0);
  await swipe(page, page.locator('.flathero'), 1);
  await expect(nav.getByRole('button', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
  await expect(h1).toHaveText(start);
  // kurzer, langsamer Zug federt zurück
  const b = (await page.locator('.ovcorner.bl').boundingBox())!;
  await page.mouse.move(b.x + 100, b.y + 20); await page.mouse.down();
  for (let i = 1; i <= 4; i++) { await page.mouse.move(b.x + 100 - i * 10, b.y + 20); await page.waitForTimeout(60); }
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(nav.getByRole('button', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.pageghost')).toHaveCount(0);
  // Untere Leiste schaltet schon beim Ziehen über die Hälfte um, nicht erst nach der Animation
  const t = (await page.locator('.ovcorner.bl').boundingBox())!;
  await page.mouse.move(360, t.y + 20); await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(360 - i * 18, t.y + 20);
  await expect(nav.locator('[data-tab="alltag"]')).toHaveClass(/\bon\b/, { timeout: 250 });
  await expect(page.locator('.pageghost')).toHaveCount(1);
  await page.mouse.up();
  await expect(nav.getByRole('button', { name: 'Alltag' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.pageghost')).toHaveCount(0);
  await nav.getByRole('button', { name: 'Übersicht' }).click();
  // Übersicht als Ring: vier Ecken, Tipp zeigt Details in der Mitte, „öffnen“ springt in den Reiter
  await expect(page.locator('.ovcorner')).toHaveCount(4);
  await expect(page.locator('.ovcorner.tr')).toContainText('%');
  await page.locator('.ovcorner.br').click();
  await expect(page.locator('.ovcenter')).toContainText('Alltag');
  await page.getByRole('button', { name: 'Zurück zur Gesamtansicht' }).click();
  await expect(page.locator('.ovcenter')).toContainText('Noch verfügbar');
  await page.locator('.ovcorner.tr').click();
  await page.getByRole('button', { name: /Fixkosten öffnen/ }).click();
  await expect(page.locator('nav').getByRole('button', { name: 'Fixkosten' })).toHaveAttribute('aria-current', 'page');
});
