import { useState } from 'react';
import { AmountInput, Bar, Sheet } from './common';
import { useStore } from '../state/store';
import { deleteGoal, restoreGoal, saveGoal } from '../db/repo';
import { goalMonthly, goalPlan, goalSaved } from '../domain/calc';
import { runGoals } from '../db/repo';
import { currentMonthKey, monthLabel, shiftMonth } from '../domain/dates';
import { centsToGroupedInput, formatEUR0, parseCents } from '../domain/money';
import type { SavingsGoal, Transaction } from '../domain/types';

/** Sparziel mit tatsächlichem Stand: savedCents = eigener Betrag + automatische Buchungen; monthly = Betrag dieses Monats. */
export type EffGoal = SavingsGoal & { ownCents: number; autoCents: number; monthly: number };

export function effectiveGoals(goals: SavingsGoal[], txs: Transaction[], month = currentMonthKey()): EffGoal[] {
  return goals.map((g) => {
    const total = goalSaved(g, txs);
    return { ...g, savedCents: total, ownCents: g.savedCents, autoCents: total - g.savedCents, monthly: goalMonthly(g, txs, month) };
  });
}

/** Kurztext zum Stand eines Ziels: Monatsbetrag (automatisch oder nötig), erreicht oder überfällig. */
export function goalLine(g: SavingsGoal & { monthly?: number }, month = currentMonthKey()): { text: string; tone: '' | 'pos' | 'warn' } {
  const p = goalPlan(g, month);
  if (p.done) return { text: 'Ziel erreicht', tone: 'pos' };
  if (p.overdue) return { text: `Zielmonat vorbei · es fehlen ${formatEUR0(p.remainingCents)}`, tone: 'warn' };
  const m = g.monthly ?? Math.ceil(p.perMonthCents / 100) * 100;
  return g.auto === false
    ? { text: `${formatEUR0(m)} pro Monat nötig bis ${monthLabel(g.dueMonth)}`, tone: '' }
    : { text: `${formatEUR0(m)} pro Monat · automatisch bis ${monthLabel(g.dueMonth)}`, tone: '' };
}

/** Eine Zeile pro Ziel: Name, Stand, Balken, Monatsbetrag. */
export function GoalRow({ g, onOpen }: { g: EffGoal; onOpen: () => void }) {
  const p = goalPlan(g, currentMonthKey());
  const line = goalLine(g);
  return (
    <button className="hbar clickrow goalrow" onClick={onOpen} aria-label={`Sparziel ${g.name}: ${formatEUR0(g.savedCents)} von ${formatEUR0(g.targetCents)}, ${line.text}`}>
      <div className="sp"><b>{g.name}</b><span className="num">{formatEUR0(g.savedCents)} <small className="mini">/ {formatEUR0(g.targetCents)}</small></span></div>
      <Bar ratio={p.ratio} color={p.done ? 'var(--spar)' : p.overdue ? 'var(--warn)' : 'var(--spar)'} />
      <span className={'mini ' + line.tone}>{line.text}</span>
    </button>
  );
}

/** Karte „Sparziele“ mit allen Zielen und „Neues Ziel“. */
export function GoalsCard() {
  const { data } = useStore();
  const goals = sortGoals(effectiveGoals(data.settings.savingsGoals ?? [], data.transactions));
  const [edit, setEdit] = useState<EffGoal | 'new' | null>(null);
  return (
    <div className="card flush">
      <div className="sec"><h2>Sparziele</h2><button onClick={() => setEdit('new')}>Neues Ziel</button></div>
      {goals.length === 0 && <p className="note pad" style={{ paddingTop: 0 }}>Zum Beispiel „Urlaub 1.500 € bis Juni“. Die App spart den nötigen Betrag jeden Monat automatisch an – zusätzlich zur Sparrate.</p>}
      {goals.map((g) => <GoalRow key={g.id} g={g} onOpen={() => setEdit(g)} />)}
      {edit && <GoalSheet goal={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** Offene Ziele zuerst (nach Zielmonat), erreichte am Ende. */
export function sortGoals<T extends SavingsGoal>(gs: T[]): T[] {
  return [...gs].sort((a, b) => Number(a.savedCents >= a.targetCents) - Number(b.savedCents >= b.targetCents) || a.dueMonth.localeCompare(b.dueMonth) || a.name.localeCompare(b.name));
}

export function GoalSheet({ goal, onClose }: { goal: EffGoal | null; onClose: () => void }) {
  const { run, flash } = useStore();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? centsToGroupedInput(goal.targetCents) : '');
  // „Schon angespart“ = eigener Betrag; automatische Buchungen kommen dazu und werden darunter angezeigt
  const [saved, setSaved] = useState(goal && goal.ownCents > 0 ? centsToGroupedInput(goal.ownCents) : '');
  const [auto, setAuto] = useState(goal?.auto !== false);
  const autoC = goal?.autoCents ?? 0;
  const [due, setDue] = useState(goal?.dueMonth ?? shiftMonth(currentMonthKey(), 6));
  const [add, setAdd] = useState('');
  const [err, setErr] = useState('');
  // leer oder „0“ = noch nichts angespart (parseCents erlaubt nur Beträge über 0)
  const savedC = /^[\s0.,]*$/.test(saved) ? 0 : parseCents(saved);
  const targetC = parseCents(target);
  const preview = targetC !== null && savedC !== null && /^\d{4}-\d{2}$/.test(due) ? goalLine({ id: '', name, targetCents: targetC, savedCents: savedC + autoC, dueMonth: due, createdAt: '', auto }) : null;

  async function save(extra = 0) {
    if (!name.trim()) return setErr('Bitte gib einen Namen ein.');
    if (targetC === null) return setErr('Bitte gib einen Zielbetrag ein.');
    if (savedC === null) return setErr('Bitte gib einen gültigen angesparten Betrag ein.');
    setErr('');
    const r = await run(async (db) => {
      const g = await saveGoal(db, goal?.id ?? null, { name, targetCents: targetC, savedCents: (savedC ?? 0) + extra, dueMonth: due, auto });
      await runGoals(db, currentMonthKey());
      return g;
    }, extra ? 'Betrag hinzugefügt' : 'Sparziel gespeichert');
    if (r) onClose();
  }
  return (
    <Sheet title={goal ? 'Sparziel' : 'Neues Sparziel'} onClose={onClose}>
      <div className="card flush">
        <label className="field"><span>Name</span><input value={name} maxLength={40} placeholder="z. B. Urlaub" onChange={(e) => setName(e.target.value)} /></label>
        <label className="field tight"><span>Zielbetrag (€)</span><AmountInput label="Zielbetrag" value={target} onChange={setTarget} placeholder="1.500" /></label>
        <label className="field tight"><span>Schon angespart (€)</span><AmountInput label="Schon angespart" value={saved} onChange={setSaved} placeholder="0" /></label>
        <label className="field"><span>Bis</span><input type="month" value={due} min={currentMonthKey()} aria-label="Zielmonat" onChange={(e) => setDue(e.target.value)} /></label>
        <label className="field"><span>Automatisch ansparen</span><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} aria-label="Automatisch ansparen" /></label>
      </div>
      <p className="note" style={{ marginTop: -6 }}>{auto
        ? 'Jeden Monat bis zum Zielmonat als Sparen gebucht – zusätzlich zur Sparrate – und von „Noch verfügbar“ abgezogen.'
        : 'Nur beobachten: Es wird nichts gebucht, den Stand pflegst du über „Einzahlen“.'}{autoC > 0 ? ` Bisher automatisch gebucht: ${formatEUR0(autoC)}.` : ''}</p>
      {preview && targetC !== null && <div className={'pill goalprev ' + preview.tone}>{preview.text}</div>}
      {err && <div className="err-text" role="alert">{err}</div>}
      <button className="btn cta" onClick={() => void save()}>Speichern</button>
      {goal && (
        <div className="card flush">
          <label className="field tight"><span>Einzahlen (€)</span><AmountInput label="Betrag einzahlen" value={add} onChange={setAdd} placeholder="100" /></label>
          <div className="pad"><button className="btn sec2" disabled={!add || parseCents(add) === null} onClick={() => void save(parseCents(add) ?? 0)}>Zum angesparten Betrag hinzufügen</button></div>
        </div>
      )}
      {goal && <button className="btn danger" onClick={async () => {
        const g = await run((db) => deleteGoal(db, goal.id));
        if (g) { onClose(); flash('Sparziel gelöscht', 'ok', { label: 'Rückgängig', run: () => { void run((db) => restoreGoal(db, g), 'Wiederhergestellt'); } }); }
      }}>Sparziel löschen</button>}
    </Sheet>
  );
}
