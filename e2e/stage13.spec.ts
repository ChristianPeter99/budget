import { expect, test } from '@playwright/test';
import { stepMonth } from './month';
import type { Page } from '@playwright/test';

async function setupJoint(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Gemeinsames Konto/ }).click();
  await page.getByLabel('Mein Beitrag pro Monat').fill('300');
  await page.getByRole('button', { name: 'Einrichten' }).click();
  await expect(page.locator('.toast')).toBeVisible();
}

test('Haushaltskonto hat eine eigene Kategorienliste; neue Kategorie dort erscheint nicht bei „Ich“', async ({ page }) => {
  await setupJoint(page);
  const nav = page.locator('nav');
  await nav.getByRole('button', { name: 'Alltag' }).click();
  await page.getByRole('tab', { name: 'Haushaltskonto' }).click();
  await expect(page.locator('.ghead b:first-of-type')).toHaveText(['Lebensmittel', 'Haushalt']);
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click(); await page.getByRole('button', { name: /^Kategorien/ }).click();
  await page.getByRole('tab', { name: 'Haushaltskonto' }).click();
  await page.getByRole('button', { name: 'Neue Kategorie' }).click();
  await page.getByRole('dialog').locator('input').first().fill('Haustier');
  await expect(page.getByRole('dialog')).not.toContainText('Gruppe');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);
  await expect(page.locator('.catname b')).toHaveText(['Lebensmittel', 'Haushalt', 'Haustier']);
  await page.getByRole('tab', { name: 'Alltag' }).click();
  await expect(page.locator('.catname', { hasText: 'Haustier' })).toHaveCount(0);
  await expect(page.locator('.catname', { hasText: 'Freizeit' })).toHaveCount(1);
  // Erfassen: Kategorien wechseln mit dem Konto
  await nav.getByRole('button', { name: 'Alltag' }).click();
  await page.getByRole('tab', { name: 'Ich' }).click();
  await nav.getByRole('button', { name: 'Buchungen' }).click();
  await page.getByLabel('Neue Buchung').click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Freizeit$/ })).toHaveCount(1);
  await dlg.getByRole('tab', { name: 'Haushaltskonto' }).click();
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Freizeit$/ })).toHaveCount(0);
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Haustier$/ })).toHaveCount(1);
});

test('CSV-Import ins Haushaltskonto: Auswahl und neue Kategorien nur aus der Haushaltsliste', async ({ page }) => {
  await setupJoint(page);
  await page.locator('.back').click();
  await page.getByRole('button', { name: /^Import/ }).click();
  await page.getByRole('tab', { name: 'Haushaltskonto' }).click();
  const d = new Date(); const today = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const csv = `Buchungsdatum,Betrag,Zahlungsempfänger,Kategorie,Unterkategorie\n${today},"-7,50",Tierbedarf Muster,Weitere Ausgaben,Weitere Ausgaben\n`;
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.locator('.imp', { hasText: 'Tierbedarf' }).getByRole('button', { name: 'Kategorie wählen' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.locator('.sel button', { hasText: /^Kino$/ })).toHaveCount(0);
  await expect(dlg.locator('.sel button', { hasText: /^Drogerie$/ })).toHaveCount(1);
  await dlg.getByRole('button', { name: /Neue Kategorie anlegen/ }).click();
  await expect(dlg.getByRole('tablist', { name: 'Gruppe der neuen Kategorie' })).toHaveCount(0);
  await dlg.getByLabel('Name der neuen Kategorie').fill('Haustier');
  await dlg.getByLabel('Erste Unterkategorie').fill('Futter');
  await dlg.getByRole('button', { name: 'Anlegen und zuordnen' }).click();
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('1 Buchung übernommen');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await page.getByRole('tab', { name: 'Haushaltskonto' }).click();
  await expect(page.locator('.ghead', { hasText: 'Haustier' })).toContainText('7,50 €');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click(); await page.getByRole('button', { name: /^Kategorien/ }).click();
  await expect(page.locator('.catname', { hasText: 'Haustier' })).toHaveCount(0);
});

test('Auswertung Haushaltskonto: Ausgaben nach eigenen Kategorien statt Fix/Alltag/Sparen', async ({ page }) => {
  await setupJoint(page);
  const nav = page.locator('nav');
  for (const [d, top, sub] of [[['4', '2'], 'Lebensmittel', 'Einkaufen'], [['9'], 'Haushalt', 'Drogerie']] as const) {
    await nav.getByRole('button', { name: 'Buchungen' }).click();
    await page.getByLabel('Neue Buchung').click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('tab', { name: 'Haushaltskonto' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
    for (const k of d) await dlg.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
    await dlg.locator('.chip:not(.recent)').filter({ hasText: new RegExp(`^${top}$`) }).click();
    await dlg.locator('.chip:not(.recent)').filter({ hasText: new RegExp(`^${sub}$`) }).click();
    await dlg.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.locator('.sheetwrap')).toHaveCount(0);
  }
  await nav.getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /Auswertung/ }).click();
  await page.getByRole('tab', { name: 'Haushaltskonto' }).click();
  // Haushaltskonto: Legende und Kategorie-Kreis mit den eigenen Kategorien (die Zeitraum-Tabelle gibt es nicht mehr)
  await expect(page.getByRole('heading', { name: 'Zeitraum' })).toHaveCount(0);
  await expect(page.locator('.slegend')).toContainText('Lebensmittel');
  await expect(page.locator('.dcard .ovlrow', { hasText: 'Lebensmittel' })).toContainText('42 €');
  await expect(page.locator('.dcard')).not.toContainText('Fixkosten');
  await page.getByRole('tab', { name: 'Ich' }).click();
  await expect(page.locator('.dcard')).toContainText('Fixkosten');
});

test('Gemeinsames Konto ausgeschaltet: Alltag zeigt weder Umschalter noch die Beitrags-Kategorie (ohne Beitrag im Monat)', async ({ page }) => {
  await setupJoint(page);
  const nav = page.locator('nav');
  await nav.getByRole('button', { name: 'Alltag' }).click();
  await expect(page.getByRole('tablist', { name: 'Konto' })).toBeVisible();
  // nächster Monat: noch kein Beitrag gebucht, Kategorie ist aber da
  await stepMonth(page, 1);
  await expect(page.locator('.ghead', { hasText: 'Gemeinsames Konto' })).toHaveCount(1);
  await nav.getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /Gemeinsames Konto/ }).click();
  await page.getByRole('button', { name: 'Gemeinsames Konto ausschalten' }).click();
  await page.getByRole('button', { name: 'Ja, ausschalten' }).click();
  await expect(page.locator('.toast')).toContainText('Ausgeschaltet');
  await nav.getByRole('button', { name: 'Alltag' }).click();
  await expect(page.getByRole('tablist', { name: 'Konto' })).toHaveCount(0);
  await expect(page.locator('.ghead', { hasText: 'Gemeinsames Konto' })).toHaveCount(0);
  await expect(page.locator('.ghead', { hasText: 'Lebensmittel' })).toHaveCount(1);
});
