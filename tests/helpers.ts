import { openBudgetDb } from '../src/data/schema';
import type { Db } from '../src/data/schema';

let n = 0;
/** Frische, isolierte Datenbank für jeden Test */
export async function freshDb(): Promise<Db> {
  return openBudgetDb(`test-db-${Date.now()}-${n++}`);
}
