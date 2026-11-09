import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { More } from './More';
import type { MorePage } from './More';
import type { CatGroup, Recurring, Transaction } from '../domain/types';
import type { TxPreset } from '../domain/transactions';
import { CRT_ON_START, crtOn } from '../ui/crt';
import { TABS, useTabSwipe } from './useTabSwipe';
import type { Tab } from './useTabSwipe';
import { Overview } from '../features/overview/Overview';
import { Alltag } from '../features/alltag/Alltag';
import { Bookings } from '../features/bookings/Bookings';
import { Fixkosten } from '../features/fixkosten/Fixkosten';
import { Icon } from '../ui/icons';
import { ErrorBoundary } from './ErrorBoundary';
import { TxSheet } from '../sheets/TxSheet';
import { RecurringSheet } from '../sheets/RecurringSheet';

export function App() {
  const { status, fatal, notice, dismissNotice, month, setMonth, run, setAcct, acct } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [origin, setOrigin] = useState<Tab>('home');
  const [morePage, setMorePage] = useState<MorePage>('menu');
  const [tx, setTx] = useState<{ tx?: Transaction; preset?: TxPreset } | null>(null);
  const [rec, setRec] = useState<{ rec: Recurring | null; group?: CatGroup } | null>(null);
  const { peek, mainRef, ghostRef, navRef, pillRef, layerRef, pos, popMode, sw, swipeHandlers, monthUp, popGhost, width, popBtn } = useTabSwipe({ tab, morePage, origin, setTab, setMorePage, month, setMonth });
  // Röhrenfernseher-Effekt beim Start (abschaltbar über CRT_ON_START in ui/crt.ts); vor dem ersten Bild, damit nichts aufblitzt
  const crtStarted = useRef(false);
  useLayoutEffect(() => {
    if (status !== 'ready' || crtStarted.current) return;
    crtStarted.current = true;
    if (CRT_ON_START && !navigator.webdriver) void crtOn();
  }, [status]);
  if (status === 'loading') return (
    // Beim Start nur schwarz (kein graues Aufblitzen); die Daten sind in Sekundenbruchteilen geladen
    <div className="loading" aria-busy="true" aria-label="Lade" />
  );
  if (status === 'error') return <div className="splash" role="alert">{fatal}</div>;

  const goTab = (t: Tab) => { setMorePage('menu'); setTab(t); };
  /** Tipp auf die Leiste: anderer Reiter → wechseln; aktiver Reiter → eine Ebene zurück bzw. weich nach oben */
  const tapTab = (t: Tab) => {
    if (t !== tab) return goTab(t);
    const m = mainRef.current;
    if (!m) return;
    // Direkt geöffnete Mehr-Seite (z. B. Backup von der Übersicht) → Mehr-Menü, wie bisher
    if (t === 'more' && morePage !== 'menu') return goTab(t);
    const b = popBtn();
    if (b) { b.click(); m.scrollTop = 0; return; }
    m.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const renderTab = (t: Tab, ghost: boolean) => {
    const mp: MorePage = ghost ? 'menu' : morePage;
    switch (t) {
      case 'home': return <Overview onOpenTx={(t) => setTx({ tx: t })} onGoBookings={() => goTab('bookings')} onGoBackup={() => goMore('backup')} onAdd={(p) => setTx(p ? { preset: p } : {})} onGoJoint={() => { setAcct('joint'); goTab('alltag'); }} onGoIncome={() => goMore('recurring')} onGoGroup={(g) => { if (g === 'alltag') setAcct('own'); if (g === 'fix') goTab('fix'); else if (g === 'alltag') goTab('alltag'); else goMore('spar'); }} />;
      case 'alltag': return <Alltag onAdd={(p) => setTx({ preset: p })} onOpenTx={(t) => setTx({ tx: t })} />;
      case 'bookings': return <Bookings onOpenTx={(t) => setTx({ tx: t })} onAdd={() => setTx({})} onDuplicate={(p) => setTx({ preset: p })} />;
      case 'fix': return <Fixkosten onEdit={(r) => setRec({ rec: r, group: 'fix' })} onNew={() => setRec({ rec: null, group: 'fix' })} onOpenTx={(t) => setTx({ tx: t })} />;
      case 'more': return <More key={mp + origin} initial={mp} onExit={() => goTab(origin)} onOpenTx={(t) => setTx({ tx: t })} onAdd={(p) => setTx({ preset: p })} onEditRec={(r) => setRec({ rec: r })} />;
    }
  };
  const goMore = (p: MorePage) => { setOrigin(tab); setMorePage(p); setTab('more'); };
  const nav = (t: Tab, icon: string, label: string) => (
    <button data-tab={t} className={'nv' + (tab === t ? ' on' : '')} onClick={() => tapTab(t)} aria-current={tab === t ? 'page' : undefined} aria-label={label}><Icon name={icon} size={24} /></button>
  );
  return (
    <div className="app">
      <div className="topcover" aria-hidden="true" />
      <div className="stage">
      <main ref={mainRef} className="view" {...swipeHandlers} onPointerUp={(e) => { monthUp(e); swipeHandlers.onPointerUp(); }}>
        {/* Update: keine Meldung oben – nur unter Mehr › Daten & Backup („Nach Updates suchen“ / „Jetzt aktualisieren“) */}
        <ErrorBoundary key={tab + morePage} onHome={() => goTab('home')}>
        {renderTab(tab, false)}
        </ErrorBoundary>
      </main>
      {peek && (
        <div className={'pageghost' + (popMode.current ? ' under' : '')} aria-hidden="true" inert ref={(el) => { ghostRef.current = el; if (el && !popMode.current) el.style.transform = `translate3d(${pos.current.dx + pos.current.side * width()}px,0,0)`; else if (el) popGhost(sw.current?.dx ?? 0, false); }}>
          <ErrorBoundary key={'ghost' + peek} onHome={() => undefined}>{renderTab(peek, true)}</ErrorBoundary>
        </div>
      )}
      <div ref={layerRef} className="headlayer" aria-hidden="true" />
      </div>
      <nav ref={navRef} className="nav" aria-label="Hauptnavigation">
        <span ref={pillRef} className="navpill" aria-hidden="true" style={{ transform: `translateX(${TABS.indexOf(tab) * 100}%)` }} />
        {nav('home', 'home', 'Übersicht')}
        {nav('alltag', 'wallet', 'Alltag')}
        {nav('bookings', 'list', 'Buchungen')}
        {nav('fix', 'cal', 'Fixkosten')}
        {nav('more', 'more', 'Mehr')}
      </nav>
      {tx && <ErrorBoundary key={'tx'} sheet homeLabel="Schließen" onHome={() => setTx(null)}><TxSheet key={tx.tx?.id ?? JSON.stringify(tx.preset ?? {})} tx={tx.tx} preset={tx.preset} area={tab === 'fix' ? 'fix' : acct === 'joint' && (tab === 'alltag' || tab === 'bookings') ? 'joint' : 'alltag'}
        lockArea={tab === 'alltag' || tab === 'fix' || (tab === 'home' && !!tx.preset?.categoryId)} onClose={() => setTx(null)} /></ErrorBoundary>}
      {rec && <RecurringSheet rec={rec.rec} presetGroup={rec.group} month={month} onClose={() => setRec(null)} run={run} />}
      {notice && (
        <div key={notice.text} className={'toast ' + notice.kind} role="status">
          {/* Bestätigung: grünes Häkchen zeichnet sich */}
          {notice.kind === 'ok' && <svg className="tcheck" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>}
          <span>{notice.text}</span>
          {notice.action && <button onClick={() => { const a = notice.action; dismissNotice(); a?.run(); }}>{notice.action.label}</button>}
        </div>
      )}
    </div>
  );
}
