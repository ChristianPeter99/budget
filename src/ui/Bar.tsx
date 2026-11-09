import { useEffect, useRef, useState } from 'react';
import { ringElapsed } from './ringStart';
import { useTweenList } from './animation';
import { Icon } from './icons';

export function Bar({ ratio, color, large }: { ratio: number; color: string; large?: boolean }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 1)) * 100;
  const [intro0] = useState(ringElapsed);
  // Fortschritt läuft beim Öffnen ein; über 100 % wackelt der Balken danach einmal kurz
  return <div className={'bar' + (large ? ' l' : '') + (ratio > 1 ? ' overbar' : '')} role="presentation"><i style={{ width: `${pct}%`, background: color, ['--d' as string]: `${-intro0}ms` }} /></div>;
}

/** Balkenfarbe nach Zustand: über Budget = rot, ab 85 % = Bernstein („wird knapp“), sonst die Grundfarbe. */
export function barColor(ratio: number, over: boolean, base: string): string {
  if (over) return 'var(--neg)';
  if (ratio >= 0.85) return 'var(--warn)';
  return base;
}

/** Ein Abschnitt im Kategorie-Balken. */
export interface CatSeg { id: string; name: string; icon: string; cents: number }

/**
 * Hoher Balken mit einem Abschnitt je Kategorie und dem Kategorie-Symbol darin.
 * Abschnitte nach Betrag absteigend. `base` ist 100 %: beim Alltag das Budget (Rest bleibt dunkel), bei Fixkosten die Summe (immer voll).
 * Ein Symbol erscheint nur, wenn der Abschnitt mindestens 26 px breit ist.
 */
export function CatBar({ segs, base, color, label, over, onOpen }: { segs: CatSeg[]; base: number; color: string; label: string; over?: boolean; onOpen?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || 340);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 340));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [intro0] = useState(ringElapsed);
  // Beim Monatswechsel gleiten die Abschnitte wie der Ring der Übersicht zu ihren neuen Breiten
  const tw = useTweenList([...segs.map((s) => Math.max(0, s.cents)), Math.max(0, base)]);
  const cur = new Map(segs.map((s, i) => [s.id, tw[i] ?? 0]));
  // Größte Ausgabe links, dann absteigend – unabhängig von der Reihenfolge der Liste darunter
  const shown = segs.filter((s) => s.cents > 0 || (cur.get(s.id) ?? 0) > 1).sort((a, b) => b.cents - a.cents || (cur.get(b.id) ?? 0) - (cur.get(a.id) ?? 0));
  const total = Math.max(tw[segs.length] ?? base, shown.reduce((a, s) => a + (cur.get(s.id) ?? 0), 0));
  return (
    <div ref={ref} className={'catbar' + (over ? ' over' : '') + (onOpen ? ' tap' : '')} role={onOpen ? 'button' : 'img'} tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `${label}. Details anzeigen` : label} onClick={onOpen}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}>
      {total > 0 && shown.map((s, i) => {
        const pct = ((cur.get(s.id) ?? 0) / total) * 100;
        // Beim Öffnen füllt sich der Balken von links, Abschnitt für Abschnitt (wie der Ring der Übersicht)
        return (
          <span key={s.id} style={{ width: `${pct}%`, background: color, ['--d' as string]: `${i * 55 - intro0}ms` }}>
            {(pct / 100) * w >= 26 && <Icon name={s.icon} size={16} w={2.1} />}
          </span>
        );
      })}
    </div>
  );
}
