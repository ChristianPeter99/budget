import { useState } from 'react';
import type { ReactNode } from 'react';
import { AmountInput, Chevr, Header, Sheet } from './common';
import { useStore } from '../state/store';
import { addDepotEntry, addSavingsEntry, deleteDepotEntry, deleteSavingsEntry, savingsEntries } from '../db/repo';
import { formatDateDE, monthLabel, todayISO } from '../domain/dates';
import { formatEUR, formatEUR0, parseCents } from '../domain/money';
import type { Recurring } from '../domain/types';
import type { TxPreset } from './TxSheet';
import { GoalsCard } from './Goals';

/** Sparkonto heute geschätzt: letzter erfasster Kontostand plus seitdem gebuchte Sparraten (bis heute). */
export function savingsEstimate(data: ReturnType<typeof useStore>['data'], today = todayISO()): { cents: number; known: boolean } {
  const s = data.settings;
  const isSpar = (catId: string) => data.categories.find((c) => c.id === catId)?.group === 'spar';
  if (!s.savingsBalanceDate) return { cents: 0, known: false };
  const since = data.transactions.filter((t) => t.type === 'expense' && isSpar(t.categoryId) && t.date > (s.savingsBalanceDate as string) && t.date <= today).reduce((a, t) => a + t.amountCents, 0);
  return { cents: s.savingsBalanceCents + since, known: true };
}

export function Sparen({ back, onEditRec }: { back: ReactNode; onAdd?: (p: TxPreset) => void; onEditRec: (r: Recurring) => void }) {
  const { data, run } = useStore();
  const cats = data.categories;
  const s = data.settings;
  const isSpar = (catId: string) => cats.find((c) => c.id === catId)?.group === 'spar';
  const sparRecs = data.recurring.filter((r) => r.active && r.type === 'expense' && isSpar(r.categoryId));
  const rate = sparRecs.reduce((a, r) => a + r.amountCents, 0);
  const today = todayISO();
  // Seit dem eingegebenen Kontostand gebuchte Sparraten (bis heute) werden hinzugerechnet.
  const since = s.savingsBalanceDate
    ? data.transactions.filter((t) => t.type === 'expense' && isSpar(t.categoryId) && t.date > (s.savingsBalanceDate as string) && t.date <= today).reduce((a, t) => a + t.amountCents, 0)
    : 0;
  const nowEst = s.savingsBalanceCents + since;
  const [bal, setBal] = useState('');
  const sav = savingsEntries(s);
  const [depot, setDepot] = useState('');
  const [err, setErr] = useState('');
  const [list, setList] = useState<'' | 'spar' | 'depot'>('');
  const entries = [...data.depotEntries].sort((a, b) => b.date.localeCompare(a.date));
  const last = entries[0];
  const prev = entries[1];

  async function saveBalance() {
    const c = parseCents(bal);
    if (c === null) return setErr('Bitte gib einen gültigen Kontostand ein.');
    setErr('');
    const r = await run((db) => addSavingsEntry(db, today, c).then(() => true), 'Kontostand erfasst');
    if (r) setBal('');
  }
  async function saveDepot() {
    const c = parseCents(depot);
    if (c === null) return setErr('Bitte gib einen gültigen Depotstand ein.');
    setErr('');
    const r = await run((db) => addDepotEntry(db, today, c), 'Depotstand erfasst');
    if (r) setDepot('');
  }

  return (
    <>
      {back}
      <Header title="Sparen & Depot" />
      <GoalsCard />
      <div className="card flush">
        <div className="sec"><h2>Sparen</h2>{sparRecs[0] && <button onClick={() => onEditRec(sparRecs[0] as Recurring)}>Sparrate ändern</button>}</div>
        <div className="kv"><span>Monatliche Sparrate</span><b>{formatEUR(rate)}</b></div>
        {sparRecs[0] && <button className="link" onClick={() => onEditRec(sparRecs[0] as Recurring)} aria-label="Sparrate gilt ab – ändern"><span>Gilt ab</span><small>{monthLabel(sparRecs[0].startMonth)}<Chevr /></small></button>}
        <div className="pad stack" style={{ gap: 4, borderTop: '1px solid var(--line)' }}>
          <span className="cap">{s.savingsBalanceDate ? `Aktueller Stand · heute geschätzt` : 'Noch kein Kontostand erfasst'}</span>
          {s.savingsBalanceDate && <span className="mid34 num">{formatEUR0(nowEst)}</span>}
          {s.savingsBalanceDate && <span className="mini">{formatEUR(s.savingsBalanceCents)} am {formatDateDE(s.savingsBalanceDate)}{since > 0 ? ` + ${formatEUR(since)} seitdem gebuchte Sparraten` : ''}</span>}
        </div>
        <div className="pad stack" style={{ gap: 4, borderTop: '1px solid var(--line)' }}>
          <span className="cap">Voraussichtlich in 12 Monaten</span>
          <span className="mid34 num pos">{formatEUR0(nowEst + rate * 12)}</span>
          <span className="mini">in 3 Jahren {formatEUR0(nowEst + rate * 36)} · in 5 Jahren {formatEUR0(nowEst + rate * 60)} (ohne Zinsen)</span>
        </div>
        <label className="field tight"><span>Kontostand laut Bank (€)</span><AmountInput label="Kontostand Sparkonto" value={bal} onChange={setBal} placeholder="10.000" /></label>
        <div className="pad"><button className="btn sec2" onClick={saveBalance} disabled={!bal}>Mit heutigem Datum erfassen</button></div>
        {sav[0] && (
          <button className="link" onClick={() => setList('spar')} aria-label={`Alle ${sav.length} Kontostände anzeigen`}>
            <span className="lastentry"><small>Letzter Eintrag · {formatDateDE(sav[0].date)}</small>{formatEUR0(sav[0].cents)}</span>
            <small>{sav.length > 1 ? `alle ${sav.length}` : ''}<Chevr /></small>
          </button>
        )}
        <p className="note pad">Weicht der Kontostand ab, trag ihn hier ein. Den Verlauf als Grafik findest du unter Auswertung.</p>
      </div>

      <div className="card flush">
        <div className="sec"><h2>Depot</h2></div>
        <div className="pad stack" style={{ gap: 4 }}>
          <span className="cap">{last ? `Aktueller Stand · ${formatDateDE(last.date)}` : 'Noch kein Depotstand erfasst'}</span>
          {last && <span className="mid34 num">{formatEUR0(last.valueCents)}</span>}
          {last && prev && <span className={'mini ' + (last.valueCents >= prev.valueCents ? 'pos' : 'neg')}>{last.valueCents >= prev.valueCents ? '+' : '−'}{formatEUR0(Math.abs(last.valueCents - prev.valueCents))} seit {formatDateDE(prev.date)}</span>}
        </div>
        <label className="field tight"><span>Neuer Depotstand (€)</span><AmountInput label="Neuer Depotstand" value={depot} onChange={setDepot} placeholder="100.000" /></label>
        <div className="pad"><button className="btn sec2" onClick={saveDepot} disabled={!depot}>Mit heutigem Datum erfassen</button></div>
        {last && (
          <button className="link" onClick={() => setList('depot')} aria-label={`Alle ${entries.length} Depotstände anzeigen`}>
            <span className="lastentry"><small>Letzter Eintrag · {formatDateDE(last.date)}</small>{formatEUR0(last.valueCents)}</span>
            <small>{entries.length > 1 ? `alle ${entries.length}` : ''}<Chevr /></small>
          </button>
        )}
        <p className="note pad">Weicht der Depotstand ab, trag ihn hier ein. Den Verlauf als Grafik findest du unter Auswertung.</p>
      </div>
      {err && <div className="err-text" role="alert">{err}</div>}
      {list && (
        <Sheet title={list === 'spar' ? 'Kontostände Sparkonto' : 'Depotstände'} left="Schließen" onClose={() => setList('')}>
          <div className="card flush">
            {(list === 'spar' ? sav.map((e) => ({ key: e.date, date: e.date, cents: e.cents, del: () => run((db) => deleteSavingsEntry(db, e.date), 'Eintrag gelöscht') }))
              : entries.map((e) => ({ key: e.id, date: e.date, cents: e.valueCents, del: () => run((db) => deleteDepotEntry(db, e.id), 'Eintrag gelöscht') }))).map((e, i, arr) => {
              const prevE = arr[i + 1];
              const diff = prevE ? e.cents - prevE.cents : null;
              return (
                <div className="kv" key={e.key}>
                  <span className="lastentry"><small>{formatDateDE(e.date)}</small>{formatEUR0(e.cents)}</span>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {diff !== null && <span className={'mini ' + (diff >= 0 ? 'pos' : 'neg')}>{diff >= 0 ? '+' : '−'}{formatEUR0(Math.abs(diff))}</span>}
                    <button className="iconx" aria-label={`Eintrag vom ${formatDateDE(e.date)} löschen`} onClick={() => void e.del()}>✕</button>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="note">Pro Tag zählt ein Eintrag. Den Verlauf als Grafik findest du unter Mehr › Auswertung.</p>
        </Sheet>
      )}
    </>
  );
}
