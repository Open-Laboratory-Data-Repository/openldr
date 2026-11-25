import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createPluginSchemas, PLUGIN_DATA_ROLE } from './plugin-schema';
import { up as migrate145, down as unmigrate145 } from './migrations/internal/145_plugin_data_role';
import type { TableShape } from './plugin-table-shape';

// The plugin data role (design 2026-11-25-plugin-data-rls-role): roles, grants and SET ROLE, which
// pg-mem cannot run. Run with PLUGIN_ROLE_TEST_DATABASE_URL pointing at a disposable database whose
// login is a superuser. Roles belong to the whole server: these tests make and drop
// openldr_plugin_data, so never point this at a server whose databases already use it.
const url = process.env.PLUGIN_ROLE_TEST_DATABASE_URL;

const samples: TableShape = {
  name: 'samples',
  columns: [{ name: 'id', type: 'uuid' }, { name: 'facility', type: 'uuid' }, { name: 'code', type: 'text' }],
  primaryKey: ['id'],
  facilityColumn: 'facility',
};

describe.skipIf(!url)('the plugin data role on disposable PostgreSQL', () => {
  let pool: pg.Pool;
  let db: Kysely<any>;
  const made: string[] = [];
  const extraRoles: string[] = [];

  async function roleExists(): Promise<boolean> {
    const r = await sql<{ n: number }>`select count(*)::int as n from pg_roles where rolname = ${PLUGIN_DATA_ROLE}`.execute(db);
    return r.rows[0].n === 1;
  }

  async function dropRole(): Promise<void> {
    if (!(await roleExists())) return;
    await sql`drop owned by ${sql.id(PLUGIN_DATA_ROLE)}`.execute(db);
    await sql`drop role ${sql.id(PLUGIN_DATA_ROLE)}`.execute(db);
  }

  async function privileges(schema: string): Promise<{ usage: boolean; select: boolean; insert: boolean }> {
    const r = await sql<{ usage: boolean; sel: boolean; ins: boolean }>`
      select has_schema_privilege(${PLUGIN_DATA_ROLE}, ${schema}, 'USAGE') as usage,
             has_table_privilege(${PLUGIN_DATA_ROLE}, ${`"${schema}".samples`}, 'SELECT') as sel,
             has_table_privilege(${PLUGIN_DATA_ROLE}, ${`"${schema}".samples`}, 'INSERT') as ins`.execute(db);
    return { usage: r.rows[0].usage, select: r.rows[0].sel, insert: r.rows[0].ins };
  }

  async function pluginSchema(): Promise<string> {
    const schemas = createPluginSchemas(db);
    const id = `test.role-${randomUUID().slice(0, 8)}`;
    await schemas.apply(id, [samples]);
    const schema = schemas.schemaName(id);
    made.push(schema);
    return schema;
  }

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    // These tests drop openldr_plugin_data, which belongs to the whole server. Refuse to run where
    // another database on the server uses it (the dev install, say), so they never take it away.
    const used = await sql<{ n: number }>`
      select count(*)::int as n from pg_shdepend d join pg_database x on x.oid = d.dbid
      where d.refobjid = (select oid from pg_roles where rolname = 'openldr_plugin_data') and x.datname <> current_database()`.execute(db);
    if (used.rows[0].n > 0) throw new Error('openldr_plugin_data is used by another database on this server: run these tests on a server of their own');
    await dropRole();
  });

  afterEach(async () => {
    for (const s of made.splice(0)) await sql`drop schema if exists ${sql.id(s)} cascade`.execute(db);
    await dropRole();
    for (const r of extraRoles.splice(0)) await sql`drop role if exists ${sql.id(r)}`.execute(db);
    await db.destroy();
  });

  it('migration 145 makes the role and grants an existing plugin schema', async () => {
    const schema = await pluginSchema();
    expect(await roleExists()).toBe(false);
    await migrate145(db);
    expect(await roleExists()).toBe(true);
    expect(await privileges(schema)).toEqual({ usage: true, select: true, insert: true });
    const flags = await sql<{ s: boolean; b: boolean; l: boolean }>`
      select rolsuper as s, rolbypassrls as b, rolcanlogin as l from pg_roles where rolname = ${PLUGIN_DATA_ROLE}`.execute(db);
    expect(flags.rows[0]).toEqual({ s: false, b: false, l: false });
  });

  it('migration 145 run twice changes nothing more', async () => {
    const schema = await pluginSchema();
    await migrate145(db);
    await migrate145(db);
    expect(await privileges(schema)).toEqual({ usage: true, select: true, insert: true });
  });

  it('apply grants a new schema and table to the role', async () => {
    await migrate145(db);
    const schema = await pluginSchema();
    expect(await privileges(schema)).toEqual({ usage: true, select: true, insert: true });
  });

  it('a login that cannot create roles: migration 145 skips and changes nothing', async () => {
    const weak = `rls_weak_${randomUUID().slice(0, 8)}`;
    extraRoles.push(weak);
    await sql`create role ${sql.id(weak)} nologin`.execute(db);
    await db.transaction().execute(async (trx) => {
      await sql`set local role ${sql.id(weak)}`.execute(trx);
      await migrate145(trx);
    });
    expect(await roleExists()).toBe(false);
  });

  it('a CREATEROLE login meeting a role another login made: migration 145 skips, it does not fail (review)', async () => {
    await migrate145(db);
    const weak = `rls_cr_${randomUUID().slice(0, 8)}`;
    extraRoles.push(weak);
    await sql`create role ${sql.id(weak)} nologin createrole`.execute(db);
    await db.transaction().execute(async (trx) => {
      await sql`set local role ${sql.id(weak)}`.execute(trx);
      await migrate145(trx);
    });
    expect(await roleExists()).toBe(true);
  });

  it('migration 145 down leaves the role when another database on the server uses it (R5)', async () => {
    await migrate145(db);
    const other = `rls_other_${randomUUID().slice(0, 8)}`;
    await sql`create database ${sql.id(other)}`.execute(db);
    const u = new URL(url!);
    u.pathname = `/${other}`;
    const otherPool = new pg.Pool({ connectionString: u.toString(), max: 1 });
    const otherDb = new Kysely<any>({ dialect: new PostgresDialect({ pool: otherPool }) });
    try {
      await sql`create schema held`.execute(otherDb);
      await sql`grant usage on schema held to ${sql.id(PLUGIN_DATA_ROLE)}`.execute(otherDb);
      // As the migrator runs it: inside a transaction, which a failed DROP ROLE would abort.
      await db.transaction().execute(async (trx) => { await unmigrate145(trx); });
      expect(await roleExists()).toBe(true);
    } finally {
      await otherDb.destroy();
      await sql`drop database ${sql.id(other)}`.execute(db);
    }
    await db.transaction().execute(async (trx) => { await unmigrate145(trx); });
    expect(await roleExists()).toBe(false);
  });
});
