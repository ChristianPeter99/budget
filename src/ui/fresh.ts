/**
 * Merkt sich kurz, welche Buchung gerade neu gespeichert wurde, damit ihre Zeile beim ersten Erscheinen
 * hineingleitet und kurz leuchtet. Nur im Arbeitsspeicher, nichts wird gespeichert.
 */
const fresh = new Map<string, number>();
const LIFE_MS = 2500;

export function markFresh(id: string): void {
  fresh.set(id, Date.now());
  window.setTimeout(() => { fresh.delete(id); }, LIFE_MS);
}

export function isFresh(id: string): boolean {
  const t = fresh.get(id);
  return t !== undefined && Date.now() - t < LIFE_MS;
}

/**
 * Löschen: die Zeilen klappen weich zusammen, bevor die Buchung wirklich verschwindet.
 * Gibt eine Funktion zurück, die die Zeilen wiederherstellt (falls das Löschen scheitert).
 */
export async function collapseRows(ids: string[]): Promise<() => void> {
  const els = ids.flatMap((id) => [...document.querySelectorAll<HTMLElement>(`.swipe[data-txid="${CSS.escape(id)}"]`)]);
  if (els.length === 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const anims = els.map((el) => el.animate(
    [{ height: `${el.offsetHeight}px`, opacity: 1, transform: 'none' }, { height: '0px', opacity: 0, transform: 'translateX(-24px)' }],
    { duration: 240, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }));
  els.forEach((el) => { el.style.overflow = 'hidden'; });
  await Promise.all(anims.map((a) => a.finished.catch(() => undefined)));
  return () => { anims.forEach((a) => a.cancel()); els.forEach((el) => { el.style.overflow = ''; }); };
}

/** Rückgängig: wiederhergestellte Buchungen gleiten wieder hinein (wie neu gespeicherte). */
export function markRestored(ids: string[]): void { ids.forEach(markFresh); }
