/**
 * Kontoauszug als PDF → Tabelle → (CSV-Text) → derselbe Weg wie beim CSV-Import.
 *
 * Ablauf:
 * 1. Textschnipsel mit Position lesen (pdf.js, nur auf dem Gerät; wird erst beim ersten PDF geladen).
 * 2. Zeilen bilden (gleiche Höhe), Schnipsel zu Feldern zusammenfassen (kleine Lücken = gleiches Feld).
 * 3. Buchungszeilen erkennen: beginnen mit einem Datum und enthalten einen Betrag.
 *    Folgezeilen ohne Datum gehören zum Text der Buchung darüber (mehrzeiliger Verwendungszweck).
 *    Kopf- und Fußzeilen, Seitenzahlen, Überträge und Kontostände fallen heraus.
 * 4. Betragsspalten über ihre rechte Kante gruppieren: eine Spalte = Betrag, zwei = Soll/Haben oder Betrag/Saldo.
 * 5. Kontrollrechnung: alter Kontostand + alle Buchungen = neuer Kontostand.
 *
 * Alles hier außer `readPdfItems` ist eine reine Funktion und ohne Browser testbar.
 */
import { AppError } from '../domain/types';
import { parseSignedAmount } from '../domain/statement';

/** Ein Textschnipsel des PDFs: Text, linke Kante x, Grundlinie y (von unten), Breite und Schriftgröße */
export interface PdfItem { s: string; x: number; y: number; w: number; h: number }

/** Passwortgeschütztes PDF: die Ansicht fragt nach dem Passwort. `wrong` = eingegebenes Passwort falsch. */
export class PdfPasswordNeeded extends AppError {
  readonly wrong: boolean;
  constructor(wrong: boolean) { super(wrong ? 'Das Passwort stimmt nicht.' : 'Das PDF ist mit einem Passwort geschützt.'); this.name = 'PdfPasswordNeeded'; this.wrong = wrong; }
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/** Textschnipsel aller Seiten lesen. `lib` ist pdf.js (im Browser mit Worker, in Tests direkt). */
export async function extractItems(lib: PdfJs, data: Uint8Array, password?: string): Promise<PdfItem[][]> {
  // keine Schriften, Skripte oder Netzwerk: nur Text lesen
  const task = lib.getDocument({ data, password, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, enableXfa: false, disableAutoFetch: true, disableStream: true, disableRange: true });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new PdfPasswordNeeded(!!password);
    throw new AppError('Das PDF lässt sich nicht lesen. Ist die Datei beschädigt?');
  }
  try {
    const pages: PdfItem[][] = [];
    const n = Math.min(doc.numPages, 60);
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const it of tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
        if (!it.str || !it.transform) continue;
        const [a, b, , d, e, f] = it.transform as [number, number, number, number, number, number];
        // gedrehter Text (z. B. senkrechte Randnotizen) gehört nicht zur Tabelle
        if (Math.abs(b) > Math.abs(a) * 0.2) continue;
        items.push({ s: it.str, x: e, y: f, w: it.width ?? 0, h: Math.abs(d) || it.height || 10 });
      }
      pages.push(items);
      page.cleanup();
    }
    return pages;
  } finally {
    void task.destroy();
  }
}

/** Im Browser: pdf.js mit Worker laden (erst beim ersten PDF) und das PDF lesen */
export async function readPdfItems(data: Uint8Array, password?: string): Promise<PdfItem[][]> {
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
  ]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return extractItems(lib, data, password);
}

/* ───────────────────────── Tabelle aus Textpositionen ───────────────────────── */

interface Seg { t: string; x0: number; x1: number }
interface Line { page: number; y: number; h: number; segs: Seg[]; text: string }

/** Zeilen einer Seite: Schnipsel mit (fast) gleicher Grundlinie; darin Felder = Schnipsel mit kleiner Lücke */
export function linesOf(items: PdfItem[], page = 0): Line[] {
  const its = items.filter((i) => i.s.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfItem[][] = [];
  for (const it of its) {
    const r = rows[rows.length - 1];
    const ref = r?.[0];
    if (r && ref && Math.abs(ref.y - it.y) <= Math.max(1.5, 0.45 * Math.min(ref.h, it.h))) r.push(it);
    else rows.push([it]);
  }
  return rows.map((r) => {
    r.sort((a, b) => a.x - b.x);
    const h = r.reduce((m, i) => Math.max(m, i.h), 0) || 10;
    const segs: Seg[] = [];
    for (const it of r) {
      const s = segs[segs.length - 1];
      const gap = s ? it.x - s.x1 : Infinity;
      // Lücke unter etwa einer Zeichenbreite: gleiches Feld (Wörter); größer: neue Spalte
      if (s && gap < 0.75 * h) {
        s.t += (gap > 0.12 * h && !s.t.endsWith(' ') && !it.s.startsWith(' ') ? ' ' : '') + it.s;
        s.x1 = Math.max(s.x1, it.x + it.w);
      } else segs.push({ t: it.s, x0: it.x, x1: it.x + it.w });
    }
    for (const s of segs) s.t = s.t.replace(/\s+/g, ' ').trim();
    const clean = segs.filter((s) => s.t !== '');
    return { page, y: r[0]!.y, h, segs: clean, text: clean.map((s) => s.t).join('  ') };
  }).filter((l) => l.segs.length > 0);
}

const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_START = /^(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?|\d{4}-\d{2}-\d{2})(?=\s|$)/;
/** Betrag mit optionalem Vorzeichen davor/dahinter, „S“/„H“ oder Währung: „-1.234,56“, „45,90-“, „45,90 S“, „+ 2.000,00 EUR“ */
const MONEY_RE = /^(?:[-−+]\s?)?(?:EUR\s?|€\s?)?\d{1,3}(?:[.\s]\d{3})*,\d{2}(?:\s?[-−+])?(?:\s?(?:EUR|€))?(?:\s?[SH])?$/i;
const SIGN_ONLY = /^(S|H|Soll|Haben|[-−+])$/i;

export const isPdfMoney = (t: string) => MONEY_RE.test(t.trim());

/** Betrag in Cent mit Vorzeichen; null = kein Betrag. `side` = ausdrückliche Richtung (−1 Soll, +1 Haben, 0 unbekannt) */
export function moneyOf(t: string): { cents: number; side: -1 | 0 | 1 } | null {
  const raw = t.trim();
  if (!MONEY_RE.test(raw)) return null;
  let side: -1 | 0 | 1 = 0;
  if (/\bS$/i.test(raw) || /[-−]\s?(?:EUR|€)?$/.test(raw.replace(/\s?[SH]$/i, '')) || /^[-−]/.test(raw)) side = -1;
  else if (/\bH$/i.test(raw) || /^\+/.test(raw) || /\+\s?(?:EUR|€)?$/.test(raw)) side = 1;
  const num = raw.replace(/\s?[SH]$/i, '').replace(/EUR|€/gi, '').replace(/[-−+\s]/g, '');
  const v = parseSignedAmount(num);
  if (v === null) return null;
  return { cents: Math.abs(v), side };
}

/** Vorgänge, mit denen der Buchungstext oft beginnt – davon getrennt steht dann der Empfänger */
const TYPE_WORDS = [
  'sepa-basislastschrift', 'sepa-lastschrift', 'basislastschrift', 'folgelastschrift', 'erstlastschrift', 'lastschrift',
  'debitkartenzahlung', 'kartenzahlung', 'kartenumsatz', 'kartentransaktion', 'girocard', 'visa', 'mastercard', 'apple pay', 'google pay',
  'echtzeitüberweisung', 'echtzeit-überweisung', 'sepa-überweisung', 'online-überweisung', 'überweisung', 'rücküberweisung', 'dauerauftrag',
  'gutschrift', 'sepa-gutschrift', 'lohn/gehalt', 'lohn', 'gehalt', 'bargeldauszahlung', 'bargeldabhebung', 'geldautomat', 'auszahlung', 'einzahlung',
  'zinsen', 'entgelt', 'abschluss', 'retoure', 'storno', 'umbuchung', 'sparen'
];

/** Zeile mit Kontostand/Saldo? (zählt nicht als Buchung, beendet den Text der Buchung davor) */
/** Kontostand-/Summenzeile: Text beginnt damit (nach Daten) – „Überweisung Saldo-Ausgleich“ bleibt eine Buchung */
const BAL_START = /^(?:(?:alter|neuer|ihr|der|aktueller|letzter|vorläufiger|bisheriger)\s+)?(?:kontostand|saldo|übertrag|uebertrag|zwischensumme|summe|anfangssaldo|endsaldo|schlusssaldo|saldovortrag|vortrag|gesamtsumme|gesamtbetrag)\b/i;
const isBalLine = (segs: Seg[]) => {
  const { rest } = leadingDates(segs);
  const t = rest.map((x) => x.t).join(' ').trim();
  return BAL_START.test(t) || /\bkontostand\b/i.test(t);
};
const OPEN_RE = /(alt|anfang|vortrag|vorheriger|letzter|start|übertrag\s+von|eröffnung)/i;
const CLOSE_RE = /(neu|end|aktuell|schluss|abschluss)/i;
/** Wörter einer Tabellen-Kopfzeile */
const HEAD_WORDS = /^(datum|buchung|buchungstag|buchungsdatum|bu-tag|valuta|wert|wertstellung|vorgang|buchungstext|text|verwendungszweck|beschreibung|erläuterung|umsatz|betrag|betrag in eur|betrag eur|soll|haben|saldo|eur|empfänger|auftraggeber|empfänger\/auftraggeber|zahlungsempfänger|details|art)$/i;

export interface PdfBalance { openCents: number | null; closeCents: number | null }
export interface PdfRow { booking: string; value: string; type: string; payee: string; zweck: string; cents: number; debit: string; credit: string; balance: string }
export interface PdfTable {
  rows: PdfRow[];
  /** CSV-Text für den gewohnten Weg (Kopfzeile + Zeilen, Trennzeichen „;“) */
  text: string;
  /** Fingerabdruck des Aufbaus (für Bankvorlagen) */
  signature: string;
  balance: PdfBalance;
  /** Kontrollrechnung: null = kein Kontostand im PDF; sonst Differenz in Cent (0 = alles erkannt) */
  diffCents: number | null;
  pages: number;
}

/** Jahr für Daten ohne Jahreszahl („01.11.“) aus dem Auszugszeitraum bestimmen */
function yearResolver(all: string[]): (d: number, m: number) => number {
  const full = all.flatMap((t) => [...t.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g)].map((x) => new Date(Number(x[3]), Number(x[2]) - 1, Number(x[1])).getTime()))
    .filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  const now = new Date();
  const end = full.length ? full[full.length - 1]! : now.getTime();
  const start = full.length ? full[0]! : end - 365 * 864e5;
  const endY = new Date(end).getFullYear();
  return (d, m) => {
    for (const y of [endY, endY - 1, endY + 1]) {
      const t = new Date(y, m - 1, d).getTime();
      if (t >= start - 40 * 864e5 && t <= end + 40 * 864e5) return y;
    }
    return new Date(endY, m - 1, d).getTime() > end + 40 * 864e5 ? endY - 1 : endY;
  };
}

function fmtDate(raw: string, year: (d: number, m: number) => number): string | null {
  const iso = ISO_RE.exec(raw);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const m = DATE_RE.exec(raw);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let y = m[3] ? Number(m[3]) : year(d, mo);
  if (y < 100) y += 2000;
  return `${String(d).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${y}`;
}

/** Felder am Zeilenanfang, die Daten sind (höchstens zwei: Buchungstag, Wertstellung); ein Datum kann mit Text verschmolzen sein */
function leadingDates(segs: Seg[]): { dates: string[]; rest: Seg[] } {
  const dates: string[] = [];
  const rest = segs.map((s) => ({ ...s }));
  while (rest.length && dates.length < 2) {
    const s = rest[0]!;
    const m = DATE_START.exec(s.t);
    if (!m) break;
    dates.push(m[1]!);
    const tail = s.t.slice(m[0].length).trim();
    if (tail) { s.t = tail; } else rest.shift();
  }
  return { dates, rest };
}

const csvCell = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const centsText = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, '0')}`;

/** Gruppen ähnlicher Zahlen (rechte Kanten der Betragsspalten) */
function clusters(xs: number[], tol: number): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const out: { sum: number; n: number; last: number }[] = [];
  for (const x of sorted) {
    const c = out[out.length - 1];
    if (c && x - c.last <= tol) { c.sum += x; c.n++; c.last = x; } else out.push({ sum: x, n: 1, last: x });
  }
  // Ausreißer (einzelne Werte bei vielen Zeilen) nicht als eigene Spalte zählen
  const big = Math.max(...out.map((c) => c.n), 0);
  return out.filter((c) => c.n >= Math.max(1, big * 0.08)).map((c) => c.sum / c.n);
}

/**
 * Herzstück: Seiten (Textschnipsel) → Buchungen.
 * Wirft einen verständlichen Fehler, wenn das PDF keinen Text hat (eingescannt) oder keine Buchungen erkennbar sind.
 */
export function pdfToTable(pages: PdfItem[][]): PdfTable {
  const allItems = pages.reduce((a, p) => a + p.length, 0);
  if (allItems === 0) throw new AppError('Das PDF enthält keinen lesbaren Text – vermutlich ist es eingescannt. Bitte den Kontoauszug als PDF aus dem Online-Banking oder der Banking-App laden.');
  const lines = pages.flatMap((p, i) => linesOf(p, i));
  const year = yearResolver(lines.map((l) => l.text));

  // Kopf-/Fußzeilen: gleicher Text (Ziffern egal) auf mehreren Seiten
  const shape = (t: string) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const pagesOf = new Map<string, Set<number>>();
  for (const l of lines) { const k = shape(l.text); (pagesOf.get(k) ?? pagesOf.set(k, new Set()).get(k)!).add(l.page); }
  // nur oberhalb der ersten bzw. unterhalb der letzten Buchung einer Seite – Buchungstexte selbst wiederholen sich oft (z. B. „Kartenzahlung“)
  const txLike = (l: Line) => { const { dates, rest } = leadingDates(l.segs); return dates.length > 0 && rest.some((x) => isPdfMoney(x.t)) && !isBalLine(l.segs); };
  const span = new Map<number, { top: number; bot: number }>();
  for (const l of lines) if (txLike(l)) { const s0 = span.get(l.page); span.set(l.page, s0 ? { top: Math.max(s0.top, l.y), bot: Math.min(s0.bot, l.y) } : { top: l.y, bot: l.y }); }
  const outside = (l: Line) => { const sp = span.get(l.page); return !sp || l.y > sp.top + 0.5 || l.y < sp.bot - 0.5 && !txLike(l) && (l.y < sp.bot - 4 * l.h); };
  const repeated = (l: Line) => pages.length >= 2 && !txLike(l) && outside(l) && (pagesOf.get(shape(l.text))?.size ?? 0) >= Math.max(2, Math.ceil(pages.length * 0.6));
  const isPageNo = (t: string) => /^(seite|blatt|page)\s*\d+(\s*(von|\/|of)\s*\d+)?$/i.test(t.trim()) || /^\d+\s*\/\s*\d+$/.test(t.trim());

  // Kopfzeile der Tabelle (für Spaltennamen Soll/Haben/Saldo und Fingerabdruck)
  const head = lines.find((l) => l.segs.filter((s) => HEAD_WORDS.test(s.t.replace(/[:.]/g, '').trim())).length >= 2);

  // Kontostände (Kontrollrechnung)
  const balance: PdfBalance = { openCents: null, closeCents: null };
  const balLines = lines.filter((l) => isBalLine(l.segs) && !/übertrag\s+(auf|von)\s+(blatt|seite)/i.test(l.text) && !/zwischensumme|summe\b/i.test(l.text));
  const balMoney = (l: Line) => {
    const ms = l.segs.map((s) => moneyOf(s.t)).filter(Boolean) as { cents: number; side: -1 | 0 | 1 }[];
    const m = ms[ms.length - 1];
    return m ? (m.side === -1 ? -m.cents : m.cents) : null;
  };
  const opens = balLines.filter((l) => OPEN_RE.test(l.text) && balMoney(l) !== null);
  const closes = balLines.filter((l) => CLOSE_RE.test(l.text) && !OPEN_RE.test(l.text) && balMoney(l) !== null);
  if (opens.length) balance.openCents = balMoney(opens[0]!);
  if (closes.length) balance.closeCents = balMoney(closes[closes.length - 1]!);
  if (balance.openCents === null && balance.closeCents === null) {
    // „Kontostand am 01.10.2026 … / Kontostand am 31.10.2026 …“: erster = alt, letzter = neu
    const ks = balLines.filter((l) => /kontostand|saldo/i.test(l.text) && balMoney(l) !== null);
    if (ks.length >= 2) { balance.openCents = balMoney(ks[0]!); balance.closeCents = balMoney(ks[ks.length - 1]!); }
  }

  // Buchungszeilen und ihr Folgetext
  interface Tx { line: Line; dates: string[]; text: string[]; money: Seg[]; signs: string[]; cont: string[] }
  const txs: Tx[] = [];
  let cur: Tx | null = null;
  let prevY = 0, prevPage = -1;
  for (const l of lines) {
    const sameBlock: boolean = !!cur && l.page === prevPage && prevY - l.y <= 2.6 * l.h;
    if (repeated(l) || isPageNo(l.text) || l === head || (head && shape(l.text) === shape(head.text))) { if (l.page !== prevPage) cur = null; continue; }
    const { dates, rest } = leadingDates(l.segs);
    const money: Seg[] = [];
    const signs: string[] = [];
    // Beträge von rechts: Betragsspalten stehen am Zeilenende (ggf. mit eigenem S/H-Feld)
    const r = [...rest];
    while (r.length) {
      const s = r[r.length - 1]!;
      if (/^(EUR|€)$/i.test(s.t) && r.length >= 2) { r.pop(); continue; } // Währung als eigenes Feld
      if (isPdfMoney(s.t)) { money.unshift(r.pop()!); continue; }
      if (SIGN_ONLY.test(s.t) && r.length >= 2 && isPdfMoney(r[r.length - 2]!.t)) { signs.unshift(s.t); r.pop(); continue; }
      break;
    }
    const isBal = isBalLine(l.segs);
    if (dates.length && !isBal && (money.length || r.length)) {
      // Buchung beginnt (Betrag steht meist in derselben Zeile, bei manchen Banken erst in der letzten Zeile des Blocks)
      cur = { line: l, dates, text: r.map((s) => s.t), money, signs, cont: [] };
      txs.push(cur);
    } else if (cur && sameBlock && !isBal && !dates.length) {
      if (!cur.money.length && money.length) {
        cur.money = money; cur.signs = signs;
        if (r.length) cur.cont.push(r.map((s) => s.t).join(' '));
      } else {
        // Folgezeile: gehört zur Buchung darüber (Empfänger, Verwendungszweck, IBAN …)
        cur.cont.push(l.segs.map((s) => s.t).join(' '));
      }
    } else {
      cur = isBal ? null : cur && sameBlock ? cur : null;
    }
    prevY = l.y; prevPage = l.page;
  }
  // Datumszeilen ohne Betrag (z. B. „01.10.2026 Kontoauszug Nr. 10“) sind keine Buchungen
  for (let i = txs.length - 1; i >= 0; i--) if (!txs[i]!.money.length) txs.splice(i, 1);
  if (txs.length === 0) throw new AppError('Im PDF wurden keine Buchungen erkannt (Zeilen mit Datum und Betrag). Ist es ein Kontoauszug?');

  // Betragsspalten: rechte Kanten gruppieren
  const tol = Math.max(6, (txs[0]!.line.h || 10) * 1.2);
  const cols = clusters(txs.flatMap((t) => t.money.map((m) => m.x1)), tol);
  const colOf = (m: Seg) => cols.reduce((best, c, i) => (Math.abs(c - m.x1) < Math.abs(cols[best]! - m.x1) ? i : best), 0);
  // Spaltennamen aus der Kopfzeile (nächstgelegenes Kopf-Feld zur rechten Kante)
  const label = (ci: number) => {
    if (!head) return '';
    const x = cols[ci]!;
    const near = head.segs.map((s) => ({ s, d: Math.min(Math.abs(s.x1 - x), Math.abs((s.x0 + s.x1) / 2 - x)) })).sort((a, b) => a.d - b.d)[0];
    return near && near.d < 60 ? near.s.t.toLowerCase() : '';
  };
  type Role = 'amount' | 'debit' | 'credit' | 'balance';
  const roles: Role[] = cols.map((): Role => 'amount');
  let byLabel = false;
  if (cols.length >= 2) {
    const labels = cols.map((_, i) => label(i));
    const both = txs.filter((t) => new Set(t.money.map(colOf)).size >= 2).length / txs.length;
    cols.forEach((_, i) => {
      const lb = labels[i]!;
      if (/saldo|kontostand/.test(lb)) roles[i] = 'balance';
      else if (/soll|belastung|ausgang|lastschrift/.test(lb)) roles[i] = 'debit';
      else if (/haben|gutschrift|eingang/.test(lb)) roles[i] = 'credit';
    });
    byLabel = !roles.every((r): boolean => r === 'amount');
    if (!byLabel) {
      if (both > 0.6) roles[cols.length - 1] = 'balance'; // jede Zeile hat zwei Beträge: rechts der laufende Saldo
      else if (cols.length === 2) { roles[0] = 'debit'; roles[1] = 'credit'; }
    }
  }

  // Zeilen bauen (mit einer Rollenverteilung der Betragsspalten)
  const build = (roles: Role[]): PdfRow[] => {
  const rows: PdfRow[] = [];
  for (const t of txs) {
    let cents: number | null = null, debit = '', credit = '', bal = '';
    let explicit = false;
    t.money.forEach((m, k) => {
      const mv = moneyOf(m.t);
      if (!mv) return;
      const role = roles[colOf(m)] ?? 'amount';
      const signTxt = t.signs[k] ?? (t.money.length === 1 ? t.signs[0] : undefined);
      let side = mv.side;
      if (signTxt && /^(s|soll|[-−])$/i.test(signTxt)) side = -1;
      if (signTxt && /^(h|haben|\+)$/i.test(signTxt)) side = 1;
      if (role === 'balance') { bal = centsText(side === -1 ? -mv.cents : mv.cents); return; }
      if (role === 'debit') { debit = centsText(mv.cents); cents = (cents ?? 0) - mv.cents; explicit = true; return; }
      if (role === 'credit') { credit = centsText(mv.cents); cents = (cents ?? 0) + mv.cents; explicit = true; return; }
      if (cents === null) { cents = side === -1 ? -mv.cents : mv.cents; explicit = side !== 0; }
    });
    if (cents === null || cents === 0) continue;
    // ohne Vorzeichen im PDF: Eingänge am Buchungstext erkennen, sonst Ausgabe
    if (!explicit) {
      const all = `${t.text.join(' ')} ${t.cont.join(' ')}`;
      cents = /\b(gutschrift|lohn|gehalt|eingang|zinsgutschrift|erstattung|rückzahlung|einzahlung)\b/i.test(all) ? Math.abs(cents) : -Math.abs(cents);
    }
    // Text: Vorgang (z. B. „Lastschrift“), Empfänger, Verwendungszweck
    const first = t.text.join(' ').trim();
    const tw = TYPE_WORDS.find((w) => first.toLowerCase().startsWith(w) && (first.length === w.length || /[\s,:/-]/.test(first[w.length]!)));
    const type = tw ? first.slice(0, tw.length) : '';
    const after = tw ? first.slice(tw.length).replace(/^[\s,:/-]+/, '').trim() : first;
    const cont = t.cont.map((c) => c.trim()).filter(Boolean);
    const payee = after || cont.shift() || '';
    const booking = fmtDate(t.dates[0]!, year);
    if (!booking) continue;
    rows.push({ booking, value: t.dates[1] ? fmtDate(t.dates[1], year) ?? '' : '', type, payee, zweck: cont.join(' '), cents, debit, credit, balance: bal });
  }
  // Laufender Saldo ohne Vorzeichen in den Beträgen: Richtung aus der Saldo-Änderung ableiten
  if (roles.includes('balance')) {
    for (let i = 0; i < rows.length; i++) {
      const a = i > 0 ? rows[i - 1]!.balance : balance.openCents !== null ? centsText(balance.openCents) : '', b = rows[i]!.balance;
      if (!a || !b) continue;
      const pa = parseSignedAmount(a) ?? 0, pb = parseSignedAmount(b) ?? 0;
      if (Math.abs(pb - pa) === Math.abs(rows[i]!.cents)) rows[i]!.cents = pb - pa;
    }
  }
  return rows;
  };
  const diffOf = (rs: PdfRow[]) => (balance.openCents !== null && balance.closeCents !== null ? balance.closeCents - balance.openCents - rs.reduce((a, r) => a + r.cents, 0) : null);
  let rows = build(roles);
  // Zwei Betragsspalten ohne Spaltennamen: die Deutung nehmen, bei der der Kontostand aufgeht (Soll/Haben oder Betrag/Saldo)
  if (cols.length === 2 && !byLabel && diffOf(rows) !== 0 && diffOf(rows) !== null) {
    const alt: Role[] = roles[1] === 'balance' ? ['debit', 'credit'] : ['amount', 'balance'];
    const rowsAlt = build(alt);
    if (diffOf(rowsAlt) === 0) { rows = rowsAlt; roles.splice(0, 2, ...alt); }
  }
  if (rows.length === 0) throw new AppError('Im PDF wurden keine Buchungen erkannt (Zeilen mit Datum und Betrag). Ist es ein Kontoauszug?');

  // Kontrollrechnung
  const diffCents = diffOf(rows);

  // CSV für den gewohnten Weg; Spalten nur, wenn sie etwas enthalten
  const has = (k: keyof PdfRow) => rows.some((r) => r[k] !== '');
  const colsOut: [string, (r: PdfRow) => string][] = [
    ['Buchungstag', (r) => r.booking],
    ...(has('value') ? [['Wertstellung', (r: PdfRow) => r.value] as [string, (r: PdfRow) => string]] : []),
    ['Vorgang', (r) => r.type],
    ['Empfänger', (r) => r.payee],
    ['Verwendungszweck', (r) => r.zweck],
    ['Betrag', (r) => centsText(r.cents)],
    ...(has('debit') ? [['Soll', (r: PdfRow) => r.debit] as [string, (r: PdfRow) => string]] : []),
    ...(has('credit') ? [['Haben', (r: PdfRow) => r.credit] as [string, (r: PdfRow) => string]] : []),
    ...(has('balance') ? [['Saldo', (r: PdfRow) => r.balance] as [string, (r: PdfRow) => string]] : [])
  ];
  const text = [colsOut.map(([h]) => h).join(';'), ...rows.map((r) => colsOut.map(([, f]) => csvCell(f(r))).join(';'))].join('\n');
  const signature = 'pdf:' + (head ? head.segs.map((s) => s.t.toLowerCase().replace(/[^a-zäöü]/g, '')).filter(Boolean).join('|') : `${roles.join('+')}`);
  return { rows, text, signature, balance, diffCents, pages: pages.length };
}
