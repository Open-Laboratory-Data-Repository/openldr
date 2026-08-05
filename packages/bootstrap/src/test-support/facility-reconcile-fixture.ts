import { randomUUID } from 'node:crypto';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import {
  internalMigrations,
  externalMigrations,
  createTerminologyAdminStore,
  createFacilityRegistryStore,
  type ExternalSchema,
  type InternalSchema,
  type TerminologyAdminStore,
} from '@openldr/db';
import type { ReconcileDeps } from '../facility-reconcile';

// pg-mem does not support the regex operator (!~) used by Kysely's Migrator introspection, so each
// migration's up() is run directly in order — same approach as `@openldr/db/testing`'s
// `makeMigratedDb` and `packages/db/src/test-helpers-external.ts`'s `makeMigratedExternalDb`.
// Reimplemented here (rather than imported) because neither of those pg-mem helpers is reachable
// through `@openldr/db`'s package.json `exports` map from another workspace package.
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
  for (const migration of Object.values(externalMigrations('postgres'))) {
    await migration.up(db as never);
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
 */
export async function seedPerformers(deps: ReconcileDeps, pairs: [string | null, number][]): Promise<void> {
  // Random ids, not a sequence counter: `seedPerformers` is called more than once per test (a
  // second scan seeding more reports for an already-seeded performer), and a counter local to this
  // function would restart at `dr-1` on every call and collide with rows the first call inserted.
  const rows: { id: string; performer: string | null; source_system: string }[] = [];
  for (const [performer, count] of pairs) {
    for (let i = 0; i < count; i += 1) {
      rows.push({ id: `dr-${randomUUID()}`, performer, source_system: 'webhook-ingest' });
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
    mapType: 'SAME-AS',
    isActive: input.isActive ?? true,
  });
}
