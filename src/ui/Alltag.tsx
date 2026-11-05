import { useMemo, useState } from 'react';
import { useCountUp, catIcon, CatDetailSheet, DetailRow, PIE_SHADES, AccountSwitch, AmountInput, Back, CatBar, Chevr, Chevron, Collapse, CollapseBtn, Empty, Header, MonthNav, Money, Sheet, useCollapsed } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { budgetStatus, childrenOf, filterTransactions, jointMonth, monthAvailable, salaryStartMonth, sortTransactions, topLevel, totalsByCategory } from '../domain/calc';
import { deleteTransactions, restoreTransactions, setCategoryOrder, setPartnerMonth } from '../db/repo';
import { mergeOrder, useDragSort } from './dragSort';
import { SwipeRow } from './Bookings';
import { CategoriesPage } from './More';
import { currentMonthKey, daysLeftInMonth, monthLabel, monthRange } from '../domain/dates';
import type { Category, Transaction } from '../domain/types';
import { isHouseholdCat } from '../domain/types';
import { centsToGroupedInput, formatEUR, parseCents } from '../domain/money';
import type { TxPreset } from './TxSheet';
import { duplicatePreset } from './TxSheet';
import { isFresh } from './fresh';

export function Alltag({ onAdd, onOpenTx }: { onAdd: (p: TxPreset) => void; onOpenTx: (t: Transaction) => void }) {
  const { data, month, setMonth, acct, run, flash } = useStore();
  const remove = async (id: string) => {
    const removed = await run((db) => deleteTransactions(db, [id]));
    if (!removed || removed.length === 0) return;
    flash('Buchung gelöscht', 'ok', { label: 'Rückgängig', run: () => { void run((db) => restoreTransactions(db, removed), 'Wiederhergestellt'); } });
  };
  const isJoint = acct === 'joint';
  const jset = data.settings.joint;
  const jm = jointMonth(data.transactions, data.jointTransactions, data.recurring, data.settings, month);
  const [partnerEdit, setPartnerEdit] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editCats, setEditCats] = useState(false);
  const fold = useCollapsed(isJoint ? 'joint' : 'alltag');
  const [detail, setDetail] = useState(false);
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const txOf = (catId: string) => sortTransactions(txs.filter((t) => t.categoryId === catId));
  const cats = data.categories;
  const { from, to } = monthRange(month);
  const source = isJoint ? data.jointTransactions : data.transactions;
  const txs = useMemo(() => filterTransactions(source, cats, { from, to, type: 'expense' }), [source, cats, from, to]);
  const byCat = useMemo(() => totalsByCategory(txs, 'expense'), [txs]);
  // Haushaltskonto und eigenes Konto haben getrennte Kategorienlisten
  const tops = cats.filter((c) => c.parentId === null && c.kind === 'expense' && !c.archived
    && (isJoint ? isHouseholdCat(c) : !isHouseholdCat(c) && c.group === 'alltag'))
    .sort((a, b) => a.sort - b.sort);

  const topTotal = (id: string) => (byCat.get(id) ?? 0) + childrenOf(cats, id).reduce((a, c) => a + (byCat.get(c.id) ?? 0), 0);
  const spent = isJoint && jm ? jm.spentCents : tops.reduce((a, c) => a + topTotal(c.id), 0);
  // Eigenes Konto: Budget = Einnahmen − Fixkosten − Sparen (− sonstige Ausgaben), damit „Noch verfügbar“
  // genau dem Wert der Übersicht entspricht
  const own = useMemo(() => monthAvailable(filterTransactions(data.transactions, cats, { from, to }), data.settings, month, salaryStartMonth(data.recurring, cats)), [data.transactions, cats, from, to, data.settings, month, data.recurring]);
  const target = isJoint && jm ? jm.budgetCents + jm.carryCents : own.availableCents + spent;
  const st = budgetStatus(spent, target);
  const segs = tops.map((t) => ({ id: t.id, name: t.name, icon: catIcon(cats, t), cents: topTotal(t.id) }));
  const hasBase = isJoint ? target > 0 : own.incomeCents > 0;
  // Beträge zählen beim Monatswechsel mit, wie auf der Übersicht
  const spentShown = useCountUp(spent);
  const leftShown = useCountUp(hasBase ? st.remainingCents : 0);
  // Alle Kategorien sind sichtbar; jede lässt sich einzeln einklappen (wird gemerkt)
  const shown = tops;
  // Reihenfolge der Hauptkategorien per Gedrückthalten und Ziehen; unsichtbare behalten ihren Platz
  const topDrag = useDragSort(shown.map((t) => t.id), (ids) => {
    const full = topLevel(cats, 'expense').map((c) => c.id);
    void run((db) => setCategoryOrder(db, mergeOrder(full, ids)));
  });

  if (editCats) return isJoint
    ? <CategoriesPage scope="joint" back={<Back label="Alltag" onClick={() => setEditCats(false)} />} />
    : <CategoriesPage group="alltag" back={<Back label="Alltag" onClick={() => setEditCats(false)} />} />;
  return (
    <>
      <Header monthSwipe kicker={<><span className={'kk ' + (isJoint ? 'kk-hh' : 'kk-all')}>{isJoint && jset ? jset.name : 'Alltag'}</span>{month === currentMonthKey() ? ` · noch ${daysLeftInMonth(month)} ${daysLeftInMonth(month) === 1 ? 'Tag' : 'Tage'}` : ''}</>} title={monthLabel(month)} right={<MonthNav month={month} onChange={setMonth} onEdit={() => setEditCats(true)} />} />
      <AccountSwitch />
      <div className="hero flathero">
        <div className="sp end">
          <div className="col"><span className="cap">Ausgaben</span><span className="fhbig"><Money cents={spentShown} /></span></div>
          <div className="col right"><span className="cap">Noch verfügbar</span><span className={'fhbig' + (st.over ? ' neg' : '')}>{hasBase ? (leftShown < 0 ? `−${formatEUR(-leftShown)}` : formatEUR(leftShown)) : '–'}</span></div>
        </div>
        <CatBar segs={segs} base={target} onOpen={() => setDetail(true)}
          color={isJoint ? 'var(--hh-bar)' : 'var(--all-bar)'}
          label={`${formatEUR(spent)} von ${formatEUR(target)} ausgegeben: ${tops.filter((t) => topTotal(t.id) > 0).map((t) => `${t.name} ${formatEUR(topTotal(t.id))}`).join(', ') || 'noch nichts'}`} />
        {segs.some((x) => x.cents > 0) && <span className="barhint">Balken antippen für Details · Kategorien halten zum Sortieren</span>}
        {isJoint && jm && jset && (
          <button className="clickrow mini" style={{ textAlign: 'left' }} onClick={() => setPartnerEdit(true)}>
            Ich {formatEUR(jm.myCents)} · {jset.partnerName || 'Partner/in'} {formatEUR(jm.partnerCents)}{jset.partnerByMonth[month] !== undefined ? ' (diesen Monat angepasst)' : ''}{jm.carryCents !== 0 ? ` · Übertrag ${jm.carryCents > 0 ? '+' : '−'}${formatEUR(Math.abs(jm.carryCents))}` : ''}<Chevr />
          </button>
        )}
        {!hasBase && <span className="cap">{isJoint ? 'Lege unter Mehr › Gemeinsames Konto die Einzahlungen fest.' : 'Lege unter Mehr › Gehalt & Wiederkehrend dein Gehalt fest oder buche eine Einnahme, um ein Budget zu sehen.'}</span>}
      </div>
      {tops.length === 0 && <div className="card"><Empty>Keine Alltags-Kategorien vorhanden.</Empty></div>}
      {shown.map((t) => (
        <AlltagCard key={t.id} t={t} drag={topDrag} collapsed={fold.isCollapsed(t.id)} onFold={() => fold.toggle(t.id)} isJoint={isJoint} open={open} toggle={toggle} byCat={byCat} total={topTotal(t.id)} txOf={txOf} onAdd={onAdd} onOpenTx={onOpenTx} remove={remove} />
      ))}
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
      {partnerEdit && jset && <PartnerMonthSheet month={month} onClose={() => setPartnerEdit(false)} />}
    </>
  );
}

type Drag = ReturnType<typeof useDragSort>;

/** Eine Hauptkategorie mit ihren Unterkategorien; Unterkategorien lassen sich per Gedrückthalten umsortieren. */
function AlltagCard({ t, drag, collapsed, onFold, isJoint, open, toggle, byCat, total, txOf, onAdd, onOpenTx, remove }: {
  t: Category; drag: Drag; collapsed: boolean; onFold: () => void; isJoint: boolean; open: Set<string>; toggle: (id: string) => void; byCat: Map<string, number>; total: number;
  txOf: (id: string) => Transaction[]; onAdd: (p: TxPreset) => void; onOpenTx: (t: Transaction) => void; remove: (id: string) => Promise<void>;
}) {
  const { data, run } = useStore();
  const cats = data.categories;
  const kids = childrenOf(cats, t.id).filter((c) => !c.archived);
  const subDrag = useDragSort(kids.map((c) => c.id), (ids) => {
    const full = childrenOf(cats, t.id).map((c) => c.id);
    void run((db) => setCategoryOrder(db, mergeOrder(full, ids)));
  });
  const it = drag.item(t.id);
  return (
    <div ref={it.ref} style={it.style} className={'card flush ' + it.className}>
      <div className="ghead ghx dhandle" {...drag.handle(t.id)}>
        <button className="gmain" onClick={() => onAdd(isJoint ? { categoryId: t.id, account: 'joint' } : { categoryId: t.id })}>
          <span className={'tile flat ' + (isJoint ? 't-hh' : 't-all')}><Icon name={catIcon(cats, t)} size={22} /></span><b>{t.name}</b><b className="num">{formatEUR(total)}</b>
        </button>
        <CollapseBtn name={t.name} collapsed={collapsed} onClick={onFold} />
      </div>
      <Collapse open={!collapsed}>
      {!collapsed && (kids.length === 0 ? [{ id: t.id, name: 'Buchungen' }] : kids).map((c) => {
        const isOpen = open.has(c.id);
        const list = txOf(c.id);
        const amount = byCat.get(c.id) ?? 0;
        const si = kids.length > 1 ? subDrag.item(c.id) : null;
        return (
          <div key={c.id} ref={si?.ref} style={si?.style} className={si?.className}>
            <div className="subrow dhandle" {...(kids.length > 1 ? subDrag.handle(c.id) : {})}>
              <button className="tog" aria-expanded={isOpen} aria-label={`Buchungen ${c.name} ${isOpen ? 'zuklappen' : 'aufklappen'}`} onClick={() => toggle(c.id)}><Chevron open={isOpen} /></button>
              <button className="sub" onClick={() => onAdd(isJoint ? { categoryId: c.id, account: 'joint' } : { categoryId: c.id })}><span>{c.name}</span><span className="num" style={{ color: amount === 0 ? 'var(--mut)' : undefined }}>{formatEUR(amount)}</span></button>
            </div>
            <Collapse open={isOpen}>
              <div className="drill">
                {list.length === 0 && <div className="none">Keine Buchungen in diesem Monat.</div>}
                {list.map((x) => (
                  <SwipeRow key={x.id} className="dtx" fresh={isFresh(x.id)} onTap={() => onOpenTx(x)}
                    menu={{ onEdit: () => onOpenTx(x), onDuplicate: () => onAdd(duplicatePreset(x)), onDelete: () => void remove(x.id) }}>
                    <span><small>{x.date.slice(8, 10)}.{x.date.slice(5, 7)}.</small>{x.description || c.name}</span><span>{formatEUR(x.amountCents)}</span>
                  </SwipeRow>
                ))}
              </div>
            </Collapse>
          </div>
        );
      })}
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
