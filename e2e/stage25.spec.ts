import { expect, test } from '@playwright/test';
import { demoStorage } from '../tests/demo';
import { createRequire } from 'node:module';
// PNG-Leser aus Playwright (für eine Pixelprüfung)
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle') as { PNG: { sync: { read: (b: Buffer) => { data: Buffer } } } };

// Kacheln sind der Standard – hier ohne die Listen-Voreinstellung der übrigen Tests
test.use({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [demoStorage()] }] } });

test('Alltag: Kategorien als Kacheln; Tipp klappt auf (nur eine), Umschalter Liste/Kacheln wird gemerkt', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  const tiles = page.locator('.catgrid .ctile');
  await expect(tiles.first()).toBeVisible();
  const n = await tiles.count();
  expect(n).toBeGreaterThan(3);
  // Kacheln: kein „Alle zuklappen“, dafür Umschalter
  await expect(page.getByRole('button', { name: /Alle (zu|auf)klappen/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Als Liste anzeigen' })).toBeVisible();
  // zwei pro Zeile
  // nach dem Einblenden (Kacheln poppen kurz nacheinander auf)
  await expect.poll(async () => { const a = (await tiles.nth(0).boundingBox())!, b = (await tiles.nth(1).boundingBox())!; return Math.abs(a.y - b.y); }).toBeLessThan(2);
  const b0 = (await tiles.nth(0).boundingBox())!, b1 = (await tiles.nth(1).boundingBox())!;
  expect(b1.x).toBeGreaterThan(b0.x + b0.width - 2);
  // Tipp: Unterkategorien unter der Zeile, über die volle Breite
  await page.getByRole('button', { name: /^Lebensmittel, / }).click();
  const panel = page.locator('.cpanel');
  await expect(panel).toHaveCount(1);
  await expect(panel).toContainText('Einkaufen');
  const pb = (await panel.boundingBox())!, t0 = (await tiles.nth(0).boundingBox())!;
  expect(pb.width).toBeGreaterThan(t0.width * 1.8);
  expect(pb.y).toBeGreaterThan(t0.y + t0.height - 2);
  // andere Kachel: nur eine offen
  await page.getByRole('button', { name: /^Auto, / }).click();
  await expect(panel).toHaveCount(1);
  await expect(panel).toContainText('Benzin');
  await expect(panel).not.toContainText('Einkaufen');
  // gleiche Kachel nochmal: zu
  await page.getByRole('button', { name: /^Auto, / }).click();
  await expect(panel).toHaveCount(0);
  // Liste: wie bisher, mit „Alle zuklappen“
  await page.getByRole('button', { name: 'Als Liste anzeigen' }).click();
  await expect(page.locator('.catgrid')).toHaveCount(0);
  await expect(page.locator('.ghead', { hasText: 'Lebensmittel' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Alle (zu|auf)klappen/ })).toBeVisible();
  // gemerkt (nur für Alltag)
  await page.reload();
  await page.locator('nav').getByRole('button', { name: 'Alltag' }).click();
  await expect(page.locator('.ghead', { hasText: 'Lebensmittel' })).toBeVisible();
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect(page.locator('.catgrid .ctile').first()).toBeVisible();
});

test('Fixkosten: Kachel gedrückt halten und ziehen sortiert im Raster; Positionen im aufgeklappten Bereich', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  const tiles = page.locator('.catgrid .ctile');
  await expect(tiles.first()).toBeVisible();
  const names = async () => (await tiles.locator('.cname').allTextContents());
  const before = await names();
  expect(before.length).toBeGreaterThanOrEqual(3);
  // erste Kachel auf den Platz der dritten (zweite Zeile links)
  await tiles.nth(2).scrollIntoViewIfNeeded();
  const a = (await tiles.nth(0).boundingBox())!, c = (await tiles.nth(2).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await expect(tiles.nth(0)).toHaveClass(/lifted/);
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 12 });
  await page.mouse.up();
  const expected = [before[1], before[2], before[0], ...before.slice(3)];
  await expect.poll(names).toEqual(expected);
  // nach dem Ziehen keine Kachel aufgeklappt
  await expect(page.locator('.cpanel')).toHaveCount(0);
  await page.reload();
  await page.locator('nav').getByRole('button', { name: 'Fixkosten' }).click();
  await expect.poll(names).toEqual(expected);
  // aufklappen: Positionen, Tipp öffnet die Vorlage
  await tiles.filter({ hasText: 'Wohnen' }).click();
  await expect(page.locator('.cpanel')).toContainText('Miete');
  await page.locator('.cpanel').getByRole('button', { name: /^Miete/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

for (const w of [375, 390]) {
  test(`Buchungen: Suchfeld passt in seine Box (${w} px), Lupe sichtbar`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 844 });
    await page.goto('/');
    await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
    const box = (await page.locator('label.search').boundingBox())!;
    const inp = (await page.getByRole('searchbox', { name: 'Suchen' }).boundingBox())!;
    const ico = (await page.locator('label.search > svg').boundingBox())!;
    expect(inp.x + inp.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    expect(ico.width).toBeGreaterThan(16);
    expect(ico.x).toBeGreaterThanOrEqual(box.x);
    // Feld nutzt die volle Höhe der Box (iOS beschneidet sonst den Text)
    expect(inp.height).toBeGreaterThan(box.height - 2);
  });
}

test('Buchungen (wie auf dem Home-Bildschirm, --edge 14px): Tageszeile deckt das Suchfeld nicht ab; beim Scrollen bleibt der Streifen oben dicht', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // Randabstand der installierten App (display-mode: standalone) nachstellen
  await page.addStyleTag({ content: ':root{--edge:14px !important}' });
  // offline bereit (früher kam hier eine Meldung, die alles verschob – gibt es nicht mehr)
  await page.evaluate(async () => { await navigator.serviceWorker?.ready; });
  await page.waitForTimeout(300);
  await expect(page.getByText('offline nutzbar')).toHaveCount(0);
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await page.waitForTimeout(500);
  const box = (await page.locator('label.search').boundingBox())!;
  // unterer Rand des Suchfelds sichtbar: Pixel 3 px über der Unterkante hat die Farbe des Feldes, nicht Schwarz
  const shot = await page.screenshot({ clip: { x: box.x + box.width / 2, y: box.y + box.height - 3, width: 1, height: 1 } });
  const px = PNG.sync.read(shot).data;
  expect(px[0]! + px[1]! + px[2]!).toBeGreaterThan(20);
  // gescrollt: über der klebenden Tageszeile liegt der schwarze Streifen
  await page.locator('main').evaluate((m) => m.scrollBy(0, 400));
  await page.waitForTimeout(200);
  const cover = await page.evaluate(() => { const c = document.querySelector('.topcover')!.getBoundingClientRect(); const d = [...document.querySelectorAll('.dayh')].map((e) => e.getBoundingClientRect().top).find((t) => t >= 0 && t < 40); return { h: c.height, stuck: d }; });
  expect(cover.h).toBeGreaterThanOrEqual(14);
  expect(Math.abs((cover.stuck ?? -99) - cover.h)).toBeLessThan(1.5);
});

test('Kacheln beim Wischen zur Seite: nicht schon in der Vorschau sichtbar, kein zweites Einblenden auf der echten Seite', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1200);
  // Deckkraft der ersten Kachel in Vorschau und echter Seite Bild für Bild mitschreiben
  await page.evaluate(() => {
    const w = window as unknown as { rec: [string, number][] };
    w.rec = [];
    const t0 = performance.now();
    const f = () => {
      const g = document.querySelector('.pageghost .ctile'), v = document.querySelector('.view .ctile');
      if (g) w.rec.push(['g', Number(getComputedStyle(g).opacity)]);
      if (v) w.rec.push(['v', Number(getComputedStyle(v).opacity)]);
      if (performance.now() - t0 < 2000) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const y = 500, x0 = 330;
  await page.mouse.move(x0, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x0 - i * 22, y); await page.waitForTimeout(30); }
  // während des Ziehens: Kacheln der Vorschau unsichtbar
  const during = await page.evaluate(() => (window as unknown as { rec: [string, number][] }).rec.filter((r) => r[0] === 'g').map((r) => r[1]));
  expect(during.length).toBeGreaterThan(0);
  expect(Math.max(...during)).toBe(0);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const rec = await page.evaluate(() => (window as unknown as { rec: [string, number][] }).rec);
  const real = rec.filter((r) => r[0] === 'v').map((r) => r[1]);
  const ghostMax = Math.max(...rec.filter((r) => r[0] === 'g').map((r) => r[1]));
  expect(real.length).toBeGreaterThan(0);
  // echte Seite setzt dort fort, wo die Vorschau war – fällt nicht wieder auf 0 zurück
  expect(real[0]!).toBeGreaterThanOrEqual(Math.min(ghostMax, 0.5));
  expect(real.at(-1)).toBe(1);
});
