import { useMemo, useState } from 'react';
import type { Category, Transaction } from '../../domain/types';
import { duplicatePreset } from '../../domain/transactions';
import type { TxPreset } from '../../domain/transactions';
import { daysInMonth, todayISO, weekdayLong } from '../../domain/dates';
import { ringElapsed } from '../../ui/ringStart';
import { formatEUR } from '../../domain/money';
import { Icon } from '../../ui/icons';
import { Collapse } from '../../ui/Collapse';
import { Sheet } from '../../ui/Sheet';
import { SwipeRow } from '../../ui/SwipeRow';
import { isFresh } from '../../ui/fresh';
import { categoryName } from '../../domain/categories';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/**
 * Ampel je Tag, gemessen am Tagesbudget, als fließender Verlauf:
 * grün unter 75 % (je mehr, desto satter), orange 75–125 % (von hellem zu kräftigem Orange),
 * rot darüber (bis zum Dreifachen immer dunkler). Tage ohne Ausgaben bleiben ohne Farbe.
 */
export function dayTone(cents: number, ref: number): { tone: 'none' | 'low' | 'ok' | 'high'; bg: string; fg: string } {
  if (cents <= 0) return { tone: 'none', bg: '', fg: '' };
  const r = ref > 0 ? cents / ref : 1;
  const mix = (t: number, from: number, to: number) => from + (to - from) * Math.max(0, Math.min(1, t));
  const hsla = (h: number, a: number) => `hsla(${Math.round(h)},78%,50%,${a.toFixed(2)})`;
  // Schriftfarbe für den Kalender ohne Kästen: gleicher Farbton, gut lesbar auf Schwarz
  const fg = (h: number) => `hsl(${Math.round(h)},80%,62%)`;
  if (r < 0.75) { const t = r / 0.75; return { tone: 'low', bg: hsla(mix(t, 155, 128), mix(t, 0.2, 0.5)), fg: fg(mix(t, 155, 128)) }; }
  if (r <= 1.25) { const t = (r - 0.75) / 0.5; return { tone: 'ok', bg: hsla(mix(t, 40, 24), mix(t, 0.5, 0.75)), fg: fg(mix(t, 40, 24)) }; }
  const t = (r - 1.25) / 1.75;
  return { tone: 'high', bg: hsla(mix(t, 4, -8), mix(t, 0.6, 0.95)), fg: fg(mix(t, 4, -8)) };
}

/**
 * Ausgaben-Kalender (Jonas): Jeder Tag des Monats als Kachel in Ampelfarben, gemessen am Tagesbudget
 * (ohne Budget am eigenen Schnitt). Tage ohne Ausgaben bleiben ohne Farbe. Gezählt werden nur Alltagsausgaben ohne automatische Buchungen – Miete am 1. würde sonst alles
 * überstrahlen. Tipp auf einen Tag zeigt seine Buchungen.
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
  const pastDays = month < today.slice(0, 7) ? n : month > today.slice(0, 7) ? 0 : Number(today.slice(8, 10));
  const avg = pastDays > 0 ? Math.round(total / pastDays) : 0;
  // Vergleichswert: Tagesbudget, ohne Budget der eigene Schnitt
  const hasBudget = dailyBudget !== null && dailyBudget > 0;
  const ref = hasBudget ? (dailyBudget as number) : avg;
  const [intro0] = useState(ringElapsed);
  const first = (new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).getDay() + 6) % 7; // Montag = 0
  const cells: (string | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const dayTx = day ? txs.filter((t) => t.date === day) : [];
  const shortEUR = (c: number) => (c >= 100_000 ? `${Math.round(c / 100_000)}k` : String(Math.round(c / 100)));
  const weekday = weekdayLong;
  return (
    // Bewusst keine Karte: der Kalender soll sich von den Kategorie-Blöcken darunter abheben
    <section className="calsec" aria-label="Ausgaben-Kalender">
      <button className="calhead" aria-expanded={open} aria-label={`Ausgaben-Kalender ${open ? 'zuklappen' : 'aufklappen'}`} onClick={onToggle}>
        <span className="cap">Kalender</span>
        <span className="cap num calavg">{pastDays > 0 ? `Ø ${formatEUR(avg)} pro Tag` : ''}</span>
        <span className="calchev" style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)' }}><Icon name="right" size={14} w={2.4} /></span>
      </button>
      <Collapse open={open}>
        <div className="calgrid" role="grid" aria-label="Ausgaben pro Tag">
          {WD.map((w) => <span key={w} className="calwd" aria-hidden="true">{w}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={'e' + i} className="calcell empty" aria-hidden="true" />;
            const c = byDay.get(d) ?? 0;
            const future = d > today;
            // Heute ohne Ausgaben bleibt neutral – der Tag ist noch nicht vorbei
            const t = future || (d === today && c === 0) ? null : dayTone(c, ref);
            const word = !t || t.tone === 'none' ? '' : t.tone === 'low' ? ', unter dem Tagesbudget' : t.tone === 'ok' ? ', im Rahmen' : ', über dem Tagesbudget';
            return (
              <button key={d} className={'calcell' + (d === today ? ' today' : '') + (future ? ' future' : '') + (t ? ' t-' + t.tone : '')}
                style={t?.fg ? { ['--tone' as string]: t.fg } : undefined}
                disabled={future} onClick={() => setDay(d)}
                aria-label={`${weekday(d)}: ${c > 0 ? formatEUR(c) : 'keine Ausgaben'}${word.replace('Tagesbudget', hasBudget ? 'Tagesbudget' : 'Schnitt')}`}>
                <span className="calnum">{Number(d.slice(8, 10))}</span>
                {/* Beim Öffnen erscheinen die Beträge Tag für Tag */}
                {c > 0 && <span className="calamt num" style={{ ['--d' as string]: `${Math.min(i * 12, 360) - intro0}ms` }}>{shortEUR(c)}</span>}
              </button>
            );
          })}
        </div>

      </Collapse>
      {day && (
        <Sheet title={weekday(day)} left="Schließen" onClose={() => setDay(null)}>
          <div className="sp" style={{ padding: '0 4px' }}><span className="cap">{dayTx.length === 1 ? '1 Ausgabe' : `${dayTx.length} Ausgaben`}</span><b className="num">{formatEUR(dayTx.reduce((a, t) => a + t.amountCents, 0))}</b></div>
          {dayTx.length > 0 ? (
            <div className="card flush">
              {dayTx.map((t) => (
                <SwipeRow key={t.id} fresh={isFresh(t.id)} txid={t.id} onTap={() => { setDay(null); onOpenTx(t); }}
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
    </section>
  );
}
