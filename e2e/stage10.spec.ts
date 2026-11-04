import { expect, test } from '@playwright/test';

const CSV = `Buchungsdatum,Karteneinsatz,Betrag,Zahlungsempfänger,Verwendungszweck,Kategorie,Unterkategorie
21.10.2026,,"-49,99 €",Amazon,302-111 Amazon.de,Shopping,Online-Shopping
22.10.2026,,"-12,00 €",Amazon,302-222 Amazon.de,Shopping,Online-Shopping
25.10.2026,,"49,99 €",AMAZON PAYMENTS EUROPE,Erstattung 302-111,Weitere Einnahmen,Weitere Einnahmen
26.10.2026,,"-7,50 €",Tierbedarf Muster,,Weitere Ausgaben,Weitere Ausgaben
`;

async function openWith(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /CSV-Import/ }).click();
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'r.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
}

test('Import: Retoure landet als Paar unter „Weitere“ und zählt nicht als Ausgabe', async ({ page }) => {
  await openWith(page);
  await expect(page.getByRole('tab', { name: /Ausgaben 2/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Übernehmen' })).toContainText('2 ausgewählt · 19,50 €');
  await page.getByRole('tab', { name: /Weitere/ }).click();
  const ret = page.locator('.imp', { has: page.locator('b', { hasText: /^Retouren$/ }) });
  await expect(ret).toContainText('1 Rückbuchung');
  await ret.locator('.impchev').click();
  await expect(ret.locator('.improw').nth(0)).toContainText('Ausgabe · 21.10.');
  await expect(ret.locator('.improw').nth(1)).toContainText('Gutschrift · 25.10.');
  await expect(ret.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'false');
  await ret.getByRole('button', { name: /Details: AMAZON/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Ursprüngliche Ausgabe');
});

test('Import: neue Hauptkategorie mit Unterkategorie anlegen, erscheint in Mehr › Kategorien', async ({ page }) => {
  await openWith(page);
  const row = page.locator('.imp', { hasText: 'Tierbedarf' });
  await row.getByRole('button', { name: 'Kategorie wählen' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).not.toContainText('Ohne Unterkategorien');
  await dlg.getByRole('button', { name: /Neue Kategorie anlegen/ }).click();
  await dlg.getByLabel('Name der neuen Kategorie').fill('Haustier');
  await dlg.getByLabel('Erste Unterkategorie').fill('Futter');
  await dlg.getByRole('button', { name: 'Anlegen und zuordnen' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);
  await expect(row).toContainText('Haustier › Futter');
  await page.getByRole('button', { name: 'Abbrechen' }).first().click();
  await page.locator('.back', { hasText: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Kategorien/ }).click();
  await expect(page.locator('.card', { hasText: 'Haustier' })).toContainText('Futter');
  await expect(page.locator('.card', { hasText: 'Haustier' })).toContainText('Alltag');
});

test('Untere Leiste liegt vollständig im sichtbaren Bereich', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav').waitFor();
  for (const h of [844, 667, 932]) {
    await page.setViewportSize({ width: 390, height: h });
    const ok = await page.evaluate(() => { const r = document.querySelector('.nav')!.getBoundingClientRect(); return r.bottom <= window.innerHeight + 0.5 && r.top >= 0; });
    expect(ok, `Höhe ${h}`).toBe(true);
  }
});
