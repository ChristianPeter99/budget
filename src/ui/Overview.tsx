import { useMemo } from 'react';
import { Bar, Chevr, Money, SpendRing, barColor, catIcon, useCountUp } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { budgetStatus, categoryName, expenseByGroup, filterTransactions, jointMonth, monthAvailable, salaryStartMonth, resolveBudget, sortTransactions, summarize } from '../domain/calc';
import { currentMonthKey, daysLeftInMonth, dayLabel, monthLabel, monthRange, shiftMonth, todayISO } from '../domain/dates';
import { formatEUR, formatEUR0 } from '../domain/money';
import { isHouseholdCat } from '../domain/types';
import type { Category, Transaction } from '../domain/types';
import type { TxPreset } from './TxSheet';

/** „Heute, 18:42“ / „Gestern, 18:42“; älter: „Mi, 8.10.“; Vorjahr: „8.10.25“ – passt immer in die schmale Spalte. */
export function lastEntryLabel(txs: Transaction[], now = new Date()): string | null {
  let best: Transaction | null = null;
  for (const t of txs) if (!best || t.createdAt > best.createdAt) best = t;
  if (!best) return null;
  const d = new Date(best.createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (iso === todayISO()) return `Heute, ${time}`;
  if (dayLabel(iso) === 'Gestern') return `Gestern, ${time}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
  return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
}

/** Die 3 meistgenutzten buchbaren Alltags-Kategorien der letzten 90 Tage (für „Schnell erfassen“). */
function quickCategories(txs: Transaction[], cats: Category[], exclude?: string | null): Category[] {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const leaf = (c: Category) => c.id !== exclude && !c.archived && !isHouseholdCat(c) && c.kind === 'expense' && c.group === 'alltag' && !cats.some((x) => x.parentId === c.id);
  const count = new Map<string, number>();
  for (const t of txs) if (t.type === 'expense' && !t.recurringId && t.date >= since) count.set(t.categoryId, (count.get(t.categoryId) ?? 0) + 1);
  const used = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => cats.find((c) => c.id === id)).filter((c): c is Category => !!c && leaf(c));
  const fill = cats.filter(leaf).sort((a, b) => a.sort - b.sort);
  const out: Category[] = [];
  for (const c of [...used, ...fill]) { if (out.length >= 3) break; if (!out.some((x) => x.id === c.id)) out.push(c); }
  return out;
}

export function Overview({ onGoBookings, onGoBackup, onGoGroup, onAdd, onGoJoint }: {
  onOpenTx: (t: Transaction) => void; onGoBookings: () => void; onGoBackup: () => void; onSplit?: () => void;
  onGoGroup: (g: 'fix' | 'alltag' | 'spar') => void; onAdd: (p?: TxPreset) => void; onGoJoint: () => void;
}) {
  const { data, month, setMonth } = useStore();
  const cats = data.categories;
  const { from, to } = monthRange(month);
  const txs = useMemo(() => filterTransactions(data.transactions, cats, { from, to }), [data.transactions, cats, from, to]);
  const sum = summarize(txs);
  const av = monthAvailable(txs, data.settings, month, salaryStartMonth(data.recurring, cats));
  const groups = expenseByGroup(txs, cats);
  const monthBudget = resolveBudget(data.budgets, month, 'month');
  const mb = monthBudget !== null ? budgetStatus(sum.expenseCents, monthBudget) : null;
  const latest = sortTransactions(txs)[0];
  const isCurrent = month === currentMonthKey();
  const days = daysLeftInMonth(month);
  const reminder = data.settings.backupReminderDays;
  const backupAge = data.lastBackupAt ? Math.floor((Date.now() - new Date(data.lastBackupAt).getTime()) / 86_400_000) : null;
  const backupMsg = data.transactions.length === 0 ? null
    : backupAge === null ? 'Noch kein Backup erstellt. Deine Daten liegen nur auf diesem Gerät.'
    : reminder > 0 && backupAge >= reminder ? `Letztes Backup vor ${backupAge} Tagen.` : null;
  const last = lastEntryLabel(txs);
  const shown = useCountUp(av.availableCents);
  const jm = jointMonth(data.transactions, data.jointTransactions, data.recurring, data.settings, month);
  const quick = useMemo(() => quickCategories(data.transactions, cats, data.settings.joint?.categoryId), [data.transactions, cats, data.settings.joint?.categoryId]);
  // Anteil am Einkommen: tatsächliche Einnahmen des Monats, sonst das hinterlegte Gehalt
  const base = av.incomeCents;
  const pct = (c: number) => (base > 0 ? `${Math.round((c / base) * 100)} %` : '–');

  const tiles = [
    { key: 'fix' as const, label: 'Fixkosten', cents: groups.fix },
    { key: 'alltag' as const, label: 'Alltag', cents: groups.alltag },
    { key: 'spar' as const, label: 'Sparen', cents: groups.spar }
  ];

  return (
    <div className="ovswipe">
      <div className="hd" data-swipe="month">
        <div><div className="kick">Übersicht{isCurrent ? ` · noch ${days} ${days === 1 ? 'Tag' : 'Tage'}` : ''}</div><h1>{monthLabel(month)}</h1></div>
        <div className="mn">
          <button className="ib" aria-label="Vorheriger Monat" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" /></button>
          <button className="ib" aria-label="Nächster Monat" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" /></button>
        </div>
      </div>
      {backupMsg && (
        <div className="banner" role="status">
          <span>{backupMsg}</span>
          <button onClick={onGoBackup}>Jetzt sichern</button>
        </div>
      )}

      <div className="hero ovhero">
        <SpendRing total={Math.max(av.incomeCents, sum.expenseCents)} label={`Ausgaben: Fixkosten ${formatEUR(groups.fix)}, Alltag ${formatEUR(groups.alltag)}, Sparen ${formatEUR(groups.spar)} von ${formatEUR(av.incomeCents)} ${av.expected ? 'erwartetem Gehalt' : 'Einnahmen'}`}
          parts={[{ value: groups.fix, color: 'var(--fix)' }, { value: groups.alltag, color: 'var(--all)' }, { value: groups.spar, color: 'var(--spar)' },
            { value: Math.max(0, sum.expenseCents - groups.fix - groups.alltag - groups.spar), color: 'var(--bar)' }]} />
        <div className="ovside">
          <span className="ovlabel">Noch verfügbar</span>
          <span className="big" aria-live="polite"><Money cents={shown} /></span>
          <div className="ovfacts">
            <span>{av.expected ? 'Gehalt (erwartet)' : 'Einnahmen'} <b>{formatEUR(av.incomeCents)}</b></span>
            <span>Ausgaben <b>{formatEUR(sum.expenseCents)}</b></span>
            <span>Letzter Eintrag <b>{last ?? '–'}</b></span>
          </div>
        </div>
      </div>
      {mb && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="sp"><span className="cap">Monatsbudget</span><span className={'cap num ' + (mb.over ? 'neg' : '')}>{mb.over ? `${formatEUR(-mb.remainingCents)} drüber` : `${formatEUR(mb.remainingCents)} übrig`}</span></div>
          <Bar ratio={mb.ratio} color={barColor(mb.ratio, mb.over, 'var(--inc)')} large />
        </div>
      )}

      <div className="stack" style={{ gap: 10 }}>
        <span className="cap" style={{ paddingLeft: 4 }}>Ausgaben</span>
        <div className="gtiles">
        {tiles.map((t) => (
          <button key={t.key} className={'gtile g-' + t.key} onClick={() => onGoGroup(t.key)} aria-label={`${t.label}: ${formatEUR(t.cents)}, ${pct(t.cents)} der Einnahmen`}>
            <span className="gname">{t.label}</span>
            <span className="gval">{formatEUR0(t.cents)}</span>
            <span className="gpct">{pct(t.cents)}</span>
          </button>
        ))}
        </div>
      </div>

      {jm && data.settings.joint && (() => {
        const avail = jm.budgetCents + jm.carryCents;
        const st = budgetStatus(jm.spentCents, avail);
        const r = 16, c = 2 * Math.PI * r, len = Math.min(1, Math.max(0, st.ratio)) * c;
        return (
          <button className="card clickrow hhcard" onClick={onGoJoint}>
            <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-label={`${Math.round(st.ratio * 100)} Prozent ausgegeben`} style={{ flex: 'none' }}>
              <circle cx="20" cy="20" r={r} fill="none" stroke="var(--ring-track)" strokeWidth="6" />
              {len > 0 && <circle cx="20" cy="20" r={r} fill="none" stroke={st.over ? 'var(--neg)' : 'var(--hh)'} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${len} ${c}`} transform="rotate(-90 20 20)" />}
            </svg>
            <span className="hhmid"><b>{data.settings.joint.name}</b><small>{formatEUR(jm.spentCents)} / {formatEUR(avail)}</small></span>
            <span className="hhright"><b className={st.over ? 'neg' : ''}>{formatEUR(st.over ? -st.remainingCents : st.remainingCents)}</b><small>{st.over ? 'drüber' : 'übrig'}</small></span>
          </button>
        );
      })()}

      <div className="stack" style={{ gap: 10 }}>
        <span className="cap" style={{ paddingLeft: 4 }}>Schnell erfassen</span>
        <div className="quick">
          {quick.map((c) => (
            <button key={c.id} onClick={() => onAdd({ categoryId: c.id })}><Icon name={catIcon(cats, c)} size={22} /><span>{c.name}</span></button>
          ))}
          <button className="other" onClick={() => onAdd()}><Icon name="plus" size={22} w={2} /><span>Andere</span></button>
        </div>
      </div>

      <button className="lastrow" onClick={onGoBookings} aria-label="Zuletzt – alle Buchungen anzeigen">
        <span className="cap">Zuletzt</span>
        <span className="lmid">{latest ? `${latest.description || categoryName(cats, latest.categoryId).split(' › ').pop()} · ${categoryName(cats, latest.categoryId).split(' › ').pop()}` : 'Noch keine Buchung'}</span>
        {latest && <span className="num">{latest.type === 'income' ? '+' : ''}{formatEUR(latest.amountCents)}</span>}
        <Chevr />
      </button>
    </div>
  );
}
