import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MorePage } from './More';
import { shiftMonth } from '../domain/dates';
import { clearRingStart, markRingStart } from '../ui/ringStart';

export type Tab = 'home' | 'alltag' | 'bookings' | 'fix' | 'more';
export const TABS: Tab[] = ['home', 'alltag', 'bookings', 'fix', 'more'];

/** Dauer des Einrastens nach dem Wischen: kurz bei Schwung oder wenig Restweg, nie träge (150–280 ms). */
let settleMs = 260;
function settleDuration(rest: number, v: number): number {
  const speed = Math.max(Math.abs(v), 1.1); // px/ms – mindestens zügig
  return Math.round(Math.min(280, Math.max(150, (rest / speed) * 1.7)));
}

/** Wischen zwischen den Reitern (mit Vorschau der Nachbarseite), Zurückwischen in Unterseiten und Monatswischen im Kopf. */
export function useTabSwipe({ tab, morePage, origin, setTab, setMorePage, month, setMonth }: {
  tab: Tab; morePage: MorePage; origin: Tab; setTab: (t: Tab) => void; setMorePage: (p: MorePage) => void; month: string; setMonth: (m: string) => void;
}) {
  // Blättern wie auf dem Home-Bildschirm: Seite folgt dem Finger, Nachbarseite kommt mit, Einrasten mit Schwung.
  // Die Bewegung wird direkt per transform gesetzt (ohne React-Neuaufbau pro Fingerbewegung), damit sie flüssig bleibt.
  const [peek, setPeek] = useState<Tab | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const sw = useRef<{ x: number; y: number; month: boolean; pop: boolean; lock?: 'h' | 'v'; lx: number; lt: number; v: number; next: Tab | null; dx: number; areas?: Element | null } | null>(null);
  const swiped = useRef(false);
  const busy = useRef(false);
  const pos = useRef({ dx: 0, side: 1 as 1 | -1, frame: 0 });
  const resetAfterCommit = useRef(false);
  /** Zurückwischen aktiv: die vorige Ebene liegt als Kopie unter der Unterseite */
  const popMode = useRef(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const clones = useRef<{ main?: HTMLElement; ghost?: HTMLElement; ghostFor?: Element }>({});
  // Nach dem Umblättern: Verschiebung zurücksetzen, bevor der Browser zeichnet (kein Aufblitzen der alten Seite)
  useLayoutEffect(() => {
    if (!resetAfterCommit.current) return;
    resetAfterCommit.current = false;
    const m = mainRef.current;
    if (m) { m.style.transition = 'none'; m.style.transform = ''; m.scrollTop = 0; }
    clearHead();
    pos.current.dx = 0;
  }, [tab]);
  // iOS: während des seitlichen Ziehens nicht zusätzlich senkrecht scrollen (verhindert Zittern)
  useEffect(() => {
    const m = mainRef.current;
    if (!m) return;
    const stop = (e: TouchEvent) => { if (sw.current?.lock === 'h') e.preventDefault(); };
    m.addEventListener('touchmove', stop, { passive: false });
    return () => m.removeEventListener('touchmove', stop);
  });

  /** „Zurück“-Knopf einer Unterseite in der aktuellen Seite */
  const popBtn = () => mainRef.current?.querySelector<HTMLElement>('[data-pop]') ?? null;
  const noSwipe = (el: EventTarget | null) => !(el instanceof Element)
    || !!el.closest('[role="dialog"], input, textarea, select, [data-noswipe]') || document.body.classList.contains('dragging');
  const EASE_FN = 'cubic-bezier(.2,.85,.25,1)';
  const ease = () => `transform ${settleMs}ms ${EASE_FN}`;
  const width = () => mainRef.current?.clientWidth || window.innerWidth;
  /** Position zeichnen – höchstens einmal pro Bildschirmbild. */
  /**
   * Kopfzeile beim Blättern feststehend: Die Köpfe beider Seiten werden gegen die Verschiebung gehalten.
   * Gleiche Teile (Monat, Pfeile) bleiben einfach stehen, unterschiedliche (z. B. „Übersicht“ → „Alltag“,
   * „noch 27 Tage“, Stift) werden weich überblendet.
   */
  const headParts = (hd: Element | null | undefined) => {
    const m = new Map<string, HTMLElement>();
    if (!hd) return m;
    const h1 = hd.querySelector<HTMLElement>('h1'); if (h1) m.set('h1', h1);
    const k = hd.querySelector<HTMLElement>('.kick'); if (k) m.set('kick', k);
    hd.querySelectorAll<HTMLElement>('.mn button[aria-label], .mn .pillbtn').forEach((b) => m.set('b:' + (b.getAttribute('aria-label') ?? b.textContent ?? ''), b));
    return m;
  };
  // Feststehende Kopie beider Köpfe in einer eigenen Ebene über der Seite (die Seiten selbst schneiden seitlich ab)
  const placeClone = (src: HTMLElement, leftFrom: HTMLElement | null, shift: number) => {
    const layer = layerRef.current!;
    // Position ohne die aktuelle Verschiebung der Seite, damit der Kopf genau an seinem Ruheplatz steht
    const lr = layer.getBoundingClientRect(), r = src.getBoundingClientRect(), lx = (leftFrom ?? src).getBoundingClientRect().left - shift;
    const c = src.cloneNode(true) as HTMLElement;
    c.removeAttribute('data-swipe');
    Object.assign(c.style, { position: 'absolute', margin: '0', top: `${r.top - lr.top}px`, left: `${lx - lr.left}px`, width: `${r.width}px`, transform: '', transition: '' });
    layer.appendChild(c);
    src.style.visibility = 'hidden';
    return c;
  };
  const headFx = (dx: number, _side: number, animate: boolean) => {
    const layer = layerRef.current;
    if (!layer) return;
    const mh = mainRef.current?.querySelector<HTMLElement>('.hd') ?? null;
    const gh = ghostRef.current?.querySelector<HTMLElement>('.hd') ?? null;
    const c = clones.current;
    if (!c.main && mh && dx) c.main = placeClone(mh, null, dx);
    if (gh && c.ghostFor !== gh) { c.ghost?.remove(); c.ghost = placeClone(gh, mh, dx); c.ghostFor = gh; }
    const prog = Math.min(1, Math.abs(dx) / width());
    // Ist der Kopf der aktuellen Seite weggescrollt, erscheint der neue sofort vollständig (nichts zum Überblenden)
    const lr = layer.getBoundingClientRect();
    const mainShown = !!c.main && c.main.getBoundingClientRect().bottom > lr.top + 8;
    if (!mainShown && c.ghost) {
      headParts(c.ghost).forEach((el) => { el.style.transition = 'none'; el.style.opacity = '1'; });
      return;
    }
    const a = headParts(c.main), b = headParts(c.ghost);
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(key), y = b.get(key);
      const same = !!x && !!y && x.textContent === y.textContent;
      const t = animate ? `opacity ${settleMs}ms ease` : 'none';
      // Unterschiedliches erst aus-, dann einblenden (ohne Überlappung der Texte)
      if (x) { x.style.transition = t; x.style.opacity = same ? '1' : String(Math.max(0, 1 - 2 * prog)); }
      if (y) { y.style.transition = t; y.style.opacity = same ? '0' : String(Math.max(0, 2 * prog - 1)); }
    }
  };
  const paint = (animate = false) => {
    const p = pos.current;
    if (p.frame) cancelAnimationFrame(p.frame);
    p.frame = requestAnimationFrame(() => {
      p.frame = 0;
      const m = mainRef.current, g = ghostRef.current, tr = animate ? ease() : 'none';
      if (m) { m.style.transition = tr; m.style.transform = p.dx ? `translate3d(${p.dx}px,0,0)` : ''; }
      if (g) { g.style.transition = tr; g.style.transform = `translate3d(${p.dx + p.side * width()}px,0,0)`; }
      headFx(p.dx, p.side, animate);
      // Markierung in der unteren Leiste wandert mit dem Finger mit
      const pill = pillRef.current;
      if (pill) {
        const frac = Math.max(-1, Math.min(1, -p.dx / width()));
        pill.style.transition = animate ? ease() : 'none';
        pill.style.transform = `translateX(${(TABS.indexOf(tab) + frac) * 100}%)`;
      }
    });
  };
  /** Hervorhebung in der unteren Leiste sofort umstellen (ohne Neuaufbau). */
  const highlight = (t: Tab) => {
    navRef.current?.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  };
  /** Feststehende Kopie entfernen und die echten Köpfe wieder zeigen (nach dem Einrasten). */
  const clearHead = () => {
    const c = clones.current;
    c.main?.remove(); c.ghost?.remove();
    clones.current = {};
    mainRef.current?.querySelectorAll<HTMLElement>('.hd').forEach((h) => { h.style.visibility = ''; });
    ghostRef.current?.querySelectorAll<HTMLElement>('.hd').forEach((h) => { h.style.visibility = ''; });
  };
  const settle = (to: number, then: () => void) => {
    busy.current = true;
    pos.current.dx = to; paint(true);
    window.setTimeout(() => { then(); busy.current = false; if (pillRef.current) pillRef.current.style.transition = ''; }, settleMs);
  };
  /** Vorige Ebene unter der Unterseite: leicht nach links versetzt und abgedunkelt, rückt mit dem Finger nach */
  const popGhost = (d: number, animate: boolean) => {
    const g = ghostRef.current, w = width();
    if (!g) return;
    const p = Math.min(1, d / w);
    g.style.transition = animate ? `${ease()}, opacity ${settleMs}ms ease` : 'none';
    g.style.transform = `translate3d(${-w * 0.3 * (1 - p)}px,0,0)`;
    g.style.opacity = String(0.55 + 0.45 * p);
  };
  /** Loslassen: weit genug oder mit Schwung → Unterseite gleitet hinaus, sonst federt sie zurück */
  const popEnd = (d: number, v: number) => {
    const m = mainRef.current, w = width();
    if (!m) return;
    const go = d > w * 0.3 || (v > 0.3 && d > 24);
    settleMs = settleDuration(go ? w - d : d, v);
    busy.current = true;
    m.style.transition = ease();
    m.style.transform = go ? `translate3d(${w}px,0,0)` : '';
    popGhost(go ? w : 0, true);
    window.setTimeout(() => {
      // Wichtig auf dem iPhone: Nach einem Wisch kommt dort kein Klick, die Klick-Sperre stünde noch –
      // sie würde den „Zurück“-Klick verschlucken. Deshalb vorher aufheben.
      if (go) { swiped.current = false; popBtn()?.click(); }
      // erst nach dem Neuzeichnen der vorigen Ebene die Kopie entfernen (kein Aufblitzen)
      requestAnimationFrame(() => {
        m.classList.remove('popping');
        m.style.transition = 'none'; m.style.transform = '';
        if (go) m.scrollTop = 0;
        popMode.current = false;
        setPeek(null);
        busy.current = false;
      });
    }, settleMs);
  };
  const swipeHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      swiped.current = false;
      if (busy.current || (e.pointerType === 'mouse' && e.button !== 0) || noSwipe(e.target)) { sw.current = null; return; }
      // Seite mit eigenem Wischen (CSV-Import beim Prüfen): außerhalb davon weder blättern noch zurück
      const lock = mainRef.current?.querySelector('[data-lockswipe]');
      if (lock && !lock.contains(e.target as Node)) { sw.current = null; return; }
      sw.current = { x: e.clientX, y: e.clientY, month: !!(e.target as Element).closest('[data-swipe="month"]'), pop: !!popBtn(), lx: e.clientX, lt: e.timeStamp, v: 0, next: null, dx: 0, areas: (e.target as Element).closest('[data-areas]') };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const st = sw.current;
      if (!st) return;
      // Menü nach Gedrückthalten offen oder Sortieren aktiv → nicht blättern
      if (!st.lock && (document.body.classList.contains('lpopen') || document.body.classList.contains('dragging'))) { sw.current = null; return; }
      const ddx = e.clientX - st.x, ddy = e.clientY - st.y;
      if (!st.lock) {
        if (Math.abs(ddx) > 8 && Math.abs(ddx) > 1.2 * Math.abs(ddy)) {
          // Seite mit eigenen Bereichen (Kategorien): Sie blättert selbst – nur ganz links nach rechts geht es zurück
          if (st.areas && (ddx < 0 || st.areas.getAttribute('data-first') !== '1')) { sw.current = null; return; }
          st.lock = 'h';
          clearRingStart(); // Vorschau startet ohne Versatz aus der vorigen Geste
          // Auf einer Unterseite (mit „Zurück“) heißt Wischen nach rechts: eine Ebene zurück, wie bei iOS
          st.pop = st.pop && ddx > 0;
          if (st.pop) st.month = false;
          st.x = e.clientX; // ab hier ohne Sprung mitziehen
          try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* egal */ }
        } else if (Math.abs(ddy) > 10) { st.lock = 'v'; return; } else return;
      }
      if (st.lock !== 'h' || st.month) return;
      const d = e.clientX - st.x;
      const dt = e.timeStamp - st.lt;
      if (dt > 0) st.v = 0.6 * ((e.clientX - st.lx) / dt) + 0.4 * st.v;
      st.lx = e.clientX; st.lt = e.timeStamp;
      if (st.pop) {
        st.dx = Math.max(0, d);
        if (!popMode.current) { popMode.current = true; setPeek(tab === 'more' && morePage !== 'menu' ? origin : tab); }
        const m = mainRef.current;
        if (m) { m.style.transition = 'none'; m.style.transform = `translate3d(${st.dx}px,0,0)`; m.classList.add('popping'); }
        popGhost(st.dx, false);
        return;
      }
      const next = d === 0 ? st.next : TABS[TABS.indexOf(tab) + (d < 0 ? 1 : -1)] ?? null;
      if (next !== st.next) { st.next = next; setPeek(next); }
      pos.current.side = d < 0 ? 1 : -1;
      pos.current.dx = next ? d : d * 0.25; // am Rand nur leicht nachgeben
      st.dx = d;
      highlight(next && Math.abs(d) > width() / 2 ? next : tab);
      paint();
    },
    onPointerUp: () => {
      const st = sw.current; sw.current = null;
      if (!st || st.lock !== 'h') return;
      swiped.current = true;
      if (st.month) return;
      // Schwung zählt nur, wenn der Finger beim Loslassen noch in Bewegung war
      if (st.pop) { popEnd(st.dx, performance.now() - st.lt > 100 ? 0 : st.v); return; }
      const d = st.dx, w = width();
      const live = performance.now() - st.lt < 100;
      const fling = live && Math.abs(st.v) > 0.3 && Math.sign(st.v) === Math.sign(d);
      const next = st.next;
      const commit = !!next && (Math.abs(d) > w * 0.3 || fling);
      settleMs = settleDuration(commit ? w - Math.abs(d) : Math.abs(d), live ? st.v : 0);
      if (next && commit) {
        highlight(next); // Leiste sofort umstellen
        // Einblend-Animationen (Ring, Balken, Kalender) starten schon jetzt – so früh wie beim Tipp auf den Reiter
        markRingStart(); ghostRef.current?.classList.add('commit');
        settle(d < 0 ? -w : w, () => { resetAfterCommit.current = true; setMorePage('menu'); setTab(next); setPeek(null); });
      } else {
        highlight(tab);
        settle(0, () => { clearHead(); setPeek(null); });
      }
    },
    onPointerCancel: () => { const st = sw.current; sw.current = null; if (st?.lock === 'h' && st.pop) { popEnd(0, 0); return; } if (st?.lock === 'h') { highlight(tab); settle(0, () => { clearHead(); setPeek(null); }); } },
    // Nach einem Wisch keinen Tipp auf eine Karte oder Buchung auslösen
    onClickCapture: (e: React.MouseEvent) => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; } }
  };
  // Monat per Wischen im Kopf: einfache Geste ohne Mitziehen
  const monthUp = (e: React.PointerEvent) => {
    const st = sw.current;
    if (st?.month && st.lock === 'h' && Math.abs(e.clientX - st.x) > 40) setMonth(shiftMonth(month, e.clientX - st.x < 0 ? 1 : -1));
  };
  return { peek, mainRef, ghostRef, navRef, pillRef, layerRef, pos, popMode, sw, swipeHandlers, monthUp, popGhost, width, popBtn };
}
