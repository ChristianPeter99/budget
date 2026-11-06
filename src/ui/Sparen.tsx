import { useState } from 'react';
import type { ReactNode } from 'react';
import { AmountInput, Chevr, Header, Sheet } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { addDepotEntry, addSavingsEntry, deleteDepotEntry, deleteSavingsEntry, savingsEntries } from '../db/repo';
import { currentMonthKey, formatDateDE, monthLabel, isValidISODate, monthRange, monthShort, shiftMonth, todayISO } from '../domain/dates';
import { formatEUR0, parseCents } from '../domain/money';
import type { Recurring } from '../domain/types';
import type { TxPreset } from './TxSheet';
import { GoalsCard, effectiveGoals } from './Goals';
import type { EffGoal } from './Goals';

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
  const goals = effectiveGoals(s.savingsGoals ?? [], data.transactions).filter((g) => g.auto !== false && g.monthly > 0);
  const perMonth = rate + goals.reduce((a, g) => a + g.monthly, 0);
  const today = todayISO();
  const sav = savingsEstimate(data, today);
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
          <span className="wsub">{perMonth > 0 ? `+${formatEUR0(perMonth)} / Monat` : sav.known ? 'keine Sparrate' : 'Stand eintragen'}</span>
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
          <SparDetail sav={sav} rate={rate} goals={goals} />
        </Sheet>
      )}
      {detail === 'depot' && (
        <Sheet title="Depot" left="Schließen" onClose={() => setDetail('')}>
          <StandHead kind="depot" cents={last ? last.valueCents : null} date={last?.date ?? null}
            sub={last && prev ? <span className={'mini ' + (last.valueCents >= prev.valueCents ? 'pos' : 'neg')}>{last.valueCents >= prev.valueCents ? '+' : '−'}{formatEUR0(Math.abs(last.valueCents - prev.valueCents))} seit {formatDateDE(prev.date)}</span> : null} />
          <EntryList items={entries.map((e) => ({ key: e.id, date: e.date, cents: e.valueCents, del: () => run((db) => deleteDepotEntry(db, e.id), 'Eintrag gelöscht') }))} />
        </Sheet>
      )}
    </>
  );
}

/** „Nov. 2026“ */
function shortMonth(m: string): string {
  return new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
}

/** Monate von a bis b (b − a). */
function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

/**
 * Sparkonto-Details (Variante „Kompakt“): Stand, Zusammensetzung pro Monat (Sparrate + Sparziele),
 * Prognose mit Zeitraum-Umschalter, Verlauf zum Aufklappen und unten „Stand aktualisieren“.
 */
function SparDetail({ sav, rate, goals }: { sav: { cents: number; known: boolean }; rate: number; goals: EffGoal[] }) {
  const { data, run } = useStore();
  const s = data.settings;
  const [years, setYears] = useState<1 | 3 | 5>(1);
  const month = currentMonthKey();
  const perMonth = rate + goals.reduce((a, g) => a + g.monthly, 0);
  // Prognose ohne Zinsen: Sparrate für jeden Monat, Sparziele nur bis zu ihrem Zielmonat (bis der Rest erreicht ist)
  const forecast = (y: number) => {
    const n = y * 12;
    const goalPart = goals.reduce((a, g) => {
      const rest = Math.max(0, g.targetCents - g.savedCents);
      const left = monthsBetween(month, g.dueMonth);
      return left <= 0 ? a : a + Math.round(rest * Math.min(1, n / left));
    }, 0);
    return sav.cents + rate * n + goalPart;
  };
  const items = savingsEntries(s).map((e) => ({ key: e.date, date: e.date, cents: e.cents, del: () => run((db) => deleteSavingsEntry(db, e.date), 'Eintrag gelöscht') }));
  const solo = rate === 0 && goals.length > 0 ? goals.reduce((a, g) => (g.dueMonth > a ? g.dueMonth : a), '') : '';
  return (
    <>
      <StandHead kind="spar" cents={sav.known ? sav.cents : null} date={sav.known ? (s.savingsBalanceDate as string) : null}
        bank={sav.known ? s.savingsBalanceCents : null} sub={sav.known ? <span className="mini">heute geschätzt</span> : null} />

      {perMonth > 0 && (
        <div className="card wmix">
          <div className="wmixhead"><span>Pro Monat</span><b className="num">{formatEUR0(perMonth)}</b></div>
          <div className="wbar" aria-hidden="true">
            {rate > 0 && <i style={{ flex: rate, background: 'var(--spar)' }} />}
            {goals.map((g) => <i key={g.id} style={{ flex: g.monthly, background: 'var(--goal)' }} />)}
          </div>
          {rate > 0 && <div className="wleg"><span><i style={{ background: 'var(--spar)' }} />Sparrate · fest</span><b className="num">{formatEUR0(rate)}</b></div>}
          {goals.map((g) => <div className="wleg" key={g.id}><span><i style={{ background: 'var(--goal)' }} />{g.name} · bis {monthShort(g.dueMonth)} {g.dueMonth.slice(2, 4)}</span><b className="num">{formatEUR0(g.monthly)}</b></div>)}
          {solo && <p className="note" style={{ margin: 0 }}>Keine feste Sparrate – das Sparziel wirkt bis {monthLabel(solo)} wie eine Sparrate auf Zeit.</p>}
        </div>
      )}

      {sav.known && (
        <div className="card wfc">
          <span className="wfcval"><small>Prognose {years === 1 ? 'in 1 Jahr' : `in ${years} Jahren`}</small><b className="num">≈ {formatEUR0(forecast(years))}</b></span>
          <div className="wseg" role="group" aria-label="Zeitraum der Prognose">
            {([1, 3, 5] as const).map((y) => <button key={y} aria-pressed={years === y} onClick={() => setYears(y)}>{y} J</button>)}
          </div>
        </div>
      )}

      <EntryList items={items} />
    </>
  );
}

/** Verlauf zum Aufklappen: schmale Zeilen mit Betrag, Datum, Veränderung zum vorherigen Stand und Löschen. */
function EntryList({ items }: { items: { key: string; date: string; cents: number; del: () => unknown }[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="card flush whist">
      <button className="whisthead" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Verlauf <small>· {items.length === 1 ? '1 Eintrag' : `${items.length} Einträge`}</small></span>
        <span className={"whchev" + (open ? " up" : "")} aria-hidden="true"><Chevr /></span>
      </button>
      {open && items.map((e, i) => {
        const prevE = items[i + 1];
        const diff = prevE ? e.cents - prevE.cents : null;
        return (
          <div className="whrow" key={e.key}>
            <b className="lastentry num">{formatEUR0(e.cents)}</b>
            <span className="whdate">{formatDateDE(e.date).slice(0, 6)}{e.date.slice(0, 4) !== todayISO().slice(0, 4) ? e.date.slice(2, 4) : ''}</span>
            <span className={'whdiff ' + (diff === null ? '' : diff >= 0 ? 'pos' : 'neg')}>{diff === null ? '–' : `${diff >= 0 ? '+' : '−'}${formatEUR0(Math.abs(diff)).replace(/\s?€/, '')}`}</span>
            <button className="iconx" aria-label={`Eintrag vom ${formatDateDE(e.date)} löschen`} onClick={() => void e.del()}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

/** Tage zwischen zwei ISO-Daten. */
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}

/**
 * Kopf der Detailansicht: großer Betrag mit Aktualisieren-Symbol daneben, darunter ein Chip mit dem Datum des
 * letzten Stands (ab 30 Tagen orange: „abgleichen“). Betrag, Symbol oder Chip antippen → Eingabe direkt an Ort und Stelle.
 */
function StandHead({ kind, cents, date, bank, sub }: { kind: 'spar' | 'depot'; cents: number | null; date: string | null; bank?: number | null; sub: ReactNode }) {
  const { run } = useStore();
  const today = todayISO();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [day, setDay] = useState(today);
  const [err, setErr] = useState('');
  const name = kind === 'spar' ? 'Sparkonto' : 'Depot';
  const before = date ? { cents: bank ?? cents ?? 0, date } : null;
  const c = val ? parseCents(val) : null;
  const diff = c !== null && before ? c - before.cents : null;
  const age = date ? daysBetween(date, today) : null;
  const stale = age !== null && age >= 30;
  const open = () => { setVal(''); setDay(today); setErr(''); setEditing(true); };
  async function save() {
    if (c === null) return setErr(kind === 'spar' ? 'Bitte gib einen gültigen Kontostand ein.' : 'Bitte gib einen gültigen Depotstand ein.');
    if (!isValidISODate(day) || day > today) return setErr('Bitte wähle ein Datum bis heute.');
    setErr('');
    const r = kind === 'spar'
      ? await run((db) => addSavingsEntry(db, day, c).then(() => true), 'Kontostand erfasst')
      : await run((db) => addDepotEntry(db, day, c), 'Depotstand erfasst');
    if (r) setEditing(false);
  }
  if (editing) {
    return (
      <div className="wdetail wedit">
        <label className="wbig">
          <span className="mini">{kind === 'spar' ? 'Kontostand laut Bank' : 'Depotstand'}</span>
          <span className="wbigin"><AmountInput label={kind === 'spar' ? 'Kontostand Sparkonto' : 'Neuer Depotstand'} value={val} onChange={setVal} placeholder={before ? formatEUR0(before.cents).replace(/\s?€/, '') : '0'} autoFocus /><b>€</b></span>
        </label>
        <div className="wactions">
          <label className="wdate"><span>vom</span><input type="date" value={day} max={today} aria-label="Stand vom" onChange={(e) => setDay(e.target.value)} /></label>
          <button className="wsave" onClick={() => void save()} disabled={!val}>Speichern</button>
          <button className="wcancel" aria-label="Abbrechen" onClick={() => setEditing(false)}>✕</button>
        </div>
        {diff !== null && before && <span className="mini wdiff">Unterschied <b className={diff >= 0 ? 'pos' : 'neg'}>{diff >= 0 ? '+' : '−'}{formatEUR0(Math.abs(diff))}</b> zum {formatDateDE(before.date).slice(0, 6)}</span>}
        {err && <div className="err-text" role="alert">{err}</div>}
      </div>
    );
  }
  return (
    <div className="wdetail">
      <div className="wamtrow">
        <button className="wamt" onClick={open} aria-label={`${name} ${cents !== null ? formatEUR0(cents) : 'ohne Stand'} – antippen zum Aktualisieren`}>
          <span className="mid34 num">{cents !== null ? formatEUR0(cents) : '–'}</span>
        </button>
        <button className="wupd" onClick={open} aria-label="Stand aktualisieren"><Icon name="repeat" size={16} w={2.4} /></button>
      </div>
      {sub}
      {date === null
        ? <button className="wchip" onClick={open}>Stand eintragen</button>
        : stale
          ? <button className="wchip warn" onClick={open}><i />{kind === 'spar' ? 'Bankstand' : 'Stand'} {age} Tage alt · abgleichen</button>
          : <button className="wchip" onClick={open} aria-label={`${kind === 'spar' ? 'Bankstand' : 'Stand'} vom ${formatDateDE(date)} – aktualisieren`}>{kind === 'spar' ? 'Bank' : 'Stand'} {formatDateDE(date).slice(0, 6)}</button>}
    </div>
  );
}
