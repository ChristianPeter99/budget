import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccountSwitch, Empty, Header, MonthHeader, MonthNav, Sheet, GROUP_TILE, TxAmount, catIcon } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { deleteTransactions, restoreTransactions } from '../db/repo';
import { categoryName, filterTransactions, sortTransactions, topLevel } from '../domain/calc';
import { dayLabel, isValidISODate, monthRange, shiftMonth, yearRange } from '../domain/dates';
import { formatEUR } from '../domain/money';
import type { CatGroup, Transaction, TxType } from '../domain/types';
import { isHouseholdCat } from '../domain/types';

type Period = 'month' | 'year' | 'all' | 'custom';
const fmtD = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(2, 4)}`;
const PAGE = 120;

/**
 * Zeile einer Buchung. Wischen zum Löschen gibt es nicht mehr (seit 1.20.2) – seitliches Wischen blättert
 * überall zwischen den Reitern; gelöscht wird über Tippen → „Buchung löschen“ oder über „Auswählen“.
 */
export function SwipeRow({ children, onTap, selected, className = '' }: { children: ReactNode; onTap: () => void; onDelete?: () => void; disabled?: boolean; selected?: boolean; className?: string; label?: string }) {
  return (
    <div className="swipe">
      <button className={'item' + (className ? ' ' + className : '') + (selected ? ' picked' : '')} onClick={onTap}>{children}</button>
    </div>
  );
}

interface RowInfo { name: string; sub: string; group: CatGroup; icon: string }

const TxRow = memo(function TxRow({ t, info, selecting, selected, onTap, onDelete }: {
  t: Transaction; info: RowInfo; selecting: boolean; selected: boolean; onTap: (t: Transaction) => void; onDelete: (id: string) => void;
}) {
  return (
    <SwipeRow disabled={selecting} selected={selected} onTap={() => onTap(t)} onDelete={() => onDelete(t.id)}>
      {selecting && <span className={'check' + (selected ? ' on' : '')} aria-hidden="true">{selected && <Icon name="check" size={14} w={3} />}</span>}
      <span className={'tile flat ' + GROUP_TILE[info.group]}><Icon name={info.icon} size={22} /></span>
      <span className="mid"><b>{t.description || info.name}</b><small>{info.name}{t.recurringId ? ' · wiederkehrend' : ''}</small></span>
      <TxAmount t={t} />
    </SwipeRow>
  );
});

export function Bookings({ onOpenTx, back, onAdd }: { onOpenTx: (t: Transaction) => void; back?: ReactNode; onAdd?: () => void }) {
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
      <label className="search"><Icon name="search" size={18} /><input type="search" placeholder="Suchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suchen" /></label>
      <div className="fline">
        <span className="cap num">{list.length === 1 ? '1 Buchung' : `${list.length} Buchungen`}</span>
        {filterText && <button className="freset" onClick={resetFilter} aria-label={`Filter zurücksetzen: ${filterText}`}>{filterText}<span aria-hidden="true"> ✕</span></button>}
      </div>
      {days.length === 0 && <div className="card"><Empty>Keine Buchungen für diese Auswahl.</Empty></div>}
      {days.map(([d, ts]) => (
        <div key={d}>
          <div className="dayh"><span>{dayLabel(d)}</span><span className="num">{formatEUR(daySums.get(d) ?? 0)}</span></div>
          <div className="card flush">
            {ts.map((t) => <TxRow key={t.id} t={t} info={info.get(t.categoryId) ?? fallback} selecting={selecting} selected={sel.has(t.id)} onTap={onTap} onDelete={onDelete} />)}
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
