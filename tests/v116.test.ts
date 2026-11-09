import { describe, expect, it } from 'vitest';
import { monthAvailable } from '../src/domain/month';
import { DEFAULT_SETTINGS } from '../src/domain/types';
import type { Transaction } from '../src/domain/types';

const tx = (type: 'income' | 'expense', amountCents: number, categoryId = 'x'): Transaction =>
  ({ id: Math.random().toString(36), date: '2026-11-03', type, amountCents, categoryId, description: '', createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00Z' } as Transaction);

describe('Noch verfügbar (v1.16)', () => {
  it('ist Einnahmen minus alle Ausgaben; Alltag-Budget minus Alltag-Ausgaben ergibt dieselbe Zahl', () => {
    const s = { ...DEFAULT_SETTINGS, expectedIncomeCents: 300000 };
    const txs = [tx('income', 285000), tx('expense', 109712, 'fix'), tx('expense', 30000, 'spar'), tx('expense', 23455, 'alltag')];
    const av = monthAvailable(txs, s);
    expect(av.expected).toBe(false);
    expect(av.availableCents).toBe(285000 - 109712 - 30000 - 23455);
    const alltagBudget = av.availableCents + 23455; // so rechnet die Alltag-Ansicht
    expect(alltagBudget).toBe(285000 - 109712 - 30000);
    expect(alltagBudget - 23455).toBe(av.availableCents);
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
  it('zählt das Gehalt in künftigen Monaten erst, wenn es gebucht ist', () => {
    const s = { ...DEFAULT_SETTINGS, expectedIncomeCents: 300000 };
    expect(monthAvailable([], s, '2026-12', '2026-05', '2026-11')).toMatchObject({ expected: false, incomeCents: 0, availableCents: 0 });
    expect(monthAvailable([], s, '2026-11', '2026-05', '2026-11')).toMatchObject({ expected: true, incomeCents: 300000 });
    expect(monthAvailable([tx('income', 285000)], s, '2026-12', '2026-05', '2026-11')).toMatchObject({ expected: false, incomeCents: 285000 });
  });
});
