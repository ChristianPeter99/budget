import { Icon } from './icons';

/** Zahlenfeld unten (Neue Buchung, Fixkosten): „Fertig“, Betrag, „Speichern“ und die Tasten. */
export function KeyDock({ shown, err, busy, onDone, onSave, onKey }: { shown: string; err?: string; busy?: boolean; onDone: () => void; onSave: () => void; onKey: (k: string) => void }) {
  return (
    <>
      <div className="padspace" aria-hidden="true" />
      <div className="keydock">
        <div className="keydock-top">
          <button type="button" className="lnk" onClick={onDone}>Fertig</button>
          <span className="num">{shown} €</span>
          <button type="button" className="btn kd-save" onClick={onSave} disabled={busy}>Speichern</button>
        </div>
        {err && <div className="err-text kd-err" role="alert">{err}</div>}
        <div className="pad3" role="group" aria-label="Zahlenfeld">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'].map((k) => (
            <button key={k} className="key" aria-label={k === 'back' ? 'Löschen' : k} onClick={() => onKey(k)}>
              {k === 'back' ? <Icon name="del" size={26} /> : k}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
