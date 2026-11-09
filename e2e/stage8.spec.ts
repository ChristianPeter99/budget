import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(process.cwd(), 'tests/fixtures/c24-beispiel.csv');
const pad = (p: Page) => p.getByRole('dialog').getByRole('group', { name: 'Zahlenfeld' });

async function openImport(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /^Import/ }).click();
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles(FIXTURE);
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
}

test('Import: Supermärkte und Tankstellen als Block, Aufklappen über Pfeil', async ({ page }) => {
  await openImport(page);
  const sm = page.locator('.imp', { has: page.locator('b', { hasText: /^Supermärkte$/ }) });
  await expect(sm).toContainText('4 Buchungen');
  await expect(sm).toContainText('Lebensmittel › Einkaufen');
  await expect(page.locator('.imp', { has: page.locator('b', { hasText: /^Tankstellen$/ }) })).toBeVisible();
  // Tipp auf den Pfeil klappt auf
  await sm.locator('.impchev').click();
  await expect(sm.locator('.improw')).toHaveCount(4);
  // innerhalb des Blocks: höchster Betrag zuerst
  await expect(sm.locator('.improw').first()).toContainText('41,27');
  await sm.locator('.impchev').click();
  await expect(sm.locator('.improw')).toHaveCount(0);
});

test('Import: neue Unterkategorie im Auswahlblatt, Liste bis unten scrollbar, Hintergrund steht', async ({ page }) => {
  await openImport(page);
  const shop = page.locator('.imp', { hasText: 'Beispielshop' });
  await shop.getByRole('button', { name: 'Kategorie wählen' }).click();
  const dlg = page.getByRole('dialog');
  const panel = dlg.locator('.panel');
  await panel.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const last = dlg.locator('.sel button').last();
  await expect(last).toBeInViewport();
  const viewTop = await page.locator('.view').evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, 2000);
  expect(await page.locator('.view').evaluate((el) => el.scrollTop)).toBe(viewTop);
  await dlg.getByRole('button', { name: 'Neue Unterkategorie in Freizeit' }).click();
  await dlg.getByLabel('Name der neuen Unterkategorie in Freizeit').fill('Konzerte');
  await dlg.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);
  await expect(shop).toContainText('Freizeit › Konzerte');
});

test('Alltag: aufgeklappte Buchung per Wischen löschen, Rückgängig', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  const dlg = page.getByRole('dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of ['7']) await pad(page).getByRole('button', { name: k, exact: true }).click();
  await dlg.locator('.chip:not(.recent)').filter({ hasText: /^Lebensmittel$/ }).click();
  await dlg.locator('.chip:not(.recent)').filter({ hasText: /^Bäcker$/ }).click();
  await dlg.getByPlaceholder('Optional').fill('Brezen');
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: 'Alltag', exact: true }).click();
  await page.getByRole('button', { name: 'Buchungen Bäcker aufklappen' }).click();
  const row = page.locator('.drill .swipe', { hasText: 'Brezen' });
  await row.locator('.item').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Buchung löschen' }).click();
  await expect(page.locator('.drill .swipe', { hasText: 'Brezen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.drill .swipe', { hasText: 'Brezen' })).toHaveCount(1);
});
