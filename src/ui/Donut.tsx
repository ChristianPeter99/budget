import { useMemo, useRef, useState } from 'react';
import { areaSlices, subRows } from '../domain/areas';
import type { DonutArea, Slice } from '../domain/areas';
import { Icon } from './icons';
import { formatEUR, formatEUR0 } from '../domain/money';
import { currentMonthKey, monthLabel, monthRange, monthShort, shiftMonth } from '../domain/dates';
import type { Category, Transaction } from '../domain/types';
import { categorySeries, filterTransactions } from '../domain/transactions';
import { Chevr } from './Collapse';
import { Sheet } from './Sheet';
import { useAreaSwipe } from './gestures';

export const AREA_COLOR: Record<DonutArea, string> = { fix: 'var(--fix)', alltag: 'var(--all)', spar: 'var(--spar)', hh: 'var(--hh)', inc: 'var(--inc)' };
export const AREA_NAME: Record<DonutArea, string> = { fix: 'Fixkosten', alltag: 'Alltag', spar: 'Sparen', hh: 'Haushaltskonto', inc: 'Einnahmen' };
/** Helle Bereichsfarben bekommen dunkle Symbole */
const LIGHT: Record<DonutArea, boolean> = { fix: false, alltag: false, spar: true, hh: true, inc: true };

// Abstufungen: nie zu dunkel (sonst verschwindet der Abschnitt auf der Spur), nie ganz weiß
const STEPS = [100, 68, 70, 52, 80, 84, 50];
const MIX_WHITE = [false, false, true, true, false, true, false];

/**
 * Abstufungen einer Bereichsfarbe: abwechselnd heller und dunkler, damit benachbarte Abschnitte
 * unterscheidbar sind und alles trotzdem klar zum Bereich gehört. „Weitere“ immer grau.
 */
export function shade(color: string, i: number, id?: string): string {
  if (id === 'rest') return '#5A5E67';
  const k = i % STEPS.length;
  if (k === 0) return color;
  return MIX_WHITE[k] ? `color-mix(in srgb, ${color} ${STEPS[k]}%, #fff)` : `color-mix(in srgb, ${color} ${STEPS[k]}%, #000)`;
}

/** Symbolfarbe auf einem Abschnitt: auf hellen Tönen dunkel, sonst weiß. */
export function iconInk(area: DonutArea, i: number, id?: string): string {
  if (id === 'rest') return '#fff';
  const k = i % STEPS.length;
  const light = LIGHT[area] ? k === 0 || MIX_WHITE[k] : MIX_WHITE[k] && (STEPS[k] ?? 100) <= 70;
  return light ? '#0E0F12' : '#fff';
}

/** Ring aus Abschnitten (SVG-Kreise mit Strichlänge), Mittelpunkt 160/160; Symbole auf Abschnitten, die groß genug sind. */
export function DonutRing({ slices, area, total, selected, onSelect, r = 128, width = 34, gap = 2.5, icons = true }: {
  slices: Slice[]; area: DonutArea; total: number; selected: string | null; onSelect?: (id: string) => void; r?: number; width?: number; gap?: number; icons?: boolean;
}) {
  const color = AREA_COLOR[area];
  const C = 2 * Math.PI * r;
  const tot = Math.max(1, total);
  let off = 0;
  const segs = slices.map((s, i) => {
    const len = (s.cents / tot) * C;
    const o = off; off += len;
    return { s, i, len, o, mid: ((o + len / 2) / C) * 2 * Math.PI };
  });
  const isz = Math.round(width * 0.5);
  return (
    <>
      <circle cx="160" cy="160" r={r} fill="none" style={{ stroke: 'var(--ring-track)' }} strokeWidth={width} />
      {segs.map(({ s, i, len, o }) => {
        if (len < 0.5) return null;
        const on = selected === s.id;
        return (
          <circle key={s.id} className={'ovseg dseg' + (selected && !on ? ' dim' : '') + (on ? ' on' : '')} cx="160" cy="160" r={r} fill="none"
            style={{ stroke: shade(color, i, s.id), animationDelay: `${i * 35}ms` }} strokeWidth={on ? width + 10 : width}
            strokeDasharray={`${Math.max(0.5, len - (slices.length > 1 ? gap : 0))} ${C}`} strokeDashoffset={-o} transform="rotate(-90 160 160)"
            onClick={onSelect ? () => onSelect(s.id) : undefined} />
        );
      })}
      {icons && segs.map(({ s, i, len, mid }) => len >= isz + 10 && (
        <g key={'i' + s.id} className={'dicon' + (selected && selected !== s.id ? ' dim' : '')} style={{ color: iconInk(area, i, s.id), pointerEvents: 'none', animationDelay: `${120 + i * 35}ms` }}>
          <Icon name={s.icon} size={isz} w={2.2} x={160 + r * Math.sin(mid) - isz / 2} y={160 - r * Math.cos(mid) - isz / 2} />
        </g>
      ))}
    </>
  );
}

/** Kleines rundes Symbolfeld in Abschnittsfarbe (Liste unter dem Kreis). */
function Dot({ area, i, s }: { area: DonutArea; i: number; s: Slice }) {
  return <span className="ddot" style={{ background: shade(AREA_COLOR[area], i, s.id), color: iconInk(area, i, s.id) }}><Icon name={s.icon} size={16} w={2.2} /></span>;
}

/** Kleiner Verlauf einer Kategorie (12 Monate): schwankt sie oder nicht? Ø gestrichelt, teuerster Monat markiert. */
export function MiniTrend({ series, color }: { series: { month: string; cents: number }[]; color: string }) {
  const W = 300, H = 54, P = { l: 4, r: 4, t: 8, b: 14 };
  const max = Math.max(...series.map((p) => p.cents));
  if (max <= 0 || series.length < 2) return null;
  const top = series.find((p) => p.cents === max)!;
  const withData = series.filter((p) => p.cents > 0).length;
  // Ø ab dem ersten Monat mit Buchungen (leere Monate davor – vor der App-Nutzung – verfälschen sonst)
  const firstI = series.findIndex((p) => p.cents > 0);
  const used = series.slice(firstI);
  const avg = Math.round(used.reduce((a, p) => a + p.cents, 0) / used.length);
  const X = (i: number) => P.l + (i / (series.length - 1)) * (W - P.l - P.r);
  const Y = (c: number) => P.t + (1 - c / max) * (H - P.t - P.b);
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.cents).toFixed(1)}`).join(' ');
  return (
    <div className="mtrend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Verlauf 12 Monate: Durchschnitt ${formatEUR(avg)}, teuerster Monat ${monthLabel(top.month)} mit ${formatEUR(top.cents)}`}>
        <line x1={P.l} x2={W - P.r} y1={Y(avg)} y2={Y(avg)} stroke="var(--faint)" strokeDasharray="3 4" strokeWidth="1" />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => <circle key={p.month} cx={X(i)} cy={Y(p.cents)} r={p.month === top.month ? 3.5 : 1.6} fill={p.month === top.month ? 'var(--warn)' : color} />)}
        <text x={P.l} y={H - 2} fontSize="10" fill="var(--faint)">{monthShort(series[0]!.month).slice(0, 3)}</text>
        <text x={W - P.r} y={H - 2} fontSize="10" fill="var(--faint)" textAnchor="end">{monthShort(series[series.length - 1]!.month).slice(0, 3)}</text>
      </svg>
      <div className="mtrend-k"><span>Ø {formatEUR0(avg)} / Monat</span><span>teuerster: <b style={{ color: 'var(--warn)' }}>{monthShort(top.month).slice(0, 3)} {top.month.slice(2, 4)}</b> · {formatEUR0(top.cents)}</span></div>
      {withData < 3 && <span className="mini">Erst {withData} {withData === 1 ? 'Monat' : 'Monate'} mit Buchungen – der Verlauf wird mit der Zeit aussagekräftiger.</span>}
    </div>
  );
}

/**
 * Kreis der Kategorien mit Mitte und Liste darunter (gemeinsam für das Pop-up der Übersicht und die Auswertung).
 * Tipp auf Abschnitt oder Zeile wählt die Kategorie, darunter klappt ihre Aufteilung auf; Tipp in die Mitte hebt die Auswahl auf.
 */
export function DonutView({ txs, cats, area, label, period, trend }: { txs: Transaction[]; cats: Category[]; area: DonutArea; label?: string; period?: string;
  /** Alle Buchungen und letzter Monat für den kleinen Verlauf beim Aufklappen (optional) */
  trend?: { all: Transaction[]; end: string; n: number } }) {
  const [sel, setSel] = useState<string | null>(null);
  const slices = useMemo(() => areaSlices(txs, cats, area, 8), [txs, cats, area]);
  const total = slices.reduce((s, x) => s + x.cents, 0);
  const color = AREA_COLOR[area];
  const pick = slices.find((x) => x.id === sel);
  const pIdx = slices.findIndex((x) => x.id === sel);
  const name = label ?? AREA_NAME[area];
  const pct = (c: number) => Math.round((c / Math.max(1, total)) * 100);
  const toggle = (id: string) => setSel((s) => (s === id ? null : id));
  if (slices.length === 0) return <p className="note" style={{ textAlign: 'center', margin: '18px 0' }}>Keine Buchungen in diesem Zeitraum.</p>;
  return (
    <>
      <div className="dwrap">
        <svg viewBox="0 0 320 320" className="dsvg" role="img" aria-label={`${name} nach Kategorien${period ? `, ${period}` : ''}: ${slices.map((x) => `${x.name} ${pct(x.cents)} Prozent`).join(', ')}`}>
          <g className="ovdrill" key={area}><DonutRing slices={slices} area={area} total={total} selected={sel} r={122} width={40} onSelect={toggle} /></g>
        </svg>
        <button className="dcenter" onClick={() => setSel(null)} aria-label={pick ? 'Auswahl aufheben' : name}>
          {pick ? <>
            <span className="ovlabel" style={{ color: shade(color, pIdx, pick.id) }}>{pick.name}</span>
            <span className="ovamt">{formatEUR0(pick.cents)}</span>
            <span className="ovsub">{pct(pick.cents)} % · {pick.count === 1 ? '1 Buchung' : `${pick.count} Buchungen`}</span>
          </> : <>
            <span className="ovlabel" style={{ color }}>{name}</span>
            <span className="ovamt">{formatEUR0(total)}</span>
          </>}
        </button>
      </div>
      <div className="ovlegend" role="list" aria-label={`Kategorien ${name}`}>
        {slices.map((x, i) => (
          <div key={x.id} role="listitem" className={'ovlitem' + (sel === x.id ? ' on' : '') + (sel && sel !== x.id ? ' dim' : '')}>
            <button className="ovlrow" aria-expanded={sel === x.id} onClick={() => toggle(x.id)}>
              <Dot area={area} i={i} s={x} />
              <span className="ovlname">{x.name}</span>
              <span className="ovlpct">{pct(x.cents)} %</span>
              <b className="num">{formatEUR0(x.cents)}</b>
            </button>
            {sel === x.id && trend && x.id !== 'rest' && (
              <MiniTrend series={categorySeries(trend.all, cats, x.id, trend.end, trend.n, area === 'inc' ? 'income' : 'expense')} color={shade(color, i, x.id)} />
            )}
            {sel === x.id && (() => {
              const subs = x.members ? x.members.map((m) => ({ id: m.id, name: m.name, cents: m.cents })) : subRows(txs, cats, area, x.id);
              // Ohne Unterkategorien wäre die Zeile nur eine Wiederholung
              if (subs.length === 1 && subs[0]!.id === x.id) return null;
              return (
              <div className="ovlsubs">
                {subs.map((r) => (
                  <div className="ovlsub" key={r.id}><span>{r.name}</span><span className="ovlpct">{pct(r.cents)} %</span><span className="num">{formatEUR0(r.cents)}</span></div>
                ))}
              </div>
              );
            })()}
          </div>
        ))}
      </div>
    </>
  );
}

/** Pop-up der Übersicht: Kategorie-Kreis eines Bereichs; nach unten ziehen schließt. */
export function AreaSheet({ area, label, txs, cats, period, onClose, onOpen, openLabel }: {
  area: DonutArea; label?: string; txs: Transaction[]; cats: Category[]; period: string; onClose: () => void; onOpen?: () => void; openLabel?: string;
}) {
  return (
    <Sheet title={`${label ?? AREA_NAME[area]} · ${period}`} onClose={onClose} left="Schließen">
      <div className="areasheet">
        <DonutView txs={txs} cats={cats} area={area} label={label} period={period} />
        {onOpen && <button className="ovopen areaopen" style={{ color: AREA_COLOR[area] }} onClick={() => { onClose(); onOpen(); }}>{openLabel ?? `${label ?? AREA_NAME[area]} öffnen`}<Chevr /></button>}
      </div>
    </Sheet>
  );
}

/** Zeitraum des Kategorie-Kreises: von Monat bis Monat; to = null heißt „bis heute“ */
export interface MonthSpan { from: string; to: string | null }

const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
export const spanLabel = (sp: MonthSpan, now: string) => {
  const to = sp.to ?? now;
  if (sp.from === to) return sp.to === null ? `${monthLabel(sp.from)} (heute)` : monthLabel(sp.from);
  return `${monthLabel(sp.from)} – ${sp.to === null ? 'heute' : monthLabel(to)}`;
};

const MSHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const shortLabel = (m: string) => `${MSHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Monatsraster: Jahr mit Pfeilen, darunter 4 × 3 Monate; außerhalb von min…max gesperrt. */
function MonthGrid({ value, min, max, onPick }: { value: string; min: string; max: string; onPick: (m: string) => void }) {
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const y0 = Number(min.slice(0, 4)), y1 = Number(max.slice(0, 4));
  return (
    <div className="mgrid">
      <div className="mgrid-y">
        <button className="ib" aria-label="Vorheriges Jahr" disabled={year <= y0} onClick={() => setYear(year - 1)}><Icon name="left" size={18} w={2.4} /></button>
        <b>{year}</b>
        <button className="ib" aria-label="Nächstes Jahr" disabled={year >= y1} onClick={() => setYear(year + 1)}><Icon name="right" size={18} w={2.4} /></button>
      </div>
      <div className="mgrid-m" role="group" aria-label={`Monate ${year}`}>
        {MSHORT.map((n, i) => {
          const k = `${year}-${String(i + 1).padStart(2, '0')}`;
          const off = k < min || k > max;
          return <button key={k} className={k === value ? 'on' : ''} disabled={off} aria-pressed={k === value} aria-label={monthLabel(k)} onClick={() => onPick(k)}>{n}</button>;
        })}
      </div>
    </div>
  );
}

/**
 * Blatt „Zeitraum“ (nach Jonas): Vorgaben als Häkchen-Liste (Tipp übernimmt sofort), darunter „Eigener Zeitraum“
 * mit Von/Bis-Zeilen, die ein Monatsraster aufklappen; „Fertig“ oben rechts übernimmt den eigenen Zeitraum.
 */
export function SpanSheet({ value, first, now, onApply, onClose }: { value: MonthSpan; first: string; now: string; onApply: (s: MonthSpan) => void; onClose: () => void }) {
  const y = now.slice(0, 4);
  // Vorgaben kompakt in einer Zeile (Kurzname, ausgeschriebener Name für VoiceOver); die Auswertung umfasst immer mehrere Monate
  const presets: [string, string, MonthSpan][] = [
    ['3 Monate', 'Letzte 3 Monate', { from: shiftMonth(now, -2), to: null }],
    ['12 Monate', 'Letzte 12 Monate', { from: shiftMonth(now, -11), to: null }],
    [y, `Seit Januar ${y}`, { from: `${y}-01`, to: null }],
    ['Alles', 'Alles', { from: first, to: null }]
  ];
  const same = (a: MonthSpan, b: MonthSpan) => a.from === b.from && (a.to ?? now) === (b.to ?? now) && (a.to === null) === (b.to === null);
  const active = presets.findIndex(([, , sp]) => same(sp, value));
  const min = [first, value.from, shiftMonth(now, -11)].sort()[0]!;
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState<string | null>(value.to);
  const [edit, setEdit] = useState<'from' | 'to' | null>(null);
  const toKey = to ?? now;
  const bad = from > toKey;
  const changed = !same({ from, to }, value);
  const len = monthsBetween(from, toKey);
  const row = (k: 'from' | 'to', label: string, val: string) => (
    <button className={'srow' + (edit === k ? ' editing' : '')} aria-expanded={edit === k} onClick={() => setEdit(edit === k ? null : k)}>
      <span>{label}</span><b>{val}</b>
    </button>
  );
  return (
    <Sheet title="Zeitraum" onClose={onClose} left="Abbrechen"
      right={<button className={'lnk sdone' + (changed && !bad ? ' on' : '')} disabled={!changed || bad} onClick={() => onApply({ from, to })}>Fertig</button>}>
      <div className="spansheet">
        <div className="spseg" role="radiogroup" aria-label="Vorgaben">
          {presets.map(([l, full, sp], i) => (
            <button key={full} role="radio" aria-checked={i === active} aria-label={full} className={i === active ? 'on' : ''} onClick={() => onApply(sp)}>{l}</button>
          ))}
        </div>
        <div className={'scap' + (active < 0 ? ' on' : '')}>Eigener Zeitraum{active < 0 && <Icon name="check" size={15} w={2.6} />}</div>
        <div className="slist">
          {row('from', 'Von', shortLabel(from))}
          {edit === 'from' && <MonthGrid value={from} min={min} max={now} onPick={(m) => { setFrom(m); setEdit(null); }} />}
          {row('to', 'Bis', to === null ? 'heute' : shortLabel(to))}
          {edit === 'to' && <>
            <button role="radio" aria-checked={to === null} className="srow sub" onClick={() => { setTo(null); setEdit(null); }}><span>heute</span>{to === null && <Icon name="check" size={17} w={2.6} />}</button>
            <MonthGrid value={toKey} min={min} max={now} onPick={(m) => { setTo(m === now ? null : m); setEdit(null); }} />
          </>}
        </div>
        <p className={'ssum' + (bad ? ' bad' : '')} role={bad ? 'alert' : undefined}>
          {bad ? '„Von“ liegt nach „Bis“.' : `${shortLabel(from)} – ${to === null ? 'heute' : shortLabel(to)} · ${len} ${len === 1 ? 'Monat' : 'Monate'}`}
        </p>
      </div>
    </Sheet>
  );
}

/**
 * Karte „Kategorien im Kreis“ (Auswertung): Zeitraum der Auswertung, Bereich wählen,
 * beim Aufklappen einer Kategorie ihr Verlauf über den Zeitraum.
 */
export function CategoryDonutCard({ all, cats, areas, span }: { all: Transaction[]; cats: Category[]; areas: DonutArea[]; span: MonthSpan }) {
  const now = currentMonthKey();
  const [area, setArea] = useState<DonutArea>(areas[0] as DonutArea);
  const a = areas.includes(area) ? area : (areas[0] as DonutArea);
  const toKey = span.to ?? now;
  const from = monthRange(span.from).from, to = monthRange(toKey).to;
  const txs = useMemo(() => filterTransactions(all, cats, { from, to }), [all, cats, from, to]);
  const period = spanLabel(span, now);
  // Verlauf: über den Zeitraum der Auswertung; bei nur einem Monat die 12 Monate bis dahin
  const len = monthsBetween(span.from, toKey);
  const trend = { all, end: toKey, n: len >= 2 ? len : 12 };
  const body = useRef<HTMLDivElement>(null);
  const idx = Math.max(0, areas.indexOf(a));
  const { handlers: swipe } = useAreaSwipe(areas, idx, setArea, body, true);
  return (
    <div className="card stack dcard">
      <div className="stack" style={{ gap: 2 }}><h2 style={{ margin: 0, fontSize: 'var(--t-section)' }}>Kategorien im Kreis</h2><span className="mini">{period}</span></div>
      {areas.length > 1 && (
        <div className="wmode dmode" role="group" aria-label="Bereich">
          {areas.map((x) => <button key={x} aria-pressed={x === a} style={{ ['--c' as string]: AREA_COLOR[x] }} onClick={() => setArea(x)}>{AREA_NAME[x]}</button>)}
        </div>
      )}
      {/* Wischen im Kreis wechselt den Bereich (wie bei den Kategorien); ganz links nach rechts geht es wie gewohnt zurück */}
      <div className="dswipe" ref={body} {...(areas.length > 1 ? { 'data-areas': '', 'data-first': idx === 0 ? '1' : '0', ...swipe } : {})}>
        <DonutView key={a + period} txs={txs} cats={cats} area={a} period={period} trend={trend} />
      </div>
    </div>
  );
}
