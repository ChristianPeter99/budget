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

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();

/** „-34,99 €“, „1.234,56“, „-12.50“ → vorzeichenbehaftete Cent */
export function parseSignedAmount(raw: string): number | null {
  let s = raw.replace(/[\s€ ]|EUR/gi, '');
  const neg = /^[-−]/.test(s) || /-$/.test(s);
  s = s.replace(/^[-−+]|-$/g, '');
  if (!s) return null;
  let intPart: string, frac = '';
  if (s.includes(',')) { const [a, b] = s.split(','); intPart = (a ?? '').replace(/\./g, ''); frac = b ?? ''; }
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) intPart = s.replace(/\./g, '');
  else if (s.includes('.')) { const [a, b] = s.split('.'); intPart = a ?? ''; frac = b ?? ''; }
  else intPart = s;
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(frac)) return null;
  const cents = Number(intPart) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return neg ? -cents : cents;
}

/** „27.10.2026“, „27.10.2026 16:40“, „2026-10-27“, „27.10.26“ → ISO-Datum (lokal, ohne Zeitzone) */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/.exec(s);
  if (m) {
    const y = (m[3] as string).length === 2 ? `20${m[3]}` : (m[3] as string);
    const iso = `${y}-${(m[2] as string).padStart(2, '0')}-${(m[1] as string).padStart(2, '0')}`;
    return isValidISODate(iso) ? iso : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) { const iso = `${m[1]}-${m[2]}-${m[3]}`; return isValidISODate(iso) ? iso : null; }
  return null;
}

/** Rechtsform und Zusätze entfernen: „PayPal Europe S.a.r.l. et Cie S.C.A“ → „PayPal“, „Muster GmbH“ → „Muster“ */
function shortName(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (/^paypal/i.test(t)) return 'PayPal';
  const cut = t.replace(/[,]?\s+(GmbH|AG|SE|KG|KGaA|OHG|UG|mbH|e\.\s?K\.?|Co\.?\s?KG|S\.\s?[aà]\.?\s?r\.?\s?l\.?|S\.\s?A\.?|S\.C\.A|N\.V\.|B\.V\.|Ltd\.?|Inc\.?)\b.*$/i, '').trim();
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

const HEADER_ALIASES: Record<string, string[]> = {
  type: ['transaktionstyp', 'buchungstext', 'umsatzart', 'vorgang'],
  booking: ['buchungsdatum', 'buchungstag', 'datum', 'buchung'],
  card: ['karteneinsatz', 'belegdatum', 'wertstellung', 'valuta', 'valutadatum'],
  amount: ['betrag', 'betrag eur', 'umsatz', 'betrag in eur'],
  payee: ['zahlungsempfanger', 'empfanger', 'beguenstigter zahlungspflichtiger', 'begunstigter zahlungspflichtiger', 'name zahlungsbeteiligter', 'auftraggeber empfanger', 'zahlungspflichtige r'],
  zweck: ['verwendungszweck', 'zweck'],
  desc: ['beschreibung', 'info'],
  bankCat: ['kategorie'],
  bankSub: ['unterkategorie'],
  iban: ['iban', 'iban zahlungsbeteiligter', 'kontonummer iban'],
  cash: ['bargeldabhebung']
};

/** Liest eine Kontoauszug-CSV und klassifiziert jede Zeile. Ungültige Zeilen werden gezählt, nicht importiert. */
export async function parseStatement(text: string): Promise<ParseResult> {
  const clean = text.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
  const lines = clean.split(/\r?\n/).slice(0, 40);
  const count = (line: string, re: RegExp) => line.match(re)?.length ?? 0;
  /** Trennzeichen einer Zeile: Tabulator, Semikolon oder Komma – je nachdem, was überwiegt */
  const sepOf = (line: string) => count(line, /\t/g) > Math.max(count(line, /;/g), count(line, /,/g)) ? '\t' : count(line, /;/g) > count(line, /,/g) ? ';' : ',';
  const known = (cells: string[]) => {
    const h = cells.map(norm);
    const has = (k: keyof typeof HEADER_ALIASES) => h.some((x) => (HEADER_ALIASES[k] as string[]).includes(x));
    return has('booking') && has('amount');
  };
  // Kopfzeile suchen (manche Banken schreiben vorher Kontoinfos o. Ä.)
  let headAt = -1, sep = sepOf(lines[0] ?? '');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (!l.trim()) continue;
    const sp = sepOf(l);
    if (known(parseCsvText(l, sp)[0] ?? [])) { headAt = i; sep = sp; break; }
  }
  let rows: string[][];
  let header: string[];
  if (headAt >= 0) {
    rows = parseCsvText(clean.split(/\r?\n/).slice(headAt).join('\n'), sep);
    header = (rows[0] as string[]).map(norm);
  } else {
    // Ohne Kopfzeile: Aufbau der HypoVereinsbank/UniCredit erkennen –
    // Kontonummer | Buchungsdatum | Valuta | Verwendungszweck | Betrag | Währung
    const first = lines.find((l) => l.trim()) ?? '';
    sep = sepOf(first);
    const body = parseCsvText(clean, sep);
    const looksHvb = (r: string[]) => r.length >= 5 && !!parseDate(r[1] ?? '') && !!parseDate(r[2] ?? '') && parseSignedAmount(r[4] ?? '') !== null;
    if (!body.some(looksHvb)) {
      // Nur Spaltennamen der ersten Zeile nennen (keine Beträge oder Texte aus Buchungen)
      const names = (body[0] ?? []).slice(0, 8).map((c) => c.trim().slice(0, 20)).filter((c) => c && !/\d/.test(c));
      throw new AppError(`Spalten für Datum und Betrag wurden nicht gefunden. Ist das ein Kontoauszug als CSV?${names.length ? ` Erkannte Spalten: ${names.join(', ')}.` : ''}`);
    }
    header = ['kontonummer', 'buchungsdatum', 'valuta', 'verwendungszweck', 'betrag', 'waehrung'];
    rows = [header, ...body];
  }
  if (rows.length < 2) throw new AppError('Die Datei enthält keine Buchungen.');
  const col = (k: keyof typeof HEADER_ALIASES) => header.findIndex((h) => (HEADER_ALIASES[k] as string[]).includes(h));
  const idx = { type: col('type'), booking: col('booking'), card: col('card'), amount: col('amount'), payee: col('payee'), zweck: col('zweck'), desc: col('desc'), bankCat: col('bankCat'), bankSub: col('bankSub'), iban: col('iban'), cash: col('cash') };
  if (idx.booking < 0 || idx.amount < 0) throw new AppError('Spalten für Datum und Betrag wurden nicht gefunden. Ist das ein Kontoauszug als CSV?');
  const format = header.includes('transaktionstyp') && header.includes('karteneinsatz') ? 'c24'
    : header.includes('kontonummer') && header.includes('valuta') && header.includes('verwendungszweck') && idx.payee < 0 ? 'hvb' : 'generic';
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const seen = new Map<string, number>();
  const candidates: Candidate[] = [];
  let skipped = 0;
  const body = rows.slice(1, MAX_IMPORT_ROWS + 1);
  for (const r of body) {
    const booking = parseDate(get(r, idx.booking));
    const signed = parseSignedAmount(get(r, idx.amount));
    if (!booking || signed === null || signed === 0) { skipped++; continue; }
    const type = get(r, idx.type), zweck = get(r, idx.zweck), desc = get(r, idx.desc);
    // Kaufdatum: „Belegdatum“ im Verwendungszweck (Kartenzahlung), sonst Karteneinsatz/Valuta, sonst Buchungsdatum
    const beleg = /Belegdatum\s+(\d{1,2}\.\d{1,2}\.\d{2,4})/i.exec(zweck)?.[1];
    const card = (beleg ? parseDate(beleg) : null) ?? parseDate(get(r, idx.card));
    const bankCat = get(r, idx.bankCat), bankSub = get(r, idx.bankSub);
    const payeeCol = get(r, idx.payee);
    const payee = idx.payee < 0 && zweck ? payeeFromZweck(zweck) : cleanPayee(payeeCol, zweck, desc);
    const cardPay = /^(EC-GAA\/POS|EC-POS|POS|EC-GAA)\b/i.test(zweck);
    let kind: RowKind;
    if (/^sparen$/i.test(type) || /aufrundung/i.test(zweck)) kind = 'roundup';
    else if (/umbuchung/i.test(type) || /^umbuchung$/i.test(bankSub)) kind = 'transfer';
    else kind = signed < 0 ? 'expense' : 'credit';
    const base = [get(r, idx.booking), get(r, idx.card), get(r, idx.amount), get(r, idx.payee), zweck, desc].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    candidates.push({
      key: await hashKey(`${base}#${n}`), date: card ?? booking, bookingDate: booking, amountCents: Math.abs(signed), kind,
      payee, payeeKey: norm(payee).split(' ').slice(0, 3).join(' ') || 'unbekannt', bankCategory: bankCat, bankSub,
      detail: cardPay ? '' : cleanDetail(maskCard(zweck), desc, payee),
      raw: {
        type, time: /\b(\d{1,2}:\d{2})\b/.exec(get(r, idx.card))?.[1] ?? '', payee: get(r, idx.payee).slice(0, 140), iban: get(r, idx.iban).slice(0, 40),
        zweck: maskCard(zweck).slice(0, 300), desc: desc.slice(0, 200), cash: get(r, idx.cash).slice(0, 40), amountText: get(r, idx.amount).slice(0, 30)
      }
    });
  }
  skipped += Math.max(0, rows.length - 1 - MAX_IMPORT_ROWS);
  return { candidates, skippedLines: skipped, format };
}

/* ───────── Kategorie-Vorschläge ───────── */

/** Eingebaute Zuordnung Bank-Unterkategorie → Name einer App-Kategorie (nur Vorschlag) */
const BANK_SYNONYMS: Record<string, string[]> = {
  supermarkt: ['einkaufen'], 'sonstiges lebensmittel': ['einkaufen'], backerei: ['backer'], kantine: ['kantine'],
  'restaurant cafe bar': ['essen gehen'], tanken: ['benzin'], parken: ['parken'], friseur: ['friseur'],
  apotheke: ['apotheke'], drogerie: ['dm'], bekleidung: ['bekleidung', 'schuhe'], 'online shopping': ['amazon'], kino: ['kino']
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
  for (const target of BANK_SYNONYMS[sub] ?? []) {
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
  'online shopping': 'Online-Shopping', drogerie: 'Drogerien', apotheke: 'Apotheken', bekleidung: 'Kleidung', parken: 'Parken'
};
/** zu allgemein für einen gemeinsamen Block – diese Zeilen bleiben je Händler */
const NO_BLOCK = new Set(['weitere ausgaben', 'sonstiges', 'sonstige ausgaben', 'sonstiges lebensmittel', 'umbuchung', '']);

function nameBlock(c: Candidate): string | null {
  const first = norm(c.payee).split(' ')[0] ?? '';
  if (SUPERMARKETS.includes(first)) return 'supermarkt';
  if (FUEL.includes(first)) return 'tanken';
  return null;
}

/**
 * Ordnet Ausgaben gemeinsamen Blöcken zu: Supermärkte und Tankstellen immer, andere Bank-Unterkategorien
 * (z. B. „Restaurant/ Café/ Bar“, „Bäckerei“), sobald mehrere verschiedene Händler darunter vorkommen.
 */
export function assignBlocks(cands: Candidate[]): Map<string, Block> {
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
