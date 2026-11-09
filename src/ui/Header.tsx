import { useState } from 'react';
import type { ReactNode } from 'react';
import { MonthPicker } from './MonthPicker';
import type { MonthPick } from './MonthPicker';
import { Icon } from './icons';

export function Header({ kicker, title, right, monthSwipe, keepLine, pick }: { kicker?: ReactNode; title: string; right?: ReactNode; monthSwipe?: boolean; keepLine?: boolean; pick?: MonthPick }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hd" data-swipe={monthSwipe ? 'month' : undefined}>
      {/* keepLine: leere Zeile über dem Titel, damit er auf derselben Höhe steht wie der Monat auf den anderen Reitern */}
      <div>{kicker ? <div className="kick">{kicker}</div> : keepLine ? <div className="kick" aria-hidden="true"><span className="kk">&nbsp;</span></div> : null}
        <h1>{pick
          ? <button className="hpick" data-month={pick.month} aria-haspopup="dialog" aria-label={`${title}, ${pick.years ? 'Jahr' : 'Monat'} wählen`} onClick={() => setOpen(true)}>{title}<Icon name="down" size={18} w={2.6} /></button>
          : title}</h1>
      </div>
      {right}
      {open && pick && <MonthPicker {...pick} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function Back({ onClick, label = 'Mehr' }: { onClick: () => void; label?: string }) {
  // data-pop: „eine Ebene zurück“ – auch beim Tippen auf den aktiven Reiter
  return <button className="back" data-pop="" onClick={onClick}><Icon name="left" size={16} w={2.2} />{label}</button>;
}
