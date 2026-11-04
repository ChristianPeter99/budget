import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as RPointerEvent } from 'react';

const HOLD_MS = 450;
const SLOP = 8;

interface Active { id: string; from: number; to: number; dy: number; step: number }
interface Pending { id: string; x: number; y: number; timer: number; pointerId: number; el: HTMLElement }

/**
 * Reihenfolge per Gedrückthalten und Ziehen (wie Apps auf dem Home-Bildschirm).
 * - Gedrückt halten (0,45 s) hebt das Element an, danach nach oben/unten ziehen, loslassen legt es ab.
 * - Bewegt sich der Finger vor Ablauf der Zeit, ist es normales Scrollen; ein kurzer Tipp bleibt ein Tipp.
 * `item(id)` kommt an das Element, das sich bewegt; `handle(id)` an die Fläche, die man gedrückt hält.
 */
export function useDragSort(ids: string[], onDrop: (ids: string[]) => void) {
  const [active, setActive] = useState<Active | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const pending = useRef<Pending | null>(null);
  const live = useRef<{ startY: number; rects: DOMRect[]; a: Active } | null>(null);
  const suppressClick = useRef(false);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // iOS: Während des Ziehens darf die Seite nicht scrollen. Dafür braucht es einen nicht-passiven touchmove-Listener.
  useEffect(() => {
    const stop = (e: TouchEvent) => { if (live.current) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);

  const cancelPending = () => { if (pending.current) { window.clearTimeout(pending.current.timer); pending.current = null; } };

  const finish = useCallback((commit: boolean) => {
    const l = live.current;
    live.current = null;
    setActive(null);
    document.body.classList.remove('dragging');
    if (!l || !commit || l.a.to === l.a.from) return;
    const next = [...idsRef.current];
    const [moved] = next.splice(l.a.from, 1);
    next.splice(l.a.to, 0, moved as string);
    onDrop(next);
  }, [onDrop]);

  const start = (p: Pending) => {
    const list = idsRef.current;
    const from = list.indexOf(p.id);
    if (from < 0) return;
    const rects = list.map((id) => els.current.get(id)?.getBoundingClientRect() ?? new DOMRect());
    const r = rects[from] as DOMRect;
    const next = rects[from + 1] ?? rects[from - 1];
    const gap = next ? Math.max(0, next.top > r.top ? next.top - r.bottom : r.top - next.bottom) : 0;
    const a = { id: p.id, from, to: from, dy: 0, step: r.height + gap };
    live.current = { startY: p.y, rects, a };
    suppressClick.current = true;
    document.body.classList.add('dragging');
    try { p.el.setPointerCapture(p.pointerId); } catch { /* nicht überall möglich */ }
    try { navigator.vibrate?.(10); } catch { /* optional */ }
    setActive(a);
  };

  const handle = (id: string) => ({
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelPending();
      suppressClick.current = false;
      const el = e.currentTarget;
      const p: Pending = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, el, timer: 0 };
      p.timer = window.setTimeout(() => { if (pending.current === p) { pending.current = null; start(p); } }, HOLD_MS);
      pending.current = p;
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const p = pending.current;
      if (p && (Math.abs(e.clientX - p.x) > SLOP || Math.abs(e.clientY - p.y) > SLOP)) cancelPending();
      const l = live.current;
      if (!l) return;
      e.preventDefault();
      const dy = e.clientY - l.startY;
      const r = l.rects[l.a.from] as DOMRect;
      const center = r.top + r.height / 2 + dy;
      let to = 0;
      l.rects.forEach((x, i) => { if (i !== l.a.from && x.top + x.height / 2 < center) to++; });
      l.a = { ...l.a, dy, to };
      setActive(l.a);
    },
    onPointerUp: () => { cancelPending(); if (live.current) finish(true); },
    onPointerCancel: () => { cancelPending(); if (live.current) finish(false); },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    // Nach dem Ziehen keinen Tipp auslösen
    onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; }
    }
  });

  const item = (id: string) => {
    const i = ids.indexOf(id);
    let style: CSSProperties | undefined;
    let cls = 'dsort';
    if (active) {
      if (id === active.id) { style = { transform: `translateY(${active.dy}px)` }; cls += ' lifted'; }
      else if (active.to > active.from && i > active.from && i <= active.to) style = { transform: `translateY(${-active.step}px)` };
      else if (active.to < active.from && i >= active.to && i < active.from) style = { transform: `translateY(${active.step}px)` };
      if (id !== active.id) cls += ' shifting';
    }
    return { ref: (el: HTMLElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); }, style, className: cls };
  };

  return { item, handle, dragging: active !== null };
}

/** Sichtbare Teilmenge neu geordnet → Gesamtreihenfolge: Die sichtbaren Elemente füllen der Reihe nach ihre bisherigen Plätze. */
export function mergeOrder(full: string[], visibleNew: string[]): string[] {
  const vis = new Set(visibleNew);
  const queue = [...visibleNew];
  return full.map((id) => (vis.has(id) ? (queue.shift() as string) : id));
}
