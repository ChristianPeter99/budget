import { useState } from 'react';
import { bookable, guessFixCategory } from '../import/csv';
import type { Candidate, FixFound } from '../import/csv';
import { runRecurring, saveRecurring } from '../db/repo';
import type { Db } from '../db/db';
import type { Category, Recurring } from '../domain/types';
import { currentMonthKey, formatDateDE, monthLabel } from '../domain/dates';
import { formatEUR } from '../domain/money';
import { Icon } from './icons';

const FACTOR = { monthly: 1, quarterly: 4, halfyearly: 2, yearly: 1 } as const;
export const IV_TEXT = { monthly: 'monatlich', quarterly: 'vierteljährlich', halfyearly: 'halbjährlich', yearly: 'jährlich' } as const;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Betrag so, wie die Vorlage ihn speichert: monatlich je Monat, sonst als Jahresbetrag. */
export const templateCents = (f: FixFound) => f.amountCents * FACTOR[f.interval];
export const storedCents = (r: Recurring) => (r.interval === 'yearly' ? r.yearlyCents ?? r.amountCents * 12 : r.amountCents);

/** Gibt es die Fixkosten schon? Gleicher (oder enthaltener) Name, gleiche Art. */
export function findExisting(f: FixFound, list: Recurring[]): Recurring | undefined {
  const n = norm(f.name);
  if (!n) return undefined;
  return list.find((r) => r.type === 'expense' && norm(r.name) === n)
    ?? list.find((r) => { const m = norm(r.name); return r.type === 'expense' && m.length >= 4 && n.length >= 4 && (m.includes(n) || n.includes(m)); });
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
  const pool = fixPool(cats);
  const c = cat ?? old?.categoryId ?? guessFixCategory(f, cats, rules) ?? pool[0]?.id ?? '';
  return { f, on: true, cat: c, old, same, keys: keys ?? memberKeys(f, cands) };
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

/** Vorlagen speichern: Beginn im Monat der letzten Zahlung (die importierten Buchungen werden ihr zugeordnet). */
export async function saveFixRows(db: Db, rows: FixRow[]): Promise<number> {
  const cur = currentMonthKey();
  let n = 0;
  for (const r of rows) {
    if (!willSave(r)) continue;
    const { f } = r;
    const lastMonth = f.last.slice(0, 7);
    await saveRecurring(db, r.old?.id ?? null, {
      name: r.old?.name ?? f.name, type: 'expense', categoryId: r.cat,
      startMonth: r.old ? r.old.startMonth : r.start ?? (lastMonth > cur ? cur : lastMonth),
      day: Math.min(28, Math.max(1, r.old?.day ?? f.day)), active: r.old?.active ?? true,
      interval: f.interval === 'monthly' ? 'monthly' : 'yearly', amountCents: templateCents(f),
      dueMonth: f.interval === 'yearly' ? f.dueMonth : null, notice: r.old?.notice ?? null
    }, cur);
    n++;
  }
  if (n) await runRecurring(db, cur);
  return n;
}

/** Eine Buchung aus der Datei, die zur Zahlung gehören kann */
export interface FixMember { key: string; date: string; amountCents: number; detail: string; in: boolean; on: boolean }

/** Liste „Fixkosten erkannt“ in der Prüfliste. */
export function FixList({ rows, cats, booked, members, onChange, onToggle, onMember, onUnmark }: {
  rows: FixRow[]; cats: Category[]; booked: number[]; members: (i: number) => FixMember[];
  onChange: (i: number, p: Partial<FixRow>) => void; onToggle: (i: number, on: boolean) => void; onMember: (i: number, key: string, inFix: boolean) => void; onUnmark: (i: number) => void;
}) {
  const pool = fixPool(cats);
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const label = (id: string) => { const c = byId.get(id); const p = c?.parentId ? byId.get(c.parentId) : undefined; return p ? `${p.name} › ${c!.name}` : c?.name ?? ''; };
  return (
    <div className="card flush fixlist" role="list" aria-label="Fixkosten erkannt">
      {rows.map((r, i) => {
        const { f } = r;
        const t = templateCents(f);
        const n = booked[i] ?? 0;
        const isOpen = open === f.key;
        const ms = isOpen ? members(i) : [];
        return (
          <div key={f.key} role="listitem" className={'fixrow' + (r.on ? ' on' : ' off') + (r.same ? ' known' : '')}>
            <label className="fixhead">
              <input type="checkbox" checked={r.on} onChange={(e) => onToggle(i, e.target.checked)} aria-label={`${f.name} übernehmen`} />
              <span className="fixname">{f.name}</span>
              <b className="num">{formatEUR(t)}{f.interval === 'monthly' ? '' : ' / Jahr'}</b>
            </label>
            <div className="fixmeta">
              {IV_TEXT[f.interval]}{f.interval === 'quarterly' || f.interval === 'halfyearly' ? ` à ${formatEUR(f.amountCents)}` : ''} · {r.manual ? 'von dir gewählt' : `${f.count}× gefunden`} · zuletzt {formatDateDE(f.last)}{f.varies ? ' · Betrag schwankt' : ''}{!r.old && r.on ? ` · Vorlage ab ${monthLabel(r.start ?? (f.last.slice(0, 7) > currentMonthKey() ? currentMonthKey() : f.last.slice(0, 7)))}` : ''}
            </div>
            {r.old && (r.same
              ? <div className="fixstate ok">Schon in Fixkosten – es wird keine neue Vorlage angelegt</div>
              : <>
                <div className="fixstate warn">Schon in Fixkosten mit {formatEUR(storedCents(r.old))}{r.old.interval === 'yearly' ? ' / Jahr' : ''}</div>
                {r.on && <label className="fixupd"><input type="checkbox" checked={!!r.update} onChange={(e) => onChange(i, { update: e.target.checked })} /><span>Betrag in Fixkosten auf {formatEUR(t)} ändern</span></label>}
              </>)}
            {r.on && !r.old && (
              <div className="fixsel">
                <select className="fixcat" value={r.cat} onChange={(e) => onChange(i, { cat: e.target.value })} aria-label={`Kategorie für ${f.name}`}>
                  {!r.cat && <option value="">Kategorie wählen</option>}
                  {pool.map((c) => <option key={c.id} value={c.id}>{label(c.id)}</option>)}
                </select>
                <select className="fixcat fixiv" value={f.interval} onChange={(e) => onChange(i, { f: { ...f, interval: e.target.value as FixFound['interval'] } })} aria-label={`Rhythmus für ${f.name}`}>
                  {(Object.keys(IV_TEXT) as FixFound['interval'][]).map((k) => <option key={k} value={k}>{IV_TEXT[k]}</option>)}
                </select>
              </div>
            )}
            <div className="fixfoot">
              <button className="linkbtn fixmem" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : f.key)}>
                {r.keys.length === 1 ? '1 Zahlung' : `${r.keys.length} Zahlungen`} · {r.on ? (n === 0 ? 'keine neu' : `${n} neu`) : 'nicht übernommen'}
                <Icon name={isOpen ? 'up' : 'down'} size={14} w={2.4} />
              </button>
              <button className="linkbtn" onClick={() => onUnmark(i)}>Keine Fixkosten</button>
            </div>
            {isOpen && (
              <div className="fixmembers" role="group" aria-label={`Welche Buchungen sind ${f.name}?`}>
                <p className="mini">Welche Buchungen sind wirklich diese Fixkosten? Der Betrag der letzten gewählten wird zur Vorlage; nicht gewählte bleiben normale Ausgaben.</p>
                {ms.map((m) => (
                  <label key={m.key} className={'fixmemrow' + (m.in ? '' : ' out')}>
                    <input type="checkbox" checked={m.in} onChange={(e) => onMember(i, m.key, e.target.checked)} aria-label={`${formatDateDE(m.date)} ${formatEUR(m.amountCents)} gehört zu ${f.name}`} />
                    <span>{formatDateDE(m.date)}{m.detail ? ` · ${m.detail}` : ''}</span>
                    <b className="num">{formatEUR(m.amountCents)}</b>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
