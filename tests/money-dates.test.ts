import { describe, expect, it } from 'vitest';
import { centsToInput, formatEUR, parseCents, percentOf } from '../src/domain/money';
import { daysInMonth, daysLeftInMonth, isValidISODate, isValidMonthKey, monthRange, shiftMonth, toISODate } from '../src/domain/dates';

describe('Geldbeträge als Cent', () => {
  it('parst gültige Eingaben ohne Rundungsfehler', () => {
    expect(parseCents('12,50')).toBe(1250);
    expect(parseCents('12,5')).toBe(1250);
    expect(parseCents('1.234,56')).toBe(123456);
    expect(parseCents('1234.56')).toBe(123456);
    expect(parseCents('1.234')).toBe(123400);
    expect(parseCents('0,01')).toBe(1);
    expect(parseCents('19,99 €')).toBe(1999);
    // typische Gleitkomma-Fallen
    expect(parseCents('0,29')).toBe(29);
    expect(parseCents('1,15')).toBe(115);
    expect(parseCents('4,35')).toBe(435);
  });
  it('weist ungültige Eingaben zurück', () => {
    for (const bad of ['', ' ', 'abc', '-5', '+5', '0', '0,00', '12,345', '1,2,3', '1..2', ',5', '99999999999', '12 34 56,789'])
      expect(parseCents(bad), bad).toBeNull();
  });
  it('formatiert deutsch', () => {
    expect(formatEUR(123456)).toBe('1.234,56 €');
    expect(formatEUR(5)).toBe('0,05 €');
    expect(formatEUR(0)).toBe('0,00 €');
    expect(formatEUR(-1050)).toBe('−10,50 €');
    expect(centsToInput(1250)).toBe('12,50');
  });
  it('rechnet Prozente in ganzen Cent', () => {
    expect(percentOf(285000, 40)).toBe(114000);
    expect(percentOf(285000, 15)).toBe(42750);
    expect(Number.isInteger(percentOf(333, 33))).toBe(true);
  });
});

describe('Datum und Monatsgrenzen', () => {
  it('erkennt Schaltjahre', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(daysInMonth('2000-02')).toBe(29);
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-04-31')).toBe(false);
    expect(isValidISODate('26-04-01')).toBe(false);
    expect(isValidMonthKey('2026-00')).toBe(false);
  });
  it('wechselt Monate über den Jahreswechsel', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-10', -12)).toBe('2025-10');
    expect(shiftMonth('2026-01', -13)).toBe('2024-12');
  });
  it('liefert korrekte Monatsgrenzen', () => {
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
  it('verwendet lokale Kalendertage, keine UTC-Umrechnung', () => {
    // 31.10. 23:30 Ortszeit muss der 31.10. bleiben, egal in welcher Zeitzone der Test läuft
    expect(toISODate(new Date(2026, 9, 31, 23, 30))).toBe('2026-10-31');
    expect(toISODate(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
  it('zählt Resttage', () => {
    expect(daysLeftInMonth('2026-10', '2026-10-27')).toBe(5);
    expect(daysLeftInMonth('2026-09', '2026-10-27')).toBe(0);
    expect(daysLeftInMonth('2026-11', '2026-10-27')).toBe(30);
  });
});

describe('Datums-Texte mit festen Formatierern', () => {
  it('liefern dasselbe wie toLocaleDateString, auch bei ungültigen Werten', async () => {
    const { monthLabel, monthShort, dayLabel, weekdayLong } = await import('../src/domain/dates');
    const old = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('de-DE', o);
    for (let i = 0; i < 400; i += 7) {
      const d = new Date(2025, 0, 1 + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expect(monthLabel(iso.slice(0, 7))).toBe(old(new Date(d.getFullYear(), d.getMonth(), 1), { month: 'long', year: 'numeric' }));
      expect(monthShort(iso.slice(0, 7))).toBe(old(new Date(d.getFullYear(), d.getMonth(), 1), { month: 'short' }).replace('.', ''));
      expect(dayLabel(iso, '2030-01-01')).toBe(old(d, { weekday: 'short', day: 'numeric', month: 'short' }));
      expect(weekdayLong(iso)).toBe(old(d, { weekday: 'long', day: 'numeric', month: 'long' }));
    }
    // Jahr statt Monat bzw. Unsinn: wie früher kein Fehler
    expect(monthLabel('2026')).toBe(old(new Date(2026, -1, 1), { month: 'long', year: 'numeric' }));
    expect(monthLabel('abcd-ef')).toBe(old(new Date(NaN), { month: 'long', year: 'numeric' }));
  });
});
