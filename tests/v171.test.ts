import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { exportAll, seedIfEmpty } from '../src/data/dataset';
import { demoData } from './demo';

describe('Erster Start ohne Daten (v1.71)', () => {
  it('legt nur Standard-Kategorien an – keine Buchungen, kein Gehalt, keine Fixkosten, keine Budgets', async () => {
    const db = await freshDb();
    expect(await seedIfEmpty(db)).toBe(true);
    const d = await exportAll(db);
    expect(d.transactions).toHaveLength(0);
    expect(d.recurring).toHaveLength(0);
    expect(d.budgets).toHaveLength(0);
    expect(d.settings.expectedIncomeCents).toBe(0);
    expect(d.categories.some((c) => c.name === 'Lebensmittel')).toBe(true);
    expect(d.categories.some((c) => c.name === 'Wohnen' && c.group === 'fix')).toBe(true);
    // zweiter Start legt nichts mehr an
    expect(await seedIfEmpty(db)).toBe(false);
  });
});

describe('Ausblick für künftige Monate (v1.71)', () => {
  it('rechnet Gehalt, Fixkosten und Sparrate aus den Vorlagen', async () => {
    const { monthOutlook } = await import('../src/domain/month');
    const s = demoData('2026-11');
    const o = monthOutlook(s.recurring, s.categories, s.settings, '2026-12');
    expect(o.incomeCents).toBe(285000);
    expect(o.sparCents).toBe(30000);
    expect(o.fixCents).toBeGreaterThan(0);
    // vor „Gilt ab“: nichts
    expect(monthOutlook(s.recurring, s.categories, s.settings, '2026-10')).toMatchObject({ incomeCents: 0, fixCents: 0, sparCents: 0 });
  });
});
