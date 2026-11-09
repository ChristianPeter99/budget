import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(process.cwd(), 'tests/fixtures/c24-beispiel.csv');
const pad = (p: Page) => p.getByRole('dialog').getByRole('group', { name: 'Zahlenfeld' });

async function openImport(page: Page) {
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /^Import/ }).click();
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles(FIXTURE);
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
}

test('CSV-Import: Duplikat erkannt, Kategorie je Händler, übernehmen, merken, rückgängig', async ({ page }) => {
  await page.goto('/');
  // vorhandene Lidl-Ausgabe vom 22.10. (41,27 €)
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  const dlg = page.getByRole('dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of ['4', '1', ',', '2', '7']) await pad(page).getByRole('button', { name: k, exact: true }).click();
  await dlg.locator('.chip:not(.recent)').filter({ hasText: /^Lebensmittel$/ }).click();
  await dlg.locator('.chip:not(.recent)').filter({ hasText: /^Einkaufen$/ }).click();
  await dlg.locator('input[type=date]').fill('2026-10-22');
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);

  await openImport(page);
  // 11 Ausgaben, davon 1 schon erfasst → 10 in „Ausgaben“
  await expect(page.getByRole('tab', { name: /Alltag 10/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Schon da 1/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Weitere 4/ })).toBeVisible();
  // Beispielshop hat keinen Vorschlag → Übernehmen gesperrt
  await expect(page.getByRole('region', { name: 'Übernehmen' })).toContainText('1 ohne Kategorie');
  // Übernehmen fragt nach, ob Zeilen ohne Kategorie nach „Sonstiges“ sollen; „Erst noch zuordnen“ führt zurück
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Ohne Kategorie' });
  await expect(ask).toContainText('1 Buchung hat noch keine Kategorie');
  await expect(ask).toContainText('Beispielshop');
  await ask.getByRole('button', { name: 'Erst noch zuordnen' }).click();
  await expect(ask).toHaveCount(0);
  const shop = page.locator('.imp', { hasText: 'Beispielshop' });
  await shop.getByRole('button', { name: 'Kategorie wählen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kino', exact: true }).click();
  await expect(shop).toContainText('Freizeit › Kino');
  // Vereinsheim (2 Buchungen): eine abwählen
  const verein = page.locator('.imp', { hasText: 'Vereinsheim' });
  // Leiste schwebt über dem Inhalt: Zeile mittig holen, wie man es von Hand tun würde
  await verein.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await verein.locator('.impname').click();
  await verein.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await verein.locator('.improw').first().getByRole('checkbox').click();
  await expect(verein.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'mixed');
  // Schon erfasst: abgewählt, mit Hinweis
  await page.getByRole('tab', { name: /Schon da/ }).click();
  await expect(page.locator('.imp', { hasText: 'Lidl' })).toContainText('Schon erfasst');
  await expect(page.locator('.imp', { hasText: 'Lidl' }).getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'false');

  await expect(page.getByRole('region', { name: 'Übernehmen' })).toContainText('9 ausgewählt');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('9 Buchungen übernommen');

  // zweiter Import derselben Datei: nichts Neues mehr in „Ausgaben“ ausgewählt, Kategorie gemerkt
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles(FIXTURE);
  await expect(page.getByRole('region', { name: 'Übernehmen' })).toContainText('0 ausgewählt');
  await page.getByRole('tab', { name: /Schon da/ }).click();
  await expect(page.locator('.imp', { hasText: 'Beispielshop' })).toContainText('Schon importiert');
  await page.getByRole('button', { name: 'Abbrechen' }).click();

  // rückgängig
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click(); await page.getByRole('menuitem', { name: 'Letzten Import rückgängig machen' }).click();
  await expect(page.locator('.toast')).toContainText('9 importierte Buchungen entfernt');
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles(FIXTURE);
  const shop2 = page.locator('.imp', { hasText: 'Beispielshop' });
  await expect(shop2).toContainText('Freizeit › Kino');
  await expect(shop2).toContainText('gemerkt');
});

test('CSV-Import: ungültige Datei ändert nichts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /^Import/ }).click();
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') });
  await expect(page.getByRole('alert')).toContainText('Spalten für Datum und Betrag');
});
