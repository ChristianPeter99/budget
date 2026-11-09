import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layoutA, layoutC, scanned } from '../tests/pdf-fixtures';

const openImport = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: /^Import/ }).click();
};
const upload = (page: import('@playwright/test').Page, name: string, bytes: Uint8Array) =>
  page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });

test('PDF-Import: Kontoauszug lesen, Kontostand-Kontrolle, Buchungen übernehmen', async ({ page }) => {
  await openImport(page);
  await expect(page.getByText('Einen oder mehrere Kontoauszüge als CSV oder PDF einlesen')).toBeVisible();
  await upload(page, 'auszug-10-2026.pdf', (await layoutA()).bytes);
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await expect(page.locator('.pdfcheck.ok')).toContainText('Kontostand stimmt');
  // Empfänger aus der zweiten Zeile des Buchungstextes, Beträge mit Vorzeichen
  await expect(page.locator('.imp', { hasText: 'REWE Markt' }).first()).toContainText('45,90');
  // Fixkosten erkannt? (Monatsauszug: einmalige Zahlungen) – mindestens die Alltag-Liste ist gefüllt
  const alltag = page.getByRole('tab', { name: /^Alltag/ });
  await expect(alltag).toBeVisible();
  // alles übernehmen (ohne Kategorie → Sonstiges)
  await page.locator('.selbar').getByRole('button', { name: 'Übernehmen' }).click();
  const ask = page.getByRole('dialog', { name: 'Ohne Kategorie' });
  if (await ask.count()) await ask.getByRole('button', { name: /Sonstiges/ }).click();
  await expect(page.locator('.toast')).toContainText('übernommen');
});

test('PDF-Import: Spalten neu zuordnen und als Bankvorlage speichern', async ({ page }) => {
  await openImport(page);
  const bytes = (await layoutC()).bytes;
  await upload(page, 'vb.pdf', bytes);
  await expect(page.locator('.pdfcheck.ok')).toBeVisible();
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Spalten neu zuordnen' }).click();
  // dieselbe Zuordnungs-Ansicht wie bei CSV, mit den Spalten aus dem PDF
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Empfänger · Edeka Center');
  await page.getByLabel('Name der Bank').fill('Volksbank Muster');
  await page.getByRole('button', { name: /Übernehmen|Weiter/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  // nächster Auszug: Vorlage wird am Aufbau erkannt
  await upload(page, 'vb2.pdf', bytes);
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await expect(page.locator('.kick').first()).toContainText('Volksbank Muster');
});

test('PDF-Import: eingescannt → verständlicher Hinweis, nichts geändert', async ({ page }) => {
  await openImport(page);
  await upload(page, 'scan.pdf', await scanned());
  await expect(page.getByRole('alert')).toContainText('keinen lesbaren Text');
});

test('PDF-Import: passwortgeschützt – Passwort abfragen, falsches erkennen, nicht speichern', async ({ page }) => {
  let qpdf = true;
  try { execFileSync('qpdf', ['--version']); } catch { qpdf = false; }
  test.skip(!qpdf, 'qpdf nicht installiert');
  const dir = mkdtempSync(join(tmpdir(), 'pdfpw-'));
  writeFileSync(join(dir, 'a.pdf'), (await layoutA()).bytes);
  execFileSync('qpdf', ['--encrypt', 'geheim', 'owner', '256', '--', join(dir, 'a.pdf'), join(dir, 'b.pdf')]);
  await openImport(page);
  await upload(page, 'geschuetzt.pdf', new Uint8Array(readFileSync(join(dir, 'b.pdf'))));
  const sh = page.getByRole('dialog', { name: 'PDF-Passwort' });
  await expect(sh).toContainText('nicht gespeichert');
  await sh.getByLabel('PDF-Passwort').fill('falsch');
  await sh.getByRole('button', { name: 'Öffnen' }).click();
  await expect(sh).toContainText('stimmt nicht');
  await sh.getByLabel('PDF-Passwort').fill('geheim');
  await sh.getByRole('button', { name: 'Öffnen' }).click();
  await expect(page.locator('.pdfcheck.ok')).toBeVisible();
  // Passwort landet nirgends im Speicher
  const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  expect(stored).not.toContain('geheim');
});

const pdfFile = (name: string, bytes: Uint8Array) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });

test('Mehrere Auszüge auf einmal: ein Passwort für alle, doppelte nur einmal, unlesbare übersprungen', async ({ page }) => {
  let qpdf = true;
  try { execFileSync('qpdf', ['--version']); } catch { qpdf = false; }
  test.skip(!qpdf, 'qpdf nicht installiert');
  const okt = await layoutA();
  const nov = await layoutA({ month: 11, open: okt.close });
  const dir = mkdtempSync(join(tmpdir(), 'pdfmulti-'));
  const enc = (name: string, bytes: Uint8Array) => {
    writeFileSync(join(dir, name), bytes);
    execFileSync('qpdf', ['--encrypt', 'geheim', 'owner', '256', '--', join(dir, name), join(dir, 'e-' + name)]);
    return new Uint8Array(readFileSync(join(dir, 'e-' + name)));
  };
  await openImport(page);
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles([
    pdfFile('nov.pdf', enc('nov.pdf', nov.bytes)), pdfFile('okt.pdf', enc('okt.pdf', okt.bytes)),
    pdfFile('okt-kopie.pdf', okt.bytes), pdfFile('scan.pdf', await scanned())
  ]);
  // nur einmal nach dem Passwort gefragt
  const sh = page.getByRole('dialog', { name: 'PDF-Passwort' });
  await expect(sh).toContainText('nov.pdf');
  await sh.locator('input[type=password]').fill('geheim');
  await sh.getByRole('button', { name: 'Öffnen' }).click();
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await expect(sh).toHaveCount(0);
  await expect(page.locator('.kick').first()).toContainText('3 Kontoauszüge');
  await expect(page.locator('.pdfcheck.ok')).toContainText('Kontostand stimmt in allen 3 Auszügen');
  await expect(page.locator('.pdfcheck.warn')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('scan.pdf: ');
  await expect(page.locator('main')).toContainText('12 Buchungen stehen in mehreren Auszügen');
  await page.locator('.selbar').getByRole('button', { name: 'Übernehmen' }).click();
  const ask = page.getByRole('dialog', { name: 'Ohne Kategorie' });
  if (await ask.count()) await ask.getByRole('button', { name: /Sonstiges/ }).click();
  await expect(page.locator('.toast')).toContainText('übernommen');
  const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  expect(stored).not.toContain('geheim');
});

test('Mehrere Auszüge: fehlender Monat dazwischen wird bemerkt; Datei ohne Zuordnung überspringen', async ({ page }) => {
  const okt = await layoutA();
  const dez = await layoutA({ month: 12, open: okt.close + 77700 });
  await openImport(page);
  await page.getByLabel('Kontoauszug (CSV oder PDF)').setInputFiles([
    { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('A;B;C;D\n02.01.2026;03.01.2026;12;100\n03.01.2026;04.01.2026;9;91\n') },
    pdfFile('okt.pdf', okt.bytes), pdfFile('dez.pdf', dez.bytes)
  ]);
  // unbekannter Aufbau: Zuordnung wird gefragt – abbrechen überspringt nur diese Datei
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen' })).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen' }).first().click();
  await expect(page.getByRole('heading', { name: 'Prüfen & zuordnen' })).toBeVisible();
  await expect(page.locator('.kick').first()).toContainText('2 Kontoauszüge');
  await expect(page.locator('main')).toContainText('x.csv: übersprungen');
  await expect(page.locator('.pdfcheck.warn')).toContainText('Zwischen „okt.pdf“ und „dez.pdf“ fehlt ein Auszug?');
});
