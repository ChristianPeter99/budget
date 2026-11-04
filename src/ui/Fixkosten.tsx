import { useState } from 'react';
import { useCountUp, MonthNav, catIcon, CatDetailSheet, DetailRow, PIE_SHADES, Back, Bar, CatBar, Money, CollapseBtn, Empty, Header, useCollapsed } from './common';
import { CategoriesPage } from './More';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { reserveStatus, topLevel } from '../domain/calc';
import { setCategoryOrder, setRecurringOrder } from '../db/repo';
import { mergeOrder, useDragSort } from './dragSort';
import type { ReserveStatus } from '../domain/calc';
import { monthLabel, todayISO } from '../domain/dates';
import { formatEUR } from '../domain/money';
import type { Category, Recurring, Transaction } from '../domain/types';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const monthName = (m: number): string => MONTHS[m - 1] ?? '';

/** „diesen Monat“, „nächsten Monat“, „in 5 Monaten“ */
export function dueDistance(monthsAway: number): string {
  return monthsAway === 0 ? 'diesen Monat' : monthsAway === 1 ? 'nächsten Monat' : `in ${monthsAway} Monaten`;
}

export function Fixkosten({ onEdit, onNew }: { onEdit: (r: Recurring) => void; onNew: () => void; onOpenTx?: (t: Transaction) => void }) {
  const { data, month, setMonth } = useStore();
  const cats = data.categories;
  // Fixkosten des gewählten Monats: Vorlagen, die in diesem Monat laufen (Beginn/Ende beachtet)
  const fixRecs = data.recurring.filter((r) => r.type === 'expense' && cats.find((c) => c.id === r.categoryId)?.group === 'fix'
    && r.startMonth <= month && (!r.endMonth || r.endMonth >= month));
  const active = fixRecs.filter((r) => r.active);
  const laterStart = data.recurring.filter((r) => r.type === 'expense' && cats.find((c) => c.id === r.categoryId)?.group === 'fix' && r.startMonth > month)
    .map((r) => r.startMonth).sort()[0];
  const sum = active.reduce((a, r) => a + r.amountCents, 0);
  const income = data.settings.expectedIncomeCents;
  const share = income > 0 ? Math.round((sum / income) * 100) : null;
  const tops = cats.filter((c) => c.parentId === null && c.group === 'fix' && !c.archived).sort((a, b) => a.sort - b.sort);
  const topOf = (catId: string) => { const c = cats.find((x) => x.id === catId); return c?.parentId ?? c?.id; };
  const shownTops = tops.filter((t) => fixRecs.some((r) => topOf(r.categoryId) === t.id));
  const { run } = useStore();
  const sumShown = useCountUp(sum);
  const [editCats, setEditCats] = useState(false);
  const fold = useCollapsed('fix');
  const [detail, setDetail] = useState(false);
  const topSum = (id: string) => fixRecs.filter((r) => r.active && topOf(r.categoryId) === id).reduce((a, r) => a + r.amountCents, 0);
  const topDrag = useDragSort(shownTops.map((t) => t.id), (ids) => {
    const full = topLevel(cats, 'expense').map((c) => c.id);
    void run((db) => setCategoryOrder(db, mergeOrder(full, ids)));
  });
  const segs = shownTops.map((t) => ({ id: t.id, name: t.name, icon: catIcon(cats, t), cents: topSum(t.id) }));
  const today = todayISO();
  const upcoming = active
    .map((r) => ({ r, res: reserveStatus(r, data.transactions, today) }))
    .filter((x): x is { r: Recurring; res: ReserveStatus } => x.res !== null)
    .sort((a, b) => a.res.due.monthsAway - b.res.due.monthsAway);

  if (editCats) return <CategoriesPage group="fix" back={<Back label="Fixkosten" onClick={() => setEditCats(false)} />} />;
  return (
    <>
      <Header monthSwipe kicker={<span className="kk-fix">Fixkosten</span>} title={monthLabel(month)} right={<MonthNav month={month} onChange={setMonth} onEdit={() => setEditCats(true)} />} />
      <div className="hero flathero">
        <div className="fixhead">
          <div className="col"><span className="cap">Ausgaben</span><span className="fhbig"><Money cents={sumShown} /></span></div>
          <span className="cap">{active.length} Positionen{share !== null ? ` · ${share} % vom Gehalt` : ''}</span>
        </div>
        {sum > 0 && <CatBar segs={segs} base={sum} color="var(--fix-bar)" onOpen={() => setDetail(true)}
          label={`Fixkosten nach Kategorie: ${shownTops.filter((t) => topSum(t.id) > 0).map((t) => `${t.name} ${formatEUR(topSum(t.id))}`).join(', ')}`} />}
        {sum > 0 && <span className="barhint">Balken antippen für Details · Kategorien halten zum Sortieren</span>}
      </div>

      {upcoming.length > 0 && (
        <div className="card flush">
          <div className="sec"><h2>Rücklagen für jährliche Zahlungen</h2></div>
          {upcoming.map(({ r, res }) => (
            <button className="hbar clickrow" key={r.id} onClick={() => onEdit(r)}>
              <div className="sp"><b>{r.name}</b><span className={'amt' + (res.due.monthsAway === 0 ? ' warn' : '')}>{formatEUR(res.yearlyCents)}</span></div>
              <Bar ratio={res.yearlyCents > 0 ? res.savedCents / res.yearlyCents : 0} color="var(--fix)" />
              <div className="sp">
                <span className="mini">{formatEUR(res.savedCents)} von {formatEUR(res.yearlyCents)} angespart</span>
                <span className="mini">fällig {monthLabel(res.due.month)} · {dueDistance(res.due.monthsAway)}</span>
              </div>
              {res.shortfallCents > 0 && <span className="mini warn">Bis zur Fälligkeit fehlen voraussichtlich {formatEUR(res.shortfallCents)}, weil der Zyklus nicht vollständig angespart wurde.</span>}
            </button>
          ))}
        </div>
      )}

      {detail && <CatDetailSheet title="Fixkosten pro Monat" segs={segs} shades={PIE_SHADES.fix} sub="Ausgaben" onClose={() => setDetail(false)}
        renderDetail={(id) => {
          // Positionen nach Unterkategorie gruppiert (aufklappbar); ohne Unterkategorie direkt als Zeile
          const recs = fixRecs.filter((r) => r.active && topOf(r.categoryId) === id).sort((a, b) => b.amountCents - a.amountCents);
          const subIds = [...new Set(recs.map((r) => r.categoryId).filter((c) => c !== id))];
          const groups = subIds.map((sid) => ({ sid, name: cats.find((c) => c.id === sid)?.name ?? '', rs: recs.filter((r) => r.categoryId === sid) }))
            .map((g) => ({ ...g, cents: g.rs.reduce((a, r) => a + r.amountCents, 0) }));
          const direct = recs.filter((r) => r.categoryId === id);
          const items = [...groups.map((g) => ({ key: g.sid, cents: g.cents, node: (
            <DetailRow key={g.sid} name={g.name} cents={g.cents}>
              {g.rs.map((r) => <div className="dtx" key={r.id}><span>{r.name}</span><span>{r.interval === 'yearly' ? '≈ ' : ''}{formatEUR(r.amountCents)}</span></div>)}
            </DetailRow>) })),
            ...direct.map((r) => ({ key: r.id, cents: r.amountCents, node: <DetailRow key={r.id} name={r.name} cents={r.amountCents} approx={r.interval === 'yearly'} /> }))];
          return items.sort((a, b) => b.cents - a.cents).map((i) => i.node);
        }} />}
      {fixRecs.length === 0 && (laterStart
        ? <div className="card"><Empty>In diesem Monat sind keine Fixkosten gebucht. Deine Fixkosten gelten ab {monthLabel(laterStart)}. Den Beginn änderst du in der jeweiligen Vorlage unter „Gilt ab“.</Empty></div>
        : <div className="card"><Empty>Noch keine Fixkosten.<button className="btn sec2" onClick={onNew}>Fixkosten anlegen</button></Empty></div>)}
      {shownTops.map((t) => <FixCard key={t.id} t={t} drag={topDrag} collapsed={fold.isCollapsed(t.id)} onFold={() => fold.toggle(t.id)} recs={fixRecs.filter((r) => topOf(r.categoryId) === t.id)} onEdit={onEdit} />)}
      {fixRecs.length > 0 && <button className="addfix" onClick={onNew}><Icon name="plus" size={16} w={2.2} />Fixkosten hinzufügen</button>}
    </>
  );
}

/** Positionen: eigene Reihenfolge (per Ziehen), sonst nach Betrag */
export function sortRecurring(rs: Recurring[]): Recurring[] {
  return [...rs].sort((a, b) => (a.sort ?? 1e9) - (b.sort ?? 1e9) || b.amountCents - a.amountCents);
}

function FixCard({ t, drag, collapsed, onFold, recs, onEdit }: { t: Category; drag: ReturnType<typeof useDragSort>; collapsed: boolean; onFold: () => void; recs: Recurring[]; onEdit: (r: Recurring) => void }) {
  const { run, data } = useStore();
  const cats = data.categories;
  const rs = sortRecurring(recs);
  const rowDrag = useDragSort(rs.map((r) => r.id), (ids) => void run((db) => setRecurringOrder(db, ids)));
  const total = rs.filter((r) => r.active).reduce((a, r) => a + r.amountCents, 0);
  const it = drag.item(t.id);
  return (
    <div ref={it.ref} style={it.style} className={'card flush ' + it.className}>
      <div className="ghead ghx dhandle" {...drag.handle(t.id)}>
        <div className="gmain"><span className="tile flat t-fix"><Icon name={catIcon(cats, t)} size={22} /></span><b>{t.name}</b><b className="num">{formatEUR(total)}</b></div>
        <CollapseBtn name={t.name} collapsed={collapsed} onClick={onFold} />
      </div>
      {!collapsed && rs.map((r) => {
        const yearly = r.interval === 'yearly' && r.yearlyCents;
        const ri = rowDrag.item(r.id);
        return (
          <div key={r.id} ref={ri.ref} style={ri.style} className={ri.className}>
            <button className="sub dhandle" {...rowDrag.handle(r.id)} onClick={() => onEdit(r)}>
              <span style={{ opacity: r.active ? 1 : 0.5 }}>
                {r.name}{r.active ? '' : ' (pausiert)'}
                {yearly ? <small className="mini" style={{ display: 'block' }}>jährlich {formatEUR(r.yearlyCents as number)}{r.dueMonth ? ` · fällig im ${monthName(r.dueMonth)}` : ''}</small> : null}
              </span>
              <span className="num">{yearly ? '≈ ' : ''}{formatEUR(r.amountCents)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
