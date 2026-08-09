import { Kysely, sql } from 'kysely';
import { newDb } from 'pg-mem';
import { externalMigrations } from './migrations/external/index';

// pg-mem does not support the regex operator (!~) used by Kysely's Migrator introspection.
// We run each external migration's up() function directly in order — same approach as
// migrations/internal/test-helpers.ts:makeMigratedDb.
export async function makeMigratedExternalDb(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const [name, migration] of Object.entries(externalMigrations('postgres'))) {
    try {
      await migration.up(db);
    } catch (err) {
      // ⛔ MEASURED: pg-mem has no support at all for a correlated subquery referencing the
      // UPDATE target's own table (verified in isolation, independent of this migration's CAST —
      // see migrations/external/015_facility_map_performer_system.test.ts's header comment). This
      // migration's up() runs its addColumn() DDL first and only THEN calls the backfill that
      // trips this gap — but the try wraps the whole up(), so a matching error message alone
      // doesn't prove the DDL ran; it could equally be the addColumn() itself failing on some
      // unrelated "does not exist". Verified below, not assumed: query
      // information_schema.columns (confirmed to work against pg-mem) for
      // facility_map.performer_system before swallowing. Every other external-migration test only
      // needs the column to exist, not backfilled, so this keeps them running against the fake
      // rather than propagating a fake limitation as if it were a real defect. Scoped to this one
      // migration by name on purpose: a future migration hitting the same gap needs this
      // rediscovered and named explicitly, not silently inherited.
      if (name === '015_facility_map_performer_system' && err instanceof Error && /does not exist/.test(err.message)) {
        const cols = await sql<{ column_name: string }>`
          select column_name from information_schema.columns
           where table_name = 'facility_map' and column_name = 'performer_system'`.execute(db);
        if (cols.rows.length > 0) continue;
      }
      throw err;
    }
  }
  return db;
}
