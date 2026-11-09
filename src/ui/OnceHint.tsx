import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Hinweis nur beim ersten Mal: leuchtet kurz auf (Fokus), blendet nach einigen Sekunden aus und kommt danach nicht wieder.
 * Gemerkt nur in diesem Browser (localStorage) – kein Datenbankeintrag, kein Backup-Inhalt.
 */
export function OnceHint({ id, children, className = '', ms = 7000 }: { id: string; children: ReactNode; className?: string; ms?: number }) {
  const key = 'hint:' + id;
  const [show] = useState(() => { try { return localStorage.getItem(key) !== '1'; } catch { return false; } });
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!show) return;
    try { localStorage.setItem(key, '1'); } catch { /* privat: dann eben jedes Mal */ }
    const t = setTimeout(() => setGone(true), ms);
    return () => clearTimeout(t);
  }, [show, key, ms]);
  if (!show || gone) return null;
  return <span className={'oncehint ' + className} style={{ ['--hintms' as string]: `${ms}ms` }}>{children}</span>;
}
