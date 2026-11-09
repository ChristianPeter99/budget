import { useEffect, useRef, useState } from 'react';

/** Dauer der Monatswechsel-Animationen (Betrag und Kreisdiagramm laufen synchron), Ausklang ease-out */
export const ANIM_MS = 600;
/** Hochzählen von Beträgen: etwas schneller als das Diagramm, damit die Zahl schnell lesbar ist */
export const COUNT_MS = 380;

/** Animiert eine Zahlenliste weich zum neuen Stand (wie „Noch verfügbar“). Bei „Bewegung reduzieren“ sofort. */
export function useTweenList(target: number[], ms = ANIM_MS, initial?: number[]): number[] {
  const [v, setV] = useState(initial ?? target);
  const cur = useRef(initial ?? target);
  const key = target.join('|');
  useEffect(() => {
    const from = cur.current, to = target;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from.length !== to.length) { cur.current = to; setV(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3); // ease-out
      const next = to.map((x, i) => (from[i] ?? 0) + (x - (from[i] ?? 0)) * e);
      cur.current = next;
      setV(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return v;
}

/** Zählt eine Zahl beim Wechsel hoch (COUNT_MS). Bei „Bewegung reduzieren“ sofort. */
export function useCountUp(target: number): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = from.current;
    if (reduce || start === target) { from.current = target; setV(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / COUNT_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      setV(Math.round(start + (target - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target]);
  return v;
}
