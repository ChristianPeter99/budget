import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const pad = (p: Page) => p.getByRole('dialog').getByRole('group', { name: 'Zahlenfeld' });
async function book(page: Page, digits: string[], top: string, sub: string | null, note: string, date?: string) {
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  const dlg = page.getByRole('dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of digits) await pad(page).getByRole('button', { name: k, exact: true }).click();
  await dlg.locator('.chip:not(.recent)').filter({ hasText: new RegExp(`^${top}$`) }).click();
  if (sub) await dlg.locator('.chip:not(.recent)').filter({ hasText: new RegExp(`^${sub}$`) }).click();
  if (date) await dlg.locator('input[type=date]').fill(date);
  await dlg.getByPlaceholder('Optional').fill(note);
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);
}
const prevMonthDay = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); d.setDate(15); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`; };

test('Alltag: meistgenutzte Kategorie bleibt sichtbar, auch ohne Ausgaben in diesem Monat', async ({ page }) => {
  await page.goto('/');
  await book(page, ['9'], 'Freizeit', 'Kino', 'Film', prevMonthDay());
  // nach dem Speichern zeigt die App den Monat der Buchung; zurück in den aktuellen Monat
  await page.getByRole('button', { name: 'Nächster Monat' }).click();
  await page.getByRole('button', { name: 'Alltag', exact: true }).click();
  await expect(page.locator('.ghead', { hasText: 'Freizeit' })).toBeVisible();
  await expect(page.locator('.ghead', { hasText: 'Freizeit' })).toContainText('0,00 €');
});

test('Kategorien: verschieben, Gruppe ändern, zusammenführen', async ({ page }) => {
  await page.goto('/');
  await book(page, ['3'], 'Lebensmittel', 'Bäcker', 'Brezen');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /^Kategorien/ }).click();
  await expect(page.getByRole('button', { name: 'Sortieren' })).toHaveCount(0);

  // Kantine nach Freizeit verschieben
  await page.locator('.catsub .sub', { hasText: 'Kantine' }).click();
  await page.getByLabel('Oberkategorie').selectOption({ label: 'Freizeit' });
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.card', { has: page.locator('.catname', { hasText: 'Freizeit' }) })).toContainText('Kantine');

  // Bargeld zu Fixkosten
  await page.locator('.catname', { hasText: 'Bargeld' }).click();
  await page.getByLabel('Gruppe').selectOption({ label: 'Fixkosten' });
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.catname', { hasText: 'Bargeld' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Fixkosten' }).click();
  await expect(page.locator('.catname', { hasText: 'Bargeld' })).toContainText('Fixkosten');
  await page.getByRole('tab', { name: 'Alltag' }).click();

  // Bäcker in Einkaufen zusammenführen
  await page.locator('.catsub .sub', { hasText: 'Bäcker' }).click();
  await page.getByLabel('Zusammenführen mit').selectOption({ label: 'Lebensmittel › Einkaufen' });
  await expect(page.getByText(/1 Buchung und Vorlagen/)).toBeVisible();
  await page.getByRole('button', { name: 'Zusammenführen …' }).click();
  await page.getByRole('button', { name: 'Ja, zusammenführen' }).click();
  await expect(page.locator('.catsub .sub', { hasText: 'Bäcker' })).toHaveCount(0);
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await expect(page.locator('.item', { hasText: 'Brezen' })).toContainText('Lebensmittel › Einkaufen');
});

test('Bearbeiten mit Rückgängig und Notiz-Vorschläge', async ({ page }) => {
  await page.goto('/');
  await book(page, ['1', '2'], 'Lebensmittel', 'Einkaufen', 'Rewe');
  // Vorschlag erscheint bei gleicher Bezeichnung
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  await page.getByRole('dialog').locator('.chip:not(.recent)').filter({ hasText: /^Lebensmittel$/ }).click();
  await page.getByRole('dialog').locator('.chip:not(.recent)').filter({ hasText: /^Einkaufen$/ }).click();
  await page.getByRole('dialog').getByLabel('Vorschläge für die Notiz').getByRole('button', { name: 'Rewe' }).click();
  await expect(page.getByRole('dialog').getByPlaceholder('Optional')).toHaveValue('Rewe');
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();

  // Bearbeiten und zurücknehmen
  await page.locator('.item', { hasText: 'Rewe' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click(); await pad(page).getByRole('button', { name: 'Löschen' }).click();
  await pad(page).getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click(); await pad(page).getByRole('button', { name: 'Löschen' }).click();
  await pad(page).getByRole('button', { name: 'Löschen' }).click();
  await pad(page).getByRole('button', { name: '9', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.item', { hasText: 'Rewe' }).first()).toContainText('9,00 €');
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.item', { hasText: 'Rewe' }).first()).toContainText('12,00 €');
});

test('Große Systemschrift: Beträge brechen nicht um, Kopf des Erfassens bleibt einzeilig', async ({ page }) => {
  await page.goto('/');
  await page.addStyleTag({ content: 'html{font-size:23px !important}' });
  await page.locator('.gval').first().waitFor();
  const lines = await page.locator('.ovfacts b, .gval').evaluateAll((els) => els.map((e) => e.getClientRects().length));
  expect(lines.length).toBeGreaterThan(3);
  expect(lines.every((n) => n === 1)).toBe(true);
  const h = await page.locator('.gval').first().evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  const title = page.getByRole('dialog').locator('.ph h2');
  expect(await title.evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(40);
  const cancel = page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' });
  expect(await cancel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
});

test('Gemeinsames Konto zeigt den Übertrag-Bereich', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Gemeinsames Konto/ }).click();
  await page.getByLabel('Mein Beitrag pro Monat').fill('400');
  await page.getByLabel('Beitrag der anderen Person pro Monat').fill('350');
  await page.getByRole('button', { name: 'Einrichten' }).click();
  await expect(page.getByRole('heading', { name: 'Übertrag' })).toBeVisible();
  await expect(page.locator('.kv', { hasText: 'Aus Vormonaten' })).toContainText('+0,00 €');
});
