import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { exportAll, seedIfEmpty, setCategoryIcon } from '../src/db/repo';
import { validateBackupData } from '../src/domain/validate';
import { CAT_ICONS } from '../src/domain/catIcons';

describe('Kategorie-Symbole (v1.17)', () => {
  it('setzt ein Symbol, lehnt unbekannte ab und setzt zurück; Backup behält es', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, '2026-11');
    const cat = (await db.getAll('categories')).find((c) => c.parentId === null && c.kind === 'expense')!;
    await setCategoryIcon(db, cat.id, 'train');
    expect((await db.get('categories', cat.id))?.icon).toBe('train');
    await expect(setCategoryIcon(db, cat.id, '<script>')).rejects.toThrow('Unbekanntes Symbol');
    expect((await db.get('categories', cat.id))?.icon).toBe('train');
    const backup = await exportAll(db);
    const v = validateBackupData(JSON.parse(JSON.stringify(backup)));
    expect(v.ok && v.data.categories.find((c) => c.id === cat.id)?.icon).toBe('train');
    await setCategoryIcon(db, cat.id, null);
    expect((await db.get('categories', cat.id))?.icon).toBeUndefined();
  });
  it('ignoriert unbekannte Symbole beim Wiederherstellen', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, '2026-11');
    const backup = await exportAll(db);
    const data = JSON.parse(JSON.stringify(backup));
    data.categories[0].icon = 'gibtsnicht';
    const v = validateBackupData(data);
    expect(v.ok).toBe(true);
    expect(v.ok && v.data.categories[0]?.icon).toBeUndefined();
  });
  it('hat eindeutige Schlüssel', () => {
    expect(new Set(CAT_ICONS.map((i) => i.key)).size).toBe(CAT_ICONS.length);
  });
});
