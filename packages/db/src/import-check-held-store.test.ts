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
    copyId: 'c1', key, runId: 'r1', reason: 'held' as const, label: null, laboratory: null, error: null,
    findings: [{ n: key }], check: { k: key }, ...over,
  });

  it('put twice on one key keeps one row with the later values', async () => {
    await store.put(item('A'));
    await store.put(item('A', { runId: 'r2', reason: 'error', label: 'L', laboratory: 'LAB', error: 'E_BAD', findings: [], check: { z: 1 } }));
    const { rows, total } = await store.list('c1', { offset: 0, limit: 10 });
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ copyId: 'c1', key: 'A', runId: 'r2', reason: 'error', label: 'L', laboratory: 'LAB', error: 'E_BAD' });
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

  it('filters by laboratory, alone and with reason and label, and the total follows the filter', async () => {
    await store.put(item('A', { laboratory: 'L1', label: 'x' }));
    await store.put(item('B', { laboratory: 'L1', reason: 'error', error: 'E_X', label: 'y' }));
    await store.put(item('C', { laboratory: 'L2', label: 'x' }));
    await store.put(item('D', { label: 'x' }));
    await store.put(item('E', { laboratory: 'L1', label: 'x' }));
    // Another copy's row of the same laboratory is never counted.
    await store.put(item('F', { copyId: 'c2', laboratory: 'L1', label: 'x' }));
    const keys = async (f: Record<string, unknown>) => {
      const r = await store.list('c1', { ...f, offset: 0, limit: 10 });
      const i = await store.listItems('c1', { ...f, offset: 0, limit: 10 });
      expect(i.rows.map((row) => row.key)).toEqual(r.rows.map((row) => row.key));
      expect(i.total).toBe(r.total);
      return [r.rows.map((row) => row.key), r.total];
    };
    expect(await keys({ laboratory: 'L1' })).toEqual([['A', 'B', 'E'], 3]);
    expect(await keys({ laboratory: 'L2' })).toEqual([['C'], 1]);
    expect(await keys({ laboratory: 'L9' })).toEqual([[], 0]);
    expect(await keys({ laboratory: 'L1', reason: 'held' })).toEqual([['A', 'E'], 2]);
    expect(await keys({ laboratory: 'L1', label: 'x' })).toEqual([['A', 'E'], 2]);
    expect(await keys({ laboratory: 'L1', reason: 'error', label: 'y' })).toEqual([['B'], 1]);
    expect(await keys({ laboratory: 'L1', reason: 'error', label: 'x' })).toEqual([[], 0]);
    // Paged: the total is every match, not the page.
    const page = await store.list('c1', { laboratory: 'L1', offset: 1, limit: 1 });
    expect([page.rows.map((r) => r.key), page.total]).toEqual([['B'], 3]);
    // Each row carries its laboratory, null when it named none.
    const all = await store.list('c1', { offset: 0, limit: 10 });
    expect(all.rows.map((r) => [r.key, r.laboratory])).toEqual([['A', 'L1'], ['B', 'L1'], ['C', 'L2'], ['D', null], ['E', 'L1']]);
    expect((await store.get('c1', 'C'))!.laboratory).toBe('L2');
    // A put again replaces the laboratory, to null too.
    await store.put(item('A', { laboratory: null, label: 'x' }));
    expect(await keys({ laboratory: 'L1' })).toEqual([['B', 'E'], 2]);
  });

  it('get returns the JSON as stored, and null for a missing key', async () => {
    const findings = { a: [1, 2, { b: null }] };
    const check = [{ c: 'd' }, 3];
    await store.put(item('A', { findings, check }));
    const got = await store.get('c1', 'A');
    expect(got).toMatchObject({ copyId: 'c1', key: 'A', runId: 'r1', reason: 'held', label: null, laboratory: null, error: null });
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

  it('listItems by after reads in key order past the key, with next the last key or null on the last page', async () => {
    for (const k of ['D', 'B', 'A', 'C', 'E']) await store.put(item(k));
    await store.put(item('B', { copyId: 'c2' }));
    const p1 = await store.listItems('c1', { after: null, limit: 2 });
    expect(p1.rows.map((r) => r.key)).toEqual(['A', 'B']);
    expect(p1).toMatchObject({ total: 5, next: 'B' });
    const p2 = await store.listItems('c1', { after: 'B', limit: 2 });
    expect(p2.rows.map((r) => r.key)).toEqual(['C', 'D']);
    expect(p2.next).toBe('D');
    // The last page: next is null, even when the page is not full.
    const p3 = await store.listItems('c1', { after: 'D', limit: 2 });
    expect(p3.rows.map((r) => r.key)).toEqual(['E']);
    expect(p3).toMatchObject({ total: 5, next: null });
    // A page that ends exactly on the last row is the last page too.
    expect((await store.listItems('c1', { after: 'C', limit: 2 })).next).toBeNull();
    expect(await store.listItems('c1', { after: 'E', limit: 2 })).toEqual({ rows: [], total: 5, next: null });
    // Offset is ignored when after is given.
    expect((await store.listItems('c1', { after: 'B', offset: 3, limit: 2 })).rows.map((r) => r.key)).toEqual(['C', 'D']);
    // The rows are whole, as listItems by offset gives them.
    expect(p2.rows).toEqual((await store.listItems('c1', { offset: 2, limit: 2 })).rows);
  });

  it('listItems by after takes each filter, and the total follows the filter', async () => {
    await store.put(item('A', { label: 'x', laboratory: 'L1' }));
    await store.put(item('B', { reason: 'error', error: 'E_X', label: 'x', laboratory: 'L2' }));
    await store.put(item('C', { label: 'y', laboratory: 'L1' }));
    await store.put(item('D', { label: 'x', laboratory: 'L1' }));
    await store.put(item('E', { reason: 'error', error: 'E_Y', label: 'y', laboratory: 'L2' }));
    const filters = [
      {}, { reason: 'held' as const }, { reason: 'error' as const }, { label: 'x' }, { laboratory: 'L1' },
      { reason: 'held' as const, label: 'x', laboratory: 'L1' }, { label: 'none' },
    ];
    for (const f of filters) {
      const whole = await store.listItems('c1', { ...f, offset: 0, limit: 100 });
      const read: string[] = [];
      let after: string | null = null;
      for (let calls = 0; calls < 10; calls++) {
        const page = await store.listItems('c1', { ...f, after, limit: 1 });
        expect(page.total).toBe(whole.total);
        read.push(...page.rows.map((r) => r.key));
        if (page.next === null || page.next === undefined) break;
        after = page.next;
      }
      expect(read).toEqual(whole.rows.map((r) => r.key));
    }
  });

  it('listItems by after neither repeats nor skips a kept row when rows are removed and added between pages', async () => {
    for (const k of ['A', 'B', 'C', 'D', 'E', 'F']) await store.put(item(k));
    const p1 = await store.listItems('c1', { after: null, limit: 2 });
    expect(p1.rows.map((r) => r.key)).toEqual(['A', 'B']);
    // A row already read leaves, and a row before the read point arrives. By offset the next page
    // would start one row late after the remove, then one early after the add.
    await store.remove('c1', ['A']);
    await store.put(item('A0'));
    const p2 = await store.listItems('c1', { after: p1.next!, limit: 2 });
    expect(p2.rows.map((r) => r.key)).toEqual(['C', 'D']);
    await store.remove('c1', ['C']);
    await store.put(item('BB'));
    const p3 = await store.listItems('c1', { after: p2.next!, limit: 2 });
    expect(p3.rows.map((r) => r.key)).toEqual(['E', 'F']);
    expect(p3.next).toBeNull();
    const keys = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('listItems by offset is as before: no next in the answer', async () => {
    for (const k of ['A', 'B', 'C']) await store.put(item(k));
    const page = await store.listItems('c1', { offset: 1, limit: 1 });
    expect(Object.keys(page).sort()).toEqual(['rows', 'total']);
    expect(page.rows.map((r) => r.key)).toEqual(['B']);
    expect(page.total).toBe(3);
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
