import { useEffect, useMemo, useState } from 'react';
import { Bar, Chevr, Money, barColor, useCountUp, useTweenList } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { budgetStatus, expenseByGroup, filterTransactions, jointMonth, monthAvailable, salaryStartMonth, resolveBudget, summarize } from '../domain/calc';
import { currentMonthKey, daysInMonth, daysLeftInMonth, dayLabel, monthLabel, monthRange, shiftMonth, todayISO } from '../domain/dates';
import { formatEUR, formatEUR0 } from '../domain/money';
import type { Transaction } from '../domain/types';
import type { TxPreset } from './TxSheet';
import { sortGoals } from './Goals';

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

type Sel = 'fix' | 'alltag' | 'spar' | 'hh' | 'inc' | null;

/**
 * Übersicht als ein großer Ring (Entwurf „alles im Ring“): außen Fixkosten, Alltag und Sparen als Anteil am Einkommen,
 * innen dünn das Haushaltskonto, in der Mitte „Noch verfügbar“ und „Heute frei“. In den vier Ecken stehen die Werte;
 * ein Tipp auf Abschnitt oder Ecke zeigt die Details in der Mitte, ein Tipp in die Mitte führt zurück.
 */
export function Overview({ onGoBookings, onGoBackup, onGoGroup, onGoJoint }: {
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
  const isCurrent = month === currentMonthKey();
  const days = daysLeftInMonth(month);
  const reminder = data.settings.backupReminderDays;
  const backupAge = data.lastBackupAt ? Math.floor((Date.now() - new Date(data.lastBackupAt).getTime()) / 86_400_000) : null;
  const backupMsg = backupAge === null ? 'Noch kein Backup' : reminder > 0 && backupAge >= reminder ? 'Backup fällig' : null;
  const shown = useCountUp(av.availableCents);
  const jm = jointMonth(data.transactions, data.jointTransactions, data.recurring, data.settings, month);
  const joint = jm && data.settings.joint ? { name: data.settings.joint.name, avail: jm.budgetCents + jm.carryCents, spent: jm.spentCents } : null;
  const jst = joint ? budgetStatus(joint.spent, joint.avail) : null;
  const goal = sortGoals(data.settings.savingsGoals ?? [])[0];
  const [sel, setSel] = useState<Sel>(null);
  const toggle = (k: Exclude<Sel, null>) => () => setSel((s) => (s === k ? null : k));
  // Monatswechsel: Auswahl zurücksetzen
  useEffect(() => { setSel(null); }, [month]);

  const base = av.incomeCents;
  const pct = (c: number) => (base > 0 ? `${Math.round((c / base) * 100)} %` : '–');
  const elapsed = isCurrent ? Number(todayISO().slice(8, 10)) : month < currentMonthKey() ? daysInMonth(month) : 0;
  const perDay = isCurrent && days > 0 && av.availableCents > 0 ? Math.floor(av.availableCents / days / 100) * 100 : null;
  const fixCount = txs.filter((t) => t.type === 'expense' && cats.find((c) => c.id === t.categoryId)?.group === 'fix').length;
  const incLabel = av.expected ? 'Gehalt (erwartet)' : 'Einnahmen';

  // Ring: Anteile am Einkommen (bzw. an den Ausgaben, wenn diese höher sind)
  const total = Math.max(base, sum.expenseCents, 1);
  const vals = useTweenList([groups.fix, groups.alltag, groups.spar, jst ? Math.min(1, Math.max(0, jst.ratio)) * 1000 : 0, total]);
  const R = 128, C = 2 * Math.PI * R, r2 = 96, C2 = 2 * Math.PI * r2;
  const tot = Math.max(1, vals[4] ?? total);
  const parts = ([['fix', 'var(--fix)', 'cal'], ['alltag', 'var(--all)', 'wallet'], ['spar', 'var(--spar)', 'piggy']] as const).map(([k, color, icon], i) => ({ k, color, icon, v: vals[i] ?? 0 }));
  let off = 0;
  const segs = parts.map((p) => {
    const len = (Math.max(0, p.v) / tot) * C;
    const seg = { ...p, len, off, mid: ((off + len / 2) / C) * 2 * Math.PI };
    off += len;
    return seg;
  });
  const dim = (k: Sel) => (sel && sel !== k ? ' dim' : '') + (sel === k ? ' on' : '');

  const open = (label: string, go: () => void, color: string) => (
    <button className="ovopen" style={{ color }} onClick={go}>{label} öffnen<Chevr /></button>
  );

  return (
    <div className="ovswipe">
      <div className="hd" data-swipe="month">
        <div><div className="kick"><span className="kk">Übersicht</span>{isCurrent ? ` · noch ${days} ${days === 1 ? 'Tag' : 'Tage'}` : ''}</div><h1>{monthLabel(month)}</h1></div>
        <div className="mn">
          <button className="ib" aria-label="Vorheriger Monat" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" /></button>
          <button className="ib" aria-label="Nächster Monat" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" /></button>
        </div>
      </div>
      {backupMsg && (
        <button className="bkpill" role="status" onClick={onGoBackup}>
          <Icon name="warn" size={15} w={2.2} />{backupMsg} · Jetzt sichern
        </button>
      )}

      <div className="hero ovring">
        <svg className="ovsvg" viewBox="0 0 320 320" role="img"
          aria-label={`Fixkosten ${formatEUR(groups.fix)}, Alltag ${formatEUR(groups.alltag)}, Sparen ${formatEUR(groups.spar)} von ${formatEUR(base)} ${av.expected ? 'erwartetem Gehalt' : 'Einnahmen'}${joint ? `; ${joint.name}: ${formatEUR(joint.spent)} von ${formatEUR(joint.avail)}` : ''}`}>
          <circle cx="160" cy="160" r={R} fill="none" style={{ stroke: 'var(--ring-track)' }} strokeWidth="34" />
          {segs.map((sg) => sg.len > 0.5 && (
            <circle key={sg.k} className={'ovseg' + dim(sg.k)} cx="160" cy="160" r={R} fill="none" style={{ stroke: sg.color }}
              strokeWidth={sel === sg.k ? 46 : 34} strokeDasharray={`${Math.max(0.5, sg.len - 2.5)} ${C}`} strokeDashoffset={-sg.off}
              transform="rotate(-90 160 160)" onClick={toggle(sg.k)} />
          ))}
          {joint && <>
            <circle cx="160" cy="160" r={r2} fill="none" style={{ stroke: 'var(--ring-track)' }} strokeWidth="8" />
            {(vals[3] ?? 0) > 1 && <circle className={'ovseg' + dim('hh')} cx="160" cy="160" r={r2} fill="none" style={{ stroke: jst?.over ? 'var(--neg)' : 'var(--hh)' }}
              strokeWidth={sel === 'hh' ? 12 : 8} strokeLinecap="round" strokeDasharray={`${((vals[3] ?? 0) / 1000) * C2} ${C2}`} transform="rotate(-90 160 160)" onClick={toggle('hh')} />}
          </>}
          <g style={{ color: '#fff' }}>
            {segs.map((sg) => sg.len >= 30 && (
              <g key={'i' + sg.k} className={dim(sg.k)} style={{ pointerEvents: 'none' }}>
                <Icon name={sg.icon} size={20} w={2.2} x={160 + R * Math.sin(sg.mid) - 10} y={160 - R * Math.cos(sg.mid) - 10} />
              </g>
            ))}
          </g>
        </svg>

        <div className="ovcenter">
          <button className="ovreset" aria-label={sel ? 'Zurück zur Gesamtansicht' : 'Noch verfügbar'} onClick={() => setSel(null)} />
          {!sel && <>
            <span className="ovlabel">Noch verfügbar</span>
            <span className="big" aria-live="polite"><Money cents={shown} /></span>
            <span className="ovfacts">von {formatEUR0(base)} {av.expected ? 'Gehalt (erwartet)' : 'Einnahmen'}</span>
            {perDay !== null && <span className="ovday">Heute frei {formatEUR0(perDay)}</span>}
          </>}
          {sel === 'fix' && <>
            <span className="ovlabel" style={{ color: 'var(--fix)' }}>Fixkosten</span>
            <span className="ovamt">{formatEUR0(groups.fix)}</span>
            <span className="ovsub">{pct(groups.fix)} vom {av.expected ? 'Gehalt' : 'Einkommen'}</span>
            <span className="ovsub">{fixCount === 1 ? '1 Buchung' : `${fixCount} Buchungen`}</span>
            {open('Fixkosten', () => onGoGroup('fix'), 'var(--fix)')}
          </>}
          {sel === 'alltag' && <>
            <span className="ovlabel" style={{ color: 'var(--all)' }}>Alltag</span>
            <span className="ovamt">{formatEUR0(groups.alltag)}</span>
            <span className="ovsub">{pct(groups.alltag)} vom {av.expected ? 'Gehalt' : 'Einkommen'}</span>
            {elapsed > 0 && <span className="ovsub">Ø {formatEUR0(groups.alltag / elapsed)} pro Tag</span>}
            {open('Alltag', () => onGoGroup('alltag'), 'var(--all)')}
          </>}
          {sel === 'spar' && <>
            <span className="ovlabel" style={{ color: 'var(--spar)' }}>Sparen</span>
            <span className="ovamt">{formatEUR0(groups.spar)}</span>
            <span className="ovsub">diesen Monat gespart</span>
            {goal && <span className="ovsub">{goal.name}: {formatEUR0(goal.savedCents)} / {formatEUR0(goal.targetCents)}</span>}
            {open('Sparen', () => onGoGroup('spar'), 'var(--spar)')}
          </>}
          {sel === 'hh' && joint && jst && <>
            <span className="ovlabel" style={{ color: 'var(--hh)' }}>{joint.name}</span>
            <span className={'ovamt' + (jst.over ? ' neg' : '')}>{formatEUR0(Math.abs(jst.remainingCents))}</span>
            <span className="ovsub">{jst.over ? 'drüber' : 'übrig'} von {formatEUR0(joint.avail)}</span>
            <span className="ovsub">{formatEUR0(joint.spent)} ausgegeben</span>
            {open('Konto', onGoJoint, 'var(--hh)')}
          </>}
          {sel === 'inc' && <>
            <span className="ovlabel" style={{ color: 'var(--pos)' }}>{incLabel}</span>
            <span className="ovamt">{formatEUR0(base)}</span>
            <span className="ovsub">Ausgaben {formatEUR0(sum.expenseCents)}</span>
            {open('Buchungen', onGoBookings, 'var(--pos)')}
          </>}
        </div>

        {joint && jst ? (
          <button className={'ovcorner tl' + dim('hh')} onClick={toggle('hh')} aria-label={`${joint.name}: ${formatEUR(Math.abs(jst.remainingCents))} ${jst.over ? 'drüber' : 'übrig'}`}>
            <span className="ocname" style={{ color: 'var(--hh)' }}><Icon name="Gemeinsames Konto" size={15} w={2.2} />{joint.name}</span>
            <span className={'ocval' + (jst.over ? ' neg' : '')}>{formatEUR0(Math.abs(jst.remainingCents))}</span>
            <span className="ocsub">{jst.over ? 'drüber' : 'übrig'}</span>
          </button>
        ) : (
          <button className={'ovcorner tl' + dim('inc')} onClick={toggle('inc')} aria-label={`${incLabel}: ${formatEUR(base)}`}>
            <span className="ocname" style={{ color: 'var(--pos)' }}><Icon name="Gehalt" size={15} w={2.2} />{av.expected ? 'Gehalt' : 'Einnahmen'}</span>
            <span className="ocval">{formatEUR0(base)}</span>
            <span className="ocsub">{av.expected ? 'erwartet' : 'diesen Monat'}</span>
          </button>
        )}
        <button className={'ovcorner tr' + dim('fix')} onClick={toggle('fix')} aria-label={`Fixkosten: ${formatEUR(groups.fix)}, ${pct(groups.fix)}`}>
          <span className="ocname" style={{ color: 'var(--fix)' }}><Icon name="cal" size={15} w={2.2} />Fixkosten</span>
          <span className="ocval">{formatEUR0(groups.fix)}</span>
          <span className="ocsub">{pct(groups.fix)}</span>
        </button>
        <button className={'ovcorner bl' + dim('spar')} onClick={toggle('spar')} aria-label={`Sparen: ${formatEUR(groups.spar)}${goal ? `, Sparziel ${goal.name} ${Math.round(Math.min(1, goal.savedCents / goal.targetCents) * 100)} Prozent` : ''}`}>
          <span className="ocname" style={{ color: 'var(--spar)' }}><Icon name="piggy" size={15} w={2.2} />Sparen</span>
          <span className="ocval">{formatEUR0(groups.spar)}</span>
          {goal ? <span className="ocsub ocgoal"><span className="ocgname">{goal.name}</span><i><b style={{ width: `${Math.min(100, (goal.savedCents / goal.targetCents) * 100)}%` }} /></i></span> : <span className="ocsub">{pct(groups.spar)}</span>}
        </button>
        <button className={'ovcorner br' + dim('alltag')} onClick={toggle('alltag')} aria-label={`Alltag: ${formatEUR(groups.alltag)}, ${pct(groups.alltag)}`}>
          <span className="ocname" style={{ color: 'var(--all)' }}><Icon name="wallet" size={15} w={2.2} />Alltag</span>
          <span className="ocval">{formatEUR0(groups.alltag)}</span>
          <span className="ocsub">{pct(groups.alltag)}</span>
        </button>
      </div>

      {mb && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="sp"><span className="cap">Monatsbudget</span><span className={'cap num ' + (mb.over ? 'neg' : '')}>{mb.over ? `${formatEUR(-mb.remainingCents)} drüber` : `${formatEUR(mb.remainingCents)} übrig`}</span></div>
          <Bar ratio={mb.ratio} color={barColor(mb.ratio, mb.over, 'var(--inc)')} />
        </div>
      )}
      <p className="ovhint">{sel ? 'Mitte antippen für die Gesamtansicht' : 'Tippe auf einen Bereich für Details'}</p>
    </div>
  );
}
