import { expect, test, type Page } from '@playwright/test';

async function drag(page: Page, x: number, y0: number, dy: number, dx = 0) {
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.mouse.move(x + dx, y0 + dy, { steps: 12 });
  await page.mouse.up();
}

test('Übersicht: Monatsauswahl steigt beim Ziehen von unten auf (Hintergrund unscharf); loslassen öffnet oder gleitet zurück', async ({ page }) => {
  await page.goto('/');
  const dlg = page.getByRole('dialog', { name: 'Monat' });
  const drop = page.locator('.drop');
  const ring = (await page.locator('.ovcenter').first().boundingBox())!;
  const x = ring.x + ring.width / 2;
  // nach oben: nichts
  await drag(page, x, ring.y + 100, -150);
  await expect(drop).toHaveCount(0);
  // während des Ziehens: Panel schon teilweise da, Hintergrund unscharf
  await page.mouse.move(x, ring.y); await page.mouse.down();
  await page.mouse.move(x, ring.y + 90, { steps: 8 });
  await expect(drop).toHaveCount(1);
  const p = Number(await drop.evaluate((e) => getComputedStyle(e).getPropertyValue('--p')));
  expect(p).toBeGreaterThan(0.1); expect(p).toBeLessThan(0.4);
  const blur = await page.locator('.dbd').evaluate((e) => getComputedStyle(e).backdropFilter);
  expect(blur).toMatch(/blur\((?!0px)/);
  // langsam loslassen bei kurzer Strecke: gleitet zurück
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect(drop).toHaveCount(0);
  // weit genug: bleibt offen
  await drag(page, x, ring.y, 220);
  await expect(dlg).toBeVisible();
  await expect(drop).toHaveClass(/open/);
  await dlg.getByRole('button', { name: 'Heute' }).click();
  await expect(drop).toHaveCount(0);
  // unten am Rand (Einhand) – nach unten wischen schließt
  await drag(page, x, ring.y, 220);
  await expect(drop).toHaveClass(/open/);
  const pan = (await page.locator('.dpanel').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.round(pan.y + pan.height)).toBe(vp.height);
  await drag(page, pan.x + pan.width / 2, pan.y + 10, 220);
  await expect(drop).toHaveCount(0);
  // auf den unscharfen Hintergrund (oben) tippen schließt
  await drag(page, x, ring.y, 220);
  await expect(drop).toHaveClass(/open/);
  await page.mouse.click(x, 60);
  await expect(drop).toHaveCount(0);
  // Monat wählen
  await drag(page, x, ring.y, 220);
  await expect(drop).toHaveClass(/open/);
  await dlg.locator('.mpyear').getByRole('button', { name: 'Vorheriges Jahr' }).click();
  const y = String(new Date().getFullYear() - 1);
  await dlg.getByRole('button', { name: new RegExp(`^Juni ${y}`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Juni ${y}`);
});

test.describe('mit Touch', () => {
  test.use({ hasTouch: true });
  test('Übersicht: Ziehen per Finger öffnet die Monatsauswahl; waagerecht bleibt Seitenwechsel', async ({ page }) => {
    await page.goto('/');
    const cdp = await page.context().newCDPSession(page);
    const touch = async (x: number, y: number, dx: number, dy: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const dlg = page.getByRole('dialog', { name: 'Monat' });
    const ring = (await page.locator('.ovcenter').first().boundingBox())!;
    await touch(ring.x + ring.width / 2, ring.y, 0, 170);
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Heute' }).click();
    await expect(dlg).toHaveCount(0);
    // waagerecht: keine Monatsauswahl
    await touch(ring.x + ring.width - 10, ring.y, -200, 20);
    await page.waitForTimeout(400);
    await expect(dlg).toHaveCount(0);
  });
});

test('Übersicht: Bereich gewählt → Ziehen öffnet nichts; Tipp auf freie Fläche zurück zu „Noch verfügbar“', async ({ page }) => {
  await page.goto('/');
  const dlg = page.getByRole('dialog', { name: 'Monat' });
  const reset = page.locator('.ovreset');
  await page.locator('.ovcorner', { hasText: 'Fixkosten' }).click();
  await expect(reset).toHaveAttribute('aria-label', 'Zurück zur Gesamtansicht');
  // freie Fläche links neben dem Ring
  const ring = (await page.locator('.ovsvg').boundingBox())!;
  await drag(page, ring.x + 8, ring.y + 8, 160);
  await page.waitForTimeout(400);
  await expect(dlg).toHaveCount(0);
  // ziehen hat die Auswahl nicht aufgehoben
  await expect(reset).toHaveAttribute('aria-label', 'Zurück zur Gesamtansicht');
  // Tipp auf ein anderes Ringstück wechselt nur den Bereich
  await page.locator('.ovcorner', { hasText: 'Sparen' }).click();
  await expect(page.locator('.ovcorner', { hasText: 'Sparen' })).not.toHaveClass(/dim/);
  await expect(reset).toHaveAttribute('aria-label', 'Zurück zur Gesamtansicht');
  // freie Fläche unter dem Inhalt (über der Leiste unten)
  const content = (await page.locator('.ovswipe').boundingBox())!;
  await page.mouse.click(content.x + content.width / 2, content.y + content.height + 24);
  await expect(reset).toHaveAttribute('aria-label', 'Noch verfügbar');
  // jetzt klappt Ziehen wieder
  await drag(page, ring.x + 8, ring.y + 8, 160);
  await expect(dlg).toBeVisible();
});
