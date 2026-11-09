import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icons';

/** Dauer des weichen Auf- und Zuklappens */
export const COLLAPSE_MS = 260;
/**
 * Weiches Auf- und Zuklappen: Die Höhe wächst bzw. schrumpft (Grid 0fr → 1fr). Beim Zuklappen bleibt der Inhalt
 * bis zum Ende der Bewegung stehen und wird erst danach entfernt.
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<'shut' | 'open' | 'done'>(open ? 'done' : 'shut');
  useEffect(() => {
    if (open) {
      setMounted(true);
      let f2 = 0;
      const f1 = requestAnimationFrame(() => { f2 = requestAnimationFrame(() => setState('open')); });
      const t = window.setTimeout(() => setState('done'), COLLAPSE_MS + 40);
      return () => { cancelAnimationFrame(f1); cancelAnimationFrame(f2); window.clearTimeout(t); };
    }
    setState('shut');
    const t = window.setTimeout(() => setMounted(false), COLLAPSE_MS);
    return () => window.clearTimeout(t);
  }, [open]);
  if (!mounted) return null;
  return <div className={'clp ' + state} aria-hidden={open ? undefined : true}><div className="clpin">{children}</div></div>;
}

export function Chevron({ open }: { open: boolean }) {
  return <span className="chev" style={{ transform: open ? 'rotate(90deg)' : 'none' }}><Icon name="right" size={14} w={2.4} /></span>;
}

/** Kleiner Pfeil › für antippbare Zeilen und Textknöpfe */
export function Chevr() {
  return <span className="chevr" aria-hidden="true"><Icon name="right" size={14} w={2.2} /></span>;
}

const COLLAPSE_KEY = 'budget.collapsed.v1';
function readCollapsed(): Record<string, string[]> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string[]>) : {};
  } catch { return {}; }
}

/**
 * Welche Kategorien eingeklappt sind – je Ansicht (z. B. „alltag“, „joint“, „fix“), auf diesem Gerät gemerkt.
 * Enthält nur Kategorie-IDs, keine Beträge. Ohne Speicher (privates Fenster) gilt: alles aufgeklappt.
 */
export function useCollapsed(view: string) {
  const [set, setSet] = useState<Set<string>>(() => new Set(Array.isArray(readCollapsed()[view]) ? readCollapsed()[view] : []));
  const toggle = (id: string) => setSet((old) => {
    const n = new Set(old);
    if (n.has(id)) n.delete(id); else n.add(id);
    try { const all = readCollapsed(); all[view] = [...n]; localStorage.setItem(COLLAPSE_KEY, JSON.stringify(all)); } catch { /* nur Komfort */ }
    return n;
  });
  /** Mehrere auf einmal ein- oder ausklappen („Alle zuklappen“ / „Alle aufklappen“) */
  const setAll = (ids: string[], collapsed: boolean) => setSet((old) => {
    const n = new Set(old);
    for (const id of ids) { if (collapsed) n.add(id); else n.delete(id); }
    try { const all = readCollapsed(); all[view] = [...n]; localStorage.setItem(COLLAPSE_KEY, JSON.stringify(all)); } catch { /* nur Komfort */ }
    return n;
  });
  return { isCollapsed: (id: string) => set.has(id), toggle, setAll };
}

/** Knopf neben „Sortieren“: alle Kategorien zu- bzw. aufklappen. Sind alle zu, klappt er alle auf. */
export function FoldAllBtn({ ids, fold, onFold }: { ids: string[]; fold: ReturnType<typeof useCollapsed>; onFold?: (collapsed: boolean) => void }) {
  const allShut = ids.length > 0 && ids.every((id) => fold.isCollapsed(id));
  return (
    <button className="sortpill foldall" aria-label={allShut ? 'Alle aufklappen' : 'Alle zuklappen'}
      onClick={() => { fold.setAll(ids, !allShut); onFold?.(!allShut); }}>
      <Icon name={allShut ? 'unfold' : 'fold'} size={17} w={2.2} />
    </button>
  );
}

/** Pfeil rechts im Kategorie-Kopf zum Ein- und Ausklappen. */
export function CollapseBtn({ name, collapsed, onClick }: { name: string; collapsed: boolean; onClick: () => void }) {
  return (
    <button className="gtog" aria-expanded={!collapsed} aria-label={`${name} ${collapsed ? 'aufklappen' : 'zuklappen'}`}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <Icon name="right" size={16} w={2.4} />
    </button>
  );
}
