import { useEffect, useState } from 'react';
import { Workbox } from 'workbox-window';
import { APP_VERSION } from './version';

// Zustand für „Offline bereit“, „Update verfügbar“ und die manuelle Update-Prüfung. Updates betreffen nur
// Programmdateien; die Finanzdaten liegen in IndexedDB und bleiben unberührt.
//
// Eigene Registrierung (statt der automatischen des Build-Plugins), damit
// - der Browser die Datei sw.js beim Prüfen nie aus dem HTTP-Cache nimmt (updateViaCache: 'none'),
// - ein bereits wartendes Update auch nach einem Neustart erkannt wird,
// - „Jetzt aktualisieren“ auch dann neu lädt, wenn iOS das Umschalten nicht meldet.
export type CheckState = 'idle' | 'checking' | 'none' | 'available' | 'pending' | 'offline' | 'error';
const state = {
  offlineReady: false, needRefresh: false, check: 'idle' as CheckState, serverVersion: null as string | null,
  registration: null as ServiceWorkerRegistration | null, wb: null as Workbox | null
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 1.10.0 > 1.9.3 (numerisch je Stelle) */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0), pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d > 0; }
  return false;
}

function markWaiting(): void { state.needRefresh = true; state.check = 'available'; emit(); }

export function initPwa(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const wb = new Workbox('./sw.js', { scope: './', updateViaCache: 'none' });
  state.wb = wb;
  wb.addEventListener('waiting', markWaiting);
  wb.addEventListener('installed', (e) => { if (!e.isUpdate) { state.offlineReady = true; emit(); } });
  void wb.register().then((reg) => {
    state.registration = reg ?? null;
    if (reg?.waiting && navigator.serviceWorker.controller) markWaiting();
  }).catch(() => { /* ohne Service Worker läuft die App weiter, nur nicht offline */ });
  // Beim Zurückkehren in die App höchstens stündlich still nach Updates sehen
  let last = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - last < 3_600_000) return;
    last = Date.now();
    void state.registration?.update().catch(() => undefined);
  });
}

/** Wartet, bis ein gerade installierender Service Worker fertig ist (oder verworfen wurde). */
async function settle(reg: ServiceWorkerRegistration, timeoutMs: number): Promise<void> {
  const sw = reg.installing;
  if (!sw) return;
  await Promise.race([
    new Promise<void>((resolve) => {
      const done = () => { if (sw.state === 'installed' || sw.state === 'activated' || sw.state === 'redundant') resolve(); };
      sw.addEventListener('statechange', done);
      done();
    }),
    sleep(timeoutMs)
  ]);
}

/** Fragt den Server nach einer neuen Version (Programmdateien), ohne Daten zu senden. */
export async function checkForUpdate(): Promise<void> {
  if (!navigator.onLine) { state.check = 'offline'; emit(); return; }
  state.check = 'checking'; emit();
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const j = (await res.json()) as { version?: unknown };
      state.serverVersion = typeof j.version === 'string' ? j.version.slice(0, 20) : null;
    }
    const newer = !!state.serverVersion && isNewer(state.serverVersion, APP_VERSION);
    const reg = state.registration ?? (await navigator.serviceWorker?.getRegistration()) ?? null;
    if (reg) {
      // Bis zu 3 Versuche: Direkt nach dem Hochladen liefert der Server manchmal noch kurz die alten Dateien.
      for (let i = 0; i < (newer ? 3 : 1) && !reg.waiting; i++) {
        if (i > 0) await sleep(4000);
        await reg.update();
        await settle(reg, 30_000);
      }
      if (reg.waiting) { markWaiting(); return; }
    }
    state.check = state.needRefresh ? 'available' : newer ? 'pending' : 'none';
  } catch {
    state.check = 'error';
  }
  emit();
}

/** Aktiviert das wartende Update und lädt neu – mit Sicherheitsnetz, falls das Umschalten nicht gemeldet wird. */
export function applyUpdate(): void {
  const reg = state.registration;
  let reloaded = false;
  const reload = () => { if (!reloaded) { reloaded = true; window.location.replace(`./?v=${Date.now()}`); } };
  navigator.serviceWorker?.addEventListener('controllerchange', reload);
  if (reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  else state.wb?.messageSkipWaiting();
  setTimeout(reload, 4000);
}

export type ReinstallResult = 'offline' | 'server';

/**
 * Notlösung, falls ein Update hängt: Erst prüfen, ob der Server die neue Version vollständig ausliefert
 * (Startseite und alle darin verlinkten Programmdateien). Nur dann Programm-Cache leeren, Service Worker abmelden
 * und die Startseite frisch laden. Fehlt etwas, bleibt alles wie es ist (kein leerer Bildschirm).
 * Die Datenbank (IndexedDB) wird dabei nicht angerührt.
 */
export async function reinstallApp(): Promise<ReinstallResult | void> {
  if (!navigator.onLine) return 'offline';
  const t = Date.now();
  try {
    const res = await fetch(`./index.html?r=${t}`, { cache: 'no-store' });
    if (!res.ok) return 'server';
    const html = await res.text();
    const files = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1] as string);
    if (files.length === 0) return 'server';
    for (const f of files) {
      const r = await fetch(`${f}?r=${t}`, { cache: 'no-store' });
      if (!r.ok) return 'server';
    }
  } catch {
    return 'server';
  }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
  } finally {
    window.location.replace(`./?r=${t}`);
  }
}

export function usePwa() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return {
    offlineReady: state.offlineReady, needRefresh: state.needRefresh, update: applyUpdate,
    check: state.check, serverVersion: state.serverVersion,
    dismissOffline: () => { state.offlineReady = false; emit(); }
  };
}
