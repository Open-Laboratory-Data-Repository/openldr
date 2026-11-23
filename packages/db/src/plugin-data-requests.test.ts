import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import { createPluginSchemas } from './plugin-schema';
import {
  createPluginRequests, PluginRequestError, type PluginCaller, type PluginRequests,
} from './plugin-data-requests';
import type { TableShape } from './plugin-table-shape';

// pg-mem cannot run row-level security, and its set_config does nothing, so these tests prove the
// filter CE builds itself. On a superuser login that filter is the only guard. The policy and the
// timeout are proved in plugin-data-requests.live.test.ts. pg-mem's LIKE has no escape character,
// so the escaping of a prefix is a live-only fact too.

const samples: TableShape = {
  name: 'samples',
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'facility', type: 'text' },
    { name: 'code', type: 'text' },
    { name: 'score', type: 'numeric' },
    { name: 'taken', type: 'date' },
    { name: 'note', type: 'text' },
  ],
  primaryKey: ['id'],
  facilityColumn: 'facility',
};
const codes: TableShape = {
  name: 'codes',
  columns: [{ name: 'code', type: 'text' }, { name: 'label', type: 'text', nullable: false }, { name: 'meta', type: 'jsonb' }],
  primaryKey: ['code'],
};
const shapes = [samples, codes];
const PLUGIN = 'lab';

const all: PluginCaller = { userId: 'u0', displayName: null, capabilities: [], facilities: '*' };
const siteA: PluginCaller = { userId: 'u1', displayName: 'A', capabilities: [], facilities: ['fa'] };

function refusal(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => { throw new Error('expected a refusal'); },
    (e) => { expect(e).toBeInstanceOf(PluginRequestError); return (e as PluginRequestError).reason; },
  );
}

describe('plugin data requests (pg-mem)', () => {
  let db: Kysely<any>;
  let req: PluginRequests;
  let queries: string[];

  beforeEach(async () => {
    const mem = newDb();
    queries = [];
    mem.public.interceptQueries((q) => {
      queries.push(q);
      return /^set local statement_timeout/i.test(q.trim()) ? [] : null;
    });
    db = mem.adapters.createKysely() as Kysely<any>;
    await createPluginSchemas(db, { rowLevelSecurity: false }).apply(PLUGIN, shapes);
    const rows = [
      { id: 1, facility: 'fa', code: 'abc', score: 1, taken: '2026-01-01', note: null },
      { id: 2, facility: 'fa', code: 'abd', score: 2, taken: '2026-01-02', note: 'x' },
      { id: 3, facility: 'fb', code: 'abe', score: 3, taken: '2026-01-03', note: 'y' },
      { id: 4, facility: 'fb', code: 'xyz', score: 4, taken: '2026-01-04', note: null },
      { id: 5, facility: 'fa', code: 'xya', score: 5, taken: '2026-01-05', note: 'z' },
    ];
    req = createPluginRequests(db);
    await req.write(PLUGIN, shapes, all, { steps: rows.map((values) => ({ op: 'insert' as const, table: 'samples', values })) });
    queries = [];
  });

  const ids = async (caller: PluginCaller, r: Record<string, unknown>) =>
    (await req.select(PLUGIN, shapes, caller, { table: 'samples', columns: ['id'], ...r } as never)).rows.map((x) => x.id);

  describe('refused before any SQL runs', () => {
    const hostile: [string, unknown][] = [
      ['a quoted table', { table: 'samples"; drop table x; --' }],
      ['a dotted table', { table: 'plugin_lab.samples' }],
      ['pg_catalog', { table: 'pg_catalog.pg_roles' }],
      ['public.users', { table: 'public.users' }],
      ['the shapes registry', { table: '_openldr_shapes' }],
      ['an undeclared table', { table: 'users' }],
      ['a quoted column', { table: 'samples', columns: ['code" from x --'] }],
      ['a dotted column', { table: 'samples', columns: ['samples.code'] }],
      ['an undeclared column', { table: 'samples', columns: ['password'] }],
      ['an aliased column', { table: 'samples', columns: ['code as facility'] }],
      ['an undeclared filter column', { table: 'samples', where: [{ column: 'secret', op: 'eq', value: 1 }] }],
      ['an undeclared order column', { table: 'samples', orderBy: [{ column: 'secret' }] }],
      ['a limit of 10 million', { table: 'samples', limit: 10_000_000 }],
      ['a limit of 0', { table: 'samples', limit: 0 }],
      ['an unknown filter op', { table: 'samples', where: [{ column: 'code', op: 'like', value: '%' }] }],
      ['an unknown key', { table: 'samples', sql: 'select 1' }],
      ['in with 1001 values', { table: 'samples', where: [{ column: 'id', op: 'in', values: Array.from({ length: 1001 }, (_, i) => i) }] }],
      ['prefix on a non-text column', { table: 'samples', where: [{ column: 'id', op: 'prefix', value: '1' }] }],
      ['a wrong value type', { table: 'samples', where: [{ column: 'id', op: 'eq', value: 'one' }] }],
      ['a bad date', { table: 'samples', where: [{ column: 'taken', op: 'eq', value: 'today' }] }],
    ];
    for (const [name, r] of hostile) {
      it(`select: ${name}`, async () => {
        await refusal(req.select(PLUGIN, shapes, all, r as never));
        expect(queries).toEqual([]);
      });
    }

    const hostileWrites: [string, unknown][] = [
      ['the shapes registry', { steps: [{ op: 'delete', table: '_openldr_shapes', key: { table_name: 'samples' } }] }],
      ['an undeclared table', { steps: [{ op: 'insert', table: 'users', values: { id: 1 } }] }],
      ['created_at', { steps: [{ op: 'insert', table: 'codes', values: { code: 'c', label: 'l', created_at: '2020-01-01T00:00:00Z' } }] }],
      ['updated_at', { steps: [{ op: 'update', table: 'codes', key: { code: 'c' }, set: { updated_at: '2020-01-01T00:00:00Z' } }] }],
      ['an undeclared column', { steps: [{ op: 'insert', table: 'codes', values: { code: 'c', label: 'l', admin: true } }] }],
      ['a wrong type', { steps: [{ op: 'insert', table: 'samples', values: { id: 'x', facility: 'fa' } }] }],
      ['a fractional integer', { steps: [{ op: 'insert', table: 'samples', values: { id: 1.5, facility: 'fa' } }] }],
      ['null in a not-null column', { steps: [{ op: 'insert', table: 'codes', values: { code: 'c', label: null } }] }],
      ['a key that is not the primary key', { steps: [{ op: 'delete', table: 'samples', key: { code: 'abc' } }] }],
      ['an empty key', { steps: [{ op: 'delete', table: 'samples', key: {} }] }],
      ['an insert with no facility', { steps: [{ op: 'insert', table: 'samples', values: { id: 9 } }] }],
      ['no steps', { steps: [] }],
      ['a proto key', JSON.parse('{"steps":[{"op":"insert","table":"codes","values":{"__proto__":{"x":1},"code":"c","label":"l"}}]}')],
    ];
    for (const [name, r] of hostileWrites) {
      it(`write: ${name}`, async () => {
        await refusal(req.write(PLUGIN, shapes, all, r as never));
        expect(queries).toEqual([]);
      });
    }

    it('a caller facility id with a comma or a * is refused', async () => {
      await expect(refusal(req.select(PLUGIN, shapes, { ...siteA, facilities: ['fa,fb'] }, { table: 'samples' }))).resolves.toBe('facility');
      await expect(refusal(req.select(PLUGIN, shapes, { ...siteA, facilities: ['*'] }, { table: 'samples' }))).resolves.toBe('facility');
      expect(queries).toEqual([]);
    });
  });

  describe('names come from the shapes CE recorded, not from the request', () => {
    it('a column the passed shapes add, but CE never made, is refused', async () => {
      const forged: TableShape = { ...codes, columns: [...codes.columns, { name: 'secret', type: 'text' }] };
      await expect(refusal(req.select(PLUGIN, [samples, forged], all, { table: 'codes', columns: ['secret'] }))).resolves.toBe('shape');
    });
    it('a table the passed shapes add, but CE never made, is refused', async () => {
      const extra: TableShape = { name: 'extra', columns: [{ name: 'id', type: 'integer' }], primaryKey: ['id'] };
      await expect(refusal(req.select(PLUGIN, [...shapes, extra], all, { table: 'extra' }))).resolves.toBe('table');
    });
    it('dropping the facility column from the passed shape is refused, not read as unfiltered', async () => {
      const { facilityColumn: _f, ...open } = samples;
      await expect(refusal(req.select(PLUGIN, [open as TableShape, codes], siteA, { table: 'samples' }))).resolves.toBe('shape');
    });
  });

  describe('filters, order, paging and count', () => {
    it('each filter kind', async () => {
      expect(await ids(all, { where: [{ column: 'code', op: 'eq', value: 'abd' }] })).toEqual([2]);
      expect(await ids(all, { where: [{ column: 'id', op: 'in', values: [1, 3, 99] }] })).toEqual([1, 3]);
      expect(await ids(all, { where: [{ column: 'score', op: 'lt', value: 2 }] })).toEqual([1]);
      expect(await ids(all, { where: [{ column: 'score', op: 'lte', value: 2 }] })).toEqual([1, 2]);
      expect(await ids(all, { where: [{ column: 'taken', op: 'gt', value: '2026-01-04' }] })).toEqual([5]);
      expect(await ids(all, { where: [{ column: 'taken', op: 'gte', value: '2026-01-04' }] })).toEqual([4, 5]);
      expect(await ids(all, { where: [{ column: 'note', op: 'is_null', value: true }] })).toEqual([1, 4]);
      expect(await ids(all, { where: [{ column: 'note', op: 'is_null', value: false }] })).toEqual([2, 3, 5]);
      expect(await ids(all, { where: [{ column: 'code', op: 'prefix', value: 'ab' }] })).toEqual([1, 2, 3]);
      expect(await ids(all, { where: [{ column: 'code', op: 'prefix', value: 'ab' }, { column: 'score', op: 'gt', value: 1 }] })).toEqual([2, 3]);
    });

    it('order, limit, offset and count', async () => {
      expect(await ids(all, { orderBy: [{ column: 'score', direction: 'desc' }] })).toEqual([5, 4, 3, 2, 1]);
      expect(await ids(all, { orderBy: [{ column: 'facility' }] })).toEqual([1, 2, 5, 3, 4]);
      const page = await req.select(PLUGIN, shapes, all, { table: 'samples', columns: ['id'], limit: 2, offset: 1, count: true });
      expect(page).toEqual({ rows: [{ id: 2 }, { id: 3 }], count: 5 });
      const none = await req.select(PLUGIN, shapes, all, { table: 'samples', columns: ['id'], limit: 2 });
      expect(none.count).toBeUndefined();
    });

    it('the limit defaults to 100', async () => {
      const many = Array.from({ length: 150 }, (_, i) => ({ op: 'insert' as const, table: 'codes', values: { code: `c${String(i).padStart(3, '0')}`, label: 'l' } }));
      await req.write(PLUGIN, shapes, all, { steps: many });
      const r = await req.select(PLUGIN, shapes, all, { table: 'codes', columns: ['code'], count: true });
      expect(r.rows).toHaveLength(100);
      expect(r.count).toBe(150);
    });

    it('returns only declared columns plus created_at and updated_at', async () => {
      const [row] = (await req.select(PLUGIN, shapes, all, { table: 'samples', where: [{ column: 'id', op: 'eq', value: 1 }] })).rows;
      expect(Object.keys(row).sort()).toEqual(['code', 'created_at', 'facility', 'id', 'note', 'score', 'taken', 'updated_at']);
    });

    it('sets the timeout and the facility setting inside the transaction', async () => {
      await req.select(PLUGIN, shapes, { ...siteA, facilities: ['FA', 'Fb'] }, { table: 'samples' });
      expect(queries[0]).toMatch(/^begin/i);
      expect(queries[1]).toBe("set local statement_timeout = '5s'");
      expect(queries[2]).toBe("select set_config('openldr.facilities', 'fa,fb', true)");
      queries = [];
      await req.write(PLUGIN, shapes, all, { steps: [{ op: 'delete', table: 'codes', key: { code: 'none' } }] });
      expect(queries.slice(1, 3)).toEqual(["set local statement_timeout = '5s'", "select set_config('openldr.facilities', '*', true)"]);
    });
  });

  describe('the facility filter CE adds', () => {
    it('a select with no filter returns only the caller\'s facilities', async () => {
      expect(await ids(siteA, {})).toEqual([1, 2, 5]);
      expect(await ids(all, {})).toEqual([1, 2, 3, 4, 5]);
      expect(await ids({ ...siteA, facilities: [] }, {})).toEqual([]);
    });

    it('an eq or in on the facility column cannot widen it', async () => {
      expect(await ids(siteA, { where: [{ column: 'facility', op: 'eq', value: 'fb' }] })).toEqual([]);
      expect(await ids(siteA, { where: [{ column: 'facility', op: 'in', values: ['fa', 'fb'] }] })).toEqual([1, 2, 5]);
      expect(await ids(siteA, { where: [{ column: 'facility', op: 'is_null', value: false }] })).toEqual([1, 2, 5]);
      expect(await ids(siteA, { where: [{ column: 'facility', op: 'prefix', value: 'f' }] })).toEqual([1, 2, 5]);
      const c = await req.select(PLUGIN, shapes, siteA, { table: 'samples', columns: ['id'], count: true });
      expect(c.count).toBe(3);
    });

    it('caller ids are lowercased, so an uppercase id still matches', async () => {
      expect(await ids({ ...siteA, facilities: ['FA'] }, {})).toEqual([1, 2, 5]);
    });

    it('an insert for another facility is refused, and for its own is stored lowercased', async () => {
      await expect(refusal(req.write(PLUGIN, shapes, siteA, { steps: [{ op: 'insert', table: 'samples', values: { id: 9, facility: 'fb' } }] }))).resolves.toBe('facility');
      await req.write(PLUGIN, shapes, siteA, { steps: [{ op: 'insert', table: 'samples', values: { id: 9, facility: 'FA' } }] });
      const r = await req.select(PLUGIN, shapes, all, { table: 'samples', columns: ['facility'], where: [{ column: 'id', op: 'eq', value: 9 }] });
      expect(r.rows).toEqual([{ facility: 'fa' }]);
    });

    it('an update that moves a row to another facility is refused', async () => {
      await expect(refusal(req.write(PLUGIN, shapes, siteA, { steps: [{ op: 'update', table: 'samples', key: { id: 1 }, set: { facility: 'fb' } }] }))).resolves.toBe('facility');
      expect(await ids(all, { where: [{ column: 'facility', op: 'eq', value: 'fa' }] })).toEqual([1, 2, 5]);
    });

    it('an update or delete by key on another facility\'s row touches nothing', async () => {
      const r = await req.write(PLUGIN, shapes, siteA, { steps: [
        { op: 'update', table: 'samples', key: { id: 3 }, set: { note: 'hacked' } },
        { op: 'update', table: 'samples', key: { id: 3 }, set: { facility: 'fa' } },
        { op: 'delete', table: 'samples', key: { id: 4 } },
        { op: 'update', table: 'samples', key: { id: 1 }, set: { note: 'mine' } },
      ] });
      expect(r.results).toEqual([{ rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 }, { rowCount: 1 }]);
      const rows = (await req.select(PLUGIN, shapes, all, { table: 'samples', columns: ['id', 'facility', 'note'] })).rows;
      expect(rows).toEqual([
        { id: 1, facility: 'fa', note: 'mine' }, { id: 2, facility: 'fa', note: 'x' }, { id: 3, facility: 'fb', note: 'y' },
        { id: 4, facility: 'fb', note: null }, { id: 5, facility: 'fa', note: 'z' },
      ]);
    });

    it('a caller with no facilities can write nothing to a facility table', async () => {
      const none = { ...siteA, facilities: [] };
      await expect(refusal(req.write(PLUGIN, shapes, none, { steps: [{ op: 'insert', table: 'samples', values: { id: 9, facility: 'fa' } }] }))).resolves.toBe('facility');
      const r = await req.write(PLUGIN, shapes, none, { steps: [{ op: 'delete', table: 'samples', key: { id: 1 } }] });
      expect(r.results).toEqual([{ rowCount: 0 }]);
    });
  });

  describe('writes', () => {
    it('insert, update and delete in one transaction, with updated_at set by CE', async () => {
      const before = (await req.select(PLUGIN, shapes, all, { table: 'samples', columns: ['updated_at'], where: [{ column: 'id', op: 'eq', value: 2 }] })).rows[0].updated_at as Date;
      await new Promise((r) => setTimeout(r, 5));
      const r = await req.write(PLUGIN, shapes, all, { steps: [
        { op: 'insert', table: 'codes', values: { code: 'k', label: 'K', meta: { a: [1, 2] } } },
        { op: 'update', table: 'samples', key: { id: 2 }, set: { note: 'changed' } },
        { op: 'delete', table: 'samples', key: { id: 1 } },
      ] });
      expect(r.results).toEqual([{ rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }]);
      const row = (await req.select(PLUGIN, shapes, all, { table: 'samples', columns: ['note', 'updated_at'], where: [{ column: 'id', op: 'eq', value: 2 }] })).rows[0];
      expect(row.note).toBe('changed');
      expect((row.updated_at as Date).getTime()).toBeGreaterThan(before.getTime());
      expect((await req.select(PLUGIN, shapes, all, { table: 'codes', columns: ['meta'] })).rows).toEqual([{ meta: { a: [1, 2] } }]);
      expect(await ids(all, {})).toEqual([2, 3, 4, 5]);
    });

    it('a failed step sends rollback, not commit (pg-mem cannot undo; the live test checks the rows)', async () => {
      await expect(req.write(PLUGIN, shapes, all, { steps: [
        { op: 'insert', table: 'codes', values: { code: 'k', label: 'K' } },
        { op: 'update', table: 'samples', key: { id: 2 }, set: { note: 'changed' } },
        { op: 'delete', table: 'samples', key: { id: 1 } },
        { op: 'insert', table: 'samples', values: { id: 3, facility: 'fa' } },
      ] })).rejects.toThrow();
      const words = queries.map((q) => q.trim().split(/\s+/)[0].toLowerCase());
      expect(words[0]).toBe('begin');
      expect(words.at(-1)).toBe('rollback');
      expect(words).not.toContain('commit');
    });
  });
});
