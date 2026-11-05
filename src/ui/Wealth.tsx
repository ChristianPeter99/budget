import { useState } from 'react';
import type { ReactNode } from 'react';
import { Empty, Header } from './common';
import { useStore } from '../state/store';
import { savingsEntries } from '../db/repo';
import { formatDateDE, monthRange, shiftMonth, todayISO } from '../domain/dates';
import { formatEUR0 } from '../domain/money';
import type { DepotEntry } from '../domain/types';
import { DepotChart } from './Stats';
import { savingsEstimate } from './Sparen';

/**
 * Gesamtvermögen: Sparkonto (heute geschätzt) + letzter Depotstand. Der Verlauf setzt sich an jedem Tag mit
 * einem Eintrag aus dem jeweils letzten bekannten Sparkonto- und Depotstand zusammen.
 */
export function WealthPage({ back }: { back: ReactNode }) {
  const { data } = useStore();
  const [range, setRange] = useState<3 | 6 | 12 | 0>(12);
  const today = todayISO();
  const sav = savingsEstimate(data, today);
  const depot = [...data.depotEntries].sort((a, b) => a.date.localeCompare(b.date));
  const lastDepot = depot[depot.length - 1];
  const total = sav.cents + (lastDepot?.valueCents ?? 0);
  const savHist = [...savingsEntries(data.settings)].sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set([...savHist.map((e) => e.date), ...depot.map((e) => e.date)])].sort();
  const latest = <T extends { date: string }>(xs: T[], d: string): T | undefined => { let r: T | undefined; for (const x of xs) { if (x.date <= d) r = x; else break; } return r; };
  const series: DepotEntry[] = dates.map((d) => ({ id: d, date: d, createdAt: d, valueCents: (latest(savHist, d)?.cents ?? 0) + (latest(depot, d)?.valueCents ?? 0) }));
  // Heutigen Stand (inkl. seitdem gebuchter Sparraten) als letzten Punkt
  if (series.length > 0 && series[series.length - 1]!.date < today) series.push({ id: today, date: today, createdAt: today, valueCents: total });
  const cutoff = range === 0 ? '' : monthRange(shiftMonth(today.slice(0, 7), -range)).from;
  const shown = series.filter((e) => e.date >= cutoff);
  const first = shown[0];
  const diff = first && shown.length > 1 ? total - first.valueCents : null;
  return (
    <>
      {back}
      <Header title="Gesamtvermögen" />
      <div className="card flush">
        <div className="pad stack" style={{ gap: 4 }}>
          <span className="cap">Heute</span>
          <span className="mid34 num">{formatEUR0(total)}</span>
          {diff !== null && first && <span className={'mini ' + (diff >= 0 ? 'pos' : 'neg')}>{diff >= 0 ? '+' : '−'}{formatEUR0(Math.abs(diff))} seit {formatDateDE(first.date)}</span>}
        </div>
        <div className="kv"><span>Sparkonto{sav.known ? ' (heute geschätzt)' : ''}</span><b>{sav.known ? formatEUR0(sav.cents) : '–'}</b></div>
        <div className="kv"><span>Depot{lastDepot ? ` · ${formatDateDE(lastDepot.date)}` : ''}</span><b>{lastDepot ? formatEUR0(lastDepot.valueCents) : '–'}</b></div>
      </div>
      <div className="card flush">
        <div className="sec"><h2>Verlauf</h2></div>
        {series.length === 0 ? <Empty>Noch keine Stände erfasst. Trag sie unter Mehr › Sparen & Depot ein.</Empty> : (
          <div className="pad stack">
            <div className="sel" role="group" aria-label="Zeitraum">
              {([3, 6, 12, 0] as const).map((k) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{k === 0 ? 'Alle' : `${k} M`}</button>)}
            </div>
            <DepotChart entries={shown} name="Vermögens" />
          </div>
        )}
      </div>
      <p className="note">Berechnet aus deinen erfassten Ständen von Sparkonto und Depot – ohne Girokonto und ohne Bankanbindung. Die Stände pflegst du unter Mehr › Sparen & Depot.</p>
    </>
  );
}
