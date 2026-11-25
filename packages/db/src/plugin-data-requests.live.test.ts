import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createPluginSchemas } from './plugin-schema';
import { createPluginRequests, type PluginCaller } from './plugin-data-requests';
import type { TableShape } from './plugin-table-shape';

// The row-level security policy under CE's own requests, the 5 s timeout, rollback and LIKE
// escaping, which pg-mem cannot run. Run with PLUGIN_DATA_TEST_DATABASE_URL pointing at a
// disposable database, as a login that may create roles.
const url = process.env.PLUGIN_DATA_TEST_DATABASE_URL;

const samples: TableShape = {
  name: 'samples',
  columns: [{ name: 'id', type: 'integer' }, { name: 'facility', type: 'uuid' }, { name: 'code', type: 'text' }],
  primaryKey: ['id'],
  facilityColumn: 'facility',
};
const shapes = [samples];
const F1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const F2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const all: PluginCaller = { userId: 'u0', displayName: null, capabilities: [], facilities: '*' };
const site1: PluginCaller = { userId: 'u1', displayName: null, capabilities: [], facilities: [F1.toUpperCase()] };

describe.skipIf(!url)('plugin data requests on disposable PostgreSQL', () => {
  let pool: pg.Pool;
  let db: Kysely<any>;
  let pluginId: string;
  let schema: string;
  let role: string | null;
  let owner: Kysely<any> | null;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    pluginId = `test.data-${randomUUID().slice(0, 8)}`;
    const schemas = createPluginSchemas(db);
    schema = schemas.schemaName(pluginId);
    role = null;
    owner = null;
    await schemas.apply(pluginId, shapes);
    await createPluginRequests(db).write(pluginId, shapes, all, { steps: [
      { op: 'insert', table: 'samples', values: { id: 1, facility: F1, code: 'a_b' } },
      { op: 'insert', table: 'samples', values: { id: 2, facility: F1, code: 'axb' } },
      { op: 'insert', table: 'samples', values: { id: 3, facility: F2, code: 'a_c' } },
    ] });
  });

  afterEach(async () => {
    if (owner) await owner.destroy();
    await sql`drop schema if exists ${sql.id(schema)} cascade`.execute(db);
    if (role) await sql`drop role if exists ${sql.id(role)}`.execute(db);
    await db.destroy();
  });

  /** A login that owns the schema and does not bypass row-level security, so FORCE applies. */
  async function asOwner(): Promise<Kysely<any>> {
    role = `plugin_rls_${randomUUID().slice(0, 8)}`;
    const password = randomUUID();
    await sql`create role ${sql.id(role)} login nosuperuser nobypassrls password ${sql.lit(password)}`.execute(db);
    await sql`alter schema ${sql.id(schema)} owner to ${sql.id(role)}`.execute(db);
    await sql`alter table ${sql.id(schema, 'samples')} owner to ${sql.id(role)}`.execute(db);
    await sql`alter table ${sql.id(schema, '_openldr_shapes')} owner to ${sql.id(role)}`.execute(db);
    const u = new URL(url!);
    u.username = role;
    u.password = password;
    owner = new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: u.toString(), max: 2 }) }) });
    return owner;
  }

  const ids = async (k: Kysely<any>, caller: PluginCaller) =>
    (await createPluginRequests(k).select(pluginId, shapes, caller, { table: 'samples', columns: ['id'] })).rows.map((r) => r.id);

  it('on a login that bypasses row-level security, the CE filter alone limits the rows', async () => {
    expect(await ids(db, site1)).toEqual([1, 2]);
    expect(await ids(db, all)).toEqual([1, 2, 3]);
  });

  it('under the policy, the setting CE writes shows the caller\'s rows, even for an uppercase id', async () => {
    const k = await asOwner();
    const flags = await sql<{ f: boolean }>`select relforcerowsecurity as f from pg_class where oid = ${`${schema}.samples`}::regclass`.execute(db);
    expect(flags.rows).toEqual([{ f: true }]);
    expect(await ids(k, site1)).toEqual([1, 2]);
    expect(await ids(k, all)).toEqual([1, 2, 3]);
    expect(await ids(k, { ...site1, facilities: [] })).toEqual([]);
    const req = createPluginRequests(k);
    const r = await req.write(pluginId, shapes, site1, { steps: [{ op: 'insert', table: 'samples', values: { id: 4, facility: F1.toUpperCase(), code: 'd' } }] });
    expect(r.results).toEqual([{ rowCount: 1 }]);
    expect(await ids(k, site1)).toEqual([1, 2, 4]);
  });

  it('an insert for another facility is refused on the live database', async () => {
    await expect(createPluginRequests(db).write(pluginId, shapes, site1, { steps: [
      { op: 'insert', table: 'samples', values: { id: 9, facility: F2, code: 'x' } },
    ] })).rejects.toThrow(/outside the caller's facilities/);
    expect(await ids(db, all)).toEqual([1, 2, 3]);
  });

  it('a failed step rolls the whole write back', async () => {
    await expect(createPluginRequests(db).write(pluginId, shapes, all, { steps: [
      { op: 'insert', table: 'samples', values: { id: 5, facility: F1, code: 'new' } },
      { op: 'update', table: 'samples', key: { id: 1 }, set: { code: 'changed' } },
      { op: 'delete', table: 'samples', key: { id: 2 } },
      { op: 'insert', table: 'samples', values: { id: 3, facility: F1, code: 'duplicate' } },
    ] })).rejects.toThrow();
    const rows = await db.withSchema(schema).selectFrom('samples').select(['id', 'code']).orderBy('id').execute();
    expect(rows).toEqual([{ id: 1, code: 'a_b' }, { id: 2, code: 'axb' }, { id: 3, code: 'a_c' }]);
  });

  // Design 2026-11-25-plugin-conditional-write: a conditional step that waits on a row another
  // writer is changing sees the committed row, matches nothing, and the request saves nothing.
  it('a conditional update loses to a change committed first, and saves nothing', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query(`update "${schema}".samples set code = 'theirs' where id = 1`);
      let settled = false;
      const write = createPluginRequests(db).write(pluginId, shapes, all, { steps: [
        { op: 'insert', table: 'samples', values: { id: 4, facility: F1, code: 'new' } },
        { op: 'update', table: 'samples', key: { id: 1 }, set: { code: 'mine' }, where: [{ column: 'code', op: 'eq', value: 'a_b' }], expect: 1 },
      ] }).then(() => null, (e: unknown) => e).finally(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await holder.query('commit');
      const err = await write;
      expect((err as { reason?: string } | null)?.reason).toBe('conflict');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    const rows = await db.withSchema(schema).selectFrom('samples').select(['id', 'code']).orderBy('id').execute();
    expect(rows).toEqual([{ id: 1, code: 'theirs' }, { id: 2, code: 'axb' }, { id: 3, code: 'a_c' }]);
  });

  it('a prefix matches only itself: _ and % are not wildcards', async () => {
    const r = await createPluginRequests(db).select(pluginId, shapes, all, { table: 'samples', columns: ['id'], where: [{ column: 'code', op: 'prefix', value: 'a_' }] });
    expect(r.rows.map((x) => x.id)).toEqual([1, 3]);
  });

  it('a request that waits longer than 5 s is stopped by the statement timeout', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query(`lock table "${schema}"."samples" in access exclusive mode`);
      const started = Date.now();
      await expect(createPluginRequests(db).select(pluginId, shapes, all, { table: 'samples' })).rejects.toThrow(/statement timeout/);
      const took = Date.now() - started;
      expect(took).toBeGreaterThanOrEqual(4500);
      expect(took).toBeLessThan(15000);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
  }, 30000);
});
