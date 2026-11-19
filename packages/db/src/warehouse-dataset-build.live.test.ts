import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createMigrator } from './migrator';
import { externalMigrations } from './migrations/external/index';
import { buildWarehouseDataset, dropWarehouseDataset } from './warehouse-dataset-build';

// Pack datasets: a dataset is built as a real warehouse table with `create table as`, then swapped
// in for the old one. pg-mem runs neither, so the build is proved here on real PostgreSQL.
// FHIR_SAVE_TEST_DATABASE_URL points at a server's maintenance database, as for
// relational-writer.live.test.ts.
const url = process.env.FHIR_SAVE_TEST_DATABASE_URL;

describe.skipIf(!url)('building a pack dataset in the warehouse, on real PostgreSQL', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: Kysely<any>;
  const dbName = `dataset_build_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: target.toString(), max: 6 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    const r = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    if (r.error) throw r.error;
    for (const [id, surname] of [['p1', 'Able'], ['p2', 'Baker'], ['p3', 'Cole']]) await db.insertInto('patients').values({ id, surname }).execute();
  });

  afterAll(async () => {
    await db?.destroy();
    await admin?.query(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  });

  const count = async (table: string) => Number((await sql<{ n: string }>`select count(*) as n from ${sql.id('dataset', table)}`.execute(db)).rows[0].n);
  const tables = async () => (await sql<{ t: string }>`select tablename as t from pg_tables where schemaname = 'dataset' order by 1`.execute(db)).rows.map((r) => r.t);
  const indexes = async (table: string) => (await sql<{ d: string }>`select indexdef as d from pg_indexes where schemaname = 'dataset' and tablename = ${table} order by 1`.execute(db)).rows.map((r) => r.d);

  it('builds_a_table_with_the_selects_rows_and_its_indexes', async () => {
    const out = await buildWarehouseDataset(db, { name: 'abc', sql: 'select id, surname from patients', indexes: [['surname'], ['id', 'surname']] });
    expect(out.rows).toBe(3);
    expect(await count('abc')).toBe(3);
    const idx = await indexes('abc');
    expect(idx).toHaveLength(2);
    expect(idx.join(' ')).toMatch(/abc__idx0.*\(surname\)/);
    expect(idx.join(' ')).toMatch(/abc__idx1.*\(id, surname\)/);
    expect(await tables()).toEqual(['abc']);
  });

  it('a_rebuild_replaces_the_rows_and_keeps_the_index_names', async () => {
    await db.insertInto('patients').values({ id: 'p4', surname: 'Dunn' }).execute();
    expect((await buildWarehouseDataset(db, { name: 'abc', sql: 'select id, surname from patients;  ', indexes: [['surname']] })).rows).toBe(4);
    expect(await count('abc')).toBe(4);
    expect(await tables()).toEqual(['abc']);
    expect((await indexes('abc')).join(' ')).toMatch(/abc__idx0/);
  });

  it('a_failed_build_keeps_the_old_table', async () => {
    await expect(buildWarehouseDataset(db, { name: 'abc', sql: 'select id from no_such_table' })).rejects.toThrow(/no_such_table/);
    expect(await count('abc')).toBe(4);
    expect(await tables()).toEqual(['abc']);
  });

  it('an_index_on_a_missing_column_fails_and_keeps_the_old_table', async () => {
    await expect(buildWarehouseDataset(db, { name: 'abc', sql: 'select id from patients', indexes: [['nope']] })).rejects.toThrow(/nope/);
    expect(await count('abc')).toBe(4);
    expect(await tables()).toEqual(['abc']);
    // The old table still has its own columns: the failed build's shape never replaced it.
    expect((await sql<{ surname: string }>`select surname from dataset.abc where id = 'p1'`.execute(db)).rows[0].surname).toBe('Able');
  });

  it('two_builds_at_once_both_finish_and_leave_one_table', async () => {
    const [a, b] = await Promise.all([
      buildWarehouseDataset(db, { name: 'abc', sql: 'select id, surname from patients' }),
      buildWarehouseDataset(db, { name: 'abc', sql: 'select id, surname from patients' }),
    ]);
    expect([a.rows, b.rows]).toEqual([4, 4]);
    expect(await tables()).toEqual(['abc']);
  });

  it('a_dataset_can_read_a_dataset_built_before_it', async () => {
    expect((await buildWarehouseDataset(db, { name: 'abd', sql: "select surname from dataset.abc where surname > 'B'" })).rows).toBe(3);
  });

  it('a_select_that_starts_with_with_builds', async () => {
    expect((await buildWarehouseDataset(db, { name: 'abe', sql: 'with x as (select id from patients) select count(*) as n from x' })).rows).toBe(1);
  });

  it('refuses_a_name_that_is_not_plain_before_running_anything', async () => {
    for (const name of ['x; drop', 'Abc', 'ab', 'public.abc', 'abc__new', 'a__b']) {
      await expect(buildWarehouseDataset(db, { name, sql: 'select 1 as a' })).rejects.toThrow(/dataset name/);
    }
    expect(await tables()).toEqual(['abc', 'abd', 'abe']);
  });

  // The guards a report's SQL gets, which the keyword check alone does not give (review finding 1).
  it('a_select_that_writes_through_a_function_is_refused_and_writes_nothing', async () => {
    await sql`create sequence if not exists guard_seq`.execute(db);
    await sql`select setval('guard_seq', 5)`.execute(db);
    await expect(buildWarehouseDataset(db, { name: 'writer', sql: "select setval('guard_seq', 99) as v" })).rejects.toThrow(/read-only/);
    expect(Number((await sql<{ v: string }>`select last_value as v from guard_seq`.execute(db)).rows[0].v)).toBe(5);
    expect(await tables()).not.toContain('writer');
  });

  it('text_after_a_semicolon_is_an_error_and_never_a_second_statement', async () => {
    await expect(buildWarehouseDataset(db, { name: 'twice', sql: 'select 1 as a; create table public.evil (x int)' })).rejects.toThrow();
    expect((await sql<{ n: string }>`select count(*) as n from pg_tables where schemaname = 'public' and tablename = 'evil'`.execute(db)).rows[0].n).toBe('0');
    expect(await tables()).not.toContain('twice');
  });

  it('a_comment_at_the_end_of_the_select_does_not_swallow_the_build', async () => {
    expect((await buildWarehouseDataset(db, { name: 'commented', sql: 'select id from patients -- all of them' })).rows).toBe(4);
    await dropWarehouseDataset(db, 'commented');
  });

  it('a_select_that_runs_past_the_time_limit_is_stopped_and_the_next_build_works', async () => {
    await expect(buildWarehouseDataset(db, { name: 'sleeper', sql: 'select 1 as v from (select pg_sleep(5)) as zzz' }, { timeoutMs: 300 })).rejects.toThrow(/statement timeout/);
    expect((await buildWarehouseDataset(db, { name: 'sleeper', sql: 'select 1 as v' })).rows).toBe(1);
    await dropWarehouseDataset(db, 'sleeper');
  });

  it('what_the_select_sets_or_locks_does_not_reach_the_next_user_of_the_connection', async () => {
    // One connection, so the next statement is certain to run on the one the build used.
    const single = new pg.Pool({ connectionString: (pool as unknown as { options: { connectionString: string } }).options.connectionString, max: 1 });
    const one = new Kysely<any>({ dialect: new PostgresDialect({ pool: single }) });
    try {
      await buildWarehouseDataset(one, { name: 'setter', sql: "select set_config('application_name', 'left-behind', false) as v, pg_try_advisory_lock(424242) as l" });
      expect((await sql<{ v: string }>`select current_setting('application_name') as v`.execute(one)).rows[0].v).not.toBe('left-behind');
      expect((await sql<{ v: string }>`select current_setting('statement_timeout') as v`.execute(one)).rows[0].v).toBe('0');
      expect((await sql<{ n: string }>`select count(*) as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`.execute(one)).rows[0].n).toBe('0');
      await dropWarehouseDataset(one, 'setter');
    } finally {
      await one.destroy();
    }
  });

  it('drops_a_dataset_and_dropping_a_missing_one_is_fine', async () => {
    await dropWarehouseDataset(db, 'abe');
    await dropWarehouseDataset(db, 'abe');
    expect(await tables()).toEqual(['abc', 'abd']);
  });
});
