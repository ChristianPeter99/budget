import { useMemo, useState } from 'react';
import { duplicatePreset, filterTransactions, sortTransactions, totalsByCategory } from '../../domain/transactions';
import type { TxPreset } from '../../domain/transactions';
import { catArea, isHouseholdCat } from '../../domain/types';
import type { Category, Transaction } from '../../domain/types';
import { useStore } from '../../state/store';
import { collapseRows, isFresh, markRestored } from '../../ui/fresh';
import { deleteTransactions, restoreTransactions } from '../../data/transactions';
import { jointFreeOf, jointMonth } from '../../domain/joint';
import { Chevr, Chevron, Collapse, CollapseBtn, FoldAllBtn, useCollapsed } from '../../ui/Collapse';
import { SortSheet, useSortMode } from '../../ui/Sort';
import { currentMonthKey, daysInMonth, daysLeftInMonth, monthLabel, monthRange } from '../../domain/dates';
import { catIcon, childrenOf, topLevel } from '../../domain/categories';
import { freeOf, monthAvailable, monthOutlook, salaryStartMonth } from '../../domain/month';
import { budgetStatus, resolveBudget } from '../../domain/budget';
import { useCountUp } from '../../ui/animation';
import { CatGrid, ViewToggle, useCatView } from '../../ui/CatGrid';
import type { TileItem } from '../../ui/CatGrid';
import { mergeOrder, useDragSort } from '../../ui/dragSort';
import { setCategoryOrder } from '../../data/categories';
import { CatBar, barColor } from '../../ui/Bar';
import { centsToGroupedInput, formatEUR, parseCents } from '../../domain/money';
import { Header } from '../../ui/Header';
import { AccountSwitch } from '../../ui/AccountSwitch';
import { AmountInput, Money } from '../../ui/Money';
import { OnceHint } from '../../ui/OnceHint';
import { SpendCalendar } from './Calendar';
import { Icon } from '../../ui/icons';
import { Empty } from '../../ui/Empty';
import { CatDetailSheet, DetailRow, PIE_SHADES } from '../../ui/CatDetailSheet';
import { SwipeRow } from '../../ui/SwipeRow';
import { Sheet } from '../../ui/Sheet';
import { setPartnerMonth } from '../../data/joint';

export function Alltag({ onAdd, onOpenTx }: { onAdd: (p: TxPreset) => void; onOpenTx: (t: Transaction) => void }) {
  const { data, month, setMonth, acct, run, flash } = useStore();
  const remove = async (id: string) => {
    const undoCollapse = await collapseRows([id]);
    const removed = await run((db) => deleteTransactions(db, [id]));
    if (!removed || removed.length === 0) { undoCollapse(); return; }
    flash('Buchung gelöscht', 'ok', { label: 'Rückgängig', run: () => { markRestored(removed.map((t) => t.id)); void run((db) => restoreTransactions(db, removed), 'Wiederhergestellt'); } });
  };
  const isJoint = acct === 'joint';
  const jset = data.settings.joint;
  const jm = jointMonth(data.transactions, data.jointTransactions, data.recurring, data.settings, month);
  const [partnerEdit, setPartnerEdit] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const fold = useCollapsed(isJoint ? 'joint' : 'alltag');
  const [detail, setDetail] = useState(false);
  const [sortMode, setSortMode] = useSortMode(isJoint ? 'joint' : 'alltag');
  const [sortOpen, setSortOpen] = useState(false);
  const byAmount = sortMode === 'amount';
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const txOf = (catId: string) => sortTransactions(txs.filter((t) => t.categoryId === catId));
  const cats = data.categories;
  const { from, to } = monthRange(month);
  const source = isJoint ? data.jointTransactions : data.transactions;
  const txs = useMemo(() => filterTransactions(source, cats, { from, to, type: 'expense' }), [source, cats, from, to]);
  const byCat = useMemo(() => totalsByCategory(txs, 'expense'), [txs]);
  // Haushaltskonto und eigenes Konto haben getrennte Kategorienlisten
  // Beitrags-Kategorie des gemeinsamen Kontos nur zeigen, wenn es eingeschaltet ist
  // (ausgeschaltet nur noch in Monaten, in denen tatsächlich ein Beitrag gebucht ist)
  const hiddenJoint = (c: { id: string }) => !jset?.enabled && c.id === jset?.categoryId
    && (byCat.get(c.id) ?? 0) + childrenOf(cats, c.id).reduce((a, k) => a + (byCat.get(k.id) ?? 0), 0) === 0;
  const tops = cats.filter((c) => c.parentId === null && c.kind === 'expense' && !c.archived
    && (isJoint ? isHouseholdCat(c) : !isHouseholdCat(c) && c.group === 'alltag' && !hiddenJoint(c)))
    .sort((a, b) => a.sort - b.sort);

  const topTotal = (id: string) => (byCat.get(id) ?? 0) + childrenOf(cats, id).reduce((a, c) => a + (byCat.get(c.id) ?? 0), 0);
  const spent = isJoint && jm ? jm.spentCents : tops.reduce((a, c) => a + topTotal(c.id), 0);
  // Eigenes Konto: Budget = Einnahmen − Fixkosten − Sparen (− sonstige Ausgaben), damit „Noch verfügbar“
  // genau dem Wert der Übersicht entspricht
  const own = useMemo(() => monthAvailable(filterTransactions(data.transactions, cats, { from, to }), data.settings, month, salaryStartMonth(data.recurring, cats)), [data.transactions, cats, from, to, data.settings, month, data.recurring]);
  // Ausblick (künftiger Monat, noch nichts gebucht): Gehalt − Fixkosten − Sparrate aus den Vorlagen
  const olA = !isJoint && month > currentMonthKey() && own.incomeCents === 0 ? monthOutlook(data.recurring, cats, data.settings, month) : null;
  const outlook = !!olA && olA.incomeCents > 0;
  const target = isJoint && jm ? jm.budgetCents + jm.carryCents
    : outlook ? olA!.incomeCents - olA!.fixCents - olA!.sparCents - Math.max(0, own.expenseCents - spent) : own.availableCents + spent;
  const st = budgetStatus(spent, target);
  // Kalender: nur Alltagsausgaben ohne automatische Buchungen (Beitrag zum gemeinsamen Konto, Abos …)
  const calTxs = useMemo(() => txs.filter((t) => !t.recurringId && (isJoint || catArea(cats.find((c) => c.id === t.categoryId) ?? { kind: 'expense', group: 'fix' }) === 'alltag')), [txs, cats, isJoint]);
  const calFold = useCollapsed('calendar');
  const segs = tops.map((t) => ({ id: t.id, name: t.name, icon: catIcon(cats, t), cents: topTotal(t.id) }));
  const hasBase = isJoint ? target > 0 : own.incomeCents > 0 || outlook;
  // Beträge zählen beim Monatswechsel mit, wie auf der Übersicht
  const spentShown = useCountUp(spent);
  const leftShown = useCountUp(hasBase ? st.remainingCents : 0);
  // Alle Kategorien sind sichtbar; jede lässt sich einzeln einklappen (wird gemerkt).
  // Reihenfolge: eigene (per Ziehen) oder nach Betrag absteigend
  const shown = byAmount ? [...tops].sort((a, b) => topTotal(b.id) - topTotal(a.id) || a.sort - b.sort) : tops;
  // Reihenfolge der Hauptkategorien per Gedrückthalten und Ziehen; unsichtbare behalten ihren Platz
  const [catView, toggleView] = useCatView('alltag');
  const grid = catView === 'grid' && tops.length > 1;
  const topDrag = useDragSort(shown.map((t) => t.id), (ids) => {
    const full = topLevel(cats, 'expense').map((c) => c.id);
    void run((db) => setCategoryOrder(db, mergeOrder(full, ids)));
  }, grid);
  const cardProps = (t: Category) => ({ t, drag: topDrag, collapsed: fold.isCollapsed(t.id), onFold: () => fold.toggle(t.id), isJoint, open, toggle, byCat, total: topTotal(t.id), txOf, onAdd, onOpenTx, remove, byAmount });
  const tiles: TileItem[] = shown.map((t) => {
    const limit = isJoint ? null : resolveBudget(data.budgets, month, 'category', t.id);
    const bs = limit !== null ? budgetStatus(topTotal(t.id), limit) : null;
    return {
      id: t.id, name: t.name, icon: catIcon(cats, t), tone: isJoint ? 't-hh' : 't-all', cents: topTotal(t.id),
      count: childrenOf(cats, t.id).filter((c) => !c.archived).length,
      bar: bs && limit !== null ? { ratio: bs.ratio, over: bs.over, color: barColor(bs.ratio, bs.over, 'var(--all)'), label: `Budget ${t.name}: ${formatEUR(topTotal(t.id))} von ${formatEUR(limit)}${bs.over ? ', überschritten' : ''}` } : null
    };
  });

  return (
    <>
      <Header monthSwipe kicker={<><span className={'kk ' + (isJoint ? 'kk-hh' : 'kk-all')}>{isJoint && jset ? jset.name : 'Alltag'}</span>{month === currentMonthKey() ? ` · noch ${daysLeftInMonth(month)} ${daysLeftInMonth(month) === 1 ? 'Tag' : 'Tage'}` : ''}</>} title={monthLabel(month)} pick={{ month, onChange: setMonth, value: (p) => (isJoint ? jointFreeOf(data.transactions, data.jointTransactions, data.recurring, data.settings, p) : freeOf(data.transactions, cats, data.settings, data.recurring, p)) }} />
      <AccountSwitch />
      <div className="hero flathero">
        <div className="sp end">
          <div className="col"><span className="cap">Ausgaben</span><span className="fhbig"><Money cents={spentShown} /></span></div>
          <div className="col right"><span className="cap">{outlook ? 'Voraussichtlich frei' : 'Noch verfügbar'}</span><span className={'fhbig' + (st.over ? ' neg' : '') + (outlook ? ' olval' : '')}>{hasBase ? (leftShown < 0 ? `−${formatEUR(-leftShown)}` : formatEUR(leftShown)) : '–'}</span></div>
        </div>
        <CatBar segs={segs} base={target} onOpen={() => setDetail(true)}
          color={isJoint ? 'var(--hh-bar)' : 'var(--all-bar)'}
          label={`${formatEUR(spent)} von ${formatEUR(target)} ausgegeben: ${tops.filter((t) => topTotal(t.id) > 0).map((t) => `${t.name} ${formatEUR(topTotal(t.id))}`).join(', ') || 'noch nichts'}`} />
        {segs.some((x) => x.cents > 0) && <span className="barhint"><OnceHint id="barhint">{byAmount ? 'Balken antippen für Details' : 'Balken antippen für Details · Kategorien halten zum Sortieren'}</OnceHint></span>}
        {isJoint && jm && jset && (
          <button className="clickrow mini" style={{ textAlign: 'left' }} onClick={() => setPartnerEdit(true)}>
            Ich {formatEUR(jm.myCents)} · {jset.partnerName || 'Partner/in'} {formatEUR(jm.partnerCents)}{jset.partnerByMonth[month] !== undefined ? ' (diesen Monat angepasst)' : ''}{jm.carryCents !== 0 ? ` · Übertrag ${jm.carryCents > 0 ? '+' : '−'}${formatEUR(Math.abs(jm.carryCents))}` : ''}<Chevr />
          </button>
        )}
        {outlook && <span className="cap">Ausblick – Gehalt und Fixkosten kommen am 1. {monthLabel(month).split(' ')[0]} dazu.</span>}
        {!hasBase && <span className="cap">{isJoint ? 'Lege unter Mehr › Gemeinsames Konto die Einzahlungen fest.' : 'Lege unter Mehr › Wiederkehrende Einnahmen dein Gehalt fest, um ein Budget zu sehen.'}</span>}
      </div>
      <SpendCalendar month={month} cats={cats} open={!calFold.isCollapsed(isJoint ? 'joint' : 'own')} onToggle={() => calFold.toggle(isJoint ? 'joint' : 'own')}
        txs={calTxs} dailyBudget={hasBase && target > 0 ? Math.round(target / daysInMonth(month)) : null}
        onOpenTx={onOpenTx} onAdd={(p) => onAdd(isJoint ? { ...p, account: 'joint' } : p)} onDelete={(id) => void remove(id)} />
      {tops.length > 1 && (
        <div className="sortrow">
          <span className="cap">Kategorien</span>
          <span className="sortbtns">{!grid && <FoldAllBtn ids={shown.map((t) => t.id)} fold={fold} onFold={(c) => { if (c) setOpen(new Set()); }} />}
          <ViewToggle view={catView} onToggle={toggleView} />
          <button className={'sortpill' + (byAmount ? ' on' : '')} aria-label={`Sortieren: ${byAmount ? 'nach Betrag' : 'eigene Reihenfolge'}`} onClick={() => setSortOpen(true)}>
            <Icon name="sort" size={16} w={2.2} />
          </button></span>
        </div>
      )}
      {tops.length === 0 && <div className="card"><Empty>Keine Alltags-Kategorien vorhanden.</Empty></div>}
      {grid
        ? <CatGrid items={tiles} drag={topDrag} canDrag={!byAmount} body={(id) => { const t = shown.find((x) => x.id === id)!; return <AlltagCard {...cardProps(t)} bodyOnly />; }} />
        : shown.map((t) => <AlltagCard key={t.id} {...cardProps(t)} />)}
      {detail && <CatDetailSheet title={`${isJoint && jset ? jset.name : 'Alltag'} · ${monthLabel(month)}`} segs={segs} shades={PIE_SHADES[isJoint ? 'hh' : 'alltag']} sub="Ausgaben" onClose={() => setDetail(false)}
        renderDetail={(id) => {
          // Unterkategorien mit Ausgaben, größte zuerst; Buchungen direkt auf der Hauptkategorie als eigene Zeile
          const kids = childrenOf(cats, id);
          const rows = [...kids.map((c) => ({ id: c.id, name: c.name })), { id, name: kids.length ? 'Ohne Unterkategorie' : 'Buchungen' }]
            .map((r) => ({ ...r, cents: byCat.get(r.id) ?? 0 })).filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents);
          return rows.map((r) => (
            <DetailRow key={r.id} name={r.name} cents={r.cents}>
              {txOf(r.id).map((x) => (
                <div className="dtx" key={x.id}><span><small>{x.date.slice(8, 10)}.{x.date.slice(5, 7)}.</small>{x.description || r.name}</span><span>{formatEUR(x.amountCents)}</span></div>
              ))}
            </DetailRow>
          ));
        }} />}
      {sortOpen && <SortSheet mode={sortMode} onPick={setSortMode} onClose={() => setSortOpen(false)} />}
      {partnerEdit && jset && <PartnerMonthSheet month={month} onClose={() => setPartnerEdit(false)} />}
    </>
  );
}

type Drag = ReturnType<typeof useDragSort>;

/** Eine Hauptkategorie mit ihren Unterkategorien; Unterkategorien lassen sich per Gedrückthalten umsortieren. */
function AlltagCard({ t, drag, collapsed, onFold, isJoint, open, toggle, byCat, total, txOf, onAdd, onOpenTx, remove, byAmount, bodyOnly }: {
  t: Category; drag: Drag; collapsed: boolean; onFold: () => void; isJoint: boolean; open: Set<string>; toggle: (id: string) => void; byCat: Map<string, number>; total: number;
  txOf: (id: string) => Transaction[]; onAdd: (p: TxPreset) => void; onOpenTx: (t: Transaction) => void; remove: (id: string) => Promise<void>; byAmount: boolean;
  /** Kachel-Ansicht: nur die Unterkategorien (aufgeklappt unter der Kachel) */
  bodyOnly?: boolean;
}) {
  const { data, run } = useStore();
  const cats = data.categories;
  const kidsAll = childrenOf(cats, t.id).filter((c) => !c.archived);
  // Nach Betrag: Unterkategorien ebenfalls absteigend; Ziehen ist dann aus
  const kids = byAmount ? [...kidsAll].sort((a, b) => (byCat.get(b.id) ?? 0) - (byCat.get(a.id) ?? 0) || a.sort - b.sort) : kidsAll;
  const canDrag = !byAmount;
  const subDrag = useDragSort(kids.map((c) => c.id), (ids) => {
    const full = childrenOf(cats, t.id).map((c) => c.id);
    void run((db) => setCategoryOrder(db, mergeOrder(full, ids)));
  });
  const it = drag.item(t.id);
  // Budget (Mehr › Budgets) als schmaler Balken unter dem Namen; nur eigenes Konto
  const { month } = useStore();
  const limit = isJoint ? null : resolveBudget(data.budgets, month, 'category', t.id);
  const st = limit !== null ? budgetStatus(total, limit) : null;
  const subs = (kids.length === 0 ? [{ id: t.id, name: 'Buchungen' }] : kids).map((c) => {
        const isOpen = open.has(c.id);
        const list = txOf(c.id);
        const amount = byCat.get(c.id) ?? 0;
        const si = canDrag && kids.length > 1 ? subDrag.item(c.id) : null;
        return (
          <div key={c.id} ref={si?.ref} style={si?.style} className={si?.className}>
            <div className={'subrow' + (si ? ' dhandle' : '')} {...(si ? subDrag.handle(c.id) : {})}>
              <button className="tog" aria-expanded={isOpen} aria-label={`Buchungen ${c.name} ${isOpen ? 'zuklappen' : 'aufklappen'}`} onClick={() => toggle(c.id)}><Chevron open={isOpen} /></button>
              <button className="sub" onClick={() => onAdd(isJoint ? { categoryId: c.id, account: 'joint' } : { categoryId: c.id })}><span>{c.name}</span><span className="num" style={{ color: amount === 0 ? 'var(--mut)' : undefined }}>{formatEUR(amount)}</span></button>
            </div>
            <Collapse open={isOpen}>
              <div className="drill">
                {list.length === 0 && <div className="none">Keine Buchungen in diesem Monat.</div>}
                {list.map((x) => (
                  <SwipeRow key={x.id} className="dtx" fresh={isFresh(x.id)} txid={x.id} onTap={() => onOpenTx(x)}
                    menu={{ onEdit: () => onOpenTx(x), onDuplicate: () => onAdd(duplicatePreset(x)), onDelete: () => void remove(x.id) }}>
                    <span><small>{x.date.slice(8, 10)}.{x.date.slice(5, 7)}.</small>{x.description || c.name}</span><span>{formatEUR(x.amountCents)}</span>
                  </SwipeRow>
                ))}
              </div>
            </Collapse>
          </div>
        );
      });
  if (bodyOnly) return <div className="card flush">{subs}</div>;
  return (
    <div ref={it.ref} style={it.style} className={'card flush ' + it.className}>
      <div className={'ghead ghx' + (canDrag ? ' dhandle' : '')} {...(canDrag ? drag.handle(t.id) : {})}>
        <button className="gmain" onClick={() => onAdd(isJoint ? { categoryId: t.id, account: 'joint' } : { categoryId: t.id })}>
          <span className={'tile flat ' + (isJoint ? 't-hh' : 't-all')}><Icon name={catIcon(cats, t)} size={22} /></span>
          {limit !== null && st
            ? <span className="gnm"><b>{t.name}</b><span className={'gbar' + (st.over ? ' overbar' : '')} role="img" aria-label={`Budget ${t.name}: ${formatEUR(total)} von ${formatEUR(limit)}${st.over ? ', überschritten' : ''}`}><i style={{ width: `${Math.min(100, st.ratio * 100)}%`, background: barColor(st.ratio, st.over, 'var(--all)') }} /></span></span>
            : <b>{t.name}</b>}
          <b className={'num' + (st?.over ? ' overshake' : '')}>{formatEUR(total)}</b>
        </button>
        <CollapseBtn name={t.name} collapsed={collapsed} onClick={onFold} />
      </div>
      <Collapse open={!collapsed}>
      {!collapsed && subs}
      </Collapse>
    </div>
  );
}

/** Beitrag der anderen Person für einen Monat anpassen (z. B. wenn er in diesem Monat abweicht). */
function PartnerMonthSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const { data, run } = useStore();
  const j = data.settings.joint!;
  const [v, setV] = useState(centsToGroupedInput(j.partnerByMonth[month] ?? j.partnerDefaultCents));
  const [err, setErr] = useState('');
  const who = j.partnerName || 'Partner/in';
  return (
    <Sheet title={`Einzahlung ${who}`} onClose={onClose}>
      <div className="card flush">
        <label className="field"><span>{monthLabel(month)} (€)</span><AmountInput label={`Einzahlung ${who}`} value={v} onChange={setV} /></label>
        <div className="kv"><span className="cap">üblicher Betrag</span><b>{formatEUR(j.partnerDefaultCents)}</b></div>
      </div>
      {err && <div className="err-text" role="alert">{err}</div>}
      <button className="btn" onClick={async () => {
        const c = v.trim() === '' ? 0 : parseCents(v);
        if (c === null && v.trim() !== '0') return setErr('Bitte gib einen gültigen Betrag ein.');
        if (await run((db) => setPartnerMonth(db, month, c ?? 0).then(() => true), 'Gespeichert')) onClose();
      }}>Für {monthLabel(month)} speichern</button>
      {j.partnerByMonth[month] !== undefined && <button className="btn sec2" onClick={async () => { if (await run((db) => setPartnerMonth(db, month, null).then(() => true), 'Üblicher Betrag gilt wieder')) onClose(); }}>Üblichen Betrag verwenden</button>}
      <p className="note">Den eigenen Beitrag änderst du direkt an der Buchung „Beitrag …“ in diesem Monat oder dauerhaft unter Mehr › Gemeinsames Konto.</p>
    </Sheet>
  );
}
