import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { type Kysely, sql } from 'kysely';
import {
  createPluginSchemas, columnDefault, indexName, pluginSchemaName, PluginShapeError, PG_MEM_WITHOUT_RLS, SHAPES_TABLE,
  type PluginSchemas,
} from './plugin-schema';
import { tableShapeSchema, type TableShape } from './plugin-table-shape';

// pg-mem cannot run the row-level security statements or DROP SCHEMA, so these tests pass
// PG_MEM_WITHOUT_RLS and leave both to plugin-schema.live.test.ts. pg-mem DDL is also not
// transactional, so a rollback after a failed step is a live-only fact too.

const orders: TableShape = {
  name: 'orders',
  columns: [
    { name: 'id', type: 'uuid' },
    { name: 'facility', type: 'text' },
    { name: 'status', type: 'text', nullable: false, default: 'draft' },
    { name: 'count', type: 'integer', default: 0 },
  ],
  primaryKey: ['id'],
  indexes: [{ columns: ['status'] }],
  facilityColumn: 'facility',
};

function refusal(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => { throw new Error('expected a refusal'); },
    (e) => { expect(e).toBeInstanceOf(PluginShapeError); return (e as PluginShapeError).reason; },
  );
}

async function columns(db: Kysely<any>, schema: string, table: string): Promise<string[]> {
  // Reads the column names from a row, so the caller inserts one first.
  const rows = await db.withSchema(schema).selectFrom(table).selectAll().limit(1).execute();
  return rows.length > 0 ? Object.keys(rows[0]).sort() : [];
}

describe('plugin schemas (pg-mem)', () => {
  let db: Kysely<any>;
  let schemas: PluginSchemas;
  beforeEach(() => {
    db = newDb().adapters.createKysely() as Kysely<any>;
    schemas = createPluginSchemas(db, PG_MEM_WITHOUT_RLS);
  });

  it('the first apply creates the schema, its tables and the record of shapes', async () => {
    const plan = await schemas.plan('lab', [orders]);
    expect(plan).toMatchObject({ schema: 'plugin_lab', createSchema: true, addColumns: [], addIndexes: [] });
    expect(plan.createTables.map((t) => t.name)).toEqual(['orders']);

    expect(await schemas.apply('lab', [orders])).toEqual({ created: ['orders'], added: [] });
    await db.withSchema('plugin_lab').insertInto('orders').values({ id: '6b9d0c1e-0f0a-4c39-9a55-1e2f3a4b5c6d', facility: 'f1' }).execute();
    const [row] = await db.withSchema('plugin_lab').selectFrom('orders').selectAll().execute();
    expect(row).toMatchObject({ status: 'draft', count: 0, facility: 'f1' });
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
    expect(await columns(db, 'plugin_lab', 'orders')).toEqual(['count', 'created_at', 'facility', 'id', 'status', 'updated_at']);

    const recorded = await db.withSchema('plugin_lab').selectFrom(SHAPES_TABLE).selectAll().execute();
    expect(recorded.map((r) => [r.table_name, r.plugin_id])).toEqual([['orders', 'lab']]);
  });

  it('the facility column is NOT NULL even when declared nullable', async () => {
    await schemas.apply('lab', [orders]);
    await expect(db.withSchema('plugin_lab').insertInto('orders').values({ id: '6b9d0c1e-0f0a-4c39-9a55-1e2f3a4b5c6d' }).execute()).rejects.toThrow();
  });

  it('a second apply with one new table and one new nullable column adds only those', async () => {
    await schemas.apply('lab', [orders]);
    const notes: TableShape = { name: 'notes', columns: [{ name: 'id', type: 'bigint' }, { name: 'body', type: 'text' }], primaryKey: ['id'] };
    const orders2: TableShape = { ...orders, columns: [...orders.columns, { name: 'note', type: 'text' }] };
    const plan = await schemas.plan('lab', [orders2, notes]);
    expect(plan.createSchema).toBe(false);
    expect(plan.createTables.map((t) => t.name)).toEqual(['notes']);
    expect(plan.addColumns.map((a) => `${a.table}.${a.column.name}`)).toEqual(['orders.note']);
    expect(plan.addIndexes).toEqual([]);

    expect(await schemas.apply('lab', [orders2, notes])).toEqual({ created: ['notes'], added: ['orders.note'] });
    await db.withSchema('plugin_lab').insertInto('orders').values({ id: '6b9d0c1e-0f0a-4c39-9a55-1e2f3a4b5c6d', facility: 'f1', note: 'n' }).execute();
    await db.withSchema('plugin_lab').insertInto('notes').values({ id: 1, body: 'b' }).execute();
    expect((await db.withSchema('plugin_lab').selectFrom('orders').select('note').execute())[0].note).toBe('n');

    // The same shapes again change nothing.
    expect(await schemas.apply('lab', [orders2, notes])).toEqual({ created: [], added: [] });
  });

  it('a new index is added with a CE-made name', async () => {
    await schemas.apply('lab', [orders]);
    const orders2: TableShape = { ...orders, indexes: [...orders.indexes!, { columns: ['facility', 'status'], unique: true }] };
    const name = indexName('orders', ['facility', 'status'], true);
    expect(name).toMatch(/^_ix_[0-9a-f]{16}$/);
    expect(await schemas.apply('lab', [orders2])).toEqual({ created: [], added: [`orders(${name})`] });
  });

  it('refuses a dropped table, a dropped column, a rename, a type change and a non-nullable new column', async () => {
    const notes: TableShape = { name: 'notes', columns: [{ name: 'id', type: 'bigint' }], primaryKey: ['id'] };
    await schemas.apply('lab', [orders, notes]);
    const without = (name: string) => orders.columns.filter((c) => c.name !== name);
    expect(await refusal(schemas.apply('lab', [orders]))).toBe('drop');
    expect(await refusal(schemas.apply('lab', [{ ...orders, columns: without('count') }, notes]))).toBe('drop');
    expect(await refusal(schemas.apply('lab', [{ ...orders, columns: [...without('count'), { name: 'total', type: 'integer' }] }, notes]))).toBe('rename');
    expect(await refusal(schemas.apply('lab', [{ ...orders, columns: [...without('count'), { name: 'count', type: 'bigint' }] }, notes]))).toBe('type');
    expect(await refusal(schemas.apply('lab', [{ ...orders, columns: [...orders.columns, { name: 'must', type: 'text', nullable: false }] }, notes]))).toBe('nullable');
    expect(await refusal(schemas.apply('lab', [{ ...orders, columns: [...without('status'), { name: 'status', type: 'text', nullable: false, default: 'new' }] }, notes]))).toBe('default');
    expect(await refusal(schemas.apply('lab', [{ ...orders, indexes: [] }, notes]))).toBe('drop');
    expect(await refusal(schemas.apply('lab', [{ ...orders, facilityColumn: undefined }, notes]))).toBe('facility');
    expect(await refusal(schemas.apply('lab', [{ ...orders, primaryKey: ['id', 'facility'] }, notes]))).toBe('key');
    // Nothing changed: the table still takes a row of the first shape.
    await db.withSchema('plugin_lab').insertInto('orders').values({ id: '6b9d0c1e-0f0a-4c39-9a55-1e2f3a4b5c6d', facility: 'f1' }).execute();
  });

  it('an id with odd characters gives a safe schema name, cut to 63', () => {
    expect(pluginSchemaName('Org.Lab-Module')).toBe('plugin_org_lab_module');
    expect(pluginSchemaName('a"; drop table users; --')).toBe('plugin_a___drop_table_users____');
    expect(pluginSchemaName('x'.repeat(100))).toHaveLength(63);
    expect(() => pluginSchemaName('')).toThrow(PluginShapeError);
    expect(schemas.schemaName('Org.Lab')).toBe('plugin_org_lab');
  });

  it('refuses a second plugin id that maps to the same schema name', async () => {
    await schemas.apply('org.lab', [orders]);
    expect(await refusal(schemas.apply('org_lab', [orders]))).toBe('name');
    expect(await refusal(schemas.plan('ORG.LAB', [orders]))).toBe('name');
  });

  it('drop of a second plugin id that maps to the same schema name keeps the schema and does not throw', async () => {
    await schemas.apply('org.lab', [orders]);
    const out = await schemas.drop('org-lab');
    expect(out.dropped).toBe(false);
    expect(out.reason).toMatch(/belongs to plugin 'org\.lab'/);
    await db.withSchema('plugin_org_lab').insertInto('orders').values({ id: '6b9d0c1e-0f0a-4c39-9a55-1e2f3a4b5c6d', facility: 'f1' }).execute();
    expect(await schemas.drop('nothing-here')).toEqual({ dropped: false });
  });

  it('refuses hostile names even when the manifest parse was skipped', async () => {
    const bad = (t: Partial<TableShape>) => ({ ...orders, ...t }) as TableShape;
    expect(await refusal(schemas.apply('lab', [bad({ name: 'public.users' })]))).toBe('invalid');
    expect(await refusal(schemas.apply('lab', [bad({ name: 'x"; drop table y; --' })]))).toBe('invalid');
    expect(await refusal(schemas.apply('lab', [bad({ columns: [{ name: 'Id', type: 'uuid' }], primaryKey: ['Id'] })]))).toBe('invalid');
    expect(await refusal(schemas.apply('lab', [bad({ columns: [{ name: 'id', type: 'text; drop' as never }] })]))).toBe('invalid');
    expect(await refusal(schemas.apply('lab', [bad({ columns: [{ name: 'id', type: 'uuid' }, { name: 'created_at', type: 'text' }] })]))).toBe('invalid');
  });

  it('quotes reserved words used as names', async () => {
    const t: TableShape = { name: 'order', columns: [{ name: 'user', type: 'text' }, { name: 'select', type: 'integer' }], primaryKey: ['user'], indexes: [{ columns: ['select'] }] };
    await schemas.apply('lab', [t]);
    await db.withSchema('plugin_lab').insertInto('order').values({ user: 'u', select: 1 }).execute();
    expect(await db.withSchema('plugin_lab').selectFrom('order').select(['user', 'select']).execute()).toEqual([{ user: 'u', select: 1 }]);
  });

  it('refuses a corrupt recorded shape plainly', async () => {
    await schemas.apply('lab', [orders]);
    await db.withSchema('plugin_lab').updateTable(SHAPES_TABLE).set({ shape: JSON.stringify({ name: 'orders', columns: 'x' }) }).execute();
    expect(await refusal(schemas.plan('lab', [orders]))).toBe('invalid');
    await db.withSchema('plugin_lab').updateTable(SHAPES_TABLE).set({ shape: JSON.stringify({ ...orders, name: 'other' }) }).execute();
    expect(await refusal(schemas.plan('lab', [orders]))).toBe('invalid');
  });

  it('refuses a schema of the same name that CE did not make', async () => {
    await sql`create schema plugin_lab`.execute(db);
    await sql`create table plugin_lab.other (x text)`.execute(db);
    // pg-mem has an empty pg_namespace, so this case reads as "no shapes table". Real Postgres refuses
    // it from pg_namespace before CREATE SCHEMA; here CREATE SCHEMA itself fails.
    await expect(schemas.apply('lab', [orders])).rejects.toThrow();
  });
});

describe('column defaults', () => {
  const col = (type: string, d: unknown) => ({ name: 'c', type, default: d }) as never;
  const reason = (type: string, d: unknown): string | undefined => {
    try { columnDefault(col(type, d)); return undefined; } catch (e) { return (e as PluginShapeError).reason; }
  };

  it('takes a literal of the column type', () => {
    for (const [t, d] of [
      ['integer', -5], ['bigint', 9007199254740991], ['numeric', 1.5], ['boolean', false], ['text', "it's"],
      ['uuid', '6B9D0C1E-0F0A-4C39-9A55-1E2F3A4B5C6D'], ['date', '2026-02-28'], ['timestamptz', '2026-02-28T08:00:00Z'],
      ['jsonb', '{"a":[1,2]}'],
    ] as const) expect(reason(t, d)).toBeUndefined();
    expect(columnDefault(col('text', null))).toBeUndefined();
  });

  it('refuses a default of another type, a function call, a word Postgres reads as a value, or a backslash', () => {
    expect(reason('integer', 1.5)).toBe('default');
    expect(reason('integer', 2 ** 31)).toBe('default');
    expect(reason('bigint', 2 ** 60)).toBe('default');
    expect(reason('numeric', Infinity)).toBe('default');
    expect(reason('numeric', '1')).toBe('default');
    expect(reason('boolean', 'true')).toBe('default');
    expect(reason('text', 1)).toBe('default');
    expect(reason('uuid', 'gen_random_uuid()')).toBe('default');
    expect(reason('timestamptz', 'now()')).toBe('default');
    expect(reason('timestamptz', 'now')).toBe('default');
    expect(reason('date', 'today')).toBe('default');
    expect(reason('date', '2026-02-30')).toBe('default');
    expect(reason('jsonb', '{bad')).toBe('default');
    expect(reason('jsonb', '{"a":"\\"q"}')).toBe('default');
    expect(reason('text', 'a\\b')).toBe('default');
    expect(reason('text', 'x'.repeat(1001))).toBe('default');
  });

  it('a quote in a text default stays inside the literal', async () => {
    const db = newDb().adapters.createKysely() as Kysely<any>;
    const schemas = createPluginSchemas(db, PG_MEM_WITHOUT_RLS);
    const t: TableShape = { name: 't', columns: [{ name: 'id', type: 'integer' }, { name: 's', type: 'text', default: "x'); drop table t; --" }], primaryKey: ['id'] };
    await schemas.apply('lab', [t]);
    await db.withSchema('plugin_lab').insertInto('t').values({ id: 1 }).execute();
    expect((await db.withSchema('plugin_lab').selectFrom('t').select('s').execute())[0].s).toBe("x'); drop table t; --");
  });
});

describe('shape schema guards', () => {
  const base = { name: 't', columns: [{ name: 'id', type: 'integer' }, { name: 'a', type: 'text' }], primaryKey: ['id'] };
  it('caps indexes per table and columns per index, and refuses a repeated index column', () => {
    expect(tableShapeSchema.safeParse({ ...base, indexes: Array.from({ length: 21 }, () => ({ columns: ['a'] })) }).success).toBe(false);
    expect(tableShapeSchema.safeParse({ ...base, indexes: [{ columns: Array.from({ length: 33 }, () => 'a') }] }).success).toBe(false);
    expect(tableShapeSchema.safeParse({ ...base, indexes: [{ columns: ['a', 'a'] }] }).success).toBe(false);
    expect(tableShapeSchema.safeParse({ ...base, indexes: [{ columns: ['a', 'id'] }] }).success).toBe(true);
  });
  it('refuses a fractional integer or bigint default', () => {
    expect(tableShapeSchema.safeParse({ ...base, columns: [{ name: 'id', type: 'integer', default: 1.5 }] }).success).toBe(false);
    expect(tableShapeSchema.safeParse({ ...base, columns: [{ name: 'id', type: 'bigint', default: 1.5 }] }).success).toBe(false);
    expect(tableShapeSchema.safeParse({ ...base, columns: [{ name: 'id', type: 'integer', default: 2 }] }).success).toBe(true);
  });
});
