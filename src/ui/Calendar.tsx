import { useMemo, useState } from 'react';
import { Collapse, Sheet } from './common';
import { Icon } from './icons';
import { SwipeRow } from './Bookings';
import { duplicatePreset } from './TxSheet';
import type { TxPreset } from './TxSheet';
import { isFresh } from './fresh';
import { categoryName } from '../domain/calc';
import { daysInMonth, todayISO } from '../domain/dates';
import { formatEUR, formatEUR0 } from '../domain/money';
import type { Category, Transaction } from '../domain/types';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/**
 * Ausgaben-Kalender (Jonas): Jeder Tag des Monats als Kachel, je dunkler das Blau, desto mehr wurde an dem Tag
 * ausgegeben. Gezählt werden nur Alltagsausgaben ohne automatische Buchungen – Miete am 1. würde sonst alles
 * überstrahlen. Tage über dem Tagesbudget bekommen einen orangen Punkt. Tipp auf einen Tag zeigt seine Buchungen.
 */
export function SpendCalendar({ month, txs, cats, dailyBudget, open, onToggle, onOpenTx, onAdd, onDelete }: {
  month: string; txs: Transaction[]; cats: Category[]; dailyBudget: number | null; open: boolean; onToggle: () => void;
  onOpenTx: (t: Transaction) => void; onAdd: (p: TxPreset) => void; onDelete: (id: string) => void;
}) {
  const [day, setDay] = useState<string | null>(null);
  const today = todayISO();
  const n = daysInMonth(month);
  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs) m.set(t.date, (m.get(t.date) ?? 0) + t.amountCents);
    return m;
  }, [txs]);
  const total = [...byDay.values()].reduce((a, x) => a + x, 0);
  const max = Math.max(0, ...byDay.values());
  const pastDays = month < today.slice(0, 7) ? n : month > today.slice(0, 7) ? 0 : Number(today.slice(8, 10));
  const avg = pastDays > 0 ? Math.round(total / pastDays) : 0;
  const first = (new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).getDay() + 6) % 7; // Montag = 0
  const cells: (string | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const dayTx = day ? txs.filter((t) => t.date === day) : [];
  const shortEUR = (c: number) => (c >= 100_000 ? `${Math.round(c / 100_000)}k` : String(Math.round(c / 100)));
  const weekday = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="card flush calcard">
      <button className="calhead" aria-expanded={open} aria-label={`Ausgaben-Kalender ${open ? 'zuklappen' : 'aufklappen'}`} onClick={onToggle}>
        <Icon name="cal" size={18} />
        <b>Kalender</b>
        <span className="cap num">{pastDays > 0 ? `Ø ${formatEUR(avg)} pro Tag` : ''}</span>
        <span className="chev" style={{ transform: open ? 'rotate(90deg)' : 'none' }}><Icon name="right" size={14} w={2.4} /></span>
      </button>
      <Collapse open={open}>
        <div className="calgrid" role="grid" aria-label="Ausgaben pro Tag">
          {WD.map((w) => <span key={w} className="calwd" aria-hidden="true">{w}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={'e' + i} className="calcell empty" aria-hidden="true" />;
            const c = byDay.get(d) ?? 0;
            const future = d > today;
            // Wurzel-Skala: kleine Beträge bleiben sichtbar, große dominieren nicht alles
            const a = c > 0 && max > 0 ? 0.16 + 0.64 * Math.sqrt(c / max) : 0;
            const over = dailyBudget !== null && dailyBudget > 0 && c > dailyBudget;
            return (
              <button key={d} className={'calcell' + (d === today ? ' today' : '') + (future ? ' future' : '') + (over ? ' over' : '')}
                style={a ? { background: `rgba(10,132,255,${a.toFixed(2)})` } : undefined}
                disabled={future} onClick={() => setDay(d)}
                aria-label={`${weekday(d)}: ${c > 0 ? formatEUR(c) : 'keine Ausgaben'}${over ? ', über dem Tagesbudget' : ''}`}>
                <span className="calnum">{Number(d.slice(8, 10))}</span>
                {c > 0 && <span className="calamt num">{shortEUR(c)}</span>}
              </button>
            );
          })}
        </div>
        <div className="callegend">
          <span><i className="lg lo" /><i className="lg mid" /><i className="lg hi" />weniger · mehr</span>
          {dailyBudget !== null && dailyBudget > 0 && <span><i className="lg overdot" />über {formatEUR0(dailyBudget)} Tagesbudget</span>}
        </div>
      </Collapse>
      {day && (
        <Sheet title={weekday(day)} left="Schließen" onClose={() => setDay(null)}>
          <div className="sp" style={{ padding: '0 4px' }}><span className="cap">{dayTx.length === 1 ? '1 Ausgabe' : `${dayTx.length} Ausgaben`}</span><b className="num">{formatEUR(dayTx.reduce((a, t) => a + t.amountCents, 0))}</b></div>
          {dayTx.length > 0 ? (
            <div className="card flush">
              {dayTx.map((t) => (
                <SwipeRow key={t.id} fresh={isFresh(t.id)} onTap={() => { setDay(null); onOpenTx(t); }}
                  menu={{ onEdit: () => { setDay(null); onOpenTx(t); }, onDuplicate: () => { setDay(null); onAdd(duplicatePreset(t)); }, onDelete: () => onDelete(t.id) }}>
                  <span className="mid"><b>{t.description || categoryName(cats, t.categoryId).split(' › ').pop()}</b><small>{categoryName(cats, t.categoryId)}</small></span>
                  <span className="amt">{formatEUR(t.amountCents)}</span>
                </SwipeRow>
              ))}
            </div>
          ) : <p className="note">An diesem Tag keine Alltagsausgaben.</p>}
          <button className="btn cta" onClick={() => { setDay(null); onAdd({ date: day }); }}>Ausgabe für diesen Tag</button>
        </Sheet>
      )}
    </div>
  );
}
