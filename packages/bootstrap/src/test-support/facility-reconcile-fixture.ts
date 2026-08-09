import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { newDb } from 'pg-mem';
import {
  internalMigrations,
  externalMigrations,
  createTerminologyAdminStore,
  createFacilityRegistryStore,
  type ExternalSchema,
  type InternalSchema,
  type MapType,
  type TerminologyAdminStore,
} from '@openldr/db';
import type { ReconcileDeps } from '../facility-reconcile';

// pg-mem does not support the regex operator (!~) used by Kysely's Migrator introspection, so each
// migration's up() is run directly in order — same approach as `@openldr/db/testing`'s
// `makeMigratedDb` and `packages/db/src/test-helpers-external.ts`'s `makeMigratedExternalDb`.
// Reimplemented here (rather than imported): `@openldr/db`'s package.json `exports` map DOES publish
// both of those pg-mem helpers today (`./testing` and `./testing-external`, the latter added when
// `apps/server/src/facilities-routes.test.ts` started using it) — this duplication is a pre-existing,
// un-refactored follow-up, not a reachability gap.
async function makeMigratedInternalDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db as never);
  }
  return db;
}

async function makeMigratedExternalDb(): Promise<Kysely<ExternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<ExternalSchema>;
  for (const [name, migration] of Object.entries(externalMigrations('postgres'))) {
    try {
      await migration.up(db as never);
    } catch (err) {
      // Same pg-mem gap, same rescue, as `packages/db/src/test-helpers-external.ts`'s
      // `makeMigratedExternalDb` (this function's un-refactored duplicate): pg-mem cannot execute a
      // correlated subquery referencing the UPDATE target's own table at all — verified in isolation,
      // independent of migration 015's CAST. 015's up() runs its addColumn() DDL before the backfill
      // that trips this gap — but the try wraps the whole up(), so a matching error message alone
      // doesn't prove the DDL ran; it could equally be the addColumn() itself failing on some
      // unrelated "does not exist". Verified below, not assumed: query information_schema.columns
      // (confirmed to work against pg-mem) for facility_map.performer_system before swallowing, so a
      // DDL failure can't silently hand back a db missing the column. See migrations/external/
      // 015_facility_map_performer_system.test.ts's header comment for the measured detail and the
      // live-Postgres proof that the real statement is correct.
      if (name === '015_facility_map_performer_system' && err instanceof Error && /does not exist/.test(err.message)) {
        const cols = await sql<{ column_name: string }>`
          select column_name from information_schema.columns
           where table_name = 'facility_map' and column_name = 'performer_system'`.execute(db as never);
        if (cols.rows.length > 0) continue;
      }
      throw err;
    }
  }
  return db;
}

/**
 * Builds a fresh `ReconcileDeps` over two independent pg-mem databases: an internal db carrying the
 * full internal migration set (so `terminology_concepts`/`coding_systems` exist with real
 * constraints), and an external db carrying the full external migration set (so `diagnostic_reports`
 * exists). One call per test — pg-mem instances are not shared across tests.
 */
export async function makeReconcileDeps(): Promise<ReconcileDeps> {
  const internalDb = await makeMigratedInternalDb();
  const externalDb = await makeMigratedExternalDb();
  const admin: TerminologyAdminStore = createTerminologyAdminStore(internalDb);
  return { internalDb, externalDb, admin };
}

/**
 * Inserts `pairs.length` groups of `diagnostic_reports` rows into the external db, one row per unit
 * of `reportCount`, so `scanObservedFacilities`'s `count(*) group by performer` has real rows to
 * count rather than a synthetic total. `performer: null` is supported so callers can pin down the
 * "ignores null performers" behaviour.
 *
 * `opts.sourceSystem` defaults to `'webhook-ingest'` (the seeded workflow's default ingest feed —
 * every pre-Task-9b test relies on this default and must keep working unchanged) but a caller can
 * override it to seed a SECOND feed's rows — Task 9b's feed-aware scan/resolve needs two distinct
 * `source_system` values reporting the SAME `performer` code to prove they resolve independently.
 */
export async function seedPerformers(
  deps: ReconcileDeps,
  pairs: [string | null, number][],
  opts: { sourceSystem?: string; performerDisplay?: string | null; performerSystem?: string | null } = {},
): Promise<void> {
  const sourceSystem = opts.sourceSystem ?? 'webhook-ingest';
  // Random ids, not a sequence counter: `seedPerformers` is called more than once per test (a
  // second scan seeding more reports for an already-seeded performer), and a counter local to this
  // function would restart at `dr-1` on every call and collide with rows the first call inserted.
  const rows: { id: string; performer: string | null; source_system: string; performer_display: string | null; performer_system: string | null }[] = [];
  for (const [performer, count] of pairs) {
    for (let i = 0; i < count; i += 1) {
      rows.push({
        id: `dr-${randomUUID()}`,
        performer,
        source_system: sourceSystem,
        performer_display: opts.performerDisplay ?? null,
        performer_system: opts.performerSystem ?? null,
      });
    }
  }
  if (rows.length === 0) return;
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    await deps.externalDb.insertInto('diagnostic_reports').values(rows.slice(i, i + batchSize) as never).execute();
  }
}

export interface SeedRegistryInput {
  id: string;
  name: string;
  localCode?: string | null;
  nationalSystem?: string | null;
  nationalCode?: string | null;
  region?: string | null;
  district?: string | null;
  council?: string | null;
  level?: string | null;
  status?: string | null;
}

/**
 * Seeds one `facility_registry` row through the real store (`createFacilityRegistryStore`), not a
 * raw insert, so a seeded row honours the same `facility_registry_has_a_code` CHECK (local_code or
 * national_code present) a hand-entered or imported row would.
 */
export async function seedRegistry(deps: ReconcileDeps, input: SeedRegistryInput): Promise<void> {
  const store = createFacilityRegistryStore(deps.internalDb);
  await store.upsert({
    id: input.id,
    name: input.name,
    localCode: input.localCode ?? null,
    nationalSystem: input.nationalSystem ?? null,
    nationalCode: input.nationalCode ?? null,
    region: input.region ?? null,
    district: input.district ?? null,
    council: input.council ?? null,
    level: input.level ?? null,
    status: input.status ?? null,
    source: 'manual',
  });
}

export interface SeedMappingInput {
  fromSystem: string;
  fromCode: string;
  toSystem: string;
  toCode: string;
  /** Defaults to true. Task 4's "ignores an inactive mapping" test passes `false` here to pin the
   *  `term_mappings.is_active` filter. */
  isActive?: boolean;
  /** Defaults to `'SAME-AS'` — every pre-Task-10 test authored an equivalence and must keep
   *  resolving unchanged. Task 10 needs the OTHER four semantics `TermMappingDialog` offers, to pin
   *  that they no longer resolve a facility. */
  mapType?: MapType;
}

/**
 * Seeds one `term_mappings` row through `admin.termMappings.create` — the same path an operator's
 * `TermMappingDialog` submit takes — rather than a raw insert. That includes its side effect of
 * auto-creating a DRAFT `terminology_concepts` row for an unknown target (Task 4b's concern); Task
 * 4's resolution reads `facility_registry` directly, not the concept, so that side effect is inert
 * here but must not be bypassed by seeding differently than production does.
 */
export async function seedMapping(deps: ReconcileDeps, input: SeedMappingInput): Promise<void> {
  await deps.admin.termMappings.create({
    fromSystem: input.fromSystem,
    fromCode: input.fromCode,
    toSystem: input.toSystem,
    toCode: input.toCode,
    toDisplay: null,
    mapType: input.mapType ?? 'SAME-AS',
    isActive: input.isActive ?? true,
  });
}

/**
 * Drops migration 078's `term_mappings_one_active_facility_resolution` partial unique index.
 *
 * ⛔ Not a workaround — the state the index forbids (two ACTIVE `SAME-AS` mappings on one
 * `(from_system, from_code)`, whether they compete or merely duplicate each other) is exactly what
 * Task 10's resolver tests must construct, and after 078 the database refuses to hold it. That is
 * the index doing its job; the resolver behaviour behind it is still worth pinning as defence in
 * depth, for an install restored from a dump older than 078 or any future writer that bypasses the
 * index. Migration 078's own tests pin the index itself, so nothing goes unchecked by this.
 *
 * Call it BEFORE the offending `seedMapping` calls, never as a blanket fixture step: any test that
 * does not need the pre-078 state must keep running against the index a real install has.
 */
export async function dropOneActiveFacilityResolutionIndex(deps: ReconcileDeps): Promise<void> {
  await sql`drop index term_mappings_one_active_facility_resolution`.execute(deps.internalDb);
}

/**
 * The code facility `registryId` CURRENTLY projects as, read from `facility_concept_projection`.
 *
 * Deliberately reads the link table rather than recomputing `local_code ?? national_code`: the link
 * is the durable record of what was ACTUALLY written, collision fallback included, and recomputing
 * here would make a test agree with an implementation bug it is supposed to catch. `null` when the
 * facility has never been projected.
 */
export async function currentConceptCode(deps: ReconcileDeps, registryId: string): Promise<string | null> {
  const row = await deps.internalDb
    .selectFrom('facility_concept_projection')
    .select(['concept_code'])
    .where('registry_id', '=', registryId)
    .executeTakeFirst();
  return row?.concept_code ?? null;
}
