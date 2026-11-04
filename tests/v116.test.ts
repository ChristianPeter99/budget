import { describe, expect, it } from 'vitest';
import { monthAvailable } from '../src/domain/calc';
import { DEFAULT_SETTINGS } from '../src/domain/types';
import type { Transaction } from '../src/domain/types';

const tx = (type: 'income' | 'expense', amountCents: number, categoryId = 'x'): Transaction =>
  ({ id: Math.random().toString(36), date: '2026-11-03', type, amountCents, categoryId, description: '', createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00Z' } as Transaction);

describe('Noch verfügbar (v1.16)', () => {
  it('ist Einnahmen minus alle Ausgaben; Alltag-Budget minus Alltag-Ausgaben ergibt dieselbe Zahl', () => {
    const s = { ...DEFAULT_SETTINGS, expectedIncomeCents: 300000 };
    const txs = [tx('income', 317200), tx('expense', 141472, 'fix'), tx('expense', 47600, 'spar'), tx('expense', 19190, 'alltag')];
    const av = monthAvailable(txs, s);
    expect(av.expected).toBe(false);
    expect(av.availableCents).toBe(317200 - 141472 - 47600 - 19190);
    const alltagBudget = av.availableCents + 19190; // so rechnet die Alltag-Ansicht
    expect(alltagBudget).toBe(317200 - 141472 - 47600);
    expect(alltagBudget - 19190).toBe(av.availableCents);
  });
  it('nutzt das hinterlegte Gehalt, solange keine Einnahme gebucht ist', () => {
    const av = monthAvailable([tx('expense', 5000)], { ...DEFAULT_SETTINGS, expectedIncomeCents: 300000 });
    expect(av).toMatchObject({ expected: true, incomeCents: 300000, availableCents: 295000 });
    expect(monthAvailable([], DEFAULT_SETTINGS)).toMatchObject({ expected: false, incomeCents: 0, availableCents: 0 });
  });
  it('nimmt das erwartete Gehalt erst ab „Gilt ab“ der Gehalts-Vorlage an', () => {
    const s = { ...DEFAULT_SETTINGS, expectedIncomeCents: 300000 };
    expect(monthAvailable([tx('expense', 5000)], s, '2026-04', '2026-05')).toMatchObject({ expected: false, incomeCents: 0, availableCents: -5000 });
    expect(monthAvailable([tx('expense', 5000)], s, '2026-05', '2026-05')).toMatchObject({ expected: true, incomeCents: 300000 });
  });
});
