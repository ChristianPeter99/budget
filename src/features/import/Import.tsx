import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MAX_IMPORT_BYTES, MAX_PDF_BYTES, NeedsMapping, amountClusters, assignBlocks, bookable, contractLabel, decodeBytes, detectLayout, detectRecurring, findDuplicates, findReturns, mergeCandidates, parseStatement, suggestCategory } from '../../domain/statement';
import type { Block, Candidate, ColumnMap, DupState, FixFound, Layout, ParseResult } from '../../domain/statement';
import { catArea, isHouseholdCat } from '../../domain/types';
import type { CatArea, CatGroup, Category, Transaction } from '../../domain/types';
import type { PdfBalance } from '../../data/pdf';
import { currentMonthKey, formatDateDE, shiftMonth } from '../../domain/dates';
import { toMessage, useStore } from '../../state/store';
import { getMeta, setMeta } from '../../data/meta';
import type { Db } from '../../data/schema';
import { addCategory, deleteCategory } from '../../data/categories';
import { useAreaSwipe } from '../../ui/gestures';
import { fixFromCandidates, fixPool, likelyFix, makeFixRow, willSave, withMembers } from '../../domain/fixDetect';
import type { FixRow } from '../../domain/fixDetect';
import { formatEUR } from '../../domain/money';
import { importTransactions, saveFixRows, undoImport } from '../../data/imports';
import type { ImportItem } from '../../data/imports';
import { ColumnMapper } from './ColumnMapper';
import { MoreMenu } from '../../ui/MoreMenu';
import { Header } from '../../ui/Header';
import { Icon } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { FixList } from './FixImport';
import { categoryName, topLevel } from '../../domain/categories';
import { RangeCal } from '../../ui/RangeCal';
import { GROUP_LABEL } from '../../ui/groups';

/** Ein Eintrag der Prüfliste */
interface Row { c: Candidate; on: boolean; cat: string | null; dup: DupState; match?: Transaction; locked: boolean; /** Gegenbuchung, wenn Teil einer Retoure */ ret?: string; /** per Filter/Mehrfachauswahl zugeordnet (z. B. Urlaub) – nicht als Händler-Zuordnung merken */ noLearn?: boolean }
/** Filter der Prüfliste: Zeitraum und Suchtext */
interface Flt { from: string; to: string; q: string }
const fnorm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
type Tab = 'ausgaben' | 'fix' | 'erfasst' | 'weitere';
/** Gespeicherte Bankvorlage: Spaltenzuordnung unter einem Namen */
type PdfInfo = { diff: number | null; bal: PdfBalance };
/** Eine gelesene Datei (Ergebnis bleibt bis „Übernehmen“ nur im Speicher) */
type Part = { name: string; res: ParseResult; pdf: PdfInfo | null; bank: string | null; text: string; layout: Layout };
type MapState = { layout: Layout; text: string; bank?: string; name?: string; pdf?: PdfInfo | null };
interface Batch {
  queue: File[]; parts: Part[]; total: number;
  /** übersprungene Dateien (why leer = vom Nutzer übersprungen) */
  fails: { name: string; why: string }[];
  /** in diesem Durchgang zugeordnete Aufbauten (Signatur → Zuordnung) */
  maps: Map<string, { map: ColumnMap; bank: string | null }>;
  /** eingegebenes PDF-Passwort, nur für diesen Durchgang im Speicher */
  pw?: string;
}
type ReadOut = { kind: 'ok'; part: Part } | { kind: 'pw' } | { kind: 'map'; mapping: MapState; note?: string } | { kind: 'fail'; why: string };

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

/** Mehr › Import (CSV oder PDF): Datei einlesen, prüfen, zuordnen, übernehmen. Bis „Übernehmen“ wird nichts gespeichert. */
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
  // Reiter beim Prüfen per Wischen wechseln (wie bei den Kategorien); ganz links nach rechts bleibt man im Import
  const tabs: [Tab, string][] = account === 'joint' ? [['ausgaben', 'Alltag'], ['erfasst', 'Schon da'], ['weitere', 'Weitere']] : [['ausgaben', 'Alltag'], ['fix', 'Fixkosten'], ['erfasst', 'Schon da'], ['weitere', 'Weitere']];
  const impBody = useRef<HTMLDivElement>(null);
  const { handlers: impSwipe } = useAreaSwipe(tabs.map(([t]) => t), Math.max(0, tabs.findIndex(([t]) => t === tab)), setTab, impBody);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<{ title: string; keys: string[]; group?: string; kind: 'expense' | 'income'; bulk?: boolean } | null>(null);
  const [last, setLast] = useState<LastImport | null>(null);
  const [blocks, setBlocks] = useState<Map<string, Block>>(new Map());
  const [detail, setDetail] = useState<string | null>(null);
  // Erkannte bzw. von Hand markierte Fixkosten (Reiter „Fixkosten“ der Prüfliste)
  const [fixes, setFixes] = useState<FixRow[]>([]);
  // Datei mit unbekanntem Aufbau: Spalten einmal zuordnen (als Bankvorlage gespeichert)
  const [mapping, setMapping] = useState<MapState | null>(null);
  const [lastFile, setLastFile] = useState<MapState | null>(null);
  // Mehrere Dateien auf einmal: Warteschlange (nur im Speicher), Fortschritt und Hinweise für die Prüfliste
  const batchRef = useRef<Batch | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [fails, setFails] = useState<Batch['fails']>([]);
  const [dupes, setDupes] = useState(0);
  const [gaps, setGaps] = useState<string[]>([]);
  // PDF: Kontrollrechnung (alter Kontostand + Buchungen = neuer Kontostand) und Passwortabfrage (Passwort wird nie gespeichert)
  const [checks, setChecks] = useState<{ name: string; diff: number }[]>([]);
  const [pwAsk, setPwAsk] = useState<{ file: File; wrong: boolean } | null>(null);
  const [pw, setPw] = useState('');
  const [banks, setBanks] = useState<BankTpl[]>([]);
  const [bankId, setBankId] = useState('');
  const [usedBank, setUsedBank] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [bankSheet, setBankSheet] = useState(false);
  // Rückfrage: Zeilen ohne Kategorie nach „Sonstiges“?
  const [askRest, setAskRest] = useState(false);
  // Filter (z. B. Urlaubszeitraum) und Mehrfachauswahl
  const [flt, setFlt] = useState<Flt | null>(null);
  const [fltOpen, setFltOpen] = useState(false);
  const [multi, setMulti] = useState(false);
  const [marked, setMarked] = useState<Set<string>>(new Set());
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

  /** Eine Datei lesen: fertig, Passwort nötig, Spalten zuordnen oder Fehler. Speichert nichts. */
  async function readOne(f: File, password: string | undefined, maps: Batch['maps']): Promise<ReadOut> {
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (f.size > (isPdf ? MAX_PDF_BYTES : MAX_IMPORT_BYTES)) return { kind: 'fail', why: `Die Datei ist zu groß (höchstens ${isPdf ? 20 : 5} MB).` };
    try {
      let text: string, signature: string | null = null, pdfInfo: PdfInfo | null = null;
      if (isPdf) {
        // PDF: Text mit Position lesen (nur auf dem Gerät), daraus eine Tabelle bauen – danach derselbe Weg wie bei CSV
        const pdf = await import('../../data/pdf');
        let table;
        try {
          table = pdf.pdfToTable(await pdf.readPdfItems(new Uint8Array(await f.arrayBuffer()), password));
        } catch (e) {
          if (e instanceof pdf.PdfPasswordNeeded) return { kind: 'pw' };
          throw e;
        }
        text = table.text; signature = table.signature;
        pdfInfo = { diff: table.diffCents, bal: table.balance };
      } else text = await readText(f);
      const detected = detectLayout(text);
      const layout = signature ? { ...detected, signature } : detected;
      // In diesem Durchgang schon zugeordnet, sonst gewählte Bank, sonst Vorlage mit gleichem Aufbau, sonst automatisch
      const tpl = bankId ? banks.find((b) => b.id === bankId) : banks.find((b) => b.signature === layout.signature);
      const use = maps.get(layout.signature) ?? (tpl ? { map: tpl.map, bank: tpl.name } : null);
      let res: ParseResult;
      try {
        res = await parseStatement(text, use?.map);
        if (use && res.candidates.length === 0) throw new NeedsMapping({ ...layout, map: use.map });
      } catch (e) {
        const base = { text, name: f.name, pdf: pdfInfo, ...(use?.bank ? { bank: use.bank } : {}) };
        if (e instanceof NeedsMapping) { const el = signature ? { ...e.layout, signature } : e.layout; return { kind: 'map', mapping: { ...base, layout: use ? { ...el, map: use.map } : el } }; }
        if (use) return { kind: 'map', note: use.bank ? `Die Vorlage „${use.bank}“ passt nicht zu dieser Datei. Ordne die Spalten neu zu.` : 'Die Zuordnung passt nicht zu dieser Datei. Ordne die Spalten neu zu.', mapping: { ...base, layout: { ...layout, map: use.map } } };
        throw e;
      }
      return { kind: 'ok', part: { name: f.name, res, pdf: pdfInfo, bank: use?.bank ?? null, text, layout: use ? { ...layout, map: use.map } : layout } };
    } catch (e) {
      return { kind: 'fail', why: toMessage(e) };
    }
  }

  /** Eine oder mehrere Dateien einlesen; alle Buchungen landen zusammen in einer Prüfliste */
  function onFiles(list: File[]) {
    if (list.length === 0) return;
    setErr('');
    batchRef.current = { queue: [...list], parts: [], fails: [], total: list.length, maps: new Map() };
    void pump();
  }

  /** Warteschlange abarbeiten; hält an, wenn ein Passwort oder eine Zuordnung gebraucht wird */
  async function pump(password?: string) {
    const b = batchRef.current;
    if (!b) return;
    setBusy(true);
    try {
      while (b.queue.length > 0) {
        const f = b.queue[0]!;
        setProgress([b.total - b.queue.length + 1, b.total]);
        const given = password;
        password = undefined;
        // Mehrere Auszüge haben oft dasselbe Passwort: das eben eingegebene zuerst probieren (nur im Speicher, nur für diesen Durchgang)
        const r = await readOne(f, given ?? b.pw, b.maps);
        if (r.kind === 'pw') { setPw(''); setFileName(f.name); setPwAsk({ file: f, wrong: given !== undefined }); return; }
        setPwAsk(null);
        if (given !== undefined) b.pw = given;
        b.queue.shift();
        if (r.kind === 'map') { setFileName(f.name); setErr(r.note ?? ''); setMapping(r.mapping); return; }
        if (r.kind === 'fail') b.fails.push({ name: f.name, why: r.why });
        else b.parts.push(r.part);
      }
      batchRef.current = null;
      if (b.parts.length > 0) showParts(b.parts, b.fails);
      else {
        const bad = b.fails.filter((x) => x.why);
        if (bad.length) setErr(b.total === 1 ? bad[0]!.why : bad.map((x) => `${x.name}: ${x.why}`).join(' · '));
      }
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** Datei im laufenden Durchgang überspringen (Passwort/Zuordnung abgebrochen) */
  function skipCurrent(name: string, fromQueue: boolean) {
    const b = batchRef.current;
    if (!b) return;
    if (fromQueue) b.queue.shift();
    b.fails.push({ name, why: '' });
    void pump();
  }

  /** Zuordnung aus „Spalten zuordnen“ übernehmen und auf Wunsch als Bankvorlage speichern */
  async function applyMapping(map: ColumnMap, saveAs: string | null) {
    if (!mapping) return;
    setErr('');
    try {
      const res = await parseStatement(mapping.text, map);
      let bank: string | null = null;
      if (saveAs) {
        const name = saveAs.trim();
        const ex = banks.find((b) => b.name.toLowerCase() === name.toLowerCase());
        const tpl: BankTpl = { id: ex?.id && !ex.id.startsWith('legacy') ? ex.id : crypto.randomUUID(), name, signature: mapping.layout.signature, map };
        await storeBanks([...banks.filter((b) => b !== ex && b.signature !== tpl.signature), tpl]);
        pickBank(tpl.id);
        bank = name;
      }
      const part: Part = { name: mapping.name ?? fileName, res, pdf: mapping.pdf ?? null, bank, text: mapping.text, layout: { ...mapping.layout, map } };
      setMapping(null);
      const b = batchRef.current;
      if (b) {
        // weitere Auszüge mit gleichem Aufbau in diesem Durchgang ohne neue Rückfrage
        b.maps.set(mapping.layout.signature, { map, bank });
        b.parts.push(part);
        void pump();
      } else showParts([part], []);
    } catch (e) { setErr(toMessage(e)); }
  }

  /** Mehrere Auszüge zu einer Prüfliste zusammenführen (Überschneidungen nur einmal) */
  function showParts(list: Part[], fails: Batch['fails']) {
    const first = (p: Part) => p.res.candidates.reduce((m, c) => (c.bookingDate < m ? c.bookingDate : m), '9999');
    const parts = [...list].sort((a, b) => first(a).localeCompare(first(b)));
    const { candidates, dupes } = mergeCandidates(parts.map((p) => p.res.candidates));
    setFileName(parts.length === 1 ? parts[0]!.name : `${parts.length} Kontoauszüge`);
    const banksUsed = new Set(parts.map((p) => p.bank));
    setUsedBank(banksUsed.size === 1 ? parts[0]!.bank : null);
    setLastFile(parts.length === 1 ? { text: parts[0]!.text, layout: parts[0]!.layout, name: parts[0]!.name, pdf: parts[0]!.pdf } : null);
    setChecks(parts.filter((p) => p.pdf && p.pdf.diff !== null).map((p) => ({ name: p.name, diff: p.pdf!.diff! })));
    // Kontostand am Ende eines Auszugs = Kontostand am Anfang des nächsten? Sonst fehlt vermutlich ein Auszug dazwischen
    const gaps: string[] = [];
    const lastOf = (p: Part) => p.res.candidates.reduce((m, c) => (c.bookingDate > m ? c.bookingDate : m), '');
    for (let i = 1; i < parts.length; i++) {
      const a = parts[i - 1]!.pdf?.bal.closeCents, b = parts[i]!.pdf?.bal.openCents;
      // nur bei aufeinanderfolgenden Zeiträumen (gleicher oder überlappender Auszug: keine Lücke)
      if (first(parts[i]!) <= lastOf(parts[i - 1]!)) continue;
      if (a != null && b != null && a !== b) gaps.push(`Zwischen „${parts[i - 1]!.name}“ und „${parts[i]!.name}“ fehlt ein Auszug?`);
    }
    setGaps(gaps);
    setFails(fails);
    setDupes(dupes);
    show({ candidates, skippedLines: parts.reduce((s, p) => s + p.res.skippedLines, 0), format: parts[0]!.res.format });
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
  const matches = useMemo(() => {
    if (!flt) return () => true;
    const q = fnorm(flt.q.trim());
    return (r: Row) => (!flt.from || r.c.date >= flt.from) && (!flt.to || r.c.date <= flt.to) && (!q || fnorm(`${r.c.payee} ${r.c.detail} ${r.c.raw.zweck}`).includes(q));
  }, [flt]);
  const groups = useMemo(() => {
    if (!rows) return [];
    const m = new Map<string, Row[]>();
    const titles = new Map<string, string>();
    for (const r of rows) {
      if (tabOf(r, fixOf.get(r.c.key)?.f.key) !== tab || !matches(r)) continue;
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
  }, [rows, tab, blocks, fixOf, matches]);

  // Ausgaben, die per Filter/Mehrfachauswahl eine Kategorie bekommen können
  const markable = tab === 'ausgaben' ? groups.flatMap((g) => g.rows.filter((r) => !r.locked && r.c.kind === 'expense' && !r.ret)) : [];
  const toggleMark = (keys: string[]) => setMarked((m) => {
    const n = new Set(m);
    const all = keys.every((k) => n.has(k));
    for (const k of keys) { if (all) n.delete(k); else n.add(k); }
    return n;
  });
  const markedRows = (rows ?? []).filter((r) => marked.has(r.c.key));

  const counts = useMemo(() => {
    const n: Record<Tab, number> = { ausgaben: 0, fix: fixes.length, erfasst: 0, weitere: 0 };
    for (const r of rows ?? []) { const t = tabOf(r, fixOf.get(r.c.key)?.f.key); if (t !== 'fix' && matches(r)) n[t]++; }
    return n;
  }, [rows, fixes.length, fixOf, matches]);
  // Kategorie einer Zeile: bei Fixkosten die der Fixkosten
  const catOf = (r: Row) => fixOf.get(r.c.key)?.cat || r.cat;
  const chosen = (rows ?? []).filter((r) => r.on);
  const missing = chosen.filter((r) => !catOf(r)).length;
  const newFix = fixes.filter(willSave).length;
  const booked = fixes.map((f) => f.keys.filter((k) => rows?.find((r) => r.c.key === k)?.on).length);
  const sum = chosen.reduce((a, r) => a + (r.c.kind === 'credit' ? -r.c.amountCents : r.c.amountCents), 0);

  const update = (keys: string[], fn: (r: Row) => Row) => setRows((rs) => rs && rs.map((r) => (keys.includes(r.c.key) ? fn(r) : r)));
  const toggleOpen = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  /** Fixkosten an/aus: ihre Buchungen aus der Datei gleich mit (sonst blieben sie unsichtbar ausgewählt) */
  function toggleFix(i: number, on: boolean) {
    const f = fixes[i];
    if (!f) return;
    setFixes((fs) => fs.map((x, k) => (k === i ? { ...x, on } : x)));
    update(f.keys, (r) => (r.locked ? r : { ...r, on: on && r.dup === 'none' }));
  }
  /** Buchungen dieses Händlers, die zur Zahlung gehören können */
  const membersOf = (i: number) => {
    const f = fixes[i];
    if (!f || !rows) return [];
    return rows.filter((r) => r.c.kind === 'expense' && !r.ret && r.c.payeeKey === f.f.payeeKey && (!fixOf.has(r.c.key) || fixOf.get(r.c.key) === f))
      .sort((a, b) => b.c.date.localeCompare(a.c.date))
      .map((r) => ({ key: r.c.key, date: r.c.date, amountCents: r.c.amountCents, detail: r.c.detail.slice(0, 40), in: f.keys.includes(r.c.key), on: r.on }));
  };
  function setMember(i: number, key: string, inFix: boolean) {
    const f = fixes[i];
    if (!f || !rows) return;
    const keys = inFix ? [...f.keys, key] : f.keys.filter((k) => k !== key);
    const next = withMembers(f, rows.filter((r) => keys.includes(r.c.key)).map((r) => r.c));
    setFixes((fs) => (next.keys.length ? fs.map((x, k) => (k === i ? next : x)) : fs.filter((_, k) => k !== i)));
    if (inFix) update([key], (r) => (r.locked ? r : { ...r, on: f.on && r.dup === 'none' }));
  }
  /** Alle Zeilen der aktuellen Ansicht an- oder abwählen */
  function setAll(on: boolean) {
    if (tab === 'fix') { fixes.forEach((_, i) => toggleFix(i, on)); return; }
    const keys = groups.flatMap((g) => g.rows.filter((r) => !r.locked).map((r) => r.c.key));
    update(keys, (r) => ({ ...r, on }));
  }
  const tabKeys = tab === 'fix' ? [] : groups.flatMap((g) => g.rows.filter((r) => !r.locked));
  const allOnTab = tab === 'fix' ? fixes.length > 0 && fixes.every((f) => f.on) : tabKeys.length > 0 && tabKeys.every((r) => r.on);

  /** Zeilen von Hand als Fixkosten markieren (eine Zahlung je Händler) */
  function markFix(keys: string[], catId?: string, opt?: FixOpt) {
    if (!rows) return;
    const list = rows.filter((r) => keys.includes(r.c.key) && r.c.kind === 'expense' && !r.ret);
    if (list.length === 0) return;
    const byPayee = new Map<string, Candidate[]>();
    for (const r of list) byPayee.set(r.c.payeeKey, [...(byPayee.get(r.c.payeeKey) ?? []), r.c]);
    const pool = new Set(fixPool(cats).map((c) => c.id));
    // Je Händler und Betrag eine Vorlage: zwei Verträge bei derselben Versicherung werden zwei Fixkosten
    const add: FixRow[] = [];
    for (const cs of byPayee.values()) {
      const cl = amountClusters(cs);
      const allOfPayee = rows.filter((r) => r.c.kind === 'expense' && r.c.payeeKey === cs[0]!.payeeKey).map((r) => r.c);
      for (const part of cl) {
        const cur = rows.find((r) => r.c.key === part[0]!.key)?.cat;
        const f = fixFromCandidates(part);
        f.key = `m:${f.payeeKey}#${f.amountCents}`;
        if (opt) f.interval = opt.interval;
        // Gleicher Name schon in Fixkosten (z. B. HUK für das Auto) oder mehrere Verträge: Vertrag im Namen nennen
        const sameName = data.recurring.some((r) => r.name.toLowerCase().includes(f.name.toLowerCase()) || f.name.toLowerCase().includes(r.name.toLowerCase()));
        if (cl.length > 1 || sameName) {
          const lab = contractLabel(part, allOfPayee.filter((c) => !part.includes(c)));
          f.name = `${f.name} · ${lab || formatEUR(f.amountCents)}`;
        }
        const row = makeFixRow(f, part, cats, data.recurring, data.settings.importRules ?? {}, part.map((c) => c.key), catId ?? (cur && pool.has(cur) ? cur : undefined));
        add.push({ ...row, manual: true, ...(opt?.start ? { start: opt.start } : {}) });
      }
    }
    const moved = new Set(add.flatMap((a) => a.keys));
    setFixes((fs) => {
      const rest = fs.map((f) => ({ ...f, keys: f.keys.filter((k) => !moved.has(k)) })).filter((f) => f.keys.length > 0);
      for (const a of add) {
        const i = rest.findIndex((f) => f.f.key === a.f.key);
        // Schon da (z. B. zweimal gewählt): zusammenführen statt verwerfen
        if (i >= 0) { const all = new Set([...rest[i]!.keys, ...a.keys]); rest[i] = withMembers({ ...rest[i]!, cat: a.cat, on: true }, rows.filter((r) => all.has(r.c.key)).map((r) => r.c)); }
        else rest.push(a);
      }
      // Gleich benannte Fixkosten (zwei Verträge, nacheinander gewählt): Vertrag im Namen nennen
      const cOf = (f: FixRow) => rows.filter((r) => f.keys.includes(r.c.key)).map((r) => r.c);
      const names = new Map<string, number[]>();
      rest.forEach((f, i) => names.set(f.f.name, [...(names.get(f.f.name) ?? []), i]));
      for (const idx of names.values()) {
        if (idx.length < 2) continue;
        for (const i of idx) {
          const f = rest[i]!;
          const lab = contractLabel(cOf(f), idx.filter((j) => j !== i).flatMap((j) => cOf(rest[j]!)));
          rest[i] = { ...f, f: { ...f.f, name: `${f.f.name} · ${lab || formatEUR(f.f.amountCents)}` } };
        }
      }
      return rest;
    });
    flash(add.length === 1 ? `„${add[0]!.f.name}“ wird als Fixkosten angelegt – siehe Reiter Fixkosten` : `${add.length} Fixkosten werden angelegt – siehe Reiter Fixkosten`, 'ok');
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
    for (const r of chosen) if (r.c.payeeKey && catOf(r) && !r.noLearn) byPayee.set(r.c.payeeKey, (byPayee.get(r.c.payeeKey) ?? new Set()).add(catOf(r) as string));
    // Zahlungsdienste (PayPal, Klarna) bündeln verschiedene Händler – dafür nichts merken
    for (const [k, s] of byPayee) if (s.size === 1 && !/^(paypal|klarna)/.test(k)) rules[(account === 'joint' ? 'j:' : '') + k] = [...s][0] as string;
    // Auch je Block merken (z. B. alle Cafés → Essen gehen), damit neue Händler gleicher Art schon zugeordnet sind
    const byBlock = new Map<string, Set<string>>();
    for (const r of chosen) { const b = blocks.get(r.c.key); if (b && catOf(r) && !r.noLearn && !fixOf.has(r.c.key)) byBlock.set(b.key, (byBlock.get(b.key) ?? new Set()).add(catOf(r) as string)); }
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
    flash(`${txt} übernommen`, 'ok');
  }

  async function undo(ids: string[]) {
    const n = await run(async (d) => { const k = await undoImport(d, ids); await setMeta(d, 'lastImport', null); return k; });
    if (n !== undefined) { setLast(null); flash(`${n} importierte Buchung${n === 1 ? '' : 'en'} entfernt`); await reload(); }
  }

  /* ───── Spalten zuordnen (unbekannter Aufbau) ───── */
  if (mapping) {
    return <ColumnMapper layout={mapping.layout} text={mapping.text} fileName={fileName} err={err} bank={mapping.bank ?? banks.find((b) => b.id === bankId)?.name ?? ''} banks={banks.map((b) => b.name)}
      onApply={(m, name) => void applyMapping(m, name)} onCancel={() => { const n = mapping.name ?? fileName; setMapping(null); setErr(''); skipCurrent(n, false); }} />;
  }

  /* ───── Schritt 1: Datei wählen ───── */
  if (!rows) {
    return (
      <>
        <div className="toprow">
          {back}
          <MoreMenu items={[
            { label: 'Bankvorlagen verwalten', onClick: () => setManage(true), hidden: banks.length === 0 },
            { label: 'Letzten Import rückgängig machen', danger: true, onClick: () => { if (last) void undo(last.ids); }, hidden: !last || last.count === 0 },
          ]} />
        </div>
        <Header title="Import" />
        <p className="note">Einen oder mehrere Kontoauszüge als CSV oder PDF einlesen – gespeichert wird erst bei „Übernehmen“.</p>
        <div className="card flush">
          <button className="srow bankrow1" onClick={() => setBankSheet(true)} aria-label={`Bank: ${banks.find((b) => b.id === bankId)?.name ?? 'Automatisch erkennen'}`}>
            <span>Bank</span><b>{banks.find((b) => b.id === bankId)?.name ?? 'Automatisch'}<Icon name="right" size={16} w={2.2} /></b>
          </button>
        </div>
        {bankSheet && (
          <Sheet title="Bank" onClose={() => setBankSheet(false)} left="Fertig">
            <div className="card flush">
              {[{ id: '', name: 'Automatisch erkennen' }, ...banks].map((b) => (
                <button key={b.id || 'auto'} className="srow" role="menuitemradio" aria-checked={bankId === b.id} onClick={() => { pickBank(b.id); setBankSheet(false); }}>
                  <span>{b.name}</span>{bankId === b.id && <Icon name="check" size={18} w={2.6} />}
                </button>
              ))}
            </div>
          </Sheet>
        )}
        {manage && (
          <Sheet title="Bankvorlagen" onClose={() => setManage(false)} left="Fertig">
            <div className="card flush">
              {banks.length === 0 && <div className="empty">Keine Bankvorlagen.</div>}
              {banks.map((b) => (
                <div className="kv bankrow" key={b.id}><span>{b.name}</span><button className="linkbtn danger" onClick={() => void removeBank(b.id)} aria-label={`Bankvorlage ${b.name} löschen`}>Löschen</button></div>
              ))}
            </div>
          </Sheet>
        )}
        {joint && (
          <div className="seg" role="tablist" aria-label="Zielkonto">
            <button role="tab" aria-selected={account === 'own'} className={account === 'own' ? 'on' : ''} onClick={() => setAccount('own')}>Mein Konto</button>
            <button role="tab" aria-selected={account === 'joint'} className={account === 'joint' ? 'on' : ''} onClick={() => setAccount('joint')}>{joint.name}</button>
          </div>
        )}
        <label className={'btn' + (busy ? ' busy' : '')} role="button" aria-disabled={busy}>
          {busy ? (progress && progress[1] > 1 ? `Wird gelesen … ${progress[0]} von ${progress[1]}` : 'Wird gelesen …') : 'Dateien auswählen'}
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.pdf,text/csv,text/comma-separated-values,text/tab-separated-values,text/plain,application/pdf" aria-label="Kontoauszug (CSV oder PDF)" className="vh" multiple disabled={busy} onChange={(e) => onFiles([...(e.target.files ?? [])])} />
        </label>
        {err && <div className="err-text" role="alert">{err}</div>}
        {pwAsk && (
          <Sheet title="PDF-Passwort" onClose={() => { const n = pwAsk.file.name; setPwAsk(null); setPw(''); skipCurrent(n, true); }} left="Abbrechen"
            right={<button className="lnk sdone on" disabled={!pw} onClick={() => { const p = pw; setPw(''); void pump(p); }}>Öffnen</button>}>
            {(batchRef.current?.total ?? 1) > 1 && <p className="mini pagenote pwfile">{pwAsk.file.name}</p>}
            <p className="mini pagenote">{pwAsk.wrong ? 'Das Passwort stimmt nicht. Bitte noch einmal.' : 'Der Kontoauszug ist geschützt. Das Passwort wird nur zum Öffnen benutzt und nicht gespeichert.'}</p>
            <div className="card flush">
              <label className="field"><span>Passwort</span><input type="password" autoComplete="off" value={pw} autoFocus aria-label="PDF-Passwort" onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && pw) { const p = pw; setPw(''); void pump(p); } }} /></label>
            </div>
          </Sheet>
        )}
      </>
    );
  }

  /* ───── Schritt 2: prüfen und zuordnen ───── */
  return (
    <div className="impwrap" data-areas="" data-first="0" data-lockswipe="" {...impSwipe}>
      <div className="toprow">
        <button className="back" onClick={() => setRows(null)}><Icon name="left" size={16} w={2.2} />Abbrechen</button>
        <span className="hdrow">
          {tab !== 'fix' && <button className={'ib' + (flt ? ' on' : '')} aria-label="Filter" aria-pressed={!!flt} onClick={() => setFltOpen(true)}><Icon name="filter" size={20} w={2.2} /></button>}
          {tab === 'ausgaben' && <button className={'ib' + (multi ? ' on' : '')} aria-label="Mehrfachauswahl" aria-pressed={multi} onClick={() => { setMulti(!multi); setMarked(new Set()); }}><Icon name="selcircle" size={21} w={2} /></button>}
          <MoreMenu items={[
            { label: allOnTab ? 'Alle abwählen' : 'Alle auswählen', onClick: () => setAll(!allOnTab), hidden: multi || (tab === 'fix' ? fixes.length === 0 : tabKeys.length === 0) },
            { label: 'Spalten neu zuordnen', onClick: () => { if (!lastFile) return; setRows(null); setMapping(lastFile); }, hidden: !lastFile },
          ]} />
        </span>
      </div>
      <Header kicker={usedBank ? `${fileName} · ${usedBank}` : fileName} title="Prüfen & zuordnen" />
      <div className="catseg impseg" role="tablist" aria-label="Ansicht">
        {tabs.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} style={{ ['--c' as string]: t === 'fix' ? 'var(--fix)' : t === 'ausgaben' ? 'var(--all)' : 'var(--text)' }} onClick={() => setTab(t)}>{l} <span className="tcnt">{counts[t]}</span></button>)}
      </div>
      <div className="impbody" ref={impBody}>
      {flt && tab !== 'fix' && (
        <div className="fltline"><span><Icon name="filter" size={14} w={2.2} />{fltLabel(flt)}</span><button className="chipx" aria-label="Filter aufheben" onClick={() => setFlt(null)}><Icon name="x" size={14} w={2.4} /></button></div>
      )}
      {flt && tab === 'ausgaben' && !multi && markable.length > 0 && (
        <button className="fltall" onClick={() => setPicker({ title: `${markable.length} Ausgaben · ${fltLabel(flt)}`, keys: markable.map((r) => r.c.key), kind: 'expense', bulk: true })}>
          <Icon name="tag" size={16} />Allen {markable.length} Ausgaben im Filter eine Kategorie geben
        </button>
      )}
      {tab === 'fix' && fixes.length === 0 && <div className="empty">Keine wiederkehrenden Zahlungen erkannt.</div>}
      {checks.length > 0 && (checks.every((c) => c.diff === 0)
        ? <p className="pdfcheck ok" role="status"><Icon name="check" size={15} w={2.6} />{checks.length === 1 ? 'Kontostand stimmt – alle Buchungen erkannt' : `Kontostand stimmt in allen ${checks.length} Auszügen`}</p>
        : checks.filter((c) => c.diff !== 0).map((c) => <p key={c.name} className="pdfcheck warn" role="status"><Icon name="warn" size={15} w={2.2} />{checks.length > 1 || fails.length > 0 ? `${c.name}: ` : ''}Kontostand weicht um {formatEUR(Math.abs(c.diff))} ab – fehlt eine Seite oder Buchung?</p>))}
      {gaps.map((g) => <p key={g} className="pdfcheck warn" role="status"><Icon name="warn" size={15} w={2.2} />{g}</p>)}
      {fails.map((f) => <p key={f.name} className="note">{f.name}: {f.why ? f.why : 'übersprungen'}</p>)}
      {dupes > 0 && <p className="note">{dupes} Buchung{dupes === 1 ? ' steht' : 'en stehen'} in mehreren Auszügen und {dupes === 1 ? 'ist' : 'sind'} nur einmal aufgeführt.</p>}
      {skipped > 0 && <p className="note">{skipped} Zeile{skipped === 1 ? '' : 'n'} konnte{skipped === 1 ? '' : 'n'} nicht gelesen werden.</p>}
      {tab === 'fix' && fixes.length > 0 && (
        <FixList rows={fixes} cats={cats} booked={booked} members={membersOf} onToggle={toggleFix} onMember={setMember}
          onChange={(i, p) => setFixes((fs) => fs.map((f, k) => (k === i ? { ...f, ...p } : f)))}
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
        const many = g.rows.length > 1;
        const isOpen = many && open.has(g.k);
        const mk = multi ? g.rows.filter((r) => !r.locked && r.c.kind === 'expense' && !r.ret).map((r) => r.c.key) : [];
        const isRet = g.k === 'block:retouren';
        const canCat = !isRet && first.c.kind !== 'transfer' && !(account === 'joint' && kind === 'income');
        const rowCat = (r: Row) => r.c.kind !== 'transfer' && !r.locked && !(account === 'joint' && r.c.kind === 'credit');
        return (
          <div className={'card flush imp' + (someOn ? '' : ' off') + (multi && mk.length && mk.every((k) => marked.has(k)) ? ' marked' : '')} key={g.k}>
            <div className="imphead">
              {multi && mk.length > 0 ? (
                <button className={'check mark' + (mk.every((k) => marked.has(k)) ? ' on' : mk.some((k) => marked.has(k)) ? ' part' : '')} role="checkbox" aria-checked={mk.every((k) => marked.has(k)) ? true : mk.some((k) => marked.has(k)) ? 'mixed' : false}
                  aria-label={`${g.title} markieren`} onClick={() => toggleMark(mk)}>{mk.every((k) => marked.has(k)) && <Icon name="check" size={14} w={3} />}{!mk.every((k) => marked.has(k)) && mk.some((k) => marked.has(k)) && <i />}</button>
              ) : <button className={'check' + (allOn ? ' on' : someOn ? ' part' : '')} role="checkbox" aria-checked={allOn ? true : someOn ? 'mixed' : false} aria-label={`${g.title} übernehmen`} disabled={free.length === 0}
                onClick={() => update(free.map((r) => r.c.key), (r) => ({ ...r, on: !allOn }))}>{allOn && <Icon name="check" size={14} w={3} />}{!allOn && someOn && <i />}</button>}
              <button className="clickrow impname" onClick={() => (multi && mk.length > 0 && !(g.rows.length > 1) ? toggleMark(mk) : g.rows.length > 1 ? toggleOpen(g.k) : setDetail(first.c.key))} aria-expanded={many ? isOpen : undefined} aria-label={many ? `${g.title}: ${g.rows.length} Buchungen ${isOpen ? 'zuklappen' : 'aufklappen'}` : `Details zu ${g.title}`}>
                <span className="impnm">
                  <b>{g.title}</b>
                  <span className="mini">{isRet ? `${g.rows.length / 2} Rückbuchung${g.rows.length === 2 ? '' : 'en'} · ${[...new Set(g.rows.map((r) => r.c.payee))].slice(0, 4).join(', ')}` : <>{many ? `${g.rows.length} Buchungen` : short(first.c.date)}{g.block ? ` · ${[...new Set(g.rows.map((r) => r.c.payee))].slice(0, 4).join(', ')}` : `${first.c.kind !== 'expense' ? ' · ' + KIND_LABEL[first.c.kind] : ''}${first.c.bankSub || first.c.bankCategory ? ' · ' + (first.c.bankSub || first.c.bankCategory) : ''}`}</>}</span>
                </span>
                <span className="impamt">{isRet ? formatEUR(g.rows.filter((r) => r.c.kind === 'credit').reduce((a, r) => a + r.c.amountCents, 0)) : `${first.c.kind === 'credit' ? '+' : ''}${formatEUR(gsum)}`}{many && <span className="impchev" aria-hidden="true"><Icon name={isOpen ? 'up' : 'down'} size={16} w={2.2} /></span>}</span>
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
            {!many && first.dup === 'imported' && <div className="impnote">Schon importiert</div>}
            {!many && first.match && <div className="impnote">{first.dup === 'same' ? 'Schon erfasst' : 'Ähnlich'}: {short(first.match.date)} · {categoryName(cats, first.match.categoryId)}{first.match.description ? ` · ${first.match.description}` : ''}</div>}
            {isOpen && g.rows.map((r) => (
              <div className={'improw' + (r.on ? '' : ' off') + (marked.has(r.c.key) ? ' marked' : '')} key={r.c.key}>
                {multi && mk.includes(r.c.key) ? (
                  <button className={'check mark' + (marked.has(r.c.key) ? ' on' : '')} role="checkbox" aria-checked={marked.has(r.c.key)} aria-label={`${r.c.payee} ${short(r.c.date)} ${formatEUR(r.c.amountCents)} markieren`}
                    onClick={() => toggleMark([r.c.key])}>{marked.has(r.c.key) && <Icon name="check" size={14} w={3} />}</button>
                ) : <button className={'check' + (r.on ? ' on' : '')} role="checkbox" aria-checked={r.on} aria-label={`${r.c.payee} ${short(r.c.date)} ${formatEUR(r.c.amountCents)} übernehmen`} disabled={r.locked}
                  onClick={() => update([r.c.key], (x) => ({ ...x, on: !x.on }))}>{r.on && <Icon name="check" size={14} w={3} />}</button>}
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
      </div>
      <div style={{ height: 90 }} />
      {multi && tab === 'ausgaben' ? (
        <div className="selbar mselbar" role="region" aria-label="Mehrfachauswahl">
          <span>{marked.size} markiert · {formatEUR(markedRows.reduce((a, r) => a + r.c.amountCents, 0))}<br />
            <button className="linkbtn mini" onClick={() => setMarked(markable.every((r) => marked.has(r.c.key)) ? new Set() : new Set(markable.map((r) => r.c.key)))}>{markable.length > 0 && markable.every((r) => marked.has(r.c.key)) ? 'Keine markieren' : `Alle ${markable.length} markieren`}</button></span>
          <button className="btn" disabled={marked.size === 0} onClick={() => setPicker({ title: `${marked.size} markierte Ausgaben`, keys: [...marked], kind: 'expense', bulk: true })}>Kategorie zuweisen</button>
        </div>
      ) : <div className="selbar" role="region" aria-label="Übernehmen">
        <span>{chosen.length} ausgewählt · {formatEUR(Math.abs(sum))}{newFix > 0 && <><br /><small className="fixtxt">+ {newFix} Fixkosten-Vorlage{newFix === 1 ? '' : 'n'}</small></>}{missing > 0 && <><br /><small className="needtxt">{missing} ohne Kategorie</small></>}</span>
        <button className="btn" disabled={busy || (chosen.length === 0 && newFix === 0)} onClick={() => (missing > 0 ? setAskRest(true) : void commit())}>Übernehmen</button>
      </div>}
      {fltOpen && rows && <FilterSheet rows={rows} value={flt} onApply={(f) => { setFlt(f); setFltOpen(false); }} onClose={() => setFltOpen(false)} />}
      {detail && rows.find((r) => r.c.key === detail) && (() => {
        const r = rows.find((x) => x.c.key === detail)!;
        const kind = r.c.kind === 'credit' ? 'income' : 'expense';
        const canCat = r.c.kind !== 'transfer' && !r.locked && !(account === 'joint' && kind === 'income');
        return (
          <DetailSheet r={r} cats={cats} fix={fixOf.get(r.c.key)?.f.name} block={r.ret ? 'Retouren' : blocks.get(r.c.key)?.title} partner={r.ret ? rows.find((x) => x.c.key === r.ret)?.c : undefined} onClose={() => setDetail(null)}
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
          fixCands={account === 'own' && picker.kind === 'expense' && tab === 'ausgaben' && !picker.bulk ? rows.filter((r) => picker.keys.includes(r.c.key) && r.c.kind === 'expense' && !r.ret).map((r) => r.c) : undefined}
          onFix={(id, o) => { setPicker(null); markFix(o.keys, id, o); }}
          onPick={(id) => {
            if (picker.bulk) {
              // Mehrfachauswahl/Filter: alle bekommen die Kategorie und werden übernommen; nicht als Händler-Zuordnung gemerkt
              update(picker.keys, (r) => (r.locked ? r : { ...r, cat: id, on: true, noLearn: true }));
              flash(`${picker.keys.length} Ausgaben → ${categoryName(cats, id)}`, 'ok');
              setMarked(new Set()); setMulti(false);
            } else update(picker.keys, (r) => ({ ...r, cat: id, noLearn: false, on: r.locked ? r.on : r.on || tab === 'weitere' || picker.keys.length === 1 }));
            setPicker(null);
          }} />
      )}
    </div>
  );
}

const fltLabel = (f: Flt) => [f.from || f.to ? `${f.from ? short(f.from) : '…'} – ${f.to ? short(f.to) : '…'}` : '', f.q.trim() ? `„${f.q.trim()}“` : ''].filter(Boolean).join(' · ') || 'Filter';

/** Filter der Prüfliste: Zeitraum (z. B. ein Urlaub) und Suchtext */
function FilterSheet({ rows, value, onApply, onClose }: { rows: Row[]; value: Flt | null; onApply: (f: Flt | null) => void; onClose: () => void }) {
  const dates = rows.map((r) => r.c.date).sort();
  const min = dates[0] ?? '', max = dates[dates.length - 1] ?? '';
  const [from, setFrom] = useState(value?.from ?? '');
  const [to, setTo] = useState(value?.to ?? '');
  const [q, setQ] = useState(value?.q ?? '');
  const toE = to || from; // nur Start gewählt = dieser eine Tag
  const n = rows.filter((r) => (!from || r.c.date >= from) && (!toE || r.c.date <= toE) && (!q.trim() || fnorm(`${r.c.payee} ${r.c.detail} ${r.c.raw.zweck}`).includes(fnorm(q.trim())))).length;
  const empty = !from && !to && !q.trim();
  // Wie bei Buchungsportalen: erster Tipp = Start, zweiter = Ende, im selben Kalender
  const pick = (d: string) => {
    if (!from || to || d < from) { setFrom(d); setTo(''); return; }
    setTo(d);
  };
  const days = new Set(dates);
  const range = from ? `${formatDateDE(from).slice(0, 6)}${to && to !== from ? ` – ${formatDateDE(to).slice(0, 6)}` : to ? '' : ' – …'}` : 'Start und Ende antippen';
  return (
    <Sheet title="Filtern" onClose={onClose} left="Abbrechen"
      right={value ? <button className="lnk sdone" onClick={() => onApply(null)}>Aufheben</button> : undefined}>
      <div className="rangehead"><b>{range}</b>{from && <button className="linkbtn" onClick={() => { setFrom(''); setTo(''); }}>Zurücksetzen</button>}</div>
      {min && <RangeCal min={min} max={max} from={from} to={to} days={days} onPick={pick} />}
      <div className="card flush">
        <label className="field"><span>Suche</span><input value={q} placeholder="Händler oder Zweck" onChange={(e) => setQ(e.target.value)} aria-label="Suche" /></label>
      </div>
      <button className="btn" disabled={empty} onClick={() => onApply({ from, to: to || from, q })}>{empty ? 'Zeitraum wählen' : `${n} Buchung${n === 1 ? '' : 'en'} zeigen`}</button>
    </Sheet>
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
function DetailSheet({ r, cats, block, partner, fix, onClose, onToggle, onCategory }: { r: Row; cats: Category[]; block?: string; partner?: Candidate; fix?: string; onClose: () => void; onToggle?: () => void; onCategory?: () => void }) {
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
        {(onToggle || onCategory) && (
          <div className="pad stack">
            {onCategory && <button className="btn sec2" onClick={onCategory}>Kategorie ändern</button>}
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

/** Fixkosten aus der Kategorie-Auswahl: Rhythmus und Beginn der Vorlage */
export interface FixOpt { interval: FixFound['interval']; start?: string; keys: string[] }
type FixIv = FixFound['interval'] | 'once';

function CategoryPicker({ title, cats: allCats, current, household, kind, hint, onPick: pickPlain, onClose, fixCands, onFix }: {
  title: string; cats: Category[]; current: string | null; household: boolean; kind: 'expense' | 'income'; hint: string; onPick: (id: string) => void; onClose: () => void;
  /** Zeilen, aus denen eine Fixkosten-Vorlage werden kann (nur unter „Ausgaben“, eigenes Konto) */
  fixCands?: Candidate[]; onFix?: (id: string, o: FixOpt) => void;
}) {
  const [fixSel, setFixSel] = useState<Set<string>>(() => likelyFix(fixCands ?? []));
  const fixLast = fixCands?.filter((c) => fixSel.has(c.key)).reduce((m, c) => (c.date > m ? c.date : m), '').slice(0, 7) || undefined;
  const mixed = !!fixCands && new Set(fixCands.map((c) => c.amountCents)).size > 1;
  const [fixIv, setFixIv] = useState<FixIv>('monthly');
  const [fixStart, setFixStart] = useState<'last' | 'cur' | 'next'>('last');
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
  const nowM = currentMonthKey();
  const mm = (k: string) => `${k.slice(5, 7)}/${k.slice(2, 4)}`;
  const asFix = area === 'fix' && !!fixCands?.length && !!onFix && fixIv !== 'once';
  // In Fixkosten: einmal als Vorlage anlegen (außer „nur diese Buchung“)
  const onPick = (id: string) => {
    if (asFix) {
      if (fixSel.size === 0) return;
      onFix!(id, { interval: fixIv as FixFound['interval'], keys: [...fixSel], ...(fixStart === 'cur' ? { start: nowM } : fixStart === 'next' ? { start: shiftMonth(nowM, 1) } : {}) });
    }
    else pickPlain(id);
  };
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
      {area === 'fix' && fixCands && fixCands.length > 0 && onFix && (
        <div className="fixhint" role="group" aria-label="Fixkosten-Vorlage">
          <p><b>Wird einmal als Vorlage im Reiter Fixkosten angelegt.</b> Danach bucht die App die Zahlung selbst – du musst sie nicht mehr importieren.</p>
          <label className="fixhint-row"><span>Rhythmus</span>
            <select value={fixIv} onChange={(e) => setFixIv(e.target.value as FixIv)} aria-label="Rhythmus">
              <option value="monthly">monatlich</option><option value="quarterly">vierteljährlich</option><option value="halfyearly">halbjährlich</option><option value="yearly">jährlich</option>
              <option value="once">einmalig – keine Vorlage</option>
            </select>
          </label>
          {fixIv !== 'once' && (
            <label className="fixhint-row"><span>Ab</span>
              <select value={fixStart} onChange={(e) => setFixStart(e.target.value as 'last' | 'cur' | 'next')} aria-label="Vorlage ab">
                {fixLast && <option value="last">{fixLast === nowM ? 'diesem Monat' : 'letzter Zahlung'} ({mm(fixLast)})</option>}
                {fixLast !== nowM && <option value="cur">diesem Monat ({mm(nowM)})</option>}
                <option value="next">nächstem Monat ({mm(shiftMonth(nowM, 1))})</option>
              </select>
            </label>
          )}
          {fixIv !== 'once' && fixCands.length > 1 && (
            <div className="fixpick" role="group" aria-label="Welche Buchungen sind die Fixkosten?">
              <span className="fixpick-t">{mixed ? 'Welche Buchungen sind die Fixkosten? Zusatzkäufe abwählen – sie bleiben normale Ausgaben.' : 'Diese Buchungen werden der Vorlage zugeordnet:'}</span>
              {[...fixCands].sort((a, b) => b.date.localeCompare(a.date)).map((c) => (
                <label key={c.key} className={'fixmemrow' + (fixSel.has(c.key) ? '' : ' out')}>
                  <input type="checkbox" checked={fixSel.has(c.key)} aria-label={`${c.payee} ${formatDateDE(c.date)} ${formatEUR(c.amountCents)} ist Fixkosten`}
                    onChange={(e) => setFixSel((s) => { const n = new Set(s); if (e.target.checked) n.add(c.key); else n.delete(c.key); return n; })} />
                  <span>{formatDateDE(c.date)} · {c.payee}</span>
                  <b className="num">{formatEUR(c.amountCents)}</b>
                </label>
              ))}
              {fixSel.size === 0 && <span className="needtxt">Mindestens eine Buchung wählen.</span>}
            </div>
          )}
        </div>
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
