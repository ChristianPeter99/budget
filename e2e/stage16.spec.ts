import { expect, test } from '@playwright/test';
import { pickDay } from './rangecal';

test('Buchungen: Filter im Fenster (Zeitraum, Art, Kategorie), Symbole ohne Kasten, Auswählen oben', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  await nav.getByRole('button', { name: 'Buchungen' }).click();
  // keine Monat/Jahr/Gesamt-Leiste und keine Filter-Chips mehr direkt auf der Seite
  await expect(page.getByRole('button', { name: 'Jahr', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Alle Kategorien' })).toHaveCount(0);
  await expect(page.locator('.hd').getByRole('button', { name: 'Neue Buchung' })).toBeVisible();
  await expect(page.locator('.srchrow').getByRole('button', { name: 'Filter' })).toBeVisible();
  await expect(page.locator('.swipe .tile').first()).toHaveClass(/flat/);
  await page.getByRole('button', { name: 'Filter' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('radio', { name: 'Jahr' }).click();
  await dlg.getByRole('radio', { name: 'Ausgaben' }).click();
  await dlg.getByRole('button', { name: /anzeigen/ }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('h1').first()).toHaveText(/^\d{4}$/);
  await expect(page.getByRole('button', { name: 'Filter (aktiv)' })).toBeVisible();
  await expect(page.locator('.freset')).toContainText('Ausgaben');
  // Gesamt gibt es nicht mehr; Kategorie per Suche
  await page.getByRole('button', { name: 'Filter (aktiv)' }).click();
  await expect(dlg.getByRole('radio', { name: 'Gesamt' })).toHaveCount(0);
  await dlg.getByLabel('Kategorie suchen').fill('bäck');
  await expect(dlg.getByRole('radio', { name: /Lebensmittel/ })).toBeVisible();
  await expect(dlg.getByRole('radio', { name: /Wohnen/ })).toHaveCount(0);
  await dlg.getByRole('radio', { name: /Lebensmittel/ }).click();
  await dlg.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.locator('.freset')).toContainText('Lebensmittel');
  // Von–bis
  await page.getByRole('button', { name: 'Filter (aktiv)' }).click();
  await dlg.getByRole('radio', { name: 'Von–bis' }).click();
  await pickDay(dlg, '2026-01-01');
  await pickDay(dlg, '2026-01-31');
  await dlg.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.locator('h1').first()).toHaveText('1.1.26 – 31.1.26');
  // zurücksetzen über die Zeile
  await page.locator('.freset').click();
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeVisible();
  await expect(page.locator('.freset')).toHaveCount(0);
});

test('Fixkosten: + oben rechts statt „Fixkosten hinzufügen“ unten', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect(page.getByRole('button', { name: /Fixkosten hinzufügen/ })).toHaveCount(0);
  await page.locator('.hd').getByRole('button', { name: 'Neue Fixkosten' }).click();
  await expect(page.getByRole('dialog', { name: 'Neue Fixkosten' })).toBeVisible();
});

test('Neue Buchung: Wischen im Blatt wechselt den Bereich wie bei den Kategorien', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.locator('.hd').getByRole('button', { name: 'Neue Buchung' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('tab', { name: 'Alltag' })).toHaveAttribute('aria-selected', 'true');
  const swipe = async (dir: number) => {
    const box = (await dlg.locator('.txcats').boundingBox())!;
    const y = box.y + 20, x0 = box.x + box.width / 2;
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + dir * i * 18, y);
    await page.mouse.up(); await page.waitForTimeout(450);
  };
  await swipe(-1);
  await expect(dlg.getByRole('tab', { name: 'Einnahme' })).toHaveAttribute('aria-selected', 'true');
  await expect(dlg.locator('.chip:not(.recent)', { hasText: /^Gehalt$/ })).toBeVisible();
  await swipe(-1); // letzter Reiter: bleibt
  await expect(dlg.getByRole('tab', { name: 'Einnahme' })).toHaveAttribute('aria-selected', 'true');
  await swipe(1);
  await expect(dlg.getByRole('tab', { name: 'Alltag' })).toHaveAttribute('aria-selected', 'true');
  // Wischen löst keinen Tipp auf eine Kategorie aus, Sheet bleibt offen
  await expect(dlg).toBeVisible();
});

test('Neue Buchung ohne Fixkosten-Reiter; bestehende Fixkosten-Buchung bleibt bearbeitbar', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.locator('.hd').getByRole('button', { name: 'Neue Buchung' }).click();
  await expect(page.getByRole('dialog').getByRole('tablist', { name: 'Bereich' }).getByRole('tab')).toHaveText(['Alltag', 'Einnahme']);
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();
  const fixRow = page.locator('.swipe .item', { hasText: 'Wohnen' }).first();
  await fixRow.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('tab', { name: 'Fixkosten' })).toHaveAttribute('aria-selected', 'true');
});

test('Mehr: „fehlt“ in Warnfarbe; Sparen & Depot leer ohne Erklärtext; Meldung mit Häkchen', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await expect(page.locator('.link small.warnval')).toHaveText('fehlt');
  await page.getByRole('button', { name: /Sparen & Depot/ }).click();
  await expect(page.getByText(/Trag Stände/)).toHaveCount(0);
  await expect(page.locator('.wtile .wadd')).toHaveCount(2);
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.locator('.hd').getByRole('button', { name: 'Neue Buchung' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  await page.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: '5', exact: true }).click();
  await page.getByRole('dialog').locator('.chip:not(.recent)', { hasText: /^Lebensmittel$/ }).click();
  await page.getByRole('dialog').locator('.chip:not(.recent)', { hasText: /^Kantine$/ }).click();
  await page.locator('.kd-save').click();
  await expect(page.locator('.toast .tcheck')).toBeVisible();
});

test('Gemeinsames Konto: „Einrichten“ oben rechts, Beiträge als eigene Gruppe', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /Gemeinsames Konto/ }).click();
  await expect(page.locator('.toprow .toplnk')).toHaveText('Einrichten');
  await expect(page.getByText(/Abweichende Beiträge/)).toHaveCount(0);
  await page.getByLabel('Mein Beitrag pro Monat').fill('300');
  await page.getByLabel('Beitrag der anderen Person pro Monat').fill('200');
  await expect(page.locator('.budrow')).toContainText('500');
  await page.locator('.toprow .toplnk').click();
  await expect(page.locator('.toprow .toplnk')).toHaveText('Speichern');
});
