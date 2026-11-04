import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Header, Sheet } from './common';
import { DataSections, ReminderBlock } from './Settings';
import { useStore, toMessage } from '../state/store';
import { createEncryptedBackup, openEncryptedBackup, restoreBackup } from '../backup/backup';
import type { OpenedBackup } from '../backup/backup';
import { MIN_PASSWORD_LENGTH, MAX_FILE_BYTES, BackupError } from '../backup/crypto';
import { readFileText, saveFile } from '../backup/fileio';
import { getPreImportSnapshot, restorePreImportSnapshot, setMeta } from '../db/repo';
import { formatDateDE } from '../domain/dates';

const fmtTs = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '–' : `${formatDateDE(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function BackupScreen({ back }: { back: ReactNode }) {
  const { data, run } = useStore();
  const [mode, setMode] = useState<'export' | 'import' | null>(null);
  const [snapBusy, setSnapBusy] = useState(false);
  const [snapConfirm, setSnapConfirm] = useState(false);
  return (
    <>
      {back}
      <Header title="Daten & Backup" />
      <div className="card stack">
        <div className="sp"><span className="cap">Zuletzt gesichert</span><b>{data.lastBackupAt ? fmtTs(data.lastBackupAt) : 'noch nie'}</b></div>
        <div className="sp"><span className="cap">Buchungen gespeichert</span><b className="num">{data.transactions.length}</b></div>
        <button className="btn" onClick={() => setMode('export')}>Verschlüsseltes Backup erstellen</button>
        <button className="btn sec2" onClick={() => setMode('import')}>Backup wiederherstellen</button>
      </div>
      <ReminderBlock />
      {data.snapshotAt && (
        <div className="card stack">
          <span className="cap">Sicherung vor der letzten Wiederherstellung: {fmtTs(data.snapshotAt)}</span>
          {!snapConfirm && <button className="btn sec2" onClick={() => setSnapConfirm(true)}>Vorherigen Stand zurückholen</button>}
          {snapConfirm && (
            <>
              <span className="cap">Die aktuellen Daten werden durch diesen Stand ersetzt.</span>
              <button className="btn danger" disabled={snapBusy} onClick={async () => {
                setSnapBusy(true);
                await run(async (db) => { if (await getPreImportSnapshot(db)) await restorePreImportSnapshot(db); return true; }, 'Vorheriger Stand wiederhergestellt');
                setSnapBusy(false); setSnapConfirm(false);
              }}>Ja, zurückholen</button>
              <button className="btn sec2" onClick={() => setSnapConfirm(false)}>Abbrechen</button>
            </>
          )}
        </div>
      )}
      <p className="note">
        Backups sind Handarbeit: Es gibt <b>kein automatisches Backup</b>. Die Datei ist mit deinem Passwort verschlüsselt (PBKDF2-SHA256 + AES-256-GCM). Das Passwort wird nirgends gespeichert; ohne Passwort ist die Datei nicht lesbar. Speichere sie z. B. in „Dateien“/iCloud Drive. Die Datenbank auf dem Gerät selbst ist <b>nicht</b> zusätzlich verschlüsselt, sie ist durch die Gerätesperre geschützt.
      </p>
      <DataSections />
      {mode === 'export' && <ExportSheet onClose={() => setMode(null)} />}
      {mode === 'import' && <ImportSheet onClose={() => setMode(null)} />}
    </>
  );
}

function ExportSheet({ onClose }: { onClose: () => void }) {
  const { db, flash, reload } = useStore();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [handed, setHanded] = useState<'shared' | 'downloaded' | null>(null);
  async function confirmSaved(saved: boolean) {
    if (!db) return;
    if (saved) { await setMeta(db, 'lastBackupAt', new Date().toISOString()); await reload(); flash('Backup als gesichert vermerkt'); }
    else flash('Nicht als gesichert vermerkt. Erstelle das Backup erneut und wähle „In Dateien sichern“.', 'error');
    onClose();
  }
  async function go() {
    if (!db) return;
    if (pw.length < MIN_PASSWORD_LENGTH) return setErr(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
    if (pw !== pw2) return setErr('Die Passwörter stimmen nicht überein.');
    setErr(''); setBusy(true);
    try {
      const b = await createEncryptedBackup(db, pw);
      const r = await saveFile(b.filename, b.text);
      if (r === 'cancelled') { flash('Abgebrochen. Es wurde kein Backup gespeichert.', 'error'); }
      else setHanded(r);
    } catch (e) { setErr(toMessage(e)); }
    setBusy(false); setPw(''); setPw2('');
  }
  if (handed) {
    return (
      <Sheet title="Backup erstellen" onClose={onClose}>
        <div className="card stack">
          <b>Liegt die Datei jetzt sicher ab?</b>
          <span className="cap">{handed === 'shared'
            ? 'Die App sieht nicht, wohin du die Datei im Teilen-Menü geschickt hast. Nur wenn sie z. B. über „In Dateien sichern“ in iCloud Drive liegt, zählt sie als Backup.'
            : 'Die Datei wurde zum Herunterladen übergeben. Prüfe, ob sie im Download-Ordner angekommen ist.'}</span>
          <button className="btn" onClick={() => void confirmSaved(true)}>Ja, gespeichert</button>
          <button className="btn sec2" onClick={() => void confirmSaved(false)}>Nein / weiß nicht</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="Backup erstellen" onClose={onClose}>
      <div className="card flush">
        <label className="field"><span>Passwort</span><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="field"><span>Wiederholen</span><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
      </div>
      <p className="note">Wichtig: Wer das Passwort vergisst, kann das Backup nicht mehr öffnen. Es gibt keine Wiederherstellung des Passworts.</p>
      {err && <div className="err-text" role="alert">{err}</div>}
      <button className="btn" onClick={go} disabled={busy}>{busy ? 'Verschlüssele …' : 'Verschlüsseln & speichern'}</button>
    </Sheet>
  );
}

function ImportSheet({ onClose }: { onClose: () => void }) {
  const { db, run } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<OpenedBackup | null>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr('');
    if (f.size > MAX_FILE_BYTES) return setErr('Die Datei ist zu groß für ein Backup.');
    try { setText(await readFileText(f)); setName(f.name); } catch (e) { setErr(toMessage(e)); }
  }
  async function open() {
    if (text === null) return;
    setErr(''); setBusy(true);
    try { setOpened(await openEncryptedBackup(text, pw)); }
    catch (e) { setErr(e instanceof BackupError ? e.userMessage : 'Die Datei konnte nicht geöffnet werden. Deine Daten wurden nicht verändert.'); }
    setBusy(false); setPw('');
  }
  async function restore() {
    if (!opened || !db) return;
    setBusy(true);
    const r = await run((d) => restoreBackup(d, opened).then(() => true), 'Backup wiederhergestellt');
    setBusy(false);
    if (r) onClose();
  }
  if (opened) {
    const s = opened.summary;
    return (
      <Sheet title="Wiederherstellen" onClose={onClose}>
        <div className="card stack">
          <div className="sp"><span className="cap">Backup vom</span><b>{fmtTs(s.createdAt)}</b></div>
          <div className="sp"><span className="cap">Buchungen</span><b className="num">{s.transactions}</b></div>
          <div className="sp"><span className="cap">Zeitraum</span><b>{s.firstDate ? `${formatDateDE(s.firstDate)} – ${formatDateDE(s.lastDate ?? s.firstDate)}` : '–'}</b></div>
          <div className="sp"><span className="cap">Kategorien / Budgets / Vorlagen</span><b className="num">{s.categories} / {s.budgets} / {s.recurring}</b></div>
        </div>
        <p className="note">Achtung: Alle aktuellen Daten auf diesem Gerät werden durch dieses Backup ersetzt. Vorher wird automatisch eine Sicherung des aktuellen Stands angelegt, die du in Mehr › Backup zurückholen kannst.</p>
        <button className="btn" onClick={restore} disabled={busy}>Aktuelle Daten ersetzen</button>
      </Sheet>
    );
  }
  return (
    <Sheet title="Backup öffnen" onClose={onClose}>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      <button className="btn sec2" onClick={() => fileRef.current?.click()}>{name || 'Backup-Datei wählen'}</button>
      <div className="card flush"><label className="field"><span>Passwort</span><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label></div>
      {err && <div className="err-text" role="alert">{err}</div>}
      <button className="btn" onClick={open} disabled={busy || text === null || pw === ''}>{busy ? 'Prüfe …' : 'Prüfen'}</button>
      <p className="note">Es wird erst nur geprüft. Deine Daten ändern sich erst nach deiner Bestätigung.</p>
    </Sheet>
  );
}
