import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { computeAll, DATASETS, makeDataset } from './reference/compute';

// Vergleich mit der festgehaltenen Rechen-Referenz von v1.78.5. Neu festhalten (nur bewusst!): CALC_REF_UPDATE=1 npx vitest run calc-reference
const FILE = 'tests/fixtures/calc-reference-v1.78.5.json';

describe('Rechen-Referenz v1.78.5 (40 Zufallsdatensätze, fester Startwert)', () => {
  if (process.env.CALC_REF_UPDATE === '1') {
    it('schreibt die Referenz neu', () => {
      const all = Array.from({ length: DATASETS }, (_, i) => computeAll(makeDataset(1000 + i)));
      writeFileSync(FILE, JSON.stringify(all));
    });
    return;
  }
  const ref = JSON.parse(readFileSync(FILE, 'utf8')) as unknown[];
  it('Referenz ist vollständig', () => expect(ref).toHaveLength(DATASETS));
  for (let i = 0; i < DATASETS; i++) {
    it(`Datensatz ${i + 1}: alle Rechnungen centgenau gleich`, () => {
      expect(JSON.parse(JSON.stringify(computeAll(makeDataset(1000 + i))))).toEqual(ref[i]);
    });
  }
});
