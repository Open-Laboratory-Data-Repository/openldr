import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb, makeMigratedDbWithMem } from './migrations/internal/test-helpers';
import type { InternalSchema } from './schema/internal';
import { createImportCopyStore, type CopyRow, type ImportCopyStore } from './import-copy-store';

// Layer: the store's SQL against pg-mem, on a database built by every internal migration.
// Not covered: real Postgres. pg-mem has a stable scan order and byte-order text sorting, so it
// cannot show ORDER BY ties or collation differences. The orders here use the full primary key,
// so no tie is possible, but collation on a real server is unproven by this file. pg-mem also does
// not roll back on a thrown error, so this file cannot show that a failed write keeps the old rows.
// It cannot show which index Postgres uses either.
describe('import copy store', () => {
  let db: Kysely<InternalSchema>;
  let store: ImportCopyStore;
  beforeEach(async () => {
    db = await makeMigratedDb();
    store = createImportCopyStore(db);
  });

  const page: CopyRow[] = [
    { detail: 'results', key: 'A', seq: 1, row: { v: 2 } },
    { detail: 'results', key: 'A', seq: 0, row: { v: 1 } },
    { detail: 'requests', key: 'B', seq: 0, row: { v: 3 } },
  ];

  async function countAll(): Promise<number> {
    const r = await db.selectFrom('import_copy_rows').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  it('stores a page and reads it back in order', async () => {
    await store.replaceKeys('c1', 'requests', ['A', 'B'], page);
    const got = await store.read('c1', 'requests', ['A', 'B']);
    expect(got.map((r) => [r.detail, r.key, r.seq])).toEqual(
      [['requests', 'B', 0], ['results', 'A', 0], ['results', 'A', 1]]);
    expect(got.map((r) => r.row)).toEqual([{ v: 3 }, { v: 1 }, { v: 2 }]);
  });

  it('writing a page twice leaves one copy of it', async () => {
    await store.replaceKeys('c1', 'requests', ['A', 'B'], page);
    await store.replaceKeys('c1', 'requests', ['A', 'B'], page);
    const got = await store.read('c1', 'requests', ['A', 'B']);
    expect(got).toHaveLength(3);
    expect(await countAll()).toBe(3);
  });

  it('a second write drops rows the source no longer has', async () => {
    await store.replaceKeys('c1', 'requests', ['A'], [
      { detail: 'results', key: 'A', seq: 0, row: { v: 1 } },
      { detail: 'results', key: 'A', seq: 1, row: { v: 2 } },
    ]);
    await store.replaceKeys('c1', 'requests', ['A'], [
      { detail: 'results', key: 'A', seq: 0, row: { v: 9 } },
    ]);
    const got = await store.read('c1', 'requests', ['A']);
    expect(got).toEqual([{ detail: 'results', key: 'A', seq: 0, row: { v: 9 } }]);
  });

  it('a key with no rows clears what was stored for it', async () => {
    await store.replaceKeys('c1', 'requests', ['A', 'B'], page);
    await store.replaceKeys('c1', 'requests', ['A'], []);
    expect(await store.read('c1', 'requests', ['A'])).toEqual([]);
    // B was not named, so its row stays.
    expect((await store.read('c1', 'requests', ['B'])).map((r) => r.key)).toEqual(['B']);
  });

  it('keeps copies and sets apart', async () => {
    const one: CopyRow[] = [{ detail: 'd', key: 'A', seq: 0, row: { who: 'c1-s1' } }];
    await store.replaceKeys('c1', 's1', ['A'], one);
    await store.replaceKeys('c2', 's1', ['A'], [{ detail: 'd', key: 'A', seq: 0, row: { who: 'c2-s1' } }]);
    await store.replaceKeys('c1', 's2', ['A'], [{ detail: 'd', key: 'A', seq: 0, row: { who: 'c1-s2' } }]);

    expect((await store.read('c1', 's1', ['A'])).map((r) => r.row)).toEqual([{ who: 'c1-s1' }]);
    expect((await store.read('c2', 's1', ['A'])).map((r) => r.row)).toEqual([{ who: 'c2-s1' }]);
    expect((await store.read('c1', 's2', ['A'])).map((r) => r.row)).toEqual([{ who: 'c1-s2' }]);

    // Replacing A in c1/s1 leaves the same key in the other copy and the other set alone.
    await store.replaceKeys('c1', 's1', ['A'], []);
    expect(await store.read('c1', 's1', ['A'])).toEqual([]);
    expect(await store.read('c2', 's1', ['A'])).toHaveLength(1);
    expect(await store.read('c1', 's2', ['A'])).toHaveLength(1);
  });

  it('reads nothing for an empty key list', async () => {
    await store.replaceKeys('c1', 'requests', ['A', 'B'], page);
    expect(await store.read('c1', 'requests', [])).toEqual([]);
  });

  it('writes more than one insert chunk in one call', async () => {
    const rows: CopyRow[] = Array.from({ length: 2500 }, (_, i) => ({ detail: 'd', key: 'K', seq: i, row: { i } }));
    await store.replaceKeys('c1', 's', ['K'], rows);
    const got = await store.read('c1', 's', ['K']);
    expect(got).toHaveLength(2500);
    expect(got[0]!.seq).toBe(0);
    expect(got[2499]!.seq).toBe(2499);
  });

  it('refuses a row whose key is not in the key list, and stores nothing', async () => {
    await expect(store.replaceKeys('c1', 's', ['A'], [
      { detail: 'd', key: 'A', seq: 0, row: {} },
      { detail: 'd', key: 'Z', seq: 0, row: {} },
    ])).rejects.toThrow('not in keys');
    expect(await countAll()).toBe(0);
  });

  // pg-mem does not roll back on a thrown error (see terminology-admin-store.test.ts), so this
  // cannot show that a failed insert keeps the old rows. It shows the part pg-mem can see: the
  // delete and every insert chunk go between one begin and one commit.
  it('sends the delete and every insert chunk inside one transaction', async () => {
    const { db: memDb, mem } = await makeMigratedDbWithMem();
    const sent: string[] = [];
    mem.public.interceptQueries((text) => {
      const word = text.trim().split(/\s+/)[0]!.toLowerCase();
      if (['begin', 'commit', 'rollback', 'delete', 'insert'].includes(word)) sent.push(word);
      return null;
    });
    const rows: CopyRow[] = Array.from({ length: 1500 }, (_, i) => ({ detail: 'd', key: 'K', seq: i, row: {} }));
    await createImportCopyStore(memDb).replaceKeys('c1', 's', ['K'], rows);
    expect(sent).toEqual(['begin', 'delete', 'insert', 'insert', 'commit']);
  });

  it('deleteSome removes at most the limit and reports 0 when the copy is gone', async () => {
    await store.replaceKeys('c1', 's1', ['A', 'B'], [
      { detail: 'd', key: 'A', seq: 0, row: {} },
      { detail: 'd', key: 'A', seq: 1, row: {} },
      { detail: 'd', key: 'B', seq: 0, row: {} },
    ]);
    await store.replaceKeys('c1', 's2', ['A', 'C'], [
      { detail: 'd', key: 'A', seq: 0, row: {} },
      { detail: 'd', key: 'C', seq: 0, row: {} },
    ]);
    await store.replaceKeys('c2', 's1', ['A'], [{ detail: 'd', key: 'A', seq: 0, row: { keep: true } }]);

    expect(await store.deleteSome('c1', 2)).toBe(2);
    expect(await store.deleteSome('c1', 2)).toBe(2);
    expect(await store.deleteSome('c1', 2)).toBe(1);
    expect(await store.deleteSome('c1', 2)).toBe(0);

    expect(await store.read('c1', 's1', ['A', 'B'])).toEqual([]);
    expect(await store.read('c1', 's2', ['A', 'C'])).toEqual([]);
    expect(await store.read('c2', 's1', ['A'])).toEqual([{ detail: 'd', key: 'A', seq: 0, row: { keep: true } }]);
  });

  it('deleteSome refuses a limit below 1, so 0 always means the copy is gone', async () => {
    await store.replaceKeys('c1', 's', ['A'], [{ detail: 'd', key: 'A', seq: 0, row: {} }]);
    await expect(store.deleteSome('c1', 0)).rejects.toThrow('limit');
    await expect(store.deleteSome('c1', 1.5)).rejects.toThrow('limit');
    expect(await store.read('c1', 's', ['A'])).toHaveLength(1);
  });

  it('deleteSome picks rows in key order: key before detail', async () => {
    // Key order is (copy, set, key, detail, seq). Key A sorts first even though its detail sorts last.
    await store.replaceKeys('c1', 's', ['A', 'B'], [
      { detail: 'z', key: 'A', seq: 0, row: {} },
      { detail: 'a', key: 'B', seq: 0, row: {} },
    ]);
    expect(await store.deleteSome('c1', 1)).toBe(1);
    expect(await store.read('c1', 's', ['A'])).toEqual([]);
    expect((await store.read('c1', 's', ['B'])).map((r) => r.detail)).toEqual(['a']);
  });

  it('deleteSome with a set name removes only that set', async () => {
    await store.replaceKeys('c1', 's1', ['A', 'B'], [
      { detail: 'd', key: 'A', seq: 0, row: {} },
      { detail: 'd', key: 'B', seq: 0, row: {} },
    ]);
    await store.replaceKeys('c1', 's2', ['A'], [{ detail: 'd', key: 'A', seq: 0, row: { keep: true } }]);

    expect(await store.deleteSome('c1', 10, 's1')).toBe(2);
    expect(await store.deleteSome('c1', 10, 's1')).toBe(0);
    expect(await store.read('c1', 's1', ['A', 'B'])).toEqual([]);
    expect(await store.read('c1', 's2', ['A'])).toEqual([{ detail: 'd', key: 'A', seq: 0, row: { keep: true } }]);
  });
});
