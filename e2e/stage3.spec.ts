import { expect, test } from '@playwright/test';

test('Zuletzt genutzte Bezeichnungen, Bearbeiten und Löschen mit Rückgängig im Buchungsdialog', async ({ page }) => {
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

  // Bearbeiten: kurzer Titel, kein „Duplizieren“-Button mehr
  await page.locator('.item', { hasText: 'Brezen' }).click();
  await expect(page.getByRole('heading', { name: 'Bearbeiten' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Duplizieren/ })).toHaveCount(0);

  // Löschen im Dialog mit Rückgängig
  await page.getByRole('button', { name: 'Buchung löschen' }).click();
  await expect(page.locator('.item', { hasText: 'Brezen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.item', { hasText: 'Brezen' })).toHaveCount(1);
});

test('Jährliche Fixkosten mit Fälligkeitsmonat zeigen Rücklage und Fälligkeit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Fixkosten', exact: true }).click();
  await page.getByRole('button', { name: 'Neue Fixkosten' }).click();
  const dlg = page.getByRole('dialog', { name: 'Neue Fixkosten' });
  // gleicher Stil wie „Neue Buchung“: Umschalter, großer Betrag mit Zahlenfeld, Kategorie-Chips, Speichern oben
  await dlg.getByRole('tab', { name: 'Jährlich' }).click();
  await dlg.getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of ['4', '6', '0']) await dlg.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
  await dlg.locator('.keydock').getByRole('button', { name: 'Fertig' }).click();
  await expect(dlg.locator('.amtbox .pill')).toContainText('38,33');
  await dlg.locator('.chip', { hasText: /^Mobilität$/ }).click();
  const kid = dlg.locator('.lab', { hasText: 'Bezeichnung' });
  if (await kid.count()) await kid.locator('xpath=..').locator('.chip').first().click();
  await dlg.locator('.field', { hasText: 'Name' }).locator('input').fill('Kfz-Versicherung');
  await dlg.getByLabel('Fälligkeitsmonat').selectOption({ label: 'März' });
  await expect(dlg.getByRole('checkbox')).toHaveCount(0); // „Aktiv“ nur beim Bearbeiten
  await dlg.getByRole('button', { name: 'Speichern' }).click();
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
  await expect(page.getByText(/\d+ Positionen/)).toHaveCount(0);
  await expect(page.locator('.flathero .cap', { hasText: 'vom Gehalt' })).toBeVisible();
  await expect(page.getByRole('button', { name: /, Monat wählen$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Neu' })).toHaveCount(0);
  await expect(page.getByText('Kategorien halten zum Sortieren', { exact: false })).toBeVisible();
});

test('Auswertung: Tipp auf eine Kategorie zeigt den 12-Monats-Verlauf', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Auswertung/ }).click();
  // Im Kategorie-Kreis (Fixkosten) die Kategorie aufklappen: kleiner Verlauf mit Ø und teuerstem Monat
  const card = page.locator('.dcard');
  await card.getByRole('button', { name: 'Fixkosten', exact: true }).click();
  await card.locator('.ovlrow', { hasText: 'Wohnen' }).click();
  await expect(card.getByRole('img', { name: /Verlauf 12 Monate.*teuerster Monat/ })).toBeVisible();
  await expect(card.locator('.mtrend-k')).toContainText('Ø');
  await expect(card.locator('.mtrend-k')).toContainText('teuerster');
  // „Ausgaben nach Kategorie“ gibt es nicht mehr
  await expect(page.getByText('Ausgaben nach Kategorie')).toHaveCount(0);
});
