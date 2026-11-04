import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

async function swipe(page: Page, el: Locator, dir: -1 | 1) {
  const b = (await el.boundingBox())!;
  const y = b.y + b.height / 2, x0 = b.x + b.width / 2 - dir * 80;
  await page.mouse.move(x0, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + dir * 20 * i, y);
  await page.mouse.up();
}

test('Übersicht: Monat per Wischen im Kopf, sonst Reiterwechsel; Kacheln, Schnell erfassen, Zuletzt', async ({ page }) => {
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
  await swipe(page, page.locator('.gtile').nth(1), -1);
  await expect(nav.getByRole('button', { name: 'Alltag' })).toHaveAttribute('aria-current', 'page');
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
  const b = (await page.locator('.gtile').nth(1).boundingBox())!;
  await page.mouse.move(b.x + 100, b.y + 20); await page.mouse.down();
  for (let i = 1; i <= 4; i++) { await page.mouse.move(b.x + 100 - i * 10, b.y + 20); await page.waitForTimeout(60); }
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(nav.getByRole('button', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.pageghost')).toHaveCount(0);
  // Untere Leiste schaltet schon beim Ziehen über die Hälfte um, nicht erst nach der Animation
  const t = (await page.locator('.gtile').nth(1).boundingBox())!;
  await page.mouse.move(360, t.y + 20); await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(360 - i * 18, t.y + 20);
  await expect(nav.locator('[data-tab="alltag"]')).toHaveClass(/\bon\b/, { timeout: 250 });
  await expect(page.locator('.pageghost')).toHaveCount(1);
  await page.mouse.up();
  await expect(nav.getByRole('button', { name: 'Alltag' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.pageghost')).toHaveCount(0);
  await nav.getByRole('button', { name: 'Übersicht' }).click();
  // Neue Übersicht: Kacheln mit Anteil am Einkommen, Schnell erfassen, eine Zeile „Zuletzt“
  await expect(page.locator('.gtile')).toHaveCount(3);
  await expect(page.locator('.gtile').first()).toContainText('%');
  await expect(page.locator('.quick button')).toHaveCount(4);
  await page.locator('.quick button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();
  await page.locator('.lastrow').click();
  await expect(page.locator('nav').getByRole('button', { name: 'Buchungen' })).toHaveAttribute('aria-current', 'page');
});
