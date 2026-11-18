import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import type { InternalSchema } from './schema/internal';
import { createImportCheckCorrectionStore, type ImportCheckCorrectionStore } from './import-check-correction-store';

// Layer: the store's SQL against pg-mem, on a database built by every internal migration
// (design 2026-11-18-held-corrections). Not covered: real Postgres.
describe('import check correction store', () => {
  let db: Kysely<InternalSchema>;
  let store: ImportCheckCorrectionStore;
  beforeEach(async () => {
    db = await makeMigratedDb();
    store = createImportCheckCorrectionStore(db);
  });

  const at = new Date('2026-11-18T09:00:00.000Z');
  const row = (key: string, field: string, value: string | null, over: Record<string, unknown> = {}) => ({
    copyId: 'c1', key, field, value, original: '2024-03-11', reason: 'typed wrong', correctedBy: 'admin', correctedAt: at, ...over,
  });

  it('a second correction of one field replaces the first', async () => {
    await store.put(row('A', 'dob_age', '2023-03-11'));
    await store.put(row('A', 'dob_age', '2023-03-10', { reason: 'second look' }));
    const got = (await store.listFor('c1', ['A'])).get('A');
    expect(got).toEqual([{ copyId: 'c1', key: 'A', field: 'dob_age', value: '2023-03-10', original: '2024-03-11', reason: 'second look', correctedBy: 'admin', correctedAt: at.toISOString() }]);
  });

  it('lists by key, each key ordered by field, and only the keys asked for', async () => {
    await store.put(row('A', 'sex', 'F'));
    await store.put(row('A', 'dob_age', '2023-03-11'));
    await store.put(row('B', 'collected', '2023-03-12 09:40'));
    await store.put(row('C', 'sex', 'M'));
    await store.put(row('A', 'sex', 'M', { copyId: 'c2' }));
    const got = await store.listFor('c1', ['A', 'B']);
    expect([...got.keys()].sort()).toEqual(['A', 'B']);
    expect(got.get('A')!.map((c) => c.field)).toEqual(['dob_age', 'sex']);
    expect((await store.listFor('c1', [])).size).toBe(0);
  });

  it('removes the corrections of chosen keys, and deletes a copy in batches', async () => {
    for (const k of ['A', 'B', 'C']) await store.put(row(k, 'sex', 'F'));
    await store.remove('c1', ['A']);
    expect([...(await store.listFor('c1', ['A', 'B', 'C'])).keys()].sort()).toEqual(['B', 'C']);
    expect(await store.deleteSome('c1', 1)).toBe(1);
    expect(await store.deleteSome('c1', 5)).toBe(1);
    expect(await store.deleteSome('c1', 5)).toBe(0);
  });
});
