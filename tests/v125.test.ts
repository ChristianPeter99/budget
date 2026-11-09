import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { addTransaction } from '../src/data/transactions';
import { deleteRecurring, runRecurring, saveRecurring } from '../src/data/recurring';
import { seedIfEmpty } from '../src/data/dataset';
import { demoData } from './demo';

describe('Wiederkehrend „Gilt ab“ (v1.25)', () => {
  it('bucht ab dem Startmonat nach, ordnet schon gebuchte Ausgaben zu und behält Buchungen beim Löschen', async () => {
    const db = await freshDb();
    await seedIfEmpty(db, demoData('2026-11'));
    const cats = await db.getAll('categories');
    const wohnen = cats.find((c) => c.name === 'Wohnen' && c.parentId === null)!;
    const leaf = cats.find((c) => c.parentId === wohnen.id) ?? wohnen;
    // Im Juni wurde die Miete schon per Import gebucht
    await addTransaction(db, { date: '2026-06-03', type: 'expense', amountCents: 99900, categoryId: leaf.id, description: 'Miete Bank' });
    const r = await saveRecurring(db, null, { name: 'Testmiete', type: 'expense', amountCents: 99900, categoryId: leaf.id, startMonth: '2026-05', day: 1, active: true }, '2026-11');
    await runRecurring(db, '2026-11');
    let txs = (await db.getAll('transactions')).filter((t) => t.amountCents === 99900);
    // Mai–November = 7 Monate, Juni nicht doppelt
    expect(txs).toHaveLength(7);
    expect(txs.filter((t) => t.date.startsWith('2026-06'))).toHaveLength(1);
    expect(txs.find((t) => t.date.startsWith('2026-06'))!.description).toBe('Miete Bank');
    expect(txs.every((t) => t.recurringId === r.id)).toBe(true);
    // erneuter Lauf: nichts Neues
    expect(await runRecurring(db, '2026-11')).toBe(0);
    // Löschen: bisherige Buchungen bleiben, im nächsten Monat kommt nichts mehr dazu
    await deleteRecurring(db, r.id);
    await runRecurring(db, '2026-12');
    txs = (await db.getAll('transactions')).filter((t) => t.amountCents === 99900);
    expect(txs).toHaveLength(7);
    expect(txs.some((t) => t.date.startsWith('2026-12'))).toBe(false);
  });
});

