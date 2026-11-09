import { useState } from 'react';
import { IV_TEXT, fixPool, storedCents, templateCents } from '../../domain/fixDetect';
import type { FixRow } from '../../domain/fixDetect';
import type { Category } from '../../domain/types';
import { formatEUR } from '../../domain/money';
import { currentMonthKey, formatDateDE, monthLabel } from '../../domain/dates';
import type { FixFound } from '../../domain/statement';
import { Icon } from '../../ui/icons';

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
