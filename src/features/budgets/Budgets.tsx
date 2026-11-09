import { useState } from 'react';
import { useStore } from '../../state/store';
import { monthLabel, monthRange } from '../../domain/dates';
import { filterTransactions } from '../../domain/transactions';
import { catArea } from '../../domain/types';
import { budgetStatus, resolveBudget } from '../../domain/budget';
import { categoryFamily } from '../../domain/categories';
import { Header } from '../../ui/Header';
import { freeOf } from '../../domain/month';
import { Icon } from '../../ui/icons';
import { centsToInput, formatAmountTyping, formatEUR, parseCents, pressKey } from '../../domain/money';
import { Bar, barColor } from '../../ui/Bar';
import { Sheet } from '../../ui/Sheet';
import { setBudget } from '../../data/budgets';
import { KeyDock } from '../../ui/KeyDock';

/* ───────── Budgets ───────── */
export function BudgetsPage({ back }: { back: React.ReactNode }) {
  const { data, run, month, setMonth } = useStore();
  const [edit, setEdit] = useState<{ scope: 'month' | 'category'; categoryId?: string; title: string } | null>(null);
  const { from, to } = monthRange(month);
  const txs = filterTransactions(data.transactions, data.categories, { from, to, type: 'expense' });
  // Limits gibt es für die Alltags-Kategorien; sie erscheinen im Alltag als Balken unter dem Namen
  const exp = data.categories.filter((c) => c.parentId === null && !c.archived && catArea(c) === 'alltag').sort((a, b) => a.sort - b.sort);
  const mTotal = resolveBudget(data.budgets, month, 'month');
  const mSpent = txs.reduce((a, t) => a + t.amountCents, 0);
  const [adding, setAdding] = useState(false);
  const withBudget = exp.flatMap((c) => {
    const b = resolveBudget(data.budgets, month, 'category', c.id);
    if (b === null) return [];
    const fam = categoryFamily(data.categories, c.id);
    return [{ c, b, spent: txs.filter((t) => fam.has(t.categoryId)).reduce((a, t) => a + t.amountCents, 0) }];
  });
  return (
    <>
      {back}
      <Header kicker="Budgets" title={monthLabel(month)} pick={{ month, onChange: setMonth, value: (p) => freeOf(data.transactions, data.categories, data.settings, data.recurring, p) }}
        right={<button className="ib" aria-label="Budget hinzufügen" onClick={() => setAdding(true)}><Icon name="plus" /></button>} />
      {/* Nur gesetzte Budgets – alles andere hat kein Limit und braucht keine Zeile */}
      {mTotal === null && withBudget.length === 0 ? <p className="note" style={{ textAlign: 'center', margin: '24px 0' }}>Noch keine Budgets. Mit + legst du eins an.</p> : (
        <div className="card flush">
          {mTotal !== null && (
            <button className="item" onClick={() => setEdit({ scope: 'month', title: 'Gesamtbudget' })}>
              <span className="mid"><b>Gesamtbudget</b><small>{`${formatEUR(mSpent)} von ${formatEUR(mTotal)}`}</small><Bar ratio={budgetStatus(mSpent, mTotal).ratio} color={barColor(budgetStatus(mSpent, mTotal).ratio, budgetStatus(mSpent, mTotal).over, 'var(--inc)')} /></span>
            </button>
          )}
          {withBudget.map(({ c, b, spent }) => {
            const st = budgetStatus(spent, b);
            return (
              <button className="item" key={c.id} onClick={() => setEdit({ scope: 'category', categoryId: c.id, title: c.name })}>
                <span className="mid"><b>{c.name}</b><small className={st.over ? 'overshake' : undefined}>{`${formatEUR(spent)} von ${formatEUR(b)}`}</small><Bar ratio={st.ratio} color={barColor(st.ratio, st.over, 'var(--all)')} /></span>
              </button>
            );
          })}
        </div>
      )}
      {adding && (
        <Sheet title="Budget hinzufügen" onClose={() => setAdding(false)} left="Abbrechen">
          <div className="slist">
            {mTotal === null && <button className="srow" onClick={() => { setAdding(false); setEdit({ scope: 'month', title: 'Gesamtbudget' }); }}><span>Gesamtbudget (alle Ausgaben)</span></button>}
            {exp.filter((c) => !withBudget.some((w) => w.c.id === c.id)).map((c) => (
              <button key={c.id} className="srow" onClick={() => { setAdding(false); setEdit({ scope: 'category', categoryId: c.id, title: c.name }); }}><span>{c.name}</span></button>
            ))}
          </div>
        </Sheet>
      )}
      {edit && <BudgetSheet {...edit} month={month} onClose={() => setEdit(null)} run={run} />}
    </>
  );
}
function BudgetSheet({ scope, categoryId, title, month, onClose, run }: { scope: 'month' | 'category'; categoryId?: string; title: string; month: string; onClose: () => void; run: ReturnType<typeof useStore>['run'] }) {
  const { data } = useStore();
  const [mode, setMode] = useState<'default' | 'month'>('default');
  const find = (m: 'default' | 'month') => data.budgets.find((x) => x.scope === scope && x.categoryId === categoryId && x.monthKey === (m === 'default' ? 'default' : month));
  const cur = find(mode);
  const [amount, setAmount] = useState(cur ? centsToInput(cur.amountCents) : '');
  const [padOpen, setPadOpen] = useState(!cur);
  const [err, setErr] = useState('');
  const pick = (m: 'default' | 'month') => {
    setMode(m);
    const b = find(m);
    setAmount(b ? centsToInput(b.amountCents) : '');
  };
  const shown = amount === '' ? '0' : formatAmountTyping(amount);
  async function save(remove: boolean) {
    const cents = remove ? null : parseCents(amount.endsWith(',') ? amount.slice(0, -1) : amount);
    if (!remove && (cents === null || cents <= 0)) { setPadOpen(true); return setErr('Bitte gib einen Betrag ein.'); }
    const p: Parameters<typeof setBudget>[1] = { scope, monthKey: mode === 'default' ? 'default' : month, amountCents: cents };
    if (categoryId) p.categoryId = categoryId;
    if (await run((db) => setBudget(db, p).then(() => true), remove ? 'Budget entfernt' : 'Budget gespeichert')) onClose();
  }
  // Im Stil von „Neue Buchung“: Umschalter, großer Betrag mit Zahlenfeld, Speichern oben
  return (
    <Sheet title={title} onClose={onClose}
      right={!padOpen ? <button className="lnk sdone on txsave" onClick={() => void save(false)}>Speichern</button> : undefined}>
      <div className="catseg txseg" role="tablist" aria-label="Gilt für">
        {([['default', 'Alle Monate'], ['month', `Nur ${monthLabel(month)}`]] as const).map(([m, l]) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} style={{ ['--c' as string]: 'var(--all)' }} onClick={() => pick(m)}>{l}</button>
        ))}
      </div>
      <div className="amtbox">
        <span className="cap">Budget pro Monat</span>
        <button type="button" className={'a amtbtn' + (padOpen ? ' on' : '')} aria-label="Budget" aria-expanded={padOpen} onClick={() => setPadOpen(true)}>{shown} €</button>
      </div>
      {err && !padOpen && <div className="err-text" role="alert">{err}</div>}
      {padOpen && <KeyDock shown={shown} err={err} onDone={() => setPadOpen(false)} onSave={() => void save(false)} onKey={(k) => { setErr(''); setAmount((a) => pressKey(a, k)); }} />}
      {cur && !padOpen && <button className="btn danger" onClick={() => void save(true)}>Budget entfernen</button>}
    </Sheet>
  );
}
