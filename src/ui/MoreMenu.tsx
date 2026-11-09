import { useState } from 'react';
import { Icon } from './icons';

/** ⋯-Menü oben rechts: selten gebrauchte Aktionen, damit die Seite selbst ruhig bleibt. */
export function MoreMenu({ items, label = 'Weitere Aktionen' }: { items: { label: string; onClick: () => void; danger?: boolean; hidden?: boolean }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const shown = items.filter((i) => !i.hidden);
  if (shown.length === 0) return null;
  return (
    <span className="moremenu">
      <button className="ib" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="moredots" size={21} w={2} /></button>
      {open && <>
        <span className="mmbd" onClick={() => setOpen(false)} />
        <span className="mmlist" role="menu">
          {shown.map((i) => <button key={i.label} role="menuitem" className={i.danger ? 'danger' : ''} onClick={() => { setOpen(false); i.onClick(); }}>{i.label}</button>)}
        </span>
      </>}
    </span>
  );
}
