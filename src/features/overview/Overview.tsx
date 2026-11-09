import { useEffect, useMemo, useRef, useState } from 'react';
import type { Transaction } from '../../domain/types';
import type { TxPreset } from '../../domain/transactions';
import { useStore } from '../../state/store';
import { currentMonthKey, daysInMonth, daysLeftInMonth, monthLabel, monthRange, todayISO } from '../../domain/dates';
import { freeOf, monthFigures } from '../../domain/month';
import { budgetStatus, resolveBudget } from '../../domain/budget';
import { useCountUp, useTweenList } from '../../ui/animation';
import { jointMonth } from '../../domain/joint';
import { effectiveGoals, sortGoals } from '../../domain/goals';
import type { DonutArea } from '../../domain/areas';
import { ringElapsed } from '../../ui/ringStart';
import { Chevr } from '../../ui/Collapse';
import { MonthDrop } from '../../ui/MonthPicker';
import type { DropCtl } from '../../ui/MonthPicker';
import { usePullDown } from '../../ui/gestures';
import { Header } from '../../ui/Header';
import { Icon } from '../../ui/icons';
import { formatEUR, formatEUR0 } from '../../domain/money';
import { Money } from '../../ui/Money';
import { Bar, barColor } from '../../ui/Bar';
import { OnceHint } from '../../ui/OnceHint';
import { AreaSheet } from '../../ui/Donut';

type Sel = 'fix' | 'alltag' | 'spar' | 'hh' | 'inc' | null;

/**
 * Übersicht als ein großer Ring (Entwurf „alles im Ring“): außen Fixkosten, Alltag und Sparen als Anteil am Einkommen,
 * innen dünn das Haushaltskonto, in der Mitte „Noch verfügbar“ und „Heute frei“. In den vier Ecken stehen die Werte;
 * ein Tipp auf Abschnitt oder Ecke zeigt die Details in der Mitte, ein Tipp in die Mitte führt zurück.
 */
export function Overview({ onGoBackup, onGoGroup, onGoJoint, onGoIncome }: {
  onOpenTx: (t: Transaction) => void; onGoBookings: () => void; onGoBackup: () => void;
  onGoGroup: (g: 'fix' | 'alltag' | 'spar') => void; onAdd: (p?: TxPreset) => void; onGoJoint: () => void; onGoIncome: () => void;
}) {
  const { data, month, setMonth } = useStore();
  const cats = data.categories;
  const { from, to } = monthRange(month);
  // Monatszahlen nur bei Datenänderung neu rechnen (nicht bei jedem Bild der Zähl-Animation)
  const fig = useMemo(() => monthFigures(data.transactions, cats, data.settings, data.recurring, month), [data.transactions, cats, data.settings, data.recurring, month]);
  const { txs, outlook, plan, groups } = fig;
  const av = { incomeCents: fig.incomeCents, expected: fig.expected };
  const sum = { expenseCents: fig.bookedExpenseCents };
  const expenseShown = fig.expenseCents;
  const monthBudget = resolveBudget(data.budgets, month, 'month');
  const mb = monthBudget !== null ? budgetStatus(sum.expenseCents, monthBudget) : null;
  const isCurrent = month === currentMonthKey();
  const days = daysLeftInMonth(month);
  const reminder = data.settings.backupReminderDays;
  const backupAge = data.lastBackupAt ? Math.floor((Date.now() - new Date(data.lastBackupAt).getTime()) / 86_400_000) : null;
  const backupMsg = backupAge === null ? 'Noch kein Backup' : reminder > 0 && backupAge >= reminder ? 'Backup fällig' : null;
  // „Später“: Hinweis eine Woche ausblenden (nur auf diesem Gerät)
  const [snoozed, setSnoozed] = useState(() => { try { return Number(localStorage.getItem('backupSnooze') ?? 0) > Date.now(); } catch { return false; } });
  const later = () => { try { localStorage.setItem('backupSnooze', String(Date.now() + 7 * 86_400_000)); } catch { /* egal */ } setSnoozed(true); };
  const availShown = fig.availableCents;
  const freeAt = (p: string) => freeOf(data.transactions, cats, data.settings, data.recurring, p);
  const shown = useCountUp(availShown);
  const jm = jointMonth(data.transactions, data.jointTransactions, data.recurring, data.settings, month);
  const joint = jm && data.settings.joint ? { name: data.settings.joint.name, avail: jm.budgetCents + jm.carryCents, spent: jm.spentCents } : null;
  const jst = joint ? budgetStatus(joint.spent, joint.avail) : null;
  const goal = sortGoals(effectiveGoals(data.settings.savingsGoals ?? [], data.transactions))[0];
  const [sel, setSel] = useState<Sel>(null);
  // Zweiter Tipp auf den gewählten Abschnitt: Kategorie-Kreis dieses Bereichs als Pop-up
  const [drill, setDrill] = useState<DonutArea | null>(null);
  const toggle = (k: Exclude<Sel, null>) => () => {
    if (sel === k) { setDrill(k); return; }
    setSel(k); setDrill(null);
  };
  // Monatswechsel: Auswahl zurücksetzen
  useEffect(() => { setSel(null); setDrill(null); }, [month]);
  const drillTxs = useMemo(() => {
    if (drill === 'hh') return data.jointTransactions.filter((t) => t.date >= from && t.date <= to);
    // Fixkosten: Kreis aus den Vorlagen (fester Monatsbetrag), passend zur Zahl in der Übersicht
    if (drill === 'fix' && plan) return data.recurring.filter((r) => r.type === 'expense' && r.active && r.startMonth <= month && (!r.endMonth || r.endMonth >= month))
      .map((r) => ({ id: r.id, type: 'expense', amountCents: r.amountCents, categoryId: r.categoryId, date: from, description: r.name, createdAt: r.createdAt }) as Transaction);
    return txs;
  }, [drill, txs, data.jointTransactions, data.recurring, from, to, plan, month]);

  const base = av.incomeCents;
  const pct = (c: number) => (base > 0 ? `${Math.round((c / base) * 100)} %` : '–');
  const elapsed = isCurrent ? Number(todayISO().slice(8, 10)) : month < currentMonthKey() ? daysInMonth(month) : 0;
  const perDay = isCurrent && days > 0 && availShown > 0 ? Math.floor(availShown / days / 100) * 100 : null;
  const incLabel = av.expected ? 'Gehalt (erwartet)' : 'Einnahmen';

  // Ring: Anteile am Einkommen (bzw. an den Ausgaben, wenn diese höher sind)
  const total = Math.max(base, expenseShown, 1);
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
  // Nach dem Wischen: Ring-Animation läuft dort weiter, wo sie in der Vorschau begonnen hat
  const [ring0] = useState(ringElapsed);
  const dim = (k: Sel) => (sel && sel !== k ? ' dim' : '') + (sel === k ? ' on' : '');

  const open = (label: string, go: () => void, color: string) => (
    <button className="ovopen" style={{ color }} onClick={go}>{label} öffnen<Chevr /></button>
  );

  // Nach unten ziehen (überall auf der Übersicht) öffnet die Monatsauswahl – mit dem Daumen leichter als oben tippen
  const pullRef = useRef<HTMLDivElement>(null);
  // nur in der Gesamtansicht („Noch verfügbar“); die Auswahl kommt beim Ziehen von oben mit, Hintergrund wird unscharf.
  // Ist ein Bereich gewählt, bringt ein Tipp auf freie Fläche dorthin zurück.
  const [drop, setDrop] = useState(false);
  const dropCtl = useRef<DropCtl | null>(null);
  const pullD = useRef(0);
  usePullDown(pullRef, {
    start: () => { pullD.current = 0; setDrop(true); },
    move: (d) => { pullD.current = d; dropCtl.current?.move(d); },
    end: (v) => { if (dropCtl.current) dropCtl.current.end(v); else setDrop(false); }
  }, sel === null);
  useEffect(() => {
    const view = pullRef.current?.closest('.view');
    if (!view || sel === null) return;
    // nur ein echter Tipp (ohne Bewegung) zählt – nach Ziehen/Wischen meldet der Browser sonst auch ein „click“
    let dn: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { dn = { x: e.clientX, y: e.clientY }; };
    const free = (e: MouseEvent) => {
      if (dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 10) return;
      const t = e.target as Element | null;
      if (t?.closest('button,a,input,select,textarea,label,.ovseg,.sheetwrap,[role="button"],[role="dialog"]')) return;
      setSel(null); setDrill(null);
    };
    view.addEventListener('pointerdown', down as EventListener);
    view.addEventListener('click', free as EventListener);
    return () => { view.removeEventListener('pointerdown', down as EventListener); view.removeEventListener('click', free as EventListener); };
  }, [sel]);

  return (
    <div className="ovswipe" ref={pullRef}>
      <Header monthSwipe kicker={<><span className="kk">Übersicht</span>{isCurrent ? ` · noch ${days} ${days === 1 ? 'Tag' : 'Tage'}` : outlook ? ' · Ausblick' : ''}</>} title={monthLabel(month)}
        pick={{ month, onChange: setMonth, value: freeAt }} />
      {drop && <MonthDrop month={month} onChange={setMonth} value={freeAt} ctl={dropCtl} startD={pullD.current} onGone={() => setDrop(false)} />}
      {backupMsg && !snoozed && (
        <div className="bkrow">
          <button className="bkpill" role="status" onClick={onGoBackup}>
            <Icon name="warn" size={15} w={2.2} />{backupMsg} · Jetzt sichern
          </button>
          <button className="bklater" onClick={later}>Später</button>
        </div>
      )}

      <div className="hero ovring">
        <svg className={'ovsvg' + (outlook ? ' outlook' : '')} viewBox="0 0 320 320" role="img"
          aria-label={`Fixkosten ${formatEUR(groups.fix)}, Alltag ${formatEUR(groups.alltag)}, Sparen ${formatEUR(groups.spar)} von ${formatEUR(base)} ${av.expected ? 'erwartetem Gehalt' : 'Einnahmen'}${joint ? `; ${joint.name}: ${formatEUR(joint.spent)} von ${formatEUR(joint.avail)}` : ''}`}>
          {/* Beim Öffnen der Übersicht: Ring dreht leicht ein und blendet auf, Symbole erscheinen nacheinander – wie der Kreis in der Auswertung */}
          <g className="ovdrill" style={ring0 ? { animationDelay: `-${ring0}ms` } : undefined}>
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
            {segs.map((sg, i) => sg.len >= 30 && (
              <g key={'i' + sg.k} className={'dicon' + dim(sg.k)} style={{ pointerEvents: 'none', animationDelay: `${120 + i * 35 - ring0}ms` }}>
                <Icon name={sg.icon} size={20} w={2.2} x={160 + R * Math.sin(sg.mid) - 10} y={160 - R * Math.cos(sg.mid) - 10} />
              </g>
            ))}
          </g>
          </g>
        </svg>

        <div className="ovcenter">
          <button className="ovreset" data-pop={sel ? '' : undefined} aria-label={sel ? 'Zurück zur Gesamtansicht' : 'Noch verfügbar'} onClick={() => setSel(null)} />
          {!sel && <>
            <span className="ovlabel">{outlook ? 'Voraussichtlich frei' : 'Noch verfügbar'}</span>
            <span className="big" aria-live="polite"><Money cents={shown} /></span>
            <span className="ovfacts">{outlook ? `von ${formatEUR0(base)} erwarteten Einnahmen` : `von ${formatEUR0(base)} ${av.expected ? 'Gehalt (erwartet)' : 'Einnahmen'}`}</span>
            {perDay !== null && <span className="ovday">Heute frei {formatEUR0(perDay)}</span>}
          </>}
          {sel === 'fix' && <>
            <span className="ovlabel" style={{ color: 'var(--fix)' }}>Fixkosten</span>
            <span className="ovamt">{formatEUR0(groups.fix)}</span>
            <span className="ovsub">{pct(groups.fix)} vom {av.expected ? 'Gehalt' : 'Einkommen'}</span>
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
            <span className="ovlabel" style={{ color: 'var(--inc)' }}>{incLabel}</span>
            <span className="ovamt">{formatEUR0(base)}</span>
            <span className="ovsub">Ausgaben {formatEUR0(expenseShown)}</span>
            {open('Einnahmen', onGoIncome, 'var(--inc)')}
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
            <span className="ocname" style={{ color: 'var(--inc)' }}><Icon name="Gehalt" size={15} w={2.2} />{av.expected ? 'Gehalt' : 'Einnahmen'}</span>
            <span className="ocval">{formatEUR0(base)}</span>
            {(av.expected || outlook) && <span className="ocsub">erwartet</span>}
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
      <p className="ovhint">{sel ? <OnceHint id="ov-drill" key="d">Nochmal antippen für den Kategorie-Kreis · Mitte für die Gesamtansicht</OnceHint> : <OnceHint id="ov-tap" key="t">Tippe auf einen Bereich für Details</OnceHint>}</p>
      {drill && (
        <AreaSheet area={drill} label={drill === 'hh' && joint ? joint.name : undefined} txs={drillTxs} cats={cats} period={monthLabel(month)} onClose={() => setDrill(null)}
          onOpen={drill === 'hh' ? onGoJoint : drill === 'inc' ? onGoIncome : () => onGoGroup(drill)} openLabel={drill === 'hh' ? 'Konto öffnen' : drill === 'inc' ? 'Einnahmen öffnen' : undefined} />
      )}
    </div>
  );
}
