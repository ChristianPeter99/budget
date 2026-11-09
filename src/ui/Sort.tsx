import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { Sheet } from './Sheet';

/** Reihenfolge der Kategorien: eigene (per Ziehen) oder nach Betrag absteigend. Pro Ansicht gemerkt (nur auf diesem Gerät). */
export type SortMode = 'custom' | 'amount';
const SORT_KEY = 'budget.sort.v1';
export function useSortMode(view: string): [SortMode, (m: SortMode) => void] {
  const read = (): Record<string, SortMode> => { try { return JSON.parse(localStorage.getItem(SORT_KEY) ?? '{}') ?? {}; } catch { return {}; } };
  const [mode, setMode] = useState<SortMode>(() => (read()[view] === 'amount' ? 'amount' : 'custom'));
  useEffect(() => { setMode(read()[view] === 'amount' ? 'amount' : 'custom'); }, [view]);
  const set = (m: SortMode) => {
    setMode(m);
    try { const all = read(); all[view] = m; localStorage.setItem(SORT_KEY, JSON.stringify(all)); } catch { /* nur Komfort */ }
  };
  return [mode, set];
}

/** Auswahl der Reihenfolge (eigene oder nach Betrag). */
export function SortSheet({ mode, onPick, onClose }: { mode: SortMode; onPick: (m: SortMode) => void; onClose: () => void }) {
  const opt = (m: SortMode, title: string, text: string) => (
    <button className="link sortopt" role="radio" aria-checked={mode === m} onClick={() => { onPick(m); onClose(); }}>
      <span className="mid"><b>{title}</b><small>{text}</small></span>
      {mode === m && <Icon name="check" size={18} w={2.6} />}
    </button>
  );
  return (
    <Sheet title="Sortieren" onClose={onClose}>
      <div className="card flush" role="radiogroup" aria-label="Reihenfolge">
        {opt('custom', 'Eigene Reihenfolge', 'Kategorien gedrückt halten und an ihren Platz ziehen')}
        {opt('amount', 'Nach Betrag', 'Höchste Beträge im Monat oben, auch innerhalb der Kategorien')}
      </div>
    </Sheet>
  );
}
