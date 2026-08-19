import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb, makeMigratedExternalDbWithMem } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m017 from './017_diagnostic_report_based_on_and_lab_results_index';

// 016_ingest_events.test.ts, the file this test was first modelled on, has no database harness.
// It only checks dialect-width arithmetic. That does not fit an assertion about a real migrated
// table, so the checks below use two different harnesses instead.
//
// The nullable-column check follows 013/014's own harness: makeMigratedExternalDb, a round-trip
// insert/select on pg-mem. The index checks need pg-mem's own JS-level table.listIndices(), not
// SQL: pg-mem has no `pg_indexes` view (measured, throws "relation does not exist"), and its
// `information_schema.columns.is_nullable` is unreliable (measured: a plain nullable column
// reports 'NO'). makeMigratedExternalDbWithMem hands back the pg-mem instance for that.
describe('017_diagnostic_report_based_on_and_lab_results_index', () => {
  it('adds based_on_id as nullable: a report with no basedOn still inserts', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into diagnostic_reports (id) values ('dr-no-based-on')`.execute(db);
    const rows = await sql<{ based_on_id: string | null }>`
      select based_on_id from diagnostic_reports where id = 'dr-no-based-on'`.execute(db);
    expect(rows.rows).toEqual([{ based_on_id: null }]);
  });

  it('creates both required indexes after up', async () => {
    const { mem } = await makeMigratedExternalDbWithMem();
    const reportIndexNames = mem.public.getTable('diagnostic_reports').listIndices().map((idx) => idx.name);
    expect(reportIndexNames).toContain('diagnostic_reports_based_on_idx');
    const resultIndexNames = mem.public.getTable('lab_results').listIndices().map((idx) => idx.name);
    expect(resultIndexNames).toContain('lab_results_request_idx');
  });

  it('down() drops the column and both indexes', async () => {
    const { mem, db } = await makeMigratedExternalDbWithMem();

    await m017.down(db, 'postgres');

    const reportIndexNames = mem.public.getTable('diagnostic_reports').listIndices().map((idx) => idx.name);
    expect(reportIndexNames).not.toContain('diagnostic_reports_based_on_idx');
    const resultIndexNames = mem.public.getTable('lab_results').listIndices().map((idx) => idx.name);
    expect(resultIndexNames).not.toContain('lab_results_request_idx');

    // The column itself is gone, not just the index: selecting it now fails.
    await expect(sql`select based_on_id from diagnostic_reports`.execute(db)).rejects.toThrow();
  });

  // pg-mem only emulates Postgres, so the tests above cannot see whether down() calls .on() for
  // MySQL and MSSQL where it is required, or whether up() picks the right widening call
  // (modifyColumn vs alterColumn) for each. Both are asserted here against the real dialect
  // compilers instead, offline: see compile-test-helpers.ts.
  it('down() calls dropIndex().on() for MySQL and MSSQL, and omits it for Postgres', async () => {
    const mysqlSql = await collectCompiledSql('mysql', (db) => m017.down(db, 'mysql'));
    expect(mysqlSql).toEqual([
      'drop index `lab_results_request_idx` on `lab_results`',
      'drop index `diagnostic_reports_based_on_idx` on `diagnostic_reports`',
      'alter table `diagnostic_reports` drop column `based_on_id`',
    ]);

    const mssqlSql = await collectCompiledSql('mssql', (db) => m017.down(db, 'mssql'));
    expect(mssqlSql).toEqual([
      'drop index "lab_results_request_idx" on "lab_results"',
      'drop index "diagnostic_reports_based_on_idx" on "diagnostic_reports"',
      'alter table "diagnostic_reports" drop column "based_on_id"',
    ]);

    const postgresSql = await collectCompiledSql('postgres', (db) => m017.down(db, 'postgres'));
    expect(postgresSql).toEqual([
      'drop index "lab_results_request_idx"',
      'drop index "diagnostic_reports_based_on_idx"',
      'alter table "diagnostic_reports" drop column "based_on_id"',
    ]);
  });

  it('up() widens lab_results.request_id with the engine-correct statement before indexing it', async () => {
    // MySQL only has MODIFY COLUMN; ALTER COLUMN ... TYPE is not valid MySQL syntax.
    const mysqlSql = await collectCompiledSql('mysql', (db) => m017.up(db, 'mysql'));
    expect(mysqlSql[0]).toBe('alter table `lab_results` modify column `request_id` varchar(255)');
    expect(mysqlSql[mysqlSql.length - 1]).toBe('create index `lab_results_request_idx` on `lab_results` (`request_id`)');

    // MSSQL is the opposite: it has no MODIFY COLUMN, only ALTER COLUMN.
    const mssqlSql = await collectCompiledSql('mssql', (db) => m017.up(db, 'mssql'));
    expect(mssqlSql[0]).toBe('alter table "lab_results" alter column "request_id" varchar(450)');
    expect(mssqlSql[mssqlSql.length - 1]).toBe('create index "lab_results_request_idx" on "lab_results" ("request_id")');

    // Postgres needs no widening at all: keyType and textType are both `text` there. The first
    // statement is straight to the based_on_id column, not a lab_results alteration.
    const postgresSql = await collectCompiledSql('postgres', (db) => m017.up(db, 'postgres'));
    expect(postgresSql[0]).toBe('alter table "diagnostic_reports" add column "based_on_id" text');
    expect(postgresSql.some((s) => s.includes('lab_results') && s.includes('alter'))).toBe(false);
  });
});
