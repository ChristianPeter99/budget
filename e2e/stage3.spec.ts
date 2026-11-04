import { expect, test } from '@playwright/test';

test('Zuletzt genutzte Bezeichnungen, Duplizieren und Löschen mit Rückgängig im Buchungsdialog', async ({ page }) => {
  await page.goto('/');
  const pad = page.getByRole('group', { name: 'Zahlenfeld' });
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of ['1', '2', '3', '4', ',', '5']) await pad.getByRole('button', { name: k, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Betrag', exact: true })).toHaveText('1.234,5 €');
  await page.getByRole('dialog').getByRole('button', { name: 'Lebensmittel', exact: true }).click();
  await page.getByRole('button', { name: 'Bäcker', exact: true }).click();
  await page.getByPlaceholder('Optional').fill('Brezen');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);

  // „Zuletzt“ bietet Bäcker direkt an
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  await expect(page.getByText('Zuletzt')).toBeVisible();
  await page.getByRole('dialog').locator('.chip.recent', { hasText: 'Bäcker' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  await pad.getByRole('button', { name: '3', exact: true }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);

  // Duplizieren übernimmt Betrag, Kategorie und Notiz
  await page.locator('.item', { hasText: 'Brezen' }).click();
  await page.getByRole('button', { name: /Duplizieren/ }).click();
  await expect(page.getByRole('heading', { name: 'Neue Ausgabe' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Betrag', exact: true })).toHaveText('1.234,50 €');
  await expect(page.getByPlaceholder('Optional')).toHaveValue('Brezen');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.item', { hasText: 'Brezen' })).toHaveCount(2);

  // Löschen im Dialog mit Rückgängig
  await page.locator('.item', { hasText: 'Brezen' }).first().click();
  await page.getByRole('button', { name: 'Buchung löschen' }).click();
  await expect(page.locator('.item', { hasText: 'Brezen' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.item', { hasText: 'Brezen' })).toHaveCount(2);
});

test('Jährliche Fixkosten mit Fälligkeitsmonat zeigen Rücklage und Fälligkeit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Fixkosten', exact: true }).click();
  await page.getByRole('button', { name: /Fixkosten (hinzufügen|anlegen)/ }).click();
  await page.getByRole('button', { name: 'Jährlich' }).click();
  await page.getByRole('textbox', { name: 'Betrag' }).fill('460');
  await page.locator('.field', { hasText: 'Name' }).locator('input').fill('Kfz-Versicherung');
  await page.getByLabel('Fälligkeitsmonat').selectOption({ label: 'März' });
  await page.locator('.field', { hasText: 'Kategorie' }).locator('select').selectOption({ label: 'Mobilität' });
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('heading', { name: 'Rücklagen für jährliche Zahlungen' })).toBeVisible();
  const row = page.locator('.hbar', { hasText: 'Kfz-Versicherung' });
  await expect(row).toContainText(/fällig März \d{4}/);
  await expect(row).toContainText('angespart');
  // Vorlage wurde mitten im Zyklus angelegt → Hinweis auf die Lücke
  await expect(row).toContainText('fehlen voraussichtlich');
  await expect(page.locator('.sub', { hasText: 'Kfz-Versicherung' })).toContainText('≈ 38,33 €');
});

test('Alltag zeigt alle Kategorien, Einklappen bleibt gemerkt', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Alltag', exact: true }).click();
  await expect(page.getByRole('button', { name: /weitere Kategorien/ })).toHaveCount(0);
  const card = page.locator('.card', { has: page.locator('.ghead b', { hasText: /^Lebensmittel$/ }) });
  await expect(card.locator('.subrow').first()).toBeVisible();
  await page.getByRole('button', { name: 'Lebensmittel zuklappen' }).click();
  await expect(card.locator('.subrow')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Alltag', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lebensmittel aufklappen' })).toBeVisible();
  await expect(card.locator('.subrow')).toHaveCount(0);
  await page.getByRole('button', { name: 'Lebensmittel aufklappen' }).click();
  await expect(card.locator('.subrow').first()).toBeVisible();
  await expect(page.locator('.catbar')).toBeVisible();
});

test('Fixkosten: flacher Kopf ohne Richtwert, Kategorie einklappbar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Fixkosten', exact: true }).click();
  await expect(page.locator('.flathero .cap', { hasText: 'Ausgaben' })).toBeVisible();
  await expect(page.getByText('Balken antippen für Details', { exact: false })).toBeVisible();
  await expect(page.getByText(/Richtwert/)).toHaveCount(0);
  await expect(page.getByText(/\d+ Positionen/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vorheriger Monat' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Neu' })).toHaveCount(0);
  await expect(page.getByText('Kategorien halten zum Sortieren', { exact: false })).toBeVisible();
});

test('Auswertung: Tipp auf eine Kategorie zeigt den 12-Monats-Verlauf', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Auswertung/ }).click();
  await page.getByRole('button', { name: /Wohnen: Verlauf anzeigen/ }).click();
  await expect(page.getByRole('img', { name: /teuerster Monat/ })).toBeVisible();
  await expect(page.getByText(/Ø 12 Monate/)).toBeVisible();
});
