import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { openBudgetDb } from '../db/db';
import type { Db } from '../db/db';
import { ensureHouseholdCategories, exportAll, getMeta, getPreImportSnapshot, runGoals, runRecurring, seedIfEmpty } from '../db/repo';
import { AppError, DEFAULT_SETTINGS } from '../domain/types';
import type { BackupData, Transaction } from '../domain/types';
import { currentMonthKey } from '../domain/dates';
import { BackupError } from '../backup/crypto';

/**
 * Daten für die Oberfläche. `transactions` enthält NUR das eigene Konto, damit alle bisherigen Berechnungen
 * (Noch verfügbar, Alltag, Budgets, Auswertung) unverändert bleiben. Ausgaben vom gemeinsamen Konto liegen getrennt
 * in `jointTransactions`.
 */
export interface AppData extends BackupData { jointTransactions: Transaction[]; lastBackupAt: string | null; snapshotAt: string | null }
export interface NoticeAction { label: string; run: () => void }
export interface Notice { text: string; kind: 'ok' | 'error'; action?: NoticeAction }

const EMPTY: AppData = {
  categories: [], transactions: [], jointTransactions: [], budgets: [], recurring: [], recurringRuns: [], depotEntries: [],
  settings: { ...DEFAULT_SETTINGS }, lastBackupAt: null, snapshotAt: null
};

interface Ctx {
  status: 'loading' | 'ready' | 'error';
  fatal: string | null;
  data: AppData;
  db: Db | null;
  month: string;
  setMonth: (m: string) => void;
  /** angesehenes Konto in Alltag, Buchungen und Auswertung */
  acct: 'own' | 'joint';
  setAcct: (a: 'own' | 'joint') => void;
  notice: Notice | null;
  flash: (text: string, kind?: Notice['kind'], action?: NoticeAction) => void;
  dismissNotice: () => void;
  /** Führt eine Datenbankänderung aus, lädt neu und zeigt Fehler verständlich an. Gibt undefined bei Fehlern zurück. */
  run: <T>(fn: (db: Db) => Promise<T>, okMessage?: string) => Promise<T | undefined>;
  reload: () => Promise<void>;
  persisted: boolean | null;
}

const StoreCtx = createContext<Ctx | null>(null);
export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('StoreProvider fehlt');
  return c;
}

/** Wandelt Fehler in verständliche Texte um. Es werden bewusst keine Datenwerte ausgegeben oder protokolliert. */
export function toMessage(e: unknown): string {
  if (e instanceof AppError || e instanceof BackupError) return e.userMessage;
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return 'Der Speicher des Geräts ist voll. Bitte schaffe Platz und versuche es erneut.';
  return 'Etwas ist schiefgelaufen. Deine bisherigen Daten wurden nicht verändert.';
}

async function loadAll(db: Db): Promise<AppData> {
  const d = await exportAll(db);
  const last = await getMeta<string>(db, 'lastBackupAt');
  const snap = await getPreImportSnapshot(db);
  const own: Transaction[] = [], joint: Transaction[] = [];
  for (const t of d.transactions) (t.account === 'joint' ? joint : own).push(t);
  return { ...d, transactions: own, jointTransactions: joint, lastBackupAt: last ?? null, snapshotAt: snap?.createdAt ?? null };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Ctx['status']>('loading');
  const [fatal, setFatal] = useState<string | null>(null);
  const [db, setDb] = useState<Db | null>(null);
  const [data, setData] = useState<AppData>(EMPTY);
  const [month, setMonth] = useState(currentMonthKey());
  const [acctRaw, setAcct] = useState<'own' | 'joint'>('own');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const dbRef = useRef<Db | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    if (dbRef.current) setData(await loadAll(dbRef.current));
  }, []);

  const flash = useCallback((text: string, kind: Notice['kind'] = 'ok', action?: NoticeAction) => {
    setNotice(action ? { text, kind, action } : { text, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), action ? 7000 : kind === 'error' ? 6000 : 2500);
  }, []);
  const dismissNotice = useCallback(() => { window.clearTimeout(timer.current); setNotice(null); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!('indexedDB' in window)) throw new AppError('Dieser Browser unterstützt keine lokale Datenbank (IndexedDB). Bitte öffne die App in Safari und nicht im privaten Modus.');
        const d = await openBudgetDb();
        await seedIfEmpty(d, currentMonthKey());
        await runRecurring(d, currentMonthKey());
        await runGoals(d, currentMonthKey());
        await ensureHouseholdCategories(d);
        if (cancelled) return;
        dbRef.current = d;
        setDb(d);
        setData(await loadAll(d));
        setStatus('ready');
        try {
          if (navigator.storage?.persisted) setPersisted(await navigator.storage.persisted());
          if (navigator.storage?.persist) setPersisted(await navigator.storage.persist());
        } catch { /* optional */ }
      } catch (e) {
        if (cancelled) return;
        setFatal(e instanceof AppError ? e.userMessage : 'Die lokale Datenbank konnte nicht geöffnet werden. Bitte starte die App neu. Falls das Problem bleibt, prüfe, ob Safari Website-Daten blockiert oder der Speicher voll ist.');
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Monatswechsel bei offener App: Wer den damals aktuellen Monat angesehen hat, springt mit in den neuen Monat.
  // Außerdem werden fällige Wiederkehrende Buchungen erzeugt. Geprüft beim Zurückkehren in die App und minütlich.
  const monthRef = useRef(month);
  monthRef.current = month;
  const currentRef = useRef(currentMonthKey());
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible' || !dbRef.current) return;
      const now = currentMonthKey();
      if (now !== currentRef.current) {
        if (monthRef.current === currentRef.current) setMonth(now);
        currentRef.current = now;
      }
      try { if ((await runRecurring(dbRef.current, now)) + (await runGoals(dbRef.current, now)) > 0) await reload(); } catch { /* wird beim nächsten Start erneut versucht */ }
    };
    const onVis = () => { void check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    const iv = window.setInterval(onVis, 60_000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); window.clearInterval(iv); };
  }, [reload]);

  const run = useCallback(async <T,>(fn: (db: Db) => Promise<T>, ok?: string): Promise<T | undefined> => {
    const d = dbRef.current;
    if (!d) return undefined;
    try {
      const r = await fn(d);
      await reload();
      if (ok) flash(ok, 'ok');
      return r;
    } catch (e) {
      flash(toMessage(e), 'error');
      return undefined;
    }
  }, [reload, flash]);

  const acct = acctRaw === 'joint' && data.settings.joint?.enabled ? 'joint' : 'own';
  return <StoreCtx.Provider value={{ status, fatal, data, db, month, setMonth, acct, setAcct, notice, flash, dismissNotice, run, reload, persisted }}>{children}</StoreCtx.Provider>;
}
