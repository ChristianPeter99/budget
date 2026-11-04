import { useState } from 'react';
import type { ReactNode } from 'react';
import { AmountInput, Header } from './common';
import { useStore } from '../state/store';
import { disableJoint, ensureHouseholdCategories, resetJointCarry, runRecurring, saveJointSetup } from '../db/repo';
import { currentMonthKey, monthLabel } from '../domain/dates';
import { jointMonth } from '../domain/calc';
import { centsToGroupedInput, formatEUR, parseCents } from '../domain/money';

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
      {back}
      <Header title="Gemeinsames Konto" />
      <p className="note">Für ein gemeinsames Ausgabenkonto, z. B. für Lebensmittel. Dein monatlicher Beitrag wird als Alltags-Ausgabe gebucht und zählt in dein Budget. Einkäufe vom gemeinsamen Konto zählen nur dort, nie in deinem „Noch verfügbar“.</p>
      <div className="card flush">
        <label className="field"><span>Name</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Andere Person</span><input aria-label="Name der anderen Person" value={partner} maxLength={40} placeholder="optional" onChange={(e) => setPartner(e.target.value)} /></label>
        <label className="field"><span>Mein Beitrag / Monat (€)</span><AmountInput label="Mein Beitrag pro Monat" value={mine} onChange={setMine} placeholder="0,00" /></label>
        <label className="field"><span>Überweisung am</span><input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Tag der Überweisung" /></label>
        <label className="field"><span>Beitrag {partner.trim() || 'andere Person'} (€)</span><AmountInput label="Beitrag der anderen Person pro Monat" value={theirs} onChange={setTheirs} placeholder="0,00" /></label>
        {my !== null && th !== null && <div className="kv"><span className="cap">Budget pro Monat</span><b>{formatEUR(my + th)}</b></div>}
      </div>
      {err && <div className="err-text" role="alert">{err}</div>}
      <button className="btn" onClick={save}>{j?.enabled ? 'Speichern' : 'Einrichten'}</button>
      <p className="note">Weicht ein Beitrag in einem Monat ab, tippe im Alltag (Ansicht „{name || 'Gemeinsam'}“) auf die Zeile mit den Einzahlungen. Änderungen am eigenen Beitrag gelten ab dem nächsten Monat; den laufenden Monat änderst du direkt an der Buchung.</p>
      {j?.enabled && jm && (
        <div className="card flush">
          <div className="sec"><h2>Übertrag</h2></div>
          <div className="kv"><span>Aus Vormonaten</span><b className={jm.carryCents < 0 ? 'neg' : ''}>{jm.carryCents < 0 ? '−' : '+'}{formatEUR(Math.abs(jm.carryCents))}</b></div>
          <div className="kv"><span>Verfügbar {monthLabel(currentMonthKey())}</span><b>{formatEUR(jm.availableCents)}</b></div>
          <div className="pad stack">
            <span className="mini">Was in einem Monat übrig bleibt, steht im nächsten zusätzlich zur Verfügung{j.startMonth ? ` (gezählt ab ${monthLabel(j.startMonth)})` : ''}. Weicht das vom echten Kontostand ab, kannst du den Übertrag ab diesem Monat neu beginnen.</span>
            {!confirmReset && <button className="btn sec2" onClick={() => setConfirmReset(true)}>Übertrag ab diesem Monat neu starten</button>}
            {confirmReset && (
              <>
                <button className="btn" onClick={async () => { if (await run((db) => resetJointCarry(db, currentMonthKey()).then(() => true), 'Übertrag neu gestartet')) setConfirmReset(false); }}>Ja, ab {monthLabel(currentMonthKey())} bei 0 € beginnen</button>
                <button className="btn sec2" onClick={() => setConfirmReset(false)}>Abbrechen</button>
              </>
            )}
          </div>
        </div>
      )}
      {j?.enabled && !confirmOff && <button className="btn danger" onClick={() => setConfirmOff(true)}>Gemeinsames Konto ausschalten</button>}
      {j?.enabled && confirmOff && (
        <div className="card stack">
          <span className="cap">Bisherige Buchungen bleiben erhalten, dein Beitrag wird ab sofort nicht mehr gebucht. Du kannst es jederzeit wieder einrichten.</span>
          <button className="btn danger" onClick={async () => { if (await run((db) => disableJoint(db).then(() => true), 'Ausgeschaltet')) setConfirmOff(false); }}>Ja, ausschalten</button>
          <button className="btn sec2" onClick={() => setConfirmOff(false)}>Abbrechen</button>
        </div>
      )}
    </>
  );
}
