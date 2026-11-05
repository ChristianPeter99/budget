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
