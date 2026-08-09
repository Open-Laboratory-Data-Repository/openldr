import { describe, it, expect } from 'vitest';
import { createInternalDb, createMigrator, internalMigrations } from '@openldr/db';
import { importFacilities } from './facility-import';

// Gated exactly like packages/db/src/migrations/external/reset-roundtrip-live.test.ts: skipped
// unless a real Postgres is configured. This test cannot be replaced by a pg-mem one — it exists
// BECAUSE pg-mem and node-postgres return different types for `timestamptz` and `double precision`,
// and the classification (classifyFacilityRows, via facility-classify.ts's `same()`) compares both:
//   - `facility_registry.latitude`/`longitude` are `double precision` (migration 070's deliberate
//     choice over `numeric`, made BECAUSE node-postgres returns `numeric` as a string with no type
//     parser configured — pg-mem returns real numbers for either type, so only real Postgres can
//     catch a regression back to `numeric` here).
//   - `facility_registry.updated_at` is `timestamptz`, which node-postgres returns as a `Date`, even
//     though `FacilityRegistryTable` declares it `string` — again indistinguishable from pg-mem, which
//     hands back whatever JS value was inserted.
// If either came back as the wrong type, `same()` would compare a number to a string (or a Date to
// whatever) and every row would classify as `changed` on every re-import — a defect the unit suite,
// which runs entirely on pg-mem, cannot see.
//
// `createInternalDb` (packages/db/src/internal-db.ts), not a raw `new Kysely`/`new Pool`: it is the
// repo's own factory for exactly this connection shape, already exported from `@openldr/db`, and
// using it here avoids adding a direct `pg` dependency to packages/bootstrap.
const url = process.env.TARGET_DATABASE_URL;

describe.skipIf(!url)('importFacilities against real Postgres', () => {
  it('reports a byte-identical re-import as unchanged, and a moved coordinate as changed', async () => {
    const internal = createInternalDb(url!);
    const { db } = internal;
    try {
      const res = await createMigrator(db, internalMigrations).migrateToLatest();
      if (res.error) throw res.error;

      const system = `urn:live:${Date.now()}`;
      const header = 'national_code,name,latitude,longitude';
      const body = `${header}\n900,Live Alpha,-2.4048,29.912\n`;

      const first = await importFacilities({ db }, body, { nationalSystem: system, apply: true });
      expect(first).toMatchObject({ create: 1, unchanged: 0 });

      // The whole point: a double-precision round trip and a timestamptz read must not manufacture a
      // difference. If either came back as the wrong type, this reports `changed: 1` instead.
      const second = await importFacilities({ db }, body, { nationalSystem: system, apply: true });
      expect(second).toMatchObject({ create: 0, changed: 0, unchanged: 1 });

      const moved = `${header}\n900,Live Alpha,-2.5,29.912\n`;
      const third = await importFacilities({ db }, moved, { nationalSystem: system });
      expect(third).toMatchObject({ changed: 1 });
      expect(third.samples.changed[0].diff).toEqual([{ field: 'latitude', before: -2.4048, after: -2.5 }]);

      await db.deleteFrom('facility_registry').where('national_system', '=', system).execute();
    } finally {
      await internal.close();
    }
  }, 120_000);
});
