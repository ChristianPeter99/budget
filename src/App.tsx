import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shiftMonth } from './domain/dates';
import { Icon } from './ui/icons';
import { useStore } from './state/store';
import { usePwa } from './pwa';
import { Overview } from './ui/Overview';
import { Alltag } from './ui/Alltag';
import { Fixkosten } from './ui/Fixkosten';
import { More } from './ui/More';
import { Bookings } from './ui/Bookings';
import { RecurringSheet } from './ui/Recurring';
import { SplitSheet } from './ui/Settings';
import type { MorePage } from './ui/More';
import { TxSheet } from './ui/TxSheet';
import { ErrorBoundary } from './ui/ErrorBoundary';
import type { TxPreset } from './ui/TxSheet';
import type { CatGroup, Recurring, Transaction } from './domain/types';

type Tab = 'home' | 'alltag' | 'bookings' | 'fix' | 'more';
const TABS: Tab[] = ['home', 'alltag', 'bookings', 'fix', 'more'];

export function App() {
  const { status, fatal, notice, dismissNotice, month, setMonth, run, setAcct } = useStore();
  const pwa = usePwa();
  const [tab, setTab] = useState<Tab>('home');
  const [origin, setOrigin] = useState<Tab>('home');
  const [morePage, setMorePage] = useState<MorePage>('menu');
  const [tx, setTx] = useState<{ tx?: Transaction; preset?: TxPreset } | null>(null);
  const [rec, setRec] = useState<{ rec: Recurring | null; group?: CatGroup } | null>(null);
  const [split, setSplit] = useState(false);
  // Blättern wie auf dem Home-Bildschirm: Seite folgt dem Finger, Nachbarseite kommt mit, Einrasten mit Schwung.
  // Die Bewegung wird direkt per transform gesetzt (ohne React-Neuaufbau pro Fingerbewegung), damit sie flüssig bleibt.
  const [peek, setPeek] = useState<Tab | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const sw = useRef<{ x: number; y: number; month: boolean; lock?: 'h' | 'v'; lx: number; lt: number; v: number; next: Tab | null; dx: number } | null>(null);
  const swiped = useRef(false);
  const busy = useRef(false);
  const pos = useRef({ dx: 0, side: 1 as 1 | -1, frame: 0 });
  const resetAfterCommit = useRef(false);
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

  if (status === 'loading') return (
    <div className="loading" aria-busy="true" aria-label="Lade">
      <div className="skel" style={{ height: 56, background: 'transparent' }} />
      <div className="skel" style={{ height: 248 }} />
      <div className="skel" style={{ height: 168 }} />
      <div className="skel" style={{ height: 220 }} />
    </div>
  );
  if (status === 'error') return <div className="splash" role="alert">{fatal}</div>;

  const goTab = (t: Tab) => { setMorePage('menu'); setTab(t); };
  const noSwipe = (el: EventTarget | null) => !(el instanceof Element)
    || !!el.closest('[role="dialog"], input, textarea, select, [data-noswipe]') || document.body.classList.contains('dragging');
  const SETTLE_MS = 300;
  const EASE = `transform ${SETTLE_MS}ms cubic-bezier(.22,.9,.3,1)`;
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
    const a = headParts(c.main), b = headParts(c.ghost);
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(key), y = b.get(key);
      const same = !!x && !!y && x.textContent === y.textContent;
      const t = animate ? `opacity ${SETTLE_MS}ms ease` : 'none';
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
      const m = mainRef.current, g = ghostRef.current, tr = animate ? EASE : 'none';
      if (m) { m.style.transition = tr; m.style.transform = p.dx ? `translate3d(${p.dx}px,0,0)` : ''; }
      if (g) { g.style.transition = tr; g.style.transform = `translate3d(${p.dx + p.side * width()}px,0,0)`; }
      headFx(p.dx, p.side, animate);
      // Markierung in der unteren Leiste wandert mit dem Finger mit
      const pill = pillRef.current;
      if (pill) {
        const frac = Math.max(-1, Math.min(1, -p.dx / width()));
        pill.style.transition = animate ? `transform ${SETTLE_MS}ms cubic-bezier(.22,.9,.3,1)` : 'none';
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
    window.setTimeout(() => { then(); busy.current = false; if (pillRef.current) pillRef.current.style.transition = ''; }, SETTLE_MS);
  };
  const swipeHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      swiped.current = false;
      if (busy.current || (e.pointerType === 'mouse' && e.button !== 0) || noSwipe(e.target)) { sw.current = null; return; }
      sw.current = { x: e.clientX, y: e.clientY, month: !!(e.target as Element).closest('[data-swipe="month"]'), lx: e.clientX, lt: e.timeStamp, v: 0, next: null, dx: 0 };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const st = sw.current;
      if (!st) return;
      const ddx = e.clientX - st.x, ddy = e.clientY - st.y;
      if (!st.lock) {
        if (Math.abs(ddx) > 8 && Math.abs(ddx) > 1.2 * Math.abs(ddy)) {
          st.lock = 'h';
          st.x = e.clientX; // ab hier ohne Sprung mitziehen
          try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* egal */ }
        } else if (Math.abs(ddy) > 10) { st.lock = 'v'; return; } else return;
      }
      if (st.lock !== 'h' || st.month) return;
      const d = e.clientX - st.x;
      const dt = e.timeStamp - st.lt;
      if (dt > 0) st.v = 0.6 * ((e.clientX - st.lx) / dt) + 0.4 * st.v;
      st.lx = e.clientX; st.lt = e.timeStamp;
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
      const d = st.dx, w = width();
      const fling = Math.abs(st.v) > 0.4 && Math.sign(st.v) === Math.sign(d);
      const next = st.next;
      if (next && (Math.abs(d) > w * 0.33 || fling)) {
        highlight(next); // Leiste sofort umstellen
        settle(d < 0 ? -w : w, () => { resetAfterCommit.current = true; setMorePage('menu'); setTab(next); setPeek(null); });
      } else {
        highlight(tab);
        settle(0, () => { clearHead(); setPeek(null); });
      }
    },
    onPointerCancel: () => { const st = sw.current; sw.current = null; if (st?.lock === 'h') { highlight(tab); settle(0, () => { clearHead(); setPeek(null); }); } },
    // Nach einem Wisch keinen Tipp auf eine Karte oder Buchung auslösen
    onClickCapture: (e: React.MouseEvent) => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; } }
  };
  // Monat per Wischen im Kopf: einfache Geste ohne Mitziehen
  const monthUp = (e: React.PointerEvent) => {
    const st = sw.current;
    if (st?.month && st.lock === 'h' && Math.abs(e.clientX - st.x) > 40) setMonth(shiftMonth(month, e.clientX - st.x < 0 ? 1 : -1));
  };
  const renderTab = (t: Tab, ghost: boolean) => {
    const mp: MorePage = ghost ? 'menu' : morePage;
    switch (t) {
      case 'home': return <Overview onOpenTx={(t) => setTx({ tx: t })} onGoBookings={() => goTab('bookings')} onGoBackup={() => goMore('backup')} onSplit={() => setSplit(true)} onAdd={(p) => setTx(p ? { preset: p } : {})} onGoJoint={() => { setAcct('joint'); goTab('alltag'); }} onGoGroup={(g) => { if (g === 'alltag') setAcct('own'); if (g === 'fix') goTab('fix'); else if (g === 'alltag') goTab('alltag'); else goMore('spar'); }} />;
      case 'alltag': return <Alltag onAdd={(p) => setTx({ preset: p })} onOpenTx={(t) => setTx({ tx: t })} />;
      case 'bookings': return <Bookings onOpenTx={(t) => setTx({ tx: t })} onAdd={() => setTx({})} />;
      case 'fix': return <Fixkosten onEdit={(r) => setRec({ rec: r, group: 'fix' })} onNew={() => setRec({ rec: null, group: 'fix' })} onOpenTx={(t) => setTx({ tx: t })} />;
      case 'more': return <More key={mp + origin} initial={mp} onExit={() => goTab(origin)} onOpenTx={(t) => setTx({ tx: t })} onAdd={(p) => setTx({ preset: p })} onEditRec={(r) => setRec({ rec: r })} />;
    }
  };
  const goMore = (p: MorePage) => { setOrigin(tab); setMorePage(p); setTab('more'); };
  const nav = (t: Tab, icon: string, label: string) => (
    <button data-tab={t} className={'nv' + (tab === t ? ' on' : '')} onClick={() => goTab(t)} aria-current={tab === t ? 'page' : undefined}><Icon name={icon} size={24} />{label}</button>
  );
  return (
    <div className="app">
      <div className="topcover" aria-hidden="true" />
      <div className="stage">
      <main ref={mainRef} className="view" {...swipeHandlers} onPointerUp={(e) => { monthUp(e); swipeHandlers.onPointerUp(); }}>
        {pwa.needRefresh && <div className="banner info" role="status"><span>Neue App-Version bereit. Deine Daten bleiben erhalten.</span><button onClick={pwa.update}>Aktualisieren</button></div>}
        {pwa.offlineReady && <div className="banner info" role="status"><span>Die App ist jetzt offline nutzbar.</span><button onClick={pwa.dismissOffline}>OK</button></div>}
        <ErrorBoundary key={tab + morePage} onHome={() => goTab('home')}>
        {renderTab(tab, false)}
        </ErrorBoundary>
      </main>
      {peek && (
        <div className="pageghost" aria-hidden="true" inert ref={(el) => { ghostRef.current = el; if (el) el.style.transform = `translate3d(${pos.current.dx + pos.current.side * width()}px,0,0)`; }}>
          <ErrorBoundary key={'ghost' + peek} onHome={() => undefined}>{renderTab(peek, true)}</ErrorBoundary>
        </div>
      )}
      <div ref={layerRef} className="headlayer" aria-hidden="true" />
      </div>
      <nav ref={navRef} className="nav" aria-label="Hauptnavigation">
        <span ref={pillRef} className="navpill" aria-hidden="true" style={{ transform: `translateX(${TABS.indexOf(tab) * 100}%)` }} />
        {nav('home', 'home', 'Übersicht')}
        {nav('alltag', 'card', 'Alltag')}
        {nav('bookings', 'list', 'Buchungen')}
        {nav('fix', 'cal', 'Fixkosten')}
        {nav('more', 'more', 'Mehr')}
      </nav>
      {tx && <ErrorBoundary key={'tx'} sheet homeLabel="Schließen" onHome={() => setTx(null)}><TxSheet key={tx.tx?.id ?? JSON.stringify(tx.preset ?? {})} tx={tx.tx} preset={tx.preset} onClose={() => setTx(null)} onDuplicate={(p) => setTx({ preset: p })} /></ErrorBoundary>}
      {rec && <RecurringSheet rec={rec.rec} presetGroup={rec.group} month={month} onClose={() => setRec(null)} run={run} />}
      {split && <SplitSheet onClose={() => setSplit(false)} />}
      {notice && (
        <div className={'toast ' + notice.kind} role="status">
          <span>{notice.text}</span>
          {notice.action && <button onClick={() => { const a = notice.action; dismissNotice(); a?.run(); }}>{notice.action.label}</button>}
        </div>
      )}
    </div>
  );
}
