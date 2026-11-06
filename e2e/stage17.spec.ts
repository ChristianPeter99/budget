import { expect, test } from '@playwright/test';

test('Fixkosten: „Gilt ab“ früher setzen bucht vergangene Monate nach; Löschen behält bisherige Buchungen', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 2);
  await nav.getByRole('button', { name: 'Fixkosten' }).click();
  // Vormonat: noch leer, mit Hinweis auf „Gilt ab“
  await page.getByRole('button', { name: 'Vorheriger Monat' }).click();
  await expect(page.getByText(/unter „Gilt ab“/)).toBeVisible();
  await page.getByRole('button', { name: 'Nächster Monat' }).click();
  await page.locator('.sub', { hasText: 'Miete' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Gilt ab (Monat)').fill(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  await expect(dlg.getByText(/werden nachgebucht/)).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(dlg).toHaveCount(0);
  await page.getByRole('button', { name: 'Vorheriger Monat' }).click();
  await expect(page.locator('.sub', { hasText: 'Miete' }).first()).toBeVisible();
  // Buchungen im Vormonat enthalten jetzt die Miete
  await nav.getByRole('button', { name: 'Buchungen' }).click();
  await expect(page.locator('.swipe', { hasText: 'Miete' }).first()).toBeVisible();
  // Vorlage löschen → Buchung im Vormonat bleibt
  await nav.getByRole('button', { name: 'Fixkosten' }).click();
  await page.locator('.sub', { hasText: 'Miete' }).first().click();
  await dlg.getByRole('button', { name: 'Vorlage löschen' }).click();
  await dlg.getByRole('button', { name: /Ja, löschen/ }).click();
  await nav.getByRole('button', { name: 'Buchungen' }).click();
  await expect(page.locator('.swipe', { hasText: 'Miete' }).first()).toBeVisible();
});

test('Gehalt: „Gilt ab“ bucht vergangene Monate nach; „Eingang am“ zeigt „1. des Monats“', async ({ page }) => {
  await page.goto('/');
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /Gehalt & Wiederkehrend/ }).click();
  const dayField = page.getByLabel('Tag des Gehaltseingangs');
  await expect(dayField).toHaveValue(/^\d+\. des Monats$/);
  await dayField.click();
  await expect(dayField).toHaveValue(/^\d+$/);
  await dayField.fill('1');
  await page.getByLabel('Gehalt gilt ab (Monat)').fill(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  await expect(dayField).toHaveValue('1. des Monats');
  await page.getByRole('button', { name: 'Gehalt speichern' }).click();
  await expect(page.locator('.toast')).toContainText('Gehalt gespeichert');
  // Vormonat hat jetzt eine Gehaltsbuchung
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Vorheriger Monat' }).click();
  await expect(page.locator('.swipe', { hasText: 'Gehalt' }).first()).toBeVisible();
});

test('Übersicht: vor „Gilt ab“ des Gehalts kein „Gehalt (erwartet)“', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.ovfacts')).toBeVisible();
  await page.getByRole('button', { name: 'Vorheriger Monat' }).click();
  await expect(page.locator('.ovfacts')).not.toContainText('erwartet');
  await expect(page.locator('.ovfacts')).toContainText('Einnahmen');
});

test('Sparkonto: Sparrate-Zeile öffnet die Vorlage mit „Gilt ab“, danach zurück zum Sparkonto', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /Sparen & Depot/ }).click();
  await page.locator('.wtile', { hasText: 'Sparkonto' }).click();
  await page.getByRole('button', { name: /^Sparrate .* pro Monat – ändern$/ }).click();
  await expect(page.getByRole('dialog').getByLabel('Gilt ab (Monat)')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /Abbrechen|Schließen/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Sparkonto' })).toBeVisible();
});
