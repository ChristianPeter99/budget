import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CategoryDonutCard, SpanSheet, spanLabel } from '../../ui/Donut';
import type { MonthSpan } from '../../ui/Donut';
import { useStore } from '../../state/store';
import { currentMonthKey, monthLabel, monthRange, monthShort, shiftMonth } from '../../domain/dates';
import { filterTransactions, monthSeries, totalsByTopCategory } from '../../domain/transactions';
import { jointMonth } from '../../domain/joint';
import { categoryFamily, categoryName } from '../../domain/categories';
import { budgetStatus, resolveBudget } from '../../domain/budget';
import { Header } from '../../ui/Header';
import { Icon } from '../../ui/icons';
import { AccountSwitch } from '../../ui/AccountSwitch';
import { formatEUR } from '../../domain/money';
import { Bar, barColor } from '../../ui/Bar';

/** Farben für die Kategorien des Haushaltskontos (gut unterscheidbar auf dunklem Grund) */
const JOINT_COLORS = ['#5B9CF6', '#E8B04B', '#C084FC', '#F47C7C', '#F59AD0'];

let lastSpan: MonthSpan | null = null;

export function Stats({ back }: { back?: ReactNode }) {
  const { data, acct } = useStore();
  const cats = data.categories;
  const isJoint = acct === 'joint';
  const all = isJoint ? data.jointTransactions : data.transactions;
  const now = currentMonthKey();
  // Ein Zeitraum für die ganze Auswertung (von Monat bis Monat oder „heute“); bleibt erhalten, solange die App offen ist
  // Standard „Alles“ (vom ersten Monat mit Daten bis heute); null = „Alles“, wächst mit, wenn ältere Daten dazukommen
  const firstData = all.reduce((m, t) => (t.date.slice(0, 7) < m ? t.date.slice(0, 7) : m), now);
  const [chosen, setChosen] = useState<MonthSpan | null>(() => lastSpan);
  const span: MonthSpan = chosen ?? { from: firstData, to: null };
  const setSpan = (sp: MonthSpan) => { const v = sp.from === firstData && sp.to === null ? null : sp; lastSpan = v; setChosen(v); };
  const [pick, setPick] = useState(false);
  const month = span.to ?? now;
  const n = Math.max(1, (Number(month.slice(0, 4)) - Number(span.from.slice(0, 4))) * 12 + Number(month.slice(5, 7)) - Number(span.from.slice(5, 7)) + 1);

  const startMonth = shiftMonth(month, -(n - 1));
  const from = monthRange(startMonth).from, to = monthRange(month).to;
  const periodLabel = spanLabel(span, now);
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

  const W = 336, H = 140, bw = W / n, barW = Math.max(1, Math.min(14, bw / 2 - 3));
  // Bei vielen Monaten nur jede k-te Beschriftung
  const every = Math.ceil(n / 12);

  return (
    <>
      {back}
      <Header kicker="Auswertung" title={periodLabel} right={
        <button className="dfilter hdfilter on" aria-label={`Zeitraum der Auswertung: ${periodLabel}`} onClick={() => setPick(true)}><Icon name="filter" size={18} w={2.2} /></button>
      } />
      <AccountSwitch />
      {pick && <SpanSheet value={span} first={firstData} now={now} onClose={() => setPick(false)} onApply={(sp) => { setSpan(sp); setPick(false); }} />}
      <div className="card stack">
        <div className="sp"><b style={{ fontSize: 'var(--t-section)' }}>{incomeLabel} und Ausgaben</b><span className="mini">{n === 1 ? '1 Monat' : `${n} Monate`}</span></div>
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
                {(n - 1 - i) % every === 0 && <text x={cx} y={H + 14} textAnchor="middle" fontSize="11" fontWeight={p.month === month ? 700 : 400} fill={p.month === month ? '#F4F4F6' : '#A3A7B0'}>{n > 6 ? monthShort(p.month).slice(0, 3) : monthShort(p.month)}</text>}
              </g>
            );
          })}
        </svg>
        {isJoint
          ? <span className="mini slegend"><span><i className="dot" style={{ background: 'var(--inc)' }} />{incomeLabel}</span>{stackKeys.map((k, j) => <span key={k}><i className="dot" style={{ background: stackColor(k, j) }} />{stackLabel(k)}</span>)}</span>
          : <span className="mini"><i className="dot" style={{ background: 'var(--inc)' }} />{incomeLabel} <i className="dot" style={{ background: 'var(--fix)', marginLeft: 12 }} />Fix <i className="dot" style={{ background: 'var(--all)', marginLeft: 12 }} />Alltag <i className="dot" style={{ background: 'var(--spar)', marginLeft: 12 }} />Sparen</span>}
      </div>

      <CategoryDonutCard all={all} cats={cats} areas={isJoint ? ['hh'] : ['alltag', 'fix', 'spar', 'inc']} span={span} />

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
