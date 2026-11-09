import { useEffect, useRef, useState } from 'react';
import { catArea, isHouseholdCat } from '../../domain/types';
import type { CatArea, CatGroup, TxType } from '../../domain/types';
import { useStore } from '../../state/store';
import { catIcon, categoryName, childrenOf, topLevel } from '../../domain/categories';
import { useAreaSwipe } from '../../ui/gestures';
import { Header } from '../../ui/Header';
import { GROUP_LABEL, GROUP_TILE } from '../../ui/groups';
import { Icon } from '../../ui/icons';
import { Chevr } from '../../ui/Collapse';
import { addCategory, deleteCategory, mergeCategory, renameCategory, setCategoryArchived, setCategoryGroup, setCategoryIcon, setCategoryParent } from '../../data/categories';
import { Sheet } from '../../ui/Sheet';
import { CAT_ICONS } from '../../domain/catIcons';

/* ───────── Kategorien ───────── */
/** Farbe je Bereich – dieselbe wie in Alltag, Fixkosten, Sparen und beim Haushaltskonto. */
const AREA_COLOR: Record<CatArea, string> = { alltag: 'var(--all)', fix: 'var(--fix)', spar: 'var(--spar)', einnahme: 'var(--inc)', joint: 'var(--hh)' };

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
  const tabbed = !group && !scope;
  const idx = Math.max(0, areas.findIndex(([a]) => a === areaView));
  const bodyRef = useRef<HTMLDivElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  // Aktiven Reiter in der Leiste sichtbar halten (sie scrollt, wenn nicht alles hineinpasst)
  useEffect(() => {
    const b = segRef.current?.querySelector<HTMLElement>(`[data-area="${areaView}"]`);
    const bar = segRef.current;
    if (b && bar) bar.scrollTo({ left: Math.max(0, b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2), behavior: 'smooth' });
  }, [areaView]);
  // Wischen im Inhalt: nach links → nächster Bereich, nach rechts → voriger; ganz links nach rechts übernimmt die App (zurück zu Mehr)
  const { go: goArea, handlers: areaSwipe } = useAreaSwipe(areas.map(([a]) => a), idx, setAreaView, bodyRef, true);
  return (
    <>
      {back}
      <Header kicker={scope === 'joint' ? (data.settings.joint?.name ?? 'Haushaltskonto') : group ? GROUP_LABEL[group] : undefined} title="Kategorien" right={<div className="mn">
        <button className="ib" aria-label="Neue Kategorie" onClick={() => setSheet({ parentId: null })}><Icon name="plus" size={22} w={2.2} /></button>
      </div>} />
      {!group && !scope && <div className="catseg" role="tablist" aria-label="Bereich" data-noswipe ref={segRef}>
        {areas.map(([a, l]) => <button key={a} role="tab" aria-selected={areaView === a} className={areaView === a ? 'on' : ''} style={{ ['--c' as string]: AREA_COLOR[a] }} data-area={a} onClick={() => goArea(a)}>{l}</button>)}
      </div>}
      <div className="catbody" ref={bodyRef} {...(tabbed ? { 'data-areas': '', 'data-first': idx === 0 ? '1' : '0', ...areaSwipe } : {})}>
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
      </div>
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
