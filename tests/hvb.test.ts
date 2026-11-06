import { describe, expect, it } from 'vitest';
import sample from './fixtures/hvb-beispiel.csv?raw';
import { decodeBytes, parseStatement, payeeFromZweck } from '../src/import/csv';

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
  const rows = sample.trim().split('\n').slice(1);
  const expectTwo = async (text: string) => {
    const r = await parseStatement(text);
    expect(r.candidates.map((c) => [c.payee, c.amountCents, c.date])).toEqual([
      ['Rossmann', 1596, '2025-12-30'], ['Alnatura', 129, '2025-12-30'], [expect.stringMatching(/^Muster Arbeitgeber/), 250000, '2026-01-05']
    ]);
  };
  it('Semikolon mit Anführungszeichen', async () => {
    const q = (f: string) => `"${f.replace(/"/g, '""')}"`;
    await expectTwo(['Kontonummer;Buchungsdatum;Valuta;Verwendungszweck;Betrag;Waehrung', ...rows.map((l) => l.split('\t').map(q).join(';'))].join('\r\n'));
  });
  it('ohne Kopfzeile: Spalten nach Position (Kontonummer, Buchungsdatum, Valuta, Verwendungszweck, Betrag, Währung)', async () => {
    await expectTwo(rows.join('\n'));
    await expectTwo(rows.map((l) => l.split('\t').join(';')).join('\n'));
  });
  it('Vorspann vor der Kopfzeile', async () => {
    await expectTwo('Umsätze Girokonto\nZeitraum: 01.12.2025 - 05.01.2026\n\n' + sample);
  });
  it('UTF-16 (Excel „Unicode-Text“) mit und ohne BOM, Windows-1252', async () => {
    const u16 = (t: string, bom: boolean) => { const a = new Uint8Array((bom ? 2 : 0) + t.length * 2); if (bom) { a[0] = 0xff; a[1] = 0xfe; } for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a[(bom ? 2 : 0) + i * 2] = c & 255; a[(bom ? 2 : 0) + i * 2 + 1] = c >> 8; } return a.buffer; };
    await expectTwo(decodeBytes(u16(sample, true)));
    await expectTwo(decodeBytes(u16(sample, false)));
    const latin = new Uint8Array([...'Verwendungszweck: Überweisung'].map((c) => c.charCodeAt(0)));
    expect(decodeBytes(latin.buffer)).toBe('Verwendungszweck: Überweisung');
  });
});