import { test } from '@playwright/test';
import { enrich, more, nav, open, settle, shot } from './helpers';

// Referenzbilder mit reicheren Daten (Alltag-Ausgaben, Budgets, Sparen, Depot, Sparziel, gemeinsames Konto)
test.describe('Mit Daten', () => {
  test('Übersicht', async ({ page }) => { await open(page); await enrich(page); await shot(page, 'daten-uebersicht'); });
  test('Übersicht Alltag gewählt', async ({ page }) => { await open(page); await enrich(page); await page.locator('.ovcorner', { hasText: 'Alltag' }).click(); await settle(page); await shot(page, 'daten-uebersicht-alltag'); });
  test('Monatsauswahl', async ({ page }) => { await open(page); await enrich(page); await page.getByRole('button', { name: /Monat wählen$/ }).click(); await settle(page); await shot(page, 'daten-monatsauswahl'); });
  test('Alltag Kacheln', async ({ page }) => { await open(page, { tall: true, view: 'grid' }); await enrich(page); await nav(page, 'Alltag'); await shot(page, 'daten-alltag-kacheln'); });
  test('Alltag Liste', async ({ page }) => { await open(page, { tall: true, view: 'list' }); await enrich(page); await nav(page, 'Alltag'); await shot(page, 'daten-alltag-liste'); });
  test('Alltag gemeinsames Konto', async ({ page }) => { await open(page, { tall: true, view: 'grid' }); await enrich(page); await nav(page, 'Alltag'); await page.getByRole('tab', { name: 'Haushaltskonto' }).click(); await settle(page); await shot(page, 'daten-alltag-haushalt'); });
  test('Buchungen', async ({ page }) => { await open(page, { tall: true }); await enrich(page); await nav(page, 'Buchungen'); await shot(page, 'daten-buchungen'); });
  test('Buchungen Suche', async ({ page }) => { await open(page); await enrich(page); await nav(page, 'Buchungen'); await page.getByRole('searchbox', { name: 'Suchen' }).fill('rewe'); await settle(page); await shot(page, 'daten-buchungen-suche'); });
  test('Auswertung', async ({ page }) => { await open(page, { tall: true }); await enrich(page); await more(page, /^Auswertung/); await page.waitForTimeout(800); await shot(page, 'daten-auswertung'); });
  test('Sparen & Depot', async ({ page }) => { await open(page, { tall: true }); await enrich(page); await more(page, /^Sparen & Depot/); await shot(page, 'daten-sparen'); });
  test('Budgets', async ({ page }) => { await open(page); await enrich(page); await more(page, /^Budgets/); await shot(page, 'daten-budgets'); });
  test('Gemeinsames Konto', async ({ page }) => { await open(page, { tall: true }); await enrich(page); await more(page, /^Gemeinsames Konto/); await shot(page, 'daten-gemeinsames-konto'); });
});
