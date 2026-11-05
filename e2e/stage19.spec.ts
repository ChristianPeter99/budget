import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function addBooking(page: Page, digits: string[], sub: string, note: string) {
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Neue Buchung' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of digits) await page.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Lebensmittel', exact: true }).click();
  await page.getByRole('button', { name: sub, exact: true }).click();
  await page.getByPlaceholder('Optional').fill(note);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function longPress(page: Page, sel: import('@playwright/test').Locator) {
  const b = (await sel.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test('Neue Buchung gleitet in die Liste und leuchtet kurz', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['7'], 'Kantine', 'Frisch');
  await expect(page.locator('.swipe.fresh', { hasText: 'Frisch' })).toHaveCount(1);
});

test('Gedrückt halten: Menü mit Bearbeiten, Duplizieren, Löschen; Tipp danach öffnet nicht die Buchung', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['1', '9'], 'Kantine', 'Halten');
  const row = page.locator('.swipe .item', { hasText: 'Halten' });
  await longPress(page, row);
  const menu = page.getByRole('dialog', { name: 'Aktionen für Buchung' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Bearbeiten', 'Duplizieren', 'Löschen']);
  // kein Bearbeiten-Fenster durch das Loslassen
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Duplizieren → neues Fenster mit gleichem Betrag
  await longPress(page, row);
  await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true })).toHaveText('19,00 €');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.swipe .item', { hasText: 'Halten' })).toHaveCount(2);

  // Löschen mit Rückgängig
  await longPress(page, page.locator('.swipe .item', { hasText: 'Halten' }).first());
  await page.getByRole('menuitem', { name: 'Löschen' }).click();
  await expect(page.locator('.swipe .item', { hasText: 'Halten' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.swipe .item', { hasText: 'Halten' })).toHaveCount(2);
});

test('Gedrückt halten auch in den Buchungen einer Unterkategorie (Alltag)', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['5'], 'Kantine', 'Drill');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await page.getByRole('button', { name: /Buchungen Kantine aufklappen/ }).click();
  const row = page.locator('.clp.done .drill .item', { hasText: 'Drill' });
  await expect(row).toBeVisible();
  await longPress(page, row);
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  await expect(page.getByRole('dialog').getByPlaceholder('Optional')).toHaveValue('Drill');
});

test('Aufklappen ist weich und Zuklappen entfernt den Inhalt danach', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  const card = page.locator('.card', { has: page.locator('.ghead b', { hasText: /^Lebensmittel$/ }) });
  await expect(card.locator('.clp.done .subrow').first()).toBeVisible();
  await page.getByRole('button', { name: 'Lebensmittel zuklappen' }).click();
  await expect(card.locator('.clp.shut')).toHaveCount(1);
  await expect(card.locator('.subrow')).toHaveCount(0);
  await page.getByRole('button', { name: 'Lebensmittel aufklappen' }).click();
  await expect(card.locator('.clp.done .subrow').first()).toBeVisible();
});

test('Aktiven Reiter antippen: nach oben bzw. eine Ebene zurück', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  const view = page.locator('main.view');
  await view.evaluate((m) => { m.scrollTop = 400; });
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect.poll(() => view.evaluate((m) => m.scrollTop)).toBe(0);
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /Kategorien/ }).click();
  await expect(page.locator('main [data-pop]')).toBeVisible();
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mehr' })).toBeVisible();
});

test('Erfassen: Kategorien getrennt nach Alltag und Fixkosten', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Neue Buchung' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('tab', { name: 'Alltag' })).toHaveAttribute('aria-selected', 'true');
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Lebensmittel$/ })).toHaveCount(1);
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Wohnen$/ })).toHaveCount(0);
  await dlg.getByRole('tab', { name: 'Fixkosten' }).click();
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Wohnen$/ })).toHaveCount(1);
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Lebensmittel$/ })).toHaveCount(0);
});

test('Kategorien in Mehr: oben Bereich wählen', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Kategorien/ }).click();
  await expect(page.locator('.catname', { hasText: 'Lebensmittel' })).toHaveCount(1);
  await expect(page.locator('.catname', { hasText: 'Wohnen' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Fixkosten' }).click();
  await expect(page.locator('.catname', { hasText: 'Wohnen' })).toHaveCount(1);
  await expect(page.locator('.catname', { hasText: 'Lebensmittel' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Einnahmen' }).click();
  await expect(page.locator('.catname', { hasText: 'Gehalt' })).toHaveCount(1);
});

test('Neue Buchung in anderem Monat: Buchungen springen in diesen Monat', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  const h1 = page.getByRole('heading', { level: 1 });
  const now = await h1.textContent();
  await page.getByRole('button', { name: 'Vorheriger Monat' }).click();
  await expect(h1).not.toHaveText(now!);
  await addBooking(page, ['3'], 'Kantine', 'Sprung');
  await expect(h1).toHaveText(now!);
  await expect(page.locator('.swipe.fresh', { hasText: 'Sprung' })).toHaveCount(1);
});

test('CSV-Import: Kategorie wählen getrennt nach Alltag und Fixkosten', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /CSV-Import/ }).click();
  const d = new Date(); const today = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const csv = `Buchungsdatum,Betrag,Zahlungsempfänger,Kategorie,Unterkategorie\n${today},"-7,50",Muster Laden,Weitere Ausgaben,Weitere Ausgaben\n`;
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.locator('.imp', { hasText: 'Muster' }).getByRole('button', { name: 'Kategorie wählen' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('tab', { name: 'Alltag' })).toHaveAttribute('aria-selected', 'true');
  await expect(dlg.locator('.sel button', { hasText: /^Kantine$/ })).toHaveCount(1);
  await expect(dlg.locator('.sel button', { hasText: /^Wohnen$/ })).toHaveCount(0);
  await dlg.getByRole('tab', { name: 'Fixkosten' }).click();
  await expect(dlg.locator('.sel button', { hasText: /^Kantine$/ })).toHaveCount(0);
  await expect(dlg.locator('.sel button').first()).toBeVisible();
});

test('Aus Alltag heraus: keine Bereichswahl, nur Alltags-Kategorien; Sparen eigener Bereich', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await page.locator('.ghead .gmain', { hasText: 'Lebensmittel' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('tablist', { name: 'Bereich' })).toHaveCount(0);
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Freizeit$/ })).toHaveCount(1);
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Wohnen$/ })).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dlg).toHaveCount(0);
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Kategorien/ }).click();
  await page.getByRole('tab', { name: 'Fixkosten' }).click();
  await expect(page.locator('.catname', { hasText: /^Sparen/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Sparen' }).click();
  await expect(page.locator('.catname', { hasText: /^Sparen/ })).toHaveCount(1);
});
