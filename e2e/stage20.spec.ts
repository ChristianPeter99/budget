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
  // Automatisch angespart: die erste Monatsrate ist sofort als Sparen gebucht
  await expect(page.locator('.goalrow', { hasText: 'Urlaub' })).toContainText('200 € pro Monat');
  await expect(page.locator('.goalrow .sp', { hasText: 'Urlaub' })).toContainText('200 €');
  await expect(page.locator('.wtile', { hasText: 'Sparkonto' })).toContainText('/ Monat');
  await page.locator('.wtile', { hasText: 'Sparkonto' }).click();
  await expect(page.getByRole('dialog').locator('.wleg', { hasText: 'Urlaub' })).toContainText('200 €');
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await expect(page.getByText('Sparziel: Urlaub').first()).toBeVisible();
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  if (await page.getByRole('button', { name: /^Sparen & Depot/ }).isVisible()) await page.getByRole('button', { name: /^Sparen & Depot/ }).click();
  await page.locator('.goalrow', { hasText: 'Urlaub' }).click();
  await page.getByRole('dialog').getByLabel('Betrag einzahlen').fill('300');
  await page.getByRole('button', { name: 'Zum angesparten Betrag hinzufügen' }).click();
  await expect(page.locator('.goalrow', { hasText: 'Urlaub' })).toContainText('500 €');
  await page.locator('nav').getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.locator('.ovcorner.bl')).toContainText('Urlaub');
  await page.locator('.ovcorner.bl').click();
  await expect(page.locator('.ovcenter')).toContainText('Urlaub: 500 € / 1.200 €');
  await page.getByRole('button', { name: /Sparen öffnen/ }).click();
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

test('Sparen & Depot: Gesamt aus Sparkonto + Depot, Aktualisieren direkt im Detail mit Datum und Unterschied', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await expect(page.getByRole('button', { name: /^Gesamtvermögen/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Sparen & Depot/ }).click();
  await page.locator('.wtile', { hasText: 'Sparkonto' }).click();
  await page.getByRole('button', { name: 'Stand aktualisieren' }).click();
  await page.getByLabel('Kontostand Sparkonto').fill('8500');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.toast')).toContainText('Kontostand erfasst');
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();
  await page.locator('.wtile', { hasText: 'Depot' }).click();
  await page.getByRole('button', { name: 'Stand aktualisieren' }).click();
  await page.getByLabel('Neuer Depotstand').fill('12000');
  await page.getByLabel('Stand vom').fill(await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 20); return d.toISOString().slice(0, 10); }));
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.toast')).toContainText('Depotstand erfasst');
  await page.getByRole('button', { name: 'Stand aktualisieren' }).click();
  await page.getByLabel('Neuer Depotstand').fill('12400');
  await expect(page.getByRole('dialog').locator('.wdiff')).toContainText('+400 €');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog').locator('.mid34')).toHaveText(/12\.400\s€/);
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();
  await expect(page.locator('.whero .mid34')).toHaveText(/20\.900\s€/);
  await expect(page.locator('.wtile', { hasText: 'Depot' })).toContainText('+3,3 %');
  await expect(page.getByRole('img', { name: /Verlauf Sparkonto und Depot/ })).toBeVisible();
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
  await expect(page.locator('.ovsvg svg').first()).toBeAttached();
  await expect(page.locator('.ovcorner.bl .ocname svg')).toHaveCount(1);
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

test('Mehr-Unterseite: nach rechts wischen (irgendwo) geht zurück, kurzer Zug federt zurück', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Auswertung/ }).click();
  await expect(page.locator('main [data-pop]')).toBeVisible();
  const y = 420;
  await page.mouse.move(120, y); await page.mouse.down();
  for (let i = 1; i <= 4; i++) { await page.mouse.move(120 + i * 12, y); await page.waitForTimeout(30); }
  await page.waitForTimeout(150);
  await page.mouse.up(); await page.waitForTimeout(500);
  await expect(page.locator('main [data-pop]')).toBeVisible();
  await page.mouse.move(120, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(120 + i * 18, y); await page.waitForTimeout(16); }
  await page.mouse.up();
  await expect(page.getByRole('heading', { level: 1, name: 'Mehr' })).toBeVisible();
  await expect(page.locator('main [data-pop]')).toHaveCount(0);
  await expect(page.locator('nav [aria-current="page"]')).toHaveAttribute('aria-label', 'Mehr');
});

test('Kalender: Tage ohne Ausgaben ohne Farbe', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  const colored = await page.locator('.calcell:not(.empty)').evaluateAll((els) => els.filter((e) => !(e.querySelector('.calamt')) && (e as HTMLElement).style.background !== '').length);
  expect(colored).toBe(0);
});

test('Übersicht-Ring: Haushaltskonto innen und in der Ecke, wenn eingerichtet', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.ovcorner.tl')).toContainText(/Einnahmen|Gehalt/);
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Gemeinsames Konto/ }).click();
  await page.getByLabel('Mein Beitrag pro Monat').fill('400');
  await page.getByLabel('Name der anderen Person').fill('Lena');
  await page.getByLabel('Beitrag der anderen Person pro Monat').fill('350');
  await page.getByRole('button', { name: 'Einrichten' }).click();
  await expect(page.getByText('Gemeinsames Konto eingerichtet')).toBeVisible();
  await page.locator('nav').getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.locator('.ovcorner.tl')).toContainText('übrig');
  await page.locator('.ovcorner.tl').click();
  await expect(page.locator('.ovcenter')).toContainText('ausgegeben');
  await page.getByRole('button', { name: /Konto öffnen/ }).click();
  await expect(page.locator('nav').getByRole('button', { name: 'Alltag' })).toHaveAttribute('aria-current', 'page');
});

test('Sparkonto: Betrag antippen öffnet Eingabe; alter Bankstand meldet sich orange', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Sparen & Depot/ }).click();
  await page.locator('.wtile', { hasText: 'Sparkonto' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Stand eintragen' }).click();
  await page.getByLabel('Kontostand Sparkonto').fill('5000');
  await page.getByLabel('Stand vom').fill(await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 40); return d.toISOString().slice(0, 10); }));
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog').locator('.wchip.warn')).toContainText('Tage alt · abgleichen');
  await page.getByRole('button', { name: /^Sparkonto .* antippen zum Aktualisieren/ }).click();
  await expect(page.getByLabel('Kontostand Sparkonto')).toBeFocused();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByRole('dialog').locator('.wchip.warn').click();
  await page.getByLabel('Kontostand Sparkonto').fill('5100');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog').locator('.wchip')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /^Sparkonto bis heute, gestrichelt die Prognose/ })).toBeVisible();
  await page.getByRole('button', { name: '5 J' }).click();
  await expect(page.getByRole('dialog')).toContainText('Prognose in 5 Jahren');
});
