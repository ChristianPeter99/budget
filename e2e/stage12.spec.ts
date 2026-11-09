import { expect, test } from '@playwright/test';

test('Navigation: Buchungen statt Plus, Neue Buchung dort; Alltag ohne „Alle Buchungen“', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  await expect(nav.getByRole('button')).toHaveText(['', '', '', '', '']);
  for (const [i, l] of ['Übersicht', 'Alltag', 'Buchungen', 'Fixkosten', 'Mehr'].entries()) await expect(nav.getByRole('button').nth(i)).toHaveAttribute('aria-label', l);
  await nav.getByRole('button', { name: 'Alltag' }).click();
  await expect(page.getByRole('button', { name: /Alle Buchungen/ })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Neue Buchung' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();
  await nav.getByRole('button', { name: 'Mehr' }).click();
  await expect(page.locator('.link', { hasText: /^Kategorien/ })).toHaveCount(1);
});

test('Alltag und Fixkosten: neue Kategorie anlegen und Kategorien bearbeiten', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  await nav.getByRole('button', { name: 'Alltag' }).click();
  // Alltag hat keinen Stift mehr – Kategorien über Mehr › Kategorien
  await expect(page.getByRole('button', { name: 'Kategorien bearbeiten' })).toHaveCount(0);
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click(); await page.getByRole('button', { name: /^Kategorien/ }).click();
  await expect(page.getByRole('heading', { name: 'Kategorien' })).toBeVisible();
  await page.getByRole('button', { name: 'Neue Kategorie' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.locator('input').first().fill('Haustier');
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);
  await expect(page.locator('.catname', { hasText: 'Haustier' })).toBeVisible();
  await nav.getByRole('button', { name: 'Fixkosten' }).click();
  await expect(page.getByRole('button', { name: 'Kategorien bearbeiten' })).toHaveCount(0);
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click(); await page.getByRole('button', { name: /^Kategorien/ }).click();
  await page.getByRole('tab', { name: 'Fixkosten' }).click();
  await page.getByRole('button', { name: 'Neue Kategorie' }).click();
  dlg = page.getByRole('dialog');
  await dlg.locator('input').first().fill('Garage');
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);
  await expect(page.locator('.catname', { hasText: 'Garage' })).toBeVisible();
  await expect(page.locator('.catname', { hasText: 'Haustier' })).toHaveCount(0);
});

test('Sparkonto: Stand mit heutigem Datum erfassen, auch mit gemeinsamem Konto (früher Fehlermeldung)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Gemeinsames Konto/ }).click();
  await page.getByLabel('Mein Beitrag pro Monat').fill('300');
  await page.getByRole('button', { name: 'Einrichten' }).click();
  await page.locator('.back').click();
  await page.getByRole('button', { name: /Sparen & Depot/ }).click();
  await page.locator('.wtile', { hasText: 'Sparkonto' }).click();
  await page.getByRole('button', { name: 'Stand aktualisieren' }).click();
  await page.getByLabel('Kontostand Sparkonto').fill('12.345');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.toast')).toContainText('Kontostand erfasst');
  // Details bleiben offen: neuer Stand, Prognose und Verlauf
  await page.getByRole('button', { name: 'Bisher' }).click();
  await expect(page.getByRole('dialog').locator('.wbigval')).toHaveText(/12\.345\s€/);
  await page.getByRole('button', { name: 'Nächstes Jahr' }).click();
  await expect(page.getByRole('dialog')).toContainText('In einem Jahr · ohne Zinsen');
  await page.getByRole('dialog').getByRole('button', { name: /^Verlauf/ }).click();
  await expect(page.getByRole('dialog').locator('.lastentry')).toContainText('12.345 €');
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();
  await expect(page.locator('.wtile', { hasText: 'Sparkonto' })).toContainText('12.345 €');
  // Auswertung zeigt Sparkonto und Depot nicht mehr (Verläufe stehen unter Sparen & Depot)
  await page.locator('.back').click();
  await page.getByRole('button', { name: /Auswertung/ }).click();
  await expect(page.getByRole('button', { name: /^Sparkonto: Verlauf/ })).toHaveCount(0);
});

test('Einstellungen: kein Kontoname mehr, Backup-Erinnerung ohne 60 Tage, keine Budget-Aufteilung; Kategorien in Mehr', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Kategorien/ })).toBeVisible();
  await page.getByRole('button', { name: /Daten & Backup/ }).click();
  await expect(page.getByText(/Budget-Aufteilung/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Alle Kategorien/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '60 Tage' })).toHaveCount(0);
  await page.getByRole('radio', { name: '14 Tage' }).click();
  await expect(page.getByRole('radio', { name: '14 Tage' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Name des Alltagskontos')).toHaveCount(0);
  // Kopf wie auf der Übersicht: Monat groß, darüber dezent der Bereich
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect(page.locator('.kick').first()).toHaveText('Fixkosten');
  await expect(page.locator('h1').first()).toHaveText(/\w+ \d{4}/);
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await expect(page.locator('.kick').first()).toHaveText(/^Alltag · noch \d+ Tage?$/);
  await expect(page.locator('h1').first()).toHaveText(/\w+ \d{4}/);
});
