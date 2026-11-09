import { expect, test } from '@playwright/test';
import { stepMonth } from './month';
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
  await page.getByRole('button', { name: /^Import/ }).click();
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
  // Ring dreht beim Öffnen ein wie in der Auswertung
  await expect(page.locator('.ovsvg .ovdrill')).toHaveCount(1);
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
  // Mitte ohne Auswahl: nur Name und Summe, keine Anzahl Kategorien
  await expect(dlg.locator('.dcenter')).not.toContainText('Kategorie');
  await expect(page.locator('.ovsub', { hasText: /Vorlage|Monatsbetrag/ })).toHaveCount(0);
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
  // Ein Zeitraum für die ganze Auswertung (Filter-Symbol oben)
  await expect(page.locator('.hd h1')).toContainText('heute');
  await page.getByRole('button', { name: /^Zeitraum der Auswertung/ }).click();
  const sh = page.getByRole('dialog', { name: 'Zeitraum' });
  // Vorgaben kompakt in einer Zeile, ohne „Dieser Monat“; Standard „Alles“ ist aktiv
  await expect(sh.getByRole('radio', { name: 'Dieser Monat' })).toHaveCount(0);
  await expect(sh.getByRole('radio', { name: 'Alles' })).toHaveAttribute('aria-checked', 'true');
  await expect(sh.getByRole('button', { name: 'Fertig' })).toBeDisabled();
  await sh.getByRole('radio', { name: 'Letzte 3 Monate' }).click();
  await expect(sh).toHaveCount(0);
  await expect(page.locator('.hd h1')).toContainText('heute');
  await expect(card.locator('.mini').first()).toHaveText(await page.locator('.hd h1').innerText());
  await expect(card.locator('.ovlrow', { hasText: 'Lebensmittel' })).toHaveCount(1);
  // Eigener Zeitraum: Von im Monatsraster wählen, „Fertig“
  await page.getByRole('button', { name: /^Zeitraum der Auswertung/ }).click();
  await sh.locator('.srow', { hasText: 'Von' }).click();
  const now = new Date();
  const thisMonth = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(now);
  await sh.getByRole('button', { name: thisMonth, exact: true }).click();
  await expect(sh.locator('.ssum')).toContainText('1 Monat');
  await sh.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.locator('.hd h1')).toContainText('heute');
  await expect(card.locator('.ovlrow', { hasText: 'Lebensmittel' })).toHaveCount(1);
  await card.getByRole('button', { name: 'Fixkosten', exact: true }).click();
  await expect(card.locator('.ovlrow', { hasText: 'Lebensmittel' })).toHaveCount(0);
});

test('CSV: unbekannter Aufbau → Spalten zuordnen; erkannte Datei lässt sich neu zuordnen', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('A;B;C;D\n02.01.2026;03.01.2026;12;100\n03.01.2026;04.01.2026;9;91\n') });
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weiter', exact: true })).toBeDisabled();
  await page.getByLabel('Betrag', { exact: true }).selectOption({ index: 3 });
  await expect(page.locator('.kv').first()).toContainText('12,00');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await page.locator('.back').first().click();

  const d = new Date(); const t = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'y.csv', mimeType: 'text/csv', buffer: Buffer.from(`Datum;Text;Soll;Haben\n${t};Muster Laden;12,30;\n${t};Muster Firma;;100,00\n`) });
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click(); await page.getByRole('menuitem', { name: 'Spalten neu zuordnen' }).click();
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen' })).toBeVisible();
  await expect(page.locator('.kv').first()).toContainText('12,30');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
});

test('CSV: ein Upload – Fixkosten im eigenen Reiter, von Hand markieren, beim zweiten Mal „Schon in Fixkosten“', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'f.csv', mimeType: 'text/csv', buffer: Buffer.from(fixCsv()) });
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
  await expect(rows.filter({ hasText: 'Muster Fitnessclub' })).toContainText('5 Zahlungen · 5 neu');
  await expect(rows.filter({ hasText: 'Bioladen' })).toContainText('Vorlage ab');
  await expect(rows.filter({ hasText: 'Bioladen' }).getByLabel(/Kategorie für/)).toHaveValue(/.+/);
  await rows.filter({ hasText: 'Bioladen' }).getByRole('button', { name: 'Keine Fixkosten' }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('tab', { name: /^Alltag/ }).click();
  await page.locator('.imp', { hasText: 'Bioladen' }).getByRole('button', { name: 'Kategorie wählen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Einkaufen', exact: true }).click();
  await expect(page.locator('.selbar')).toContainText('2 Fixkosten-Vorlagen');
  await page.locator('.selbar').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.locator('.toast')).toContainText('15 Buchungen und 2 Fixkosten übernommen');

  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect(page.locator('main').getByText('Muster Fitnessclub').first()).toBeVisible();

  await openImport(page);
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'f.csv', mimeType: 'text/csv', buffer: Buffer.from(fixCsv()) });
  await page.getByRole('tab', { name: 'Fixkosten 2' }).click();
  await expect(page.locator('.fixrow.known')).toHaveCount(2);
  await expect(page.locator('.fixrow').first()).toContainText('Schon in Fixkosten');
});

test('CSV: Bankvorlage speichern, beim nächsten Import auswählen, verwalten', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const file = { name: 'b.csv', mimeType: 'text/csv', buffer: Buffer.from('A;B;C;D\n02.01.2026;03.01.2026;12;100\n03.01.2026;04.01.2026;9;91\n') };
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles(file);
  await page.getByLabel('Betrag', { exact: true }).selectOption({ index: 3 });
  await page.getByLabel('Name der Bank').fill('Musterbank');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await expect(page.locator('.kick')).toContainText('Musterbank');
  await page.locator('.back').first().click();
  await expect(page.getByRole('button', { name: 'Bank: Musterbank' })).toBeVisible();
  // Nächster Import mit der gewählten Bank: kein Zuordnen mehr
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await page.locator('.back').first().click();
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click(); await page.getByRole('menuitem', { name: 'Bankvorlagen verwalten' }).click();
  await page.getByRole('button', { name: 'Bankvorlage Musterbank löschen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByRole('button', { name: 'Bank: Automatisch erkennen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weitere Aktionen' })).toHaveCount(0);
});

test('CSV-Import: Kategorie „Sport“ in Fixkosten anlegen, obwohl es „Sport“ in Alltag gibt', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const d = new Date(); const t = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(`Buchungsdatum,Betrag,Zahlungsempfänger\n${t},"-29,90",Muster Laden\n`) });
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
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'k.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
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

test('CSV: Fixkosten-Häkchen nimmt die Buchungen mit – „Alle abwählen“ ergibt 0; Zusatzkäufe abwählbar', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const rows = ['Buchungstag;Empfänger;Verwendungszweck;Betrag'];
  const now = new Date();
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 5);
    const m = String(d.getMonth() + 1).padStart(2, '0'), y = d.getFullYear();
    rows.push(`01.${m}.${y};Hausverwaltung Beispiel;Miete;-850,00`, `05.${m}.${y};Muster Kletterhalle;Eintritt;-39,00`, `1${i}.${m}.${y};Muster Kletterhalle;Getraenk;-${i + 2},50`);
  }
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'g.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
  // Kletterhalle: Kategorie wählen › Fixkosten – nur die Beiträge sind vorgewählt
  await page.locator('.imp', { hasText: 'Kletterhalle' }).getByRole('button', { name: 'Kategorie wählen' }).click();
  const pk = page.getByRole('dialog');
  await pk.getByRole('tab', { name: 'Fixkosten' }).click();
  const pick = pk.getByRole('group', { name: 'Welche Buchungen sind die Fixkosten?' });
  await expect(pick.locator('.fixmemrow')).toHaveCount(6);
  await expect(pick.locator('.fixmemrow input:checked')).toHaveCount(3);
  await pk.getByRole('button', { name: 'Abos & Verträge', exact: true }).click();
  await page.getByRole('tab', { name: /^Fixkosten/ }).click();
  const kl = page.locator('.fixrow', { hasText: 'Kletterhalle' });
  await expect(kl).toContainText('39,00');
  await expect(kl).toContainText('3 Zahlungen · 3 neu');
  // Getränke bleiben Ausgaben
  await page.getByRole('tab', { name: /^Alltag/ }).click();
  await expect(page.locator('.imp', { hasText: 'Kletterhalle' })).toContainText('3 Buchungen');
  // Alles abwählen: Ausgaben und Fixkosten → 0 ausgewählt
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click(); await page.getByRole('menuitem', { name: 'Alle abwählen' }).click();
  await page.getByRole('tab', { name: /^Fixkosten/ }).click();
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click(); await page.getByRole('menuitem', { name: 'Alle abwählen' }).click();
  await expect(page.locator('.selbar')).toContainText('0 ausgewählt · 0,00 €');
  await expect(page.locator('.selbar').getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  // Einzeln wieder an: Miete samt Buchungen
  await page.locator('.fixrow', { hasText: 'Hausverwaltung' }).getByRole('checkbox', { name: /übernehmen/ }).check();
  await expect(page.locator('.selbar')).toContainText('3 ausgewählt · 2.550,00 €');
});

test('CSV: zwei Verträge beim selben Händler nacheinander als Fixkosten – beide wandern, eigene Namen', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const rows = ['Buchungstag;Empfänger;Verwendungszweck;Betrag'];
  for (const m of ['08', '09', '10']) rows.push(`03.${m}.2026;Muster Verlag;Tageszeitung 9;-5,80`, `03.${m}.2026;Muster Verlag;Kochmagazin 7;-12,40`);
  rows.push('04.10.2026;Bioladen;Einkauf;-20,00');
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'v.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
  for (let n = 0; n < 2; n++) {
    await page.locator('.imp', { hasText: 'Muster Verlag' }).getByRole('button', { name: /Kategorie wählen/ }).click();
    const pk = page.getByRole('dialog');
    await pk.getByRole('tab', { name: 'Fixkosten' }).click();
    await pk.getByRole('button', { name: 'Abos & Verträge', exact: true }).click();
    await expect(pk).toHaveCount(0);
  }
  await expect(page.locator('.imp', { hasText: 'Muster Verlag' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Fixkosten 2' }).click();
  await expect(page.locator('.fixrow .fixname')).toHaveText(['Muster Verlag · Kochmagazin', 'Muster Verlag · Tageszeitung']);
});

test('CSV: Zeitraum filtern (Urlaub), allen eine Kategorie geben, Mehrfachauswahl – nichts davon wird gemerkt', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const csv = ['Buchungstag;Empfänger;Verwendungszweck;Betrag',
    '02.10.2026;Bioladen;Einkauf;-20,00', '11.10.2026;Ristorante Sole;Abendessen;-48,00', '12.10.2026;Gelateria Luna;Eis;-6,50',
    '13.10.2026;Tankstelle Agip;Benzin;-62,00', '14.10.2026;Bioladen;Einkauf;-15,00', '25.10.2026;Kino Muster;Film;-12,00'].join('\n');
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'u.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('tab', { name: 'Alltag 6' })).toBeVisible();
  await expect(page.locator('.imptools, .allbar, .linkbtn')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const sh = page.getByRole('dialog', { name: 'Filtern' });
  // ein Kalender: erster Tipp Start, zweiter Ende
  await sh.getByRole('button', { name: '11. Oktober 2026' }).click();
  await expect(sh.locator('.rangehead')).toContainText('11.10. – …');
  await sh.getByRole('button', { name: '14. Oktober 2026' }).click();
  await expect(sh.locator('.rangehead')).toContainText('11.10. – 14.10.');
  await expect(sh.getByRole('button', { name: '12. Oktober 2026', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sh.getByRole('button', { name: '1. Oktober 2026', exact: true })).toBeDisabled(); // außerhalb der Datei
  await sh.getByRole('button', { name: '4 Buchungen zeigen' }).click();
  await expect(page.getByRole('tab', { name: 'Alltag 4' })).toBeVisible();
  await expect(page.locator('.imp', { hasText: 'Kino' })).toHaveCount(0);
  await page.getByRole('button', { name: /Allen 4 Ausgaben im Filter/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kino', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('4 Ausgaben → Freizeit › Kino');
  await expect(page.locator('.imp .catpick').filter({ hasText: 'Kino' })).toHaveCount(4);
  // Filter weg: Kino-Buchung am 25.10. bleibt ohne Kategorie
  await page.getByRole('button', { name: 'Filter aufheben' }).click();
  await expect(page.getByRole('tab', { name: 'Alltag 6' })).toBeVisible();
  // Mehrfachauswahl: Kino Muster + Bioladen markieren
  await page.getByRole('button', { name: 'Mehrfachauswahl' }).click();
  await page.getByRole('checkbox', { name: 'Kino Muster markieren' }).click();
  await page.getByRole('checkbox', { name: 'Bioladen markieren' }).click();
  await expect(page.locator('.mselbar')).toContainText('3 markiert · 47,00 €');
  await page.locator('.mselbar').getByRole('button', { name: 'Kategorie zuweisen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kino', exact: true }).click();
  await expect(page.locator('.selbar')).not.toContainText('ohne Kategorie');
  await page.locator('.selbar').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.locator('.toast')).toContainText('übernommen');
  // Nicht gemerkt: beim nächsten Import ist der Bioladen wieder ohne Kino-Vorschlag
  await openImport(page);
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'u2.csv', mimeType: 'text/csv', buffer: Buffer.from('Buchungstag;Empfänger;Verwendungszweck;Betrag\n01.11.2026;Ristorante Sole;Essen;-30,00') });
  await expect(page.locator('.imp', { hasText: 'Ristorante' }).locator('.catpick')).not.toContainText('Kino');
});

test('Auswertung: Kategorien im Kreis per Wischen zwischen den Bereichen wechseln', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['3', '0'], 'Lebensmittel', 'Einkaufen');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Auswertung/ }).click();
  const card = page.locator('.dcard');
  const modes = card.getByRole('group', { name: 'Bereich' }).getByRole('button');
  await expect(modes.first()).toHaveAttribute('aria-pressed', 'true');
  const swipe = async (dir: number) => {
    const box = (await card.locator('.dswipe').boundingBox())!;
    const y = box.y + 60, x0 = box.x + box.width / 2;
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + dir * i * 18, y);
    await page.mouse.up(); await page.waitForTimeout(450);
  };
  await swipe(-1);
  await expect(modes.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: /Auswertung|heute/ }).first()).toBeVisible();
  await swipe(1);
  await expect(modes.first()).toHaveAttribute('aria-pressed', 'true');
  // ganz links nach rechts: zurück zu Mehr (wie gewohnt)
  await swipe(1);
  await expect(card).toHaveCount(0);
});

test('Übersicht: Ring dreht beim Wischen erst nach dem Einrasten ein (nicht schon in der Vorschau)', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await page.waitForTimeout(300);
  const x0 = 60, y = 400;
  await page.mouse.move(x0, y); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x0 + i * 20, y);
  // Vorschau der Übersicht während des Ziehens: Ring unsichtbar, keine Animation
  const ghost = page.locator('.pageghost .ovsvg .ovdrill');
  await expect(ghost).toHaveCount(1);
  expect(await ghost.evaluate((g) => [getComputedStyle(g).opacity, g.getAnimations().length].join())).toBe('0,0');
  for (let i = 7; i <= 14; i++) await page.mouse.move(x0 + i * 20, y);
  await page.mouse.up();
  await expect(page.locator('nav').getByRole('button', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.pageghost')).toHaveCount(0);
  await expect.poll(() => page.locator('.ovsvg .ovdrill').evaluate((g) => getComputedStyle(g).opacity)).toBe('1');
});

test('Schnelles Hin- und Herwischen: Alltag-Balken füllt sich jedes Mal neu (nicht schon fertig)', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['4', '2'], 'Lebensmittel', 'Kantine');
  await page.locator('nav').getByRole('button', { name: 'Übersicht' }).click();
  await page.waitForTimeout(600);
  const swipe = async (dir: number) => {
    const x0 = dir < 0 ? 300 : 90;
    await page.mouse.move(x0, 450); await page.mouse.down();
    for (let i = 1; i <= 7; i++) await page.mouse.move(x0 + dir * i * 22, 450);
    await page.mouse.up();
  };
  for (const dir of [-1, 1, -1, 1, -1]) {
    await swipe(dir);
    if (dir < 0) {
      // kurz nach dem Loslassen ist der Balken noch im Aufbau (nicht sofort voll)
      await page.waitForTimeout(80);
      const running = await page.evaluate(() => [...document.querySelectorAll('.catbar>span')].some((s) => s.getAnimations().some((a) => a.playState === 'running')));
      expect(running).toBe(true);
    }
    await page.waitForTimeout(420);
  }
});

test('CSV-Import: Reiter per Wischen wechseln; ganz links nach rechts bleibt man im Import', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Import/ }).click();
  const rows = ['Buchungstag;Empfänger;Verwendungszweck;Betrag'];
  for (let m = 6; m <= 10; m++) rows.push(`01.${String(m).padStart(2, '0')}.2026;Stadtwerke;Strom Abschlag;-85,00`, `05.${String(m).padStart(2, '0')}.2026;REWE Markt;Einkauf;-60,40`);
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'k.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
  await expect(page.getByRole('tab', { name: /^Alltag/ })).toHaveAttribute('aria-selected', 'true');
  const swipe = async (dir: number) => {
    const box = (await page.locator('.impbody').boundingBox())!;
    const y = box.y + 40, x0 = box.x + box.width / 2;
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + dir * i * 18, y);
    await page.mouse.up(); await page.waitForTimeout(450);
  };
  await swipe(-1);
  await expect(page.getByRole('tab', { name: /^Fixkosten/ })).toHaveAttribute('aria-selected', 'true');
  await swipe(1);
  await expect(page.getByRole('tab', { name: /^Alltag/ })).toHaveAttribute('aria-selected', 'true');
  // ganz links nach rechts: Import bleibt offen
  await swipe(1);
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Alltag/ })).toHaveAttribute('aria-selected', 'true');
  // auch auf freier Fläche unter der Liste und vom linken Rand aus
  const free = async (x0: number, dir: number) => {
    const y = 700;
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + dir * i * 20, y);
    await page.mouse.up(); await page.waitForTimeout(450);
  };
  await free(300, -1);
  await expect(page.getByRole('tab', { name: /^Fixkosten/ })).toHaveAttribute('aria-selected', 'true');
  await free(80, 1);
  await expect(page.getByRole('tab', { name: /^Alltag/ })).toHaveAttribute('aria-selected', 'true');
  await free(4, 1); // vom Rand nach rechts: kein Abbrechen
  await free(60, 1);
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
});

test('Künftiger Monat: Ausblick aus den Vorlagen, deutlich als „voraussichtlich“', async ({ page }) => {
  await page.goto('/');
  await stepMonth(page, 1);
  await expect(page.locator('.kick').first()).toContainText('Ausblick');
  await expect(page.locator('.ovcorner', { hasText: 'Einnahmen' })).toContainText('2.850 €');
  await expect(page.locator('.ovcorner', { hasText: 'Einnahmen' })).toContainText('erwartet');
  await expect(page.locator('.ovcorner', { hasText: 'Fixkosten' })).not.toContainText(/^Fixkosten0 €/);
  await expect(page.locator('.ovlabel')).toHaveText('Voraussichtlich frei');
  await expect(page.locator('.ovsvg.outlook')).toHaveCount(1);
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await expect(page.locator('.flathero .cap', { hasText: 'Voraussichtlich frei' })).toBeVisible();
  await expect(page.getByText(/Ausblick – Gehalt und Fixkosten kommen am 1\./)).toBeVisible();
});

test('Kalender in Alltag: Pfeil zeigt zugeklappt nach unten, offen nach oben', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  const head = page.getByRole('button', { name: /Ausgaben-Kalender/ });
  const chev = page.locator('.calchev');
  const open = await head.getAttribute('aria-expanded');
  await expect(chev).toHaveAttribute('style', open === 'true' ? /rotate\(-90deg\)/ : /rotate\(90deg\)/);
  await head.click();
  await expect(chev).toHaveAttribute('style', open === 'true' ? /rotate\(90deg\)/ : /rotate\(-90deg\)/);
});

test('Mehr › Einnahmen: ohne Sparrate und Beitrag zum gemeinsamen Konto', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /Gemeinsames Konto/ }).click();
  await page.getByLabel('Mein Beitrag pro Monat').fill('300');
  await page.locator('.toprow .toplnk').click();
  await expect(page.locator('.toast')).toBeVisible();
  await page.locator('.back', { hasText: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Wiederkehrende Einnahmen/ }).click();
  await expect(page.getByRole('heading', { name: 'Einnahmen', level: 1 })).toBeVisible();
  await expect(page.locator('main').getByText('Sparrate', { exact: false })).toHaveCount(0);
  await expect(page.locator('main .item', { hasText: /Gemeinsam|Haushaltskonto/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sparen' })).toHaveCount(0);
});

test('Übersicht: Tipp auf Einnahmen → „Einnahmen öffnen“ führt zu Mehr › Einnahmen', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ovcorner.tl').click();
  await page.locator('.ovopen', { hasText: 'Einnahmen öffnen' }).click();
  await expect(page.getByRole('heading', { name: 'Einnahmen', level: 1 })).toBeVisible();
  await expect(page.locator('.seccap', { hasText: 'Gehalt' })).toBeVisible();
  // zweiter Tipp auf die Ecke: Kreis der Einnahmen mit demselben Ziel
  await page.locator('nav').getByRole('button', { name: 'Übersicht' }).click();
  await page.locator('.ovcorner.tl').click();
  await page.locator('.ovcorner.tl').click();
  await page.getByRole('dialog').getByRole('button', { name: /Einnahmen öffnen/ }).click();
  await expect(page.getByRole('heading', { name: 'Einnahmen', level: 1 })).toBeVisible();
});

test('Mehr › Einnahmen: + legt nur Einnahmen an', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Wiederkehrende Einnahmen/ }).click();
  await page.getByRole('button', { name: 'Neue Einnahme' }).click();
  const dlg = page.getByRole('dialog', { name: 'Neue Einnahme' });
  await expect(dlg.getByRole('tab', { name: 'Ausgabe' })).toHaveCount(0);
  await expect(dlg.locator('.chip', { hasText: 'Lebensmittel' })).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of ['2', '5', '0']) await dlg.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
  await dlg.locator('.keydock').getByRole('button', { name: 'Fertig' }).click();
  await dlg.locator('.chip', { hasText: /^Sonstige Einnahmen$/ }).click();
  await dlg.locator('.field', { hasText: 'Name' }).locator('input').fill('Kindergeld');
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.seccap', { hasText: 'Weitere Einnahmen' })).toBeVisible();
  await expect(page.locator('main .item', { hasText: 'Kindergeld' })).toContainText('+250,00 €');
});

test('Übersicht: Backup-Hinweis mit „Später“ ausblenden, bleibt nach Neuladen weg', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bkpill')).toContainText('Noch kein Backup');
  await page.getByRole('button', { name: 'Später' }).click();
  await expect(page.locator('.bkpill')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('.bkpill')).toHaveCount(0);
});

test.describe('Erster Start einer echten Installation', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('startet ohne Daten: kein Gehalt, keine Fixkosten, keine Buchungen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ovcorner', { hasText: 'Einnahmen' })).toContainText('0 €');
    await expect(page.locator('.ovcorner', { hasText: 'Fixkosten' })).toContainText('0 €');
    await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
    await expect(page.locator('.swipe .item')).toHaveCount(0);
    await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
    await expect(page.getByText('Noch keine Fixkosten')).toBeVisible();
  });
});
