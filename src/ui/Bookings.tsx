import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isFresh } from './fresh';
import { duplicatePreset } from './TxSheet';
import type { TxPreset } from './TxSheet';
import { AccountSwitch, EmptyState, Header, MonthHeader, MonthNav, Sheet, GROUP_TILE, TxAmount, catIcon } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { deleteTransactions, restoreTransactions } from '../db/repo';
import { categoryName, filterTransactions, sortTransactions, topLevel } from '../domain/calc';
import { dayLabel, isValidISODate, monthLabel, monthRange, shiftMonth, yearRange } from '../domain/dates';
import { formatEUR } from '../domain/money';
import type { CatGroup, Transaction, TxType } from '../domain/types';
import { isHouseholdCat } from '../domain/types';

type Period = 'month' | 'year' | 'all' | 'custom';
const fmtD = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(2, 4)}`;
const PAGE = 120;

export interface RowMenu { onEdit: () => void; onDuplicate?: () => void; onDelete: () => void }
const HOLD_MS = 450;

/**
 * Zeile einer Buchung. Tippen öffnet sie; Gedrückthalten öffnet ein Menü (Bearbeiten, Duplizieren, Löschen)
 * über einem verschwommenen Hintergrund. Wischen zum Löschen gibt es nicht (seitliches Wischen blättert die Reiter).
 */
export function SwipeRow({ children, onTap, selected, className = '', menu, fresh }: { children: ReactNode; onTap: () => void; onDelete?: () => void; disabled?: boolean; selected?: boolean; className?: string; label?: string; menu?: RowMenu; fresh?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const [open, setOpen] = useState<{ rect: DOMRect; drill: boolean } | null>(null);
  const cancel = () => { window.clearTimeout(timer.current); timer.current = 0; start.current = null; ref.current?.classList.remove('holding'); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = () => {
    const el = ref.current;
    if (!el) return;
    fired.current = true; cancel();
    setOpen({ rect: el.getBoundingClientRect(), drill: !!el.closest('.drill') });
  };
  const hold = menu ? {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY };
      ref.current?.classList.add('holding');
      timer.current = window.setTimeout(show, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => { const s0 = start.current; if (s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 8) cancel(); },
    onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (!open) show(); }
  } : {};
  return (
    <div className={'swipe' + (fresh ? ' fresh' : '')}>
      <button ref={ref} className={'item' + (className ? ' ' + className : '') + (selected ? ' picked' : '') + (open ? ' lifted' : '')} {...hold}
        onClick={() => { if (fired.current) { fired.current = false; return; } onTap(); }}>{children}</button>
      {open && menu && <RowMenuOverlay rect={open.rect} drill={open.drill} className={className} menu={menu} onClose={() => setOpen(null)}>{children}</RowMenuOverlay>}
    </div>
  );
}

/** Menü nach dem Gedrückthalten: Zeile angehoben, darunter (oder darüber) die Aktionen, Rest verschwommen. */
function RowMenuOverlay({ rect, drill, className, menu, onClose, children }: { rect: DOMRect; drill: boolean; className: string; menu: RowMenu; onClose: () => void; children: ReactNode }) {
  const [closing, setClosing] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setClosing(true); window.setTimeout(onClose, 160); }, [onClose]);
  useEffect(() => {
    document.body.classList.add('lpopen');
    first.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => { document.body.classList.remove('lpopen'); window.removeEventListener('keydown', key); };
  }, [close]);
  const act = (f: () => void) => () => { close(); f(); };
  const vh = window.innerHeight;
  const below = vh - rect.bottom > 200 || rect.top < 220;
  // Zeile bleibt an ihrem Platz; ist sie zu weit unten, rückt sie so weit hoch, dass das Menü darunter passt
  const top = Math.max(12, Math.min(rect.top, vh - 200 - rect.height));
  const menuPos: React.CSSProperties = below ? { top: top + rect.height + 8 } : { bottom: vh - rect.top + 8 };
  const host = document.querySelector('.app') ?? document.body;
  return createPortal(
    <div className={'lpov' + (closing ? ' out' : '')} role="dialog" aria-modal="true" aria-label="Aktionen für Buchung" onClick={close} onContextMenu={(e) => e.preventDefault()}>
      <div className={'lpprev' + (drill ? ' drill' : '')} style={{ top: below ? top : rect.top, left: rect.left, width: rect.width }} aria-hidden="true">
        <div className="swipe"><div className={'item ' + className}>{children}</div></div>
      </div>
      <div className="lpmenu" role="menu" style={{ ...menuPos, left: Math.max(12, rect.left + 8), width: Math.min(260, rect.width - 16) }} onClick={(e) => e.stopPropagation()}>
        <button ref={first} role="menuitem" onClick={act(menu.onEdit)}>Bearbeiten<Icon name="edit" size={18} /></button>
        {menu.onDuplicate && <button role="menuitem" onClick={act(menu.onDuplicate)}>Duplizieren<Icon name="copy" size={18} /></button>}
        <button role="menuitem" className="danger" onClick={act(menu.onDelete)}>Löschen<Icon name="trash" size={18} /></button>
      </div>
    </div>,
    host
  );
}

interface RowInfo { name: string; sub: string; group: CatGroup; icon: string }

const TxRow = memo(function TxRow({ t, info, selecting, selected, onTap, onDelete, onEdit, onDuplicate }: {
  t: Transaction; info: RowInfo; selecting: boolean; selected: boolean; onTap: (t: Transaction) => void; onDelete: (id: string) => void;
  onEdit: (t: Transaction) => void; onDuplicate?: (p: TxPreset) => void;
}) {
  const menu = selecting ? undefined : { onEdit: () => onEdit(t), onDuplicate: onDuplicate ? () => onDuplicate(duplicatePreset(t)) : undefined, onDelete: () => onDelete(t.id) };
  return (
    <SwipeRow disabled={selecting} selected={selected} onTap={() => onTap(t)} menu={menu} fresh={isFresh(t.id)}>
      {selecting && <span className={'check' + (selected ? ' on' : '')} aria-hidden="true">{selected && <Icon name="check" size={14} w={3} />}</span>}
      <span className={'tile flat ' + GROUP_TILE[info.group]}><Icon name={info.icon} size={22} /></span>
      <span className="mid"><b>{t.description || info.name}</b><small>{info.name}{t.recurringId ? ' · wiederkehrend' : ''}</small></span>
      <TxAmount t={t} />
    </SwipeRow>
  );
});

export function Bookings({ onOpenTx, back, onAdd, onDuplicate }: { onOpenTx: (t: Transaction) => void; back?: ReactNode; onAdd?: () => void; onDuplicate?: (p: TxPreset) => void }) {
  const { data, month, setMonth, run, flash, acct } = useStore();
  const source = acct === 'joint' ? data.jointTransactions : data.transactions;
  const [period, setPeriod] = useState<Period>('month');
  const [type, setType] = useState<TxType | ''>('');
  const [cat, setCat] = useState('');
  const [custom, setCustom] = useState(() => monthRange(month));
  const [filterOpen, setFilterOpen] = useState(false);
  const [catQ, setCatQ] = useState('');
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const dq = useDeferredValue(q);
  const sentinel = useRef<HTMLDivElement>(null);

  const range = period === 'month' ? monthRange(month) : period === 'year' ? yearRange(month.slice(0, 4))
    : period === 'custom' ? custom : { from: undefined, to: undefined };
  const list = useMemo(
    () => sortTransactions(filterTransactions(source, data.categories, { from: range.from, to: range.to, type: type || undefined, categoryId: cat || undefined, q: dq })),
    [source, data.categories, range.from, range.to, type, cat, dq]
  );
  // Neue Auswahl → wieder mit der ersten Seite beginnen
  useEffect(() => { setLimit(PAGE); }, [range.from, range.to, type, cat, dq]);
  // Weitere Zeilen laden, sobald das Listenende in Sichtweite kommt
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length, limit]);
  const info = useMemo(() => {
    const m = new Map<string, RowInfo>();
    for (const c of data.categories) m.set(c.id, { name: categoryName(data.categories, c.id), sub: '', group: c.group, icon: catIcon(data.categories, c) });
    return m;
  }, [data.categories]);
  const fallback: RowInfo = { name: 'Unbekannt', sub: '', group: 'alltag', icon: 'dots' };
  const daySums = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of list) m.set(t.date, (m.get(t.date) ?? 0) + (t.type === 'income' ? t.amountCents : -t.amountCents));
    return m;
  }, [list]);
  const visible = list.slice(0, limit);
  const days = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of visible) { const a = m.get(t.date); if (a) a.push(t); else m.set(t.date, [t]); }
    return [...m.entries()];
  }, [visible]);
  const tops = topLevel(data.categories).filter((c) => (!type || c.kind === type) && isHouseholdCat(c) === (acct === 'joint'));
  useEffect(() => { setCat(''); }, [acct]);

  const remove = useCallback(async (ids: string[]) => {
    const removed = await run((db) => deleteTransactions(db, ids));
    if (!removed || removed.length === 0) return;
    flash(removed.length === 1 ? 'Buchung gelöscht' : `${removed.length} Buchungen gelöscht`, 'ok', {
      label: 'Rückgängig', run: () => { void run((db) => restoreTransactions(db, removed), 'Wiederhergestellt'); }
    });
  }, [run, flash]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selRef = useRef(selecting); selRef.current = selecting;
  const onTap = useCallback((t: Transaction) => { if (selRef.current) toggle(t.id); else onOpenTx(t); }, [onOpenTx]);
  const onDelete = useCallback((id: string) => { void remove([id]); }, [remove]);
  // Kategorie-Suche: Haupt- und Unterkategorien; ein Treffer in einer Unterkategorie zeigt ihre Hauptkategorie
  const catHits = (() => {
    const n = catQ.trim().toLowerCase();
    if (!n) return tops;
    return tops.filter((t) => t.name.toLowerCase().includes(n)
      || data.categories.some((c) => c.parentId === t.id && c.name.toLowerCase().includes(n)));
  })();
  const filtered = period !== 'month' || type !== '' || cat !== '';
  const filterText = [
    period === 'year' ? `Jahr ${month.slice(0, 4)}` : period === 'all' ? 'Gesamt' : period === 'custom' ? 'Zeitraum' : '',
    type === 'expense' ? 'Ausgaben' : type === 'income' ? 'Einnahmen' : '',
    cat ? (data.categories.find((c) => c.id === cat)?.name ?? '') : ''
  ].filter(Boolean).join(' · ');
  const resetFilter = () => { setPeriod('month'); setType(''); setCat(''); };
  const stopSelecting = () => { setSelecting(false); setSel(new Set()); setConfirm(false); };

  return (
    <>
      {back}
      {period === 'month' ? <MonthHeader month={month} onChange={setMonth} kicker={<span className="kk">Buchungen</span>} />
        : period === 'year' ? <Header kicker={<span className="kk">Buchungen</span>} title={month.slice(0, 4)} right={<MonthNav month={month} onChange={(m) => setMonth(shiftMonth(month, m > month ? 12 : -12))} />} />
        : <Header kicker={<span className="kk">Buchungen</span>} title={period === 'custom' ? `${fmtD(custom.from)} – ${fmtD(custom.to)}` : 'Gesamt'} />}
      <AccountSwitch />
      <div className="tbar">
        {onAdd && <button className="pillbtn addtx" aria-label="Neue Buchung" onClick={onAdd}><Icon name="plus" size={18} w={2.2} />Neue Buchung</button>}
        <span style={{ flex: 1 }} />
        {list.length > 0 && (selecting
          ? <><button className="pillbtn" onClick={() => setSel(new Set(list.map((t) => t.id)))}>Alle</button><button className="pillbtn" onClick={stopSelecting}>Fertig</button></>
          : <button className="pillbtn" onClick={() => setSelecting(true)}>Auswählen</button>)}
        <button className={'ib filterbtn' + (filtered ? ' on' : '')} aria-label={filtered ? 'Filter (aktiv)' : 'Filter'} onClick={() => setFilterOpen(true)}><Icon name="filter" size={20} w={2} /></button>
      </div>
      <label className="search"><Icon name="search" size={18} /><input type="search" placeholder="Suchen: Text oder Betrag" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suchen" /></label>
      {(list.length > 0 || filterText) && <div className="fline">
        <span className="cap num">{list.length === 1 ? '1 Buchung' : `${list.length} Buchungen`}</span>
        {filterText && <button className="freset" onClick={resetFilter} aria-label={`Filter zurücksetzen: ${filterText}`}>{filterText}<span aria-hidden="true"> ✕</span></button>}
      </div>}
      {days.length === 0 && (filtered || dq
        ? <EmptyState title="Keine Buchungen gefunden" text="Für diese Auswahl gibt es nichts." action={{ label: 'Filter zurücksetzen', onClick: () => { resetFilter(); setQ(''); } }} />
        : <EmptyState title={`Noch keine Buchungen im ${monthLabel(month).split(' ')[0]}`} text="Ein neuer Monat – noch alles offen." action={onAdd ? { label: 'Neue Buchung', onClick: onAdd } : undefined} />)}
      {days.map(([d, ts]) => (
        <div key={d}>
          <div className="dayh"><span>{dayLabel(d)}</span><span className="num">{formatEUR(daySums.get(d) ?? 0)}</span></div>
          <div className="card flush">
            {ts.map((t) => <TxRow key={t.id} t={t} info={info.get(t.categoryId) ?? fallback} selecting={selecting} selected={sel.has(t.id)} onTap={onTap} onDelete={onDelete} onEdit={onOpenTx} onDuplicate={onDuplicate} />)}
          </div>
        </div>
      ))}
      {visible.length < list.length && <div ref={sentinel} className="empty"><button className="btn sec2" onClick={() => setLimit((l) => l + PAGE)}>Weitere {Math.min(PAGE, list.length - visible.length)} von {list.length - visible.length} laden</button></div>}
      {filterOpen && (
        <Sheet title="Filter" left="Schließen" onClose={() => setFilterOpen(false)} right={filtered ? <button className="sheetact" onClick={resetFilter}>Zurücksetzen</button> : undefined}>
          <span className="cap" style={{ paddingLeft: 4 }}>Zeitraum</span>
          <div className="fseg" role="radiogroup" aria-label="Zeitraum">
            {(['month', 'year', 'custom'] as Period[]).map((p) => <button key={p} role="radio" aria-checked={period === p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{p === 'month' ? 'Monat' : p === 'year' ? 'Jahr' : 'Von–bis'}</button>)}
          </div>
          {period === 'custom' && (
            <div className="card flush">
              <label className="field"><span>Von</span><input type="date" value={custom.from} max={custom.to} onChange={(e) => { const v = e.target.value; if (isValidISODate(v)) setCustom((c) => (v <= c.to ? { from: v, to: c.to } : { from: v, to: v })); }} /></label>
              <label className="field"><span>Bis</span><input type="date" value={custom.to} min={custom.from} onChange={(e) => { const v = e.target.value; if (isValidISODate(v)) setCustom((c) => (v >= c.from ? { from: c.from, to: v } : { from: v, to: v })); }} /></label>
            </div>
          )}
          <span className="cap" style={{ paddingLeft: 4 }}>Art</span>
          <div className="fseg" role="radiogroup" aria-label="Art">
            {([['', 'Alle'], ['expense', 'Ausgaben'], ['income', 'Einnahmen']] as const).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={type === v} className={type === v ? 'on' : ''} onClick={() => { setType(v); setCat(''); }}>{l}</button>
            ))}
          </div>
          <span className="cap" style={{ paddingLeft: 4 }}>Kategorie</span>
          <label className="search fsearch"><Icon name="search" size={16} /><input type="search" placeholder="Kategorie suchen" value={catQ} onChange={(e) => setCatQ(e.target.value)} aria-label="Kategorie suchen" /></label>
          <div className="chips fchips" role="radiogroup" aria-label="Kategorie">
            {!catQ && <button role="radio" aria-checked={cat === ''} className={'fchip' + (cat === '' ? ' on' : '')} onClick={() => setCat('')}>Alle</button>}
            {catHits.map((c) => <button key={c.id} role="radio" aria-checked={cat === c.id} className={'fchip' + (cat === c.id ? ' on' : '')} onClick={() => setCat(cat === c.id ? '' : c.id)}><Icon name={catIcon(data.categories, c)} size={16} />{c.name}</button>)}
            {catHits.length === 0 && <span className="cap" style={{ padding: '8px 4px' }}>Keine Kategorie gefunden</span>}
          </div>
          <button className="btn cta" onClick={() => setFilterOpen(false)}>{list.length === 1 ? '1 Buchung anzeigen' : `${list.length} Buchungen anzeigen`}</button>
        </Sheet>
      )}
      {selecting && <div style={{ height: 70 }} />}
      {selecting && sel.size > 0 && (
        <div className="selbar" role="region" aria-label="Auswahl">
          <span>{confirm ? `${sel.size} wirklich löschen?` : `${sel.size} ausgewählt`}</span>
          {confirm && <button className="btn sec2" onClick={() => setConfirm(false)}>Nein</button>}
          <button className="btn" style={{ background: '#E5484D', color: '#fff' }} onClick={async () => {
            if (!confirm) { setConfirm(true); return; }
            const ids = [...sel];
            stopSelecting();
            await remove(ids);
          }}>{confirm ? 'Löschen' : 'Löschen …'}</button>
        </div>
      )}
    </>
  );
}
