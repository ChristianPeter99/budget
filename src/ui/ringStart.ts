/**
 * Einblenden des Übersicht-Rings beim Wischen: Die Animation startet schon beim Einrasten in der Vorschau
 * und läuft in der echten Übersicht nahtlos weiter – so früh wie beim Tipp auf den Reiter.
 */
let t0 = 0;
export function markRingStart(): void { t0 = performance.now(); }
/** Wie weit die Animation schon gelaufen ist (ms), sonst 0. */
export function ringElapsed(): number {
  const e = performance.now() - t0;
  return t0 > 0 && e < 700 ? e : 0;
}

/** Neue Wischgeste beginnt: alte Startzeit verwerfen, damit die Vorschau ihre Animation nicht schon „halb gelaufen“ übernimmt. */
export function clearRingStart(): void { t0 = 0; }
