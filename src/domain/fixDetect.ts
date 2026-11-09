// Fixkosten im Kontoauszug erkennen und mit bestehenden Vorlagen abgleichen.
import { bookable, guessFixCategory } from './statement';
import type { Candidate, FixFound } from './statement';
import type { Category, Recurring } from './types';

const FACTOR = { monthly: 1, quarterly: 4, halfyearly: 2, yearly: 1 } as const;
export const IV_TEXT = { monthly: 'monatlich', quarterly: 'vierteljährlich', halfyearly: 'halbjährlich', yearly: 'jährlich' } as const;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Betrag so, wie die Vorlage ihn speichert: monatlich je Monat, sonst als Jahresbetrag. */
export const templateCents = (f: FixFound) => f.amountCents * FACTOR[f.interval];
export const storedCents = (r: Recurring) => (r.interval === 'yearly' ? r.yearlyCents ?? r.amountCents * 12 : r.amountCents);

/**
 * Gibt es die Fixkosten schon? Gleicher (oder enthaltener) Name UND ähnlicher Betrag – sonst wäre z. B. die
 * Kfz-Versicherung bei der HUK „schon vorhanden“, obwohl es um die Haftpflicht geht. Bei mehreren: der nächste Betrag.
 */
export function findExisting(f: FixFound, list: Recurring[]): Recurring | undefined {
  const n = norm(f.name), base = norm(f.name.split(' · ')[0] ?? '');
  if (!n) return undefined;
  const t = templateCents(f);
  const named = list.filter((r) => {
    if (r.type !== 'expense') return false;
    const m = norm(r.name);
    return m === n || (m.length >= 4 && n.length >= 4 && (m.includes(n) || n.includes(m))) || (base.length >= 4 && m.includes(base));
  });
  const near = named.filter((r) => Math.abs(storedCents(r) - t) <= Math.max(500, t * 0.25));
  return near.sort((a, b) => Math.abs(storedCents(a) - t) - Math.abs(storedCents(b) - t))[0];
}

/** Eine erkannte (oder von Hand markierte) Fixkosten-Zahlung in der Prüfliste */
export interface FixRow {
  f: FixFound;
  /** übernehmen: die Buchungen aus der Datei und (falls neu) die Vorlage im Reiter Fixkosten */
  on: boolean;
  /** schon vorhanden mit anderem Betrag: Betrag der Vorlage ändern */
  update?: boolean;
  cat: string;
  old?: Recurring;
  /** schon in Fixkosten mit gleichem Betrag */
  same: boolean;
  /** Zeilen der Datei, die zu dieser Zahlung gehören (werden als Buchungen dieser Fixkosten übernommen) */
  keys: string[];
  manual?: boolean;
  /** Beginn der Vorlage (Monat); sonst der Monat der letzten Zahlung */
  start?: string;
}

/** Zeilen einer Zahlung: gleicher Empfänger, Ausgabe, Betrag nah an der erkannten Rate. */
export function memberKeys(f: FixFound, cands: Candidate[]): string[] {
  const tol = Math.max(500, Math.round(f.amountCents * 0.2));
  return cands.filter((c) => c.kind === 'expense' && c.payeeKey === f.payeeKey && Math.abs(c.amountCents - f.amountCents) <= tol).map((c) => c.key);
}

export function fixPool(cats: Category[]): Category[] {
  return bookable(cats, 'expense').filter((c) => c.group === 'fix' && !c.archived);
}

export function makeFixRow(f: FixFound, cands: Candidate[], cats: Category[], recurring: Recurring[], rules: Record<string, string>, keys?: string[], cat?: string): FixRow {
  const old = findExisting(f, recurring);
  const same = !!old && storedCents(old) === templateCents(f);
  // Ohne eindeutigen Hinweis keine Kategorie raten (früher landete alles Unklare in „Wohnen“)
  const c = cat ?? old?.categoryId ?? guessFixCategory(f, cats, rules) ?? '';
  return { f, on: true, cat: c, old, same, keys: keys ?? f.keys ?? memberKeys(f, cands) };
}

/** Von Hand markiert: aus den Zeilen eines Händlers eine Fixkosten-Zahlung bauen. */
export function fixFromCandidates(list: Candidate[]): FixFound {
  const s = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const last = s[s.length - 1]!;
  const months = new Set(s.map((c) => c.date.slice(0, 7)));
  const days = s.map((c) => Number(c.date.slice(8, 10))).sort((a, b) => a - b);
  return {
    key: 'm:' + last.payeeKey, name: last.payee, payeeKey: last.payeeKey, amountCents: last.amountCents, interval: 'monthly', count: months.size,
    first: s[0]!.date, last: last.date, day: Math.min(28, Math.max(1, days[Math.floor(days.length / 2)] ?? 1)), dueMonth: Number(last.date.slice(5, 7)),
    varies: s.some((c) => c.amountCents !== last.amountCents), hint: `${last.raw.zweck} ${last.raw.type}`.slice(0, 200)
  };
}

/** Wird beim Übernehmen eine Vorlage angelegt bzw. geändert? */
export const willSave = (r: FixRow) => r.on && !!r.cat && r.keys.length > 0 && (!r.old || (!r.same && !!r.update));

/** Gewählte Buchungen einer Zahlung neu auswerten (Betrag, Anzahl, letzte Zahlung); Name und Rhythmus bleiben. */
export function withMembers(r: FixRow, cands: Candidate[]): FixRow {
  if (cands.length === 0) return { ...r, keys: [] };
  const nf = { ...fixFromCandidates(cands), key: r.f.key, name: r.f.name, interval: r.f.interval, hint: r.f.hint };
  return { ...r, f: nf, keys: cands.map((c) => c.key), same: !!r.old && storedCents(r.old) === templateCents(nf) };
}

/** Vorauswahl: je Händler die Zahlungen nahe am häufigsten Betrag (Zusatzkäufe beim selben Händler bleiben außen vor) */
export function likelyFix(cs: Candidate[]): Set<string> {
  const out = new Set<string>();
  const by = new Map<string, Candidate[]>();
  for (const c of cs) by.set(c.payeeKey, [...(by.get(c.payeeKey) ?? []), c]);
  for (const list of by.values()) {
    const cnt = new Map<number, number>();
    for (const c of list) cnt.set(c.amountCents, (cnt.get(c.amountCents) ?? 0) + 1);
    const mode = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
    const tol = Math.max(100, Math.round(mode * 0.1));
    for (const c of list) if (Math.abs(c.amountCents - mode) <= tol) out.add(c.key);
  }
  return out;
}
