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

test('Übersicht: Bereich zweimal antippen → Kategorie-Kreis als Pop-up mit Symbolen; Übersicht-Knopf führt zurück', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['5', '0'], 'Lebensmittel', 'Einkaufen');
  await addBooking(page, ['1', '2'], 'Freizeit', 'Kino');
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  await page.locator('.ovcorner.br').click();
  await expect(page.locator('.ovhint')).toContainText('Nochmal antippen');
  await page.locator('.ovcorner.br').click();
  const dlg = page.getByRole('dialog', { name: /^Alltag · / });
  await expect(dlg).toBeVisible();
  const legend = dlg.getByRole('list', { name: 'Kategorien Alltag' });
  await expect(legend.getByRole('listitem')).toHaveCount(2);
  await expect(legend.getByRole('listitem').first()).toContainText('81 %');
  // Symbole im Ring und in der Liste
  await expect(dlg.locator('.dicon')).toHaveCount(2);
  await expect(legend.locator('.ddot svg')).toHaveCount(2);
  await legend.locator('.ovlrow', { hasText: 'Lebensmittel' }).click();
  await expect(dlg.locator('.ovlsub')).toContainText('Einkaufen');
  await expect(dlg.locator('.dcenter')).toContainText('50 €');
  // Nach unten ziehen schließt
  const grab = await dlg.locator('.ph').boundingBox();
  await page.mouse.move(grab!.x + 200, grab!.y + 20);
  await page.mouse.down();
  for (let y = 30; y <= 330; y += 30) await page.mouse.move(grab!.x + 200, grab!.y + y);
  await page.mouse.up();
  await expect(dlg).toHaveCount(0);
  // Bereich bleibt gewählt; Tipp auf „Übersicht“ in der Leiste führt zur Gesamtansicht
  await expect(page.locator('.ovcenter')).toContainText('Alltag');
  await page.locator('nav').getByRole('button', { name: 'Übersicht' }).click();
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

test('CSV: ein Upload – Fixkosten im eigenen Reiter, von Hand markieren, beim zweiten Mal „Schon in Fixkosten“', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'f.csv', mimeType: 'text/csv', buffer: Buffer.from(fixCsv()) });
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Fixkosten 2' })).toBeVisible();
  // Bioladen bleibt unter Ausgaben; als Fixkosten markieren und wieder zurück
  await expect(page.locator('.imp', { hasText: 'Bioladen' })).toHaveCount(1);
  await expect(page.locator('.imp', { hasText: 'Hausverwaltung' })).toHaveCount(0);
  // Fixkosten-Kategorie wählen → Hinweis „einmal als Vorlage“, Rhythmus und Beginn wählbar
  await page.locator('.imp', { hasText: 'Bioladen' }).getByRole('button', { name: 'Kategorie wählen' }).click();
  const pk = page.getByRole('dialog');
  await pk.getByRole('tab', { name: 'Fixkosten' }).click();
  await expect(pk.locator('.fixhint')).toContainText('Wird einmal als Vorlage im Reiter Fixkosten angelegt');
  await pk.getByLabel('Vorlage ab').selectOption('next');
  await pk.getByRole('button', { name: 'Abos & Verträge', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Fixkosten 3' })).toBeVisible();
  await page.getByRole('tab', { name: 'Fixkosten 3' }).click();
  const rows = page.locator('.fixrow');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Muster Fitnessclub' })).toContainText('monatlich · 5× gefunden');
  await expect(rows.filter({ hasText: 'Muster Fitnessclub' })).toContainText('5 Buchungen aus der Datei');
  await expect(rows.filter({ hasText: 'Bioladen' })).toContainText('Vorlage ab');
  await expect(rows.filter({ hasText: 'Bioladen' }).getByLabel(/Kategorie für/)).toHaveValue(/.+/);
  await rows.filter({ hasText: 'Bioladen' }).getByRole('button', { name: 'Keine Fixkosten' }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('tab', { name: /^Ausgaben/ }).click();
  await page.locator('.imp', { hasText: 'Bioladen' }).getByRole('button', { name: 'Kategorie wählen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Einkaufen', exact: true }).click();
  await expect(page.locator('.selbar')).toContainText('2 Fixkosten-Vorlagen');
  await page.locator('.selbar').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.locator('.toast')).toContainText('15 Buchungen und 2 Fixkosten übernommen');

  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect(page.locator('main').getByText('Muster Fitnessclub').first()).toBeVisible();

  await openImport(page);
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'f.csv', mimeType: 'text/csv', buffer: Buffer.from(fixCsv()) });
  await page.getByRole('tab', { name: 'Fixkosten 2' }).click();
  await expect(page.locator('.fixrow.known')).toHaveCount(2);
  await expect(page.locator('.fixrow').first()).toContainText('Schon in Fixkosten');
});

test('CSV: Bankvorlage speichern, beim nächsten Import auswählen, verwalten', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const file = { name: 'b.csv', mimeType: 'text/csv', buffer: Buffer.from('A;B;C;D\n02.01.2026;03.01.2026;12;100\n03.01.2026;04.01.2026;9;91\n') };
  await page.getByLabel('CSV-Datei').setInputFiles(file);
  await page.getByLabel('Betrag', { exact: true }).selectOption({ index: 3 });
  await page.getByLabel('Name der Bank').fill('Musterbank');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await expect(page.locator('.kick')).toContainText('Musterbank');
  await page.locator('.back').first().click();
  await expect(page.getByLabel('Bank')).toHaveValue(/.+/);
  await expect(page.getByLabel('Bank').locator('option:checked')).toHaveText('Musterbank');
  // Nächster Import mit der gewählten Bank: kein Zuordnen mehr
  await page.getByLabel('CSV-Datei').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await page.locator('.back').first().click();
  await page.getByRole('button', { name: /Bankvorlagen verwalten/ }).click();
  await page.getByRole('button', { name: 'Bankvorlage Musterbank löschen' }).click();
  await expect(page.getByLabel('Bank').locator('option')).toHaveCount(1);
});

test('CSV-Import: Kategorie „Sport“ in Fixkosten anlegen, obwohl es „Sport“ in Alltag gibt', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const d = new Date(); const t = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(`Buchungsdatum,Betrag,Zahlungsempfänger\n${t},"-29,90",Muster Laden\n`) });
  await page.locator('.imp', { hasText: 'Muster Laden' }).getByRole('button', { name: 'Kategorie wählen' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('tab', { name: 'Fixkosten' }).click();
  await dlg.getByRole('button', { name: /Neue Kategorie anlegen/ }).click();
  await dlg.getByLabel('Name der neuen Kategorie').fill('Sport');
  await dlg.getByLabel('Erste Unterkategorie').fill('Verein');
  await dlg.getByRole('button', { name: 'Anlegen und zuordnen' }).click();
  // Neue Fixkosten-Kategorie: ohne Fehler angelegt, die Zahlung wird zur Fixkosten-Vorlage in „Sport“
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('.err-text')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Fixkosten 1' }).click();
  await expect(page.locator('.fixrow', { hasText: 'Muster Laden' }).getByLabel(/Kategorie für/).locator('option:checked')).toHaveText('Sport › Verein');
});

test('CSV: höchste Beträge oben, Cafés gebündelt, Rest auf Wunsch nach „Sonstiges“', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const d = new Date(); const t = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const csv = ['Buchungsdatum;Betrag;Zahlungsempfänger',
    `${t};-3,40;Starbucks Muster`, `${t};-2,90;Café Muster`, `${t};-3,10;Coffee Fellows`, `${t};-120,00;Muster Elektro GmbH`, `${t};-15,00;Unbekannt KG`].join('\n');
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'k.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const cards = page.locator('.imp');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Muster Elektro');
  await expect(cards.nth(1)).toContainText('Unbekannt');
  await expect(cards.nth(2)).toContainText('Cafés & Kaffee');
  await expect(cards.nth(2)).toContainText('3 Buchungen');
  // Cafés werden „Essen gehen“ zugeordnet, ohne dass man jeden einzeln anfasst
  await expect(cards.nth(2)).toContainText('Essen gehen');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Ohne Kategorie' });
  await expect(ask).toContainText('2 Buchungen haben noch keine Kategorie');
  await ask.getByRole('button', { name: 'Ja, in Sonstiges übernehmen' }).click();
  await expect(page.locator('.toast')).toContainText('5 Buchungen übernommen');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await expect(page.locator('main')).toContainText('Sonstige');
});
