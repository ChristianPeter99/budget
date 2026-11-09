import { useState } from 'react';
import { isHouseholdCat } from '../domain/types';
import type { CatGroup, Recurring, TxType } from '../domain/types';
import { useStore } from '../state/store';
import { centsToInput, formatAmountTyping, formatEUR, parseCents, pressKey } from '../domain/money';
import { currentMonthKey, isValidMonthKey, monthName, shiftMonth } from '../domain/dates';
import { childrenOf } from '../domain/categories';
import { deleteRecurring, runRecurring, saveRecurring } from '../data/recurring';
import { Sheet } from '../ui/Sheet';
import { KeyDock } from '../ui/KeyDock';

export const groupOf = (cats: ReturnType<typeof useStore>['data']['categories'], r: Recurring): CatGroup | undefined => cats.find((c) => c.id === r.categoryId)?.group;

/** Tag im Monat: beim Tippen nur die Zahl („1“), sonst lesbar als „1. des Monats“. */
export function DayInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [focus, setFocus] = useState(false);
  const n = Number(value);
  const shown = !focus && Number.isInteger(n) && n >= 1 && n <= 28 ? `${n}. des Monats` : value;
  return <input inputMode="numeric" aria-label={label} value={shown} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))} />;
}

export function RecurringSheet({ rec, onClose, run, presetGroup, incomeOnly }: { rec: Recurring | null; month?: string; onClose: () => void; run: ReturnType<typeof useStore>['run']; presetGroup?: CatGroup; incomeOnly?: boolean }) {
  const { data } = useStore();
  const [name, setName] = useState(rec?.name ?? '');
  const [type, setType] = useState<TxType>(rec?.type ?? (incomeOnly ? 'income' : 'expense'));
  const [interval, setInterval] = useState<'monthly' | 'yearly'>(rec?.interval === 'yearly' ? 'yearly' : 'monthly');
  const [amount, setAmount] = useState(rec ? centsToInput(rec.interval === 'yearly' && rec.yearlyCents ? rec.yearlyCents : rec.amountCents) : '');
  const [padOpen, setPadOpen] = useState(false);
  const [cat, setCat] = useState(rec?.categoryId ?? '');
  const [day, setDay] = useState(String(rec?.day ?? 1));
  const [active, setActive] = useState(rec?.active ?? true);
  const [due, setDue] = useState(rec?.dueMonth ? String(rec.dueMonth) : '');
  const [start, setStart] = useState(rec?.startMonth ?? currentMonthKey());
  const [notice, setNotice] = useState(rec?.notice ?? '');
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const opts = data.categories.filter((c) => c.kind === type && !isHouseholdCat(c) && (!c.archived || c.id === cat) && (presetGroup ? c.group === presetGroup : c.group !== 'fix' && c.group !== 'spar' && c.id !== data.settings.joint?.categoryId)
    && (c.parentId !== null || childrenOf(data.categories, c.id).length === 0));
  // Kategorie wie bei „Neue Buchung“: erst Hauptkategorie, dann Bezeichnung
  const tops = [...new Map(opts.map((c) => { const t = c.parentId ? data.categories.find((p) => p.id === c.parentId) ?? c : c; return [t.id, t] as const; })).values()]
    .sort((x, y) => x.sort - y.sort);
  const catObj = data.categories.find((c) => c.id === cat);
  const [topId, setTopId] = useState(catObj ? catObj.parentId ?? catObj.id : '');
  const kids = opts.filter((c) => c.parentId === topId);
  const cents = parseCents(amount.endsWith(',') ? amount.slice(0, -1) : amount);
  const yearly = type === 'expense' && interval === 'yearly';
  const shown = amount === '' ? '0' : formatAmountTyping(amount);
  const color = presetGroup === 'spar' ? 'var(--spar)' : type === 'income' ? 'var(--inc)' : presetGroup === 'fix' || !presetGroup ? 'var(--fix)' : 'var(--all)';

  async function save() {
    const d = Number(day);
    if (cents === null || cents <= 0) { setPadOpen(true); return setErr('Bitte gib einen Betrag ein.'); }
    if (!opts.some((c) => c.id === cat)) { setPadOpen(false); return setErr('Bitte wähle eine Kategorie.'); }
    if (!name.trim()) { setPadOpen(false); return setErr('Bitte gib einen Namen ein.'); }
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
  const title = rec ? (presetGroup === 'spar' ? 'Sparrate' : 'Bearbeiten') : presetGroup === 'fix' ? 'Neue Fixkosten' : presetGroup === 'spar' ? 'Sparrate festlegen' : incomeOnly ? 'Neue Einnahme' : 'Neu';
  const pickTop = (id: string) => { setTopId(id); setCat(opts.some((c) => c.id === id) ? id : ''); };
  return (
    <Sheet title={title} onClose={onClose}
      right={!padOpen ? <button className="lnk sdone on txsave" onClick={() => void save()}>Speichern</button> : undefined}>
      {presetGroup !== 'fix' && presetGroup !== 'spar' && !incomeOnly && !(rec && rec.type === 'income') && (
        <div className="catseg txseg" role="tablist" aria-label="Art">
          {([['expense', 'Ausgabe', 'var(--fix)'], ['income', 'Einnahme', 'var(--inc)']] as const).map(([t, l, c]) => (
            <button key={t} role="tab" aria-selected={type === t} className={type === t ? 'on' : ''} style={{ ['--c' as string]: c }}
              onClick={() => { if (type === t) return; setType(t); setCat(''); setTopId(''); if (t === 'income') setInterval('monthly'); }}>{l}</button>
          ))}
        </div>
      )}
      {type === 'expense' && (
        <div className="catseg txseg" role="tablist" aria-label="Rhythmus">
          {([['monthly', 'Monatlich'], ['yearly', 'Jährlich']] as const).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={interval === v} className={interval === v ? 'on' : ''} style={{ ['--c' as string]: color }} onClick={() => setInterval(v)}>{l}</button>
          ))}
        </div>
      )}
      <div className="amtbox">
        <span className="cap">{yearly ? 'Jahresbetrag' : 'Betrag pro Monat'}</span>
        <button type="button" className={'a amtbtn' + (padOpen ? ' on' : '')} aria-label="Betrag" aria-expanded={padOpen} onClick={() => setPadOpen(true)}>{shown} €</button>
        {yearly && cents !== null && cents > 0 && <div className="pill">≈ {formatEUR(Math.round(cents / 12))} pro Monat</div>}
      </div>
      <div>
        <div className="lab">Kategorie</div>
        <div className="chips">
          {tops.map((c) => <button key={c.id} className={'chip' + (topId === c.id ? ' on' : '')} onClick={() => pickTop(c.id)}>{c.name}</button>)}
        </div>
      </div>
      {kids.length > 0 && (
        <div>
          <div className="lab">Bezeichnung</div>
          <div className="chips">
            {kids.map((c) => <button key={c.id} className={'chip' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.name}</button>)}
          </div>
        </div>
      )}
      <div className="card flush">
        <label className="field"><span>Name</span><input value={name} maxLength={60} onFocus={() => setPadOpen(false)} onChange={(e) => setName(e.target.value)} placeholder={type === 'income' ? 'z. B. Kindergeld' : yearly ? 'z. B. Kfz-Versicherung' : 'z. B. Miete'} /></label>
        {yearly && (
          <label className="field"><span>Fällig im</span>
            <select value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fälligkeitsmonat">
              <option value="">–</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Gilt ab</span><input type="month" value={start} max={shiftMonth(currentMonthKey(), 24)} aria-label="Gilt ab (Monat)" onFocus={() => setPadOpen(false)} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field"><span>{yearly ? 'Buchung am' : 'Tag im Monat'}</span><DayInput value={day} onChange={setDay} label={yearly ? 'Buchung am (Tag)' : 'Tag im Monat'} /></label>
        {type === 'expense' && <label className="field"><span>Kündigungsfrist</span><input value={notice} maxLength={80} placeholder="optional" aria-label="Kündigungsfrist (optional)" onFocus={() => setPadOpen(false)} onChange={(e) => setNotice(e.target.value)} /></label>}
        {rec && <label className="field"><span>Aktiv</span><input type="checkbox" className="switch" checked={active} onChange={(e) => setActive(e.target.checked)} /></label>}
      </div>
      {err && !padOpen && <div className="err-text" role="alert">{err}</div>}
      {padOpen && <KeyDock shown={shown} err={err} onDone={() => setPadOpen(false)} onSave={() => void save()} onKey={(k) => { setErr(''); setAmount((a) => pressKey(a, k)); }} />}
      {rec && !confirm && <button className="btn danger" onClick={() => setConfirm(true)}>Löschen</button>}
      {rec && confirm && <button className="btn danger" onClick={async () => { if (await run((db) => deleteRecurring(db, rec.id).then(() => true), 'Gelöscht')) onClose(); }}>Ja, löschen (bisherige Buchungen bleiben)</button>}
    </Sheet>
  );
}
