import { useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { currentMonthKey, monthLabel } from '../domain/dates';
import { formatEUR0 } from '../domain/money';
import { Icon } from './icons';
import { Sheet } from './Sheet';

/** Monat (oder Jahr) per Tipp auf die Überschrift wählen. value: „Noch verfügbar“ je Monat ('2026-10') bzw. Jahr ('2026'), null = nichts gebucht. */
export interface MonthPick { month: string; onChange: (m: string) => void; value?: (prefix: string) => number | null; years?: boolean }

/** Monatsauswahl: Jahr blättern, 12 Monate mit Ausgaben, „Heute“ springt zum aktuellen Monat. Tipp wählt und schließt. */
/** Inhalt der Monatsauswahl (Jahr blättern + Kacheln mit „Noch verfügbar“) – im Blatt und im Herunterzieh-Panel */
function useMonthCells({ month, value, years }: Pick<MonthPick, 'month' | 'value' | 'years'>, year: number) {
  const cur = currentMonthKey();
  const cy = Number(cur.slice(0, 4));
  // grün = übrig, rot = im Minus (dezent); „−“ zusätzlich zur Farbe
  // null = nichts gebucht: Kachel wie ein künftiger Monat (grau, ohne Betrag)
  const amount = (prefix: string): { t: string; cls: string; say: string } | null => {
    const c = value ? value(prefix) : null;
    if (c === null) return null;
    if (c === 0) return { t: formatEUR0(0), cls: '', say: ', 0 € übrig' };
    return c > 0 ? { t: formatEUR0(c), cls: 'pos', say: `, ${formatEUR0(c)} übrig` } : { t: `−${formatEUR0(-c)}`, cls: 'neg', say: `, ${formatEUR0(-c)} im Minus` };
  };
  const cells = years
    ? Array.from({ length: 9 }, (_, i) => {
      const y = String(cy - 8 + i);
      const amt = amount(y);
      return { key: `${y}-${month.slice(5, 7)}`, label: y, long: y, sel: y === month.slice(0, 4), cur: Number(y) === cy, fut: !amt, amt };
    })
    : Array.from({ length: 12 }, (_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const amt = key > cur ? null : amount(key);
      return { key, label: monthLabel(key).slice(0, 3), long: monthLabel(key), sel: key === month, cur: key === cur, fut: !amt, amt };
    });
  return { cells, today: years ? `${cy}-${month.slice(5, 7)}` : cur };
}

function MonthBody({ month, value, years, choose, pop = true }: Pick<MonthPick, 'month' | 'value' | 'years'> & { choose: (m: string) => void; pop?: boolean }) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const { cells } = useMonthCells({ month, value, years }, year);
  return (
    <>
      {!years && (
        <div className="mpyear">
          <button className="ib" aria-label="Vorheriges Jahr" onClick={() => setYear(year - 1)}><Icon name="left" /></button>
          <b>{year}</b>
          <button className="ib" aria-label="Nächstes Jahr" onClick={() => setYear(year + 1)}><Icon name="right" /></button>
        </div>
      )}
      <div className={'mpgrid' + (pop ? '' : ' nopop')} key={years ? 'y' : year}>
        {cells.map((c, i) => (
          <button key={c.key} className={'mpcell' + (c.sel ? ' on' : c.cur ? ' cur' : c.fut ? ' fut' : '')} style={{ ['--i' as string]: i }}
            aria-label={c.long + (c.amt?.say ?? '')} aria-current={c.sel ? 'date' : undefined} onClick={() => choose(c.key)}>
            {c.label}{c.amt && <small className={c.amt.cls}>{c.amt.t}</small>}
          </button>
        ))}
      </div>
    </>
  );
}

/** Monatsauswahl als Blatt von unten (Tipp auf den Monat). Tipp auf einen Monat wählt und schließt. */
export function MonthPicker({ month, onChange, value, years, onClose }: MonthPick & { onClose: () => void }) {
  const { today } = useMonthCells({ month, value: undefined, years }, 0);
  const choose = (m: string) => { onClose(); if (m !== month) onChange(m); };
  return (
    <Sheet title={years ? 'Jahr' : 'Monat'} onClose={onClose} left="Heute" onLeft={() => choose(today)} short>
      <MonthBody month={month} value={value} years={years} choose={choose} />
    </Sheet>
  );
}

/** Steuerung des Herunterzieh-Panels: Strecke in px während des Ziehens, Loslassen mit Geschwindigkeit (px/ms) */
export interface DropCtl { move: (d: number) => void; end: (v: number) => void }

/**
 * Monatsauswahl, die beim Herunterziehen mitkommt – von unten, damit sie mit einer Hand erreichbar ist:
 * das Panel steigt mit dem Finger auf, der Hintergrund wird dabei zunehmend unscharf (wie die iPhone-Suche).
 * Loslassen ab gut einem Drittel (oder mit Schwung) öffnet, sonst gleitet es zurück.
 * Schließen: nach unten wischen oder auf den Hintergrund tippen.
 */
export function MonthDrop({ month, onChange, value, ctl, startD, onGone }: Omit<MonthPick, 'years'> & { ctl: MutableRefObject<DropCtl | null>; startD: number; onGone: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { today } = useMonthCells({ month, value: undefined }, 0);
  const pRef = useRef(0);
  const gone = useRef(onGone);
  gone.current = onGone;
  const setP = (p: number, anim: boolean) => {
    const w = wrap.current;
    if (!w) return;
    w.classList.toggle('anim', anim);
    pRef.current = p;
    w.style.setProperty('--p', String(p));
  };
  const h = () => panel.current?.offsetHeight || 460;
  // über das volle Panel hinaus nur noch zäh (Gummiband)
  const fromD = (d: number) => { const p = Math.max(0, d) / h(); return p <= 1 ? p : 1 + (p - 1) * 0.12; };
  const settle = (toOpen: boolean) => {
    setP(toOpen ? 1 : 0, true);
    setOpen(toOpen);
    if (!toOpen) window.setTimeout(() => gone.current(), 330);
  };
  useLayoutEffect(() => {
    ctl.current = {
      move: (d) => setP(fromD(d), false),
      end: (v) => settle(pRef.current > 0.3 || (v > 0.5 && pRef.current > 0.15))
    };
    setP(fromD(startD), false);
    return () => { ctl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (m: string) => { settle(false); if (m !== month) onChange(m); };
  // nach unten wischen schließt (Finger und Maus)
  const up = useRef<{ y: number; moved: boolean } | null>(null);
  const drag = {
    onPointerDown: (e: React.PointerEvent) => { if (open) up.current = { y: e.clientY, moved: false }; },
    onPointerMove: (e: React.PointerEvent) => {
      const u = up.current;
      if (!u) return;
      const dy = e.clientY - u.y;
      if (!u.moved && Math.abs(dy) < 8) return;
      u.moved = true;
      setP(Math.max(0, Math.min(1, 1 - dy / h())), false);
    },
    onPointerUp: () => { const u = up.current; up.current = null; if (u?.moved) settle(pRef.current > 0.75); },
    onPointerCancel: () => { if (up.current?.moved) settle(true); up.current = null; },
    onClickCapture: (e: React.MouseEvent) => { if (pRef.current < 0.99) { e.preventDefault(); e.stopPropagation(); } }
  };
  return createPortal(
    <div className={'drop' + (open ? ' open' : '')} ref={wrap} role="dialog" aria-modal="true" aria-label="Monat">
      <div className="dbd" onClick={() => settle(false)} />
      <div className="dpanel" ref={panel} {...drag}>
        <div className="grab" aria-hidden="true" />
        <div className="ph">
          <button className="lnk lnkacc" onClick={() => choose(today)}>Heute</button>
          <h2>Monat</h2>
          <div className="phr" />
        </div>
        <MonthBody month={month} value={value} choose={choose} pop={false} />
      </div>
    </div>,
    document.querySelector('.app') ?? document.body
  );
}
