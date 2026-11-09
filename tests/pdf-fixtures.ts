/**
 * Erfundene Kontoauszüge als PDF in typischen Layouts – keine echten Daten.
 * Werden in den Tests erzeugt (pdf-lib), damit jede Variante genau bekannt ist.
 */
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

interface Ctx { page: PDFPage; font: PDFFont; bold: PDFFont }
const SIZE = 9;

/** Text links bei x; `words` = jedes Wort als eigener Schnipsel (wie viele echte PDFs) */
function left(c: Ctx, t: string, x: number, y: number, o: { bold?: boolean; words?: boolean; size?: number } = {}) {
  const font = o.bold ? c.bold : c.font, size = o.size ?? SIZE;
  if (!o.words) { c.page.drawText(t, { x, y, size, font }); return; }
  let cx = x;
  for (const w of t.split(' ')) { c.page.drawText(w, { x: cx, y, size, font }); cx += font.widthOfTextAtSize(w + ' ', size); }
}
/** Text rechtsbündig an der Kante r (Beträge) */
function right(c: Ctx, t: string, r: number, y: number, o: { bold?: boolean } = {}) {
  const font = o.bold ? c.bold : c.font;
  c.page.drawText(t, { x: r - font.widthOfTextAtSize(t, SIZE), y, size: SIZE, font });
}
async function newDoc() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}

export interface FixtureTx { date: string; cents: number; payee: string }

/**
 * A – „Sparkasse-artig“: zwei Seiten, Kopf- und Fußzeilen auf jeder Seite, Tabellenkopf „Datum / Erläuterung / Betrag“,
 * Buchungstext mehrzeilig (Vorgang, dann Empfänger, dann Zweck), Kontostand am Anfang und Ende, Wörter als Einzelschnipsel.
 */
export async function layoutA(o: { month?: number; open?: number } = {}): Promise<{ bytes: Uint8Array; txs: FixtureTx[]; open: number; close: number }> {
  const { doc, font, bold } = await newDoc();
  const mm = String(o.month ?? 10).padStart(2, '0');
  const txs: { d: string; type: string; payee: string; zweck: string; cents: number }[] = [
    { d: `01.${mm}.2026`, type: 'Lastschrift', payee: 'Stadtwerke Musterstadt', zweck: 'Abschlag Strom Kd-Nr 4711', cents: -8500 },
    { d: `02.${mm}.2026`, type: 'Kartenzahlung', payee: 'REWE Markt GmbH', zweck: 'Einkauf 01.10. girocard', cents: -4590 },
    { d: `05.${mm}.2026`, type: 'Gutschrift', payee: 'Muster GmbH', zweck: 'Lohn/Gehalt 10/2026', cents: 285000 },
    { d: `07.${mm}.2026`, type: 'Lastschrift', payee: 'Netflix International B.V.', zweck: 'Abo Oktober', cents: -1399 },
    { d: `09.${mm}.2026`, type: 'Kartenzahlung', payee: 'Aral Station 123', zweck: 'Tanken', cents: -6020 },
    { d: `12.${mm}.2026`, type: 'Überweisung', payee: 'Max Mustermann', zweck: 'Miete Oktober Wohnung 3', cents: -55000 },
    { d: `15.${mm}.2026`, type: 'Kartenzahlung', payee: 'dm-drogerie markt', zweck: '', cents: -1235 },
    { d: `18.${mm}.2026`, type: 'Lastschrift', payee: 'HUK-Coburg', zweck: 'Kfz-Versicherung Beitrag', cents: -3850 },
    { d: `21.${mm}.2026`, type: 'Kartenzahlung', payee: 'Bäckerei Schmidt', zweck: '', cents: -480 },
    { d: `25.${mm}.2026`, type: 'Kartenzahlung', payee: 'Starbucks Coffee', zweck: 'Kaffee', cents: -650 },
    { d: `28.${mm}.2026`, type: 'Dauerauftrag', payee: 'Sparkonto', zweck: 'Sparen monatlich', cents: -45000 },
    { d: `30.${mm}.2026`, type: 'Kartenzahlung', payee: 'Amazon EU S.a.r.l.', zweck: 'Bestellung 302-1234567', cents: -2999 }
  ];
  const open = o.open ?? 123456;
  const close = open + txs.reduce((a, t) => a + t.cents, 0);
  const eur = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100).toLocaleString('de-DE')},${String(Math.abs(c) % 100).padStart(2, '0')}`;
  const perPage = 7;
  for (let pi = 0; pi * perPage < txs.length; pi++) {
    const page = doc.addPage([595, 842]);
    const c: Ctx = { page, font, bold };
    left(c, 'Musterbank Musterstadt', 50, 800, { bold: true, size: 12 });
    left(c, `Kontoauszug ${mm}/2026  IBAN DE00 0000 0000 0000 0000 00`, 50, 780, { words: true });
    if (pi === 0) { left(c, `Kontostand am 01.${mm}.2026`, 50, 740, { words: true }); right(c, eur(open), 545, 740); }
    left(c, 'Datum', 50, 715, { bold: true }); left(c, 'Erläuterung', 120, 715, { bold: true }); right(c, 'Betrag', 545, 715, { bold: true });
    let y = 695;
    for (const t of txs.slice(pi * perPage, pi * perPage + perPage)) {
      left(c, t.d, 50, y); left(c, t.type, 120, y, { words: true }); right(c, eur(t.cents), 545, y);
      y -= 11; left(c, t.payee, 120, y, { words: true });
      if (t.zweck) { y -= 11; left(c, t.zweck, 120, y, { words: true }); }
      y -= 16;
    }
    if ((pi + 1) * perPage >= txs.length) { y -= 10; left(c, `Kontostand am 30.${mm}.2026`, 50, y, { words: true }); right(c, eur(close), 545, y); }
    left(c, `Seite ${pi + 1} von ${Math.ceil(txs.length / perPage)}`, 270, 40);
    left(c, 'Musterbank AG · Musterstraße 1 · 12345 Musterstadt · BIC MUSTDEFFXXX', 50, 28, { words: true, size: 7 });
  }
  return { bytes: await doc.save(), txs: txs.map((t) => ({ date: t.d, cents: t.cents, payee: t.payee })), open, close };
}

/**
 * B – „Direktbank-artig“: Spalten Buchung / Valuta / Vorgang / Betrag, Daten ohne Jahr („01.10.“), Vorgang und Empfänger
 * in einer Zeile, Beträge mit nachgestelltem Minus („45,90-“) und „+“ bei Eingängen, „Alter/Neuer Kontostand … H“.
 * Der Auszug läuft über den Jahreswechsel (Dezember/Januar).
 */
export async function layoutB(): Promise<{ bytes: Uint8Array; txs: FixtureTx[] }> {
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([595, 842]);
  const c: Ctx = { page, font, bold };
  left(c, 'Direktbank', 50, 800, { bold: true, size: 12 });
  left(c, 'Kontoauszug vom 15.12.2025 bis 14.01.2026', 50, 782);
  left(c, 'Alter Kontostand', 50, 760); right(c, '500,00 H', 545, 760);
  left(c, 'Buchung', 50, 735, { bold: true }); left(c, 'Valuta', 100, 735, { bold: true }); left(c, 'Vorgang', 150, 735, { bold: true }); right(c, 'Betrag EUR', 545, 735, { bold: true });
  const rows: [string, string, string, string, number][] = [
    ['20.12.', '19.12.', 'Kartenzahlung REWE SAGT DANKE 4711', '45,90-', -4590],
    ['24.12.', '24.12.', 'Gutschrift Oma Erna Weihnachten', '+100,00', 10000],
    ['02.01.', '31.12.', 'Lastschrift Telekom Deutschland GmbH', '39,95-', -3995],
    ['10.01.', '10.01.', 'Überweisung Max Mustermann Konzertkarten', '60,00-', -6000]
  ];
  let y = 715;
  for (const [b, v, t, a] of rows) { left(c, b, 50, y); left(c, v, 100, y); left(c, t, 150, y); right(c, a, 545, y); y -= 14; }
  const close = 50000 + rows.reduce((s, r) => s + r[4], 0);
  left(c, 'Neuer Kontostand', 50, y - 10); right(c, `${Math.floor(close / 100)},${String(close % 100).padStart(2, '0')} H`, 545, y - 10);
  const year = (d: string) => (d.endsWith('.12.') ? '2025' : '2026');
  return { bytes: await doc.save(), txs: rows.map((r) => ({ date: r[0] + year(r[0]), cents: r[4], payee: '' })) };
}

/**
 * C – Soll/Haben/Saldo: getrennte Spalten ohne Vorzeichen, laufender Saldo rechts, Seitenübertrag,
 * Tabellenkopf wiederholt sich auf Seite 2.
 */
export async function layoutC(): Promise<{ bytes: Uint8Array; txs: FixtureTx[]; open: number; close: number }> {
  const { doc, font, bold } = await newDoc();
  const all: [string, string, number][] = [
    ['03.11.2026', 'Kartenzahlung Edeka Center', -2310],
    ['04.11.2026', 'Gehalt Muster GmbH', 300000],
    ['06.11.2026', 'Lastschrift Vodafone', -2999],
    ['08.11.2026', 'Kartenzahlung Shell Tankstelle', -5500],
    ['11.11.2026', 'Überweisung Miete November', -60000],
    ['13.11.2026', 'Kartenzahlung Lidl', -1875]
  ];
  const open = 20000;
  let bal = open;
  const eur = (c: number) => `${Math.floor(Math.abs(c) / 100).toLocaleString('de-DE')},${String(Math.abs(c) % 100).padStart(2, '0')}`;
  for (let pi = 0; pi < 2; pi++) {
    const page = doc.addPage([595, 842]);
    const c: Ctx = { page, font, bold };
    left(c, 'Volksbank Muster eG', 50, 800, { bold: true, size: 12 });
    if (pi === 0) { left(c, 'Saldo alt', 50, 760); right(c, eur(open), 545, 760); }
    else { left(c, 'Übertrag von Seite 1', 50, 760); right(c, eur(bal), 545, 760); }
    left(c, 'Datum', 50, 735, { bold: true }); left(c, 'Text', 120, 735, { bold: true });
    right(c, 'Soll', 400, 735, { bold: true }); right(c, 'Haben', 470, 735, { bold: true }); right(c, 'Saldo', 545, 735, { bold: true });
    let y = 715;
    for (const [d, t, ct] of all.slice(pi * 3, pi * 3 + 3)) {
      bal += ct;
      left(c, d, 50, y); left(c, t, 120, y);
      right(c, eur(ct), ct < 0 ? 400 : 470, y);
      right(c, eur(bal), 545, y);
      y -= 14;
    }
    if (pi === 0) { left(c, 'Übertrag auf Seite 2', 50, y - 8); right(c, eur(bal), 545, y - 8); }
    else { left(c, 'Saldo neu', 50, y - 8); right(c, eur(bal), 545, y - 8); }
    left(c, `Blatt ${pi + 1}/2`, 500, 40);
  }
  return { bytes: await doc.save(), txs: all.map((r) => ({ date: r[0], cents: r[2], payee: '' })), open, close: bal };
}

/** D – ohne Tabellenkopf, Betrag und Kennzeichen „S“/„H“ in getrennten Feldern, kein Kontostand */
export async function layoutD(): Promise<{ bytes: Uint8Array; txs: FixtureTx[] }> {
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([595, 842]);
  const c: Ctx = { page, font, bold };
  left(c, 'Umsatzliste', 50, 800, { bold: true });
  const rows: [string, string, string, string, number][] = [
    ['05.11.2026', 'Kartenzahlung Kaufland', '23,45', 'S', -2345],
    ['06.11.2026', 'Rückzahlung Freundin', '15,00', 'H', 1500],
    ['07.11.2026', 'Kartenzahlung Rossmann', '7,99', 'S', -799]
  ];
  let y = 760;
  for (const [d, t, a, s] of rows) { left(c, d, 50, y); left(c, t, 130, y); right(c, a, 520, y); left(c, s, 530, y); y -= 14; }
  return { bytes: await doc.save(), txs: rows.map((r) => ({ date: r[0], cents: r[4], payee: '' })) };
}

/** Ein PDF ohne Text (wie eingescannt): nur ein Rechteck */
export async function scanned(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawRectangle({ x: 50, y: 50, width: 400, height: 600 });
  return doc.save();
}

/**
 * E – Betrag erst in der letzten Zeile des Blocks; Text Zeichen für Zeichen gesetzt (manche PDF-Erzeuger);
 * Kopfzeile mit Datum („Erstellt am …“) darf keine Buchung werden.
 */
export async function layoutE(): Promise<{ bytes: Uint8Array; txs: FixtureTx[] }> {
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([595, 842]);
  const c: Ctx = { page, font, bold };
  left(c, '15.11.2026 Erstellt am', 50, 800);
  const chars = (t: string, x: number, y: number) => { let cx = x; for (const ch of t) { page.drawText(ch, { x: cx, y, size: SIZE, font }); cx += font.widthOfTextAtSize(ch, SIZE); } };
  const rows: [string, string, string, string, number][] = [
    ['01.11.2026', 'Kartenzahlung', 'ALDI SUED Filiale 12', '-12,34', -1234],
    ['03.11.2026', 'Gutschrift', 'Erstattung Krankenkasse', '80,00', 8000]
  ];
  let y = 760;
  for (const [d, t, p, a] of rows) {
    left(c, d, 50, y); chars(t, 130, y);
    y -= 11; left(c, p, 130, y); right(c, a, 545, y);
    y -= 18;
  }
  return { bytes: await doc.save(), txs: rows.map((r) => ({ date: r[0], cents: r[4], payee: r[2] })) };
}
