/** Obergrenze für einzelne Beträge: 99.999.999,99 €. Verhindert Überläufe und Tippfehler. */
export const MAX_CENTS = 9_999_999_999;

/**
 * Wandelt Nutzereingaben wie "12,5", "1.234,56" oder "1234.56" in ganzzahlige Cent um.
 * Gibt null zurück bei leeren, negativen, null-, nicht-numerischen oder zu großen Beträgen
 * sowie bei mehr als zwei Nachkommastellen.
 */
export function parseCents(input: string): number | null {
  const s = String(input ?? '').replace(/[\s€ ]/g, '');
  if (!s || s.startsWith('-') || s.startsWith('+') || s.startsWith('−')) return null;
  let intPart: string;
  let frac = '';
  if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length !== 2) return null;
    const [a, b] = parts as [string, string];
    if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(a)) return null;
    intPart = a.replace(/\./g, '');
    frac = b;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    intPart = s.replace(/\./g, '');
  } else if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length !== 2) return null;
    intPart = parts[0] as string;
    frac = parts[1] as string;
  } else {
    intPart = s;
  }
  if (!/^\d+$/.test(intPart)) return null;
  if (frac !== '' && !/^\d{1,2}$/.test(frac)) return null;
  const cents = Number(intPart) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

const grouping = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/** 123456 → "1.234,56 €" (rein ganzzahlig gerechnet, kein Gleitkomma). */
export function formatEUR(cents: number): string {
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${cents < 0 ? '−' : ''}${grouping.format(euros)},${String(rest).padStart(2, '0')} €`;
}

/** 1250 → "12,50" (für Eingabefelder) */
export function centsToInput(cents: number): string {
  return `${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}

export const sumCents = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/** Prozentanteil, kaufmännisch auf ganze Cent gerundet. */
export const percentOf = (cents: number, pct: number): number => Math.round((cents * pct) / 100);

/** 12345678 → "123.456,78" (Eingabefeld mit Tausenderpunkten) */
export function centsToGroupedInput(cents: number): string {
  const abs = Math.abs(cents);
  return `${grouping.format(Math.floor(abs / 100))},${String(abs % 100).padStart(2, '0')}`;
}

/** Ganze Euro mit Tausenderpunkten, z. B. für Depotstände: 10000000 → "100.000 €" */
export function formatEUR0(cents: number): string {
  return `${cents < 0 ? '−' : ''}${grouping.format(Math.round(Math.abs(cents) / 100))} €`;
}

/**
 * Formatiert eine Betragseingabe während des Tippens: nur Ziffern und ein Komma, höchstens zwei
 * Nachkommastellen, Tausenderpunkte im ganzzahligen Teil. "100000" → "100.000", "1234,5" → "1.234,5".
 */
export function formatAmountTyping(raw: string): string {
  let s = raw.replace(/[^\d,]/g, '');
  const i = s.indexOf(',');
  let int = i >= 0 ? s.slice(0, i) : s;
  let dec = i >= 0 ? s.slice(i + 1).replace(/,/g, '').slice(0, 2) : null;
  int = int.replace(/^0+(?=\d)/, '').slice(0, 9);
  if (int === '' && dec !== null) int = '0';
  const grouped = int === '' ? '' : int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  s = dec !== null ? `${grouped},${dec}` : grouped;
  return s;
}
