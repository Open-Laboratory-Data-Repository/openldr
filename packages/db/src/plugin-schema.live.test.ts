import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createPluginSchemas, FACILITY_POLICY, PluginShapeError, SHAPES_TABLE, type PluginSchemas } from './plugin-schema';
import type { TableShape } from './plugin-table-shape';

// Row-level security, DROP SCHEMA and DDL rollback, which pg-mem cannot run. Run with
// PLUGIN_SCHEMA_TEST_DATABASE_URL pointing at a disposable database.
const url = process.env.PLUGIN_SCHEMA_TEST_DATABASE_URL;

const samples: TableShape = {
  name: 'samples',
  columns: [
    { name: 'id', type: 'uuid' },
    { name: 'facility', type: 'uuid' },
    { name: 'code', type: 'text' },
  ],
  primaryKey: ['id'],
  facilityColumn: 'facility',
};
const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!url)('plugin schemas on disposable PostgreSQL', () => {
  let pool: pg.Pool;
  let db: Kysely<any>;
  let schemas: PluginSchemas;
  let pluginId: string;
  let schema: string;
  let role: string | null;

  beforeEach(() => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    schemas = createPluginSchemas(db);
    pluginId = `test.plugin-${randomUUID().slice(0, 8)}`;
    schema = schemas.schemaName(pluginId);
    role = null;
  });

  afterEach(async () => {
    await sql`drop schema if exists ${sql.id(schema)} cascade`.execute(db);
    if (role) await sql`drop role if exists ${sql.id(role)}`.execute(db);
    await db.destroy();
  });

  /** Run `fn` as a login that owns the table and does not bypass row-level security. A superuser
   *  always bypasses it, so as a superuser this makes such a role and hands it the schema. */
  async function asOwner<T>(fn: (trx: Kysely<any>) => Promise<T>, facilities: string): Promise<T> {
    const me = await sql<{ s: boolean }>`select rolsuper or rolbypassrls as s from pg_roles where rolname = current_user`.execute(db);
    if (me.rows[0].s && !role) {
      role = `plugin_rls_${randomUUID().slice(0, 8)}`;
      await sql`create role ${sql.id(role)} nologin`.execute(db);
      await sql`alter schema ${sql.id(schema)} owner to ${sql.id(role)}`.execute(db);
      await sql`alter table ${sql.id(schema, 'samples')} owner to ${sql.id(role)}`.execute(db);
    }
    return db.transaction().execute(async (trx) => {
      if (role) await sql`set local role ${sql.id(role)}`.execute(trx);
      await sql`select set_config('openldr.facilities', ${facilities}, true)`.execute(trx);
      return fn(trx);
    });
  }

  it('a facility table has forced row-level security and its policy', async () => {
    await schemas.apply(pluginId, [samples]);
    const flags = await sql<{ r: boolean; f: boolean }>`
      select c.relrowsecurity as r, c.relforcerowsecurity as f
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${schema} and c.relname = 'samples'`.execute(db);
    expect(flags.rows).toEqual([{ r: true, f: true }]);
    const policies = await sql<{ policyname: string; qual: string; with_check: string }>`
      select policyname, qual, with_check from pg_policies where schemaname = ${schema} and tablename = 'samples'`.execute(db);
    expect(policies.rows.map((p) => p.policyname)).toEqual([FACILITY_POLICY]);
    expect(policies.rows[0].qual).toContain('current_setting');
    expect(policies.rows[0].with_check).toContain('current_setting');
    const notNull = await sql<{ n: string }>`
      select is_nullable as n from information_schema.columns
      where table_schema = ${schema} and table_name = 'samples' and column_name = 'facility'`.execute(db);
    expect(notNull.rows).toEqual([{ n: 'NO' }]);
  });

  it('the policy shows only the set facilities, and * shows all, even to the table owner', async () => {
    await schemas.apply(pluginId, [samples]);
    await asOwner((trx) => trx.withSchema(schema).insertInto('samples').values([
      { id: randomUUID(), facility: F1, code: 'a' }, { id: randomUUID(), facility: F2, code: 'b' },
    ]).execute(), '*');
    const codes = (facilities: string) => asOwner(async (trx) => (await trx.withSchema(schema).selectFrom('samples').select('code').orderBy('code').execute()).map((r) => r.code), facilities);
    expect(await codes('*')).toEqual(['a', 'b']);
    expect(await codes(F1)).toEqual(['a']);
    expect(await codes(`${F1},${F2}`)).toEqual(['a', 'b']);
    expect(await codes('')).toEqual([]);
    await expect(asOwner((trx) => trx.withSchema(schema).insertInto('samples').values({ id: randomUUID(), facility: F2, code: 'c' }).execute(), F1))
      .rejects.toThrow(/row-level security/);
  });

  it('a failed step rolls the whole apply back', async () => {
    const t: TableShape = { name: 'codes', columns: [{ name: 'id', type: 'integer' }, { name: 'code', type: 'text' }], primaryKey: ['id'] };
    await schemas.apply(pluginId, [t]);
    await db.withSchema(schema).insertInto('codes').values([{ id: 1, code: 'x' }, { id: 2, code: 'x' }]).execute();
    const t2: TableShape = { ...t, columns: [...t.columns, { name: 'note', type: 'text' }], indexes: [{ columns: ['code'], unique: true }] };
    await expect(schemas.apply(pluginId, [t2])).rejects.toThrow();
    const cols = await sql<{ c: string }>`select column_name as c from information_schema.columns where table_schema = ${schema} and table_name = 'codes' order by 1`.execute(db);
    expect(cols.rows.map((r) => r.c)).toEqual(['code', 'created_at', 'id', 'updated_at']);
    const recorded = await db.withSchema(schema).selectFrom(SHAPES_TABLE).select('shape').execute();
    expect(recorded[0].shape).toEqual(t);
  });

  it('refuses a schema of the same name that CE did not make', async () => {
    await sql`create schema ${sql.id(schema)}`.execute(db);
    await expect(schemas.apply(pluginId, [samples])).rejects.toSatisfy((e) => e instanceof PluginShapeError && e.reason === 'name');
  });

  it('drop removes the schema', async () => {
    await schemas.apply(pluginId, [samples]);
    await schemas.drop(pluginId);
    const ns = await sql`select 1 from pg_namespace where nspname = ${schema}`.execute(db);
    expect(ns.rows).toEqual([]);
    await schemas.drop(pluginId);
  });
});
