import { useEffect, useMemo, useState } from 'react';
import { Sheet } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { markFresh } from './fresh';
import { addTransaction, deleteTransactions, restoreTransactions, updateTransaction } from '../db/repo';
import { centsToInput, formatAmountTyping, formatEUR, parseCents } from '../domain/money';
import { isValidISODate, monthRange, todayISO } from '../domain/dates';
import { childrenOf, filterTransactions, jointMonth, monthAvailable, salaryStartMonth } from '../domain/calc';
import type { Transaction, TxType } from '../domain/types';
import { catArea } from '../domain/types';
import type { CatArea } from '../domain/types';

/** Bereich einer Ausgabe beim Erfassen */
export type ExpArea = 'alltag' | 'fix' | 'spar' | 'joint';

export interface TxPreset { categoryId?: string; type?: TxType; amountCents?: number; description?: string; account?: 'joint' }

function pressKey(cur: string, k: string): string {
  if (k === 'back') return cur.slice(0, -1);
  if (k === ',') return cur.includes(',') ? cur : (cur === '' ? '0,' : cur + ',');
  const [int, dec] = cur.split(',');
  if (dec !== undefined) return dec.length >= 2 ? cur : cur + k;
  if (int === '0') return k === '0' ? cur : k;
  return int.length >= 9 ? cur : cur + k;
}

/** Vorlage für „Duplizieren“: gleiche Kategorie, Art, Betrag und Beschreibung, aber heutiges Datum. */
export function duplicatePreset(tx: Transaction): TxPreset {
  return { categoryId: tx.categoryId, type: tx.type, amountCents: tx.amountCents, description: tx.description, ...(tx.account === 'joint' ? { account: 'joint' as const } : {}) };
}

export function TxSheet({ tx, preset, area: areaHint, lockArea, onClose, onDuplicate }: { tx?: Transaction; preset?: TxPreset; area?: ExpArea; lockArea?: boolean; onClose: () => void; onDuplicate?: (p: TxPreset) => void }) {
  const { data, run, month, setMonth, flash, acct } = useStore();
  const jset = data.settings.joint;
  const cats = data.categories;
  const presetCat = preset?.categoryId ? cats.find((c) => c.id === preset.categoryId) : undefined;
  const initialCatId = tx?.categoryId ?? presetCat?.id ?? '';
  const initialCat = cats.find((c) => c.id === initialCatId);
  const [type, setType] = useState<TxType>(tx?.type ?? initialCat?.kind ?? preset?.type ?? 'expense');
  const [amount, setAmount] = useState(tx ? centsToInput(tx.amountCents) : preset?.amountCents ? centsToInput(preset.amountCents) : '');
  const [date, setDate] = useState(tx?.date ?? todayISO());
  const [topId, setTopId] = useState(initialCat ? (initialCat.parentId ?? initialCat.id) : '');
  const [leafId, setLeafId] = useState(initialCat && initialCat.parentId ? initialCat.id : '');
  const [desc, setDesc] = useState(tx?.description ?? preset?.description ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Zahlenfeld wie eine Tastatur: erscheint erst nach Tipp auf den Betrag, unten im Vordergrund
  const [padOpen, setPadOpen] = useState(false);
  // Bereich der Ausgabe (Alltag, Fixkosten, gemeinsames Konto): bestimmt, welche Kategorien zur Wahl stehen.
  // Vorgabe: Bereich der Buchung bzw. Kategorie, sonst der Reiter, aus dem heraus erfasst wird.
  const jointAvail = !!jset?.enabled || tx?.account === 'joint';
  const [area, setArea] = useState<ExpArea>(() => {
    if (tx?.account === 'joint' || preset?.account === 'joint') return 'joint';
    const a = initialCat ? catArea(initialCat) : null;
    if (a && a !== 'einnahme') return a;
    const h = areaHint ?? (acct === 'joint' ? 'joint' : 'alltag');
    return h === 'joint' && !jointAvail ? 'alltag' : h;
  });
  const jointOn = type === 'expense' && area === 'joint' && jointAvail;
  // Aus Alltag oder Fixkosten heraus (und bei Sparen-Buchungen) gibt es keine Bereichswahl: nur dessen Kategorien
  const areaFixed = !!lockArea || area === 'spar';
  const want: CatArea = type === 'income' ? 'einnahme' : jointOn ? 'joint' : area === 'joint' ? 'alltag' : area;

  // Nur die Kategorien des gewählten Bereichs
  const tops = useMemo(
    () => cats.filter((c) => c.parentId === null && catArea(c) === want && (!c.archived || c.id === topId)).sort((a, b) => a.sort - b.sort),
    [cats, want, topId]
  );
  // Beim Wechsel des Bereichs passt die gewählte Kategorie nicht mehr zur Liste → zurücksetzen
  useEffect(() => {
    const t = cats.find((c) => c.id === topId);
    if (t && catArea(t) !== want) { setTopId(''); setLeafId(''); }
  }, [want, topId, cats]);
  const kids = topId ? childrenOf(cats, topId).filter((c) => !c.archived || c.id === leafId) : [];
  const finalCatId = kids.length > 0 ? leafId : topId;
  const top = cats.find((c) => c.id === topId);

  // Die 6 zuletzt genutzten Bezeichnungen (ohne automatische Buchungen) als Abkürzung
  const recent = useMemo(() => {
    if (tx) return [];
    const seen = new Set<string>();
    const out: { id: string; label: string; parent: string | null }[] = [];
    const sorted = [...(jointOn ? data.jointTransactions : data.transactions)].filter((t) => !t.recurringId && t.type === type).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const t of sorted) {
      if (seen.has(t.categoryId)) continue;
      const c = cats.find((x) => x.id === t.categoryId);
      if (!c || c.archived || catArea(c) !== want) continue;
      seen.add(c.id);
      const parent = c.parentId ? cats.find((x) => x.id === c.parentId) : undefined;
      const same = cats.some((x) => x.id !== c.id && x.name === c.name);
      out.push({ id: c.id, label: same && parent ? `${parent.name} › ${c.name}` : c.name, parent: c.parentId });
      if (out.length === 6) break;
    }
    return out;
  }, [tx, data.transactions, data.jointTransactions, jointOn, cats, type, want]);

  // Notiz-Vorschläge aus früheren eigenen Einträgen: beim Tippen passende, sonst die häufigsten dieser Kategorie
  const noteSugg = useMemo(() => {
    const list = (jointOn ? data.jointTransactions : data.transactions).filter((t) => !t.recurringId && t.description.trim() && t.type === type);
    const q = desc.trim().toLowerCase();
    const freq = new Map<string, { n: number; last: string }>();
    for (const t of list) {
      if (!q && finalCatId && t.categoryId !== finalCatId) continue;
      const d = t.description.trim();
      if (q && (!d.toLowerCase().includes(q) || d.toLowerCase() === q)) continue;
      const e = freq.get(d) ?? { n: 0, last: '' };
      freq.set(d, { n: e.n + 1, last: t.createdAt > e.last ? t.createdAt : e.last });
    }
    if (!q && !finalCatId) return [];
    return [...freq.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last)).slice(0, 4).map(([d]) => d);
  }, [jointOn, data.jointTransactions, data.transactions, type, desc, finalCatId]);

  // Hinweis „noch X im Alltagsbudget“
  const hint = useMemo(() => {
    if (jointOn && jset) {
      const jm = jointMonth(data.transactions, data.jointTransactions.filter((t) => t.id !== tx?.id), data.recurring, data.settings, month);
      return jm ? `${jset.name} · noch ${formatEUR(Math.max(0, jm.availableCents))}` : null;
    }
    if (type !== 'expense' || !top || top.group !== 'alltag') return null;
    const { from, to } = monthRange(month);
    const av = monthAvailable(filterTransactions(data.transactions, cats, { from, to }).filter((t) => t.id !== tx?.id), data.settings, month, salaryStartMonth(data.recurring, cats));
    return av.incomeCents > 0 ? `Alltagskonto · noch ${formatEUR(Math.max(0, av.availableCents))}` : null;
  }, [type, top, month, data.transactions, data.jointTransactions, data.recurring, data.settings, cats, tx, jointOn, jset]);

  async function save() {
    const cents = parseCents(amount.endsWith(',') ? amount.slice(0, -1) : amount);
    if (cents === null) return setErr('Bitte gib einen Betrag größer als 0 ein.');
    if (!isValidISODate(date)) return setErr('Bitte wähle ein gültiges Datum.');
    if (!finalCatId) return setErr(kids.length > 0 ? 'Bitte wähle eine Bezeichnung.' : 'Bitte wähle eine Kategorie.');
    setErr(''); setBusy(true);
    const input: Parameters<typeof addTransaction>[1] = { date, type, amountCents: cents, categoryId: finalCatId, description: desc.trim().slice(0, 120) };
    if (jointOn) input.account = 'joint';
    if (tx) {
      // Bearbeiten mit „Rückgängig“: der vorherige Stand wird unverändert zurückgeschrieben
      const before = { ...tx };
      const r = await run((db) => updateTransaction(db, tx.id, input));
      setBusy(false);
      if (!r) return;
      onClose();
      flash('Änderung gespeichert', 'ok', { label: 'Rückgängig', run: () => { void run((db) => restoreTransactions(db, [before]), 'Änderung zurückgenommen'); } });
      return;
    }
    const r = await run((db) => addTransaction(db, input), 'Buchung gespeichert');
    setBusy(false);
    if (r) {
      markFresh(r.id);
      // Gleich den Monat der neuen Buchung zeigen, damit man sie (samt Aufleuchten) sieht
      if (r.date.slice(0, 7) !== month) setMonth(r.date.slice(0, 7));
      onClose();
    }
  }
  async function del() {
    if (!tx) return;
    setBusy(true);
    const removed = await run((db) => deleteTransactions(db, [tx.id]));
    setBusy(false);
    if (!removed) return;
    onClose();
    flash('Buchung gelöscht', 'ok', { label: 'Rückgängig', run: () => { void run((db) => restoreTransactions(db, removed), 'Wiederhergestellt'); } });
  }
  const title = tx ? 'Buchung bearbeiten' : type === 'income' ? 'Neue Einnahme' : 'Neue Ausgabe';
  const shown = amount === '' ? '0' : formatAmountTyping(amount);

  return (
    <Sheet title={title} onClose={onClose}>
      {!areaFixed && <div className="fseg" role="group" aria-label="Art">
        <button className={type === 'expense' ? 'on' : ''} onClick={() => { setType('expense'); setTopId(''); setLeafId(''); }}>Ausgabe</button>
        <button className={type === 'income' ? 'on' : ''} onClick={() => { setType('income'); setTopId(''); setLeafId(''); }}>Einnahme</button>
      </div>}
      {type === 'expense' && !areaFixed && (
        <div className="fseg" role="tablist" aria-label="Bereich">
          {([['alltag', 'Alltag'], ['fix', 'Fixkosten'], ...(jointAvail ? [['joint', jset?.name ?? 'Gemeinsam']] : [])] as [ExpArea, string][]).map(([a, l]) => (
            <button key={a} role="tab" aria-selected={area === a} className={area === a ? 'on' : ''} onClick={() => setArea(a)}>{l}</button>
          ))}
        </div>
      )}
      <div className="amtbox">
        <span className="cap">Betrag</span>
        <button type="button" className={'a amtbtn' + (padOpen ? ' on' : '')} aria-label="Betrag" aria-expanded={padOpen} onClick={() => setPadOpen(true)}>{shown} €</button>
        {!padOpen && <span className="mini">Zum Eingeben tippen</span>}
        {hint && <div className="pill"><i style={{ width: 8, height: 8, borderRadius: 3, background: jointOn ? 'var(--inc)' : 'var(--all)' }} />{hint}</div>}
      </div>
      {recent.length > 0 && (
        <div>
          <div className="lab">Zuletzt</div>
          <div className="chips">
            {recent.map((r) => (
              <button key={r.id} className={'chip recent' + (finalCatId === r.id ? ' on' : '')}
                onClick={() => { if (r.parent) { setTopId(r.parent); setLeafId(r.id); } else { setTopId(r.id); setLeafId(''); } }}>{r.label}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="lab">Kategorie</div>
        <div className="chips">
          {tops.map((c) => <button key={c.id} className={'chip' + (topId === c.id ? ' on' : '')} onClick={() => { setTopId(c.id); setLeafId(''); }}>{c.name}</button>)}
        </div>
      </div>
      {kids.length > 0 && (
        <div>
          <div className="lab">Bezeichnung</div>
          <div className="chips">
            {kids.map((c) => <button key={c.id} className={'chip' + (leafId === c.id ? ' on' : '')} onClick={() => setLeafId(c.id)}>{c.name}</button>)}
          </div>
        </div>
      )}
      <div className="card flush">
        <label className="field"><span>Datum</span><input type="date" value={date} onFocus={() => setPadOpen(false)} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Notiz</span><input onFocus={() => setPadOpen(false)} value={desc} maxLength={120} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" autoComplete="off" /></label>
        {noteSugg.length > 0 && (
          <div className="notesugg" aria-label="Vorschläge für die Notiz">
            {noteSugg.map((n) => <button key={n} type="button" onClick={() => setDesc(n)}>{n}</button>)}
          </div>
        )}
      </div>
      {err && !padOpen && <div className="err-text" role="alert">{err}</div>}
      {!padOpen && <button className="btn cta" onClick={save} disabled={busy}>Speichern</button>}
      {padOpen && <div className="padspace" aria-hidden="true" />}
      {padOpen && (
        <div className="keydock">
          <div className="keydock-top">
            <button type="button" className="lnk" onClick={() => setPadOpen(false)}>Fertig</button>
            <span className="num">{shown} €</span>
            <button type="button" className="btn kd-save" onClick={save} disabled={busy}>Speichern</button>
          </div>
          {err && <div className="err-text kd-err" role="alert">{err}</div>}
          <div className="pad3" role="group" aria-label="Zahlenfeld">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'].map((k) => (
              <button key={k} className="key" aria-label={k === 'back' ? 'Löschen' : k} onClick={() => setAmount((a) => pressKey(a, k))}>
                {k === 'back' ? <Icon name="del" size={26} /> : k}
              </button>
            ))}
          </div>
        </div>
      )}
      {tx && (
        <div className="stack" style={{ gap: 0 }}>
          {onDuplicate && <button className="btn sec2" onClick={() => onDuplicate(duplicatePreset(tx))}>Duplizieren (als neue Buchung mit heutigem Datum)</button>}
          <button className="btn danger" onClick={del} disabled={busy}>Buchung löschen</button>
        </div>
      )}
    </Sheet>
  );
}
