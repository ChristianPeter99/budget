import { expect, type Page } from '@playwright/test';
import { monthLabel, shiftMonth } from '../src/domain/dates';

/** Monat über die Monatsauswahl wechseln (Tipp auf die Überschrift) – delta Monate vor/zurück. */
export async function stepMonth(page: Page, delta: number) {
  const head = page.getByRole('button', { name: /, Monat wählen$/ }).first();
  const from = (await head.getAttribute('data-month'))!;
  const to = shiftMonth(from, delta);
  await head.click();
  const dlg = page.getByRole('dialog', { name: 'Monat' });
  for (let y = Number(from.slice(0, 4)); y !== Number(to.slice(0, 4)); y += y < Number(to.slice(0, 4)) ? 1 : -1) {
    await dlg.getByRole('button', { name: y < Number(to.slice(0, 4)) ? 'Nächstes Jahr' : 'Vorheriges Jahr' }).click();
  }
  await dlg.getByRole('button', { name: new RegExp(`^${monthLabel(to)}`) }).click();
  await expect(page.getByRole('dialog', { name: 'Monat' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /, Monat wählen$/ }).first()).toHaveAttribute('data-month', to);
}

/** „Heute“ in der Monatsauswahl */
export async function backToToday(page: Page) {
  await page.getByRole('button', { name: /, Monat wählen$/ }).first().click();
  await page.getByRole('dialog', { name: 'Monat' }).getByRole('button', { name: 'Heute' }).click();
}
