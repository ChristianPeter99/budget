import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function setupJoint(page: Page) {
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Gemeinsames Konto/ }).click();
  await page.getByLabel('Mein Beitrag pro Monat').fill('400');
  await page.getByLabel('Name der anderen Person').fill('Lena');
  await page.getByLabel('Beitrag der anderen Person pro Monat').fill('350');
  await expect(page.locator('.budrow')).toContainText('750,00 €');
  await page.getByRole('button', { name: 'Einrichten' }).click();
  await expect(page.getByText('Gemeinsames Konto eingerichtet')).toBeVisible();
}

test('Gemeinsames Konto: Einkauf zählt nur dort, nicht im eigenen „Noch verfügbar“', async ({ page }) => {
  await page.goto('/');
  await setupJoint(page);
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  const hero = page.locator('.hero .big');
  await expect(page.locator('.ovcorner.tl')).toContainText(/Haushaltskonto\s*750 €\s*übrig/);
  await page.waitForTimeout(400);
  const before = await hero.innerText();

  // Einkauf vom gemeinsamen Konto
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  await page.getByRole('dialog').getByRole('tab', { name: 'Haushaltskonto' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of ['8', '5', ',', '5']) await page.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
  await page.getByRole('dialog').locator('.chip:not(.recent)').filter({ hasText: /^Lebensmittel$/ }).click();
  await page.getByRole('dialog').locator('.chip:not(.recent)').filter({ hasText: /^Einkaufen$/ }).click();
  await page.getByPlaceholder('Optional').fill('Wocheneinkauf');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);
  await page.locator('nav').getByRole('button', { name: 'Übersicht' }).click();

  await page.waitForTimeout(400);
  await expect(hero).toHaveText(before);
  await expect(page.locator('.ovcorner.tl')).toContainText(/66[45] €\s*übrig/);

  // Ansicht im Alltag
  await page.locator('.ovcorner.tl').click();
  await page.getByRole('button', { name: /Konto öffnen/ }).click();
  await expect(page.getByRole('tab', { name: 'Haushaltskonto', selected: true })).toBeVisible();
  await expect(page.locator('.hero')).toContainText('85,50 €');
  await expect(page.locator('.hero')).toContainText('Ich 400,00 € · Lena 350,00 €');

  // Abweichender Beitrag diesen Monat
  await page.getByRole('button', { name: /Ich 400,00 €/ }).click();
  await page.getByRole('textbox', { name: 'Einzahlung Lena' }).fill('300');
  await page.getByRole('button', { name: /speichern/ }).click();
  await expect(page.locator('.hero')).toContainText('Lena 300,00 € (diesen Monat angepasst)');

  // Eigene Sicht: Beitrag erscheint als Alltags-Ausgabe, der Einkauf nicht
  await page.getByRole('tab', { name: 'Ich' }).click();
  await expect(page.locator('.ghead', { hasText: 'Gemeinsames Konto' })).toContainText('400,00 €');
  await expect(page.locator('.ghead', { hasText: 'Lebensmittel' })).toContainText('0,00 €');

  // Buchungsliste je Konto
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await expect(page.getByText('Wocheneinkauf')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Haushaltskonto' }).click();
  await expect(page.getByText('Wocheneinkauf')).toBeVisible();
});
