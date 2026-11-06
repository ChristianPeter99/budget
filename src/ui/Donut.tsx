import { useMemo, useState } from 'react';
import { formatEUR0 } from '../domain/money';
import type { Category, Transaction } from '../domain/types';
import { isHouseholdCat } from '../domain/types';

/** Ein Kreisabschnitt: Oberkategorie (Unterkategorien eingerechnet) mit Summe. */
export interface Slice { id: string; name: string; cents: number; count: number; cat?: Category }

export type DonutArea = 'fix' | 'alltag' | 'spar' | 'hh' | 'inc';
export const AREA_COLOR: Record<DonutArea, string> = { fix: 'var(--fix)', alltag: 'var(--all)', spar: 'var(--spar)', hh: 'var(--hh)', inc: 'var(--inc)' };
export const AREA_NAME: Record<DonutArea, string> = { fix: 'Fixkosten', alltag: 'Alltag', spar: 'Sparen', hh: 'Haushaltskonto', inc: 'Einnahmen' };

/**
 * Summen je Oberkategorie eines Bereichs, größte zuerst. Ab `max` Abschnitten werden die kleinsten
 * zu „Weitere“ zusammengefasst, damit der Kreis lesbar bleibt.
 */
export function areaSlices(txs: Transaction[], cats: Category[], area: DonutArea, max = 7): Slice[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const sums = new Map<string, { cents: number; count: number }>();
  for (const t of txs) {
    const c = byId.get(t.categoryId);
    const top = c?.parentId ? byId.get(c.parentId) ?? c : c;
    if (area === 'inc') { if (t.type !== 'income') continue; }
    else {
      if (t.type !== 'expense') continue;
      if (area === 'hh') { if (c && !isHouseholdCat(c)) continue; }
      else if (!top || top.group !== area || isHouseholdCat(top)) continue;
    }
    const k = top?.id ?? t.categoryId;
    const s = sums.get(k) ?? { cents: 0, count: 0 };
    s.cents += t.amountCents; s.count++;
    sums.set(k, s);
  }
  const all = [...sums.entries()].map(([id, s]) => ({ id, name: byId.get(id)?.name ?? 'Ohne Kategorie', cents: s.cents, count: s.count, cat: byId.get(id) }))
    .filter((s) => s.cents > 0).sort((a, b) => b.cents - a.cents);
  if (all.length <= max) return all;
  const rest = all.slice(max - 1);
  return [...all.slice(0, max - 1), { id: 'rest', name: `Weitere (${rest.length})`, cents: rest.reduce((a, s) => a + s.cents, 0), count: rest.reduce((a, s) => a + s.count, 0) }];
}

/**
 * Abstufungen einer Bereichsfarbe: abwechselnd heller und dunkler, damit benachbarte Abschnitte
 * unterscheidbar sind und alles trotzdem klar zum Bereich gehört. „Weitere“ immer grau.
 */
export function shade(color: string, i: number, id?: string): string {
  if (id === 'rest') return '#5A5E67';
  // nie zu dunkel (sonst verschwindet der Abschnitt auf der Spur), nie ganz weiß
  const steps = [100, 68, 70, 52, 80, 84, 50];
  const mixWhite = [false, false, true, true, false, true, false];
  const k = i % steps.length;
  if (k === 0) return color;
  return mixWhite[k] ? `color-mix(in srgb, ${color} ${steps[k]}%, #fff)` : `color-mix(in srgb, ${color} ${steps[k]}%, #000)`;
}

/** Ring aus Abschnitten (SVG-Kreise mit Strichlänge), Mittelpunkt 160/160 wie der Übersichtsring. */
export function DonutRing({ slices, color, total, selected, onSelect, r = 128, width = 34, gap = 2.5 }: {
  slices: Slice[]; color: string; total: number; selected: string | null; onSelect?: (id: string) => void; r?: number; width?: number; gap?: number;
}) {
  const C = 2 * Math.PI * r;
  const tot = Math.max(1, total);
  let off = 0;
  return (
    <>
      <circle cx="160" cy="160" r={r} fill="none" style={{ stroke: 'var(--ring-track)' }} strokeWidth={width} />
      {slices.map((s, i) => {
        const len = (s.cents / tot) * C;
        const o = off; off += len;
        if (len < 0.5) return null;
        const on = selected === s.id;
        return (
          <circle key={s.id} className={'ovseg dseg' + (selected && !on ? ' dim' : '') + (on ? ' on' : '')} cx="160" cy="160" r={r} fill="none"
            style={{ stroke: shade(color, i, s.id), animationDelay: `${i * 35}ms` }} strokeWidth={on ? width + 12 : width}
            strokeDasharray={`${Math.max(0.5, len - (slices.length > 1 ? gap : 0))} ${C}`} strokeDashoffset={-o} transform="rotate(-90 160 160)"
            onClick={onSelect ? () => onSelect(s.id) : undefined} />
        );
      })}
    </>
  );
}

/**
 * Karte „Kategorien im Kreis“ (Auswertung): Bereich wählen, Kreis der Kategorien als Summe über den Zeitraum,
 * Tipp auf Abschnitt oder Zeile zeigt Betrag und Anteil in der Mitte.
 */
export function CategoryDonutCard({ txs, cats, areas, period }: { txs: Transaction[]; cats: Category[]; areas: DonutArea[]; period: string }) {
  const [area, setArea] = useState<DonutArea>(areas[0] as DonutArea);
  const [sel, setSel] = useState<string | null>(null);
  const a = areas.includes(area) ? area : (areas[0] as DonutArea);
  const slices = useMemo(() => areaSlices(txs, cats, a, 8), [txs, cats, a]);
  const total = slices.reduce((s, x) => s + x.cents, 0);
  const color = AREA_COLOR[a];
  const pick = slices.find((x) => x.id === sel);
  const pIdx = slices.findIndex((x) => x.id === sel);
  const pickArea = (x: DonutArea) => { setArea(x); setSel(null); };
  return (
    <div className="card stack dcard">
      <div className="stack" style={{ gap: 2 }}><h2 style={{ margin: 0, fontSize: 'var(--t-section)' }}>Kategorien im Kreis</h2><span className="mini">{period}</span></div>
      {areas.length > 1 && (
        <div className="wmode dmode" role="group" aria-label="Bereich">
          {areas.map((x) => <button key={x} aria-pressed={x === a} style={{ ['--c' as string]: AREA_COLOR[x] }} onClick={() => pickArea(x)}>{AREA_NAME[x]}</button>)}
        </div>
      )}
      {slices.length === 0 ? <p className="note" style={{ textAlign: 'center', margin: '18px 0' }}>Keine Buchungen in diesem Zeitraum.</p> : <>
        <div className="dwrap">
          <svg viewBox="0 0 320 320" className="dsvg" role="img" aria-label={`${AREA_NAME[a]} nach Kategorien, ${period}: ${slices.map((x) => `${x.name} ${Math.round((x.cents / Math.max(1, total)) * 100)} Prozent`).join(', ')}`}>
            <g className="ovdrill" key={a}><DonutRing slices={slices} color={color} total={total} selected={sel} r={124} width={30} onSelect={(id) => setSel((s) => (s === id ? null : id))} /></g>
          </svg>
          <button className="dcenter" onClick={() => setSel(null)} aria-label={pick ? 'Auswahl aufheben' : AREA_NAME[a]}>
            {pick ? <>
              <span className="ovlabel" style={{ color: shade(color, pIdx, pick.id) }}>{pick.name}</span>
              <span className="ovamt">{formatEUR0(pick.cents)}</span>
              <span className="ovsub">{Math.round((pick.cents / Math.max(1, total)) * 100)} % · {pick.count === 1 ? '1 Buchung' : `${pick.count} Buchungen`}</span>
            </> : <>
              <span className="ovlabel" style={{ color }}>{AREA_NAME[a]}</span>
              <span className="ovamt">{formatEUR0(total)}</span>
              <span className="ovsub">{slices.length === 1 ? '1 Kategorie' : `${slices.length} Kategorien`}</span>
            </>}
          </button>
        </div>
        <div className="ovlegend" role="list">
          {slices.map((x, i) => (
            <button key={x.id} role="listitem" className={'ovlrow' + (sel === x.id ? ' on' : '') + (sel && sel !== x.id ? ' dim' : '')} onClick={() => setSel((s) => (s === x.id ? null : x.id))}>
              <i style={{ background: shade(color, i, x.id) }} />
              <span className="ovlname">{x.name}</span>
              <span className="ovlpct">{Math.round((x.cents / Math.max(1, total)) * 100)} %</span>
              <b className="num">{formatEUR0(x.cents)}</b>
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}
