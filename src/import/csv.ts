// CSV-Import aus Kontoauszügen. Reine Logik ohne Speicherzugriff, damit sie vollständig testbar ist.
// Unterstützt den C24-Export (Spalten wie „Transaktionstyp, Buchungsdatum, Karteneinsatz, Betrag, Zahlungsempfänger …“)
// und einfache Exporte anderer Banken über Spaltennamen-Erkennung (Datum, Betrag, Empfänger, Verwendungszweck).
import { AppError } from '../domain/types';
import type { Category, Transaction } from '../domain/types';
import { isValidISODate } from '../domain/dates';
import { MAX_CENTS } from '../domain/money';

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Art einer Zeile: was die App standardmäßig damit macht */
export type RowKind = 'expense' | 'credit' | 'roundup' | 'transfer';

export interface Candidate {
  /** stabiler Fingerabdruck der Zeile (für „schon importiert“) */
  key: string;
  /** Datum des Kaufs (Karteneinsatz), sonst Buchungsdatum */
  date: string;
  bookingDate: string;
  amountCents: number;
  kind: RowKind;
  /** Anzeigename: Händler/Empfänger, bei PayPal der eigentliche Shop */
  payee: string;
  /** normalisierter Empfänger zum Gruppieren und Merken */
  payeeKey: string;
  /** Kategorie/Unterkategorie der Bank (nur als Hinweis) */
  bankCategory: string;
  bankSub: string;
  /** zusätzlicher Text (Verwendungszweck/Beschreibung), gekürzt */
  detail: string;
  /** Originalangaben der Bank für die Detailansicht (nur im Speicher, wird nicht gespeichert) */
  raw: RawInfo;
}

export interface RawInfo { type: string; time: string; payee: string; iban: string; zweck: string; desc: string; cash: string; amountText: string }

export interface ParseResult { candidates: Candidate[]; skippedLines: number; format: 'c24' | 'hvb' | 'generic' }

/**
 * Datei-Bytes in Text: UTF-16 (mit BOM, z. B. aus Excel „Unicode-Text“), UTF-8,
 * bei kaputten Umlauten Windows-1252 (ältere Bank-Exporte).
 */
export function decodeBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  // UTF-16 ohne BOM: viele Nullbytes an ungeraden Stellen
  let zeros = 0;
  for (let i = 1; i < Math.min(b.length, 400); i += 2) if (b[i] === 0) zeros++;
  if (b.length > 8 && zeros > Math.min(b.length, 400) / 4) return new TextDecoder('utf-16le').decode(buf);
  const utf = new TextDecoder('utf-8').decode(buf);
  return utf.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buf) : utf;
}

/** RFC-4180-ähnlicher Parser: Anführungszeichen, doppelte Anführungszeichen, Zeilenumbrüche in Feldern. */
export function parseCsvText(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const formatAmount = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();

/** „-34,99 €“, „1.234,56“, „-12.50“ → vorzeichenbehaftete Cent */
export function parseSignedAmount(raw: string): number | null {
  let s = raw.replace(/[\s€ \u202f]|EUR/gi, '');
  // „(15,96)“ = negativ (Buchhaltungsschreibweise)
  let neg = /^\(.*\)$/.test(s);
  s = s.replace(/^\((.*)\)$/, '$1');
  neg = neg || /^[-−]/.test(s) || /-$/.test(s);
  s = s.replace(/^[-−+]|-$/g, '');
  if (!s) return null;
  let intPart: string, frac = '';
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    // beide Zeichen: das letzte ist das Dezimalzeichen („1.234,56“ oder „1,234.56“)
    const dec = lc > ld ? ',' : '.', th = dec === ',' ? '.' : ',';
    const [a, b2] = s.split(dec);
    intPart = (a ?? '').split(th).join(''); frac = b2 ?? '';
  } else if (lc >= 0) { const [a, b2] = s.split(','); intPart = (a ?? '').replace(/\./g, ''); frac = b2 ?? ''; }
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) intPart = s.replace(/\./g, '');
  else if (ld >= 0) { const [a, b2] = s.split('.'); intPart = a ?? ''; frac = b2 ?? ''; }
  else intPart = s;
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(frac)) return null;
  const cents = Number(intPart) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return neg ? -cents : cents;
}

/** „27.10.2026“, „27.10.2026 16:40“, „2026-10-27“, „27.10.26“ → ISO-Datum (lokal, ohne Zeitzone) */
export function parseDate(raw: string, mdy = false): string | null {
  const s = raw.trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/.exec(s);
  if (m) {
    const y = (m[3] as string).length === 2 ? `20${m[3]}` : (m[3] as string);
    const iso = `${y}-${(m[2] as string).padStart(2, '0')}-${(m[1] as string).padStart(2, '0')}`;
    return isValidISODate(iso) ? iso : null;
  }
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s);
  if (m) { const iso = `${m[1]}-${(m[2] as string).padStart(2, '0')}-${(m[3] as string).padStart(2, '0')}`; return isValidISODate(iso) ? iso : null; }
  // „30/12/2025“ oder „30-12-2025“: Tag zuerst (europäisch); ist der erste Wert > 12 nicht möglich, als Monat/Tag lesen
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)/.exec(s);
  if (m) {
    const y = (m[3] as string).length === 2 ? `20${m[3]}` : (m[3] as string);
    let d = Number(m[1]), mo = Number(m[2]);
    if (mdy || (mo > 12 && d <= 12)) [d, mo] = [mo, d];
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isValidISODate(iso) ? iso : null;
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) { const iso = `${m[1]}-${m[2]}-${m[3]}`; return isValidISODate(iso) ? iso : null; }
  return null;
}

/** Rechtsform und Zusätze entfernen: „PayPal Europe S.a.r.l. et Cie S.C.A“ → „PayPal“, „Muster GmbH“ → „Muster“ */
function shortName(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (/^paypal/i.test(t)) return 'PayPal';
  const cut = t.replace(/[,]?\s+(GmbH|AG|SE|KG|KGaA|OHG|UG|mbH|e\.\s?K\.?|Co\.?\s?KG|S\.\s?[aà]\.?\s?r\.?\s?l\.?|S\.\s?A\.?|S\.C\.A|S\.p\.A\.?|N\.V\.|B\.V\.|AB|A\/S|ApS|Oy|LLC|plc|Ltd\.?|Inc\.?|Limited)(?![\w]).*$/i, '').trim();
  return cut.length >= 2 ? cut : t;
}

function cleanPayee(payee: string, zweck: string, beschreibung: string): string {
  const p = payee.trim();
  // PayPal & Co.: eigentlicher Shop steht im Verwendungszweck („Ihr Einkauf bei Lidl Digital …“), falls die Bank ihn mitliefert
  if (/paypal|amazon payments|klarna/i.test(p) || !p) {
    const m = /Ihr Einkauf bei\s+([^,/]+)/i.exec(zweck);
    const shop = m?.[1] ? shortName(m[1]) : '';
    if (shop.length > 1 && !/^paypal/i.test(shop)) return shop.slice(0, 60);
  }
  return shortName(p || beschreibung.trim() || zweck.trim() || 'Unbekannt').slice(0, 60);
}

/** Zusatztext ohne Referenznummern und Zahlungsdienst-Kürzel; leer, wenn nichts Lesbares übrig bleibt */
function cleanDetail(zweck: string, desc: string, payee: string): string {
  const t = `${zweck} ${zweck ? '' : desc}`
    .replace(/Ihr Einkauf bei.*$/i, '')
    .replace(/\bPP\.\d+\.PP\b/g, ' ')
    .replace(/[\w-]*\d{6,}[\w-]*/g, ' ')
    .replace(/[/.,;:]+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.toLowerCase() === payee.toLowerCase()) return '';
  return t.slice(0, 80);
}

/** Kartennummern-Reste („PAN 540929******8726“) unkenntlich machen – nie anzeigen oder speichern */
function maskCard(s: string): string {
  return s.replace(/\bPAN\s+\S+/gi, 'PAN ••••').replace(/\b\d{4,6}\*{2,}\d{2,4}\b/g, '••••');
}

const PAYEE_STOP = new Set(['produktions', 'handels', 'vertriebs', 'und', 'gmbh', 'filiale', 'ag', 'kg', 'co', 'se', 'ohg', 'mbh', 'deu', 'de']);
/**
 * Händler aus dem Verwendungszweck, wenn die Bank keine eigene Spalte liefert (z. B. HypoVereinsbank):
 * „EC-GAA/POS Rossmann 3029 Tutzing      DEU82327 Belegdatum …  Tutzing“ → „Rossmann“.
 * Erster Block bis zu mehreren Leerzeichen, ohne Zahlen, Rechtsform-Reste und Ort (der steht am Ende des Zwecks).
 */
export function payeeFromZweck(zweck: string): string {
  const z = zweck.replace(/\s+$/, '');
  // „Auftraggeber: Rewe Markt GmbH Buchungstext: …“ (comdirect u. a.)
  const lab = /(?:Empf(?:ä|ae)nger|Auftraggeber|Zahlungsempf(?:ä|ae)nger|Beg(?:ü|ue)nstigter)\s*:\s*(.+?)(?=\s+(?:Buchungstext|Verwendungszweck|Ref\.?|IBAN|Kto|BIC|End-to-End|Mandat)\b|\s{2,}|$)/i.exec(z);
  if (lab?.[1]) return shortName(lab[1].trim()).slice(0, 60);
  const first = (z.replace(/^(EC-GAA\/POS|EC-POS|EC-GAA|POS|Kartenzahlung|SEPA[-\s]?\S*|Lastschrift|Gutschrift|Überweisung|Dauerauftrag)\s+/i, '').split(/\s{2,}/)[0] ?? '').trim();
  const town = /\s([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,})$/.exec(z)?.[1];
  const words = first.split(/\s+/).filter((w) => w.length > 1 && !/\d/.test(w) && w !== town && !PAYEE_STOP.has(w.toLowerCase().replace(/[.,]/g, '')));
  const name = words.slice(0, 3).join(' ');
  return shortName(name || first || 'Unbekannt').slice(0, 60);
}

async function hashKey(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

const HEADER_ALIASES: Record<keyof ColumnMap, string[]> = {
  type: ['transaktionstyp', 'buchungstext', 'umsatzart', 'vorgang', 'buchungsart', 'transaktionsart', 'type', 'art'],
  booking: ['buchungsdatum', 'buchungstag', 'datum', 'buchung', 'buchungs datum', 'booking date', 'date', 'started date', 'completed date', 'auftragsdatum'],
  card: ['karteneinsatz', 'belegdatum', 'wertstellung', 'valuta', 'valutadatum', 'wert', 'wertstellung valuta', 'wertstellungsdatum', 'value date'],
  amount: ['betrag', 'betrag eur', 'umsatz', 'betrag in eur', 'umsatz in eur', 'betrag euro', 'amount', 'amount eur', 'brutto', 'betrag ', 'umsatz eur'],
  debit: ['soll', 'ausgang', 'belastung', 'lastschrift', 'debit', 'abgang', 'ausgaben'],
  credit: ['haben', 'eingang', 'gutschrift', 'credit', 'zugang', 'einnahmen'],
  sign: ['soll haben', 's h', 'kennzeichen', 'soll haben kennzeichen', 'debit credit', 'cr dr'],
  payee: ['zahlungsempfanger', 'empfanger', 'beguenstigter zahlungspflichtiger', 'begunstigter zahlungspflichtiger', 'name zahlungsbeteiligter', 'auftraggeber empfanger',
    'zahlungsempfanger in', 'begunstigter auftraggeber', 'name', 'partner name', 'empfanger auftraggeber', 'auftraggeber zahlungsempfanger', 'gegenkonto name', 'counterparty', 'payee', 'empfanger 1', 'merchant'],
  // eigene Spalte für den Zahlenden (DKB, Postbank): bei Eingängen der passende Name
  payer: ['zahlungspflichtige r', 'zahlungspflichtige', 'auftraggeber', 'empfanger zahlungspflichtiger'],
  zweck: ['verwendungszweck', 'zweck', 'buchungsdetails', 'buchungsinformationen', 'reference', 'payment reference', 'description', 'vorgang verwendungszweck'],
  desc: ['beschreibung', 'info', 'notiz', 'kommentar', 'hinweis'],
  bankCat: ['kategorie', 'category'],
  bankSub: ['unterkategorie'],
  iban: ['iban', 'iban zahlungsbeteiligter', 'kontonummer iban', 'iban auftraggeber', 'gegenkonto'],
  cash: ['bargeldabhebung']
};

/** Welche Spalte (0-basiert) welche Angabe enthält; −1 = nicht vorhanden. */
export interface ColumnMap {
  booking: number; card: number; amount: number; debit: number; credit: number; sign: number;
  payee: number; payer: number; zweck: number; desc: number; type: number; bankCat: number; bankSub: number; iban: number; cash: number;
}
export const EMPTY_MAP: ColumnMap = { booking: -1, card: -1, amount: -1, debit: -1, credit: -1, sign: -1, payee: -1, payer: -1, zweck: -1, desc: -1, type: -1, bankCat: -1, bankSub: -1, iban: -1, cash: -1 };

/** Aufbau einer Datei: Trennzeichen, Kopfzeile, erkannte Zuordnung und Beispielzeilen (für „Spalten zuordnen“). */
export interface Layout {
  sep: string; headAt: number; hasHeader: boolean; header: string[]; columns: number;
  map: ColumnMap; samples: string[][]; signature: string; confident: boolean;
}

/** Datei konnte nicht sicher gelesen werden – die Ansicht fragt nach der Zuordnung. */
export class NeedsMapping extends AppError {
  readonly layout: Layout;
  constructor(layout: Layout) { super('Bitte ordne die Spalten zu.'); this.name = 'NeedsMapping'; this.layout = layout; }
}

const count = (line: string, re: RegExp) => line.match(re)?.length ?? 0;
/** Trennzeichen einer Zeile: Tabulator, Semikolon oder Komma – je nachdem, was überwiegt */
const sepOf = (line: string) => count(line, /\t/g) > Math.max(count(line, /;/g), count(line, /,/g)) ? '\t' : count(line, /;/g) > count(line, /,/g) ? ';' : ',';
const isSign = (v: string) => /^(s|h|soll|haben|d|c|cr|dr|debit|credit|-|\+)$/i.test(v.trim());
const isMoney = (v: string) => { const t = v.trim(); return /[.,]\d{2}(?!\d)|^[-−+(]/.test(t) && parseSignedAmount(t) !== null; };

/**
 * Spalten aus dem Inhalt erraten, wenn die Kopfzeile fehlt oder unbekannt ist:
 * Datum = Werte sind fast alle Daten, Betrag = Geldbeträge mit Nachkommastellen (keine Kontonummern),
 * Text = die längsten Textspalten (längste → Verwendungszweck, kürzere → Empfänger).
 */
function inferMap(rows: string[][], columns: number, base: ColumnMap): ColumnMap {
  const map = { ...base };
  const sample = rows.slice(0, 40);
  const stat = Array.from({ length: columns }, (_, c) => {
    const vals = sample.map((r) => (r[c] ?? '').trim()).filter((v) => v !== '');
    const n = Math.max(1, vals.length);
    return {
      c, filled: vals.length / Math.max(1, sample.length),
      date: vals.filter((v) => parseDate(v)).length / n,
      money: vals.filter(isMoney).length / n,
      sign: vals.length > 0 && vals.every(isSign) ? 1 : 0,
      same: vals.length >= 3 && new Set(vals).size <= 1,
      len: vals.reduce((a, v) => a + v.length, 0) / n,
      text: vals.filter((v) => /[a-zäöü]{3,}/i.test(v)).length / n
    };
  });
  // Zuordnungen aus Spaltennamen verwerfen, deren Inhalt nicht passt (z. B. „Wert“ = Betrag statt Wertstellung)
  for (const k of ['booking', 'card'] as const) if (map[k] >= 0 && (stat[map[k]]?.date ?? 0) < 0.5) map[k] = -1;
  for (const k of ['amount', 'debit', 'credit'] as const) if (map[k] >= 0 && (stat[map[k]]?.money ?? 0) < 0.5 && (stat[map[k]]?.filled ?? 0) > 0.5) map[k] = -1;
  const used = new Set(Object.values(map).filter((i) => i >= 0));
  const take = (c: number) => { used.add(c); return c; };
  const dates = stat.filter((x) => x.date >= 0.8 && !used.has(x.c));
  if (map.booking < 0 && dates[0]) map.booking = take(dates[0].c);
  if (map.card < 0) { const d2 = dates.find((x) => !used.has(x.c)); if (d2) map.card = take(d2.c); }
  if (map.amount < 0 && map.debit < 0 && map.credit < 0) {
    const m = stat.filter((x) => x.money >= 0.8 && !used.has(x.c)).sort((a, b) => b.money - a.money || b.filled - a.filled)[0];
    if (m) map.amount = take(m.c);
  }
  if (map.sign < 0) { const sg = stat.find((x) => x.sign && !used.has(x.c) && !x.same); if (sg) map.sign = take(sg.c); }
  const texts = stat.filter((x) => !used.has(x.c) && x.text >= 0.6 && !x.same && x.date < 0.5 && x.money < 0.5).sort((a, b) => b.len - a.len);
  if (map.zweck < 0 && texts[0]) map.zweck = take(texts[0].c);
  if (map.payee < 0) { const p = texts.find((x) => !used.has(x.c) && x.len <= 70); if (p) map.payee = take(p.c); }
  return map;
}

/** Zuordnung über Spaltennamen (Kopfzeile) */
function mapFromHeader(header: string[]): ColumnMap {
  const map = { ...EMPTY_MAP };
  const h = header.map(norm);
  const used = new Set<number>();
  (Object.keys(HEADER_ALIASES) as (keyof ColumnMap)[]).forEach((k) => {
    const i = h.findIndex((x, j) => !used.has(j) && (HEADER_ALIASES[k] as string[]).includes(x));
    if (i >= 0) { map[k] = i; used.add(i); }
  });
  return map;
}

const usable = (m: ColumnMap) => m.booking >= 0 && (m.amount >= 0 || m.debit >= 0 || m.credit >= 0);

/** Aufbau erkennen: Kopfzeile suchen (manche Banken schreiben vorher Kontoinfos), sonst Spalten aus dem Inhalt erraten. */
export function detectLayout(text: string): Layout {
  const clean = text.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
  const lines = clean.split(/\r?\n/).slice(0, 40);
  let headAt = -1, sep = sepOf(lines.find((l) => l.trim()) ?? '');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (!l.trim()) continue;
    const sp = sepOf(l);
    if (usable(mapFromHeader(parseCsvText(l, sp)[0] ?? []))) { headAt = i; sep = sp; break; }
  }
  if (headAt < 0) {
    // Kopfzeile = erste Zeile mit mehreren Feldern, in der kein Datum und kein Betrag steht
    const first = lines.findIndex((l) => l.trim() && parseCsvText(l, sepOf(l))[0]!.length >= 3);
    if (first >= 0) {
      sep = sepOf(lines[first] as string);
      const cells = parseCsvText(lines[first] as string, sep)[0] ?? [];
      if (!cells.some((c) => parseDate(c) || isMoney(c))) headAt = first;
    }
  }
  const rest = headAt >= 0 ? clean.split(/\r?\n/).slice(headAt).join('\n') : clean;
  const all = parseCsvText(rest, sep);
  const header = headAt >= 0 ? (all[0] ?? []).map((c) => c.trim()) : [];
  const body = headAt >= 0 ? all.slice(1) : all;
  const columns = Math.max(header.length, ...body.slice(0, 40).map((r) => r.length), 0);
  const fromHeader = headAt >= 0 ? mapFromHeader(header) : { ...EMPTY_MAP };
  const map = usable(fromHeader) && fromHeader.payee + fromHeader.zweck > -2 ? fromHeader : inferMap(body, columns, fromHeader);
  // Soll/Haben-Kennzeichen ohne (bekannten) Spaltennamen, z. B. Volksbank: letzte Spalte nur „S“ oder „H“
  if (map.sign < 0 && map.amount >= 0) {
    const used = new Set(Object.values(map).filter((i) => i >= 0));
    const smp = body.slice(0, 40);
    for (let c = 0; c < columns; c++) {
      if (used.has(c)) continue;
      const vals = smp.map((r) => (r[c] ?? '').trim()).filter(Boolean);
      if (vals.length >= Math.min(3, smp.length) && vals.every((v) => /^(s|h|soll|haben)$/i.test(v)) && new Set(vals.map((v) => v[0]!.toLowerCase())).size >= 1) { map.sign = c; break; }
    }
  }
  const signature = headAt >= 0 ? 'h:' + header.map(norm).join('|') : `n:${columns}`;
  // sicher, wenn Datum und Betrag gefunden sind und die Beispielzeilen sich damit lesen lassen
  const ok = usable(map) && body.slice(0, 20).filter((r) => parseDate((r[map.booking] ?? '').trim()) && amountOf(r, map) !== null).length >= Math.min(3, body.length) * 0.7;
  return { sep, headAt, hasHeader: headAt >= 0, header, columns, map, samples: body.slice(0, 5), signature, confident: ok };
}

/** Vorzeichenbehafteter Betrag einer Zeile: Betragsspalte (ggf. mit Soll/Haben-Kennzeichen) oder getrennte Soll-/Haben-Spalten */
export function amountOf(r: string[], m: ColumnMap): number | null {
  const g = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  if (m.amount >= 0 && (g(m.amount) || (m.debit < 0 && m.credit < 0))) {
    const v = parseSignedAmount(g(m.amount));
    if (v === null) return null;
    const sg = g(m.sign);
    if (sg && /^(s|soll|d|dr|debit|-)$/i.test(sg)) return -Math.abs(v);
    if (sg && /^(h|haben|c|cr|credit|\+)$/i.test(sg)) return Math.abs(v);
    return v;
  }
  const d = g(m.debit) ? parseSignedAmount(g(m.debit)) : 0;
  const c = g(m.credit) ? parseSignedAmount(g(m.credit)) : 0;
  if (d === null || c === null) return null;
  return Math.abs(c) - Math.abs(d);
}

/**
 * Liest eine Kontoauszug-CSV und klassifiziert jede Zeile. Ungültige Zeilen werden gezählt, nicht importiert.
 * Ohne `map` wird der Aufbau erkannt; ist das nicht sicher möglich, kommt `NeedsMapping` (die Ansicht fragt dann nach).
 */
export async function parseStatement(text: string, given?: ColumnMap): Promise<ParseResult> {
  const layout = detectLayout(text);
  if (!given && !layout.confident) {
    if (layout.columns < 2) throw new AppError('Die Datei sieht nicht wie ein Kontoauszug als CSV aus.');
    // Ohne ein einziges Datum hilft auch Zuordnen nicht
    if (!layout.samples.some((r) => r.some((v) => parseDate(v.trim()) || parseDate(v.trim(), true)))) {
      throw new AppError('In der Datei wurden keine Spalten für Datum und Betrag gefunden. Ist es ein Kontoauszug als CSV?');
    }
    throw new NeedsMapping(layout);
  }
  const map = given ?? layout.map;
  if (!usable(map)) throw new NeedsMapping(layout);
  const clean = text.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
  const rest = layout.headAt >= 0 ? clean.split(/\r?\n/).slice(layout.headAt).join('\n') : clean;
  const rows = parseCsvText(rest, layout.sep);
  if (layout.hasHeader) rows.shift();
  if (rows.length < 1) throw new AppError('Die Datei enthält keine Buchungen.');
  const idx = map;
  const h = layout.header.map(norm);
  const format: ParseResult['format'] = h.includes('transaktionstyp') && h.includes('karteneinsatz') ? 'c24'
    : idx.payee < 0 && idx.zweck >= 0 && idx.card >= 0 && (h.includes('kontonummer') || !layout.hasHeader) ? 'hvb' : 'generic';
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  // „12/31/2025“: Monat zuerst (US-Schreibweise), wenn in der Datei ein zweiter Wert über 12 vorkommt und nie ein erster
  const slash = rows.slice(0, 200).flatMap((r) => [get(r, idx.booking), get(r, idx.card)]).map((v) => /^(\d{1,2})\/(\d{1,2})\//.exec(v)).filter(Boolean) as RegExpExecArray[];
  const mdy = slash.some((m) => Number(m[2]) > 12) && !slash.some((m) => Number(m[1]) > 12);
  const pd = (v: string) => parseDate(v, mdy);
  const seen = new Map<string, number>();
  const candidates: Candidate[] = [];
  let skipped = 0;
  const body = rows.slice(0, MAX_IMPORT_ROWS);
  for (const r of body) {
    const booking = pd(get(r, idx.booking));
    const signed = amountOf(r, idx);
    if (!booking || signed === null || signed === 0) { skipped++; continue; }
    const type = get(r, idx.type), zweck = get(r, idx.zweck), desc = get(r, idx.desc);
    // Kaufdatum: „Belegdatum“ im Verwendungszweck (Kartenzahlung), sonst Karteneinsatz/Valuta, sonst Buchungsdatum
    const beleg = /Belegdatum\s+(\d{1,2}\.\d{1,2}\.\d{2,4})/i.exec(zweck)?.[1];
    const card = (beleg ? parseDate(beleg) : null) ?? pd(get(r, idx.card));
    const bankCat = get(r, idx.bankCat), bankSub = get(r, idx.bankSub);
    // Eingänge: Name des Zahlenden, wenn die Bank dafür eine eigene Spalte hat
    const payeeCol = signed > 0 && get(r, idx.payer) ? get(r, idx.payer) : get(r, idx.payee) || get(r, idx.payer);
    const payee = !payeeCol && zweck ? payeeFromZweck(zweck) : cleanPayee(payeeCol, zweck, desc);
    const cardPay = /^(EC-GAA\/POS|EC-POS|POS|EC-GAA)\b/i.test(zweck);
    let kind: RowKind;
    if (/^sparen$/i.test(type) || /aufrundung/i.test(zweck)) kind = 'roundup';
    else if (/umbuchung/i.test(type) || /^umbuchung$/i.test(bankSub)) kind = 'transfer';
    else kind = signed < 0 ? 'expense' : 'credit';
    const base = [get(r, idx.booking), get(r, idx.card), idx.amount >= 0 ? get(r, idx.amount) : `${get(r, idx.debit)}/${get(r, idx.credit)}`, get(r, idx.payee), zweck, desc].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    candidates.push({
      key: await hashKey(`${base}#${n}`), date: card ?? booking, bookingDate: booking, amountCents: Math.abs(signed), kind,
      payee, payeeKey: norm(payee).split(' ').slice(0, 3).join(' ') || 'unbekannt', bankCategory: bankCat, bankSub,
      detail: cardPay ? '' : cleanDetail(maskCard(zweck), desc, payee),
      raw: {
        type, time: /\b(\d{1,2}:\d{2})\b/.exec(get(r, idx.card) || get(r, idx.booking))?.[1] ?? '', payee: payeeCol.slice(0, 140), iban: get(r, idx.iban).slice(0, 40),
        zweck: maskCard(zweck).slice(0, 300), desc: desc.slice(0, 200), cash: get(r, idx.cash).slice(0, 40), amountText: (idx.amount >= 0 ? get(r, idx.amount) : `${get(r, idx.debit)} ${get(r, idx.credit)}`).trim().slice(0, 30)
      }
    });
  }
  skipped += Math.max(0, rows.length - MAX_IMPORT_ROWS);
  return { candidates, skippedLines: skipped, format };
}

/* ───────── Kategorie-Vorschläge ───────── */

/** Eingebaute Zuordnung Bank-Unterkategorie → Name einer App-Kategorie (nur Vorschlag) */
const BANK_SYNONYMS: Record<string, string[]> = {
  supermarkt: ['einkaufen'], 'sonstiges lebensmittel': ['einkaufen'], backerei: ['backer', 'backerei'], kantine: ['kantine'],
  'restaurant cafe bar': ['essen gehen'], tanken: ['benzin', 'tanken'], parken: ['parken'], friseur: ['friseur'],
  apotheke: ['apotheke'], drogerie: ['dm', 'drogerie'], bekleidung: ['bekleidung', 'kleidung', 'schuhe'], 'online shopping': ['amazon', 'online'], kino: ['kino'],
  cafe: ['cafe', 'kaffee', 'essen gehen'], restaurant: ['essen gehen', 'restaurant'], lieferdienst: ['lieferdienst', 'essen gehen'],
  mobilitat: ['offentliche', 'oepnv', 'bahn', 'mobilitat'], baumarkt: ['baumarkt', 'haushalt'], bargeld: ['auszahlung', 'bargeld'], kiosk: ['kiosk']
};

export interface Suggestion { categoryId: string; source: 'gemerkt' | 'name' | 'bank' }

/** Buchbare Kategorien: Unterkategorien und Hauptkategorien ohne Unterkategorien */
export function bookable(cats: Category[], kind: 'expense' | 'income'): Category[] {
  return cats.filter((c) => c.kind === kind && !c.archived && !cats.some((x) => x.parentId === c.id));
}

export function suggestCategory(c: Candidate, cats: Category[], rules: Record<string, string>): Suggestion | null {
  const kind = c.kind === 'credit' ? 'income' : 'expense';
  const pool = bookable(cats, kind);
  const has = (id: string | undefined) => !!id && pool.some((x) => x.id === id);
  const learned = rules[c.payeeKey];
  if (has(learned)) return { categoryId: learned as string, source: 'gemerkt' };
  if (c.kind === 'roundup') { const s = pool.find((x) => x.group === 'spar'); return s ? { categoryId: s.id, source: 'bank' } : null; }
  // Kategoriename steckt im Empfänger (z. B. „Amazon“) oder in der Bank-Unterkategorie (z. B. „Kantine“)
  const p = norm(c.payee), sub = norm(c.bankSub);
  const byName = pool.find((x) => { const n = norm(x.name); return n.length >= 3 && (p.split(' ').includes(n) || sub === n); });
  if (byName) return { categoryId: byName.id, source: 'name' };
  // Bank-Unterkategorie, sonst die Art des Händlers (Café, Drogerie, Baumarkt …)
  for (const target of [...(BANK_SYNONYMS[sub] ?? []), ...(BANK_SYNONYMS[nameBlock(c) ?? ''] ?? [])]) {
    const hits = pool.filter((x) => norm(x.name) === target);
    // bei mehrdeutigen Namen (z. B. „Benzin“ bei Auto und Motorrad) die Alltags-Kategorie mit dem kleineren sort nehmen
    const hit = hits.sort((a, b) => a.sort - b.sort)[0];
    if (hit) return { categoryId: hit.id, source: 'bank' };
  }
  return null;
}

/* ───────── Duplikate ───────── */

export type DupState = 'none' | 'imported' | 'same' | 'maybe';

const dayDiff = (a: string, b: string) => Math.abs(Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86_400_000;

/**
 * Findet für jede Zeile eine passende vorhandene Buchung (jede vorhandene höchstens einmal):
 * - 'imported': genau diese Zeile wurde schon einmal importiert
 * - 'same': gleicher Betrag und gleiches Datum (Kauf- oder Buchungsdatum) → sicher schon erfasst
 * - 'maybe': gleicher Betrag, Datum bis 3 Tage daneben → wahrscheinlich schon erfasst
 */
export function findDuplicates(cands: Candidate[], existing: Transaction[]): Map<string, { state: DupState; match?: Transaction }> {
  const out = new Map<string, { state: DupState; match?: Transaction }>();
  const imported = new Set(existing.map((t) => t.importId).filter(Boolean) as string[]);
  const used = new Set<string>();
  const pool = existing.filter((t) => !t.recurringId);
  for (const c of cands) {
    if (imported.has(c.key)) { out.set(c.key, { state: 'imported' }); continue; }
    if (c.kind === 'transfer') { out.set(c.key, { state: 'none' }); continue; }
    const type = c.kind === 'credit' ? 'income' : 'expense';
    const same = pool.find((t) => !used.has(t.id) && t.type === type && t.amountCents === c.amountCents && (t.date === c.date || t.date === c.bookingDate));
    if (same) { used.add(same.id); out.set(c.key, { state: 'same', match: same }); continue; }
    const maybe = pool.find((t) => !used.has(t.id) && t.type === type && t.amountCents === c.amountCents && dayDiff(t.date, c.date) <= 3);
    if (maybe) { used.add(maybe.id); out.set(c.key, { state: 'maybe', match: maybe }); continue; }
    out.set(c.key, { state: 'none' });
  }
  return out;
}

/* ───────── Sammel-Blöcke ───────── */

const SUPERMARKETS = ['lidl', 'aldi', 'rewe', 'edeka', 'kaufland', 'netto', 'penny', 'norma', 'tegut', 'globus', 'marktkauf', 'denns', 'alnatura', 'vollcorner'];
const FUEL = ['aral', 'shell', 'esso', 'jet', 'totalenergies', 'agip', 'eni', 'omv', 'avia', 'hem', 'westfalen', 'orlen', 'q1', 'tankstelle'];

export interface Block { key: string; title: string }

/** Lesbare Blocknamen für Bank-Unterkategorien */
const BLOCK_TITLES: Record<string, string> = {
  supermarkt: 'Supermärkte', tanken: 'Tankstellen', backerei: 'Bäckereien', 'restaurant cafe bar': 'Restaurants, Cafés & Bars',
  'online shopping': 'Online-Shopping', drogerie: 'Drogerien', apotheke: 'Apotheken', bekleidung: 'Kleidung', parken: 'Parken',
  cafe: 'Cafés & Kaffee', restaurant: 'Restaurants & Imbiss', lieferdienst: 'Lieferdienste', kantine: 'Kantine & Mensa',
  mobilitat: 'Bahn, Bus & Fahrdienste', baumarkt: 'Baumärkte', bargeld: 'Bargeld', kiosk: 'Kiosk & Getränke'
};

/** Art des Händlers am Namen erkennen (Wörter im normalisierten Namen); Reihenfolge = Vorrang */
const NAME_BLOCKS: [string, RegExp][] = [
  ['lieferdienst', / (lieferando|wolt|uber eats|deliveroo|flink|gorillas|getir|foodora|pizza de) /],
  ['cafe', / (cafe|caffe|coffee|kaffee|kaffeehaus|espresso|starbucks|tchibo|balzac|einstein|coffee fellows|black sheep|dunkin|barista|rosterei|kaffeerosterei) /],
  ['backerei', / (backerei|backer|backhaus|backstube|backwerk|ihle|kamps|rischart|hofpfisterei|wimmer|zottl|ditsch|brezel|brot) /],
  ['kantine', / (kantine|mensa|canteen|betriebsrestaurant|casino|cafeteria|studierendenwerk|studentenwerk) /],
  ['restaurant', / (restaurant|ristorante|trattoria|osteria|pizzeria|pizza|doner|kebab|kebap|imbiss|burger|mcdonalds|mcdonald s|burger king|kfc|subway|vapiano|sushi|thai|asia|gasthof|gasthaus|wirtshaus|biergarten|brauhaus|bistro|grill|dean david|hans im gluck|five guys|nordsee) /],
  ['drogerie', / (dm|dm drogerie|rossmann|muller|budni|drogerie) /],
  ['apotheke', / (apotheke|apotheken|docmorris|shop apotheke|medpex) /],
  ['online shopping', / (amazon|amzn|zalando|ebay|otto|temu|shein|aliexpress|about you|galaxus|mediamarkt de|kleinanzeigen) /],
  ['bekleidung', / (h m|hm|zara|primark|c a|uniqlo|deichmann|snipes|tk maxx|new yorker|bershka|pull bear|only|jack jones|decathlon) /],
  ['baumarkt', / (obi|toom|hornbach|bauhaus|hagebau|globus baumarkt|ikea|jysk|poco|xxxlutz|mobelix) /],
  ['mobilitat', / (db|deutsche bahn|db vertrieb|bahn|mvg|mvv|bvg|hvv|vrr|vvs|rmv|kvv|flixbus|flixtrain|uber|bolt|free now|freenow|tier|lime|voi|share now|miles|sixt share|swapfiets|nextbike) /],
  ['parken', / (parken|parkhaus|parkplatz|apcoa|contipark|easypark|parkster|q park) /],
  ['kiosk', / (kiosk|spati|getranke|trinkhalle|tabak|lotto) /],
  ['bargeld', / (geldautomat|bargeldauszahlung|atm|cash) /]
];
/** zu allgemein für einen gemeinsamen Block – diese Zeilen bleiben je Händler */
const NO_BLOCK = new Set(['weitere ausgaben', 'sonstiges', 'sonstige ausgaben', 'sonstiges lebensmittel', 'umbuchung', '']);

export function nameBlock(c: Candidate): string | null {
  const p = norm(c.payee);
  const first = p.split(' ')[0] ?? '';
  if (SUPERMARKETS.includes(first)) return 'supermarkt';
  if (FUEL.includes(first)) return 'tanken';
  const t = ` ${p} `;
  for (const [k, re] of NAME_BLOCKS) if (re.test(t)) return k;
  return null;
}

/**
 * Ordnet Ausgaben gemeinsamen Blöcken zu: Supermärkte und Tankstellen immer; Händler gleicher Art (Cafés,
 * Bäckereien, Drogerien, Lieferdienste …, am Namen erkannt) und Bank-Unterkategorien (z. B. „Restaurant/ Café/ Bar“),
 * sobald mehrere verschiedene Händler darunter vorkommen.
 */
export function assignBlocks(cands: Candidate[]): Map<string, Block> {
  // Kategorie der Bank zuerst (einheitlich je Bank); ohne sie die Art des Händlers am Namen
  const subOf = (c: Candidate) => { const s = norm(c.bankSub); return s && !NO_BLOCK.has(s) ? s : nameBlock(c); };
  const payees = new Map<string, Set<string>>();
  for (const c of cands) {
    if (c.kind !== 'expense') continue;
    const s = subOf(c);
    if (s) payees.set(s, (payees.get(s) ?? new Set()).add(c.payeeKey));
  }
  const out = new Map<string, Block>();
  for (const c of cands) {
    if (c.kind !== 'expense') continue;
    const s = subOf(c);
    if (!s) continue;
    const always = s === 'supermarkt' || s === 'tanken';
    if (!always && (payees.get(s)?.size ?? 0) < 2) continue;
    out.set(c.key, { key: `block:${s}`, title: BLOCK_TITLES[s] ?? c.bankSub.replace(/\s*\/\s*/g, ' / ').trim() });
  }
  return out;
}

/** Einzelne Zeile: nur Supermarkt/Tankstelle (für Tests und einfache Fälle) */
export function blockOf(c: Candidate): Block | null {
  return assignBlocks([c]).get(c.key) ?? null;
}

/* ───────── Retouren ───────── */

const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/**
 * Findet Retouren: eine Gutschrift mit genau demselben Betrag wie eine frühere Ausgabe beim selben Händler
 * (oder in derselben Bank-Kategorie), höchstens 120 Tage später. Jede Ausgabe wird höchstens einmal zugeordnet.
 * Ergebnis: Zeilen-Schlüssel → Schlüssel der Gegenbuchung (in beide Richtungen).
 */
export function findReturns(cands: Candidate[]): Map<string, string> {
  const out = new Map<string, string>();
  const expenses = cands.filter((c) => c.kind === 'expense');
  const fw = (c: Candidate) => c.payeeKey.split(' ')[0] ?? '';
  const samePayee = (a: Candidate, b: Candidate) => a.payeeKey === b.payeeKey || (fw(a).length >= 3 && fw(a) === fw(b));
  const sameCat = (a: Candidate, b: Candidate) => !!a.bankSub && a.bankSub === b.bankSub && a.bankCategory === b.bankCategory && !NO_BLOCK.has(norm(a.bankSub));
  for (const cr of cands.filter((c) => c.kind === 'credit').sort((a, b) => a.date.localeCompare(b.date))) {
    const match = expenses
      .filter((e) => !out.has(e.key) && e.amountCents === cr.amountCents && e.date <= cr.date && dayNum(cr.date) - dayNum(e.date) <= 120
        && (samePayee(e, cr) || sameCat(e, cr)))
      .sort((a, b) => Number(samePayee(b, cr)) - Number(samePayee(a, cr)) || b.date.localeCompare(a.date))[0];
    if (match) { out.set(cr.key, match.key); out.set(match.key, cr.key); }
  }
  return out;
}

/* ───────── Fixkosten erkennen ───────── */

export type FixInterval = 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';
export interface FixFound {
  key: string; name: string; payeeKey: string;
  /** Zeilen der Datei, die zu dieser Zahlung gehören (falls bekannt) */
  keys?: string[];
  /** zuletzt gezahlter Betrag */
  amountCents: number;
  interval: FixInterval;
  /** wie oft in der Datei gefunden */
  count: number; first: string; last: string;
  /** üblicher Buchungstag (1–28) */
  day: number;
  /** Monat 1–12 der Zahlung (für jährlich/halbjährlich/vierteljährlich) */
  dueMonth: number;
  /** Beträge schwanken (z. B. Strom-Abschlag geändert) */
  varies: boolean;
  /** Hinweistext aus der Bank (Verwendungszweck/Buchungstext) für die Kategorie-Wahl */
  hint: string;
}

const FIX_WORDS = /miete|dauerauftrag|versicherung|beitrag|abo\b|abonnement|rundfunk|strom|gas\b|internet|mobilfunk|telekom|vodafone|o2\b|1&1|netflix|spotify|disney|leasing|kredit|darlehen|kita|verein|fitness|gym|hausgeld|nebenkosten|abschlag/i;

/**
 * Wiederkehrende Ausgaben in einem Kontoauszug finden: gleicher Empfänger in mehreren Monaten
 * (Abstand ~1, 3, 6 oder 12 Monate). Einzelne Zahlungen nur, wenn der Text klar nach Vertrag aussieht (Miete, Versicherung, Abo …).
 */
/**
 * Zahlungen eines Händlers nach Betrag trennen (z. B. Haftpflicht 5,80 € und Reiseversicherung 12,40 € bei derselben
 * Versicherung). Beträge innerhalb von 10 % (mind. 1 €) gehören zusammen.
 */
export function amountClusters(list: Candidate[]): Candidate[][] {
  const out: Candidate[][] = [];
  for (const c of [...list].sort((a, b) => a.amountCents - b.amountCents)) {
    const last = out[out.length - 1];
    const ref = last?.[last.length - 1];
    if (last && ref && c.amountCents - ref.amountCents <= Math.max(100, ref.amountCents * 0.1)) last.push(c); else out.push([c]);
  }
  return out;
}

/** Unterscheidendes Wort aus dem Verwendungszweck (z. B. „Haftpflichtversicherung“), um Verträge desselben Händlers zu benennen. */
export function contractLabel(cs: Candidate[], others: Candidate[] = []): string {
  const words = (c: Candidate) => norm(`${c.raw.zweck} ${c.detail}`).split(' ').filter((w) => w.length >= 5 && !/\d/.test(w));
  const otherWords = new Set(others.flatMap(words));
  const cnt = new Map<string, number>();
  for (const c of cs) for (const w of new Set(words(c))) if (!otherWords.has(w) && !norm(c.payee).includes(w)) cnt.set(w, (cnt.get(w) ?? 0) + 1);
  const best = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
  if (!best || best[1] < Math.ceil(cs.length / 2)) return '';
  // Originalschreibweise aus dem Text holen
  const src = `${cs[0]!.raw.zweck} ${cs[0]!.detail}`;
  const m = src.split(/[^\p{L}\p{N}-]+/u).find((w) => norm(w) === best[0]);
  return m ?? best[0];
}

export function detectRecurring(cands: Candidate[]): FixFound[] {
  const byPayee = new Map<string, Candidate[]>();
  for (const c of cands) if (c.kind === 'expense') byPayee.set(c.payeeKey, [...(byPayee.get(c.payeeKey) ?? []), c]);
  // Mehrere Verträge beim selben Empfänger (Versicherung, Mobilfunk …): nach Betrag getrennt prüfen
  const groups = new Map<string, Candidate[]>();
  const suffix = new Map<string, string>();
  for (const [k, list] of byPayee) {
    const cl = amountClusters(list);
    const months = (cs: Candidate[]) => new Set(cs.map((c) => c.date.slice(0, 7))).size;
    const split = cl.length >= 2 && cl.length <= 4 && FIX_WORDS.test(list.map((c) => `${c.payee} ${c.raw.zweck}`).join(' '))
      && cl.every((cs) => months(cs) === cs.length);
    if (!split) { groups.set(k, list); continue; }
    cl.forEach((cs, i) => {
      const key = `${k}#${cs[cs.length - 1]!.amountCents}`;
      groups.set(key, cs);
      const lab = contractLabel(cs, cl.filter((_, j) => j !== i).flat());
      suffix.set(key, lab || formatAmount(cs[cs.length - 1]!.amountCents));
    });
  }
  const mIdx = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
  const out: FixFound[] = [];
  for (const [k, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    // je Monat eine Zahlung (bei mehreren im Monat: die zum häufigsten Betrag passende)
    const amounts = sorted.map((c) => c.amountCents);
    const mode = [...amounts].sort((a, b) => amounts.filter((x) => x === b).length - amounts.filter((x) => x === a).length)[0] as number;
    const byMonth = new Map<number, Candidate>();
    for (const c of sorted) {
      const m = mIdx(c.date);
      const prev = byMonth.get(m);
      if (!prev || Math.abs(c.amountCents - mode) < Math.abs(prev.amountCents - mode)) byMonth.set(m, c);
    }
    const months = [...byMonth.keys()].sort((a, b) => a - b);
    const lastC = byMonth.get(months[months.length - 1] as number) as Candidate;
    const text = `${lastC.payee} ${lastC.raw.zweck} ${lastC.raw.type} ${lastC.detail}`;
    let interval: FixInterval | null = null;
    if (months.length >= 2) {
      const gaps = months.slice(1).map((m, i) => m - (months[i] as number));
      const med = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] as number;
      // Nur Zahlungen in fast jedem Monat (bzw. Quartal/Jahr) gelten als Fixkosten – Einkäufe beim selben Händler nicht
      const regular = gaps.filter((g) => Math.abs(g - med) <= (med >= 6 ? 1 : 0)).length >= gaps.length * 0.6;
      const same = byMonth.size === sorted.length || sorted.length <= months.length * 1.5;
      const close = [...byMonth.values()].filter((c) => Math.abs(c.amountCents - lastC.amountCents) <= Math.max(500, lastC.amountCents * 0.2)).length >= months.length * 0.6;
      if (regular && same && close) interval = med <= 1 ? 'monthly' : med <= 3 ? 'quarterly' : med <= 7 ? 'halfyearly' : med <= 13 ? 'yearly' : null;
    } else if (FIX_WORDS.test(text) && sorted.length === 1 && !/karte|card|pos\b|apple pay|google pay/i.test(`${lastC.raw.type} ${lastC.raw.zweck}`)) {
      // Nur eine Zahlung: nur bei eindeutigen Worten (Miete, Versicherung …) und nicht bei Kartenzahlungen (z. B. „Vereinsheim“)
      interval = 'monthly';
    }
    if (!interval) continue;
    const vals = [...byMonth.values()];
    const days = vals.map((c) => Number(c.date.slice(8, 10))).sort((a, b) => a - b);
    out.push({
      key: k, name: suffix.has(k) ? `${lastC.payee} · ${suffix.get(k)}` : lastC.payee, payeeKey: lastC.payeeKey, ...(suffix.has(k) ? { keys: list.map((c) => c.key) } : {}),
      amountCents: lastC.amountCents, interval, count: months.length,
      first: (vals[0] as Candidate).date, last: lastC.date, day: Math.min(28, Math.max(1, days[Math.floor(days.length / 2)] ?? 1)),
      dueMonth: Number(lastC.date.slice(5, 7)), varies: vals.some((c) => c.amountCents !== lastC.amountCents),
      hint: `${lastC.raw.zweck} ${lastC.raw.type} ${lastC.bankCategory} ${lastC.bankSub}`.slice(0, 200)
    });
  }
  return out.sort((a, b) => b.amountCents * (a.interval === 'monthly' ? 1 : 0.3) - a.amountCents * (b.interval === 'monthly' ? 1 : 0.3) || a.name.localeCompare(b.name));
}

/** Passende Fixkosten-Kategorie aus Name/Hinweis raten (Wohnen, Versicherungen, Abos & Verträge, Mobilität …) */
export function guessFixCategory(f: FixFound, cats: Category[], rules: Record<string, string>): string | null {
  const pool = bookable(cats, 'expense').filter((c) => c.group === 'fix' && !c.archived);
  const learned = rules[f.payeeKey];
  if (learned && pool.some((c) => c.id === learned)) return learned;
  const t = norm(`${f.name} ${f.hint}`);
  const top = (c: Category) => (c.parentId ? cats.find((x) => x.id === c.parentId)?.name ?? '' : c.name);
  const find = (re: RegExp) => pool.find((c) => re.test(norm(c.name)) || re.test(norm(top(c))));
  const rulesList: [RegExp, RegExp][] = [
    [/miete|hausgeld|nebenkosten|wohnung|vermiet|strom|gas|stadtwerke|wasser|rundfunk|gez/, /wohn|miete|haus|strom|energie/],
    [/versicher|allianz|huk|ergo|axa|devk|generali|signal iduna|debeka|barmer|tk |aok|krankenkasse/, /versicher/],
    [/kfz|auto|leasing|tank|bahn|deutschlandticket|mvv|bvg|hvv|parken/, /mobil|auto|fahr|verkehr/],
    [/netflix|spotify|disney|amazon prime|apple|google|icloud|abo|telekom|vodafone|o2|1 1|mobilfunk|internet|dsl|handy|fitness|gym|verein/, /abo|vertr|handy|internet|telefon|medien/]
  ];
  for (const [txt, cat] of rulesList) if (txt.test(t)) { const hit = find(cat); if (hit) return hit.id; }
  // Kategoriename im Empfänger
  const byName = pool.find((c) => { const n = norm(c.name); return n.length >= 3 && t.includes(n); });
  return byName?.id ?? null;
}
