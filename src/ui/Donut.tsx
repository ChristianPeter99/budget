import { useMemo, useState } from 'react';
import { formatEUR0 } from '../domain/money';
import type { Category, Transaction } from '../domain/types';
import { isHouseholdCat } from '../domain/types';
import { Chevr, Sheet, catIcon } from './common';
import { Icon } from './icons';

/** Ein Kreisabschnitt: Oberkategorie (Unterkategorien eingerechnet) mit Summe. „Weitere“ trägt die zusammengefassten in `members`. */
export interface Slice { id: string; name: string; cents: number; count: number; icon: string; cat?: Category; members?: Slice[] }

export type DonutArea = 'fix' | 'alltag' | 'spar' | 'hh' | 'inc';
export const AREA_COLOR: Record<DonutArea, string> = { fix: 'var(--fix)', alltag: 'var(--all)', spar: 'var(--spar)', hh: 'var(--hh)', inc: 'var(--inc)' };
export const AREA_NAME: Record<DonutArea, string> = { fix: 'Fixkosten', alltag: 'Alltag', spar: 'Sparen', hh: 'Haushaltskonto', inc: 'Einnahmen' };
/** Helle Bereichsfarben bekommen dunkle Symbole */
const LIGHT: Record<DonutArea, boolean> = { fix: false, alltag: false, spar: true, hh: true, inc: true };

/** Gehört die Buchung zum Bereich? Liefert die Oberkategorie (oder undefined, wenn nicht). */
function inArea(t: Transaction, byId: Map<string, Category>, area: DonutArea): { top?: Category; c?: Category } | null {
  const c = byId.get(t.categoryId);
  const top = c?.parentId ? byId.get(c.parentId) ?? c : c;
  if (area === 'inc') return t.type === 'income' ? { top, c } : null;
  if (t.type !== 'expense') return null;
  if (area === 'hh') return c && !isHouseholdCat(c) ? null : { top, c };
  return !top || top.group !== area || isHouseholdCat(top) ? null : { top, c };
}

/**
 * Summen je Oberkategorie eines Bereichs, größte zuerst. Ab `max` Abschnitten werden die kleinsten
 * zu „Weitere“ zusammengefasst, damit der Kreis lesbar bleibt.
 */
export function areaSlices(txs: Transaction[], cats: Category[], area: DonutArea, max = 7): Slice[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const sums = new Map<string, { cents: number; count: number }>();
  for (const t of txs) {
    const hit = inArea(t, byId, area);
    if (!hit) continue;
    const k = hit.top?.id ?? t.categoryId;
    const s = sums.get(k) ?? { cents: 0, count: 0 };
    s.cents += t.amountCents; s.count++;
    sums.set(k, s);
  }
  const all: Slice[] = [...sums.entries()].map(([id, s]) => {
    const cat = byId.get(id);
    return { id, name: cat?.name ?? 'Ohne Kategorie', cents: s.cents, count: s.count, cat, icon: cat ? catIcon(cats, cat) : 'dots' };
  }).filter((s) => s.cents > 0).sort((a, b) => b.cents - a.cents);
  if (all.length <= max) return all;
  const rest = all.slice(max - 1);
  return [...all.slice(0, max - 1), { id: 'rest', name: `Weitere (${rest.length})`, icon: 'dots', members: rest, cents: rest.reduce((a, s) => a + s.cents, 0), count: rest.reduce((a, s) => a + s.count, 0) }];
}

/** Aufteilung einer Oberkategorie nach Unterkategorien (Buchungen direkt auf der Oberkategorie als eigene Zeile). */
export function subRows(txs: Transaction[], cats: Category[], area: DonutArea, topId: string): { id: string; name: string; cents: number }[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const m = new Map<string, number>();
  for (const t of txs) {
    const hit = inArea(t, byId, area);
    if (!hit || (hit.top?.id ?? t.categoryId) !== topId) continue;
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amountCents);
  }
  const hasKids = cats.some((c) => c.parentId === topId);
  return [...m.entries()].map(([id, cents]) => ({ id, cents, name: id === topId ? (hasKids ? 'Ohne Unterkategorie' : 'Buchungen') : byId.get(id)?.name ?? '–' }))
    .filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents);
}

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

/**
 * Kreis der Kategorien mit Mitte und Liste darunter (gemeinsam für das Pop-up der Übersicht und die Auswertung).
 * Tipp auf Abschnitt oder Zeile wählt die Kategorie, darunter klappt ihre Aufteilung auf; Tipp in die Mitte hebt die Auswahl auf.
 */
export function DonutView({ txs, cats, area, label, period }: { txs: Transaction[]; cats: Category[]; area: DonutArea; label?: string; period?: string }) {
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
            <span className="ovsub">{slices.length === 1 ? '1 Kategorie' : `${slices.length} Kategorien`}</span>
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
            {sel === x.id && (
              <div className="ovlsubs">
                {(x.members ? x.members.map((m) => ({ id: m.id, name: m.name, cents: m.cents })) : subRows(txs, cats, area, x.id)).map((r) => (
                  <div className="ovlsub" key={r.id}><span>{r.name}</span><span className="ovlpct">{pct(r.cents)} %</span><span className="num">{formatEUR0(r.cents)}</span></div>
                ))}
              </div>
            )}
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

/**
 * Karte „Kategorien im Kreis“ (Auswertung): Bereich wählen, Kreis der Kategorien als Summe über den Zeitraum.
 */
export function CategoryDonutCard({ txs, cats, areas, period }: { txs: Transaction[]; cats: Category[]; areas: DonutArea[]; period: string }) {
  const [area, setArea] = useState<DonutArea>(areas[0] as DonutArea);
  const a = areas.includes(area) ? area : (areas[0] as DonutArea);
  return (
    <div className="card stack dcard">
      <div className="stack" style={{ gap: 2 }}><h2 style={{ margin: 0, fontSize: 'var(--t-section)' }}>Kategorien im Kreis</h2><span className="mini">{period}</span></div>
      {areas.length > 1 && (
        <div className="wmode dmode" role="group" aria-label="Bereich">
          {areas.map((x) => <button key={x} aria-pressed={x === a} style={{ ['--c' as string]: AREA_COLOR[x] }} onClick={() => setArea(x)}>{AREA_NAME[x]}</button>)}
        </div>
      )}
      <DonutView key={a} txs={txs} cats={cats} area={a} period={period} />
    </div>
  );
}
