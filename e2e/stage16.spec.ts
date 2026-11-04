import { expect, test } from '@playwright/test';

test('Buchungen: Filter im Fenster (Zeitraum, Art, Kategorie), Symbole ohne Kasten, Auswählen oben', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  await nav.getByRole('button', { name: 'Buchungen' }).click();
  // keine Monat/Jahr/Gesamt-Leiste und keine Filter-Chips mehr direkt auf der Seite
  await expect(page.getByRole('button', { name: 'Jahr', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Alle Kategorien' })).toHaveCount(0);
  await expect(page.locator('.tbar').getByRole('button', { name: 'Neue Buchung' })).toBeVisible();
  await expect(page.locator('.tbar').getByRole('button', { name: 'Filter' })).toBeVisible();
  await expect(page.locator('.swipe .tile').first()).toHaveClass(/flat/);
  await page.getByRole('button', { name: 'Filter' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('radio', { name: 'Jahr' }).click();
  await dlg.getByRole('radio', { name: 'Ausgaben' }).click();
  await dlg.getByRole('button', { name: /anzeigen/ }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('h1').first()).toHaveText(/^\d{4}$/);
  await expect(page.getByRole('button', { name: 'Filter (aktiv)' })).toBeVisible();
  await expect(page.locator('.freset')).toContainText('Ausgaben');
  // Gesamt gibt es nicht mehr; Kategorie per Suche
  await page.getByRole('button', { name: 'Filter (aktiv)' }).click();
  await expect(dlg.getByRole('radio', { name: 'Gesamt' })).toHaveCount(0);
  await dlg.getByLabel('Kategorie suchen').fill('bäck');
  await expect(dlg.getByRole('radio', { name: /Lebensmittel/ })).toBeVisible();
  await expect(dlg.getByRole('radio', { name: /Wohnen/ })).toHaveCount(0);
  await dlg.getByRole('radio', { name: /Lebensmittel/ }).click();
  await dlg.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.locator('.freset')).toContainText('Lebensmittel');
  // Von–bis
  await page.getByRole('button', { name: 'Filter (aktiv)' }).click();
  await dlg.getByRole('radio', { name: 'Von–bis' }).click();
  await dlg.getByLabel('Von').fill('2026-01-01');
  await dlg.getByLabel('Bis').fill('2026-01-31');
  await dlg.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.locator('h1').first()).toHaveText('1.1.26 – 31.1.26');
  // zurücksetzen über die Zeile
  await page.locator('.freset').click();
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeVisible();
  await expect(page.locator('.freset')).toHaveCount(0);
});
