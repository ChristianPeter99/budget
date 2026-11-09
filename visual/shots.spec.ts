import { test } from '@playwright/test';
import { more, nav, open, settle, shot } from './helpers';

/**
 * Referenzbilder aller Seiten, Blätter und wichtigen Zustände (Stand v1.78.5).
 * Feste Uhrzeit und Beispieldaten → jedes Bild ist reproduzierbar. Die Neuimplementierung muss pixelgleich sein.
 */
test.describe('Übersicht', () => {
  test('Start', async ({ page }) => { await open(page); await shot(page, 'uebersicht'); });
  test('Bereich gewählt', async ({ page }) => { await open(page); await page.locator('.ovcorner', { hasText: 'Fixkosten' }).click(); await settle(page); await shot(page, 'uebersicht-fixkosten'); });
  test('Monatsauswahl', async ({ page }) => { await open(page); await page.getByRole('button', { name: /Monat wählen$/ }).click(); await settle(page); await shot(page, 'uebersicht-monatsauswahl'); });
  test('Herunterziehen', async ({ page }) => {
    await open(page);
    const r = (await page.locator('.ovcenter').boundingBox())!;
    await page.mouse.move(r.x + r.width / 2, r.y); await page.mouse.down(); await page.mouse.move(r.x + r.width / 2, r.y + 240, { steps: 10 }); await page.mouse.up();
    await settle(page); await shot(page, 'uebersicht-herunterziehen');
  });
  test('Vormonat', async ({ page }) => { await open(page); await page.getByRole('button', { name: /Monat wählen$/ }).click(); await page.getByRole('button', { name: /^Oktober 2026/ }).click(); await settle(page); await shot(page, 'uebersicht-oktober'); });
  test('Ausblick', async ({ page }) => { await open(page); await page.getByRole('button', { name: /Monat wählen$/ }).click(); await page.getByRole('button', { name: /^Dezember 2026/ }).click(); await settle(page); await shot(page, 'uebersicht-dezember-ausblick'); });
});

test.describe('Alltag', () => {
  test('Kacheln', async ({ page }) => { await open(page, { tall: true, view: 'grid' }); await nav(page, 'Alltag'); await shot(page, 'alltag-kacheln'); });
  test('Kachel offen', async ({ page }) => { await open(page, { tall: true, view: 'grid' }); await nav(page, 'Alltag'); await page.locator('.ctile', { hasText: 'Lebensmittel' }).click(); await settle(page); await shot(page, 'alltag-kachel-offen'); });
  test('Liste', async ({ page }) => { await open(page, { tall: true, view: 'list' }); await nav(page, 'Alltag'); await shot(page, 'alltag-liste'); });
  test('Kalender zu', async ({ page }) => { await open(page, { view: 'grid' }); await nav(page, 'Alltag'); await page.getByRole('button', { name: /^Ausgaben-Kalender/ }).click(); await settle(page); await shot(page, 'alltag-kalender-zu'); });
});

test.describe('Fixkosten', () => {
  test('Kacheln', async ({ page }) => { await open(page, { tall: true, view: 'grid' }); await nav(page, 'Fixkosten'); await shot(page, 'fixkosten-kacheln'); });
  test('Liste', async ({ page }) => { await open(page, { tall: true, view: 'list' }); await nav(page, 'Fixkosten'); await shot(page, 'fixkosten-liste'); });
  test('Vorlage bearbeiten', async ({ page }) => { await open(page, { view: 'list' }); await nav(page, 'Fixkosten'); await page.getByRole('button', { name: /^Miete/ }).first().click(); await settle(page); await shot(page, 'fixkosten-vorlage'); });
  test('Neue Fixkosten', async ({ page }) => { await open(page); await nav(page, 'Fixkosten'); await page.getByRole('button', { name: 'Neue Fixkosten' }).click(); await settle(page); await shot(page, 'fixkosten-neu'); });
});

test.describe('Buchungen', () => {
  test('Liste', async ({ page }) => { await open(page, { tall: true }); await nav(page, 'Buchungen'); await shot(page, 'buchungen'); });
  test('Filter', async ({ page }) => { await open(page); await nav(page, 'Buchungen'); await page.getByRole('button', { name: 'Filter' }).click(); await settle(page); await shot(page, 'buchungen-filter'); });
  test('Auswählen', async ({ page }) => { await open(page); await nav(page, 'Buchungen'); await page.getByRole('button', { name: 'Auswählen' }).click(); await page.locator('.item').nth(1).click(); await settle(page); await shot(page, 'buchungen-auswahl'); });
  test('Neue Buchung', async ({ page }) => { await open(page); await nav(page, 'Buchungen'); await page.getByRole('button', { name: 'Neue Buchung' }).click(); await settle(page); await shot(page, 'neue-buchung'); });
  test('Buchung bearbeiten', async ({ page }) => { await open(page); await nav(page, 'Buchungen'); await page.locator('.item').first().click(); await settle(page); await shot(page, 'buchung-bearbeiten'); });
});

test.describe('Mehr', () => {
  test('Menü', async ({ page }) => { await open(page); await nav(page, 'Mehr'); await shot(page, 'mehr'); });
  test('Sparen & Depot', async ({ page }) => { await open(page, { tall: true }); await more(page, /^Sparen & Depot/); await shot(page, 'mehr-sparen'); });
  test('Auswertung', async ({ page }) => { await open(page, { tall: true }); await more(page, /^Auswertung/); await page.waitForTimeout(800); await shot(page, 'mehr-auswertung'); });
  test('Kategorien', async ({ page }) => { await open(page, { tall: true }); await more(page, /^Kategorien/); await shot(page, 'mehr-kategorien'); });
  test('Budgets', async ({ page }) => { await open(page); await more(page, /^Budgets/); await shot(page, 'mehr-budgets'); });
  test('Wiederkehrende Einnahmen', async ({ page }) => { await open(page); await more(page, /^Wiederkehrende Einnahmen/); await shot(page, 'mehr-einnahmen'); });
  test('Gemeinsames Konto', async ({ page }) => { await open(page, { tall: true }); await more(page, /^Gemeinsames Konto/); await shot(page, 'mehr-gemeinsames-konto'); });
  test('Import', async ({ page }) => { await open(page); await more(page, /^Import/); await page.waitForTimeout(600); await shot(page, 'mehr-import'); });
  test('Daten & Backup', async ({ page }) => { await open(page, { tall: true }); await more(page, /^Daten & Backup/); await shot(page, 'mehr-backup'); });
});

test.describe('Breiten und installierte App', () => {
  for (const w of [375, 430]) {
    test(`Übersicht ${w}`, async ({ page }) => { await open(page, { width: w }); await shot(page, `uebersicht-${w}`); });
    test(`Alltag ${w}`, async ({ page }) => { await open(page, { width: w, view: 'grid' }); await nav(page, 'Alltag'); await shot(page, `alltag-${w}`); });
    test(`Buchungen ${w}`, async ({ page }) => { await open(page, { width: w }); await nav(page, 'Buchungen'); await shot(page, `buchungen-${w}`); });
    test(`Neue Buchung ${w}`, async ({ page }) => { await open(page, { width: w }); await nav(page, 'Buchungen'); await page.getByRole('button', { name: 'Neue Buchung' }).click(); await settle(page); await shot(page, `neue-buchung-${w}`); });
  }
  test('Übersicht installiert', async ({ page }) => { await open(page, { edge: true }); await shot(page, 'uebersicht-installiert'); });
  test('Buchungen installiert', async ({ page }) => { await open(page, { edge: true }); await nav(page, 'Buchungen'); await shot(page, 'buchungen-installiert'); });
  test('Buchungen installiert gescrollt', async ({ page }) => { await open(page, { edge: true }); await nav(page, 'Buchungen'); await page.locator('main').evaluate((m) => m.scrollBy(0, 300)); await settle(page); await shot(page, 'buchungen-installiert-gescrollt'); });
});
