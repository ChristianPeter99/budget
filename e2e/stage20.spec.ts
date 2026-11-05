import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function addBooking(page: Page, digits: string[], top: string, sub: string, note: string) {
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Neue Buchung' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of digits) await page.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
  await dlg.locator('.chip:not(.recent)', { hasText: new RegExp(`^${top}$`) }).click();
  await dlg.locator('.chip:not(.recent)', { hasText: new RegExp(`^${sub}$`) }).click();
  await dlg.getByPlaceholder('Optional').fill(note);
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(dlg).toHaveCount(0);
}

test('Budgets: nur Alltag-Kategorien; Limit erscheint im Alltag als Balken unter dem Namen', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['5', '0'], 'Lebensmittel', 'Einkaufen', 'Wocheneinkauf');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Budgets/ }).click();
  await expect(page.locator('.item', { hasText: 'Wohnen' })).toHaveCount(0);
  await page.locator('.item', { hasText: 'Lebensmittel' }).click();
  await page.getByRole('dialog').getByLabel('Budget').fill('200');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await expect(page.getByRole('img', { name: /Budget Lebensmittel: 50,00 € von 200,00 €/ })).toBeVisible();
  await expect(page.locator('.gbar')).toHaveCount(1);
});

test('Sparziel anlegen, auf der Übersicht sehen, einzahlen, löschen mit Rückgängig', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Sparen & Depot/ }).click();
  await page.getByRole('button', { name: 'Neues Ziel' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('input').first().fill('Urlaub');
  await dlg.getByLabel('Zielbetrag').fill('1200');
  await dlg.getByLabel('Zielmonat').fill(await page.evaluate(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }));
  await expect(dlg.locator('.goalprev')).toContainText('200 € pro Monat');
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.goalrow', { hasText: 'Urlaub' })).toContainText('200 € pro Monat');
  await page.locator('.goalrow', { hasText: 'Urlaub' }).click();
  await page.getByRole('dialog').getByLabel('Betrag einzahlen').fill('300');
  await page.getByRole('button', { name: 'Zum angesparten Betrag hinzufügen' }).click();
  await expect(page.locator('.goalrow', { hasText: 'Urlaub' })).toContainText('300 €');
  await page.locator('nav').getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.locator('.goalrow', { hasText: 'Urlaub' })).toContainText('150 € pro Monat');
  await page.locator('.goalrow', { hasText: 'Urlaub' }).click();
  await expect(page.getByRole('heading', { name: 'Sparen & Depot' })).toBeVisible();
  await page.locator('.goalrow', { hasText: 'Urlaub' }).click();
  await page.getByRole('button', { name: 'Sparziel löschen' }).click();
  await expect(page.locator('.goalrow')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.goalrow', { hasText: 'Urlaub' })).toHaveCount(1);
});

test('Fixkosten: optionale Kündigungsfrist wird in der Zeile angezeigt', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await page.locator('.card.flush .sub', { hasText: 'Spotify' }).click();
  await page.getByLabel('Kündigungsfrist (optional)').fill('1 Monat');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.card.flush .sub', { hasText: 'Spotify' })).toContainText('Kündigungsfrist: 1 Monat');
});

test('Gesamtvermögen: Sparkonto + Depot', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Sparen & Depot/ }).click();
  await page.getByLabel('Kontostand Sparkonto').fill('8500');
  await page.getByRole('button', { name: 'Mit heutigem Datum erfassen' }).first().click();
  await page.getByLabel('Neuer Depotstand').fill('12400');
  await page.getByRole('button', { name: 'Mit heutigem Datum erfassen' }).nth(1).click();
  await expect(page.locator('.toast')).toContainText('Depotstand erfasst');
  await page.locator('.back').click();
  await page.getByRole('button', { name: /^Gesamtvermögen/ }).click();
  await expect(page.locator('.mid34')).toHaveText(/20\.900\s€/);
});

test('Ausgaben-Kalender: Tag zeigt Betrag, Tipp zeigt Buchungen, Erfassen für den Tag', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['3', '7'], 'Freizeit', 'Kino', 'Kalendertest');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  const today = page.locator('.calcell.today');
  await expect(today).toContainText('37');
  await today.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Kalendertest');
  await dlg.getByRole('button', { name: 'Ausgabe für diesen Tag' }).click();
  await expect(page.getByRole('dialog').locator('input[type=date]')).toHaveValue(await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }));
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();
  // zuklappen wird gemerkt
  await page.getByRole('button', { name: 'Ausgaben-Kalender zuklappen' }).click();
  await expect(page.locator('.calgrid')).toHaveCount(0);
  await page.reload();
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await expect(page.getByRole('button', { name: 'Ausgaben-Kalender aufklappen' })).toBeVisible();
});

test('Übersicht: Symbole im Ring und in den Kacheln', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.ovhero svg[role="img"] svg').first()).toBeAttached();
  await expect(page.locator('.gtile.g-spar .gname svg')).toHaveCount(1);
});

test('Beim Öffnen erscheint „Hallo Benutzer“', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.toast')).toContainText('Hallo Benutzer');
});

test('Erfassen: eine Reihe Alltag · Fixkosten · Einnahme', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Neue Buchung' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('tablist', { name: 'Bereich' }).getByRole('tab')).toHaveText(['Alltag', 'Fixkosten', 'Einnahme']);
  await expect(dlg.getByRole('group', { name: 'Art' })).toHaveCount(0);
  await dlg.getByRole('tab', { name: 'Einnahme' }).click();
  await expect(dlg.getByRole('heading', { name: 'Neue Einnahme' }).or(dlg.getByText('Neue Einnahme'))).toBeVisible();
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Gehalt$/ })).toHaveCount(1);
  await dlg.getByRole('tab', { name: 'Fixkosten' }).click();
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Wohnen$/ })).toHaveCount(1);
});

test('Buchungen: Suche nach Betrag', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['1', '2', ',', '5'], 'Lebensmittel', 'Bäcker', 'Betragssuche');
  await page.getByLabel('Suchen').fill('12,50');
  await expect(page.locator('.swipe .item')).toHaveCount(1);
  await expect(page.locator('.swipe .item')).toContainText('Betragssuche');
  await page.getByLabel('Suchen').fill('12');
  await expect(page.locator('.swipe .item', { hasText: 'Betragssuche' })).toHaveCount(1);
});

test('Mehr in Gruppen; Auswertung mit farbigen Kategorie-Balken', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await expect(page.locator('.moregroup > .cap')).toHaveText(['Geld', 'Einrichten', 'Daten']);
  await page.getByRole('button', { name: /^Auswertung/ }).click();
  await expect(page.locator('.catlab', { hasText: 'Wohnen' }).locator('svg')).toHaveCount(1);
});
