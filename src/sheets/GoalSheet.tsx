import { useState } from 'react';
import { goalLine } from '../domain/goals';
import type { EffGoal } from '../domain/goals';
import { useStore } from '../state/store';
import { centsToGroupedInput, formatEUR0, parseCents } from '../domain/money';
import { currentMonthKey, shiftMonth } from '../domain/dates';
import { deleteGoal, restoreGoal, runGoals, saveGoal } from '../data/goals';
import { Sheet } from '../ui/Sheet';
import { AmountInput } from '../ui/Money';

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
