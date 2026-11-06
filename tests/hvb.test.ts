import { describe, expect, it } from 'vitest';
import sample from './fixtures/hvb-beispiel.csv?raw';
import { parseStatement, payeeFromZweck } from '../src/import/csv';

describe('CSV-Import: HypoVereinsbank/UniCredit (Tabulator, Verwendungszweck ohne Empfänger-Spalte)', () => {
  it('liest Datum, Betrag, Händler und blendet Kartennummern aus', async () => {
    const r = await parseStatement(sample);
    expect(r.format).toBe('hvb');
    expect(r.skippedLines).toBe(0);
    expect(r.candidates).toHaveLength(3);
    const [a, b, c] = r.candidates;
    expect(a).toMatchObject({ date: '2025-12-30', bookingDate: '2026-01-02', amountCents: 1596, kind: 'expense', payee: 'Rossmann', detail: '' });
    expect(b).toMatchObject({ date: '2025-12-30', amountCents: 129, kind: 'expense', payee: 'Alnatura' });
    expect(c).toMatchObject({ date: '2026-01-05', amountCents: 250000, kind: 'credit' });
    expect(c!.payee).toMatch(/^Muster Arbeitgeber/);
    for (const x of r.candidates) {
      expect(JSON.stringify(x)).not.toMatch(/\d{4,6}\*+\d{2,4}/);
      expect(JSON.stringify(x)).not.toContain('12345678');
    }
  });
  it('Händlername aus dem Verwendungszweck', () => {
    expect(payeeFromZweck('EC-GAA/POS Edeka Huber 4711 Seeheim      DEU1 Belegdatum 01.02.2026  -3,00 EUR Seeheim')).toBe('Edeka Huber');
    expect(payeeFromZweck('EC-GAA/POS Aral Station 0815 Starnberg   DEU2 Belegdatum 01.02.2026 Starnberg')).toBe('Aral Station');
  });
});
