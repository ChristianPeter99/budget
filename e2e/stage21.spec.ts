import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function addBooking(page: Page, digits: string[], top: string, sub: string) {
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Neue Buchung' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of digits) await page.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
  await dlg.locator('.chip:not(.recent)', { hasText: new RegExp(`^${top}$`) }).click();
  await dlg.locator('.chip:not(.recent)', { hasText: new RegExp(`^${sub}$`) }).click();
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(dlg).toHaveCount(0);
}

async function openImport(page: Page) {
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /CSV-Import/ }).click();
}

/** Erfundener Auszug: zwei feste Zahlungen in den letzten 5 Monaten plus Einkäufe */
function fixCsv(): string {
  const rows = ['Buchungstag;Empfänger;Verwendungszweck;Betrag'];
  const now = new Date();
  for (let i = 1; i <= 5; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 5);
    const ds = `05.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    const ds2 = `1${i}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    rows.push(`${ds};Muster Fitnessclub;Mitgliedsbeitrag;-29,90`);
    rows.push(`${ds};Hausverwaltung Beispiel;Miete;-850,00`);
    rows.push(`${ds2};Bioladen Sonnenschein;Einkauf;-${10 + i * 4},20`);
  }
  return rows.join('\n');
}

test('Übersicht: Bereich antippen, nochmal antippen → Kreis der Kategorien; Mitte geht Schritt für Schritt zurück', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['5', '0'], 'Lebensmittel', 'Einkaufen');
  await addBooking(page, ['1', '2'], 'Freizeit', 'Kino');
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  await page.locator('.ovcorner.br').click();
  await expect(page.locator('.ovhint')).toContainText('Nochmal antippen');
  await page.locator('.ovcorner.br').click();
  const legend = page.getByRole('list', { name: 'Kategorien Alltag' });
  await expect(legend.getByRole('listitem')).toHaveCount(2);
  await expect(legend.getByRole('listitem').first()).toContainText('Lebensmittel');
  await expect(legend.getByRole('listitem').first()).toContainText('81 %');
  await legend.locator('.ovlrow', { hasText: 'Freizeit' }).click();
  await expect(page.locator('.ovcenter')).toContainText('19 % von Alltag');
  await page.getByRole('button', { name: 'Zurück zum Kategorie-Kreis' }).click();
  await page.getByRole('button', { name: 'Zurück zum Bereich' }).click();
  await expect(legend).toHaveCount(0);
  await page.getByRole('button', { name: 'Zurück zur Gesamtansicht' }).click();
  await expect(page.locator('.ovcenter')).toContainText('Noch verfügbar');
});

test('Auswertung: Kategorien im Kreis für den Zeitraum, Bereich umschaltbar', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['3', '0'], 'Lebensmittel', 'Einkaufen');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Auswertung/ }).click();
  const card = page.locator('.dcard');
  await expect(card).toContainText('Kategorien im Kreis');
  await expect(card.locator('.ovlrow', { hasText: 'Lebensmittel' })).toHaveCount(1);
  await card.locator('.ovlrow', { hasText: 'Lebensmittel' }).click();
  await expect(card.locator('.dcenter')).toContainText('100 %');
  await card.getByRole('button', { name: 'Fixkosten', exact: true }).click();
  await expect(card.locator('.ovlrow', { hasText: 'Lebensmittel' })).toHaveCount(0);
});

test('CSV: unbekannter Aufbau → Spalten zuordnen; erkannte Datei lässt sich neu zuordnen', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('A;B;C;D\n02.01.2026;03.01.2026;12;100\n03.01.2026;04.01.2026;9;91\n') });
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weiter', exact: true })).toBeDisabled();
  await page.getByLabel('Betrag', { exact: true }).selectOption({ index: 3 });
  await expect(page.locator('.kv').first()).toContainText('12,00');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await page.locator('.back').first().click();

  const d = new Date(); const t = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'y.csv', mimeType: 'text/csv', buffer: Buffer.from(`Datum;Text;Soll;Haben\n${t};Muster Laden;12,30;\n${t};Muster Firma;;100,00\n`) });
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await page.getByRole('button', { name: /Zuordnung ändern/ }).click();
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen' })).toBeVisible();
  await expect(page.locator('.kv').first()).toContainText('12,30');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
});

test('CSV „Fixkosten erkennen“: füllt den Reiter Fixkosten, beim zweiten Mal „Schon in Fixkosten“', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByRole('tab', { name: 'Fixkosten erkennen' }).click();
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'f.csv', mimeType: 'text/csv', buffer: Buffer.from(fixCsv()) });
  await expect(page.getByRole('heading', { name: 'Fixkosten erkannt' })).toBeVisible();
  const rows = page.locator('.fixrow');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Bioladen' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Muster Fitnessclub' })).toContainText('monatlich · 5× gefunden');
  await page.getByRole('button', { name: '2 in Fixkosten übernehmen' }).click();
  await expect(page.locator('.toast')).toContainText('2 Fixkosten übernommen');

  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect(page.locator('main, #root').getByText('Muster Fitnessclub').first()).toBeVisible();

  await openImport(page);
  await page.getByRole('tab', { name: 'Fixkosten erkennen' }).click();
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'f.csv', mimeType: 'text/csv', buffer: Buffer.from(fixCsv()) });
  await expect(page.locator('.fixrow.known')).toHaveCount(2);
  await expect(page.locator('.fixrow').first()).toContainText('Schon in Fixkosten');
  await expect(page.getByRole('button', { name: 'Nichts ausgewählt' })).toBeDisabled();
});

test('CSV-Import: Kategorie „Sport“ in Fixkosten anlegen, obwohl es „Sport“ in Alltag gibt', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const d = new Date(); const t = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(`Buchungsdatum,Betrag,Zahlungsempfänger\n${t},"-29,90",Muster Verein\n`) });
  await page.locator('.imp', { hasText: 'Muster Verein' }).getByRole('button', { name: 'Kategorie wählen' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('tab', { name: 'Fixkosten' }).click();
  await dlg.getByRole('button', { name: /Neue Kategorie anlegen/ }).click();
  await dlg.getByLabel('Name der neuen Kategorie').fill('Sport');
  await dlg.getByLabel('Erste Unterkategorie').fill('Verein');
  await dlg.getByRole('button', { name: 'Anlegen und zuordnen' }).click();
  await expect(page.locator('.toast')).toContainText('„Sport“ angelegt');
  await expect(dlg).toHaveCount(0);
});
