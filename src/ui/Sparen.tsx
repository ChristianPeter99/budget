import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AmountInput, Chevr, Header, Sheet } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { addDepotEntry, addSavingsEntry, deleteDepotEntry, deleteSavingsEntry, savingsEntries } from '../db/repo';
import { currentMonthKey, formatDateDE, monthLabel, isValidISODate, monthRange, monthShort, shiftMonth, todayISO } from '../domain/dates';
import { formatEUR0, parseCents } from '../domain/money';
import type { Recurring } from '../domain/types';
import type { TxPreset } from './TxSheet';
import { GoalSheet, effectiveGoals, goalLine, sortGoals } from './Goals';
import { RecurringSheet } from './Recurring';
import { goalPlan } from '../domain/calc';
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
export function Sparen({ back }: { back: ReactNode; onAdd?: (p: TxPreset) => void; onEditRec?: (r: Recurring) => void }) {
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
  const [sparEdit, setSparEdit] = useState(false);
  const [sub, setSub] = useState<{ goal: EffGoal | null } | { rate: true } | null>(null);
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

      {detail === 'spar' && !sub && (
        <Sheet title="Sparkonto" left="Schließen" onClose={() => { setDetail(''); setSparEdit(false); }}
          right={<button className="hdricon" aria-label="Stand aktualisieren" onClick={() => setSparEdit(true)}><Icon name="repeat" size={18} w={2.2} /></button>}>
          <SparDetail sav={sav} rate={rate} goals={goals} rec={sparRecs[0] ?? null} onGoal={(g) => setSub({ goal: g })} onRate={() => setSub({ rate: true })} edit={[sparEdit, setSparEdit]} />
        </Sheet>
      )}
      {/* Sparziel bzw. Sparrate bearbeiten: ersetzt kurz die Sparkonto-Details, danach geht es dorthin zurück */}
      {sub && 'goal' in sub && <GoalSheet goal={sub.goal} onClose={() => setSub(null)} />}
      {sub && 'rate' in sub && <RecurringSheet rec={sparRecs[0] ?? null} presetGroup="spar" onClose={() => setSub(null)} run={run} />}
      {detail === 'depot' && (
        <Sheet title="Depot" left="Schließen" onClose={() => setDetail('')}>
          <DepotDetail entries={entries} />
          <EntryList items={entries.map((e) => ({ key: e.id, date: e.date, cents: e.valueCents, del: () => run((db) => deleteDepotEntry(db, e.id), 'Eintrag gelöscht') }))} />
        </Sheet>
      )}
    </>
  );
}

/** Monate von a bis b (b − a). */
function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

/**
 * Sparkonto-Details (Vorlage J1 mit J3): links Betrag und Veränderung, Umschalter „Bisher | Nächstes Jahr“,
 * Diagramm über die volle Breite, darunter eine schlichte Liste: Sparrate, Sparziele, „+ Sparziel“, Verlauf.
 */
function SparDetail({ sav, rate, goals, rec, onGoal, onRate, edit }: { sav: { cents: number; known: boolean }; rate: number; goals: EffGoal[]; rec: Recurring | null; onGoal: (g: EffGoal | null) => void; onRate: () => void; edit: [boolean, (v: boolean) => void] }) {
  const { data, run } = useStore();
  const s = data.settings;
  const month = currentMonthKey();
  const today = todayISO();
  const perMonth = rate + goals.reduce((a, g) => a + g.monthly, 0);
  // Prognose ohne Zinsen: Sparrate für jeden Monat, Sparziele nur bis zu ihrem Zielmonat (bis der Rest erreicht ist)
  const at = (n: number) => sav.cents + rate * n + goals.reduce((a, g) => {
    const rest = Math.max(0, g.targetCents - g.savedCents);
    const left = monthsBetween(month, g.dueMonth);
    return left <= 0 ? a : a + Math.round(rest * Math.min(1, n / left));
  }, 0);
  const past: Pt[] = [...savingsEntries(s)].filter((e) => e.date < today).sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ d: e.date, c: e.cents }));
  past.push({ d: today, c: sav.cents });
  // ohne eigene Wahl: „Bisher“, sobald es mindestens zwei Stände gibt, sonst die Prognose
  const [chosen, setMode] = useState<'past' | 'future' | null>(null);
  const mode = chosen ?? (past.length > 1 ? 'past' : 'future');
  const [histOpen, setHistOpen] = useState(false);
  const day = today.slice(8, 10) > '28' ? '28' : today.slice(8, 10);
  const future: Pt[] = Array.from({ length: 13 }, (_, k) => ({ d: k === 0 ? today : `${shiftMonth(month, k)}-${day}`, c: at(k) }));
  const reached = goals.map((g) => ({ g, left: monthsBetween(month, g.dueMonth) })).filter((x) => x.left > 0 && x.left <= 12);
  const markers = reached.map(({ g, left }) => ({ ...(future[left] as Pt), label: g.name }));
  const first = past[0] as Pt;
  const grow = sav.cents - first.c;
  const fut = mode === 'future';
  const all = sortGoals(effectiveGoals(s.savingsGoals ?? [], data.transactions));
  const items = savingsEntries(s).map((e) => ({ key: e.date, date: e.date, cents: e.cents, del: () => run((db) => deleteSavingsEntry(db, e.date), 'Eintrag gelöscht') }));
  const mLabel = (m: string) => `${monthShort(m)} ${m.slice(2, 4)}`;
  const sub = !sav.known ? null : fut
    ? <span className="wsubline pos">+{formatEUR0(perMonth)} jeden Monat</span>
    : past.length > 1 ? <span className={'wsubline ' + (grow >= 0 ? 'pos' : 'neg')}>{grow >= 0 ? '+' : '−'}{formatEUR0(Math.abs(grow))} seit {monthLabel(first.d.slice(0, 7)).split(' ')[0]}</span> : null;
  return (
    <>
      <StandHead kind="spar" left edit={edit} cents={sav.known ? sav.cents : null} date={sav.known ? (s.savingsBalanceDate as string) : null}
        bank={sav.known ? s.savingsBalanceCents : null} caption={sav.known ? (fut ? 'In einem Jahr · ohne Zinsen' : 'Heute') : undefined}
        display={sav.known && fut ? `≈ ${formatEUR0(at(12))}` : undefined} sub={sub} />

      {sav.known && !edit[0] && (
        <>
          <div className="wbleed">
            {fut
              ? <TrendChart color="var(--spar)" past={[past[past.length - 1] as Pt]} future={future} markers={markers} labels={['heute', '', mLabel(shiftMonth(month, 12))]}
                  aria={`Prognose Sparkonto bis ${monthLabel(shiftMonth(month, 12))}: ungefähr ${formatEUR0(at(12))}`} />
              : past.length > 1
                ? <TrendChart color="var(--spar)" past={past} labels={[mLabel(first.d.slice(0, 7)), '', 'heute']}
                    aria={`Sparkonto seit ${formatDateDE(first.d)}: von ${formatEUR0(first.c)} auf ${formatEUR0(sav.cents)}`} />
                : <p className="note wempty">Ab dem zweiten Stand siehst du hier deinen Verlauf.</p>}
          </div>
          <div className="wmode" role="group" aria-label="Ansicht">
            <button aria-pressed={!fut} onClick={() => setMode('past')}>Bisher</button>
            <button aria-pressed={fut} onClick={() => setMode('future')}>Nächstes Jahr</button>
          </div>
        </>
      )}

      <div className="wlist">
        <button className="wli" onClick={onRate} aria-label={rec ? `Sparrate ${formatEUR0(rate)} pro Monat – ändern` : 'Sparrate festlegen'}>
          <span className="wlitxt"><b className={rec ? '' : 'pos'}>{rec ? 'Sparrate' : 'Sparrate festlegen'}</b></span>
          {rec && <b className="num">{formatEUR0(rate)}</b>}<Chevr />
        </button>
        {all.map((g) => {
          const p = goalPlan(g, month);
          const line = goalLine(g, month);
          return (
            <button className="wli goalrow" key={g.id} onClick={() => onGoal(g)} aria-label={`Sparziel ${g.name}: ${formatEUR0(g.savedCents)} von ${formatEUR0(g.targetCents)}, ${line.text}`}>
              <span className="wlitxt">
                <span className="wlitop"><b>{g.name}</b><small className={line.tone}>{formatEUR0(g.savedCents).replace(/\s?€/, '')} / {formatEUR0(g.targetCents)}{p.done ? ' · erreicht' : p.overdue ? ' · vorbei' : ` · ${mLabel(g.dueMonth)}`}</small></span>
                <span className="wgbar" aria-hidden="true"><span style={{ width: `${Math.min(100, p.ratio * 100)}%` }} /></span>
              </span>
              <b className="num">{!p.done && !p.overdue && g.auto !== false && g.monthly > 0 ? formatEUR0(g.monthly) : ''}</b><Chevr />
            </button>
          );
        })}
        <button className="wli wadd" onClick={() => onGoal(null)} aria-label="Sparziel hinzufügen">+ Sparziel</button>
        {items.length > 0 && (
          <>
            <button className="wli whead" aria-expanded={histOpen} onClick={() => setHistOpen(!histOpen)}>
              <span className="wlitxt"><span>Verlauf</span></span><small>{items.length === 1 ? '1 Stand' : `${items.length} Stände`}</small>
              <span className={'whchev' + (histOpen ? ' up' : '')} aria-hidden="true"><Chevr /></span>
            </button>
            {histOpen && <EntryRows items={items} />}
          </>
        )}
      </div>
    </>
  );
}

type Pt = { d: string; c: number };

/** Depot-Details: Stand, Veränderung im gewählten Zeitraum, Verlaufskurve ohne Kasten, Hoch/Tief und Zeitraum. */
function DepotDetail({ entries }: { entries: { date: string; valueCents: number }[] }) {
  const [range, setRange] = useState<'6M' | '1J' | 'Alles'>('6M');
  const last = entries[0];
  const today = todayISO();
  const asc = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ d: e.date, c: e.valueCents }));
  const cut = range === 'Alles' ? '' : `${shiftMonth(today.slice(0, 7), range === '6M' ? -6 : -12)}${today.slice(7)}`;
  // Ein Stand vor dem Zeitraum wird als Startpunkt mitgenommen, damit die Kurve am linken Rand beginnt
  const inRange = asc.filter((p) => p.d >= cut);
  const before = asc.filter((p) => p.d < cut).pop();
  const pts = before && inRange.length > 0 ? [before, ...inRange] : inRange;
  const first = pts[0];
  const diff = first && last && pts.length > 1 ? last.valueCents - first.c : null;
  const pct = diff !== null && first && first.c > 0 ? (diff / first.c) * 100 : null;
  const vals = pts.map((p) => p.c);
  return (
    <>
      <StandHead kind="depot" cents={last ? last.valueCents : null} date={last?.date ?? null}
        sub={diff !== null && first ? <span className={'mini ' + (diff >= 0 ? 'pos' : 'neg')}>{diff >= 0 ? '+' : '−'}{formatEUR0(Math.abs(diff))}{pct !== null ? ` · ${diff >= 0 ? '+' : '−'}${Math.abs(pct).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : ''} seit {formatDateDE(first.d).slice(0, 6)}</span> : null} />
      {asc.length > 1 && (
        <>
          {pts.length > 1
            ? <TrendChart color="var(--depot)" past={pts} labels={[monthShort((pts[0] as Pt).d.slice(0, 7)), '', monthShort((pts[pts.length - 1] as Pt).d.slice(0, 7))]}
                aria={`Depot seit ${formatDateDE((pts[0] as Pt).d)}: von ${formatEUR0((pts[0] as Pt).c)} auf ${formatEUR0((pts[pts.length - 1] as Pt).c)}`} />
            : <p className="note" style={{ margin: 0, textAlign: 'center' }}>In diesem Zeitraum gibt es nur einen Stand.</p>}
          <div className="wfc">
            <span className="mini">{vals.length > 1 ? <>Hoch <b>{formatEUR0(Math.max(...vals))}</b> · Tief <b>{formatEUR0(Math.min(...vals))}</b></> : null}</span>
            <div className="wseg" role="group" aria-label="Zeitraum">
              {(['6M', '1J', 'Alles'] as const).map((r) => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>)}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Verlaufskurve ohne Kasten: Fläche + Linie bis heute, optional gestrichelte Prognose und Markierungen (Sparziele).
 * x nach Datum, y zwischen Minimum und Maximum. Punkte als HTML, damit sie bei voller Breite rund bleiben.
 */
function TrendChart({ past, future = [], markers = [], color, labels, aria }: { past: Pt[]; future?: Pt[]; markers?: (Pt & { label?: string })[]; color: string; labels: [string, string, string]; aria: string }) {
  const gid = useId().replace(/:/g, '');
  const W = 358, H = 120;
  const all = [...past, ...future];
  const t = (d: string) => new Date(d + 'T00:00:00').getTime();
  const t0 = t((all[0] as Pt).d), t1 = t((all[all.length - 1] as Pt).d);
  const lo = Math.min(...all.map((p) => p.c)), hi = Math.max(...all.map((p) => p.c));
  const pad = (hi - lo) * 0.12 || Math.max(100, hi * 0.05);
  const x = (d: string) => (t1 > t0 ? ((t(d) - t0) / (t1 - t0)) * W : W / 2);
  const y = (c: number) => H - 8 - ((c - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 16);
  const path = (ps: Pt[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p.c).toFixed(1)}`).join(' ');
  const line = path(past);
  const lp = past[past.length - 1] as Pt;
  const dot = (p: Pt) => ({ left: `${(x(p.d) / W) * 100}%`, top: y(p.c) });
  return (
    <div className="tchart">
      <div className="tplot" style={{ height: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={aria}>
          <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
          {past.length > 1 && <path d={`${line} L${x(lp.d).toFixed(1)} ${H} L${x((past[0] as Pt).d).toFixed(1)} ${H} Z`} fill={`url(#${gid})`} />}
          {past.length > 1 && <path d={line} fill="none" style={{ stroke: color }} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
          {future.length > 1 && <path d={path(future)} fill="none" style={{ stroke: color }} strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" opacity="0.8" vectorEffect="non-scaling-stroke" />}
        </svg>
        {markers.map((m) => <i key={m.d} className="tmark" style={dot(m)} aria-hidden="true" />)}
        {markers.map((m) => m.label && <span key={'l' + m.d} className="tmlabel" style={dot(m)} aria-hidden="true">{m.label}</span>)}
        <i className="tnow" style={{ ...dot(lp), background: color }} aria-hidden="true" />
      </div>
      <div className="wlabels" aria-hidden="true"><span>{labels[0]}</span><span className="now">{labels[1]}</span><span>{labels[2]}</span></div>
    </div>
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
      {open && <EntryRows items={items} />}
    </div>
  );
}

/** Schmale Zeilen: Betrag, Datum, Veränderung zum vorherigen Stand, Löschen. */
function EntryRows({ items }: { items: { key: string; date: string; cents: number; del: () => unknown }[] }) {
  return (
    <>
      {items.map((e, i) => {
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
    </>
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
function StandHead({ kind, cents, date, bank, sub, left, caption, display, edit }: {
  kind: 'spar' | 'depot'; cents: number | null; date: string | null; bank?: number | null; sub: ReactNode;
  /** linksbündig, ohne ↻ neben dem Betrag (das Symbol sitzt dann in der Kopfzeile) */
  left?: boolean; caption?: string; display?: string; edit?: [boolean, (v: boolean) => void];
}) {
  const { run } = useStore();
  const today = todayISO();
  const own = useState(false);
  const [editing, setEditing] = edit ?? own;
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
  // Beim Öffnen von außen (↻ in der Kopfzeile) Eingabe zurücksetzen
  const wasEditing = useRef(editing);
  if (editing && !wasEditing.current) { wasEditing.current = true; if (val || err) { setVal(''); setErr(''); } }
  if (!editing && wasEditing.current) wasEditing.current = false;
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
      <div className={'wdetail wedit' + (left ? ' wleft' : '')}>
        <label className="wbig">
          <span className="mini">{kind === 'spar' ? 'Kontostand laut Bank' : 'Depotstand'}</span>
          <span className="wbigin"><AmountInput label={kind === 'spar' ? 'Kontostand Sparkonto' : 'Neuer Depotstand'} value={val} onChange={setVal} placeholder={before ? formatEUR0(before.cents).replace(/\s?€/, '') : '0'} autoFocus /><b>€</b></span>
        </label>
        <div className="wactions">
          {kind === 'depot' && <label className="wdate"><span>vom</span><input type="date" value={day} max={today} aria-label="Stand vom" onChange={(e) => setDay(e.target.value)} /></label>}
          <button className="wsave" onClick={() => void save()} disabled={!val}>Speichern</button>
          <button className="wcancel" aria-label="Abbrechen" onClick={() => setEditing(false)}>✕</button>
        </div>
        {diff !== null && before && <span className="mini wdiff">Unterschied <b className={diff >= 0 ? 'pos' : 'neg'}>{diff >= 0 ? '+' : '−'}{formatEUR0(Math.abs(diff))}</b> zum {formatDateDE(before.date).slice(0, 6)}</span>}
        {err && <div className="err-text" role="alert">{err}</div>}
      </div>
    );
  }
  if (left) {
    return (
      <div className="wdetail wleft">
        {caption && <span className="wcap">{caption}</span>}
        <button className="wamt" onClick={open} aria-label={`${name} ${cents !== null ? formatEUR0(cents) : 'ohne Stand'} – antippen zum Aktualisieren`}>
          <span className="wbigval num">{display ?? (cents !== null ? formatEUR0(cents) : '–')}</span>
        </button>
        {sub}
        {date === null
          ? <button className="wchip" onClick={open}>Stand eintragen</button>
          : stale && <button className="wchip warn" onClick={open}><i />Bankstand {age} Tage alt · abgleichen</button>}
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
        : stale && <button className="wchip warn" onClick={open}><i />{kind === 'spar' ? 'Bankstand' : 'Stand'} {age} Tage alt · abgleichen</button>}
    </div>
  );
}
