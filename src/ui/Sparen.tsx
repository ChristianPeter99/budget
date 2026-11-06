import { useState } from 'react';
import type { ReactNode } from 'react';
import { AmountInput, Chevr, Header, Sheet } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { addDepotEntry, addSavingsEntry, deleteDepotEntry, deleteSavingsEntry, savingsEntries } from '../db/repo';
import { formatDateDE, isValidISODate, monthRange, shiftMonth, todayISO } from '../domain/dates';
import { formatEUR0, parseCents } from '../domain/money';
import type { Recurring } from '../domain/types';
import type { TxPreset } from './TxSheet';
import { GoalsCard } from './Goals';

/** Sparkonto heute geschätzt: letzter erfasster Kontostand plus seitdem gebuchte Sparraten (bis heute). */
export function savingsEstimate(data: ReturnType<typeof useStore>['data'], today = todayISO()): { cents: number; known: boolean } {
  const s = data.settings;
  const isSpar = (catId: string) => data.categories.find((c) => c.id === catId)?.group === 'spar';
  if (!s.savingsBalanceDate) return { cents: 0, known: false };
  const since = data.transactions.filter((t) => t.type === 'expense' && isSpar(t.categoryId) && t.date > (s.savingsBalanceDate as string) && t.date <= today).reduce((a, t) => a + t.amountCents, 0);
  return { cents: s.savingsBalanceCents + since, known: true };
}

/** Verlauf Gesamt (Sparkonto + Depot): an jedem Tag mit einem Eintrag der jeweils letzte bekannte Stand beider Konten, heute als letzter Punkt. */
export function wealthSeries(data: ReturnType<typeof useStore>['data'], today = todayISO()): { date: string; cents: number }[] {
  const depot = [...data.depotEntries].sort((a, b) => a.date.localeCompare(b.date));
  const savHist = [...savingsEntries(data.settings)].sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set([...savHist.map((e) => e.date), ...depot.map((e) => e.date)])].filter((d) => d <= today).sort();
  const latest = <T extends { date: string }>(xs: T[], d: string): T | undefined => { let r: T | undefined; for (const x of xs) { if (x.date <= d) r = x; else break; } return r; };
  const out = dates.map((d) => ({ date: d, cents: (latest(savHist, d)?.cents ?? 0) + (latest(depot, d)?.valueCents ?? 0) }));
  const total = savingsEstimate(data, today).cents + (depot[depot.length - 1]?.valueCents ?? 0);
  if (out.length > 0 && (out[out.length - 1] as { date: string }).date < today) out.push({ date: today, cents: total });
  return out;
}

/** Schlichte Verlaufsfläche (ohne Achsen), x nach Datum, y zwischen Minimum und Maximum. */
function AreaChart({ points, label }: { points: { date: string; cents: number }[]; label: string }) {
  const W = 358, H = 90;
  const t = (d: string) => new Date(d + 'T00:00:00').getTime();
  const t0 = t((points[0] as { date: string }).date), t1 = t((points[points.length - 1] as { date: string }).date);
  const vals = points.map((p) => p.cents);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.05);
  const x = (d: string) => (t1 > t0 ? ((t(d) - t0) / (t1 - t0)) * W : W);
  const y = (c: number) => H - 6 - ((c - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 12);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.cents).toFixed(1)}`).join(' ');
  const lastP = points[points.length - 1] as { date: string; cents: number };
  const mon = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { month: 'short' }).replace('.', '');
  return (
    <div className="wchart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <defs><linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--spar)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--spar)" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line} L${x(lastP.date).toFixed(1)} ${H} L${x((points[0] as { date: string }).date).toFixed(1)} ${H} Z`} fill="url(#wgrad)" />
        <path d={line} fill="none" style={{ stroke: 'var(--spar)' }} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="wlabels" aria-hidden="true"><span>{mon((points[0] as { date: string }).date)}</span><span>{mon(lastP.date)}</span></div>
    </div>
  );
}

/**
 * Sparen & Depot (Variante B): oben die Gesamtsumme mit Verlauf, darunter zwei Kacheln für Sparkonto und Depot
 * (Tipp: Details, Verlauf, „Stand aktualisieren“), dann Sparziele und Sparrate. Eingaben nur noch im Fenster.
 */
export function Sparen({ back, onEditRec }: { back: ReactNode; onAdd?: (p: TxPreset) => void; onEditRec: (r: Recurring) => void }) {
  const { data, run } = useStore();
  const cats = data.categories;
  const s = data.settings;
  const isSpar = (catId: string) => cats.find((c) => c.id === catId)?.group === 'spar';
  const sparRecs = data.recurring.filter((r) => r.active && r.type === 'expense' && isSpar(r.categoryId));
  const rate = sparRecs.reduce((a, r) => a + r.amountCents, 0);
  const today = todayISO();
  const sav = savingsEstimate(data, today);
  const since = sav.known ? sav.cents - s.savingsBalanceCents : 0;
  const savList = savingsEntries(s);
  const entries = [...data.depotEntries].sort((a, b) => b.date.localeCompare(a.date));
  const last = entries[0];
  const prev = entries[1];
  const total = sav.cents + (last?.valueCents ?? 0);
  // Verlauf der letzten 6 Monate (bzw. alles, wenn weniger)
  const series = wealthSeries(data, today);
  const cutoff = monthRange(shiftMonth(today.slice(0, 7), -6)).from;
  const shown = series.filter((p) => p.date >= cutoff).length > 1 ? series.filter((p) => p.date >= cutoff) : series;
  const first = shown[0];
  const diff = first && shown.length > 1 ? total - first.cents : null;
  const [detail, setDetail] = useState<'' | 'spar' | 'depot'>('');
  const [upd, setUpd] = useState<'' | 'spar' | 'depot'>('');
  const depotPct = last && prev && prev.valueCents > 0 ? ((last.valueCents - prev.valueCents) / prev.valueCents) * 100 : null;
  const pctText = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(p).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

  return (
    <>
      {back}
      <Header title="Sparen & Depot" />

      <div className="whero">
        <span className="cap">Gesamt</span>
        <span className="mid34 num">{formatEUR0(total)}</span>
        {diff !== null && first && <span className={'mini ' + (diff >= 0 ? 'pos' : 'neg')}>{diff >= 0 ? '+' : '−'}{formatEUR0(Math.abs(diff))} seit {formatDateDE(first.date)}</span>}
        {shown.length > 1
          ? <AreaChart points={shown} label={`Verlauf Sparkonto und Depot seit ${first ? formatDateDE(first.date) : ''}`} />
          : <p className="note" style={{ margin: '6px 0 0' }}>Trag Stände für Sparkonto und Depot ein – dann erscheint hier der Verlauf.</p>}
      </div>

      <div className="wtiles">
        <button className="wtile" onClick={() => setDetail('spar')} aria-label={`Sparkonto ${sav.known ? formatEUR0(sav.cents) : 'noch kein Stand'} – Details und aktualisieren`}>
          <span className="wname" style={{ color: 'var(--spar)' }}><Icon name="piggy" size={16} w={2.2} />Sparkonto</span>
          <span className="wval num">{sav.known ? formatEUR0(sav.cents) : '–'}</span>
          <span className="wsub">{rate > 0 ? `+${formatEUR0(rate)} / Monat` : sav.known ? 'keine Sparrate' : 'Stand eintragen'}</span>
        </button>
        <button className="wtile" onClick={() => setDetail('depot')} aria-label={`Depot ${last ? formatEUR0(last.valueCents) : 'noch kein Stand'} – Details und aktualisieren`}>
          <span className="wname" style={{ color: 'var(--depot)' }}><Icon name="trend" size={16} w={2.2} />Depot</span>
          <span className="wval num">{last ? formatEUR0(last.valueCents) : '–'}</span>
          <span className={'wsub' + (depotPct !== null ? (depotPct >= 0 ? ' pos' : ' neg') : '')}>{depotPct !== null && prev ? `${pctText(depotPct)} seit ${formatDateDE(prev.date).slice(0, 6)}` : last ? `Stand ${formatDateDE(last.date)}` : 'Stand eintragen'}</span>
        </button>
      </div>

      <GoalsCard />

      {sparRecs[0] && (
        <div className="card flush">
          <button className="link" onClick={() => onEditRec(sparRecs[0] as Recurring)} aria-label="Sparrate gilt ab – ändern">
            <span>Sparrate</span><small>{formatEUR0(rate)} / Monat · ab {shortMonth(sparRecs[0].startMonth)}<Chevr /></small>
          </button>
        </div>
      )}

      {detail === 'spar' && (
        <Sheet title="Sparkonto" left="Schließen" onClose={() => setDetail('')}>
          <div className="wdetail">
            <span className="mid34 num">{sav.known ? formatEUR0(sav.cents) : '–'}</span>
            <span className="mini">{sav.known ? `heute geschätzt · Bankstand ${formatEUR0(s.savingsBalanceCents)} am ${formatDateDE(s.savingsBalanceDate as string)}${since > 0 ? ` + ${formatEUR0(since)} Sparraten` : ''}` : 'Noch kein Kontostand erfasst'}</span>
          </div>
          <button className="btn cta" onClick={() => { setDetail(''); setUpd('spar'); }}>Stand aktualisieren</button>
          {sav.known && (
            <div className="card flush">
              <div className="kv"><span>In 12 Monaten</span><b className="pos">≈ {formatEUR0(sav.cents + rate * 12)}</b></div>
              <div className="kv"><span>In 3 Jahren</span><b>≈ {formatEUR0(sav.cents + rate * 36)}</b></div>
              <div className="kv"><span>In 5 Jahren</span><b>≈ {formatEUR0(sav.cents + rate * 60)}</b></div>
            </div>
          )}
          {sav.known && <p className="note" style={{ marginTop: -6 }}>Mit deiner Sparrate, ohne Zinsen.</p>}
          <EntryList title="Verlauf" items={savList.map((e) => ({ key: e.date, date: e.date, cents: e.cents, del: () => run((db) => deleteSavingsEntry(db, e.date), 'Eintrag gelöscht') }))} />
        </Sheet>
      )}
      {detail === 'depot' && (
        <Sheet title="Depot" left="Schließen" onClose={() => setDetail('')}>
          <div className="wdetail">
            <span className="mid34 num">{last ? formatEUR0(last.valueCents) : '–'}</span>
            <span className={'mini ' + (last && prev ? (last.valueCents >= prev.valueCents ? 'pos' : 'neg') : '')}>{last && prev ? `${last.valueCents >= prev.valueCents ? '+' : '−'}${formatEUR0(Math.abs(last.valueCents - prev.valueCents))} seit ${formatDateDE(prev.date)}` : last ? `Stand vom ${formatDateDE(last.date)}` : 'Noch kein Depotstand erfasst'}</span>
          </div>
          <button className="btn cta" onClick={() => { setDetail(''); setUpd('depot'); }}>Stand aktualisieren</button>
          <EntryList title="Verlauf" items={entries.map((e) => ({ key: e.id, date: e.date, cents: e.valueCents, del: () => run((db) => deleteDepotEntry(db, e.id), 'Eintrag gelöscht') }))} />
        </Sheet>
      )}
      {upd && <UpdateSheet kind={upd} before={upd === 'spar' ? (sav.known ? { cents: s.savingsBalanceCents, date: s.savingsBalanceDate as string } : null) : (last ? { cents: last.valueCents, date: last.date } : null)} onClose={() => setUpd('')} />}
    </>
  );
}

/** „Nov. 2026“ */
function shortMonth(m: string): string {
  return new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
}

/** Liste aller Stände mit Veränderung zum vorherigen und Löschen. */
function EntryList({ title, items }: { title: string; items: { key: string; date: string; cents: number; del: () => unknown }[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <span className="cap" style={{ paddingLeft: 4 }}>{title}</span>
      <div className="card flush">
        {items.map((e, i) => {
          const prevE = items[i + 1];
          const diff = prevE ? e.cents - prevE.cents : null;
          return (
            <div className="kv" key={e.key}>
              <span className="lastentry"><small>{formatDateDE(e.date)}</small>{formatEUR0(e.cents)}</span>
              <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {diff !== null && <span className={'mini ' + (diff >= 0 ? 'pos' : 'neg')}>{diff >= 0 ? '+' : '−'}{formatEUR0(Math.abs(diff))}</span>}
                <button className="iconx" aria-label={`Eintrag vom ${formatDateDE(e.date)} löschen`} onClick={() => void e.del()}>✕</button>
              </span>
            </div>
          );
        })}
      </div>
      <p className="note" style={{ marginTop: -6 }}>Pro Tag zählt ein Eintrag.</p>
    </>
  );
}

/** Fenster „… aktualisieren“: Betrag groß in der Mitte, Datum (Standard heute), bisheriger Stand und Unterschied. */
function UpdateSheet({ kind, before, onClose }: { kind: 'spar' | 'depot'; before: { cents: number; date: string } | null; onClose: () => void }) {
  const { run } = useStore();
  const today = todayISO();
  const [val, setVal] = useState('');
  const [date, setDate] = useState(today);
  const [err, setErr] = useState('');
  const c = val ? parseCents(val) : null;
  const diff = c !== null && before ? c - before.cents : null;
  async function save() {
    if (c === null) return setErr(kind === 'spar' ? 'Bitte gib einen gültigen Kontostand ein.' : 'Bitte gib einen gültigen Depotstand ein.');
    if (!isValidISODate(date) || date > today) return setErr('Bitte wähle ein Datum bis heute.');
    setErr('');
    const r = kind === 'spar'
      ? await run((db) => addSavingsEntry(db, date, c).then(() => true), 'Kontostand erfasst')
      : await run((db) => addDepotEntry(db, date, c), 'Depotstand erfasst');
    if (r) onClose();
  }
  return (
    <Sheet title={kind === 'spar' ? 'Sparkonto aktualisieren' : 'Depot aktualisieren'} onClose={onClose}>
      <label className="bigamt">
        <span>{kind === 'spar' ? 'Kontostand laut Bank (€)' : 'Depotstand (€)'}</span>
        <AmountInput label={kind === 'spar' ? 'Kontostand Sparkonto' : 'Neuer Depotstand'} value={val} onChange={setVal} placeholder={before ? formatEUR0(before.cents).replace(/\s?€/, '') : '0'} autoFocus />
      </label>
      <div className="card flush">
        <label className="field"><span>Stand vom</span><input type="date" value={date} max={today} aria-label="Stand vom" onChange={(e) => setDate(e.target.value)} /></label>
        {before && <div className="kv"><span>Bisher</span><b>{formatEUR0(before.cents)} <small className="mini">am {formatDateDE(before.date)}</small></b></div>}
        {diff !== null && <div className="kv"><span>Unterschied</span><b className={diff >= 0 ? 'pos' : 'neg'}>{diff >= 0 ? '+' : '−'}{formatEUR0(Math.abs(diff))}</b></div>}
      </div>
      {err && <div className="err-text" role="alert">{err}</div>}
      <button className="btn cta" onClick={() => void save()} disabled={!val}>Speichern</button>
    </Sheet>
  );
}
