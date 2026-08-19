import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { sql, type Kysely } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { externalMigrations } from './index';
import * as m017 from './017_diagnostic_report_based_on';

// 016_ingest_events.test.ts (the file this test is nominally modelled on) has no database harness
// at all; it only checks dialect-width arithmetic, so it does not fit an assertion about a real
// migrated table. The nullable-column check instead follows 013/014's own harness
// (`makeMigratedExternalDb`, a round-trip insert/select), and the index checks build a local pg-mem
// instance directly: pg-mem has no `pg_indexes` view (measured, throws "relation does not exist")
// and its `information_schema.columns.is_nullable` is unreliable (measured: a plain nullable column
// reports 'NO'), so this uses pg-mem's own JS-level `table.listIndices()` instead of SQL metadata.
async function migratedDb(): Promise<{ mem: ReturnType<typeof newDb>; db: Kysely<any> }> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const [name, migration] of Object.entries(externalMigrations('postgres'))) {
    try {
      await migration.up(db);
    } catch (err) {
      // Same measured, name-scoped pg-mem gap that test-helpers-external.ts's makeMigratedExternalDb
      // works around: pg-mem cannot run migration 015's correlated-subquery backfill. That is not
      // this migration and this test does not depend on 015's backfilled values, so swallow it here
      // too rather than skipping straight to only running 017 (which would leave every EARLIER
      // migration's DDL, including facility_map itself, unapplied).
      //
      // Verified, not assumed, same as the shipped helper: a matching error message alone does not
      // prove the DDL ran before the backfill threw. Query information_schema (works against
      // pg-mem) for facility_map.performer_system before swallowing.
      if (name === '015_facility_map_performer_system' && err instanceof Error && /does not exist/.test(err.message)) {
        const cols = await sql<{ column_name: string }>`
          select column_name from information_schema.columns
           where table_name = 'facility_map' and column_name = 'performer_system'`.execute(db);
        if (cols.rows.length > 0) continue;
      }
      throw err;
    }
  }
  return { mem, db };
}

describe('017_diagnostic_report_based_on', () => {
  it('adds based_on_id as nullable: a report with no basedOn still inserts', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into diagnostic_reports (id) values ('dr-no-based-on')`.execute(db);
    const rows = await sql<{ based_on_id: string | null }>`
      select based_on_id from diagnostic_reports where id = 'dr-no-based-on'`.execute(db);
    expect(rows.rows).toEqual([{ based_on_id: null }]);
  });

  it('creates both required indexes after up', async () => {
    const { mem } = await migratedDb();
    const reportIndexNames = mem.public.getTable('diagnostic_reports').listIndices().map((idx) => idx.name);
    expect(reportIndexNames).toContain('diagnostic_reports_based_on_idx');
    const resultIndexNames = mem.public.getTable('lab_results').listIndices().map((idx) => idx.name);
    expect(resultIndexNames).toContain('lab_results_request_idx');
  });

  it('down() drops the column and both indexes', async () => {
    const { mem, db } = await migratedDb();

    await m017.down(db, 'postgres');

    const reportIndexNames = mem.public.getTable('diagnostic_reports').listIndices().map((idx) => idx.name);
    expect(reportIndexNames).not.toContain('diagnostic_reports_based_on_idx');
    const resultIndexNames = mem.public.getTable('lab_results').listIndices().map((idx) => idx.name);
    expect(resultIndexNames).not.toContain('lab_results_request_idx');

    // The column itself is gone, not just the index: selecting it now fails.
    await expect(sql`select based_on_id from diagnostic_reports`.execute(db)).rejects.toThrow();
  });
});
