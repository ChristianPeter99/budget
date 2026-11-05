import { useState } from 'react';
import { AmountInput, Bar, Sheet } from './common';
import { useStore } from '../state/store';
import { deleteGoal, restoreGoal, saveGoal } from '../db/repo';
import { goalPlan } from '../domain/calc';
import { currentMonthKey, monthLabel, shiftMonth } from '../domain/dates';
import { centsToGroupedInput, formatEUR0, parseCents } from '../domain/money';
import type { SavingsGoal } from '../domain/types';

/** Kurztext zum Stand eines Ziels: nötige Rate, erreicht oder überfällig. */
export function goalLine(g: SavingsGoal, month = currentMonthKey()): { text: string; tone: '' | 'pos' | 'warn' } {
  const p = goalPlan(g, month);
  if (p.done) return { text: 'Ziel erreicht', tone: 'pos' };
  if (p.overdue) return { text: `Zielmonat vorbei · es fehlen ${formatEUR0(p.remainingCents)}`, tone: 'warn' };
  return { text: `${formatEUR0(Math.ceil(p.perMonthCents / 100) * 100)} pro Monat bis ${monthLabel(g.dueMonth)}`, tone: '' };
}

/** Eine Zeile pro Ziel: Name, Stand, Balken, nötige Monatsrate. */
export function GoalRow({ g, onOpen }: { g: SavingsGoal; onOpen: () => void }) {
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
  const goals = sortGoals(data.settings.savingsGoals ?? []);
  const [edit, setEdit] = useState<SavingsGoal | 'new' | null>(null);
  return (
    <div className="card flush">
      <div className="sec"><h2>Sparziele</h2><button onClick={() => setEdit('new')}>Neues Ziel</button></div>
      {goals.length === 0 && <p className="note pad" style={{ paddingTop: 0 }}>Zum Beispiel „Urlaub 1.500 € bis Juni“. Die App rechnet aus, wie viel du dafür pro Monat zurücklegen musst.</p>}
      {goals.map((g) => <GoalRow key={g.id} g={g} onOpen={() => setEdit(g)} />)}
      {edit && <GoalSheet goal={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** Offene Ziele zuerst (nach Zielmonat), erreichte am Ende. */
export function sortGoals(gs: SavingsGoal[]): SavingsGoal[] {
  return [...gs].sort((a, b) => Number(a.savedCents >= a.targetCents) - Number(b.savedCents >= b.targetCents) || a.dueMonth.localeCompare(b.dueMonth) || a.name.localeCompare(b.name));
}

export function GoalSheet({ goal, onClose }: { goal: SavingsGoal | null; onClose: () => void }) {
  const { run, flash } = useStore();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? centsToGroupedInput(goal.targetCents) : '');
  const [saved, setSaved] = useState(goal && goal.savedCents > 0 ? centsToGroupedInput(goal.savedCents) : '');
  const [due, setDue] = useState(goal?.dueMonth ?? shiftMonth(currentMonthKey(), 6));
  const [add, setAdd] = useState('');
  const [err, setErr] = useState('');
  // leer oder „0“ = noch nichts angespart (parseCents erlaubt nur Beträge über 0)
  const savedC = /^[\s0.,]*$/.test(saved) ? 0 : parseCents(saved);
  const targetC = parseCents(target);
  const preview = targetC !== null && savedC !== null && /^\d{4}-\d{2}$/.test(due) ? goalLine({ id: '', name, targetCents: targetC, savedCents: savedC, dueMonth: due, createdAt: '' }) : null;

  async function save(extra = 0) {
    if (!name.trim()) return setErr('Bitte gib einen Namen ein.');
    if (targetC === null) return setErr('Bitte gib einen Zielbetrag ein.');
    if (savedC === null) return setErr('Bitte gib einen gültigen angesparten Betrag ein.');
    setErr('');
    const r = await run((db) => saveGoal(db, goal?.id ?? null, { name, targetCents: targetC, savedCents: (savedC ?? 0) + extra, dueMonth: due }), extra ? 'Betrag hinzugefügt' : 'Sparziel gespeichert');
    if (r) onClose();
  }
  return (
    <Sheet title={goal ? 'Sparziel' : 'Neues Sparziel'} onClose={onClose}>
      <div className="card flush">
        <label className="field"><span>Name</span><input value={name} maxLength={40} placeholder="z. B. Urlaub" onChange={(e) => setName(e.target.value)} /></label>
        <label className="field tight"><span>Zielbetrag (€)</span><AmountInput label="Zielbetrag" value={target} onChange={setTarget} placeholder="1.500" /></label>
        <label className="field tight"><span>Schon angespart (€)</span><AmountInput label="Schon angespart" value={saved} onChange={setSaved} placeholder="0" /></label>
        <label className="field"><span>Bis</span><input type="month" value={due} min={currentMonthKey()} aria-label="Zielmonat" onChange={(e) => setDue(e.target.value)} /></label>
      </div>
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
