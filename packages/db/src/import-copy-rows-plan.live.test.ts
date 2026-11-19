import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from './schema/internal';
import * as copyRows from './migrations/internal/118_import_copy_rows';
import * as keyEstimate from './migrations/internal/134_import_copy_rows_key_estimate';
import { createImportCopyStore } from './import-copy-store';

// 2026-11-19, full Tanzania copy on a fresh demo.9 standalone. At 51% (1.2 million keys, 37 million
// rows) ANALYZE estimated 39,200 distinct keys. Postgres then expected about 880 rows a key, and the
// delete `replaceKeys` runs before each page of 2,000 keys planned a sequential scan of the whole
// table. Each page scanned all stored rows, and the copy fell from about 120,000 keys a minute to
// under 20,000.
//
// A small table does not fool ANALYZE the same way, so this test sets the estimate the live table had
// (about 1,000 rows a key) by hand, shows the delete then scans the table, and shows migration 134
// brings back the index. Only real PostgreSQL plans; pg-mem cannot show this. Run with
// IMPORT_COPY_PLAN_TEST_DATABASE_URL pointing at a disposable database.
const url = process.env.IMPORT_COPY_PLAN_TEST_DATABASE_URL;
const KEYS = 100_000;
const ROWS_A_KEY = 20;

describe.skipIf(!url)('the delete before each copied page, on disposable PostgreSQL', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: Kysely<InternalSchema>;
  let schema: string;

  beforeEach(async () => {
    schema = `copy_plan_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool }) });
    await copyRows.up(db as Kysely<unknown>);
    // Rows of one key lie together, as the copy writes them.
    await sql`insert into import_copy_rows (copy_id, set_name, detail_name, key, seq, row)
      select 'c1', 'requests', 'd', 'K' || lpad(k::text, 9, '0'), s, '{}'::jsonb
      from generate_series(1, ${KEYS}) k, generate_series(0, ${ROWS_A_KEY - 1}) s
      order by k, s`.execute(db);
  }, 120_000);

  afterEach(async () => {
    await db.destroy();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });

  /** The plan of the delete `replaceKeys` runs, for one page of 2,000 keys. */
  async function deletePlan(): Promise<string> {
    const keys = Array.from({ length: 2000 }, (_, i) => `K${String(i * 37 + 1).padStart(9, '0')}`);
    const compiled = db.deleteFrom('import_copy_rows')
      .where('copy_id', '=', 'c1').where('set_name', '=', 'requests').where('key', 'in', keys)
      .compile();
    const res = await pool.query(`explain ${compiled.sql}`, compiled.parameters as unknown[]);
    return res.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
  }

  it('scans the whole table with the live estimate, and uses the index after migration 134', async () => {
    // The live table's estimate: 37 million rows over 39,200 keys, about 1,000 rows a key.
    await sql.raw(`alter table import_copy_rows alter column key set (n_distinct = ${(KEYS * ROWS_A_KEY) / 1000})`).execute(db);
    await sql`analyze import_copy_rows`.execute(db);
    expect(await deletePlan()).toMatch(/Seq Scan on import_copy_rows/);

    await keyEstimate.up(db as Kysely<unknown>);
    const plan = await deletePlan();
    // An index scan or a bitmap scan of the primary key both read only the page's rows. The live
    // table chose the first, this smaller one the second.
    expect(plan).toMatch(/Index Scan (using|on) import_copy_rows_pk/);
    expect(plan).not.toMatch(/Seq Scan/);
  }, 120_000);

  it('replaceKeys still swaps a page of rows after migration 134', async () => {
    await keyEstimate.up(db as Kysely<unknown>);
    const store = createImportCopyStore(db);
    const keys = ['K000000001', 'K000000002'];
    await store.replaceKeys('c1', 'requests', keys, [
      { key: 'K000000001', detail: 'd', seq: 0, row: { a: 1 } },
      { key: 'K000000002', detail: 'd', seq: 0, row: { a: 2 } },
    ]);
    const left = await sql<{ n: number }>`select count(*)::int as n from import_copy_rows where key in ('K000000001', 'K000000002')`.execute(db);
    expect(left.rows[0]!.n).toBe(2);
    const total = await sql<{ n: number }>`select count(*)::int as n from import_copy_rows`.execute(db);
    expect(total.rows[0]!.n).toBe(KEYS * ROWS_A_KEY - 2 * ROWS_A_KEY + 2);
  }, 120_000);

  it('down() puts back the estimate ANALYZE makes', async () => {
    await keyEstimate.up(db as Kysely<unknown>);
    await keyEstimate.down(db as Kysely<unknown>);
    const opts = await sql<{ o: string[] | null }>`select attoptions as o from pg_attribute
      where attrelid = 'import_copy_rows'::regclass and attname = 'key'`.execute(db);
    expect(opts.rows[0]!.o).toBeNull();
  }, 120_000);
});
