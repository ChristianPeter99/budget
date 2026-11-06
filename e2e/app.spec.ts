import { expect, test } from '@playwright/test';

test('Buchung per Zahlenfeld anlegen, bleibt nach Neuladen erhalten und funktioniert offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of ['1', '2', ',', '3', '4']) await page.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Betrag', exact: true })).toHaveText('12,34 €');
  await page.getByRole('dialog').getByRole('button', { name: 'Lebensmittel', exact: true }).click();
  await page.getByRole('button', { name: 'Kantine', exact: true }).click();
  await page.getByPlaceholder('Optional').fill('E2E-Test');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Buchung gespeichert' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Alltag', exact: true }).click();
  await expect(page.getByText('12,34 €').first()).toBeVisible();
});

test('Reiter: Übersicht, Alltag, Fixkosten, Mehr ohne horizontales Scrollen', async ({ page }) => {
  await page.goto('/');
  for (const tab of ['Übersicht', 'Alltag', 'Fixkosten', 'Mehr']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, tab).toBe(false);
  }
  await page.getByRole('button', { name: /Auswertung/ }).click();
  await expect(page.getByText('Letzte 12 Monate')).toBeVisible();
});

async function addBooking(page: import('@playwright/test').Page, digits: string[], sub: string, note: string) {
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click(); await page.getByRole('button', { name: 'Neue Buchung' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Betrag', exact: true }).click();
  for (const k of digits) await page.getByRole('group', { name: 'Zahlenfeld' }).getByRole('button', { name: k, exact: true }).click();
  await page.getByRole('dialog').locator('.chip:not(.recent)').filter({ hasText: /^Lebensmittel$/ }).click();
  await page.getByRole('dialog').locator('.chip:not(.recent)').filter({ hasText: new RegExp(`^${sub}$`) }).click();
  await page.getByPlaceholder('Optional').fill(note);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.sheetwrap')).toHaveCount(0);
}

test('Buchungen: Wischen über einer Buchung blättert zu Alltag; Löschen per Tippen mit Rückgängig; Mehrfachauswahl', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['5'], 'Kantine', 'Wisch-A');
  await addBooking(page, ['6'], 'Bäcker', 'Wisch-B');
  await addBooking(page, ['7'], 'Bäcker', 'Wisch-C');
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  if (await ok.count()) await ok.first().click();
  await expect(page.locator('.fline')).toContainText(/\d+ Buchungen/);
  await expect(page.locator('.fline')).not.toContainText('€');
  const row = page.locator('.swipe .item', { hasText: 'Wisch-A' });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  // nach links wischen über einer Buchung → nächster Reiter (Fixkosten), kein Löschen
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width - 20 - i * 20, box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.locator('nav').getByRole('button', { name: 'Fixkosten' })).toHaveAttribute('aria-current', 'page');
  await page.locator('nav').getByRole('button', { name: 'Buchungen' }).click();
  await expect(page.getByText('Wisch-A')).toBeVisible();
  // Löschen: antippen → Buchung löschen
  await page.locator('.swipe .item', { hasText: 'Wisch-A' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Buchung löschen' }).click();
  await expect(page.getByText('Wisch-A')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByText('Wisch-A')).toBeVisible();

  await page.getByRole('button', { name: 'Auswählen' }).click();
  await page.locator('.swipe .item', { hasText: 'Wisch-B' }).click();
  await page.locator('.swipe .item', { hasText: 'Wisch-C' }).click();
  await expect(page.getByText('2 ausgewählt')).toBeVisible();
  await page.getByRole('button', { name: 'Löschen …' }).click();
  await page.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(page.getByText('Wisch-B')).toHaveCount(0);
  await expect(page.getByText('Wisch-C')).toHaveCount(0);
  await expect(page.getByText('Wisch-A')).toBeVisible();
});

test('Alltag: Unterkategorie aufklappen zeigt die einzelnen Buchungen', async ({ page }) => {
  await page.goto('/');
  await addBooking(page, ['4', '2'], 'Kantine', 'Mittag');
  await page.getByRole('button', { name: 'Alltag', exact: true }).click();
  await page.getByRole('button', { name: /Buchungen Kantine aufklappen/ }).click();
  await expect(page.locator('.drill').getByText('Mittag')).toBeVisible();
});

test('Depot erfassen mit Tausenderpunkten und Verlauf in der Auswertung', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Sparen & Depot/ }).click();
  await page.locator('.wtile', { hasText: 'Depot' }).click();
  await page.getByRole('button', { name: 'Stand aktualisieren' }).click();
  await page.getByLabel('Neuer Depotstand').fill('123456');
  await expect(page.getByLabel('Neuer Depotstand')).toHaveValue('123.456');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog').locator('.wbigval')).toHaveText(/123\.456\s€/);
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();
  await expect(page.locator('.whero .mid34', { hasText: '123.456 €' })).toBeVisible();
  await page.getByRole('button', { name: 'Zurück' }).or(page.getByRole('button', { name: 'Mehr' }).first()).first().click();
  await page.getByRole('button', { name: /Auswertung/ }).click();
  await page.getByRole('button', { name: /^Depot: Verlauf/ }).click();
  await expect(page.getByRole('img', { name: /Depotverlauf/ })).toBeVisible();
});

test('Update von Schema 2 im echten Browser: Daten bleiben, Depotwert wird Verlaufseintrag', async ({ page }) => {
  await page.goto('/manifest.webmanifest');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('budget-app', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      const t = db.createObjectStore('transactions', { keyPath: 'id' }); t.createIndex('by-date', 'date'); t.createIndex('by-category', 'categoryId');
      db.createObjectStore('categories', { keyPath: 'id' }); db.createObjectStore('budgets', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'key' }); db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('recurring', { keyPath: 'id' }); db.createObjectStore('recurringRuns', { keyPath: 'key' }).createIndex('by-recurring', 'recurringId');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['categories', 'transactions', 'settings', 'meta', 'budgets'], 'readwrite');
      tx.objectStore('categories').put({ id: 'leb', name: 'Lebensmittel', kind: 'expense', group: 'alltag', parentId: null, archived: false, sort: 0, createdAt: 'x' });
      tx.objectStore('categories').put({ id: 'bar', name: 'Bargeld', kind: 'expense', group: 'alltag', parentId: null, archived: false, sort: 1, createdAt: 'x' });
      tx.objectStore('budgets').put({ id: 'b', scope: 'category', monthKey: 'default', categoryId: 'bar', amountCents: 10000 });
      const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-02`;
      tx.objectStore('transactions').put({ id: 't1', date: iso, type: 'expense', amountCents: 4711, categoryId: 'leb', description: 'Altbestand', createdAt: 'x' });
      tx.objectStore('settings').put({ key: 'app', value: { expectedIncomeCents: 317200, depotCents: 10000000, split: { fix: 40, alltag: 40, spar: 15 } } });
      tx.objectStore('meta').put({ key: 'seeded', value: true });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Alltag', exact: true }).click();
  await expect(page.locator('.kick').first()).toContainText('Alltag');
  await expect(page.getByText('47,11 €').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('button', { name: /Sparen & Depot/ }).click();
  await expect(page.locator('.wtile', { hasText: 'Depot' })).toContainText('100.000 €');
});
