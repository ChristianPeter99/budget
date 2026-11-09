import { expect, test } from '@playwright/test';
import { currentMonthKey, monthLabel, shiftMonth } from '../src/domain/dates';

test('Monatsauswahl: Tipp auf den Monat, Ausgaben je Monat, Jahr blättern, „Heute“', async ({ page }) => {
  await page.goto('/');
  const cur = currentMonthKey();
  const head = page.getByRole('button', { name: /, Monat wählen$/ });
  // keine Pfeile mehr im Kopf
  await expect(page.getByRole('button', { name: 'Vorheriger Monat' })).toHaveCount(0);
  await expect(head).toHaveAttribute('data-month', cur);
  await head.click();
  const dlg = page.getByRole('dialog', { name: 'Monat' });
  await expect(dlg.locator('.mpcell')).toHaveCount(12);
  // aktueller Monat gewählt und mit Ausgaben (Beispieldaten)
  const now = dlg.getByRole('button', { name: new RegExp(`^${monthLabel(cur)}`) });
  await expect(now).toHaveAttribute('aria-current', 'date');
  await expect(now).toHaveAccessibleName(/(übrig|im Minus)$/);
  // gleicher Betrag wie „Noch verfügbar“ im Ring (dort mit Cent)
  const ring = (await page.locator('.ovcenter').first().textContent())!;
  const cents = Number(/(−?-?[\d.]+,\d\d) €/.exec(ring)![1]!.replace(/[.−-]/g, '').replace(',', '')) * (/[−-]\d/.test(ring) ? -1 : 1);
  const euro = Math.round(Math.abs(cents) / 100).toLocaleString('de-DE');
  await expect(now.locator('small')).toHaveText(`${cents < 0 ? '−' : ''}${euro} €`);
  await expect(now.locator('small')).toHaveClass(cents < 0 ? /neg/ : /pos/);
  // ein Jahr zurück, dort einen Monat wählen
  const target = `${Number(cur.slice(0, 4)) - 1}-03`;
  await dlg.getByRole('button', { name: 'Vorheriges Jahr' }).click();
  await expect(dlg.locator('.mpyear b')).toHaveText(target.slice(0, 4));
  await dlg.getByRole('button', { name: new RegExp(`^${monthLabel(target)}`) }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(monthLabel(target));
  // Heute: zurück zum aktuellen Monat
  await head.click();
  await dlg.getByRole('button', { name: 'Heute' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(monthLabel(cur));
  // Wischen im Kopf blättert weiterhin einen Monat
  const box = (await page.locator('.hd').first().boundingBox())!;
  await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(monthLabel(shiftMonth(cur, 1)));
});

test('Monatsauswahl: Fixkosten zeigen Fixkosten-Summen, Buchungen im Jahresmodus wählen ein Jahr', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  await nav.getByRole('button', { name: 'Fixkosten' }).click();
  await page.getByRole('button', { name: /, Monat wählen$/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Monat' });
  // auch hier „Noch verfügbar“ (dieselbe Zahl wie in der Übersicht)
  await expect(dlg.locator('.mpcell.on small')).toHaveText(/\d.*€/);
  await dlg.getByRole('button', { name: 'Heute' }).click();
  await nav.getByRole('button', { name: 'Buchungen' }).click();
  await page.getByRole('button', { name: 'Filter' }).click();
  const fdlg = page.getByRole('dialog');
  await fdlg.getByRole('radio', { name: 'Jahr' }).click();
  await fdlg.getByRole('button', { name: /anzeigen/ }).click();
  const y = page.getByRole('button', { name: /, Jahr wählen$/ });
  await y.click();
  const ydlg = page.getByRole('dialog', { name: 'Jahr' });
  await expect(ydlg.locator('.mpcell')).toHaveCount(9);
  const prev = String(Number(currentMonthKey().slice(0, 4)) - 1);
  await ydlg.getByRole('button', { name: new RegExp(`^${prev}`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(prev);
});
