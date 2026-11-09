import { useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { saveSettings } from '../../data/settings';
import { CRT_DARK_MS, crtEgg, crtOff, crtOn } from '../../ui/crt';
import { wipeAll } from '../../data/dataset';
import { checkForUpdate, isNewer, reinstallApp, usePwa } from '../../state/pwa';
import { APP_VERSION } from '../../version';
import { Chevr } from '../../ui/Collapse';

const REMIND = [0, 7, 14, 30];

/** Backup-Erinnerung: Aus / 7 / 14 / 30 Tage, ohne Kasten. */
export function ReminderBlock() {
  const { data, run } = useStore();
  const s = data.settings;
  return (
    <>
      <div className="cap seccap">Erinnerung</div>
      <div className="spseg flushseg" role="radiogroup" aria-label="Backup-Erinnerung">
        {REMIND.map((d) => <button key={d} role="radio" aria-checked={s.backupReminderDays === d} className={s.backupReminderDays === d ? 'on' : ''} onClick={() => run((db) => saveSettings(db, { ...s, backupReminderDays: d }))}>{d === 0 ? 'Aus' : `${d} Tage`}</button>)}
      </div>
    </>
  );
}

/** Speicher & Datenschutz, Zurücksetzen, App-Version (früher „Einstellungen“). */
export function DataSections() {
  const { run } = useStore();
  const [reset, setReset] = useState(0);
  return (
    <>
      <AppVersionCard />
      {reset === 0 && <button className="btn danger" onClick={() => setReset(1)}>Alle Daten löschen</button>}
      {reset === 1 && (
        <div className="card stack">
          <span className="cap">Alles geht auf 0, übrig bleiben die Standard-Kategorien. Erstelle vorher ein Backup.</span>
          <button className="btn danger" onClick={async () => {
            // Röhrenfernseher aus → alles löschen → wieder an
            await crtOff();
            const t0 = Date.now();
            const ok = await run((db) => wipeAll(db).then(() => true), 'Alle Daten gelöscht');
            if (ok) setReset(0);
            // eine Weile schwarz lassen, auch wenn das Löschen schneller war
            await new Promise((r) => setTimeout(r, Math.max(0, CRT_DARK_MS - (Date.now() - t0))));
            await crtOn();
          }}>Ja, alles löschen</button>
          <button className="btn sec2" onClick={() => setReset(0)}>Abbrechen</button>
        </div>
      )}
    </>
  );
}

function AppVersionCard() {
  const pwa = usePwa();
  const [hard, setHard] = useState(0);
  const [reErr, setReErr] = useState('');
  const [busy, setBusy] = useState(false);
  const newer = !!pwa.serverVersion && isNewer(pwa.serverVersion, APP_VERSION);
  // Kleines Extra: lange auf die Versionsnummer drücken → Bildschirm wie ein alter Röhrenfernseher aus und wieder an
  const egg = useRef<number | null>(null);
  const stopEgg = () => { document.querySelector('[data-crt].charging')?.classList.remove('charging'); if (egg.current !== null) { window.clearTimeout(egg.current); egg.current = null; } };
  const easterEgg = {
    // kurz halten (0,5 s) – danach läuft alles von selbst, Loslassen bricht nichts mehr ab
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      stopEgg();
      const row = e.currentTarget;
      row.classList.add('charging');
      egg.current = window.setTimeout(() => { egg.current = null; row.classList.remove('charging'); void crtEgg(APP_VERSION); }, 500);
    },
    onPointerUp: stopEgg, onPointerLeave: stopEgg, onPointerCancel: stopEgg,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    'data-crt': ''
  };
  const msg: Record<string, string> = {
    idle: '', checking: 'Suche nach Updates …', none: 'Du hast die neueste Version.',
    available: 'Eine neue Version ist bereit.',
    pending: `Version ${pwa.serverVersion ?? ''} liegt auf dem Server, die neuen Programmdateien kommen aber noch nicht an. Nach dem Hochladen braucht GitHub oft ein paar Minuten. Bitte in 5–10 Minuten erneut prüfen; klappt es dann immer noch nicht, „Neu installieren“.`,
    offline: 'Keine Internetverbindung. Bitte später erneut prüfen.',
    error: 'Die Prüfung ist fehlgeschlagen. Bitte später erneut versuchen.'
  };
  const available = pwa.needRefresh || pwa.check === 'available';
  async function reinstall() {
    setBusy(true); setReErr('');
    const r = await reinstallApp();
    setBusy(false);
    if (r === 'offline') setReErr('Keine Internetverbindung. Es wurde nichts verändert.');
    if (r === 'server') setReErr('Der Server liefert die neue Version noch nicht vollständig aus. Es wurde nichts verändert – bitte in ein paar Minuten erneut versuchen.');
  }
  return (
    <>
      <div className="card flush">
        <div className="srow" {...easterEgg}>Version<b>{APP_VERSION}</b></div>
        {available
          ? <button className="srow" onClick={pwa.update}>Jetzt aktualisieren{pwa.serverVersion && <b style={{ color: 'var(--warn)' }}>{pwa.serverVersion}</b>}</button>
          : <button className="srow" disabled={pwa.check === 'checking'} onClick={() => void checkForUpdate()}>{pwa.check === 'checking' ? 'Suche …' : 'Nach Updates suchen'}<Chevr /></button>}
        {hard === 0 && !available && pwa.check !== 'checking' && (newer || pwa.check === 'error') && (
          <button className="srow" onClick={() => setHard(1)}>Update hängt? Neu installieren<Chevr /></button>
        )}
      </div>
      {pwa.check !== 'idle' && pwa.check !== 'checking' && <span className={'mini' + (available || pwa.check === 'pending' ? ' warn' : '')} role="status" style={{ padding: '0 4px' }}>{msg[pwa.check]}</span>}
      {hard === 1 && (
        <div className="card stack">
          <span className="cap">Lädt die Programmdateien neu, sobald der Server die neue Version vollständig ausliefert. Deine Daten bleiben erhalten.</span>
          <button className="btn" disabled={busy} onClick={() => void reinstall()}>{busy ? 'Prüfe Server …' : 'Neu installieren'}</button>
          <button className="btn sec2" onClick={() => { setHard(0); setReErr(''); }}>Abbrechen</button>
          {reErr && <span className="err-text" role="alert">{reErr}</span>}
        </div>
      )}
    </>
  );
}
