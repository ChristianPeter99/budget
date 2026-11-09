import { useState } from 'react';
import { monthName, shiftMonth } from '../domain/dates';
import { Icon } from './icons';

/* ───── Zeitraum in einem Kalender: erster Tipp Start, zweiter Ende (Import-Filter, Buchungen) ───── */
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
/** Ein Kalender für Start und Ende; Tage mit Buchungen haben einen Punkt. Blättern per Pfeil. */
export function RangeCal({ min, max, from, to, days, onPick }: { min: string; max: string; from: string; to: string; days?: Set<string>; onPick: (d: string) => void }) {
  const [mk, setMk] = useState((from || max).slice(0, 7));
  // Über mehr als ein Jahr: zusätzlich jahresweise blättern
  const long = shiftMonth(min.slice(0, 7), 12) < max.slice(0, 7);
  const clampM = (k: string) => (k < min.slice(0, 7) ? min.slice(0, 7) : k > max.slice(0, 7) ? max.slice(0, 7) : k);
  const y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7));
  const first = new Date(y, m - 1, 1), count = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const iso = (d: number) => `${mk}-${String(d).padStart(2, '0')}`;
  const end = to || from;
  return (
    <div className="rcal">
      <div className="rcalnav">
        {long && <button className="ib yj" aria-label="Ein Jahr zurück" disabled={mk <= min.slice(0, 7)} onClick={() => setMk(clampM(shiftMonth(mk, -12)))}><Icon name="left" size={16} w={2.2} /><Icon name="left" size={16} w={2.2} /></button>}
        <button className="ib" aria-label="Vorheriger Monat" disabled={mk <= min.slice(0, 7)} onClick={() => setMk(shiftMonth(mk, -1))}><Icon name="left" size={20} w={2.2} /></button>
        <b>{monthName(m)} {y}</b>
        <button className="ib" aria-label="Nächster Monat" disabled={mk >= max.slice(0, 7)} onClick={() => setMk(shiftMonth(mk, 1))}><Icon name="right" size={20} w={2.2} /></button>
        {long && <button className="ib yj" aria-label="Ein Jahr vor" disabled={mk >= max.slice(0, 7)} onClick={() => setMk(clampM(shiftMonth(mk, 12)))}><Icon name="right" size={16} w={2.2} /><Icon name="right" size={16} w={2.2} /></button>}
      </div>
      <div className="rcalgrid" role="grid" aria-label={`${monthName(m)} ${y}`}>
        {WD.map((w) => <span key={w} className="rwd">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={'e' + i} />)}
        {Array.from({ length: count }, (_, i) => {
          const d = iso(i + 1);
          const out = d < min || d > max;
          const isS = d === from, isE = !!to && d === to;
          const inR = !!from && !!to && d > from && d < to;
          return (
            <button key={d} disabled={out} aria-label={`${i + 1}. ${monthName(m)} ${y}`} aria-pressed={isS || isE || inR}
              className={'rday' + (isS ? ' s' : '') + (isE || (isS && !to) ? ' e' : '') + (inR ? ' in' : '') + (from && to && from !== end ? ' hasr' : '') + (days?.has(d) ? ' bk' : '')}
              onClick={() => onPick(d)}><span>{i + 1}</span></button>
          );
        })}
      </div>
    </div>
  );
}
