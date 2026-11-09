import { useState } from 'react';
import type { Category, Recurring, Transaction } from '../../domain/types';
import { useStore } from '../../state/store';
import { useCountUp } from '../../ui/animation';
import { Collapse, CollapseBtn, FoldAllBtn, useCollapsed } from '../../ui/Collapse';
import { SortSheet, useSortMode } from '../../ui/Sort';
import { CatGrid, ViewToggle, useCatView } from '../../ui/CatGrid';
import type { TileItem } from '../../ui/CatGrid';
import { mergeOrder, useDragSort } from '../../ui/dragSort';
import { catIcon, topLevel } from '../../domain/categories';
import { setCategoryOrder } from '../../data/categories';
import { monthLabel, monthName, todayISO } from '../../domain/dates';
import { dueDistance, reserveStatus, sortRecurring } from '../../domain/recurring';
import type { ReserveStatus } from '../../domain/recurring';
import { Header } from '../../ui/Header';
import { freeOf } from '../../domain/month';
import { Icon } from '../../ui/icons';
import { Money } from '../../ui/Money';
import { Bar, CatBar } from '../../ui/Bar';
import { formatEUR } from '../../domain/money';
import { OnceHint } from '../../ui/OnceHint';
import { CatDetailSheet, DetailRow, PIE_SHADES } from '../../ui/CatDetailSheet';
import { EmptyState } from '../../ui/Empty';
import { setRecurringOrder } from '../../data/recurring';

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
  const fold = useCollapsed('fix');
  const [detail, setDetail] = useState(false);
  const [sortMode, setSortMode] = useSortMode('fix');
  const [sortOpen, setSortOpen] = useState(false);
  const byAmount = sortMode === 'amount';
  const topSum = (id: string) => fixRecs.filter((r) => r.active && topOf(r.categoryId) === id).reduce((a, r) => a + r.amountCents, 0);
  // Reihenfolge: eigene (per Ziehen) oder nach Betrag absteigend
  const ordered = byAmount ? [...shownTops].sort((a, b) => topSum(b.id) - topSum(a.id) || a.sort - b.sort) : shownTops;
  const [catView, toggleView] = useCatView('fix');
  const grid = catView === 'grid' && shownTops.length > 1;
  const topDrag = useDragSort(shownTops.map((t) => t.id), (ids) => {
    const full = topLevel(cats, 'expense').map((c) => c.id);
    void run((db) => setCategoryOrder(db, mergeOrder(full, ids)));
  }, grid);
  const recsOf = (id: string) => fixRecs.filter((r) => topOf(r.categoryId) === id);
  const tiles: TileItem[] = ordered.map((t) => ({ id: t.id, name: t.name, icon: catIcon(cats, t), tone: 't-fix', cents: topSum(t.id), count: recsOf(t.id).length }));
  const segs = shownTops.map((t) => ({ id: t.id, name: t.name, icon: catIcon(cats, t), cents: topSum(t.id) }));
  const today = todayISO();
  const upcoming = active
    .map((r) => ({ r, res: reserveStatus(r, data.transactions, today) }))
    .filter((x): x is { r: Recurring; res: ReserveStatus } => x.res !== null)
    .sort((a, b) => a.res.due.monthsAway - b.res.due.monthsAway);

  return (
    <>
      <Header monthSwipe kicker={<span className="kk kk-fix">Fixkosten</span>} title={monthLabel(month)} pick={{ month, onChange: setMonth, value: (p) => freeOf(data.transactions, data.categories, data.settings, data.recurring, p) }} right={<button className="ib" aria-label="Neue Fixkosten" onClick={onNew}><Icon name="plus" size={22} w={2.2} /></button>} />
      <div className="hero flathero">
        <div className="fixhead">
          <div className="col"><span className="cap">Ausgaben</span><span className="fhbig"><Money cents={sumShown} /></span></div>
          {share !== null && <div className="col right"><span className="cap">vom Gehalt</span><span className="fhbig num">{share} %</span></div>}
        </div>
        {sum > 0 && <CatBar segs={segs} base={sum} color="var(--fix-bar)" onOpen={() => setDetail(true)}
          label={`Fixkosten nach Kategorie: ${shownTops.filter((t) => topSum(t.id) > 0).map((t) => `${t.name} ${formatEUR(topSum(t.id))}`).join(', ')}`} />}
        {sum > 0 && <span className="barhint"><OnceHint id="barhint">{byAmount ? 'Balken antippen für Details' : 'Balken antippen für Details · Kategorien halten zum Sortieren'}</OnceHint></span>}
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
        ? <EmptyState title="Keine Fixkosten in diesem Monat" text={`Deine Fixkosten gelten ab ${monthLabel(laterStart)}. Den Beginn änderst du in der Vorlage unter „Gilt ab“.`} />
        : <EmptyState title="Noch keine Fixkosten" text="Miete, Versicherungen, Abos – einmal anlegen, jeden Monat gebucht." action={{ label: 'Fixkosten anlegen', onClick: onNew }} />)}
      {shownTops.length > 1 && (
        <div className="sortrow">
          <span className="cap">Kategorien</span>
          <span className="sortbtns">{!grid && <FoldAllBtn ids={shownTops.map((t) => t.id)} fold={fold} />}
          <ViewToggle view={catView} onToggle={toggleView} tone="fix" />
          <button className={'sortpill fix' + (byAmount ? ' on' : '')} aria-label={`Sortieren: ${byAmount ? 'nach Betrag' : 'eigene Reihenfolge'}`} onClick={() => setSortOpen(true)}>
            <Icon name="sort" size={16} w={2.2} />
          </button></span>
        </div>
      )}
      {sortOpen && <SortSheet mode={sortMode} onPick={setSortMode} onClose={() => setSortOpen(false)} />}
      {grid
        ? <CatGrid items={tiles} drag={topDrag} canDrag={!byAmount} body={(id) => <FixCard t={ordered.find((x) => x.id === id)!} drag={topDrag} byAmount={byAmount} collapsed={false} onFold={() => undefined} recs={recsOf(id)} onEdit={onEdit} bodyOnly />} />
        : ordered.map((t) => <FixCard key={t.id} t={t} drag={topDrag} byAmount={byAmount} collapsed={fold.isCollapsed(t.id)} onFold={() => fold.toggle(t.id)} recs={recsOf(t.id)} onEdit={onEdit} />)}
    </>
  );
}

function FixCard({ t, drag, collapsed, onFold, recs, onEdit, byAmount, bodyOnly }: { t: Category; drag: ReturnType<typeof useDragSort>; collapsed: boolean; onFold: () => void; recs: Recurring[]; onEdit: (r: Recurring) => void; byAmount: boolean; bodyOnly?: boolean }) {
  const { run, data } = useStore();
  const cats = data.categories;
  // Nach Betrag: Positionen ebenfalls absteigend (aktive vor pausierten); Ziehen ist dann aus
  const rs = byAmount ? [...recs].sort((a, b) => Number(b.active) - Number(a.active) || b.amountCents - a.amountCents) : sortRecurring(recs);
  const rowDrag = useDragSort(rs.map((r) => r.id), (ids) => void run((db) => setRecurringOrder(db, ids)));
  const total = rs.filter((r) => r.active).reduce((a, r) => a + r.amountCents, 0);
  const it = drag.item(t.id);
  const rows = rs.map((r) => {
        const yearly = r.interval === 'yearly' && r.yearlyCents;
        const ri = byAmount ? { ref: undefined, style: undefined, className: '' } : rowDrag.item(r.id);
        return (
          <div key={r.id} ref={ri.ref} style={ri.style} className={ri.className}>
            <button className={'sub' + (byAmount ? '' : ' dhandle')} {...(byAmount ? {} : rowDrag.handle(r.id))} onClick={() => onEdit(r)}>
              <span style={{ opacity: r.active ? 1 : 0.5 }}>
                {r.name}{r.active ? '' : ' (pausiert)'}
                {yearly ? <small className="mini" style={{ display: 'block' }}>jährlich {formatEUR(r.yearlyCents as number)}{r.dueMonth ? ` · fällig im ${monthName(r.dueMonth)}` : ''}</small> : null}
                {r.notice ? <small className="mini" style={{ display: 'block' }}>Kündigungsfrist: {r.notice}</small> : null}
              </span>
              <span className="num">{yearly ? '≈ ' : ''}{formatEUR(r.amountCents)}</span>
            </button>
          </div>
        );
      });
  if (bodyOnly) return <div className="card flush">{rows}</div>;
  return (
    <div ref={it.ref} style={it.style} className={'card flush ' + it.className}>
      <div className={'ghead ghx' + (byAmount ? '' : ' dhandle')} {...(byAmount ? {} : drag.handle(t.id))}>
        <div className="gmain"><span className="tile flat t-fix"><Icon name={catIcon(cats, t)} size={22} /></span><b>{t.name}</b><b className="num">{formatEUR(total)}</b></div>
        <CollapseBtn name={t.name} collapsed={collapsed} onClick={onFold} />
      </div>
      <Collapse open={!collapsed}>
      {rows}
      </Collapse>
    </div>
  );
}
