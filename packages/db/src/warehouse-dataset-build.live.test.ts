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
    expect(idx.join(' ')).toMatch(/abc_0_idx.*\(surname\)/);
    expect(idx.join(' ')).toMatch(/abc_1_idx.*\(id, surname\)/);
    expect(await tables()).toEqual(['abc']);
  });

  it('a_rebuild_replaces_the_rows_and_keeps_the_index_names', async () => {
    await db.insertInto('patients').values({ id: 'p4', surname: 'Dunn' }).execute();
    expect((await buildWarehouseDataset(db, { name: 'abc', sql: 'select id, surname from patients;  ', indexes: [['surname']] })).rows).toBe(4);
    expect(await count('abc')).toBe(4);
    expect(await tables()).toEqual(['abc']);
    expect((await indexes('abc')).join(' ')).toMatch(/abc_0_idx/);
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
    for (const name of ['x; drop', 'Abc', 'ab', 'public.abc']) {
      await expect(buildWarehouseDataset(db, { name, sql: 'select 1 as a' })).rejects.toThrow(/dataset name/);
    }
    expect(await tables()).toEqual(['abc', 'abd', 'abe']);
  });

  it('drops_a_dataset_and_dropping_a_missing_one_is_fine', async () => {
    await dropWarehouseDataset(db, 'abe');
    await dropWarehouseDataset(db, 'abe');
    expect(await tables()).toEqual(['abc', 'abd']);
  });
});
