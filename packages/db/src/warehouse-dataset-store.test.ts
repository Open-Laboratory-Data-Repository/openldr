import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createWarehouseDatasetStore } from './warehouse-dataset-store';

async function world() {
  const db = await makeMigratedDb();
  return { db, store: createWarehouseDatasetStore(db as never) };
}

describe('warehouse dataset store (pack datasets, migration 131)', () => {
  it('saves_a_packs_datasets_in_order_and_lists_them_in_order', async () => {
    const { db, store } = await world();
    await store.replaceForPack('reports-zm', [{ name: 'zzz', sql: 'select 1' }, { name: 'aaa', sql: 'select 2', indexes: [['a'], ['b', 'c']] }]);
    const all = await store.list();
    expect(all.map((d) => d.name)).toEqual(['zzz', 'aaa']);
    expect(all[1]).toMatchObject({ ownerPack: 'reports-zm', sql: 'select 2', indexes: [['a'], ['b', 'c']], position: 1, builtAtSeq: null, builtAt: null, buildMs: null, rowCount: null, lastError: null });
    expect(all[0].indexes).toEqual([]);
    expect((await store.get('aaa'))?.sql).toBe('select 2');
    expect(await store.get('nope')).toBeUndefined();
    await db.destroy();
  });

  it('a_second_save_drops_what_the_pack_no_longer_lists_and_keeps_an_unchanged_ones_build', async () => {
    const { db, store } = await world();
    await store.replaceForPack('reports-zm', [{ name: 'keep', sql: 'select 1' }, { name: 'change', sql: 'select 2' }, { name: 'gone', sql: 'select 3' }]);
    for (const n of ['keep', 'change', 'gone']) await store.markBuilt(n, { seq: 40, ms: 1200, rows: 7 });
    // It names what the pack no longer lists, so the caller can drop those tables.
    expect(await store.replaceForPack('reports-zm', [{ name: 'change', sql: 'select 22' }, { name: 'keep', sql: 'select 1' }])).toEqual(['gone']);
    const all = await store.list();
    expect(all.map((d) => d.name)).toEqual(['change', 'keep']);
    expect(all[0]).toMatchObject({ sql: 'select 22', builtAtSeq: null, rowCount: null, buildMs: null, builtAt: null });
    expect(all[1]).toMatchObject({ builtAtSeq: 40, rowCount: 7, buildMs: 1200 });
    expect(all[1].builtAt).not.toBeNull();
    await db.destroy();
  });

  it('a_change_of_indexes_alone_clears_the_build', async () => {
    const { db, store } = await world();
    await store.replaceForPack('p', [{ name: 'abc', sql: 'select 1', indexes: [['a']] }]);
    await store.markBuilt('abc', { seq: 4, ms: 10, rows: 1 });
    await store.replaceForPack('p', [{ name: 'abc', sql: 'select 1', indexes: [['b']] }]);
    expect((await store.get('abc'))?.builtAtSeq).toBeNull();
    await db.destroy();
  });

  it('refuses_a_name_another_pack_owns_and_writes_nothing', async () => {
    const { db, store } = await world();
    await store.replaceForPack('reports-zm', [{ name: 'abc', sql: 'select 1' }]);
    await expect(store.replaceForPack('other-pack', [{ name: 'mine', sql: 'select 9' }, { name: 'abc', sql: 'select 2' }])).rejects.toThrow('dataset abc belongs to reports-zm');
    expect((await store.list()).map((d) => `${d.ownerPack}:${d.name}:${d.sql}`)).toEqual(['reports-zm:abc:select 1']);
    await db.destroy();
  });

  it('a_failure_keeps_the_last_build_and_a_build_clears_the_error', async () => {
    const { db, store } = await world();
    await store.replaceForPack('p', [{ name: 'abc', sql: 'select 1' }]);
    await store.markBuilt('abc', { seq: 4, ms: 10, rows: 3 });
    await store.markFailed('abc', 'relation "x" does not exist', 7);
    expect(await store.get('abc')).toMatchObject({ builtAtSeq: 4, rowCount: 3, lastError: 'relation "x" does not exist', failedAtSeq: 7 });
    await store.markBuilt('abc', { seq: 9, ms: 11, rows: 4 });
    expect(await store.get('abc')).toMatchObject({ builtAtSeq: 9, rowCount: 4, lastError: null, failedAtSeq: null });
    await db.destroy();
  });

  it('removes_one', async () => {
    const { db, store } = await world();
    await store.replaceForPack('p', [{ name: 'abc', sql: 'select 1' }, { name: 'abd', sql: 'select 2' }]);
    await store.remove('abc');
    expect((await store.list()).map((d) => d.name)).toEqual(['abd']);
    await db.destroy();
  });
});
