import { useRef, useState } from 'react';
import { Sheet } from './common';
import { useStore } from '../state/store';
import { saveSettings, wipeAll } from '../db/repo';
import { groupTargets } from '../domain/calc';
import { formatEUR } from '../domain/money';
import { APP_VERSION } from '../version';
import { checkForUpdate, isNewer, reinstallApp, usePwa } from '../pwa';
import { crtOff, crtOn } from './crt';

const REMIND = [0, 7, 14, 30];

/** Backup-Erinnerung: Aus / 7 / 14 / 30 Tage, ohne Kasten. */
export function ReminderBlock() {
  const { data, run } = useStore();
  const s = data.settings;
  return (
    <div className="setblock">
      <h2>Backup-Erinnerung</h2>
      <div className="wseg" role="radiogroup" aria-label="Backup-Erinnerung">
        {REMIND.map((d) => <button key={d} role="radio" aria-checked={s.backupReminderDays === d} className={s.backupReminderDays === d ? 'on' : ''} onClick={() => run((db) => saveSettings(db, { ...s, backupReminderDays: d }))}>{d === 0 ? 'Aus' : `${d} Tage`}</button>)}
      </div>
      <span className="mini">Hinweis auf der Übersicht, wenn das letzte Backup älter ist.</span>
    </div>
  );
}

/** Speicher & Datenschutz, Zurücksetzen, App-Version (früher „Einstellungen“). */
export function DataSections() {
  const { run } = useStore();
  const [reset, setReset] = useState(0);
  return (
    <>
      <div className="card flush">
        <div className="sec"><h2>Datenschutz</h2></div>
        <p className="note pad">Alle Daten liegen nur auf diesem iPhone. Es wird nichts übertragen, es gibt kein Tracking. Die Datenbank ist durch die Gerätesperre geschützt, Backups zusätzlich mit deinem Passwort verschlüsselt.</p>
      </div>

      <div className="card flush">
        <div className="sec"><h2>Daten</h2></div>
        <div className="pad stack">
          {reset === 0 && <button className="btn danger" onClick={() => setReset(1)}>Alle Daten löschen</button>}
          {reset === 1 && (
            <>
              <p className="note">Alles geht auf 0: Buchungen, Fixkosten und Gehalt, Sparrate, Sparziele, Sparkonto- und Depotstände, Budgets und eigene Kategorien. Übrig bleibt eine leere App mit Standard-Kategorien. Der jetzige Stand wird vorher lokal gesichert und lässt sich über „Vorherigen Stand zurückholen“ wiederherstellen. Erstelle trotzdem vorher ein Backup.</p>
              <button className="btn danger" onClick={async () => {
                // Röhrenfernseher aus → alles löschen → wieder an
                await crtOff();
                const ok = await run((db) => wipeAll(db).then(() => true), 'Alle Daten gelöscht');
                if (ok) setReset(0);
                await crtOn();
              }}>Ja, alles löschen</button>
              <button className="btn sec2" onClick={() => setReset(0)}>Abbrechen</button>
            </>
          )}
        </div>
      </div>
      <AppVersionCard />
    </>
  );
}

/** Aufteilung des Gehalts in Fixkosten/Alltag/Sparen (Prozent, zusammen höchstens 100). */
export function SplitSheet({ onClose }: { onClose: () => void }) {
  const { data, run } = useStore();
  const s = data.settings;
  const [split, setSplit] = useState({ ...s.split });
  const total = split.fix + split.alltag + split.spar;
  const t = groupTargets({ ...s, split });
  const rows: { key: 'fix' | 'alltag' | 'spar'; label: string; color: string }[] = [
    { key: 'fix', label: 'Fixkosten', color: 'var(--fix)' }, { key: 'alltag', label: 'Alltag', color: 'var(--all)' }, { key: 'spar', label: 'Sparen', color: 'var(--spar)' }
  ];
  async function save() {
    if (await run((db) => saveSettings(db, { ...s, split }).then(() => true), 'Aufteilung gespeichert')) onClose();
  }
  return (
    <Sheet title="Aufteilung" onClose={onClose}>
      <div className="card flush">
        <div className="kv"><span>Gehalt (Basis)</span><b>{formatEUR(s.expectedIncomeCents)}</b></div>
        {rows.map((r) => (
          <div className="slider" key={r.key}>
            <div className="sp"><span>{r.label}</span><b className="num">{split[r.key]} % · {formatEUR(t[r.key])}</b></div>
            <input type="range" min={0} max={100} step={1} value={split[r.key]} style={{ accentColor: r.color }} aria-label={`${r.label} in Prozent`}
              onChange={(e) => setSplit({ ...split, [r.key]: Number(e.target.value) })} />
          </div>
        ))}
        <div className="kv"><span>Frei / Puffer</span><b className={total > 100 ? 'neg' : ''}>{100 - total} % · {formatEUR(t.rest)}</b></div>
      </div>
      {total > 100 && <div className="err-text" role="alert">Zusammen höchstens 100 % (aktuell {total} %).</div>}
      <button className="btn" onClick={save} disabled={total > 100}>Speichern</button>
      <p className="note">Das Gehalt änderst du unter Mehr › Wiederkehrend.</p>
    </Sheet>
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
  const stopEgg = () => { if (egg.current !== null) { window.clearTimeout(egg.current); egg.current = null; } };
  const easterEgg = {
    onPointerDown: () => { stopEgg(); egg.current = window.setTimeout(() => { egg.current = null; void crtOff().then(() => new Promise((r) => setTimeout(r, 350))).then(crtOn); }, 700); },
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
    <div className="card flush">
      <div className="sec"><h2>App-Version</h2></div>
      <div className="kv" {...easterEgg}><span>Installiert</span><b>{APP_VERSION}</b></div>
      {pwa.serverVersion && <div className="kv"><span>Auf dem Server</span><b>{pwa.serverVersion}</b></div>}
      <div className="pad stack">
        {pwa.check !== 'idle' && <span className={'cap' + (available || pwa.check === 'pending' ? ' warn' : '')} role="status">{msg[pwa.check]}</span>}
        {available
          ? <button className="btn" onClick={pwa.update}>Jetzt aktualisieren</button>
          : <button className="btn sec2" disabled={pwa.check === 'checking'} onClick={() => void checkForUpdate()}>{pwa.check === 'checking' ? 'Suche …' : 'Nach Update suchen'}</button>}
        {hard === 0 && !available && pwa.check !== 'checking' && (newer || pwa.check === 'error') && (
          <button className="btn sec2" onClick={() => setHard(1)}>Update hängt? Neu installieren</button>
        )}
        {hard === 1 && (
          <>
            <span className="cap">Prüft zuerst, ob der Server die neue Version vollständig ausliefert, und lädt dann die Programmdateien neu. Deine Buchungen und Einstellungen bleiben erhalten. Nur mit Internet ausführen.</span>
            <button className="btn" disabled={busy} onClick={() => void reinstall()}>{busy ? 'Prüfe Server …' : 'Neu installieren'}</button>
            <button className="btn sec2" onClick={() => { setHard(0); setReErr(''); }}>Abbrechen</button>
            {reErr && <span className="err-text" role="alert">{reErr}</span>}
          </>
        )}
        <span className="mini">Die App prüft beim Start selbst auf Updates. Ein Update ändert nur das Programm, nie deine Daten. Vorher ein Backup schadet trotzdem nicht.</span>
      </div>
    </div>
  );
}
