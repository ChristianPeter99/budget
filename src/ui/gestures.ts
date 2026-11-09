import { useEffect, useRef } from 'react';

/**
 * Wischen zwischen Bereichs-Reitern (Kategorien, Neue Buchung): nach links → nächster, nach rechts → voriger.
 * Der Inhalt (body) folgt dem Finger, gleitet beim Wechsel hinaus und von der anderen Seite herein.
 * releaseFirst: am ersten Reiter nach rechts nichts tun (die App übernimmt, z. B. „zurück“).
 */
export function useAreaSwipe<K>(keys: K[], idx: number, set: (k: K) => void, bodyRef: React.RefObject<HTMLElement | null>, releaseFirst = false) {
  const go = (a: K, dir?: 1 | -1, v = 0) => {
    const el = bodyRef.current;
    if (!dir || !el || matchMedia('(prefers-reduced-motion: reduce)').matches) { if (el) { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; } set(a); return; }
    const w = el.clientWidth || 360;
    const out = Math.round(Math.min(150, Math.max(80, 120 - Math.abs(v) * 25)));
    el.style.transition = `transform ${out}ms cubic-bezier(.4,0,1,1), opacity ${out}ms linear`;
    el.style.transform = `translate3d(${-dir * w * 0.55}px,0,0)`; el.style.opacity = '0';
    window.setTimeout(() => {
      set(a);
      el.style.transition = 'none'; el.style.transform = `translate3d(${dir * w * 0.22}px,0,0)`; el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = 'transform .2s cubic-bezier(.2,.85,.25,1), opacity .16s ease-out';
        el.style.transform = ''; el.style.opacity = '';
      }));
    }, out);
  };
  const asw = useRef<{ x: number; y: number; lock?: 'h' | 'v'; d: number; lx: number; lt: number; v: number } | null>(null);
  const swiped = useRef(false);
  // iOS: während des seitlichen Wischens nicht zusätzlich senkrecht scrollen
  useEffect(() => {
    const stop = (e: TouchEvent) => { if (asw.current?.lock === 'h') e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      swiped.current = false;
      const t = e.target as Element;
      // Inhalte aus Portalen (z. B. ein Blatt über der Seite) bubbeln in React mit – die nicht mitnehmen
      if ((e.pointerType === 'mouse' && e.button !== 0) || !(e.currentTarget as Element).contains(t) || t.closest('input, textarea, select, [data-noswipe]')) { asw.current = null; return; }
      asw.current = { x: e.clientX, y: e.clientY, d: 0, lx: e.clientX, lt: e.timeStamp, v: 0 };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const st = asw.current, el = bodyRef.current;
      if (!st || !el) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.lock) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > 1.2 * Math.abs(dy)) {
          if (releaseFirst && dx > 0 && idx === 0) { asw.current = null; return; }
          st.lock = 'h'; st.x = e.clientX;
          try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* egal */ }
        } else if (Math.abs(dy) > 10) { asw.current = null; return; } else return;
      }
      const d = e.clientX - st.x;
      const dt = e.timeStamp - st.lt;
      if (dt > 0) st.v = 0.6 * ((e.clientX - st.lx) / dt) + 0.4 * st.v;
      st.lx = e.clientX; st.lt = e.timeStamp;
      const edge = (d < 0 && idx === keys.length - 1) || (d > 0 && idx === 0);
      st.d = d;
      el.style.transition = 'none';
      el.style.transform = `translate3d(${edge ? d * 0.2 : d}px,0,0)`;
      el.style.opacity = String(edge ? 1 : Math.max(0.4, 1 - Math.abs(d) / (el.clientWidth || 360)));
    },
    onPointerUp: () => {
      const st = asw.current, el = bodyRef.current; asw.current = null;
      if (!st || st.lock !== 'h' || !el) return;
      swiped.current = true;
      const w = el.clientWidth || 360;
      const live = performance.now() - st.lt < 100;
      const fling = live && Math.abs(st.v) > 0.3 && Math.sign(st.v) === Math.sign(st.d);
      const dir: 1 | -1 = st.d < 0 ? 1 : -1;
      const target = keys[idx + dir];
      if (target !== undefined && (Math.abs(st.d) > w * 0.2 || fling)) { go(target, dir, live ? st.v : 0); return; }
      el.style.transition = 'transform .18s cubic-bezier(.2,.85,.25,1), opacity .16s ease';
      el.style.transform = ''; el.style.opacity = '';
    },
    onPointerCancel: () => { const el = bodyRef.current; asw.current = null; if (el) { el.style.transition = 'transform .2s ease'; el.style.transform = ''; el.style.opacity = ''; } },
    onClickCapture: (e: React.MouseEvent) => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; } },
  };
  return { go, handlers };
}

/**
 * Nach unten ziehen (oben auf der Seite, egal wo): start, dann move(Strecke), end(Geschwindigkeit px/ms).
 * Waagerechtes Wischen bleibt beim Seitenwechsel; nach oben oder bei gescrollter Seite passiert nichts.
 */
export function usePullDown(ref: React.RefObject<HTMLElement | null>, cbs: { start: () => void; move: (d: number) => void; end: (v: number) => void }, enabled = true) {
  const cb = useRef(cbs);
  cb.current = cbs;
  const on = useRef(enabled);
  on.current = enabled;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const view = el.closest('.view') as HTMLElement | null;
    let st: { x: number; y: number; pull: boolean; dead: boolean; d: number; t: number; v: number } | null = null;
    const start = (x: number, y: number, target: EventTarget | null) => {
      if (!on.current || (view?.scrollTop ?? 0) > 0) return;
      if (target instanceof Element && target.closest('.sheetwrap,.drop,[data-lockswipe],input,textarea')) return;
      st = { x, y, pull: false, dead: false, d: 0, t: performance.now(), v: 0 };
    };
    // true = ziehen ist aktiv (dann kein Scrollen)
    const move = (x: number, y: number): boolean => {
      if (!st || st.dead) return false;
      const dx = x - st.x, dy = y - st.y;
      if (!st.pull) {
        if (Math.abs(dx) > 10 && Math.abs(dx) >= Math.abs(dy)) { st.dead = true; return false; }
        if (dy < -6) { st.dead = true; return false; }
        if (dy > 10 && dy > Math.abs(dx) * 1.4) { st.pull = true; cb.current.start(); } else return false;
      }
      const d = Math.max(0, dy), now = performance.now();
      if (now > st.t) st.v = 0.6 * st.v + 0.4 * ((d - st.d) / (now - st.t));
      st.d = d; st.t = now;
      cb.current.move(d);
      return true;
    };
    const end = () => {
      if (st?.pull) cb.current.end(performance.now() - st.t > 120 ? 0 : st.v);
      st = null;
    };
    const ts = (e: TouchEvent) => { if (e.touches.length === 1) start(e.touches[0]!.clientX, e.touches[0]!.clientY, e.target); else st = null; };
    const tm = (e: TouchEvent) => { const t = e.touches[0]; if (t && move(t.clientX, t.clientY) && e.cancelable) e.preventDefault(); };
    const md = (e: PointerEvent) => { if (e.pointerType === 'mouse' && e.button === 0) start(e.clientX, e.clientY, e.target); };
    const mm = (e: PointerEvent) => { if (e.pointerType === 'mouse') move(e.clientX, e.clientY); };
    const mu = (e: PointerEvent) => { if (e.pointerType === 'mouse') end(); };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('pointerdown', md);
    window.addEventListener('pointermove', mm);
    window.addEventListener('pointerup', mu);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('pointerdown', md);
      window.removeEventListener('pointermove', mm);
      window.removeEventListener('pointerup', mu);
    };
  }, [ref]);
}
