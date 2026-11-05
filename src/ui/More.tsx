import { useState } from 'react';
import { AmountInput, Back, Bar, Chevr, Header, Money, Sheet, GROUP_LABEL, GROUP_TILE, barColor, catIcon } from './common';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { addCategory, setCategoryIcon, deleteCategory, mergeCategory, renameCategory, setBudget, setCategoryArchived, setCategoryGroup, setCategoryParent } from '../db/repo';
import { budgetStatus, categoryFamily, categoryName, childrenOf, filterTransactions, resolveBudget, topLevel } from '../domain/calc';
import { centsToGroupedInput, formatEUR, parseCents } from '../domain/money';
import { monthLabel, monthRange } from '../domain/dates';
import type { CatGroup, Recurring, Transaction, TxType } from '../domain/types';
import { catArea, isHouseholdCat } from '../domain/types';
import type { CatArea } from '../domain/types';
import type { TxPreset } from './TxSheet';
import { CAT_ICONS } from '../domain/catIcons';
import { Sparen } from './Sparen';
import { WealthPage } from './Wealth';
import { Bookings } from './Bookings';
import { Stats } from './Stats';
import { BackupScreen } from './BackupScreen';
import { RecurringPage } from './Recurring';
import { JointPage } from './Joint';
import { ImportPage } from './Import';

export type MorePage = 'menu' | 'wealth' | 'joint' | 'spar' | 'bookings' | 'stats' | 'recurring' | 'categories' | 'budgets' | 'settings' | 'backup' | 'import';
type Page = MorePage;

export interface MoreProps {
  initial?: Page;
  /** Zurück zum Reiter, von dem aus die Seite direkt geöffnet wurde */
  onExit: () => void;
  onOpenTx: (t: Transaction) => void;
  onAdd: (p: TxPreset) => void;
  onEditRec: (r: Recurring) => void;
}

export function More({ initial = 'menu', onExit, onOpenTx, onAdd, onEditRec }: MoreProps) {
  const [page, setPage] = useState<Page>(initial);
  const { data } = useStore();
  const direct = initial !== 'menu' && page === initial;
  const back = <Back label={direct ? 'Zurück' : 'Mehr'} onClick={() => (direct ? onExit() : setPage('menu'))} />;
  if (page === 'joint') return <JointPage back={back} />;
  if (page === 'wealth') return <WealthPage back={back} />;
  if (page === 'spar') return <Sparen back={back} onAdd={onAdd} onEditRec={onEditRec} />;
  if (page === 'bookings') return <Bookings back={back} onOpenTx={onOpenTx} onDuplicate={onAdd} />;
  if (page === 'stats') return <Stats back={back} />;
  if (page === 'recurring') return <RecurringPage back={back} />;
  if (page === 'categories') return <CategoriesPage back={back} />;
  if (page === 'budgets') return <BudgetsPage back={back} />;
  if (page === 'settings') return <BackupScreen back={back} />;
  if (page === 'backup') return <BackupScreen back={back} />;
  if (page === 'import') return <ImportPage back={back} />;
  const items: [Page, string, string, string][] = [
    ['spar', 'Sparen', 'Sparen & Depot', ''],
    ['wealth', 'Depot', 'Gesamtvermögen', ''],
    ['joint', 'card', 'Gemeinsames Konto', data.settings.joint?.enabled ? data.settings.joint.name : 'aus'],
    ['import', 'arrowdown', 'CSV-Import', ''],
    ['stats', 'chart', 'Auswertung', ''],
    ['categories', 'tag', 'Kategorien', ''],
    ['recurring', 'repeat', 'Gehalt & Wiederkehrend', `${data.recurring.length}`],
    ['budgets', 'target', 'Budgets', ''],
    ['backup', 'lock', 'Daten & Backup', data.lastBackupAt ? 'gesichert' : 'fehlt']
  ];
  return (
    <>
      <Header title="Mehr" keepLine />
      <div className="card flush">
        {items.map(([p, ic, l, s]) => (
          <button className="link" key={p} onClick={() => setPage(p)}><span style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Icon name={ic} />{l}</span><small>{s}<Chevr /></small></button>
        ))}
      </div>
    </>
  );
}

/* ───────── Kategorien ───────── */
export function CategoriesPage({ back, group, scope }: { back: React.ReactNode; group?: CatGroup; scope?: 'joint' }) {
  const { data, run } = useStore();
  const [sheet, setSheet] = useState<{ id?: string; parentId?: string | null } | null>(null);
  const jset = data.settings.joint;
  // Ohne feste Vorgabe: oben wählbar, welcher Bereich gerade gezeigt wird (Alltag, Fixkosten, Einnahmen, gemeinsames Konto)
  const [areaView, setAreaView] = useState<CatArea>('alltag');
  const [pick, setPick] = useState<string | null>(null);
  const area: CatArea = scope === 'joint' ? 'joint' : group ? (group === 'alltag' ? 'alltag' : group === 'spar' ? 'spar' : 'fix') : areaView;
  const tops = topLevel(data.categories).filter((c) => catArea(c) === area);
  const areas: [CatArea, string][] = [['alltag', 'Alltag'], ['fix', 'Fixkosten'], ['spar', 'Sparen'], ['einnahme', 'Einnahmen'], ...(jset?.enabled ? [['joint', jset.name] as [CatArea, string]] : [])];
  return (
    <>
      {back}
      <Header kicker={scope === 'joint' ? (data.settings.joint?.name ?? 'Haushaltskonto') : group ? GROUP_LABEL[group] : undefined} title="Kategorien" right={<div className="mn">
        <button className="pillbtn" onClick={() => setSheet({ parentId: null })}>Neu</button>
      </div>} />
      {!group && !scope && <div className="fseg" role="tablist" aria-label="Bereich">
        {areas.map(([a, l]) => <button key={a} role="tab" aria-selected={areaView === a} className={areaView === a ? 'on' : ''} onClick={() => setAreaView(a)}>{l}</button>)}
      </div>}
      <p className="note">Tippe auf eine Kategorie, um sie umzubenennen, zu verschieben, die Gruppe zu ändern oder sie mit einer anderen zusammenzuführen. Die Reihenfolge änderst du direkt in Alltag und Fixkosten: gedrückt halten und ziehen.</p>
      {tops.map((t) => {
        const kids = childrenOf(data.categories, t.id);
        return (
          <div className="card flush" key={t.id}>
            <div className="ghead catrow">
              <button className={'iconpick tile flat ' + (isHouseholdCat(t) ? 't-hh' : GROUP_TILE[t.group])} aria-label={`Symbol für ${t.name} ändern`} onClick={() => setPick(t.id)}>
                <Icon name={catIcon(data.categories, t)} size={22} />
              </button>
              <button className="clickrow catname" onClick={() => setSheet({ id: t.id })}>
                <b>{t.name}{t.archived ? ' (archiviert)' : ''}</b>
                {t.kind === 'expense' && <span className="tag">{isHouseholdCat(t) ? (data.settings.joint?.name ?? 'Haushaltskonto') : GROUP_LABEL[t.group]}</span>}
              </button>
            </div>
            {kids.map((c) => (
              <div className="subrow catsub" key={c.id}>
                <button className="sub" onClick={() => setSheet({ id: c.id })}><span>{c.name}{c.archived ? ' (archiviert)' : ''}</span><Chevr /></button>
              </div>
            ))}
            {data.settings.joint?.categoryId !== t.id && <button className="sub addline" onClick={() => setSheet({ parentId: t.id })}><span>+ Unterkategorie</span></button>}
          </div>
        );
      })}
      {pick && <IconPickerSheet id={pick} onClose={() => setPick(null)} />}
      {sheet && <CategorySheet {...sheet} group={group ?? (area === 'fix' || area === 'alltag' || area === 'spar' ? area : undefined)} {...(area === 'joint' ? { scope: 'joint' as const } : {})} {...(area === 'einnahme' ? { kind: 'income' as const } : {})} onClose={() => setSheet(null)} run={run} />}
    </>
  );
}

/** Symbol einer Kategorie aus der festen Auswahl wählen. */
function IconPickerSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, run } = useStore();
  const cat = data.categories.find((c) => c.id === id);
  if (!cat) return null;
  const current = catIcon(data.categories, cat);
  const choose = async (icon: string | null) => { if (await run((db) => setCategoryIcon(db, cat.id, icon).then(() => true))) onClose(); };
  return (
    <Sheet title={`Symbol für ${cat.name}`} onClose={onClose}>
      <div className="icongrid" role="listbox" aria-label="Symbole">
        {CAT_ICONS.map((i) => (
          <button key={i.key} role="option" aria-selected={i.key === current} className={i.key === current ? 'on' : ''} aria-label={i.label} onClick={() => void choose(i.key)}>
            <Icon name={i.key} size={24} /><small>{i.label}</small>
          </button>
        ))}
      </div>
      {cat.icon && <button className="btn sec2" onClick={() => void choose(null)}>Standard-Symbol verwenden</button>}
    </Sheet>
  );
}

export function CategorySheet({ id, parentId, group: presetGroup, scope: presetScope, kind: presetKind, onClose, run }: { id?: string; parentId?: string | null; group?: CatGroup; scope?: 'joint'; kind?: TxType; onClose: () => void; run: ReturnType<typeof useStore>['run'] }) {
  const { data } = useStore();
  const cats = data.categories;
  const cat = id ? cats.find((c) => c.id === id) : undefined;
  const parent = cat ? cats.find((c) => c.id === cat.parentId) : parentId ? cats.find((c) => c.id === parentId) : undefined;
  const [name, setName] = useState(cat?.name ?? '');
  const [kind, setKind] = useState<TxType>(cat?.kind ?? parent?.kind ?? presetKind ?? 'expense');
  const [group, setGroup] = useState<CatGroup>(cat?.group ?? parent?.group ?? presetGroup ?? 'alltag');
  const [target, setTarget] = useState(cat ? (cat.parentId ?? '') : '');
  const [mergeTo, setMergeTo] = useState('');
  const [confirm, setConfirm] = useState<'' | 'delete' | 'merge'>('');
  const allTx = [...data.transactions, ...data.jointTransactions];
  const usedCount = cat ? allTx.filter((t) => t.categoryId === cat.id).length : 0;
  const used = cat ? usedCount > 0 || data.recurring.some((r) => r.categoryId === cat.id) : false;
  const kids = cat ? childrenOf(cats, cat.id) : [];
  const isJoint = !!cat && data.settings.joint?.categoryId === cat.id;
  // Haushaltskonto und eigenes Konto haben getrennte Listen: Ziele nur aus derselben Liste
  const household = cat ? isHouseholdCat(cat) : parent ? isHouseholdCat(parent) : presetScope === 'joint';
  const sameList = (c: { scope?: 'joint' }) => isHouseholdCat(c) === household;
  const tops = cats.filter((c) => c.parentId === null && c.kind === cat?.kind && sameList(c) && c.id !== cat?.id && c.id !== data.settings.joint?.categoryId && !c.archived);
  const bookable = cats.filter((c) => c.kind === cat?.kind && sameList(c) && c.id !== cat?.id && !c.archived && c.id !== data.settings.joint?.categoryId
    && !cats.some((x) => x.parentId === c.id));

  async function save() {
    if (!cat) {
      if (await run((db) => addCategory(db, { name, kind: parent ? parent.kind : household ? 'expense' : kind, group: parent ? parent.group : household ? 'alltag' : kind === 'income' ? 'einnahme' : group, parentId: parent?.id ?? null, ...(household ? { scope: 'joint' as const } : {}) }), 'Kategorie angelegt')) onClose();
      return;
    }
    const ok = await run(async (db) => {
      if (name.trim() !== cat.name) await renameCategory(db, cat.id, name);
      const newParent = target === '' ? null : target;
      if (!isJoint && newParent !== cat.parentId) await setCategoryParent(db, cat.id, newParent);
      if (!isJoint && newParent === null && cat.kind === 'expense' && group !== cat.group) await setCategoryGroup(db, cat.id, group);
      return true;
    }, 'Gespeichert');
    if (ok) onClose();
  }
  const mergeTarget = cats.find((c) => c.id === mergeTo);
  return (
    <Sheet title={cat ? 'Kategorie' : parent ? `Unterkategorie von ${parent.name}` : 'Neue Kategorie'} onClose={onClose}>
      {!cat && !parent && !household && <div className="seg"><button className={kind === 'expense' ? 'on' : ''} onClick={() => setKind('expense')}>Ausgabe</button><button className={kind === 'income' ? 'on' : ''} onClick={() => setKind('income')}>Einnahme</button></div>}
      <div className="card flush">
        <label className="field"><span>Name</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        {cat && !isJoint && (kids.length === 0) && (
          <label className="field"><span>Liegt unter</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Oberkategorie">
              <option value="">– Hauptkategorie –</option>
              {tops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {!household && ((!cat && !parent && kind === 'expense') || (cat && !isJoint && cat.kind === 'expense' && target === '')) && (
          <label className="field"><span>Gruppe</span>
            <select value={group} onChange={(e) => setGroup(e.target.value as CatGroup)} aria-label="Gruppe">
              <option value="fix">Fixkosten</option><option value="alltag">Alltag</option><option value="spar">Sparen</option>
            </select>
          </label>
        )}
      </div>
      {cat && kids.length > 0 && !isJoint && <p className="note">Hat {kids.length} Unterkategorien; eine Gruppenänderung gilt für alle. Zum Unterordnen erst die Unterkategorien verschieben.</p>}
      {cat && target && cat.parentId === null && <p className="note">Als Unterkategorie gilt die Gruppe der neuen Oberkategorie. Budgets dieser Kategorie entfallen.</p>}
      {household && <p className="note">Kategorie des Haushaltskontos ({data.settings.joint?.name ?? 'Haushaltskonto'}) – getrennt von deinen eigenen Kategorien.</p>}
      {isJoint && <p className="note">Diese Kategorie gehört zum gemeinsamen Konto und bleibt eine Alltags-Hauptkategorie.</p>}
      <button className="btn" onClick={save}>Speichern</button>

      {cat && !isJoint && kids.length === 0 && (
        <div className="card flush">
          <div className="sec"><h2>Zusammenführen</h2></div>
          <label className="field"><span>Mit</span>
            <select value={mergeTo} onChange={(e) => { setMergeTo(e.target.value); setConfirm(''); }} aria-label="Zusammenführen mit">
              <option value="">wählen …</option>
              {bookable.map((c) => <option key={c.id} value={c.id}>{categoryName(cats, c.id)}</option>)}
            </select>
          </label>
          {mergeTarget && (
            <div className="pad stack">
              <span className="mini">{usedCount} Buchung{usedCount === 1 ? '' : 'en'} und Vorlagen von „{cat.name}“ wandern nach „{categoryName(cats, mergeTarget.id)}“. „{cat.name}“ wird danach gelöscht. Vorher ein Backup schadet nicht.</span>
              {confirm !== 'merge'
                ? <button className="btn sec2" onClick={() => setConfirm('merge')}>Zusammenführen …</button>
                : <button className="btn" onClick={async () => { const n = await run((db) => mergeCategory(db, cat.id, mergeTarget.id)); if (n !== undefined) { onClose(); } }}>Ja, zusammenführen</button>}
            </div>
          )}
        </div>
      )}

      {cat && <button className="btn sec2" onClick={() => run((db) => setCategoryArchived(db, cat.id, !cat.archived).then(() => true), cat.archived ? 'Wieder aktiviert' : 'Archiviert').then(onClose)}>{cat.archived ? 'Wieder aktivieren' : 'Archivieren (Buchungen bleiben erhalten)'}</button>}
      {cat && !used && kids.length === 0 && !isJoint && confirm !== 'delete' && <button className="btn danger" onClick={() => setConfirm('delete')}>Löschen</button>}
      {cat && confirm === 'delete' && <button className="btn danger" onClick={async () => { if (await run((db) => deleteCategory(db, cat.id).then(() => true), 'Gelöscht')) onClose(); }}>Ja, endgültig löschen</button>}
      {cat && (used || kids.length > 0) && <p className="note">Kategorien mit Buchungen oder Unterkategorien können nicht gelöscht werden; du kannst sie archivieren oder zusammenführen.</p>}
    </Sheet>
  );
}

/* ───────── Budgets ───────── */
function BudgetsPage({ back }: { back: React.ReactNode }) {
  const { data, run, month, setMonth } = useStore();
  const [edit, setEdit] = useState<{ scope: 'month' | 'category'; categoryId?: string; title: string } | null>(null);
  const { from, to } = monthRange(month);
  const txs = filterTransactions(data.transactions, data.categories, { from, to, type: 'expense' });
  // Limits gibt es für die Alltags-Kategorien; sie erscheinen im Alltag als Balken unter dem Namen
  const exp = data.categories.filter((c) => c.parentId === null && !c.archived && catArea(c) === 'alltag').sort((a, b) => a.sort - b.sort);
  const mTotal = resolveBudget(data.budgets, month, 'month');
  const mSpent = txs.reduce((a, t) => a + t.amountCents, 0);
  return (
    <>
      {back}
      <Header kicker="Budgets" title={monthLabel(month)} right={<div className="mn"><button className="ib" aria-label="Vorheriger Monat" onClick={() => setMonth(shiftM(month, -1))}><Icon name="left" /></button><button className="ib" aria-label="Nächster Monat" onClick={() => setMonth(shiftM(month, 1))}><Icon name="right" /></button></div>} />
      <div className="card flush">
        <button className="item" onClick={() => setEdit({ scope: 'month', title: 'Monatsbudget' })}>
          <span className="mid"><b>Gesamtbudget Ausgaben</b><small>{mTotal === null ? 'nicht gesetzt' : `${formatEUR(mSpent)} von ${formatEUR(mTotal)}`}</small></span>
          {mTotal !== null && <span className="amt"><Money cents={mTotal - mSpent} /></span>}
        </button>
      </div>
      <span className="cap" style={{ paddingLeft: 4 }}>Alltag-Kategorien</span>
      <div className="card flush">
        {exp.map((c) => {
          const b = resolveBudget(data.budgets, month, 'category', c.id);
          const fam = categoryFamily(data.categories, c.id);
          const spent = txs.filter((t) => fam.has(t.categoryId)).reduce((a, t) => a + t.amountCents, 0);
          const st = b !== null ? budgetStatus(spent, b) : null;
          return (
            <button className="item" key={c.id} onClick={() => setEdit({ scope: 'category', categoryId: c.id, title: c.name })}>
              <span className="mid"><b>{c.name}</b><small>{st ? `${formatEUR(spent)} von ${formatEUR(b ?? 0)}` : 'kein Limit'}</small>{st && <Bar ratio={st.ratio} color={barColor(st.ratio, st.over, 'var(--all)')} />}</span>
            </button>
          );
        })}
      </div>
      <p className="note">Ein Limit kann für alle Monate (Standard) oder nur für den gewählten Monat gelten. Im Alltag zeigt ein schmaler Balken unter dem Namen, wie viel davon schon ausgegeben ist.</p>
      {edit && <BudgetSheet {...edit} month={month} onClose={() => setEdit(null)} run={run} />}
    </>
  );
}
function shiftM(m: string, d: number): string {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1 + d;
  const dt = new Date(y, mo, 1);
  return `${String(dt.getFullYear()).padStart(4, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}
function BudgetSheet({ scope, categoryId, title, month, onClose, run }: { scope: 'month' | 'category'; categoryId?: string; title: string; month: string; onClose: () => void; run: ReturnType<typeof useStore>['run'] }) {
  const { data } = useStore();
  const [mode, setMode] = useState<'default' | 'month'>('default');
  const cur = data.budgets.find((b) => b.scope === scope && b.categoryId === categoryId && b.monthKey === (mode === 'default' ? 'default' : month));
  const [amount, setAmount] = useState(cur ? centsToGroupedInput(cur.amountCents) : '');
  const [err, setErr] = useState('');
  const pick = (m: 'default' | 'month') => {
    setMode(m);
    const b = data.budgets.find((x) => x.scope === scope && x.categoryId === categoryId && x.monthKey === (m === 'default' ? 'default' : month));
    setAmount(b ? centsToGroupedInput(b.amountCents) : '');
  };
  async function save(remove: boolean) {
    const cents = remove ? null : parseCents(amount);
    if (!remove && cents === null) return setErr('Bitte gib einen gültigen Betrag ein.');
    const p: Parameters<typeof setBudget>[1] = { scope, monthKey: mode === 'default' ? 'default' : month, amountCents: cents };
    if (categoryId) p.categoryId = categoryId;
    if (await run((db) => setBudget(db, p).then(() => true), 'Budget gespeichert')) onClose();
  }
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="seg"><button className={mode === 'default' ? 'on' : ''} onClick={() => pick('default')}>Alle Monate</button><button className={mode === 'month' ? 'on' : ''} onClick={() => pick('month')}>Nur {monthLabel(month)}</button></div>
      <div className="card flush"><label className="field"><span>Budget (€)</span><AmountInput label="Budget" value={amount} onChange={setAmount} placeholder="0,00" /></label></div>
      {err && <div className="err-text" role="alert">{err}</div>}
      <button className="btn" onClick={() => save(false)}>Speichern</button>
      {cur && <button className="btn danger" onClick={() => save(true)}>Budget entfernen</button>}
    </Sheet>
  );
}

