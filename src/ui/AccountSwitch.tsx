import { useStore } from '../state/store';

/** Umschalter „Ich | Gemeinsam“ – erscheint nur, wenn ein gemeinsames Konto eingerichtet ist. */
export function AccountSwitch() {
  const { data, acct, setAcct } = useStore();
  const j = data.settings.joint;
  if (!j?.enabled) return null;
  return (
    <div className="seg" role="tablist" aria-label="Konto">
      <button role="tab" aria-selected={acct === 'own'} className={acct === 'own' ? 'on' : ''} onClick={() => setAcct('own')}>Ich</button>
      <button role="tab" aria-selected={acct === 'joint'} className={acct === 'joint' ? 'on' : ''} onClick={() => setAcct('joint')}>{j.name}</button>
    </div>
  );
}
