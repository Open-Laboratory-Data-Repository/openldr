import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createInternalDb, createMigrator, internalMigrations, type InternalDb } from '@openldr/db';
import { importFacilities } from './facility-import';

// Gated exactly like packages/db/src/migrations/external/reset-roundtrip-live.test.ts: skipped
// unless a real Postgres is configured. This test cannot be replaced by a pg-mem one — it exists
// BECAUSE pg-mem and node-postgres return different types for `timestamptz` and `double precision`,
// and the classification (classifyFacilityRows, via facility-classify.ts's `same()` and its
// conflict-watermark check) reads both. What each assertion below actually pins:
//   - `facility_registry.latitude`/`longitude` are `double precision` (migration 070's deliberate
//     choice over `numeric`, made BECAUSE node-postgres returns `numeric` as a string with no type
//     parser configured — pg-mem returns real numbers for either type, so only real Postgres can
//     catch a regression back to `numeric` here). The "unchanged" and "changed" calls below pin this:
//     a byte-identical re-import must not manufacture a `latitude`/`longitude` diff out of a
//     string-vs-number mismatch, and a real coordinate move must report the exact before/after pair.
//   - `facility_registry.updated_at` is `timestamptz`, which node-postgres returns as a `Date`, even
//     though `FacilityRegistryTable` declares it `string`. `classifyFacilityRows` never puts
//     `updated_at` through `same()` — the ONLY place it is read is the conflict watermark,
//     `new Date(existing.updatedAt).getTime() > watermark` (facility-classify.ts:70), which only runs
//     when `opts.previewedAt` is non-null. The fourth call below is the one that supplies
//     `previewedAt` and asserts `conflict: 1`, which is what actually forces that comparison to
//     execute against a driver-returned `updated_at` rather than a hermetic pg-mem value. Without that
//     call, `updated_at` would never be exercised here at all.
//
// `createInternalDb` (packages/db/src/internal-db.ts), not a raw `new Kysely`/`new Pool`: it matches
// the repo's own factory for exactly this connection shape, already exported from `@openldr/db`, and
// it is the same call shape `createDbContext` uses in packages/bootstrap/src/db-context.ts
// (`createInternalDb(cfg.INTERNAL_DATABASE_URL)`) — this test connects the way the app actually does.
// (`packages/bootstrap/package.json` already lists `pg` as a direct dependency, and `src/index.ts` /
// `src/listener-postgres.ts` already import it directly, so avoiding a `pg` dependency was never the
// reason and is not claimed here.)
//
// It provisions its OWN throwaway database, following reset-roundtrip-live.test.ts's pattern, so it
// never touches the shared dev target schema — TARGET_DATABASE_URL here only needs to name a server
// this test is allowed to `create database` / `drop database` against (a maintenance/admin database),
// not a database it writes rows into directly.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

live('importFacilities against real Postgres', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_fi_${randomUUID().replace(/-/g, '')}`;
  let internal: InternalDb;

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    internal = createInternalDb(target.toString());
    const res = await createMigrator(internal.db, internalMigrations).migrateToLatest();
    if (res.error) throw res.error;
  }, 120_000);

  afterAll(async () => {
    await internal?.close().catch(() => undefined); // ends the target pool so the drop can proceed
    // Terminate any lingering backends, then drop the throwaway DB.
    await admin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName])
      .catch(() => undefined);
    await admin.query(`drop database if exists "${dbName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it('reports a byte-identical re-import as unchanged, a moved coordinate as changed, and a stale previewedAt as conflict', async () => {
    const { db } = internal;
    const system = `urn:live:${Date.now()}`;
    const header = 'national_code,name,latitude,longitude';
    const body = `${header}\n900,Live Alpha,-2.4048,29.912\n`;

    try {
      const first = await importFacilities({ db }, body, { nationalSystem: system, apply: true });
      expect(first).toMatchObject({ create: 1, unchanged: 0 });

      // The whole point: a double-precision round trip must not manufacture a difference. If
      // `latitude`/`longitude` came back as the wrong type, this reports `changed: 1` instead.
      const second = await importFacilities({ db }, body, { nationalSystem: system, apply: true });
      expect(second).toMatchObject({ create: 0, changed: 0, unchanged: 1 });

      const moved = `${header}\n900,Live Alpha,-2.5,29.912\n`;
      const third = await importFacilities({ db }, moved, { nationalSystem: system });
      expect(third).toMatchObject({ changed: 1 });
      expect(third.samples.changed[0].diff).toEqual([{ field: 'latitude', before: -2.4048, after: -2.5 }]);

      // `unchanged` rows are not written (facility-import.ts), so the row's `updated_at` is still the
      // one the first (create) call set — the third call above was a preview, not an apply, so it
      // never touched the row either. Read it back through the driver, then supply a `previewedAt`
      // strictly BEFORE it: exactly the "someone else's write landed since my preview" case
      // `classifyFacilityRows` treats as `conflict` (facility-classify.ts:70).
      const row = await db
        .selectFrom('facility_registry')
        .select('updated_at')
        .where('facility_system', '=', system)
        .executeTakeFirstOrThrow();
      const stalePreviewedAt = new Date(new Date(row.updated_at).getTime() - 1000);

      const fourth = await importFacilities(
        { db }, moved, { nationalSystem: system, apply: true, previewedAt: stalePreviewedAt },
      );
      expect(fourth).toMatchObject({ conflict: 1, written: { created: 0, updated: 0 } });

      // Not written — the conflicting apply was skipped, so the coordinate is still the unmoved one.
      const after = await db
        .selectFrom('facility_registry')
        .select('latitude')
        .where('facility_system', '=', system)
        .executeTakeFirstOrThrow();
      expect(after.latitude).toBe(-2.4048);
    } finally {
      await db.deleteFrom('facility_registry').where('facility_system', '=', system).execute();
    }
  }, 120_000);
});
