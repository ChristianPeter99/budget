import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GROUP_LABEL, Header, Sheet } from './common';
import { Icon } from './icons';
import { toMessage, useStore } from '../state/store';
import { addCategory, deleteCategory, getMeta, importTransactions, setMeta, undoImport } from '../db/repo';
import type { ImportItem } from '../db/repo';
import { MAX_IMPORT_BYTES, NeedsMapping, assignBlocks, decodeBytes, bookable, detectLayout, detectRecurring, findDuplicates, findReturns, parseStatement, suggestCategory } from '../import/csv';
import type { Block, Candidate, ColumnMap, DupState, Layout, ParseResult } from '../import/csv';
import { ColumnMapper } from './ColumnMapper';
import { FixList, fixFromCandidates, fixPool, makeFixRow, saveFixRows } from './FixImport';
import type { FixRow } from './FixImport';
import { categoryName, topLevel } from '../domain/calc';
import { formatDateDE } from '../domain/dates';
import { formatEUR } from '../domain/money';
import type { Category, CatGroup, Transaction } from '../domain/types';
import type { Db } from '../db/db';
import { catArea, isHouseholdCat } from '../domain/types';
import type { CatArea } from '../domain/types';

/** Ein Eintrag der Prüfliste */
interface Row { c: Candidate; on: boolean; cat: string | null; dup: DupState; match?: Transaction; locked: boolean; /** Gegenbuchung, wenn Teil einer Retoure */ ret?: string }
type Tab = 'ausgaben' | 'fix' | 'erfasst' | 'weitere';
/** Gespeicherte Bankvorlage: Spaltenzuordnung unter einem Namen */
export interface BankTpl { id: string; name: string; signature: string; map: ColumnMap }
interface LastImport { ids: string[]; at: string; count: number }

const KIND_LABEL: Record<Candidate['kind'], string> = { expense: 'Ausgabe', credit: 'Gutschrift', roundup: 'Aufrundung', transfer: 'Umbuchung' };
const short = (iso: string) => formatDateDE(iso).slice(0, 6);
const tabOf = (r: Row, fixKey?: string): Tab => (r.ret ? 'weitere' : fixKey ? 'fix' : r.dup !== 'none' ? 'erfasst' : r.c.kind === 'expense' ? 'ausgaben' : 'weitere');

/** Bankvorlagen lesen (ältere Speicherung: Zuordnung je Aufbau ohne Namen) */
async function loadBanks(db: NonNullable<ReturnType<typeof useStore>['db']>): Promise<BankTpl[]> {
  const list = (await getMeta<BankTpl[]>(db, 'csvBanks')) ?? [];
  const legacy = (await getMeta<Record<string, ColumnMap>>(db, 'csvMaps')) ?? {};
  const extra = Object.entries(legacy).filter(([sig]) => !list.some((b) => b.signature === sig)).map(([sig, map], i) => ({ id: 'legacy' + i, name: `Gespeicherte Vorlage ${i + 1}`, signature: sig, map }));
  return [...list, ...extra];
}

/** Datei lesen: UTF-16, UTF-8 oder Windows-1252 (siehe decodeBytes). */
async function readText(file: File): Promise<string> {
  return decodeBytes(await file.arrayBuffer());
}

/**
 * Auffang-Kategorie für Zeilen ohne Kategorie: „Sonstiges › Sonstige“ (Ausgaben) bzw. „Sonstige Einnahmen“.
 * Fehlt sie, wird sie angelegt – im eigenen Bereich oder in den Kategorien des Haushaltskontos.
 */
async function ensureRest(db: Db, cats: Category[], kind: 'expense' | 'income', joint: boolean): Promise<string> {
  const scope = joint ? { scope: 'joint' as const } : {};
  const mine = cats.filter((c) => c.kind === kind && !c.archived && isHouseholdCat(c) === joint && (kind === 'income' || joint || c.group === 'alltag'));
  const isRest = (c: Category) => /^sonstig/i.test(c.name.trim());
  const group: CatGroup = kind === 'income' ? 'einnahme' : 'alltag';
  let top = mine.find((c) => !c.parentId && isRest(c));
  if (!top) top = await addCategory(db, { name: kind === 'income' ? 'Sonstige Einnahmen' : 'Sonstiges', kind, group, parentId: null, ...scope });
  const kids = cats.filter((c) => c.parentId === top!.id && !c.archived);
  if (kids.length === 0 && !cats.some((c) => c.parentId === top!.id)) return top.id;
  const kid = kids.find(isRest);
  if (kid) return kid.id;
  return (await addCategory(db, { name: 'Sonstige', kind, group: top.group, parentId: top.id, ...scope })).id;
}

/** Mehr › CSV-Import: Datei einlesen, prüfen, zuordnen, übernehmen. Bis „Übernehmen“ wird nichts gespeichert. */
export function ImportPage({ back }: { back: ReactNode }) {
  const { data, run, flash, db, reload } = useStore();
  const joint = data.settings.joint?.enabled ? data.settings.joint : undefined;
  const [account, setAccount] = useState<'own' | 'joint'>('own');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('ausgaben');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<{ title: string; keys: string[]; group?: string; kind: 'expense' | 'income' } | null>(null);
  const [last, setLast] = useState<LastImport | null>(null);
  const [blocks, setBlocks] = useState<Map<string, Block>>(new Map());
  const [detail, setDetail] = useState<string | null>(null);
  // Erkannte bzw. von Hand markierte Fixkosten (Reiter „Fixkosten“ der Prüfliste)
  const [fixes, setFixes] = useState<FixRow[]>([]);
  // Datei mit unbekanntem Aufbau: Spalten einmal zuordnen (als Bankvorlage gespeichert)
  const [mapping, setMapping] = useState<{ layout: Layout; text: string; bank?: string } | null>(null);
  const [lastFile, setLastFile] = useState<{ text: string; layout: Layout } | null>(null);
  const [banks, setBanks] = useState<BankTpl[]>([]);
  const [bankId, setBankId] = useState('');
  const [usedBank, setUsedBank] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  // Rückfrage: Zeilen ohne Kategorie nach „Sonstiges“?
  const [askRest, setAskRest] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cats = data.categories;

  useEffect(() => { if (db) void getMeta<LastImport>(db, 'lastImport').then((v) => setLast(v ?? null)); }, [db, data.transactions.length, data.jointTransactions.length]);
  useEffect(() => {
    if (!db) return;
    void loadBanks(db).then(setBanks);
    void getMeta<string>(db, 'csvBank').then((v) => setBankId(v ?? ''));
  }, [db]);
  const pickBank = (id: string) => { setBankId(id); if (db) void setMeta(db, 'csvBank', id || null); };
  async function storeBanks(list: BankTpl[]) {
    if (!db) return;
    // Ältere Speicherung in die benannten Vorlagen übernehmen
    await setMeta(db, 'csvBanks', list.map((b) => (b.id.startsWith('legacy') ? { ...b, id: crypto.randomUUID() } : b)));
    await setMeta(db, 'csvMaps', null);
    setBanks(await loadBanks(db));
  }
  async function removeBank(id: string) {
    await storeBanks(banks.filter((b) => b.id !== id));
    if (bankId === id) pickBank('');
    flash('Bankvorlage gelöscht');
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr('');
    if (f.size > MAX_IMPORT_BYTES) return setErr('Die Datei ist zu groß (höchstens 5 MB).');
    setBusy(true);
    try {
      const text = await readText(f);
      setFileName(f.name);
      const layout = detectLayout(text);
      // Gewählte Bank, sonst eine Vorlage mit gleichem Aufbau, sonst automatisch
      const tpl = bankId ? banks.find((b) => b.id === bankId) : banks.find((b) => b.signature === layout.signature);
      let res: ParseResult;
      try {
        res = await parseStatement(text, tpl?.map);
        if (tpl && res.candidates.length === 0) throw new NeedsMapping({ ...layout, map: tpl.map });
      } catch (e) {
        if (e instanceof NeedsMapping) { setMapping({ layout: tpl ? { ...e.layout, map: tpl.map } : e.layout, text, bank: tpl?.name }); return; }
        if (tpl) { setErr(`Die Vorlage „${tpl.name}“ passt nicht zu dieser Datei. Ordne die Spalten neu zu.`); setMapping({ layout: { ...layout, map: tpl.map }, text, bank: tpl.name }); return; }
        throw e;
      }
      setUsedBank(tpl?.name ?? null);
      setLastFile({ text, layout: tpl ? { ...layout, map: tpl.map } : layout });
      show(res);
    } catch (e) {
      setErr(toMessage(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** Zuordnung aus „Spalten zuordnen“ übernehmen und auf Wunsch als Bankvorlage speichern */
  async function applyMapping(map: ColumnMap, saveAs: string | null) {
    if (!mapping) return;
    setErr('');
    try {
      const res = await parseStatement(mapping.text, map);
      if (saveAs) {
        const name = saveAs.trim();
        const ex = banks.find((b) => b.name.toLowerCase() === name.toLowerCase());
        const tpl: BankTpl = { id: ex?.id && !ex.id.startsWith('legacy') ? ex.id : crypto.randomUUID(), name, signature: mapping.layout.signature, map };
        await storeBanks([...banks.filter((b) => b !== ex && b.signature !== tpl.signature), tpl]);
        pickBank(tpl.id);
        setUsedBank(name);
      } else setUsedBank(null);
      setLastFile({ text: mapping.text, layout: { ...mapping.layout, map } });
      setMapping(null);
      show(res);
    } catch (e) { setErr(toMessage(e)); }
  }

  /** Ergebnis anzeigen: Prüfliste (Buchungen) oder erkannte Fixkosten */
  function show(res: ParseResult) {
    const target = account === 'joint' ? data.jointTransactions : data.transactions;
    const other = account === 'joint' ? data.transactions : data.jointTransactions;
    const dups = findDuplicates(res.candidates, [...target, ...other.filter((t) => t.importId)]);
    // Gemerkte Zuordnungen und Kategorien je Konto getrennt (Haushaltskonto: Schlüssel mit „j:“)
    const joint = account === 'joint';
    const all = data.settings.importRules ?? {};
    const rules = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('j:') === joint).map(([k, v]) => [joint ? k.slice(2) : k, v]));
    const scoped = cats.filter((c) => isHouseholdCat(c) === joint);
    const returns = findReturns(res.candidates);
    const blk = assignBlocks(res.candidates);
    const okCat = new Set(scoped.map((c) => c.id));
    const list: Row[] = res.candidates.map((c) => {
      const d = dups.get(c.key) ?? { state: 'none' as const };
      // Händler gemerkt bzw. erkannt, sonst die für den ganzen Block (z. B. „Cafés & Kaffee“) gemerkte Kategorie
      const blockRule = blk.get(c.key) ? rules[blk.get(c.key)!.key] : undefined;
      const sug = c.kind === 'transfer' ? null : suggestCategory(c, scoped, rules) ?? (blockRule && okCat.has(blockRule) ? { categoryId: blockRule } : null);
      const locked = d.state === 'imported' || c.kind === 'transfer' || (account === 'joint' && c.kind !== 'expense');
      const ret = returns.get(c.key);
      return { c, dup: d.state, ...(d.match ? { match: d.match } : {}), ...(ret ? { ret } : {}), cat: sug?.categoryId ?? null, on: !locked && !ret && d.state === 'none' && c.kind === 'expense', locked };
    });
    setBlocks(blk);
    // Fixkosten gleich miterkennen (nur eigenes Konto): eigener Reiter, Vorlagen für den Reiter Fixkosten
    const fx = joint ? [] : detectRecurring(res.candidates).map((f) => makeFixRow(f, res.candidates, cats, data.recurring, rules)).filter((r) => r.keys.length > 0);
    const taken = new Set<string>();
    for (const r of fx) { r.keys = r.keys.filter((k) => !taken.has(k)); r.keys.forEach((k) => taken.add(k)); }
    setFixes(fx.filter((r) => r.keys.length > 0));
    setRows(list);
    setSkipped(res.skippedLines);
    setTab('ausgaben');
    setOpen(new Set());
    if (list.length === 0) setErr('In der Datei wurden keine Buchungen gefunden.');
  }

  // Zeile → Fixkosten, zu der sie gehört
  const fixOf = useMemo(() => { const m = new Map<string, FixRow>(); for (const f of fixes) for (const k of f.keys) m.set(k, f); return m; }, [fixes]);
  const groups = useMemo(() => {
    if (!rows) return [];
    const m = new Map<string, Row[]>();
    const titles = new Map<string, string>();
    for (const r of rows) {
      if (tabOf(r, fixOf.get(r.c.key)?.f.key) !== tab) continue;
      const b = r.ret ? { key: 'block:retouren', title: 'Retouren' } : blocks.get(r.c.key);
      const k = b?.key ?? `${r.c.kind}|${r.c.payeeKey}`;
      if (b) titles.set(k, b.title);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    const out = [...m.entries()].map(([k, rs]) => ({
      k, block: titles.has(k), title: titles.get(k) ?? rs[0]!.c.payee,
      rows: k === 'block:retouren' ? sortReturns(rs) : [...rs].sort((a, b) => b.c.amountCents - a.c.amountCents || b.c.date.localeCompare(a.c.date)),
      total: rs.reduce((a, r) => a + r.c.amountCents, 0)
    }));
    // Höchste Beträge zuerst – so ordnest du zuerst zu, was am meisten ausmacht
    return out.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
  }, [rows, tab, blocks, fixOf]);

  const counts = useMemo(() => {
    const n: Record<Tab, number> = { ausgaben: 0, fix: fixes.length, erfasst: 0, weitere: 0 };
    for (const r of rows ?? []) { const t = tabOf(r, fixOf.get(r.c.key)?.f.key); if (t !== 'fix') n[t]++; }
    return n;
  }, [rows, fixes.length, fixOf]);
  // Kategorie einer Zeile: bei Fixkosten die der Fixkosten
  const catOf = (r: Row) => fixOf.get(r.c.key)?.cat || r.cat;
  const chosen = (rows ?? []).filter((r) => r.on);
  const missing = chosen.filter((r) => !catOf(r)).length;
  const newFix = fixes.filter((f) => f.on && !f.same && f.cat).length;
  const booked = fixes.map((f) => f.keys.filter((k) => rows?.find((r) => r.c.key === k)?.on).length);
  const sum = chosen.reduce((a, r) => a + (r.c.kind === 'credit' ? -r.c.amountCents : r.c.amountCents), 0);

  const update = (keys: string[], fn: (r: Row) => Row) => setRows((rs) => rs && rs.map((r) => (keys.includes(r.c.key) ? fn(r) : r)));
  const toggleOpen = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  /** Zeilen von Hand als Fixkosten markieren (eine Zahlung je Händler) */
  function markFix(keys: string[]) {
    if (!rows) return;
    const list = rows.filter((r) => keys.includes(r.c.key) && r.c.kind === 'expense' && !r.ret);
    if (list.length === 0) return;
    const byPayee = new Map<string, Candidate[]>();
    for (const r of list) byPayee.set(r.c.payeeKey, [...(byPayee.get(r.c.payeeKey) ?? []), r.c]);
    const pool = new Set(fixPool(cats).map((c) => c.id));
    const add = [...byPayee.values()].map((cs) => {
      const cur = rows.find((r) => r.c.key === cs[0]!.key)?.cat;
      return { ...makeFixRow(fixFromCandidates(cs), cs, cats, data.recurring, data.settings.importRules ?? {}, cs.map((c) => c.key), cur && pool.has(cur) ? cur : undefined), manual: true };
    });
    const moved = new Set(add.flatMap((a) => a.keys));
    setFixes((fs) => [...fs.map((f) => ({ ...f, keys: f.keys.filter((k) => !moved.has(k)) })).filter((f) => f.keys.length > 0), ...add.filter((a) => !fs.some((f) => f.f.key === a.f.key))]);
    flash(add.length === 1 ? `„${add[0]!.f.name}“ zu Fixkosten verschoben` : `${add.length} Händler zu Fixkosten verschoben`, 'ok');
  }

  async function commit(toRest = false) {
    if (!rows || (chosen.length === 0 && newFix === 0) || (missing > 0 && !toRest)) return;
    setAskRest(false);
    // Fehlende Kategorien: Auffang-Kategorie „Sonstiges“ (wird nicht als Zuordnung gemerkt)
    const restFor = { expense: '', income: '' };
    if (toRest && missing > 0) {
      const need = new Set(chosen.filter((r) => !catOf(r)).map((r) => (r.c.kind === 'credit' ? 'income' : 'expense') as 'expense' | 'income'));
      const got = await run(async (d) => {
        const out = { expense: '', income: '' };
        for (const k of need) out[k] = await ensureRest(d, cats, k, account === 'joint');
        return out;
      });
      if (!got) return;
      Object.assign(restFor, got);
    }
    const catFor = (r: Row) => catOf(r) || restFor[r.c.kind === 'credit' ? 'income' : 'expense'];
    const items: ImportItem[] = chosen.map((r) => ({
      date: r.c.date, type: r.c.kind === 'credit' ? 'income' : 'expense', amountCents: r.c.amountCents, categoryId: catFor(r),
      description: r.c.payee.slice(0, 120), importId: r.c.key, ...(account === 'joint' ? { account: 'joint' as const } : {})
    }));
    // Zuordnung merken: je Empfänger, wenn alle übernommenen Zeilen dieselbe Kategorie haben
    const rules: Record<string, string> = {};
    const byPayee = new Map<string, Set<string>>();
    for (const r of chosen) if (r.c.payeeKey && catOf(r)) byPayee.set(r.c.payeeKey, (byPayee.get(r.c.payeeKey) ?? new Set()).add(catOf(r) as string));
    // Zahlungsdienste (PayPal, Klarna) bündeln verschiedene Händler – dafür nichts merken
    for (const [k, s] of byPayee) if (s.size === 1 && !/^(paypal|klarna)/.test(k)) rules[(account === 'joint' ? 'j:' : '') + k] = [...s][0] as string;
    // Auch je Block merken (z. B. alle Cafés → Essen gehen), damit neue Händler gleicher Art schon zugeordnet sind
    const byBlock = new Map<string, Set<string>>();
    for (const r of chosen) { const b = blocks.get(r.c.key); if (b && catOf(r) && !fixOf.has(r.c.key)) byBlock.set(b.key, (byBlock.get(b.key) ?? new Set()).add(catOf(r) as string)); }
    for (const [k, s] of byBlock) if (s.size === 1) rules[(account === 'joint' ? 'j:' : '') + k] = [...s][0] as string;
    setBusy(true);
    const out = await run(async (d) => {
      const res = items.length ? await importTransactions(d, items, rules) : [];
      if (res.length) await setMeta(d, 'lastImport', { ids: res, at: new Date().toISOString(), count: res.length } satisfies LastImport);
      // Danach die Vorlagen: sie übernehmen die eben importierten Buchungen ihres Monats, statt doppelt zu buchen
      const nf = await saveFixRows(d, fixes);
      return { ids: res, nf };
    });
    setBusy(false);
    if (!out) return;
    const { ids, nf } = out;
    setRows(null);
    setFixes([]);
    if (ids.length) setLast({ ids, at: new Date().toISOString(), count: ids.length });
    const txt = [ids.length ? `${ids.length} Buchung${ids.length === 1 ? '' : 'en'}` : '', nf ? `${nf} Fixkosten` : ''].filter(Boolean).join(' und ');
    flash(`${txt} übernommen`, 'ok', ids.length ? { label: 'Rückgängig', run: () => void undo(ids) } : undefined);
  }

  async function undo(ids: string[]) {
    const n = await run(async (d) => { const k = await undoImport(d, ids); await setMeta(d, 'lastImport', null); return k; });
    if (n !== undefined) { setLast(null); flash(`${n} importierte Buchung${n === 1 ? '' : 'en'} entfernt`); await reload(); }
  }

  /* ───── Spalten zuordnen (unbekannter Aufbau) ───── */
  if (mapping) {
    return <ColumnMapper layout={mapping.layout} text={mapping.text} fileName={fileName} err={err} bank={mapping.bank ?? banks.find((b) => b.id === bankId)?.name ?? ''} banks={banks.map((b) => b.name)}
      onApply={(m, name) => void applyMapping(m, name)} onCancel={() => { setMapping(null); setErr(''); }} />;
  }

  /* ───── Schritt 1: Datei wählen ───── */
  if (!rows) {
    return (
      <>
        {back}
        <Header title="CSV-Import" />
        <p className="note">Lies einen Kontoauszug als CSV ein, von jeder Bank. Kennt die App den Aufbau noch nicht, ordnest du die Spalten einmal zu. Gespeichert wird erst bei „Übernehmen“. Die Datei bleibt auf dem Gerät.</p>
        <div className="card flush">
          <label className="field bankpick">
            <span>Bank</span>
            <select value={bankId} onChange={(e) => pickBank(e.target.value)} aria-label="Bank">
              <option value="">Automatisch erkennen</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {banks.length > 0 && <button className="linkbtn padl" aria-expanded={manage} onClick={() => setManage(!manage)}>{manage ? 'Fertig' : `Bankvorlagen verwalten (${banks.length})`}</button>}
          {manage && banks.map((b) => (
            <div className="kv bankrow" key={b.id}><span>{b.name}</span><button className="linkbtn danger" onClick={() => void removeBank(b.id)} aria-label={`Bankvorlage ${b.name} löschen`}>Löschen</button></div>
          ))}
        </div>
        {joint && (
          <div className="seg" role="tablist" aria-label="Zielkonto">
            <button role="tab" aria-selected={account === 'own'} className={account === 'own' ? 'on' : ''} onClick={() => setAccount('own')}>Mein Konto</button>
            <button role="tab" aria-selected={account === 'joint'} className={account === 'joint' ? 'on' : ''} onClick={() => setAccount('joint')}>{joint.name}</button>
          </div>
        )}
        <label className={'btn' + (busy ? ' busy' : '')} role="button" aria-disabled={busy}>
          {busy ? 'Wird gelesen …' : 'CSV-Datei auswählen'}
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv,text/comma-separated-values,text/tab-separated-values,text/plain" aria-label="CSV-Datei" className="vh" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {err && <div className="err-text" role="alert">{err}</div>}
        <div className="card flush">
          <div className="sec"><h2>So funktioniert’s</h2></div>
          <ul className="howto">
            <li><b>Schon erfasst</b> (gleicher Betrag, gleiches Datum): wird nicht importiert</li>
            <li><b>Ähnlich</b> (bis 3 Tage daneben): abgewählt, zum Prüfen</li>
            <li><b>Aufrundungen, Umbuchungen, Gutschriften</b>: ausgeblendet, einzeln wählbar</li>
            <li><b>Gleicher Händler</b>: gebündelt, eine Kategorie für alle, wird für das nächste Mal gemerkt</li>
            <li><b>Fixkosten</b> (Miete, Versicherungen, Abos …): werden erkannt und als Vorlage für den Reiter Fixkosten angeboten; was fehlt, markierst du selbst</li>
            <li><b>Neue Bank</b>: Spalten einmal zuordnen und als Bankvorlage speichern</li>
          </ul>
        </div>
        {last && last.count > 0 && (
          <div className="card flush">
            <div className="kv"><span>Letzter Import</span><b>{last.count} Buchung{last.count === 1 ? '' : 'en'} · {formatDateDE(last.at.slice(0, 10))}</b></div>
            <div className="pad"><button className="btn sec2" onClick={() => void undo(last.ids)}>Letzten Import rückgängig machen</button></div>
          </div>
        )}
      </>
    );
  }

  /* ───── Schritt 2: prüfen und zuordnen ───── */
  const tabs: [Tab, string][] = account === 'joint' ? [['ausgaben', 'Ausgaben'], ['erfasst', 'Schon da'], ['weitere', 'Weitere']] : [['ausgaben', 'Ausgaben'], ['fix', 'Fixkosten'], ['erfasst', 'Schon da'], ['weitere', 'Weitere']];
  return (
    <>
      <button className="back" onClick={() => setRows(null)}><Icon name="left" size={16} w={2.2} />Abbrechen</button>
      <Header kicker={usedBank ? `${fileName} · ${usedBank}` : fileName} title="Prüfen & zuordnen" />
      {lastFile && <button className="linkbtn" onClick={() => { setRows(null); setMapping({ layout: lastFile.layout, text: lastFile.text }); }}>Spalten falsch erkannt? Zuordnung ändern</button>}
      <div className="seg" role="tablist" aria-label="Ansicht">
        {tabs.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={(tab === t ? 'on' : '') + (t === 'fix' ? ' tfix' : '')} onClick={() => setTab(t)}>{l} {counts[t]}</button>)}
      </div>
      <p className="note">
        {tab === 'ausgaben' && 'Höchste Beträge zuerst. Gleichartige Händler (Supermärkte, Cafés, Bäckereien, Drogerien, Lieferdienste …) sind gebündelt – eine Kategorie gilt für den ganzen Block und wird gemerkt. Was ohne Kategorie bleibt, kann beim Übernehmen nach „Sonstiges“.'}
        {tab === 'fix' && (fixes.length ? 'Wiederkehrende Zahlungen aus der Datei. Angehakte kommen einmalig als Vorlage in den Reiter Fixkosten – ab dann bucht die App sie jeden Monat selbst. Ihre Buchungen aus der Datei werden mit übernommen und der Vorlage zugeordnet. Fehlt etwas: unter „Ausgaben“ auf „Kategorie wählen“ tippen › „Als Fixkosten erkennen“.' : 'Keine wiederkehrenden Zahlungen erkannt. Fixkosten markierst du unter „Ausgaben“ über „Kategorie wählen“ › „Als Fixkosten erkennen“. Tipp: Eine Datei über mehrere Monate hilft beim Erkennen.')}
        {tab === 'erfasst' && 'Diese Ausgaben gibt es in der App wahrscheinlich schon (gleicher Betrag, gleiches oder nahes Datum). Sie sind abgewählt; bei Bedarf einzeln anhaken.'}
        {tab === 'weitere' && 'Retouren (Ausgabe und gleich hohe Gutschrift), Aufrundungen, Umbuchungen und Gutschriften werden normalerweise nicht übernommen. Gutschriften lassen sich als Einnahme, Aufrundungen als Sparen übernehmen.'}
        {skipped > 0 && ` ${skipped} Zeile${skipped === 1 ? '' : 'n'} konnte${skipped === 1 ? '' : 'n'} nicht gelesen werden.`}
      </p>
      {tab === 'fix' && fixes.length > 0 && (
        <FixList rows={fixes} cats={cats} booked={booked} onChange={(i, p) => setFixes((fs) => fs.map((f, k) => (k === i ? { ...f, ...p } : f)))}
          onUnmark={(i) => setFixes((fs) => fs.filter((_, k) => k !== i))} />
      )}
      {tab !== 'fix' && groups.length === 0 && <div className="empty">Nichts in dieser Ansicht.</div>}
      {tab !== 'fix' && groups.map((g) => {
        const first = g.rows[0]!;
        const kind = first.c.kind === 'credit' ? 'income' : 'expense';
        const free = g.rows.filter((r) => !r.locked);
        const allOn = free.length > 0 && free.every((r) => r.on);
        const someOn = free.some((r) => r.on);
        const catSet = new Set(g.rows.filter((r) => r.on || g.rows.every((x) => !x.on)).map((r) => r.cat));
        const gcat = catSet.size === 1 ? [...catSet][0] : 'mixed';
        const gsum = g.rows.reduce((a, r) => a + r.c.amountCents, 0);
        const multi = g.rows.length > 1;
        const isOpen = multi && open.has(g.k);
        const isRet = g.k === 'block:retouren';
        const canCat = !isRet && first.c.kind !== 'transfer' && !(account === 'joint' && kind === 'income');
        const rowCat = (r: Row) => r.c.kind !== 'transfer' && !r.locked && !(account === 'joint' && r.c.kind === 'credit');
        return (
          <div className={'card flush imp' + (someOn ? '' : ' off')} key={g.k}>
            <div className="imphead">
              <button className={'check' + (allOn ? ' on' : someOn ? ' part' : '')} role="checkbox" aria-checked={allOn ? true : someOn ? 'mixed' : false} aria-label={`${g.title} übernehmen`} disabled={free.length === 0}
                onClick={() => update(free.map((r) => r.c.key), (r) => ({ ...r, on: !allOn }))}>{allOn && <Icon name="check" size={14} w={3} />}{!allOn && someOn && <i />}</button>
              <button className="clickrow impname" onClick={() => (multi ? toggleOpen(g.k) : setDetail(first.c.key))} aria-expanded={multi ? isOpen : undefined} aria-label={multi ? `${g.title}: ${g.rows.length} Buchungen ${isOpen ? 'zuklappen' : 'aufklappen'}` : `Details zu ${g.title}`}>
                <span className="impnm">
                  <b>{g.title}</b>
                  <span className="mini">{isRet ? `${g.rows.length / 2} Rückbuchung${g.rows.length === 2 ? '' : 'en'} · ${[...new Set(g.rows.map((r) => r.c.payee))].slice(0, 4).join(', ')}` : <>{multi ? `${g.rows.length} Buchungen` : short(first.c.date)}{g.block ? ` · ${[...new Set(g.rows.map((r) => r.c.payee))].slice(0, 4).join(', ')}` : `${first.c.kind !== 'expense' ? ' · ' + KIND_LABEL[first.c.kind] : ''}${first.c.bankSub || first.c.bankCategory ? ' · ' + (first.c.bankSub || first.c.bankCategory) : ''}`}</>}</span>
                </span>
                <span className="impamt">{isRet ? formatEUR(g.rows.filter((r) => r.c.kind === 'credit').reduce((a, r) => a + r.c.amountCents, 0)) : `${first.c.kind === 'credit' ? '+' : ''}${formatEUR(gsum)}`}{multi && <span className="impchev" aria-hidden="true"><Icon name={isOpen ? 'up' : 'down'} size={16} w={2.2} /></span>}</span>
              </button>
            </div>
            {canCat && (
              <button className={'catpick' + (someOn && gcat === null ? ' need' : '')} onClick={() => setPicker({ title: g.title, keys: g.rows.filter((r) => !r.locked).map((r) => r.c.key), group: g.block ? g.k : first.c.payeeKey, kind })} disabled={free.length === 0}>
                <Icon name="tag" size={16} />
                <span>{gcat === 'mixed' ? 'Verschiedene Kategorien' : gcat ? categoryName(cats, gcat) : 'Kategorie wählen'}</span>
                {gcat && gcat !== 'mixed' && g.rows.every((r) => (data.settings.importRules ?? {})[(account === 'joint' ? 'j:' : '') + r.c.payeeKey] === gcat) && <span className="tag">gemerkt</span>}
              </button>
            )}
            {isRet && <div className="impnote">Ausgabe und Gutschrift mit gleichem Betrag beim selben Händler, z. B. eine Rücksendung. Beide sind abgewählt und zählen damit nicht in deine Ausgaben.</div>}
            {first.c.kind === 'transfer' && <div className="impnote">Umbuchung zwischen eigenen Konten – wird nicht importiert.</div>}
            {!multi && first.dup === 'imported' && <div className="impnote">Schon importiert</div>}
            {!multi && first.match && <div className="impnote">{first.dup === 'same' ? 'Schon erfasst' : 'Ähnlich'}: {short(first.match.date)} · {categoryName(cats, first.match.categoryId)}{first.match.description ? ` · ${first.match.description}` : ''}</div>}
            {isOpen && g.rows.map((r) => (
              <div className={'improw' + (r.on ? '' : ' off')} key={r.c.key}>
                <button className={'check' + (r.on ? ' on' : '')} role="checkbox" aria-checked={r.on} aria-label={`${r.c.payee} ${short(r.c.date)} ${formatEUR(r.c.amountCents)} übernehmen`} disabled={r.locked}
                  onClick={() => update([r.c.key], (x) => ({ ...x, on: !x.on }))}>{r.on && <Icon name="check" size={14} w={3} />}</button>
                <button className="clickrow impinfo" aria-label={`Details: ${r.c.payee} ${short(r.c.date)} ${formatEUR(r.c.amountCents)}`} onClick={() => setDetail(r.c.key)}>
                  <span>{isRet ? r.c.payee : `${short(r.c.date)}${g.block ? ` · ${r.c.payee}` : r.c.detail ? ` · ${r.c.detail}` : ''}`}</span>
                  {isRet && <span className="mini">{r.c.kind === 'credit' ? 'Gutschrift' : 'Ausgabe'} · {short(r.c.date)}</span>}
                  {r.dup === 'imported' && <span className="mini">Schon importiert</span>}
                  {r.match && <span className="mini">{r.dup === 'same' ? 'Schon erfasst' : 'Ähnlich'}: {short(r.match.date)} · {categoryName(cats, r.match.categoryId)}{r.match.description ? ` · ${r.match.description}` : ''}</span>}
                  {(isRet ? rowCat(r) && r.on : canCat && r.cat !== gcat && !r.locked) && <span className="mini">{r.cat ? categoryName(cats, r.cat) : 'ohne Kategorie'}</span>}
                </button>
                {(isRet ? rowCat(r) && r.on : canCat && !r.locked) && (
                  <button className="ib sm" aria-label={`Kategorie für Buchung vom ${short(r.c.date)} ändern`} onClick={() => setPicker({ title: `${r.c.payee} · ${short(r.c.date)}`, keys: [r.c.key], kind: r.c.kind === 'credit' ? 'income' : 'expense' })}><Icon name="tag" size={16} /></button>
                )}
                <span className={'impamt' + (r.c.kind === 'credit' ? ' inc' : '')}>{r.c.kind === 'credit' ? '+' : isRet ? '−' : ''}{formatEUR(r.c.amountCents)}</span>
              </div>
            ))}
          </div>
        );
      })}
      <div style={{ height: 90 }} />
      <div className="selbar" role="region" aria-label="Übernehmen">
        <span>{chosen.length} ausgewählt · {formatEUR(Math.abs(sum))}{newFix > 0 && <><br /><small className="fixtxt">+ {newFix} Fixkosten-Vorlage{newFix === 1 ? '' : 'n'}</small></>}{missing > 0 && <><br /><small className="needtxt">{missing} ohne Kategorie</small></>}</span>
        <button className="btn" disabled={busy || (chosen.length === 0 && newFix === 0)} onClick={() => (missing > 0 ? setAskRest(true) : void commit())}>Übernehmen</button>
      </div>
      {detail && rows.find((r) => r.c.key === detail) && (() => {
        const r = rows.find((x) => x.c.key === detail)!;
        const kind = r.c.kind === 'credit' ? 'income' : 'expense';
        const canCat = r.c.kind !== 'transfer' && !r.locked && !(account === 'joint' && kind === 'income');
        return (
          <DetailSheet r={r} cats={cats} fix={fixOf.get(r.c.key)?.f.name} onFix={account === 'own' && r.c.kind === 'expense' && !r.ret && !fixOf.has(r.c.key) ? () => { setDetail(null); markFix(rows.filter((x) => x.c.payeeKey === r.c.payeeKey && tabOf(x) === tabOf(r)).map((x) => x.c.key)); } : undefined} block={r.ret ? 'Retouren' : blocks.get(r.c.key)?.title} partner={r.ret ? rows.find((x) => x.c.key === r.ret)?.c : undefined} onClose={() => setDetail(null)}
            onToggle={r.locked ? undefined : () => update([r.c.key], (x) => ({ ...x, on: !x.on }))}
            onCategory={canCat ? () => { setDetail(null); setPicker({ title: `${r.c.payee} · ${short(r.c.date)}`, keys: [r.c.key], kind }); } : undefined} />
        );
      })()}
      {askRest && (() => {
        const rest = chosen.filter((r) => !catOf(r));
        const cents = rest.reduce((a, r) => a + r.c.amountCents, 0);
        const firstTab = rest[0] ? tabOf(rest[0], fixOf.get(rest[0].c.key)?.f.key) : 'ausgaben';
        return (
          <Sheet title="Ohne Kategorie" onClose={() => setAskRest(false)} left="Zurück">
            <div className="pad stack restask">
              <p><b>{rest.length === 1 ? '1 Buchung hat' : `${rest.length} Buchungen haben`} noch keine Kategorie</b> ({formatEUR(cents)}).</p>
              <p className="note">Sollen sie in <b>Sonstiges</b> übernommen werden? Du kannst sie später jederzeit unter Buchungen einer anderen Kategorie zuordnen. „Sonstiges“ wird dabei nicht für den nächsten Import gemerkt.</p>
              <ul className="restlist">
                {rest.slice(0, 5).map((r) => <li key={r.c.key}><span>{r.c.payee}</span><b className="num">{formatEUR(r.c.amountCents)}</b></li>)}
                {rest.length > 5 && <li className="mini">… und {rest.length - 5} weitere</li>}
              </ul>
              <button className="btn" disabled={busy} onClick={() => void commit(true)}>Ja, in Sonstiges übernehmen</button>
              <button className="btn sec2" onClick={() => { setAskRest(false); setTab(firstTab); }}>Erst noch zuordnen</button>
            </div>
          </Sheet>
        );
      })()}
      {picker && (
        <CategoryPicker title={picker.title} cats={cats} current={rows?.find((r) => picker.keys.includes(r.c.key))?.cat ?? null} household={account === 'joint' && picker.kind === 'expense'} kind={picker.kind} hint={picker.group && /^(paypal|klarna)/.test(picker.group) ? 'Gilt für alle angezeigten Buchungen. Bei Zahlungsdiensten wird nichts gemerkt, weil dahinter verschiedene Händler stecken.' : picker.group?.startsWith('block:') ? 'Gilt für alle Buchungen in diesem Block und wird je Händler für den nächsten Import gemerkt.' : picker.group ? 'Gilt für alle Buchungen dieses Händlers und wird für den nächsten Import gemerkt.' : 'Gilt nur für diese Buchung.'}
          onClose={() => setPicker(null)}
          onFix={account === 'own' && picker.kind === 'expense' && tab === 'ausgaben' ? () => { const k = picker.keys; setPicker(null); markFix(k); } : undefined}
          onPick={(id) => { update(picker.keys, (r) => ({ ...r, cat: id, on: r.locked ? r.on : r.on || tab === 'weitere' || picker.keys.length === 1 })); setPicker(null); }} />
      )}
    </>
  );
}

/** Retouren paarweise: Ausgabe, darunter ihre Gutschrift; neueste Paare zuerst */
function sortReturns(rs: Row[]): Row[] {
  const byKey = new Map(rs.map((r) => [r.c.key, r]));
  const exp = rs.filter((r) => r.c.kind === 'expense').sort((a, b) => b.c.date.localeCompare(a.c.date));
  return exp.flatMap((e) => { const cr = e.ret ? byKey.get(e.ret) : undefined; return cr ? [e, cr] : [e]; });
}

const STATE_TEXT: Record<DupState, string> = { none: 'Neu', imported: 'Schon importiert', same: 'Schon erfasst', maybe: 'Ähnliche Buchung vorhanden' };

/** Alle Angaben der Bank zu einer Zeile, dazu was die App damit vorhat */
function DetailSheet({ r, cats, block, partner, fix, onClose, onToggle, onCategory, onFix }: { r: Row; cats: Category[]; block?: string; partner?: Candidate; fix?: string; onClose: () => void; onToggle?: () => void; onCategory?: () => void; onFix?: () => void }) {
  const c = r.c, raw = c.raw;
  const kv = (label: string, value: ReactNode) => <div className="kv dkv"><span>{label}</span><b>{value}</b></div>;
  return (
    <Sheet title={c.payee} onClose={onClose} left="Fertig">
      <div className="amtbox"><span className="a">{c.kind === 'credit' ? '+' : ''}{formatEUR(c.amountCents)}</span><span className="mini">{KIND_LABEL[c.kind]}{raw.type ? ` · ${raw.type}` : ''}</span></div>
      <div className="card flush">
        <div className="sec"><h2>In der App</h2></div>
        {kv('Status', r.locked && r.dup === 'none' ? 'wird nicht importiert' : STATE_TEXT[r.dup])}
        {r.match && kv('Vorhandene Buchung', `${formatDateDE(r.match.date)} · ${formatEUR(r.match.amountCents)} · ${categoryName(cats, r.match.categoryId)}${r.match.description ? ` · ${r.match.description}` : ''}`)}
        {kv('Kategorie', r.cat ? categoryName(cats, r.cat) : '–')}
        {block && kv('Block', block)}
        {fix && kv('Fixkosten', fix)}
        {partner && kv(partner.kind === 'credit' ? 'Gutschrift dazu' : 'Ursprüngliche Ausgabe', `${formatDateDE(partner.date)} · ${formatEUR(partner.amountCents)} · ${partner.payee}`)}
        {kv('Bezeichnung', c.payee)}
        {kv('Datum', formatDateDE(c.date))}
        {(onToggle || onCategory || onFix) && (
          <div className="pad stack">
            {onCategory && <button className="btn sec2" onClick={onCategory}>Kategorie ändern</button>}
            {onFix && <button className="btn sec2" onClick={onFix}>Als Fixkosten markieren</button>}
            {onToggle && <button className="btn sec2" onClick={onToggle}>{r.on ? 'Nicht übernehmen' : 'Übernehmen'}</button>}
          </div>
        )}
      </div>
      <div className="card flush">
        <div className="sec"><h2>Laut Kontoauszug</h2></div>
        {kv('Empfänger', raw.payee || '–')}
        {c.date !== c.bookingDate || raw.time ? kv('Kauf / Karteneinsatz', `${formatDateDE(c.date)}${raw.time ? `, ${raw.time} Uhr` : ''}`) : null}
        {kv('Buchungsdatum', formatDateDE(c.bookingDate))}
        {raw.amountText && kv('Betrag', raw.amountText)}
        {(c.bankCategory || c.bankSub) && kv('Kategorie der Bank', [c.bankCategory, c.bankSub].filter((x, i, a) => x && a.indexOf(x) === i).join(' › '))}
        {raw.zweck && kv('Verwendungszweck', raw.zweck)}
        {raw.desc && raw.desc !== raw.payee && kv('Beschreibung', raw.desc)}
        {raw.iban && kv('IBAN', raw.iban)}
        {raw.cash && kv('Bargeldabhebung', raw.cash)}
      </div>
      <p className="note">Diese Angaben stammen aus der Datei und werden nicht gespeichert. Übernommen werden Datum, Betrag, Kategorie und Bezeichnung.</p>
    </Sheet>
  );
}

function CategoryPicker({ title, cats: allCats, current, household, kind, hint, onPick, onClose, onFix }: { title: string; cats: Category[]; current: string | null; household: boolean; kind: 'expense' | 'income'; hint: string; onPick: (id: string) => void; onClose: () => void; onFix?: () => void }) {
  // Eigenes Konto, Ausgaben: Alltag und Fixkosten getrennt wählbar; Vorgabe ist der Bereich der bisherigen Kategorie
  const cur = current ? allCats.find((c) => c.id === current) : undefined;
  const [area, setArea] = useState<'alltag' | 'fix' | 'spar'>(() => { const a = cur ? catArea(cur) : 'alltag'; return a === 'fix' || a === 'spar' ? a : 'alltag'; });
  const want: CatArea = household ? 'joint' : kind === 'income' ? 'einnahme' : area;
  // Nur die Liste des Zielkontos bzw. Bereichs; neue Kategorien landen ebenfalls dort
  const cats = allCats.filter((c) => catArea(c) === want);
  const scope = household ? { scope: 'joint' as const } : {};
  const { run, data } = useStore();
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [newTop, setNewTop] = useState<{ name: string; sub: string; group: CatGroup } | null>(null);
  const pool = bookable(cats, kind);
  const ids = new Set(pool.map((c) => c.id));
  const jointId = data.settings.joint?.categoryId;
  const tops = topLevel(cats, kind).filter((t) => !t.archived && t.id !== jointId);
  // Hauptkategorien ohne Unterkategorien (z. B. Miete, Sparen, Einnahmen) direkt wählbar
  const lone = tops.filter((t) => ids.has(t.id));
  async function create(top: Category) {
    if (!name.trim()) return;
    const c = await run((db) => addCategory(db, { name: name.trim(), kind, group: top.group, parentId: top.id, ...scope }), `„${name.trim()}“ angelegt`);
    if (c) onPick(c.id);
  }
  async function createTop() {
    if (!newTop || !newTop.name.trim()) return;
    const group: CatGroup = kind === 'income' ? 'einnahme' : newTop.group;
    const id = await run(async (db) => {
      const top = await addCategory(db, { name: newTop.name.trim(), kind, group: household ? 'alltag' : group, parentId: null, ...scope });
      if (!newTop.sub.trim()) return top.id;
      try { return (await addCategory(db, { name: newTop.sub.trim(), kind, group: household ? 'alltag' : group, parentId: top.id, ...scope })).id; }
      catch (e) { await deleteCategory(db, top.id); throw e; }
    }, `„${newTop.name.trim()}“ angelegt`);
    if (id) onPick(id);
  }
  return (
    <Sheet title={title} onClose={onClose}>
      {kind === 'expense' && !household && (
        <div className="fseg" role="tablist" aria-label="Bereich">
          {([['alltag', 'Alltag'], ['fix', 'Fixkosten'], ['spar', 'Sparen']] as const).map(([a, l]) => <button key={a} role="tab" aria-selected={area === a} className={area === a ? 'on' : ''} onClick={() => { setArea(a); setAdding(null); setNewTop(null); }}>{l}</button>)}
        </div>
      )}
      {onFix && (
        <button className="fixoffer" onClick={onFix}>
          <span className="fixoffer-ic"><Icon name="cal" size={18} w={2.2} /></span>
          <span className="fixoffer-tx"><b>Als Fixkosten erkennen</b><span>Wiederkehrende Zahlung (Miete, Abo, Vertrag …) – wird im Reiter Fixkosten als Vorlage angelegt</span></span>
          <Icon name="right" size={16} w={2.2} />
        </button>
      )}
      <p className="note">{hint} Fehlt eine Unterkategorie, lege sie mit „+“ an; ganz unten kannst du eine neue Kategorie anlegen.</p>
      {tops.map((t) => {
        const kids = pool.filter((c) => c.parentId === t.id);
        if (kids.length === 0) return null;
        return (
          <div key={t.id} className="stack" style={{ gap: 8 }}>
            <span className="mini">{t.name}</span>
            <div className="sel">
              {kids.map((c) => <button key={c.id} onClick={() => onPick(c.id)}>{c.name}</button>)}
              {adding !== t.id && <button className="addsub" aria-label={`Neue Unterkategorie in ${t.name}`} onClick={() => { setAdding(t.id); setName(''); }}><Icon name="plus" size={18} w={2.2} /></button>}
            </div>
            {adding === t.id && (
              <form className="newsub" onSubmit={(e) => { e.preventDefault(); void create(t); }}>
                <input autoFocus value={name} maxLength={40} placeholder={`Neu in ${t.name}`} aria-label={`Name der neuen Unterkategorie in ${t.name}`} onChange={(e) => setName(e.target.value)} />
                <button type="submit" className="btn" disabled={!name.trim()}>Anlegen</button>
              </form>
            )}
          </div>
        );
      })}
      {lone.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="mini">{kind === 'income' ? 'Einnahmen' : household ? 'Ohne Unterkategorie' : area === 'fix' ? 'Fixkosten' : area === 'spar' ? 'Sparen' : 'Ohne Unterkategorie'}</span>
          <div className="sel">{lone.map((c) => <button key={c.id} onClick={() => onPick(c.id)}>{c.name}</button>)}</div>
        </div>
      )}
      {!newTop && <button className="btn sec2" onClick={() => setNewTop({ name: '', sub: '', group: area })}><Icon name="plus" size={18} w={2.2} />&nbsp;Neue Kategorie anlegen</button>}
      {newTop && (
        <form className="card flush" aria-label="Neue Kategorie" onSubmit={(e) => { e.preventDefault(); void createTop(); }}>
          <div className="sec"><h2>Neue Kategorie</h2></div>
          <label className="field"><span>Name</span><input autoFocus value={newTop.name} maxLength={40} placeholder="z. B. Haustier" aria-label="Name der neuen Kategorie" onChange={(e) => setNewTop({ ...newTop, name: e.target.value })} /></label>
          <label className="field"><span>Erste Unterkategorie</span><input value={newTop.sub} maxLength={40} placeholder="optional" aria-label="Erste Unterkategorie" onChange={(e) => setNewTop({ ...newTop, sub: e.target.value })} /></label>
          {kind === 'expense' && !household && (
            <div className="pad">
              <div className="seg" role="tablist" aria-label="Gruppe der neuen Kategorie">
                {(['alltag', 'fix', 'spar'] as CatGroup[]).map((g) => <button type="button" key={g} role="tab" aria-selected={newTop.group === g} className={newTop.group === g ? 'on' : ''} onClick={() => setNewTop({ ...newTop, group: g })}>{GROUP_LABEL[g]}</button>)}
              </div>
            </div>
          )}
          <div className="pad stack">
            <span className="mini">{household ? 'Wird in den Kategorien des Haushaltskontos angelegt' : 'Wird in deinen eigenen Kategorien angelegt'}, genauso wie in der App. Weitere Unterkategorien fügst du danach mit „+“ hinzu.</span>
            <button type="submit" className="btn" disabled={!newTop.name.trim()}>Anlegen und zuordnen</button>
            <button type="button" className="btn danger" onClick={() => setNewTop(null)}>Abbrechen</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
