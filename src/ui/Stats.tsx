import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AccountSwitch, Bar, Chevr, Chevron, Empty, MonthHeader, barColor } from './common';
import { useStore } from '../state/store';
import { savingsEntries } from '../db/repo';
import { budgetStatus, categorySeries, jointMonth, categoryFamily, categoryName, expenseByGroup, filterTransactions, monthSeries, resolveBudget, summarize, totalsByTopCategory } from '../domain/calc';
import { formatDateDE, monthLabel, monthRange, monthShort, shiftMonth, todayISO } from '../domain/dates';
import { formatEUR, formatEUR0 } from '../domain/money';
import type { DepotEntry } from '../domain/types';

const dayNum = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

function DepotChart({ entries, name = 'Depot' }: { entries: DepotEntry[]; name?: string }) {
  const W = 336, H = 150, P = { l: 4, r: 4, t: 12, b: 20 };
  if (entries.length === 0) return <Empty>Keine Einträge in diesem Zeitraum.</Empty>;
  const xs = entries.map((e) => dayNum(e.date));
  const ys = entries.map((e) => e.valueCents);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max((y1 - y0) * 0.15, y1 * 0.01, 100);
  y0 -= pad; y1 += pad;
  const X = (x: number) => (x1 === x0 ? W / 2 : P.l + ((x - x0) / (x1 - x0)) * (W - P.l - P.r));
  const Y = (y: number) => P.t + (1 - (y - y0) / (y1 - y0)) * (H - P.t - P.b);
  const pts = entries.map((e) => [X(dayNum(e.date)), Y(e.valueCents)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const first = entries[0]!, last = entries[entries.length - 1]!;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name}verlauf von ${formatEUR0(first.valueCents)} auf ${formatEUR0(last.valueCents)}`}>
      <line x1={0} x2={W} y1={H - P.b} y2={H - P.b} stroke="#2D2F37" />
      {pts.length > 1 && <path d={`${d} L${pts[pts.length - 1]![0]},${H - P.b} L${pts[0]![0]},${H - P.b} Z`} fill="rgba(244,244,246,.08)" />}
      <path d={d} fill="none" stroke="var(--text)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 4 : 2.5} fill="var(--text)" />)}
      <text x={2} y={H - 5} fontSize="11" fill="#A3A7B0">{formatDateDE(first.date)}</text>
      <text x={W - 2} y={H - 5} fontSize="11" fill="#A3A7B0" textAnchor="end">{formatDateDE(last.date)}</text>
    </svg>
  );
}

/** Stand eines Kontos (Sparkonto, Depot) mit aufklappbarem Verlauf der manuell erfassten Einträge. */
function BalanceCard({ title, entries }: { title: string; entries: DepotEntry[] }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<3 | 6 | 12 | 0>(12);
  const all = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const last = all[all.length - 1];
  if (!last) return null;
  const cutoff = range === 0 ? '' : monthRange(shiftMonth(todayISO().slice(0, 7), -range)).from;
  const shown = all.filter((e) => e.date >= cutoff);
  return (
    <div className="card flush">
      <button className="clickrow pad stack" style={{ gap: 4 }} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${title}: Verlauf ${open ? 'zuklappen' : 'anzeigen'}`}>
        <span className="sp"><span className="cap">{title} · Stand {formatDateDE(last.date)}</span><Chevron open={open} /></span>
        <span className="mid34 num">{formatEUR0(last.valueCents)}</span>
      </button>
      {open && (
        <div className="pad stack">
          <div className="sel" role="group" aria-label={`${title}-Zeitraum`}>
            {([3, 6, 12, 0] as const).map((k) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{k === 0 ? 'Alle' : `${k} M`}</button>)}
          </div>
          <DepotChart entries={shown} name={title} />
        </div>
      )}
    </div>
  );
}

/** Verlauf einer Kategorie über 12 Monate: Linie, Durchschnitt gestrichelt, teuerster Monat markiert. */
function CategoryTrend({ series, current }: { series: { month: string; cents: number }[]; current: string }) {
  const W = 336, H = 120, P = { l: 6, r: 6, t: 20, b: 22 };
  const withData = series.filter((p) => p.cents > 0);
  if (withData.length === 0) return <div className="drill"><div className="none" style={{ paddingLeft: 16 }}>Keine Ausgaben in den letzten 12 Monaten.</div></div>;
  const max = Math.max(...series.map((p) => p.cents));
  const top = series.find((p) => p.cents === max) as { month: string; cents: number };
  const avg = Math.round(series.reduce((a, p) => a + p.cents, 0) / series.length);
  const X = (i: number) => P.l + (i / (series.length - 1)) * (W - P.l - P.r);
  const Y = (c: number) => P.t + (1 - c / max) * (H - P.t - P.b);
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.cents).toFixed(1)}`).join(' ');
  const ti = series.indexOf(top);
  return (
    <div className="drill" style={{ padding: '12px 16px' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Verlauf: teuerster Monat ${monthLabel(top.month)} mit ${formatEUR(top.cents)}, Durchschnitt ${formatEUR(avg)}`}>
        <line x1={P.l} x2={W - P.r} y1={Y(avg)} y2={Y(avg)} stroke="#8A8E98" strokeDasharray="3 4" strokeWidth="1" />
        <path d={d} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => <circle key={p.month} cx={X(i)} cy={Y(p.cents)} r={p.month === top.month ? 4.5 : p.month === current ? 3.5 : 2} fill={p.month === top.month ? 'var(--warn)' : 'var(--text)'} />)}
        <text x={Math.min(Math.max(X(ti), 40), W - 40)} y={Math.max(Y(top.cents) - 9, 11)} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--warn)">{formatEUR(top.cents)}</text>
        {series.map((p, i) => (i % 2 === (series.length - 1) % 2 ? <text key={'l' + p.month} x={X(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'} fontSize="11" fill={p.month === current ? '#F4F4F6' : '#A3A7B0'}>{monthShort(p.month).slice(0, 3)}</text> : null))}
      </svg>
      <div className="sp" style={{ marginTop: 6 }}>
        <span className="mini">Ø 12 Monate {formatEUR(avg)}</span>
        <span className="mini">teuerster Monat: {monthLabel(top.month)}</span>
      </div>
      {withData.length < 3 && <p className="mini" style={{ marginTop: 6 }}>Erst {withData.length} {withData.length === 1 ? 'Monat' : 'Monate'} mit Ausgaben. Der Verlauf wird aussagekräftiger, je länger du die App nutzt.</p>}
    </div>
  );
}

/** Farben für die Kategorien des Haushaltskontos (gut unterscheidbar auf dunklem Grund) */
const JOINT_COLORS = ['#5B9CF6', '#E8B04B', '#C084FC', '#F47C7C', '#F59AD0'];

export function Stats({ back }: { back?: ReactNode }) {
  const { data, month, setMonth, acct } = useStore();
  const cats = data.categories;
  const isJoint = acct === 'joint';
  const all = isJoint ? data.jointTransactions : data.transactions;
  const [n, setN] = useState(12);
  const [pick, setPick] = useState(false);
  const [trend, setTrend] = useState<string | null>(null);

  const startMonth = shiftMonth(month, -(n - 1));
  const from = monthRange(startMonth).from, to = monthRange(month).to;
  const periodLabel = n === 1 ? monthLabel(month) : `${monthLabel(startMonth)} – ${monthLabel(month)}`;
  const txs = useMemo(() => filterTransactions(all, cats, { from, to }), [all, cats, from, to]);
  const baseSeries = useMemo(() => monthSeries(all, month, n), [all, month, n]);
  // Gemeinsames Konto: statt Einnahmen die Einzahlungen beider Personen je Monat
  const series = useMemo(() => isJoint
    ? baseSeries.map((p) => ({ ...p, incomeCents: jointMonth(data.transactions, data.jointTransactions, data.recurring, data.settings, p.month)?.budgetCents ?? 0 }))
    : baseSeries, [isJoint, baseSeries, data.transactions, data.jointTransactions, data.recurring, data.settings]);
  const incomeLabel = isJoint ? 'Einzahlungen' : 'Einnahmen';
  const maxV = Math.max(1, ...series.flatMap((p) => [p.incomeCents, p.expenseCents]));
  // Ausgaben je Monat nach Gruppe (gestapelt in den Gruppenfarben)
  const groupByMonth = useMemo(() => {
    const m = new Map<string, { fix: number; alltag: number; spar: number }>();
    for (const p of series) m.set(p.month, { fix: 0, alltag: 0, spar: 0 });
    const grp = new Map(cats.map((c) => [c.id, c.group]));
    for (const t of all) {
      if (t.type !== 'expense') continue;
      const g = grp.get(t.categoryId);
      const e = m.get(t.date.slice(0, 7));
      if (e && (g === 'fix' || g === 'alltag' || g === 'spar')) e[g] += t.amountCents;
    }
    return m;
  }, [series, all, cats]);
  const sums = summarize(txs);
  const groups = expenseByGroup(txs, cats);
  const byCat = [...totalsByTopCategory(txs, cats, 'expense').entries()].sort((a, b) => b[1] - a[1]);
  // Haushaltskonto: statt Fix/Alltag/Sparen die eigenen Kategorien (die 5 größten im Zeitraum, Rest als „Sonstige“)
  const stackKeys = isJoint ? [...byCat.slice(0, 5).map(([id]) => id), ...(byCat.length > 5 ? ['other'] : [])] : [];
  const stackColor = (k: string, i: number) => (k === 'other' ? '#7A7F8C' : JOINT_COLORS[i % JOINT_COLORS.length] as string);
  const stackLabel = (k: string) => (k === 'other' ? 'Sonstige' : categoryName(cats, k));
  const jointByMonth = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    if (!isJoint) return m;
    const shown = new Set(stackKeys);
    for (const t of all) {
      if (t.type !== 'expense') continue;
      const c = cats.find((x) => x.id === t.categoryId);
      const top = c?.parentId ?? c?.id ?? '';
      const k = shown.has(top) ? top : 'other';
      const mm = m.get(t.date.slice(0, 7)) ?? new Map<string, number>();
      mm.set(k, (mm.get(k) ?? 0) + t.amountCents);
      m.set(t.date.slice(0, 7), mm);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJoint, all, cats, stackKeys.join('|')]);

  const mFrom = monthRange(month).from;
  const monthTx = txs.filter((t) => t.date >= mFrom && t.type === 'expense');
  const monthBudget = resolveBudget(data.budgets, month, 'month');
  const budgetCats = cats.filter((c) => c.parentId === null && c.kind === 'expense' && resolveBudget(data.budgets, month, 'category', c.id) !== null);


  const W = 336, H = 140, bw = W / n, barW = Math.min(14, bw / 2 - 3);

  return (
    <>
      {back}
      <MonthHeader month={month} onChange={setMonth} kicker="Auswertung" />
      <AccountSwitch />
      <div className="card stack">
        <div className="sp">
          <button className="clickrow" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setPick(!pick)} aria-expanded={pick}>
            <b style={{ fontSize: 'var(--t-section)' }}>{n === 1 ? 'Dieser Monat' : `Letzte ${n} Monate`}</b><Chevron open={pick} />
          </button>
        </div>
        {pick && (
          <div className="sel" role="group" aria-label="Zeitraum in Monaten">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((k) => <button key={k} className={k === n ? 'on' : ''} onClick={() => { setN(k); setPick(false); }}>{k}</button>)}
          </div>
        )}
        <svg className="chart" viewBox={`0 0 ${W} ${H + 20}`} role="img" aria-label={`${incomeLabel} und Ausgaben, ${periodLabel}`}>
          {series.map((p, i) => {
            const hi = (p.incomeCents / maxV) * H;
            const g = groupByMonth.get(p.month) ?? { fix: 0, alltag: 0, spar: 0 };
            const hf = (g.fix / maxV) * H, ha = (g.alltag / maxV) * H, hs = (g.spar / maxV) * H;
            const cx = i * bw + bw / 2;
            let y = H;
            return (
              <g key={p.month}>
                <rect x={cx - barW - 1} y={H - hi} width={barW} height={hi} rx="2" fill="var(--inc)" fillOpacity="0.85" />
                {isJoint ? stackKeys.map((k, j) => {
                  const h = ((jointByMonth.get(p.month)?.get(k) ?? 0) / maxV) * H;
                  y -= h;
                  return h > 0 ? <rect key={k} x={cx + 1} y={y} width={barW} height={h} fill={stackColor(k, j)} /> : null;
                }) : <>
                <rect x={cx + 1} y={H - hf} width={barW} height={hf} fill="var(--fix)" />
                <rect x={cx + 1} y={H - hf - ha} width={barW} height={ha} fill="var(--all)" />
                <rect x={cx + 1} y={H - hf - ha - hs} width={barW} height={hs} fill="var(--spar)" />
                </>}
                <text x={cx} y={H + 14} textAnchor="middle" fontSize="11" fontWeight={p.month === month ? 700 : 400} fill={p.month === month ? '#F4F4F6' : '#A3A7B0'}>{n > 6 ? monthShort(p.month).slice(0, 3) : monthShort(p.month)}</text>
              </g>
            );
          })}
        </svg>
        {isJoint
          ? <span className="mini slegend"><span><i className="dot" style={{ background: 'var(--inc)' }} />{incomeLabel}</span>{stackKeys.map((k, j) => <span key={k}><i className="dot" style={{ background: stackColor(k, j) }} />{stackLabel(k)}</span>)}</span>
          : <span className="mini"><i className="dot" style={{ background: 'var(--inc)' }} />{incomeLabel} <i className="dot" style={{ background: 'var(--fix)', marginLeft: 12 }} />Fix <i className="dot" style={{ background: 'var(--all)', marginLeft: 12 }} />Alltag <i className="dot" style={{ background: 'var(--spar)', marginLeft: 12 }} />Sparen</span>}
      </div>

      <div className="card flush">
        <div className="sec"><h2>Zeitraum</h2><span className="mini" style={{ textAlign: 'right' }}>{periodLabel}</span></div>
        <div className="kv"><span>{incomeLabel}</span><b>+{formatEUR(isJoint ? series.reduce((a, p) => a + p.incomeCents, 0) : sums.incomeCents)}</b></div>
        <div className="kv"><span>Ausgaben</span><b>{formatEUR(sums.expenseCents)}</b></div>
        {isJoint ? stackKeys.map((k, j) => (
          <div className="kv sub2" key={k}><span><i className="dot" style={{ background: stackColor(k, j) }} />{stackLabel(k)}</span>
            <b>{formatEUR(k === 'other' ? byCat.slice(5).reduce((a, [, c]) => a + c, 0) : (byCat.find(([id]) => id === k)?.[1] ?? 0))}</b></div>
        )) : <>
        <div className="kv sub2"><span><i className="dot" style={{ background: 'var(--all)' }} />Alltag</span><b>{formatEUR(groups.alltag)}</b></div>
        <div className="kv sub2"><span><i className="dot" style={{ background: 'var(--fix)' }} />Fixkosten</span><b>{formatEUR(groups.fix)}</b></div>
        <div className="kv sub2"><span><i className="dot" style={{ background: 'var(--spar)' }} />Sparen</span><b>{formatEUR(groups.spar)}</b></div>
        </>}
      </div>

      {!isJoint && <BalanceCard title="Sparkonto" entries={savingsEntries(data.settings).map((e) => ({ id: e.date, date: e.date, valueCents: e.cents, createdAt: e.date }))} />}
      {!isJoint && <BalanceCard title="Depot" entries={data.depotEntries} />}

      <div className="card flush">
        <div className="sec"><h2>Ausgaben nach Kategorie</h2></div>
        {byCat.length === 0 && <Empty>Keine Ausgaben in diesem Zeitraum.</Empty>}
        {byCat.map(([id, cents]) => (
          <div key={id}>
            <button className="hbar clickrow" onClick={() => setTrend(trend === id ? null : id)} aria-expanded={trend === id} aria-label={`${categoryName(cats, id)}: Verlauf ${trend === id ? 'schließen' : 'anzeigen'}`}>
              <div className="sp"><b>{categoryName(cats, id)}</b><span className="num">{formatEUR(cents)} · {sums.expenseCents > 0 ? Math.round((cents / sums.expenseCents) * 100) : 0} %<Chevr /></span></div>
              <Bar ratio={sums.expenseCents > 0 ? cents / sums.expenseCents : 0} color="var(--bar)" />
            </button>
            {trend === id && <CategoryTrend series={categorySeries(all, cats, id, month, 12)} current={month} />}
          </div>
        ))}
      </div>

      {!isJoint && (monthBudget !== null || budgetCats.length > 0) && (
        <div className="card flush">
          <div className="sec"><h2>Budgets</h2><span className="mini">{monthLabel(month)}</span></div>
          {monthBudget !== null && (() => {
            const st = budgetStatus(monthTx.reduce((a, t) => a + t.amountCents, 0), monthBudget);
            return (
              <div className="hbar">
                <div className="sp"><b>Gesamtbudget</b><span className={'num ' + (st.over ? 'neg' : '')}>{formatEUR(st.spentCents)} / {formatEUR(st.budgetCents)}</span></div>
                <Bar ratio={st.ratio} color={barColor(st.ratio, st.over, 'var(--inc)')} />
              </div>
            );
          })()}
          {budgetCats.map((c) => {
            const fam = categoryFamily(cats, c.id);
            const st = budgetStatus(monthTx.filter((t) => fam.has(t.categoryId)).reduce((a, t) => a + t.amountCents, 0), resolveBudget(data.budgets, month, 'category', c.id) ?? 0);
            return (
              <div className="hbar" key={c.id}>
                <div className="sp"><b>{c.name}</b><span className={'num ' + (st.over ? 'neg' : '')}>{formatEUR(st.spentCents)} / {formatEUR(st.budgetCents)}</span></div>
                <Bar ratio={st.ratio} color={barColor(st.ratio, st.over, 'var(--inc)')} />
                <span className="cap">{st.over ? `${formatEUR(-st.remainingCents)} über Budget` : `${formatEUR(st.remainingCents)} übrig`}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
