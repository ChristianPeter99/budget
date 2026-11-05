import { useState } from 'react';
import type { ReactNode } from 'react';
import { AmountInput, Empty, Header, Sheet } from './common';
import { useStore } from '../state/store';
import { isHouseholdCat } from '../domain/types';
import { deleteRecurring, runRecurring, saveRecurring, saveSalary } from '../db/repo';
import { currentMonthKey, isValidMonthKey, shiftMonth } from '../domain/dates';
import { categoryName, childrenOf } from '../domain/calc';
import { centsToGroupedInput, formatEUR, parseCents } from '../domain/money';
import type { CatGroup, Recurring, TxType } from '../domain/types';
import { monthName } from './Fixkosten';

const groupOf = (cats: ReturnType<typeof useStore>['data']['categories'], r: Recurring): CatGroup | undefined => cats.find((c) => c.id === r.categoryId)?.group;

/** Tag im Monat: beim Tippen nur die Zahl („1“), sonst lesbar als „1. des Monats“. */
function DayInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [focus, setFocus] = useState(false);
  const n = Number(value);
  const shown = !focus && Number.isInteger(n) && n >= 1 && n <= 28 ? `${n}. des Monats` : value;
  return <input inputMode="numeric" aria-label={label} value={shown} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))} />;
}

function RecRow({ r, onClick }: { r: Recurring; onClick: () => void }) {
  const { data } = useStore();
  const yearly = r.interval === 'yearly' && r.yearlyCents;
  return (
    <button className="item" onClick={onClick}>
      <span className="mid">
        <b style={{ opacity: r.active ? 1 : 0.5 }}>{r.name}{r.active ? '' : ' (pausiert)'}</b>
        <small>{categoryName(data.categories, r.categoryId)} · {yearly ? `jährlich ${formatEUR(r.yearlyCents!)}${r.dueMonth ? `, fällig im ${monthName(r.dueMonth)}` : ''}` : `monatlich am ${r.day}.`}</small>
      </span>
      <span className="amt">{yearly ? '≈ ' : r.type === 'income' ? '+' : ''}{formatEUR(r.amountCents)}</span>
    </button>
  );
}

export function RecurringPage({ back }: { back: ReactNode }) {
  const { data, run, month } = useStore();
  const cats = data.categories;
  const [edit, setEdit] = useState<{ rec: Recurring | null; group?: CatGroup } | null>(null);
  const salaryRec = data.recurring.find((r) => r.type === 'income' && r.active && cats.find((c) => c.id === r.categoryId)?.name === 'Gehalt')
    ?? data.recurring.find((r) => r.type === 'income' && r.active);
  const [salary, setSalary] = useState(centsToGroupedInput(salaryRec?.amountCents ?? data.settings.expectedIncomeCents));
  const [day, setDay] = useState(String(salaryRec?.day ?? 1));
  const [salStart, setSalStart] = useState(salaryRec?.startMonth ?? currentMonthKey());
  const [err, setErr] = useState('');

  const sorted = [...data.recurring].sort((a, b) => b.amountCents - a.amountCents);
  const fix = sorted.filter((r) => r.type === 'expense' && groupOf(cats, r) === 'fix');
  const spar = sorted.filter((r) => r.type === 'expense' && groupOf(cats, r) === 'spar');
  const other = sorted.filter((r) => r.id !== salaryRec?.id && !fix.includes(r) && !spar.includes(r));
  const fixSum = fix.filter((r) => r.active).reduce((a, r) => a + r.amountCents, 0);

  async function saveSal() {
    const c = parseCents(salary);
    const d = Number(day);
    if (c === null) return setErr('Bitte gib einen gültigen Betrag ein.');
    if (!Number.isInteger(d) || d < 1 || d > 28) return setErr('Der Tag muss zwischen 1 und 28 liegen.');
    if (!isValidMonthKey(salStart)) return setErr('Bitte wähle, ab welchem Monat das Gehalt gilt.');
    setErr('');
    const now = currentMonthKey();
    await run(async (db) => { await saveSalary(db, c, d, now, salStart); await runRecurring(db, now); return true; }, 'Gehalt gespeichert');
  }

  return (
    <>
      {back}
      <Header title="Wiederkehrend" right={<button className="pillbtn" onClick={() => setEdit({ rec: null })}>Neu</button>} />
      <div className="card flush">
        <div className="sec"><h2>Gehalt</h2></div>
        <label className="field tight"><span>Monatlich verfügbar (€)</span><AmountInput label="Gehalt pro Monat" value={salary} onChange={setSalary} /></label>
        <label className="field"><span>Gilt ab</span><input type="month" value={salStart} max={shiftMonth(currentMonthKey(), 24)} aria-label="Gehalt gilt ab (Monat)" onChange={(e) => setSalStart(e.target.value)} /></label>
        <label className="field"><span>Eingang am</span><DayInput value={day} onChange={setDay} label="Tag des Gehaltseingangs" /></label>
        <div className="pad stack">
          {err && <div className="err-text" role="alert">{err}</div>}
          <button className="btn sec2" onClick={saveSal}>Gehalt speichern</button>
          <span className="mini">Wird jeden Monat automatisch als Einnahme gebucht.</span>
        </div>
      </div>

      <div className="card flush">
        <div className="sec"><h2>Fixkosten</h2><button onClick={() => setEdit({ rec: null, group: 'fix' })}>+ Neu</button></div>
        <div className="kv"><span className="cap">Summe pro Monat</span><b>{formatEUR(fixSum)}</b></div>
        {fix.length === 0 && <Empty>Keine Fixkosten.</Empty>}
        {fix.map((r) => <RecRow key={r.id} r={r} onClick={() => setEdit({ rec: r, group: 'fix' })} />)}
      </div>

      {spar.length > 0 && (
        <div className="card flush">
          <div className="sec"><h2>Sparen</h2></div>
          {spar.map((r) => <RecRow key={r.id} r={r} onClick={() => setEdit({ rec: r })} />)}
        </div>
      )}
      {other.length > 0 && (
        <div className="card flush">
          <div className="sec"><h2>Weitere</h2></div>
          {other.map((r) => <RecRow key={r.id} r={r} onClick={() => setEdit({ rec: r })} />)}
        </div>
      )}
      <p className="note">Buchungen werden beim Öffnen der App für alle fälligen Monate genau einmal erzeugt. Jährliche Kosten werden durch 12 geteilt und monatlich gebucht; Rest-Cent werden so verteilt, dass die Jahressumme exakt stimmt. Änderungen gelten für künftige Monate.</p>
      {edit && <RecurringSheet rec={edit.rec} presetGroup={edit.group} month={month} onClose={() => setEdit(null)} run={run} />}
    </>
  );
}

export function RecurringSheet({ rec, onClose, run, presetGroup }: { rec: Recurring | null; month?: string; onClose: () => void; run: ReturnType<typeof useStore>['run']; presetGroup?: CatGroup }) {
  const { data } = useStore();
  const [name, setName] = useState(rec?.name ?? '');
  const [type, setType] = useState<TxType>(rec?.type ?? 'expense');
  const [interval, setInterval] = useState<'monthly' | 'yearly'>(rec?.interval === 'yearly' ? 'yearly' : 'monthly');
  const [amount, setAmount] = useState(rec ? centsToGroupedInput(rec.interval === 'yearly' && rec.yearlyCents ? rec.yearlyCents : rec.amountCents) : '');
  const [cat, setCat] = useState(rec?.categoryId ?? '');
  const [day, setDay] = useState(String(rec?.day ?? 1));
  const [active, setActive] = useState(rec?.active ?? true);
  const [due, setDue] = useState(rec?.dueMonth ? String(rec.dueMonth) : '');
  const [start, setStart] = useState(rec?.startMonth ?? currentMonthKey());
  const [notice, setNotice] = useState(rec?.notice ?? '');
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const opts = data.categories.filter((c) => c.kind === type && !isHouseholdCat(c) && (!c.archived || c.id === cat) && (!presetGroup || c.group === presetGroup)
    && (c.parentId !== null || childrenOf(data.categories, c.id).length === 0));
  const cents = parseCents(amount);
  const yearly = type === 'expense' && interval === 'yearly';

  async function save() {
    const d = Number(day);
    if (!name.trim()) return setErr('Bitte gib einen Namen ein.');
    if (cents === null) return setErr('Bitte gib einen gültigen Betrag ein.');
    if (!opts.some((c) => c.id === cat)) return setErr('Bitte wähle eine Kategorie.');
    if (!Number.isInteger(d) || d < 1 || d > 28) return setErr('Der Tag muss zwischen 1 und 28 liegen.');
    if (!isValidMonthKey(start)) return setErr('Bitte wähle, ab welchem Monat die Buchung gilt.');
    // „Gilt ab“: ab diesem Monat wird jeden Monat gebucht – fehlende vergangene Monate werden nachgebucht,
    // sofern die Ausgabe dort noch nicht gebucht ist.
    const now = currentMonthKey();
    const r = await run(async (db) => {
      const saved = await saveRecurring(db, rec?.id ?? null, {
        name: name.trim(), type, amountCents: cents, interval: yearly ? 'yearly' : 'monthly', categoryId: cat, startMonth: start, day: d, active,
        dueMonth: yearly && due ? Number(due) : null, notice: type === 'expense' ? notice : null
      }, now);
      await runRecurring(db, now);
      return saved;
    }, 'Gespeichert');
    if (r) onClose();
  }
  return (
    <Sheet title={rec ? 'Vorlage' : presetGroup === 'fix' ? 'Neue Fixkosten' : 'Neue Vorlage'} onClose={onClose}>
      {presetGroup !== 'fix' && (
        <div className="fseg"><button className={type === 'expense' ? 'on' : ''} onClick={() => { setType('expense'); setCat(''); }}>Ausgabe</button><button className={type === 'income' ? 'on' : ''} onClick={() => { setType('income'); setCat(''); setInterval('monthly'); }}>Einnahme</button></div>
      )}
      {type === 'expense' && (
        <div className="fseg"><button className={interval === 'monthly' ? 'on' : ''} onClick={() => setInterval('monthly')}>Monatlich</button><button className={interval === 'yearly' ? 'on' : ''} onClick={() => setInterval('yearly')}>Jährlich</button></div>
      )}
      <div className="card flush">
        <label className="field"><span>Name</span><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={yearly ? 'z. B. Kfz-Versicherung' : ''} /></label>
        <label className="field tight"><span>{yearly ? 'Jahresbetrag (€)' : 'Betrag pro Monat (€)'}</span><AmountInput label="Betrag" value={amount} onChange={setAmount} placeholder="0,00" /></label>
        {yearly && cents !== null && <div className="kv"><span className="cap">wird monatlich angerechnet</span><b>≈ {formatEUR(Math.round(cents / 12))}</b></div>}
        {yearly && (
          <label className="field"><span>Fällig im</span>
            <select value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fälligkeitsmonat">
              <option value="">nicht angegeben</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Kategorie</span><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Wählen …</option>{opts.map((c) => <option key={c.id} value={c.id}>{categoryName(data.categories, c.id)}</option>)}</select></label>
        <label className="field"><span>Gilt ab</span><input type="month" value={start} max={shiftMonth(currentMonthKey(), 24)} aria-label="Gilt ab (Monat)" onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field"><span>{yearly ? 'Buchung am' : 'Tag im Monat'}</span><DayInput value={day} onChange={setDay} label={yearly ? 'Buchung am (Tag)' : 'Tag im Monat'} /></label>
        {type === 'expense' && <label className="field"><span>Kündigungsfrist</span><input value={notice} maxLength={80} placeholder="optional, z. B. 3 Monate" aria-label="Kündigungsfrist (optional)" onChange={(e) => setNotice(e.target.value)} /></label>}
        <label className="field"><span>Aktiv</span><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /></label>
      </div>
      {err && <div className="err-text" role="alert">{err}</div>}
      <button className="btn cta" onClick={save}>Speichern</button>
      {rec && !confirm && <button className="btn danger" onClick={() => setConfirm(true)}>Vorlage löschen</button>}
      {rec && confirm && <button className="btn danger" onClick={async () => { if (await run((db) => deleteRecurring(db, rec.id).then(() => true), 'Vorlage gelöscht')) onClose(); }}>Ja, löschen (bisherige Buchungen bleiben)</button>}
    </Sheet>
  );
}
