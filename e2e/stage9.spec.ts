import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(process.cwd(), 'tests/fixtures/c24-beispiel.csv');

/** Hinweis „offline nutzbar“ schiebt den Inhalt nach unten – vor dem Ziehen abwarten und schließen */
async function settle(page: Page) {
  await page.waitForTimeout(1500);
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  if (await ok.count()) await ok.first().click();
}

/** gedrückt halten, dann ziehen (Maus wie Finger) */
async function holdDrag(page: Page, from: Locator, to: Locator, below = false) {
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  const ty = below ? b.y + b.height * 0.8 : b.y + b.height * 0.2;
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((ty - (a.y + a.height / 2)) * i) / 12);
  await page.mouse.up();
}

test('Alltag: Unterkategorie und Hauptkategorie per Gedrückthalten verschieben, Tipp bleibt Tipp', async ({ page }) => {
  await page.goto('/');
  await settle(page);
  await page.getByRole('button', { name: 'Alltag', exact: true }).click();
  // Kalender zuklappen (wird gemerkt), damit die Kategorien im Bild sind
  await page.getByRole('button', { name: 'Ausgaben-Kalender zuklappen' }).click();
  await expect(page.locator('.calgrid')).toHaveCount(0);
  const showAll = async () => { const m = page.locator('.morecats', { hasText: 'weitere Kategorien' }); if (await m.count()) await m.click(); };
  await showAll();
  const card = page.locator('.card', { has: page.locator('.ghead b', { hasText: /^Lebensmittel$/ }) });
  const subs = () => card.locator('.subrow .sub span:first-child').allInnerTexts();
  const before = await subs();
  await holdDrag(page, card.locator('.subrow', { hasText: before[2]! }), card.locator('.subrow', { hasText: before[0]! }));
  await expect.poll(subs).toEqual([before[2], before[0], before[1], ...before.slice(3)]);
  await expect(page.locator('.sheetwrap')).toHaveCount(0); // kein Erfassen-Blatt nach dem Ziehen
  // bleibt nach Neuladen
  await page.reload();
  await page.getByRole('button', { name: 'Alltag', exact: true }).click();
  await showAll();
  await expect.poll(subs).toEqual([before[2], before[0], before[1], ...before.slice(3)]);
  // Hauptkategorien
  const tops = () => page.locator('.card .ghead b:first-of-type').allInnerTexts();
  const t0 = await tops();
  await holdDrag(page, page.locator('.ghead', { hasText: t0[1]! }), page.locator('.ghead', { hasText: t0[0]! }));
  await expect.poll(async () => (await tops()).slice(0, 2)).toEqual([t0[1], t0[0]]);
  // kurzer Tipp öffnet weiterhin das Erfassen
  await card.locator('.subrow .sub').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Fixkosten: Position per Gedrückthalten verschieben', async ({ page }) => {
  await page.goto('/');
  await settle(page);
  await page.getByRole('button', { name: 'Fixkosten', exact: true }).click();
  const rows = () => page.locator('.card .sub > span:first-child').allInnerTexts();
  const cardWithTwo = page.locator('.card:has(.sub + *), .card').filter({ has: page.locator('.dsort .sub') });
  if ((await page.locator('.dsort .sub').count()) < 2) test.skip(true, 'Startdaten ohne zwei Fixkosten-Positionen in einer Kategorie');
  const c = cardWithTwo.first();
  const names = await c.locator('.sub > span:first-child').allInnerTexts();
  if (names.length < 2) test.skip(true, 'keine Kategorie mit zwei Positionen');
  await holdDrag(page, c.locator('.sub', { hasText: names[1]! }), c.locator('.sub', { hasText: names[0]! }));
  await expect.poll(async () => (await c.locator('.sub > span:first-child').allInnerTexts()).slice(0, 2)).toEqual([names[1], names[0]]);
  void rows;
});

test('Import: Detailansicht einer Buchung', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /CSV-Import/ }).click();
  await page.getByLabel('CSV-Datei').setInputFiles(FIXTURE);
  const sm = page.locator('.imp', { has: page.locator('b', { hasText: /^Supermärkte$/ }) });
  await sm.locator('.impchev').click();
  await sm.getByRole('button', { name: /Details: Kaufland/ }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Laut Kontoauszug');
  await expect(dlg).toContainText('24.10.2026, 16:28 Uhr');
  await expect(dlg).toContainText('KAUFLAND 1');
  await expect(dlg).toContainText('Lebensmittel › Supermarkt');
  await dlg.getByRole('button', { name: 'Nicht übernehmen' }).click();
  await expect(dlg.getByRole('button', { name: 'Übernehmen', exact: true })).toBeVisible();
  await dlg.getByRole('button', { name: 'Fertig' }).click();
  await expect(sm.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'mixed');
});
