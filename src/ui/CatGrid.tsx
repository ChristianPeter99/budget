import { useState } from 'react';
import { ringElapsed } from './ringStart';
import type { ReactNode } from 'react';
import { formatEUR } from '../domain/money';
import { Icon } from './icons';
import type { useDragSort } from './dragSort';

/** Eine Kachel: Symbol, Anzahl (Unterkategorien bzw. Positionen), Name, Betrag; optional Budget-Balken */
export interface TileItem {
  id: string; name: string; icon: string; tone: string; cents: number; count: number;
  bar?: { ratio: number; over: boolean; color: string; label: string } | null;
}

/**
 * Kategorien als Kacheln, zwei pro Zeile. Tipp klappt die Kachel auf: der Inhalt (body) erscheint über die
 * volle Breite unter ihrer Zeile; immer nur eine offen. Gedrückt halten und ziehen sortiert (in alle Richtungen).
 */
export function CatGrid({ items, drag, canDrag, body }: {
  items: TileItem[]; drag: ReturnType<typeof useDragSort>; canDrag: boolean; body: (id: string) => ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Wischen: Einblenden beginnt beim Einrasten in der Vorschau und läuft hier nahtlos weiter (wie Balken/Kalender)
  const [intro0] = useState(ringElapsed);
  const open = items.some((t) => t.id === openId) ? openId : null;
  const out: ReactNode[] = [];
  items.forEach((t, i) => {
    const it = drag.item(t.id);
    const on = open === t.id;
    out.push(
      <button key={t.id} ref={it.ref} style={{ ...it.style, ['--d' as string]: `${i * 18 - intro0}ms` }} className={'ctile ' + it.className + (on ? ' on' : '') + (canDrag ? ' dhandle' : '')}
        aria-expanded={on} aria-label={`${t.name}, ${formatEUR(t.cents)}${t.bar?.over ? ', Budget überschritten' : ''}`}
        {...(canDrag ? drag.handle(t.id) : {})} onClick={() => setOpenId(on ? null : t.id)}>
        <span className="ctop"><span className={'tile flat ' + t.tone}><Icon name={t.icon} size={22} /></span>{t.count > 0 && <small>{t.count}</small>}</span>
        <span className="cname">{t.name}</span>
        <b className={'cnum num' + (t.bar?.over ? ' overshake' : '')}>{formatEUR(t.cents)}</b>
        {t.bar && <span className={'gbar' + (t.bar.over ? ' overbar' : '')} role="img" aria-label={t.bar.label}><i style={{ width: `${Math.min(100, t.bar.ratio * 100)}%`, background: t.bar.color }} /></span>}
      </button>
    );
    // Ende einer Zeile: aufgeklappte Kachel dieser Zeile zeigt ihren Inhalt darunter über die volle Breite
    if (i % 2 === 1 || i === items.length - 1) {
      const row = items.slice(i - (i % 2), i + 1);
      const o = row.find((x) => x.id === open);
      if (o) out.push(<div key={'p-' + o.id} className={'cpanel' + (row[0]?.id === o.id ? ' l' : ' r')}>{body(o.id)}</div>);
    }
  });
  return <div className="catgrid">{out}</div>;
}

const VIEW_KEY = 'budget.catview.v1';
export type CatView = 'grid' | 'list';

/** Kacheln oder Liste – je Seite auf diesem Gerät gemerkt (nur die Ansicht, keine Daten). Standard: Kacheln. */
export function useCatView(page: string): [CatView, () => void] {
  const read = (): CatView => {
    try { const v = (JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Record<string, unknown>)[page]; return v === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  };
  const [view, setView] = useState<CatView>(read);
  const toggle = () => setView((v) => {
    const n: CatView = v === 'grid' ? 'list' : 'grid';
    try { const all = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Record<string, unknown>; all[page] = n; localStorage.setItem(VIEW_KEY, JSON.stringify(all)); } catch { /* nur Komfort */ }
    return n;
  });
  return [view, toggle];
}

/** Umschalter Kacheln ↔ Liste; das Symbol zeigt die Ansicht, zu der man wechselt */
export function ViewToggle({ view, onToggle, tone = '' }: { view: CatView; onToggle: () => void; tone?: string }) {
  return (
    <button className={'sortpill viewtog ' + tone} aria-label={view === 'grid' ? 'Als Liste anzeigen' : 'Als Kacheln anzeigen'} onClick={onToggle}>
      <Icon name={view === 'grid' ? 'list' : 'grid'} size={16} w={2.2} />
    </button>
  );
}
