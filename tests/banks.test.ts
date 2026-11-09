import { describe, expect, it } from 'vitest';
import { NeedsMapping, detectLayout, parseSignedAmount, parseStatement, parseDate } from '../src/domain/statement';
import { EMPTY_MAP } from '../src/domain/statement';

// Erfundene Beispielzeilen im Aufbau verschiedener Banken (keine echten Daten)
const pick = async (text: string) => (await parseStatement(text)).candidates.map((c) => [c.date, c.kind, c.amountCents, c.payee]);

describe('CSV verschiedener Banken', () => {
  it('Sparkasse (CAMT-CSV, Semikolon, Anführungszeichen)', async () => {
    const t = `"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"
"DE00123";"03.01.26";"03.01.26";"KARTENZAHLUNG";"2026-01-02 Debitk.1 VISA";"EDEKA MUELLER";"DE00999";"BYLADEM1";"-23,45";"EUR";"Umsatz gebucht"
"DE00123";"30.12.25";"30.12.25";"GUTSCHR. UEBERWEISUNG";"Lohn 12/2025";"Muster AG";"DE00888";"BYLADEM1";"2.345,67";"EUR";"Umsatz gebucht"`;
    expect(await pick(t)).toEqual([['2026-01-03', 'expense', 2345, 'EDEKA MUELLER'], ['2025-12-30', 'credit', 234567, 'Muster']]);
  });
  it('DKB (Vorspann, getrennte Spalten für Zahlende und Empfänger, „Betrag (€)“)', async () => {
    const t = `"Girokonto";"DE00 1234"
"Zeitraum:";"01.12.2025 - 05.01.2026"

"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"
"02.01.26";"02.01.26";"Gebucht";"Max Muster";"Netflix International B.V.";"Abo";"Ausgang";"NL00";"-13,99";"";"";""
"31.12.25";"31.12.25";"Gebucht";"Firma Beispiel GmbH";"Max Muster";"Gehalt";"Eingang";"DE00";"2.000,00";"";"";""`;
    expect(await pick(t)).toEqual([['2026-01-02', 'expense', 1399, 'Netflix International'], ['2025-12-31', 'credit', 200000, 'Firma Beispiel']]);
  });
  it('ING (Vorspann, Saldo-Spalte wird nicht als Betrag genommen)', async () => {
    const t = `Umsatzanzeige;Datei erstellt am: 05.01.2026 10:00
IBAN;DE00 5000
Kontoname;Girokonto

Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung
02.01.2026;02.01.2026;REWE Markt GmbH;Lastschrift;REWE SAGT DANKE;1.234,56;EUR;-45,10;EUR`;
    expect(await pick(t)).toEqual([['2026-01-02', 'expense', 4510, 'REWE Markt']]);
  });
  it('comdirect (Händler steht im Buchungstext)', async () => {
    const t = `"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR";
"02.01.2026";"02.01.2026";"Lastschrift / Belastung";"Auftraggeber: Stadtwerke Muster GmbH Buchungstext: Abschlag Strom Ref. 123";"-80,00";`;
    expect(await pick(t)).toEqual([['2026-01-02', 'expense', 8000, 'Stadtwerke Muster']]);
  });
  it('Deutsche Bank (Soll und Haben in getrennten Spalten)', async () => {
    const t = `Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;IBAN;BIC;Kundenreferenz;Mandatsreferenz ;Gläubiger ID;Fremde Gebühren;Betrag;Abweichender Empfänger;Anzahl der Aufträge;Anzahl der Schecks;Soll;Haben;Währung
02.01.2026;02.01.2026;Lastschrift;Muster Versicherung AG;Beitrag;DE00;X;;;;;;;;;-12,50;;EUR
03.01.2026;03.01.2026;Gutschrift;Erika Muster;Geschenk;DE00;X;;;;;;;;;;50,00;EUR`;
    expect(await pick(t)).toEqual([['2026-01-02', 'expense', 1250, 'Muster Versicherung'], ['2026-01-03', 'credit', 5000, 'Erika Muster']]);
  });
  it('Volksbank alt (Betrag immer positiv, Kennzeichen S/H in unbenannter letzter Spalte)', async () => {
    const t = `Buchungstag;Valuta;Auftraggeber/Zahlungsempfänger;Empfänger/Zahlungspflichtiger;Konto-Nr.;IBAN;BLZ;BIC;Vorgang/Verwendungszweck;Kundenreferenz;Währung;Umsatz;
02.01.2026;02.01.2026;Max Muster;Bäckerei Huber;;DE00;;;Kartenzahlung;;EUR;3,20;S
02.01.2026;02.01.2026;Max Muster;Arbeitgeber;;DE00;;;Lohn;;EUR;1.800,00;H`;
    const r = await pick(t);
    expect(r[0]).toEqual(['2026-01-02', 'expense', 320, expect.any(String)]);
    expect(r[1]?.slice(0, 3)).toEqual(['2026-01-02', 'credit', 180000]);
  });
  it('N26 (englisch, Komma, Punkt als Dezimalzeichen)', async () => {
    const t = `"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"
2026-01-02,2026-01-02,"Spotify AB",,"Presentment",-,"Hauptkonto",-10.99,,,`;
    expect(await pick(t)).toEqual([['2026-01-02', 'expense', 1099, 'Spotify']]);
  });
  it('Revolut (Datum mit Uhrzeit, Händler in „Description“)', async () => {
    const t = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-01-02 10:33:00,2026-01-03 09:00:00,Lidl,-7.45,0.00,EUR,COMPLETED,100.00`;
    const r = await pick(t);
    expect(r[0]?.slice(0, 3)).toEqual(['2026-01-02', 'expense', 745]);
    expect(r[0]?.[3]).toBe('Lidl');
  });
  it('Unbekannte Spaltennamen → Spalten aus dem Inhalt erraten', async () => {
    const t = `Tag|Text|Wert`.replace(/\|/g, ';') + `\n02.01.2026;Bioladen Sonnenschein Einkauf;-12,30\n03.01.2026;Kino am Markt Ticket;-9,00`;
    expect(await pick(t)).toEqual([['2026-01-02', 'expense', 1230, expect.stringContaining('Bioladen')], ['2026-01-03', 'expense', 900, expect.stringContaining('Kino')]]);
  });
  it('Nicht erkennbar → fragt nach der Zuordnung; mit Zuordnung klappt es', async () => {
    const t = `a;b;c\nx;y;z\n1;2;3`;
    await expect(parseStatement(t)).rejects.toThrow('Spalten für Datum und Betrag');
    const t2 = `A;B;C;D\n02.01.2026;03.01.2026;12;100\n03.01.2026;04.01.2026;9;91`;
    await expect(parseStatement(t2)).rejects.toBeInstanceOf(NeedsMapping);
    const r2 = await parseStatement(t2, { ...EMPTY_MAP, booking: 0, amount: 2 });
    expect(r2.candidates.map((c) => [c.date, c.kind, c.amountCents])).toEqual([['2026-01-02', 'credit', 1200], ['2026-01-03', 'credit', 900]]);
    const t3 = `K1;K2;K3\n12/31/2025;Laden;12.34-\n01/02/2026;Shop;1,000.00-`;
    const l = detectLayout(t3);
    const r = await parseStatement(t3, { ...EMPTY_MAP, booking: 0, payee: 1, amount: 2 });
    expect(r.candidates.map((c) => [c.date, c.amountCents])).toEqual([['2025-12-31', 1234], ['2026-01-02', 100000]]);
    expect(l.columns).toBe(3);
  });
  it('Beträge und Daten in vielen Schreibweisen', () => {
    expect(parseSignedAmount('1,234.56')).toBe(123456);
    expect(parseSignedAmount('-1.234,56 €')).toBe(-123456);
    expect(parseSignedAmount('(15,96)')).toBe(-1596);
    expect(parseSignedAmount('15.96-')).toBe(-1596);
    expect(parseDate('2026/01/02')).toBe('2026-01-02');
    expect(parseDate('30/12/2025')).toBe('2025-12-30');
    expect(parseDate('12/31/2025')).toBe('2025-12-31');
    expect(parseDate('20260102')).toBe('2026-01-02');
  });
});
