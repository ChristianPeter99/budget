import { useMemo, useState } from 'react';
import { Header } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { runRecurring, saveRecurring } from '../db/repo';
import { bookable, guessFixCategory } from '../import/csv';
import type { FixFound } from '../import/csv';
import type { Recurring } from '../domain/types';
import { currentMonthKey, formatDateDE } from '../domain/dates';
import { formatEUR } from '../domain/money';

const FACTOR = { monthly: 1, quarterly: 4, halfyearly: 2, yearly: 1 } as const;
const IV_TEXT = { monthly: 'monatlich', quarterly: 'vierteljährlich', halfyearly: 'halbjährlich', yearly: 'jährlich' } as const;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Betrag so, wie die Vorlage ihn speichert: monatlich je Monat, sonst als Jahresbetrag. */
export const templateCents = (f: FixFound) => f.amountCents * FACTOR[f.interval];
const storedCents = (r: Recurring) => (r.interval === 'yearly' ? r.yearlyCents ?? r.amountCents * 12 : r.amountCents);

/** Gibt es die Fixkosten schon? Gleicher (oder enthaltener) Name, gleiche Art. */
export function findExisting(f: FixFound, list: Recurring[]): Recurring | undefined {
  const n = norm(f.name);
  if (!n) return undefined;
  return list.find((r) => r.type === 'expense' && norm(r.name) === n)
    ?? list.find((r) => { const m = norm(r.name); return r.type === 'expense' && m.length >= 4 && n.length >= 4 && (m.includes(n) || n.includes(m)); });
}

type Row = { f: FixFound; on: boolean; cat: string; old?: Recurring; same: boolean };

/**
 * „Fixkosten erkannt“: Aus einem Kontoauszug gefundene wiederkehrende Zahlungen, die einmalig als Vorlagen
 * in den Reiter Fixkosten übernommen werden. Es werden keine einzelnen Buchungen importiert.
 */
export function FixImport({ found, fileName, onDone, onRemap }: { found: FixFound[]; fileName: string; onDone: () => void; onRemap?: () => void }) {
  const { data, run, flash, reload } = useStore();
  const pool = useMemo(() => bookable(data.categories, 'expense').filter((c) => c.group === 'fix' && !c.archived), [data.categories]);
  const byId = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);
  const label = (id: string) => { const c = byId.get(id); const p = c?.parentId ? byId.get(c.parentId) : undefined; return p ? `${p.name} › ${c!.name}` : c?.name ?? ''; };
  const [rows, setRows] = useState<Row[]>(() => found.map((f) => {
    const old = findExisting(f, data.recurring);
    const same = !!old && storedCents(old) === templateCents(f);
    const cat = old?.categoryId ?? guessFixCategory(f, data.categories, data.settings.importRules ?? {}) ?? pool[0]?.id ?? '';
    return { f, on: !old, cat, old, same };
  }));
  const [back, setBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = rows.filter((r) => r.on && r.cat);
  const upd = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const newCount = rows.filter((r) => !r.old).length;
  const known = rows.length - newCount;

  async function commit() {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    const cur = currentMonthKey();
    const n = await run(async (db) => {
      let k = 0;
      for (const r of chosen) {
        const { f } = r;
        const start = r.old ? r.old.startMonth : back ? f.first.slice(0, 7) : cur;
        await saveRecurring(db, r.old?.id ?? null, {
          name: r.old?.name ?? f.name, type: 'expense', categoryId: r.cat, startMonth: start,
          day: Math.min(28, Math.max(1, r.old?.day ?? f.day)), active: r.old?.active ?? true,
          interval: f.interval === 'monthly' ? 'monthly' : 'yearly', amountCents: templateCents(f),
          dueMonth: f.interval === 'yearly' ? f.dueMonth : null, notice: r.old?.notice ?? null
        }, cur);
        k++;
      }
      await runRecurring(db, cur);
      return k;
    });
    setBusy(false);
    if (n !== undefined) { flash(`${n} Fixkosten übernommen`, 'ok'); await reload(); onDone(); }
  }

  return (
    <>
      <button className="back" onClick={onDone}><Icon name="left" size={16} w={2.2} />Import</button>
      <Header kicker={fileName} title="Fixkosten erkannt" />
      <p className="note">
        {found.length === 1 ? '1 wiederkehrende Zahlung' : `${found.length} wiederkehrende Zahlungen`} gefunden{known ? `, davon ${known} schon in Fixkosten` : ''}.
        Ausgewählte kommen einmalig als Vorlage in den Reiter Fixkosten. Einzelne Buchungen werden dabei nicht importiert.
      </p>
      <div className="card flush fixlist" role="list">
        {rows.map((r, i) => {
          const { f } = r;
          const t = templateCents(f);
          return (
            <div key={f.key} role="listitem" className={'fixrow' + (r.on ? ' on' : '') + (r.same ? ' known' : '')}>
              <label className="fixhead">
                <input type="checkbox" checked={r.on} onChange={(e) => upd(i, { on: e.target.checked })} aria-label={`${f.name} übernehmen`} />
                <span className="fixname">{f.name}</span>
                <b className="num">{formatEUR(t)}{f.interval === 'monthly' ? '' : ' / Jahr'}</b>
              </label>
              <div className="fixmeta">
                {IV_TEXT[f.interval]}{f.interval === 'quarterly' || f.interval === 'halfyearly' ? ` à ${formatEUR(f.amountCents)}` : ''} · {f.count}× gefunden · zuletzt {formatDateDE(f.last)}{f.varies ? ' · Betrag schwankt' : ''}
              </div>
              {r.old && (r.same
                ? <div className="fixstate ok">Schon in Fixkosten</div>
                : <div className="fixstate warn">Schon vorhanden mit {formatEUR(storedCents(r.old))}{r.old.interval === 'yearly' ? ' / Jahr' : ''} – {r.on ? 'Betrag wird geändert' : 'antippen, um den Betrag zu ändern'}</div>)}
              {r.on && (
                <select className="fixcat" value={r.cat} onChange={(e) => upd(i, { cat: e.target.value })} aria-label={`Kategorie für ${f.name}`}>
                  {!r.cat && <option value="">Kategorie wählen</option>}
                  {pool.map((c) => <option key={c.id} value={c.id}>{label(c.id)}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
      <label className="field cmapcheck"><input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} /><span>Rückwirkend ab der ersten Zahlung in der Datei buchen</span></label>
      {onRemap && <button className="linkbtn" onClick={onRemap}>Spalten falsch erkannt? Zuordnung ändern</button>}
      <button className="btn" disabled={busy || chosen.length === 0} onClick={() => void commit()}>
        {chosen.length === 0 ? 'Nichts ausgewählt' : `${chosen.length} in Fixkosten übernehmen`}
      </button>
    </>
  );
}
