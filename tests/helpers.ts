import { openBudgetDb } from '../src/db/db';
import type { Db } from '../src/db/db';

let n = 0;
/** Frische, isolierte Datenbank für jeden Test */
export async function freshDb(): Promise<Db> {
  return openBudgetDb(`test-db-${Date.now()}-${n++}`);
}
