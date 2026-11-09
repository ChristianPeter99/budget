// Kleine Zusatzwerte (z. B. letzter Import, letztes Backup).
import type { Db } from './schema';

export async function getMeta<T = unknown>(db: Db, key: string): Promise<T | undefined> {
  return (await db.get('meta', key))?.value as T | undefined;
}
export async function setMeta(db: Db, key: string, value: unknown): Promise<void> {
  await db.put('meta', { key, value });
}
