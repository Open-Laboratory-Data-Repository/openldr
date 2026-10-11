import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import { createFhirStore, createTerminologyStore, createTerminologyAdminStore, type InternalSchema, type ValueSetProjection } from '@openldr/db';
import { LOINC_SYSTEM } from '@openldr/terminology';
import { TEST_CATALOG_SYSTEM } from '../test-catalog';
import { createTestMapping } from '../test-mapping';

// Shared by the test-mapping*.test.ts files: a migrated internal db, a migrated warehouse, the real
// terminology admin store, and helpers that seed catalog tests, mappings and lab requests.

export async function buildMapping(opts: { now?: () => number } = {}) {
  const internalDb = await makeMigratedDb();
  const externalDb = await makeMigratedExternalDb();
  const fhirStore = createFhirStore(internalDb);
  const store = createTerminologyStore(internalDb, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(resource) {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url, version, kind, resourceId) { await store.saveSystem(url, version, kind, resourceId); },
    async deleteValueSetResource(url, id) {
      await fhirStore.delete('ValueSet', id);
      await internalDb.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const admin = createTerminologyAdminStore(internalDb, projection);
  const warnings: string[] = [];
  // Counts selects that read lab_requests, so a test can tell a cached Observed scan from a fresh one.
  const counter = { groupQueries: 0 };
  const countingDb = externalDb.withPlugin({
    transformQuery(args) {
      const node = args.node as { kind: string; from?: { froms?: Array<{ table?: { identifier?: { name?: string } } }> } };
      if (node.kind === 'SelectQueryNode' && node.from?.froms?.some((f) => f.table?.identifier?.name === 'lab_requests')) counter.groupQueries += 1;
      return args.node;
    },
    async transformResult(args) { return args.result; },
  });
  const mapping = createTestMapping({ internalDb, externalDb: countingDb, admin, now: opts.now, logger: { warn: (_o, msg) => { warnings.push(msg); } } });
  return { internalDb, externalDb, admin, mapping, warnings, counter };
}

export async function seedCatalogTest(db: Kysely<InternalSchema>, code: string, display: string, opts: { category?: string; loinc?: string; status?: string } = {}) {
  await db.insertInto('terminology_concepts').values({
    system: TEST_CATALOG_SYSTEM, code, display, status: opts.status ?? 'ACTIVE',
    properties: JSON.stringify({ category: opts.category ?? null }) as never,
  }).execute();
  if (opts.loinc) {
    await db.insertInto('term_mappings').values({
      id: `loinc-${code}`, from_system: TEST_CATALOG_SYSTEM, from_code: code, to_system: LOINC_SYSTEM, to_code: opts.loinc,
      to_display: null, map_type: 'SAME-AS', relationship: null, owner: null, is_active: true, managed_origin: null,
    }).execute();
  }
}

export async function seedMapping(db: Kysely<InternalSchema>, id: string, system: string, code: string, catalogCode: string, opts: { active?: boolean; central?: boolean; mapType?: string } = {}) {
  await db.insertInto('term_mappings').values({
    id, from_system: system, from_code: code, to_system: TEST_CATALOG_SYSTEM, to_code: catalogCode,
    to_display: null, map_type: opts.mapType ?? 'SAME-AS', relationship: null, owner: null,
    is_active: opts.active ?? true, managed_origin: opts.central ? 'central' : null,
  }).execute();
}

export async function seedRequest(db: Kysely<any>, id: string, system: string | null, code: string | null, desc: string | null, authoredAt: string) {
  await db.insertInto('lab_requests').values({ id, panel_system: system, panel_code: code, panel_desc: desc, authored_at: authoredAt }).execute();
}
