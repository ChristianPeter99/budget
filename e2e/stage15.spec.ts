import { expect, test } from '@playwright/test';

test('Kategorien bearbeiten: Symbol wählen, erscheint in Alltag und im Balken', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  void nav;
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click(); await page.getByRole('button', { name: /^Kategorien/ }).click();
  await page.getByRole('button', { name: 'Symbol für Lebensmittel ändern' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('option', { name: 'Einkauf' }).click();
  await expect(dlg).toHaveCount(0);
  await page.getByRole('button', { name: 'Symbol für Lebensmittel ändern' }).click();
  await expect(page.getByRole('dialog').getByRole('option', { name: 'Einkauf' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Standard-Symbol verwenden' }).click();
  await page.getByRole('button', { name: 'Symbol für Lebensmittel ändern' }).click();
  await expect(page.getByRole('dialog').getByRole('option', { name: 'Korb' })).toHaveAttribute('aria-selected', 'true');
});

test('Tipp auf den Balken öffnet die Detailansicht; Tipp auf ein Stück zeigt dessen Details', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  await nav.getByRole('button', { name: 'Fixkosten' }).click();
  await page.locator('.catbar').click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.locator('.piecl', { hasText: 'Ausgaben' })).toBeVisible();
  await expect(dlg.getByText('Tippe auf ein Stück für Details.')).toBeVisible();
  await expect(dlg.locator('.pierow')).toHaveCount(0);
  await expect(dlg.locator('.pieamt').first()).toBeVisible();
  // Stück antippen: nach vorne geholt, darunter die Positionen dieser Kategorie
  await dlg.getByRole('button', { name: /^Wohnen:/ }).dispatchEvent('click');
  await expect(dlg.getByRole('button', { name: /^Wohnen:/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dlg.locator('.pierow.head')).toContainText('Wohnen');
  await expect(dlg.locator('.detrow').first()).toBeVisible();
  await expect(dlg.locator('.detrow').first()).not.toContainText('%');
  await expect(dlg.locator('.pierow.head')).not.toContainText('%');
  // nochmal antippen hebt die Auswahl auf
  await dlg.getByRole('button', { name: /^Wohnen:/ }).dispatchEvent('click');
  await expect(dlg.locator('.pierow')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Schließen' }).click();
  await expect(dlg).toHaveCount(0);
});
