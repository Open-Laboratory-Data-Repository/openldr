import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import type { InternalSchema } from './schema/internal';
import { createImportCheckHeldStore, type ImportCheckHeldStore } from './import-check-held-store';

// Layer: the store's SQL against pg-mem, on a database built by every internal migration.
// Not covered: real Postgres, and the order of ties. Every ORDER BY here ends in the primary key.
describe('import check held store', () => {
  let db: Kysely<InternalSchema>;
  let store: ImportCheckHeldStore;
  beforeEach(async () => {
    db = await makeMigratedDb();
    store = createImportCheckHeldStore(db);
  });

  const item = (key: string, over: Record<string, unknown> = {}) => ({
    copyId: 'c1', key, runId: 'r1', reason: 'held' as const, label: null, error: null,
    findings: [{ n: key }], check: { k: key }, ...over,
  });

  it('put twice on one key keeps one row with the later values', async () => {
    await store.put(item('A'));
    await store.put(item('A', { runId: 'r2', reason: 'error', label: 'L', error: 'E_BAD', findings: [], check: { z: 1 } }));
    const { rows, total } = await store.list('c1', { offset: 0, limit: 10 });
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ copyId: 'c1', key: 'A', runId: 'r2', reason: 'error', label: 'L', error: 'E_BAD' });
    expect(typeof rows[0]!.heldAt).toBe('string');
    const got = await store.get('c1', 'A');
    expect(got!.findings).toEqual([]);
    expect(got!.check).toEqual({ z: 1 });
  });

  it('lists by key with a total, and pages', async () => {
    for (const k of ['D', 'B', 'A', 'C', 'E']) await store.put(item(k));
    const p1 = await store.list('c1', { offset: 0, limit: 2 });
    expect(p1.total).toBe(5);
    expect(p1.rows.map((r) => r.key)).toEqual(['A', 'B']);
    const p2 = await store.list('c1', { offset: 2, limit: 2 });
    expect(p2.rows.map((r) => r.key)).toEqual(['C', 'D']);
    const p3 = await store.list('c1', { offset: 4, limit: 2 });
    expect(p3.rows.map((r) => r.key)).toEqual(['E']);
    const p4 = await store.list('c1', { offset: 6, limit: 2 });
    expect(p4.rows).toEqual([]);
    expect(p4.total).toBe(5);
  });

  it('filters by reason and by label, and the total follows the filter', async () => {
    await store.put(item('A', { label: 'x' }));
    await store.put(item('B', { reason: 'error', error: 'E_X', label: 'x' }));
    await store.put(item('C', { label: 'y' }));
    const held = await store.list('c1', { reason: 'held', offset: 0, limit: 10 });
    expect(held.rows.map((r) => r.key)).toEqual(['A', 'C']);
    expect(held.total).toBe(2);
    const x = await store.list('c1', { label: 'x', offset: 0, limit: 10 });
    expect(x.rows.map((r) => r.key)).toEqual(['A', 'B']);
    const both = await store.list('c1', { reason: 'error', label: 'x', offset: 0, limit: 10 });
    expect(both.rows.map((r) => r.key)).toEqual(['B']);
    expect(both.total).toBe(1);
  });

  it('get returns the JSON as stored, and null for a missing key', async () => {
    const findings = { a: [1, 2, { b: null }] };
    const check = [{ c: 'd' }, 3];
    await store.put(item('A', { findings, check }));
    const got = await store.get('c1', 'A');
    expect(got).toMatchObject({ copyId: 'c1', key: 'A', runId: 'r1', reason: 'held', label: null, error: null });
    expect(got!.findings).toEqual(findings);
    expect(got!.check).toEqual(check);
    expect(await store.get('c1', 'nope')).toBeNull();
  });

  it('listItems pages by key with the right total under each filter, and equals list plus get', async () => {
    await store.put(item('D', { label: 'x' }));
    await store.put(item('B', { reason: 'error', error: 'E_X', label: 'x', findings: null, check: null }));
    await store.put(item('A', { label: 'y', findings: { deep: [1, { two: 'A' }] } }));
    await store.put(item('C', { label: 'x' }));
    await store.put(item('E', { reason: 'error', error: 'E_Y', label: 'y' }));
    // Another copy's rows are never in the answer.
    await store.put(item('A', { copyId: 'c2', label: 'x' }));
    await store.put(item('Z', { copyId: 'c2', label: 'x' }));

    const filters = [{}, { reason: 'held' as const }, { reason: 'error' as const }, { label: 'x' }, { reason: 'held' as const, label: 'x' }, { label: 'none' }];
    for (const f of filters) {
      for (const [offset, limit] of [[0, 2], [2, 2], [4, 2], [0, 10], [9, 3]] as const) {
        const items = await store.listItems('c1', { ...f, offset, limit });
        const plain = await store.list('c1', { ...f, offset, limit });
        expect(items.total).toBe(plain.total);
        expect(items.rows.map((r) => r.key)).toEqual(plain.rows.map((r) => r.key));
        const joined = await Promise.all(plain.rows.map((r) => store.get('c1', r.key)));
        expect(items.rows).toEqual(joined);
      }
    }
    expect((await store.listItems('c1', { offset: 0, limit: 10 })).rows.map((r) => r.key)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect((await store.listItems('c1', { offset: 0, limit: 10 })).total).toBe(5);
    expect((await store.listItems('c1', { label: 'x', offset: 0, limit: 10 })).total).toBe(3);
    expect((await store.listItems('c1', { reason: 'held', label: 'x', offset: 1, limit: 10 })).rows.map((r) => r.key)).toEqual(['D']);
    const a = (await store.listItems('c1', { label: 'y', offset: 0, limit: 1 })).rows[0]!;
    expect(a).toMatchObject({ copyId: 'c1', key: 'A', findings: { deep: [1, { two: 'A' }] }, check: { k: 'A' } });
    expect((await store.listItems('c1', { reason: 'error', offset: 0, limit: 1 })).rows[0]).toMatchObject({ key: 'B', findings: null, check: null });
    expect((await store.listItems('c3', { offset: 0, limit: 10 }))).toEqual({ rows: [], total: 0 });
  });

  it('remove deletes the named keys and leaves the rest', async () => {
    for (const k of ['A', 'B', 'C']) await store.put(item(k));
    await store.remove('c1', ['A', 'C', 'missing']);
    const { rows } = await store.list('c1', { offset: 0, limit: 10 });
    expect(rows.map((r) => r.key)).toEqual(['B']);
    await store.remove('c1', []);
    expect((await store.list('c1', { offset: 0, limit: 10 })).total).toBe(1);
  });

  it('deleteSome deletes up to limit and answers 0 when none is left', async () => {
    for (const k of ['A', 'B', 'C', 'D', 'E']) await store.put(item(k));
    expect(await store.deleteSome('c1', 2)).toBe(2);
    expect((await store.list('c1', { offset: 0, limit: 10 })).total).toBe(3);
    expect(await store.deleteSome('c1', 10)).toBe(3);
    expect(await store.deleteSome('c1', 10)).toBe(0);
    await expect(store.deleteSome('c1', 0)).rejects.toThrow();
  });

  it('does not see rows of another copy', async () => {
    await store.put(item('A'));
    await store.put(item('A', { copyId: 'c2', runId: 'other' }));
    await store.put(item('B', { copyId: 'c2' }));
    expect((await store.list('c1', { offset: 0, limit: 10 })).total).toBe(1);
    expect((await store.get('c1', 'A'))!.runId).toBe('r1');
    expect(await store.get('c1', 'B')).toBeNull();
    await store.remove('c1', ['A', 'B']);
    expect((await store.list('c2', { offset: 0, limit: 10 })).total).toBe(2);
    expect(await store.deleteSome('c1', 10)).toBe(0);
    expect((await store.list('c2', { offset: 0, limit: 10 })).total).toBe(2);
  });
});
