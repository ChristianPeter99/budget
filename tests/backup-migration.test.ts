import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { freshDb } from './helpers';
import { addTransaction, exportAll, getPreImportSnapshot, replaceAll, restorePreImportSnapshot, seedIfEmpty } from '../src/db/repo';
import { DB_VERSION, openBudgetDb, upgradeSchema } from '../src/db/db';
import type { BudgetDB } from '../src/db/db';
import { createEncryptedBackup, openEncryptedBackup, restoreBackup } from '../src/backup/backup';
import { BackupError, decryptEnvelope, encryptText, parseEnvelope } from '../src/backup/crypto';

const FAST = 100_000; // Mindest-Iterationen, damit die Tests schnell laufen (Standard der App: 600.000)
const PW = 'correct horse battery';

async function filled() {
  const db = await freshDb();
  await seedIfEmpty(db, '2026-10');
  const cats = (await exportAll(db)).categories;
  await addTransaction(db, { date: '2026-10-03', type: 'expense', amountCents: 4321, categoryId: cats.find((c) => c.name === 'Kino')!.id, description: 'Süße Grüße €' });
  return db;
}

describe('Verschlüsseltes Backup', () => {
  it('exportiert und importiert mit richtigem Passwort verlustfrei', async () => {
    const db = await filled();
    const original = await exportAll(db);
    const file = await createEncryptedBackup(db, PW, FAST);
    // Die Datei enthält keinen Klartext
    expect(file.text).not.toContain('Kino');
    expect(file.text).not.toContain('Süße');
    expect(file.text).not.toContain('amountCents');
    const env = parseEnvelope(file.text);
    expect(env).toMatchObject({ format: 'budget-backup', formatVersion: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: FAST }, cipher: { name: 'AES-GCM', keyLength: 256 } });

    const other = await freshDb();
    const opened = await openEncryptedBackup(file.text, PW);
    expect(opened.summary).toMatchObject({ transactions: 1, firstDate: '2026-10-03', lastDate: '2026-10-03' });
    await restoreBackup(other, opened);
    expect(await exportAll(other)).toEqual(original);
  });

  it('verwendet pro Export neuen Salt und IV', async () => {
    const a = parseEnvelope(JSON.stringify(await encryptText('x', PW, FAST)));
    const b = parseEnvelope(JSON.stringify(await encryptText('x', PW, FAST)));
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('weist ein falsches Passwort zurück und lässt vorhandene Daten unverändert', async () => {
    const src = await filled();
    const file = await createEncryptedBackup(src, PW, FAST);
    const target = await freshDb();
    await seedIfEmpty(target, '2026-10');
    const before = await exportAll(target);
    await expect(openEncryptedBackup(file.text, 'falsches passwort!')).rejects.toMatchObject({ code: 'password' });
    expect(await exportAll(target)).toEqual(before);
  });

  it('weist beschädigte und veränderte Dateien zurück', async () => {
    const src = await filled();
    const file = await createEncryptedBackup(src, PW, FAST);
    const env = JSON.parse(file.text);
    // Ein Bit im Chiffretext geändert
    const flipped = { ...env, ciphertext: (env.ciphertext[0] === 'A' ? 'B' : 'A') + env.ciphertext.slice(1) };
    await expect(openEncryptedBackup(JSON.stringify(flipped), PW)).rejects.toMatchObject({ code: 'password' });
    // Kopfdaten verändert (z. B. Iterationen herabgesetzt): durch AAD geschützt
    const weakened = { ...env, kdf: { ...env.kdf, iterations: FAST + 1 } };
    await expect(openEncryptedBackup(JSON.stringify(weakened), PW)).rejects.toBeInstanceOf(BackupError);
    // Abgeschnitten, kein JSON, falsches Format, neuere Version
    await expect(openEncryptedBackup(file.text.slice(0, 80), PW)).rejects.toMatchObject({ code: 'format' });
    await expect(openEncryptedBackup('kein json', PW)).rejects.toMatchObject({ code: 'format' });
    await expect(openEncryptedBackup('{"a":1}', PW)).rejects.toMatchObject({ code: 'format' });
    await expect(openEncryptedBackup(JSON.stringify({ ...env, formatVersion: 99 }), PW)).rejects.toMatchObject({ code: 'version' });
    await expect(openEncryptedBackup(JSON.stringify({ ...env, kdf: { ...env.kdf, iterations: 5 } }), PW)).rejects.toMatchObject({ code: 'format' });
    await expect(openEncryptedBackup(JSON.stringify({ ...env, ciphertext: '###' }), PW)).rejects.toBeInstanceOf(BackupError);
  });

  it('verlangt ein ausreichend langes Passwort', async () => {
    await expect(encryptText('x', 'kurz', FAST)).rejects.toMatchObject({ code: 'password' });
  });

  it('weist entschlüsselte, aber inhaltlich fehlerhafte Daten zurück (Referenzen, Beträge, IDs)', async () => {
    const db = await filled();
    const data = await exportAll(db);
    const bad = async (mutate: (d: ReturnType<typeof structuredClone<typeof data>>) => void) => {
      const d = structuredClone(data);
      mutate(d);
      const env = await encryptText(JSON.stringify({ app: 'budget-pwa', schemaVersion: DB_VERSION, exportedAt: new Date().toISOString(), data: d }), PW, FAST);
      return openEncryptedBackup(JSON.stringify(env), PW);
    };
    await expect(bad((d) => { d.transactions[0]!.categoryId = 'fehlt'; })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad((d) => { d.transactions[0]!.amountCents = 12.5; })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad((d) => { d.transactions[0]!.amountCents = -1; })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad((d) => { d.transactions[0]!.date = '2026-02-30'; })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad((d) => { d.categories[1]!.id = d.categories[0]!.id; })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad((d) => { d.recurring[0]!.categoryId = 'fehlt'; })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad((d) => { d.budgets.push({ id: 'x', scope: 'category', monthKey: 'default', categoryId: 'fehlt', amountCents: 1 }); })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad((d) => { d.depotEntries.push({ id: 'd', date: '2026-13-01', valueCents: 1, createdAt: 'x' }); })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad((d) => { d.recurring[0]!.interval = 'yearly'; })).rejects.toMatchObject({ code: 'invalid' }); // Jahresbetrag fehlt
    await expect(bad((d) => { d.settings.split.fix = 90; })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad((d) => { (d as unknown as Record<string, unknown>).categories = 'nope'; })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('erhält bestehende Daten, wenn der Import mitten im Schreiben fehlschlägt', async () => {
    const db = await filled();
    const before = await exportAll(db);
    const other = await freshDb();
    await seedIfEmpty(other, '2026-10');
    const good = await exportAll(other);
    // Ein Datensatz, der beim Schreiben einen Fehler auslöst: strukturell gültig, aber doppelter Schlüssel in einem Store
    // wird per Validierung abgefangen; zusätzlich simulieren wir einen Fehler in der Transaktion selbst.
    const poisoned = structuredClone(good);
    Object.defineProperty(poisoned.transactions, 'length', { value: 1 });
    (poisoned.transactions as unknown[])[0] = { get id(): string { throw new Error('Schreibfehler'); } };
    await expect(replaceAll(db, poisoned)).rejects.toBeDefined();
    expect(await exportAll(db)).toEqual(before); // nichts teilweise überschrieben
    // Ungültige Daten werden schon vor dem Schreiben abgelehnt
    const invalid = structuredClone(good);
    invalid.settings.savingsBalanceCents = -5;
    await expect(replaceAll(db, invalid)).rejects.toBeDefined();
    expect(await exportAll(db)).toEqual(before);
  });

  it('legt vor dem Ersetzen eine Sicherung an und kann sie wiederherstellen', async () => {
    const db = await filled();
    const before = await exportAll(db);
    const other = await freshDb();
    await seedIfEmpty(other, '2026-11');
    const file = await createEncryptedBackup(other, PW, FAST);
    await restoreBackup(db, await openEncryptedBackup(file.text, PW));
    expect((await exportAll(db)).transactions).toHaveLength(0);
    const snap = await getPreImportSnapshot(db);
    expect(snap?.data.transactions).toHaveLength(1);
    await restorePreImportSnapshot(db);
    expect(await exportAll(db)).toEqual(before);
  });

  it('doppeltes Einspielen desselben Backups führt zum selben Stand (kein Duplikat)', async () => {
    const src = await filled();
    const file = await createEncryptedBackup(src, PW, FAST);
    const target = await freshDb();
    await restoreBackup(target, await openEncryptedBackup(file.text, PW));
    await restoreBackup(target, await openEncryptedBackup(file.text, PW));
    expect((await exportAll(target)).transactions).toHaveLength(1);
  });

  it('entschlüsselt den Chiffretext nur mit passendem Kopf', async () => {
    const env = await encryptText('geheim', PW, FAST);
    expect(await decryptEnvelope(env, PW)).toBe('geheim');
    await expect(decryptEnvelope({ ...env, createdAt: '1999-01-01T00:00:00.000Z' }, PW)).rejects.toMatchObject({ code: 'password' });
  });
});

describe('Datenbank-Migration', () => {
  it('migriert eine Datenbank von Schema 1 auf 2 ohne Datenverlust', async () => {
    const name = `migrate-${Date.now()}`;
    // 1) Alte Datenbank (Schema 1) anlegen und befüllen, wie sie ein früheres App-Update hinterlassen hätte
    const old = await openDB<BudgetDB>(name, 1, { upgrade(db, o, _n, tx) { upgradeSchema(db, o, 1, tx); } });
    expect([...old.objectStoreNames]).not.toContain('recurring');
    const cat = { id: 'c1', name: 'Lebensmittel', kind: 'expense' as const, group: 'alltag' as const, parentId: null, archived: false, sort: 0, createdAt: '2026-01-01T00:00:00.000Z' };
    await old.put('categories', cat);
    await old.put('transactions', { id: 't1', date: '2026-01-15', type: 'expense', amountCents: 999, categoryId: 'c1', description: 'alt', createdAt: '2026-01-15T10:00:00.000Z' });
    await old.put('settings', { key: 'app', value: { expectedIncomeCents: 100000, depotCents: 5, split: { fix: 40, alltag: 40, spar: 15 } } as never });
    old.close();
    // 2) Mit der aktuellen App-Version öffnen → Migration läuft
    const db = await openBudgetDb(name);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining(['recurring', 'recurringRuns', 'meta']));
    const data = await exportAll(db);
    expect(data.categories).toEqual([cat]);
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]).toMatchObject({ id: 't1', amountCents: 999, description: 'alt' });
    expect(data.settings.expectedIncomeCents).toBe(100000);
    expect(data.recurring).toEqual([]);
    expect((await db.get('meta', 'schemaVersion'))?.value).toBe(DB_VERSION);
    // Neue Funktionen nutzbar, alte Daten bleiben
    expect(await seedIfEmpty(db, '2026-10')).toBe(false); // nicht leer → keine Startdaten über bestehende Daten legen
    expect((await exportAll(db)).transactions).toHaveLength(1);
  });
});
