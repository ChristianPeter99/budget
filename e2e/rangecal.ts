import type { Locator } from '@playwright/test';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Im Zeitraum-Kalender zum Monat eines Datums blättern und den Tag antippen (Start bzw. Ende). */
export async function pickDay(scope: Locator, iso: string): Promise<void> {
  const want = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
  for (let guard = 0; guard < 80; guard++) {
    const [mn, yr] = (await scope.locator('.rcalnav b').innerText()).split(' ');
    const cur = Number(yr) * 12 + MONTHS.indexOf(mn!);
    if (cur === want) break;
    const yj = scope.getByRole('button', { name: cur > want ? 'Ein Jahr zurück' : 'Ein Jahr vor' });
    if (Math.abs(cur - want) >= 12 && await yj.count()) await yj.click();
    else await scope.getByRole('button', { name: cur > want ? 'Vorheriger Monat' : 'Nächster Monat' }).last().click();
  }
  await scope.getByRole('button', { name: `${Number(iso.slice(8, 10))}. ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`, exact: true }).click();
}
