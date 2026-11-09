import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

let openSheets = 0;
/** Während ein Blatt offen ist, scrollt der Hintergrund nicht mit (iOS reicht Scrollen sonst durch). */
function lockBackground(on: boolean): void {
  openSheets = Math.max(0, openSheets + (on ? 1 : -1));
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => { v.style.overflowY = openSheets > 0 ? 'hidden' : ''; });
}

export function Sheet({ title, onClose, left = 'Abbrechen', onLeft, right, short, children }: { title: string; onClose: () => void; left?: string; onLeft?: () => void; right?: ReactNode; short?: boolean; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => { lockBackground(true); return () => lockBackground(false); }, []);
  // Nach unten wegziehen wie bei iOS: Das Blatt folgt dem Finger (nur wenn es ganz oben steht),
  // loslassen nach ~110 px oder mit Schwung schließt, sonst federt es zurück.
  const panelRef = useRef<HTMLDivElement>(null);
  const bdRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; x: number; lock?: 'v' | 'x'; dy: number; ly: number; lt: number; v: number } | null>(null);
  const closing = useRef(false);
  const moved = useRef(false);
  const setPos = (dy: number, animate: boolean) => {
    const p = panelRef.current, b = bdRef.current;
    const t = animate ? 'transform .26s cubic-bezier(.22,.9,.3,1)' : 'none';
    if (p) { p.style.transition = t; p.style.transform = dy ? `translate3d(0,${dy}px,0)` : ''; }
    if (b) { b.style.transition = animate ? 'opacity .26s ease' : 'none'; b.style.opacity = dy ? String(Math.max(0.15, 1 - dy / 600)) : ''; }
  };
  const canStart = (e: { target: EventTarget | null }) => {
    const p = panelRef.current;
    if (!p || closing.current || !(e.target instanceof Element)) return false;
    // Überall startbar (auch auf Feldern und Kategorie-Reihen); nur Zahlenfeld und Textfelder bleiben ausgenommen.
    // Wer seitlich wischt (z. B. durch die Kategorien), sperrt das Wegziehen für diese Geste.
    if (e.target.closest('textarea, .keydock, [data-nodrag]')) return false;
    return p.scrollTop <= 0 || !!e.target.closest('.ph');
  };
  useEffect(() => {
    const p = panelRef.current;
    if (!p) return;
    // iOS: während des Ziehens kein Scrollen/Nachfedern des Blatts
    const stop = (e: TouchEvent) => { if (drag.current?.lock === 'v') e.preventDefault(); };
    p.addEventListener('touchmove', stop, { passive: false });
    return () => p.removeEventListener('touchmove', stop);
  }, []);
  const dragHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      moved.current = false;
      if ((e.pointerType === 'mouse' && e.button !== 0) || !canStart(e)) { drag.current = null; return; }
      drag.current = { y: e.clientY, x: e.clientX, dy: 0, ly: e.clientY, lt: e.timeStamp, v: 0 };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dy = e.clientY - d.y, dx = e.clientX - d.x;
      if (!d.lock) {
        if (dy > 8 && dy > Math.abs(dx) * 1.2 && (panelRef.current?.scrollTop ?? 0) <= 0) { d.lock = 'v'; d.y = e.clientY; try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* egal */ } }
        else if (Math.abs(dx) > 8 || dy < -8) { drag.current = null; return; } else return;
        moved.current = true;
      }
      const dt = e.timeStamp - d.lt;
      if (dt > 0) d.v = 0.6 * ((e.clientY - d.ly) / dt) + 0.4 * d.v;
      d.ly = e.clientY; d.lt = e.timeStamp;
      d.dy = Math.max(0, e.clientY - d.y);
      setPos(d.dy, false);
    },
    onPointerUp: () => {
      const d = drag.current; drag.current = null;
      if (!d || d.lock !== 'v') return;
      if (d.dy > 110 || (d.v > 0.6 && d.dy > 60)) {
        closing.current = true;
        setPos(panelRef.current?.offsetHeight ?? 800, true);
        window.setTimeout(onClose, 230);
      } else setPos(0, true);
    },
    onPointerCancel: () => { if (drag.current?.lock === 'v') setPos(0, true); drag.current = null; },
    // Nach einem Zug keinen Tipp auf Kategorie oder Knopf auslösen
    onClickCapture: (e: React.MouseEvent) => { if (closing.current || moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; } }
  };
  // Außerhalb des scrollenden Inhalts (direkt in .app), damit nichts das Blatt beschneidet oder mitbewegt; Meldungen bleiben darüber
  return createPortal(
    <div className="sheetwrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bd" ref={bdRef} onClick={onClose} />
      <div className={'panel' + (short ? ' short' : '')} ref={panelRef} {...dragHandlers}>
        <div className="grab" aria-hidden="true" />
        <div className="ph">
          <button className={'lnk' + (onLeft ? ' lnkacc' : '')} onClick={onLeft ?? onClose}>{left}</button>
          <h2>{title}</h2>
          <div style={{ minWidth: 84, textAlign: 'right' }}>{right}</div>
        </div>
        {children}
      </div>
    </div>,
    document.querySelector('.app') ?? document.body
  );
}
