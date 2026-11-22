import type { Kysely } from 'kysely';
import { valueSetToFhirResource, type ExpandedConcept, type InternalSchema, type TerminologyAdminStore, type VsCompose } from '@openldr/db';

/** The bundled FHIR R4 catalog's publisher, as `importFhirCatalog` stamps it. */
const FHIR_PUBLISHER_ID = 'pub-hl7-fhir';
/** Catalog set URLs start with this. Migration 072's own `pub-hl7-fhir` set is `urn:openldr:...`. */
const HL7_URL_PREFIX = 'http://hl7.org/';
/** Rows per insert statement, well below PostgreSQL's parameter limit. */
const CHUNK = 500;

/**
 * Registers the bundled FHIR catalog value sets so `$expand` can find them.
 *
 * `importFhirCatalog` writes the `value_sets` row and its stored codes, but no FHIR ValueSet and no
 * `terminology_systems` row. `$expand` looks a set up through `terminology_systems`, so it found none
 * of the catalog. This writes the missing pair for every catalog set that has no `terminology_systems`
 * row, the way migration 106 seeds its own sets: the ValueSet into `fhir.fhir_current` and
 * `fhir.resource_history` (migration 130's split) and the registration, with no `fhir.change_log` row,
 * so nothing syncs. It never calls `refreshCacheAndProject`, which would recompute the stored codes
 * from concepts that are not loaded and so delete them.
 *
 * Idempotent: a set already registered, by this or any other path, is left alone.
 */
export async function registerFhirCatalogValueSets(db: Kysely<InternalSchema>): Promise<{ registered: number }> {
  const sets = await db.selectFrom('value_sets')
    .select(['id', 'url', 'version', 'name', 'title', 'status', 'experimental', 'description', 'compose'])
    .where('publisher_id', '=', FHIR_PUBLISHER_ID)
    .where('url', 'like', `${HL7_URL_PREFIX}%`)
    .execute();
  if (sets.length === 0) return { registered: 0 };
  const held = new Set((await db.selectFrom('terminology_systems').select('url').execute()).map((r) => r.url));
  const missing = sets.filter((vs) => !held.has(vs.url));
  if (missing.length === 0) return { registered: 0 };

  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const history = chunk.map((vs) => ({
        resource_type: 'ValueSet', id: vs.id, version: 1, op: 'upsert',
        resource: JSON.stringify(valueSetToFhirResource({
          id: vs.id, url: vs.url, status: vs.status as never, experimental: vs.experimental, version: vs.version,
          name: vs.name, title: vs.title, description: vs.description,
          compose: (typeof vs.compose === 'string' ? JSON.parse(vs.compose) : (vs.compose ?? { include: [] })) as VsCompose,
        })),
      }));
      await trx.insertInto('fhir.resource_history').values(history as never)
        .onConflict((oc) => oc.columns(['resource_type', 'id', 'version']).doNothing()).execute();
      await trx.insertInto('fhir.fhir_current')
        .values(chunk.map((vs) => ({ resource_type: 'ValueSet', id: vs.id, version: 1, version_id: '1' })) as never)
        .onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();
      await trx.insertInto('terminology_systems')
        .values(chunk.map((vs) => ({ url: vs.url, version: vs.version, kind: 'ValueSet', resource_id: vs.id })) as never)
        .onConflict((oc) => oc.column('url').doNothing()).execute();
    }
  });
  return { registered: missing.length };
}

/**
 * The `storedExpansion` that `createOperations` takes: a set's stored codes, for immutable sets only.
 * The bundled catalog's sets are immutable, and their stored codes are their content, because their
 * code systems are not loaded as concepts. Migration 105's lab test list (vs-lab-tests) is immutable
 * too, so it reaches this fallback, but its stored list is empty on purpose, so the fallback returns
 * nothing for it and changes nothing. Any other set's stored codes are a cache of its compose, and
 * when that compose finds nothing today the cache may be stale, so it stays empty as before.
 */
export function catalogStoredExpansion(
  admin: { valueSets: Pick<TerminologyAdminStore['valueSets'], 'getByUrl' | 'storedCodes'> },
): (url: string) => Promise<ExpandedConcept[]> {
  return async (url) => {
    const vs = await admin.valueSets.getByUrl(url);
    return vs?.immutable ? admin.valueSets.storedCodes(vs.id) : [];
  };
}
