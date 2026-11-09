import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractItems, moneyOf, pdfToTable, PdfPasswordNeeded } from '../src/data/pdf';
import { mergeCandidates, parseStatement } from '../src/domain/statement';
import type { Candidate } from '../src/domain/statement';
import { layoutA, layoutB, layoutC, layoutD, layoutE, scanned } from './pdf-fixtures';

const read = async (bytes: Uint8Array, pw?: string) => pdfToTable(await extractItems(pdfjs, new Uint8Array(bytes), pw));

describe('PDF-Kontoauszug → Buchungen', () => {
  it('Beträge: Vorzeichen davor/dahinter, S/H, Währung', () => {
    expect(moneyOf('-1.234,56')).toEqual({ cents: 123456, side: -1 });
    expect(moneyOf('45,90-')).toEqual({ cents: 4590, side: -1 });
    expect(moneyOf('+100,00')).toEqual({ cents: 10000, side: 1 });
    expect(moneyOf('500,00 H')).toEqual({ cents: 50000, side: 1 });
    expect(moneyOf('12,00 S')).toEqual({ cents: 1200, side: -1 });
    expect(moneyOf('-45,90 €')).toEqual({ cents: 4590, side: -1 });
    expect(moneyOf('2.850,00 EUR')).toEqual({ cents: 285000, side: 0 });
    expect(moneyOf('4711')).toBeNull();
    expect(moneyOf('01.10.2026')).toBeNull();
  });

  it('A: zwei Seiten, mehrzeiliger Text, Kopf-/Fußzeilen, Kontrollrechnung stimmt', async () => {
    const f = await layoutA();
    const t = await read(f.bytes);
    expect(t.pages).toBe(2);
    expect(t.rows.map((r) => [r.booking, r.cents])).toEqual(f.txs.map((x) => [x.date, x.cents]));
    expect(t.rows.map((r) => r.payee)).toEqual(f.txs.map((x) => x.payee));
    expect(t.rows[0]).toMatchObject({ type: 'Lastschrift', zweck: 'Abschlag Strom Kd-Nr 4711' });
    expect(t.rows[2]).toMatchObject({ type: 'Gutschrift', cents: 285000, zweck: 'Lohn/Gehalt 10/2026' });
    // keine Kopf-/Fußzeile ist als Text in eine Buchung gerutscht
    expect(t.rows.some((r) => /seite|musterbank|bic/i.test(`${r.payee} ${r.zweck}`))).toBe(false);
    expect(t.balance).toEqual({ openCents: f.open, closeCents: f.close });
    expect(t.diffCents).toBe(0);
  });

  it('A: läuft danach durch den gewohnten CSV-Weg (Empfänger, Zweck, Ein-/Ausgang)', async () => {
    const t = await read((await layoutA()).bytes);
    const res = await parseStatement(t.text);
    expect(res.candidates).toHaveLength(12);
    const rewe = res.candidates.find((c) => /rewe/i.test(c.payee))!;
    expect(rewe).toMatchObject({ amountCents: 4590, kind: 'expense', date: '2026-10-02' });
    expect(res.candidates.find((c) => c.amountCents === 285000)!.kind).toBe('credit');
  });

  it('B: Daten ohne Jahr über den Jahreswechsel, nachgestelltes Minus, „+“, Kontostand mit „H“', async () => {
    const f = await layoutB();
    const t = await read(f.bytes);
    expect(t.rows.map((r) => [r.booking, r.cents])).toEqual(f.txs.map((x) => [x.date, x.cents]));
    expect(t.rows[0]).toMatchObject({ value: '19.12.2025', type: 'Kartenzahlung', payee: 'REWE SAGT DANKE 4711' });
    expect(t.rows[2]!.value).toBe('31.12.2025');
    expect(t.diffCents).toBe(0);
  });

  it('C: Soll/Haben-Spalten ohne Vorzeichen, laufender Saldo, Übertrag zwischen den Seiten', async () => {
    const f = await layoutC();
    const t = await read(f.bytes);
    expect(t.rows.map((r) => [r.booking, r.cents])).toEqual(f.txs.map((x) => [x.date, x.cents]));
    expect(t.balance).toEqual({ openCents: f.open, closeCents: f.close });
    expect(t.diffCents).toBe(0);
    expect(t.text.split('\n')[0]).toContain('Soll');
  });

  it('D: ohne Tabellenkopf, „S“/„H“ als eigenes Feld, ohne Kontostand → keine Kontrollrechnung', async () => {
    const f = await layoutD();
    const t = await read(f.bytes);
    expect(t.rows.map((r) => [r.booking, r.cents])).toEqual(f.txs.map((x) => [x.date, x.cents]));
    expect(t.diffCents).toBeNull();
  });

  it('E: Betrag erst in der letzten Zeile, Text Zeichen für Zeichen, Datum in der Kopfzeile', async () => {
    const f = await layoutE();
    const t = await read(f.bytes);
    expect(t.rows.map((r) => [r.booking, r.cents, r.type, r.payee])).toEqual([
      ['01.11.2026', -1234, 'Kartenzahlung', 'ALDI SUED Filiale 12'],
      ['03.11.2026', 8000, 'Gutschrift', 'Erstattung Krankenkasse']
    ]);
  });

  it('Buchungstext mit „Saldo“/„Übertrag“ bleibt eine Buchung; nur Zeilen, die damit beginnen, sind Kontostände', () => {
    const it2 = (s: string, x: number, y: number) => ({ s, x, y, w: s.length * 4.5, h: 9 });
    const t = pdfToTable([[
      it2('Alter Kontostand', 50, 800), it2('100,00', 520, 800),
      it2('02.11.2026', 50, 780), it2('Überweisung Saldo-Ausgleich Kreditkarte', 120, 780), it2('-40,00', 520, 780),
      it2('03.11.2026', 50, 765), it2('Lastschrift Übertrag Depot', 120, 765), it2('-10,00', 520, 765),
      it2('Neuer Kontostand', 50, 740), it2('50,00', 520, 740)
    ]]);
    expect(t.rows.map((r) => r.cents)).toEqual([-4000, -1000]);
    expect(t.diffCents).toBe(0);
  });

  it('zwei Betragsspalten ohne Kopf: nimmt die Deutung, bei der der Kontostand aufgeht (Betrag + gelegentlicher Saldo)', () => {
    const it2 = (s: string, x: number, y: number) => ({ s, x, y, w: s.length * 4.5, h: 9 });
    const R = (s: string, r: number, y: number) => it2(s, r - s.length * 4.5, y);
    const t = pdfToTable([[
      it2('Saldo alt', 50, 800), R('500,00', 520, 800),
      it2('02.11.2026', 50, 780), it2('Kartenzahlung Bäcker', 120, 780), R('-5,00', 450, 780),
      it2('02.11.2026', 50, 765), it2('Kartenzahlung Kiosk', 120, 765), R('-15,00', 450, 765), R('480,00', 520, 765),
      it2('04.11.2026', 50, 750), it2('Gutschrift Erstattung', 120, 750), R('20,00', 450, 750),
      it2('05.11.2026', 50, 735), it2('Kartenzahlung Kino', 120, 735), R('-12,00', 450, 735), R('488,00', 520, 735),
      it2('Saldo neu', 50, 710), R('488,00', 520, 710)
    ]]);
    expect(t.rows.map((r) => r.cents)).toEqual([-500, -1500, 2000, -1200]);
    expect(t.diffCents).toBe(0);
  });

  it('Währung als eigenes Feld hinter dem Betrag („-12,00  EUR“)', () => {
    const it2 = (s: string, x: number, y: number) => ({ s, x, y, w: s.length * 4.5, h: 9 });
    const t = pdfToTable([[it2('04.11.2026', 50, 780), it2('Kartenzahlung Kiosk', 120, 780), it2('-12,00', 480, 780), it2('EUR', 530, 780)]]);
    expect(t.rows.map((r) => [r.cents, r.payee])).toEqual([[-1200, 'Kiosk']]);
  });

  it('meldet eine Lücke, wenn eine Buchung fehlt (Kontrollrechnung)', async () => {
    const f = await layoutA();
    const items = await extractItems(pdfjs, new Uint8Array(f.bytes));
    // eine Buchungszeile (REWE, 45,90) entfernen: Datum und Betrag fehlen dann
    const cut = items.map((p) => p.filter((i) => !(i.s === '02.10.2026' || i.s === '-45,90')));
    const t = pdfToTable(cut);
    expect(t.diffCents).toBe(-4590);
  });

  it('eingescanntes PDF ohne Text: verständlicher Hinweis', async () => {
    await expect(read(await scanned())).rejects.toThrow(/keinen lesbaren Text/);
  });

  it('kein PDF: verständlicher Hinweis', async () => {
    await expect(read(new TextEncoder().encode('kein pdf'))).rejects.toThrow(/lässt sich nicht lesen/);
  });

  it('passwortgeschützt: fragt nach dem Passwort, falsches Passwort wird erkannt', async () => {
    let qpdf = true;
    try { execFileSync('qpdf', ['--version']); } catch { qpdf = false; }
    if (!qpdf) return; // ohne qpdf (z. B. auf dem Build-Server) wird dieser Fall übersprungen
    const dir = mkdtempSync(join(tmpdir(), 'pdfpw-'));
    writeFileSync(join(dir, 'a.pdf'), (await layoutD()).bytes);
    execFileSync('qpdf', ['--encrypt', 'geheim', 'owner', '256', '--', join(dir, 'a.pdf'), join(dir, 'b.pdf')]);
    const enc = new Uint8Array(readFileSync(join(dir, 'b.pdf')));
    await expect(read(enc)).rejects.toMatchObject({ name: 'PdfPasswordNeeded', wrong: false });
    await expect(read(enc, 'falsch')).rejects.toBeInstanceOf(PdfPasswordNeeded);
    await expect(read(enc, 'falsch')).rejects.toMatchObject({ wrong: true });
    expect((await read(enc, 'geheim')).rows).toHaveLength(3);
  });
});

describe('mehrere Auszüge zusammenführen', () => {
  const c = (key: string, bookingDate: string, amountCents: number, kind: Candidate['kind'] = 'expense') =>
    ({ key, bookingDate, date: bookingDate, amountCents, kind }) as Candidate;
  it('hängt aufeinanderfolgende Auszüge aneinander', () => {
    const r = mergeCandidates([[c('a', '2026-10-01', 100), c('b', '2026-10-30', 200)], [c('c', '2026-11-02', 100)]]);
    expect(r.candidates.map((x) => x.key)).toEqual(['a', 'b', 'c']);
    expect(r.dupes).toBe(0);
  });
  it('derselbe Auszug zweimal: jede Buchung nur einmal', () => {
    const l = [c('a', '2026-10-01', 100), c('b', '2026-10-01', 100)];
    const r = mergeCandidates([l, l]);
    expect(r.candidates).toHaveLength(2);
    expect(r.dupes).toBe(2);
  });
  it('überlappende Zeiträume (PDF und CSV): gleiche Buchung im Überlappungsbereich zählt einmal, außerhalb bleibt sie', () => {
    const pdf = [c('p1', '2026-10-01', 500), c('p2', '2026-10-20', 900)];
    const csv = [c('x1', '2026-10-20', 900), c('x2', '2026-10-20', 900), c('x3', '2026-11-05', 500)];
    const r = mergeCandidates([pdf, csv]);
    // eine der beiden 9-€-Buchungen vom 20.10. war schon im PDF, die zweite ist neu; 05.11. liegt außerhalb
    expect(r.candidates.map((x) => x.key)).toEqual(['p1', 'p2', 'x2', 'x3']);
    expect(r.dupes).toBe(1);
  });
  it('Ein- und Ausgang mit gleichem Betrag am gleichen Tag sind verschieden', () => {
    const r = mergeCandidates([[c('a', '2026-10-01', 100, 'expense'), c('z', '2026-10-31', 1)], [c('b', '2026-10-01', 100, 'credit')]]);
    expect(r.candidates).toHaveLength(3);
  });
  it('Folgemonat: Kontostand des Vormonats passt zum Anfang des nächsten', async () => {
    const okt = await layoutA();
    const nov = await layoutA({ month: 11, open: okt.close });
    const t = await read(nov.bytes);
    expect(t.balance.openCents).toBe(okt.close);
    expect(t.rows[0]!.booking).toBe('01.11.2026');
    expect(t.diffCents).toBe(0);
  });
});
