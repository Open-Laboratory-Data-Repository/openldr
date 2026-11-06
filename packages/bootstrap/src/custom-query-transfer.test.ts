import { describe, it, expect } from 'vitest';
import type { CustomQuery, CustomQueryStore } from '@openldr/db';
import {
  exportCustomQueries, importCustomQueries, checkCustomQueryFile, CustomQueryTransferError, CUSTOM_QUERY_FILE_FORMAT,
  type TransferDeps,
} from './custom-query-transfer';
import { DEFAULT_CONNECTOR_NAME } from './seed';

function fakeStore(seed: CustomQuery[] = []): CustomQueryStore & { map: Map<string, CustomQuery>; writes: number } {
  const map = new Map(seed.map((s) => [s.id, s]));
  const store = {
    map, writes: 0,
    async create(q: CustomQuery) { store.writes++; map.set(q.id, { ...q }); },
    async get(id: string) { return map.get(id) ?? null; },
    async getByName(name: string) { return [...map.values()].find((v) => v.name === name) ?? null; },
    async list() { return [...map.values()]; },
    async update(id: string, patch: Partial<CustomQuery>) {
      store.writes++;
      const cur = map.get(id);
      if (cur) map.set(id, { ...cur, ...patch });
    },
    async setGroup(id: string, groupId: string | null) {
      const cur = map.get(id);
      if (cur) map.set(id, { ...cur, groupId });
    },
    async remove(id: string) { map.delete(id); },
  };
  return store;
}
const fakeConnectors = (names: Record<string, string>) => ({
  async list() { return Object.entries(names).map(([name, id]) => ({ id, name })); },
});
const file = (queries: unknown[]) => ({ format: CUSTOM_QUERY_FILE_FORMAT, version: 1, exportedAt: '2026-09-30T00:00:00Z', queries });
const q = (name: string, sql = 'select 1') => ({ name, sql, params: [] });
const stored = (id: string, name: string, connectorId = 'c1', sql = 'select 1'): CustomQuery =>
  ({ id, name, connectorId, sql, params: [] });

function fakeGroups(seed: { id: string; name: string }[] = []) {
  const map = new Map(seed.map((g) => [g.id, { ...g }]));
  return {
    map,
    async list() { return [...map.values()]; },
    async getByName(name: string) { return [...map.values()].find((g) => g.name === name) ?? null; },
    async create(g: { id: string; name: string }) { map.set(g.id, { ...g }); },
  };
}

function deps(
  store: CustomQueryStore,
  connectors: Record<string, string> = { [DEFAULT_CONNECTOR_NAME]: 'c1' },
  groups = fakeGroups(),
): TransferDeps {
  let n = 0;
  let g = 0;
  return {
    customQueries: store, customQueryGroups: groups, connectors: fakeConnectors(connectors),
    newId: () => `cq_new${++n}`, newGroupId: () => `cqg_new${++g}`, now: () => new Date('2026-09-30T12:00:00Z'),
  };
}

describe('exportCustomQueries', () => {
  it('writes every query sorted by name, with no id and no connector', async () => {
    const store = fakeStore([stored('i1', 'b'), stored('i2', 'a')]);
    const out = await exportCustomQueries(deps(store));
    expect(out.format).toBe(CUSTOM_QUERY_FILE_FORMAT);
    expect(out.version).toBe(1);
    expect(out.exportedAt).toBe('2026-09-30T12:00:00.000Z');
    expect(out.queries.map((x) => x.name)).toEqual(['a', 'b']);
    for (const x of out.queries) {
      expect(Object.keys(x).sort()).toEqual(['name', 'params', 'sql']);
    }
  });

  it('exports only the selected ids, or names', async () => {
    const store = fakeStore([stored('i1', 'a'), stored('i2', 'b'), stored('i3', 'c')]);
    const byId = await exportCustomQueries(deps(store), { ids: ['i3', 'i1'] });
    expect(byId.queries.map((x) => x.name)).toEqual(['a', 'c']);
    const byName = await exportCustomQueries(deps(store), { names: ['b'] });
    expect(byName.queries.map((x) => x.name)).toEqual(['b']);
  });
});

describe('importCustomQueries', () => {
  it('creates new queries on the default warehouse connector', async () => {
    const store = fakeStore();
    const res = await importCustomQueries(deps(store), file([q('a'), q('b')]), { replace: false });
    expect(res.results.map((r) => [r.name, r.outcome])).toEqual([['a', 'created'], ['b', 'created']]);
    const a = await store.getByName('a');
    expect(a?.connectorId).toBe('c1');
    expect(a?.id).toBe(res.results[0].id);
    expect(store.map.size).toBe(2);
  });

  it('skips an existing name unless replace is set', async () => {
    const store = fakeStore([stored('i1', 'a', 'other-conn', 'select 0')]);
    const d = deps(store);
    const skipped = await importCustomQueries(d, file([q('a', 'select 2')]), { replace: false });
    expect(skipped.results).toEqual([{ name: 'a', outcome: 'skipped', id: 'i1' }]);
    expect((await store.get('i1'))?.sql).toBe('select 0');

    const replaced = await importCustomQueries(d, file([q('a', 'select 2')]), { replace: true });
    expect(replaced.results).toEqual([{ name: 'a', outcome: 'replaced', id: 'i1' }]);
    const after = await store.get('i1');
    expect(after?.id).toBe('i1');
    expect(after?.connectorId).toBe('other-conn');
    expect(after?.sql).toBe('select 2');
    expect(store.map.size).toBe(1);
  });

  it('uses the named connector when given, and refuses an unknown one', async () => {
    const conns = { [DEFAULT_CONNECTOR_NAME]: 'c1', 'Lab DB': 'c2' };
    const store = fakeStore();
    await importCustomQueries(deps(store, conns), file([q('a')]), { connectorName: 'Lab DB', replace: false });
    expect((await store.getByName('a'))?.connectorId).toBe('c2');

    const empty = fakeStore();
    await expect(importCustomQueries(deps(empty, conns), file([q('a')]), { connectorName: 'Nope', replace: false }))
      .rejects.toBeInstanceOf(CustomQueryTransferError);
    expect(empty.writes).toBe(0);
    expect(empty.map.size).toBe(0);
  });

  it('refuses when the default connector is missing, writing nothing', async () => {
    const store = fakeStore();
    await expect(importCustomQueries(deps(store, {}), file([q('a')]), { replace: false }))
      .rejects.toBeInstanceOf(CustomQueryTransferError);
    expect(store.writes).toBe(0);
  });

  it('refuses the whole file when one query is not a SELECT, writing nothing', async () => {
    const store = fakeStore();
    const p = importCustomQueries(deps(store), file([q('a'), q('b', 'delete from x')]), { replace: false });
    await expect(p).rejects.toBeInstanceOf(CustomQueryTransferError);
    await expect(p).rejects.toThrow(/"b"/);
    expect(store.writes).toBe(0);
    expect(store.map.size).toBe(0);
  });

  it('refuses duplicate names inside one file, writing nothing', async () => {
    const store = fakeStore();
    const p = importCustomQueries(deps(store), file([q('a'), q('a', 'select 2')]), { replace: true });
    await expect(p).rejects.toBeInstanceOf(CustomQueryTransferError);
    await expect(p).rejects.toThrow(/"a"/);
    expect(store.writes).toBe(0);
  });

  it('refuses an unknown format or a newer version', async () => {
    const store = fakeStore();
    const d = deps(store);
    await expect(importCustomQueries(d, { ...file([q('a')]), format: 'something.else' }, { replace: false }))
      .rejects.toBeInstanceOf(CustomQueryTransferError);
    await expect(importCustomQueries(d, { ...file([q('a')]), version: 2 }, { replace: false }))
      .rejects.toBeInstanceOf(CustomQueryTransferError);
    await expect(importCustomQueries(d, 'not an object', { replace: false }))
      .rejects.toBeInstanceOf(CustomQueryTransferError);
    expect(store.writes).toBe(0);
  });

  it('round-trips: export then import into an empty store gives the same queries', async () => {
    const params = [{ id: 'p', label: 'P', type: 'text' as const, required: true }];
    const src = fakeStore([
      { ...stored('i1', 'b', 'c9', 'select 2'), params },
      stored('i2', 'a', 'c9', 'select 1'),
    ]);
    const exported = await exportCustomQueries(deps(src));
    const dst = fakeStore();
    await importCustomQueries(deps(dst), JSON.parse(JSON.stringify(exported)), { replace: false });
    const again = await exportCustomQueries(deps(dst));
    expect(again.queries).toEqual(exported.queries);
    expect(again.queries.map((x) => x.name)).toEqual(['a', 'b']);
  });
});

describe('query groups in files', () => {
  it('export writes the group name, and leaves it out for an ungrouped query', async () => {
    const store = fakeStore([{ ...stored('i1', 'a'), groupId: 'g1' }, stored('i2', 'b')]);
    const out = await exportCustomQueries(deps(store, undefined, fakeGroups([{ id: 'g1', name: 'Mozambique' }])));
    expect(out.queries).toEqual([
      { name: 'a', sql: 'select 1', params: [], group: 'Mozambique' },
      { name: 'b', sql: 'select 1', params: [] },
    ]);
  });

  it('import creates the group once and puts new queries in it', async () => {
    const store = fakeStore();
    const groups = fakeGroups();
    await importCustomQueries(deps(store, undefined, groups),
      file([{ ...q('a'), group: 'Mozambique' }, { ...q('b'), group: 'Mozambique' }, q('c')]), { replace: false });
    expect([...groups.map.values()]).toEqual([{ id: 'cqg_new1', name: 'Mozambique' }]);
    expect(store.map.get('cq_new1')?.groupId).toBe('cqg_new1');
    expect(store.map.get('cq_new2')?.groupId).toBe('cqg_new1');
    expect(store.map.get('cq_new3')?.groupId).toBeUndefined();
  });

  it('import reuses a group that already has the name', async () => {
    const store = fakeStore();
    const groups = fakeGroups([{ id: 'g1', name: 'Mozambique' }]);
    await importCustomQueries(deps(store, undefined, groups), file([{ ...q('a'), group: 'Mozambique' }]), { replace: false });
    expect(groups.map.size).toBe(1);
    expect(store.map.get('cq_new1')?.groupId).toBe('g1');
  });

  it('a replace groups an ungrouped query, but never moves a query already in a group', async () => {
    const store = fakeStore([{ ...stored('i1', 'a'), groupId: null }, { ...stored('i2', 'b'), groupId: 'mine' }]);
    const groups = fakeGroups([{ id: 'mine', name: 'My picks' }]);
    await importCustomQueries(deps(store, undefined, groups),
      file([{ ...q('a'), group: 'Mozambique' }, { ...q('b'), group: 'Mozambique' }]), { replace: true });
    const moz = [...groups.map.values()].find((g) => g.name === 'Mozambique')!;
    expect(store.map.get('i1')?.groupId).toBe(moz.id);
    expect(store.map.get('i2')?.groupId).toBe('mine');
  });

  it('a skipped query is not grouped, and no group is made for it', async () => {
    const store = fakeStore([{ ...stored('i1', 'a'), groupId: null }]);
    const groups = fakeGroups();
    await importCustomQueries(deps(store, undefined, groups), file([{ ...q('a'), group: 'Mozambique' }]), { replace: false });
    expect(groups.map.size).toBe(0);
    expect(store.map.get('i1')?.groupId).toBeNull();
  });

  it('refuses a blank group name, writing nothing', async () => {
    const store = fakeStore();
    await expect(importCustomQueries(deps(store), file([{ ...q('a'), group: '  ' }]), { replace: false }))
      .rejects.toThrow(CustomQueryTransferError);
    expect(store.writes).toBe(0);
  });

  it('round-trips groups: export then import into an empty install', async () => {
    const source = fakeStore([{ ...stored('i1', 'a'), groupId: 'g1' }, stored('i2', 'b')]);
    const out = await exportCustomQueries(deps(source, undefined, fakeGroups([{ id: 'g1', name: 'TB' }])));
    const target = fakeStore();
    const groups = fakeGroups();
    await importCustomQueries(deps(target, undefined, groups), out, { replace: false });
    const byName = new Map([...target.map.values()].map((x) => [x.name, x.groupId]));
    expect(byName.get('a')).toBe([...groups.map.values()][0].id);
    expect([...groups.map.values()][0].name).toBe('TB');
    expect(byName.get('b')).toBeUndefined();
  });
});

describe('checkCustomQueryFile', () => {
  it('throws for a query that is not a SELECT', () => {
    expect(() => checkCustomQueryFile(file([q('bad', 'delete from patients')]))).toThrow(/^query "bad": /);
  });
  it('throws for a duplicate name', () => {
    expect(() => checkCustomQueryFile(file([q('a'), q('a')]))).toThrow(CustomQueryTransferError);
  });
  it('returns for a valid file', () => {
    expect(() => checkCustomQueryFile(file([q('ok'), q('ok2')]))).not.toThrow();
  });
});
