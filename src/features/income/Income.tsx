import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CatGroup, Recurring } from '../../domain/types';
import { useStore } from '../../state/store';
import { categoryName } from '../../domain/categories';
import { centsToGroupedInput, formatEUR, parseCents } from '../../domain/money';
import { currentMonthKey, isValidMonthKey, monthName, shiftMonth } from '../../domain/dates';
import { DayInput, RecurringSheet, groupOf } from '../../sheets/RecurringSheet';
import { runRecurring, saveSalary } from '../../data/recurring';
import { Header } from '../../ui/Header';
import { Icon } from '../../ui/icons';
import { AmountInput } from '../../ui/Money';

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
  const [edit, setEdit] = useState<{ rec: Recurring | null; group?: CatGroup; income?: boolean } | null>(null);
  const salaryRec = data.recurring.find((r) => r.type === 'income' && r.active && cats.find((c) => c.id === r.categoryId)?.name === 'Gehalt')
    ?? data.recurring.find((r) => r.type === 'income' && r.active);
  const [salary, setSalary] = useState(centsToGroupedInput(salaryRec?.amountCents ?? data.settings.expectedIncomeCents));
  const [day, setDay] = useState(String(salaryRec?.day ?? 1));
  const [salStart, setSalStart] = useState(salaryRec?.startMonth ?? currentMonthKey());
  const [err, setErr] = useState('');

  const sorted = [...data.recurring].sort((a, b) => b.amountCents - a.amountCents);
  const fix = sorted.filter((r) => r.type === 'expense' && groupOf(cats, r) === 'fix');
  const spar = sorted.filter((r) => r.type === 'expense' && groupOf(cats, r) === 'spar');
  // Sparrate (Sparen & Depot) und Beitrag zum gemeinsamen Konto (Gemeinsames Konto) werden dort gepflegt
  const jointCat = data.settings.joint?.categoryId;
  const other = sorted.filter((r) => r.id !== salaryRec?.id && !fix.includes(r) && !spar.includes(r) && r.categoryId !== jointCat);

  // Gehalt speichert sich selbst, kurz nachdem du etwas eingetragen hast (kein Speichern-Knopf)
  const savedSal = useRef(`${salaryRec?.amountCents ?? data.settings.expectedIncomeCents}|${salaryRec?.day ?? 1}|${salaryRec?.startMonth ?? currentMonthKey()}`);
  useEffect(() => {
    const c = parseCents(salary);
    const d = Number(day);
    const t = setTimeout(() => {
      if (salary.trim() === '' || day.trim() === '') return;
      if (c === null) return setErr('Bitte gib einen gültigen Betrag ein.');
      if (!Number.isInteger(d) || d < 1 || d > 28) return setErr('Der Tag muss zwischen 1 und 28 liegen.');
      if (!isValidMonthKey(salStart)) return setErr('Bitte wähle, ab welchem Monat das Gehalt gilt.');
      setErr('');
      const sig = `${c}|${d}|${salStart}`;
      if (sig === savedSal.current) return;
      savedSal.current = sig;
      const now = currentMonthKey();
      void run(async (db) => { await saveSalary(db, c, d, now, salStart); await runRecurring(db, now); return true; }, 'Gehalt gespeichert');
    }, 900);
    return () => clearTimeout(t);
  }, [salary, day, salStart, run]);

  return (
    <>
      {back}
      <Header kicker={<span className="kk">Wiederkehrende</span>} title="Einnahmen" right={<button className="ib" aria-label="Neue Einnahme" onClick={() => setEdit({ rec: null, income: true })}><Icon name="plus" size={22} w={2.2} /></button>} />
      <div className="cap seccap">Gehalt</div>
      <div className="card flush">
        <label className="field"><span>Betrag pro Monat</span><AmountInput label="Gehalt pro Monat" value={salary} onChange={setSalary} placeholder="0 €" /></label>
        <label className="field"><span>Gilt ab</span><input type="month" value={salStart} max={shiftMonth(currentMonthKey(), 24)} aria-label="Gehalt gilt ab (Monat)" onChange={(e) => setSalStart(e.target.value)} /></label>
        <label className="field"><span>Eingang am</span><DayInput value={day} onChange={setDay} label="Tag des Gehaltseingangs" /></label>
      </div>
      {err && <div className="err-text" role="alert">{err}</div>}
      <p className="mini pagenote">Speichert sich selbst und wird jeden Monat gebucht.</p>
      {([['Weitere Einnahmen', other.filter((r) => r.type === 'income')], ['Sonstige wiederkehrende', other.filter((r) => r.type !== 'income')]] as const).map(([h, list]) => list.length > 0 && (
        <div key={h} className="stack" style={{ gap: 0 }}>
          <div className="cap seccap">{h}</div>
          <div className="card flush">
            {list.map((r) => <RecRow key={r.id} r={r} onClick={() => setEdit({ rec: r })} />)}
          </div>
        </div>
      ))}
      {edit && <RecurringSheet rec={edit.rec} presetGroup={edit.group} incomeOnly={edit.income} month={month} onClose={() => setEdit(null)} run={run} />}
    </>
  );
}
