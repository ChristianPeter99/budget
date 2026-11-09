import { useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../state/store';
import { centsToGroupedInput, formatEUR, parseCents } from '../../domain/money';
import { jointMonth } from '../../domain/joint';
import { currentMonthKey, monthLabel } from '../../domain/dates';
import { disableJoint, ensureHouseholdCategories, resetJointCarry, saveJointSetup } from '../../data/joint';
import { runRecurring } from '../../data/recurring';
import { Header } from '../../ui/Header';
import { AmountInput } from '../../ui/Money';
import { Chevr } from '../../ui/Collapse';

/** Einrichtung des gemeinsamen Kontos (Mehr › Gemeinsames Konto). */
export function JointPage({ back }: { back: ReactNode }) {
  const { data, run } = useStore();
  const j = data.settings.joint;
  const tpl = j?.categoryId ? data.recurring.find((r) => r.categoryId === j.categoryId) : undefined;
  const [name, setName] = useState(j?.name ?? 'Haushaltskonto');
  const [partner, setPartner] = useState(j?.partnerName ?? '');
  const [mine, setMine] = useState(tpl ? centsToGroupedInput(tpl.amountCents) : '');
  const [theirs, setTheirs] = useState(j ? centsToGroupedInput(j.partnerDefaultCents) : '');
  const [day, setDay] = useState(String(tpl?.day ?? 1));
  const [err, setErr] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const jm = jointMonth(data.transactions, data.jointTransactions, data.recurring, data.settings, currentMonthKey());
  const my = parseCents(mine), th = theirs.trim() === '' ? 0 : parseCents(theirs);

  async function save() {
    const d = Number(day);
    if (my === null) return setErr('Bitte gib deinen monatlichen Beitrag ein.');
    if (th === null) return setErr('Bitte gib einen gültigen Beitrag der anderen Person ein.');
    if (!Number.isInteger(d) || d < 1 || d > 28) return setErr('Der Tag muss zwischen 1 und 28 liegen.');
    setErr('');
    await run(async (db) => { await saveJointSetup(db, { name, partnerName: partner, myCents: my, day: d, partnerDefaultCents: th }, currentMonthKey()); await runRecurring(db, currentMonthKey()); await ensureHouseholdCategories(db); return true; }, j?.enabled ? 'Gespeichert' : 'Gemeinsames Konto eingerichtet');
  }

  return (
    <>
      <div className="toprow">{back}<button className="lnk toplnk" onClick={save}>{j?.enabled ? 'Speichern' : 'Einrichten'}</button></div>
      <Header title="Gemeinsames Konto" />
      <p className="mini pagenote">Ein Konto, auf das ihr beide einzahlt – Einkäufe davon zählen nur dort.</p>
      <div className="card flush">
        <label className="field"><span>Name</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Andere Person</span><input aria-label="Name der anderen Person" value={partner} maxLength={40} placeholder="optional" onChange={(e) => setPartner(e.target.value)} /></label>
      </div>
      <div className="cap seccap">Beitrag pro Monat</div>
      <div className="card flush">
        <label className="field"><span>Ich</span><AmountInput label="Mein Beitrag pro Monat" value={mine} onChange={setMine} placeholder="0 €" /></label>
        <label className="field"><span>{partner.trim() || 'Andere Person'}</span><AmountInput label="Beitrag der anderen Person pro Monat" value={theirs} onChange={setTheirs} placeholder="0 €" /></label>
        <label className="field"><span>Überweisung am</span>
          <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Tag der Überweisung">
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}. des Monats</option>)}
          </select>
        </label>
      </div>
      <div className="sp budrow"><span className="cap">Budget pro Monat</span><b className="num">{formatEUR((my ?? 0) + (th ?? 0))}</b></div>
      {err && <div className="err-text" role="alert">{err}</div>}
      {j?.enabled && jm && (
        <>
          <div className="cap seccap">Übertrag</div>
          <div className="card flush">
            <div className="kv"><span>Aus Vormonaten</span><b className={jm.carryCents < 0 ? 'neg' : ''}>{jm.carryCents < 0 ? '−' : '+'}{formatEUR(Math.abs(jm.carryCents))}</b></div>
            <div className="kv"><span>Verfügbar {monthLabel(currentMonthKey())}</span><b>{formatEUR(jm.availableCents)}</b></div>
            {!confirmReset && <button className="srow" onClick={() => setConfirmReset(true)}>Übertrag neu starten<Chevr /></button>}
          </div>
          {confirmReset && (
            <div className="card stack">
              <span className="cap">Weicht der Übertrag vom echten Kontostand ab, beginnt er ab {monthLabel(currentMonthKey())} bei 0 €.</span>
              <button className="btn" onClick={async () => { if (await run((db) => resetJointCarry(db, currentMonthKey()).then(() => true), 'Übertrag neu gestartet')) setConfirmReset(false); }}>Ja, ab {monthLabel(currentMonthKey())} bei 0 € beginnen</button>
              <button className="btn sec2" onClick={() => setConfirmReset(false)}>Abbrechen</button>
            </div>
          )}
        </>
      )}
      {j?.enabled && !confirmOff && <button className="btn danger" onClick={() => setConfirmOff(true)}>Gemeinsames Konto ausschalten</button>}
      {j?.enabled && confirmOff && (
        <div className="card stack">
          <span className="cap">Bisherige Buchungen bleiben erhalten, dein Beitrag wird ab sofort nicht mehr gebucht.</span>
          <button className="btn danger" onClick={async () => { if (await run((db) => disableJoint(db).then(() => true), 'Ausgeschaltet')) setConfirmOff(false); }}>Ja, ausschalten</button>
          <button className="btn sec2" onClick={() => setConfirmOff(false)}>Abbrechen</button>
        </div>
      )}
    </>
  );
}
