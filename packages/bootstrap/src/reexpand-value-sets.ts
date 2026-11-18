import type { TerminologyAdminStore } from '@openldr/db';
import { importTerminologyResource, type ImportOrigin, type LoaderStore, type LoadResult } from '@openldr/terminology';

/**
 * Task 4 (S2b, result-classification): re-expands and reprojects every ValueSet whose compose
 * references `system`, after a loader has finished writing that system's concepts.
 *
 * Why this exists: a migration cannot materialize an intensional ValueSet's expansion, because the
 * concepts it filters over do not exist yet at migration time. Task 3's migration
 * (069_result_role_valuesets) seeds `urn:openldr:valueset:{result-observation,reportable-result,
 * non-reportable}` with `expanded_at: null` and zero `valueset_expansions` rows for exactly this
 * reason — the concepts arrive later, through a CodeSystem import. If nothing re-expands those sets
 * after an import, they stay empty forever: nothing projects into `terminology_codes`, and the whole
 * slice looks configured while doing nothing.
 *
 * Finds targets GENERALLY — any stored ValueSet whose `primarySystem` (the store's own compose
 * summary, `terminology-admin-store.ts`'s `primarySystemOf`) equals `system` — rather than
 * hardcoding the three seeded URLs. A ValueSet built against this system later is picked up the same
 * way, with no code change here.
 *
 * ⛔ MUST call `valueSets.save()`, never `valueSets.expand()`. Both exist on the store, but only
 * `save()` routes through `refreshCacheAndProject` -> `projection.saveValueSetResource` ->
 * `fhirStore.save()`, which writes the `fhir.change_log` row the projection cycle needs to reach
 * `terminology_codes`. `expand()` only writes `valueset_expansions` — no `fhirStore.save`, no
 * change_log row — so calling it here would leave `terminology_codes` empty forever, reproducing the
 * migration-014 defect that forced the prior slice to add an `openldr terminology reproject` CLI
 * workaround. `save()` is fed back the ValueSet's OWN unchanged fields (fetched via `valueSets.get`)
 * purely to trigger that recompute-and-project path — this is not an edit.
 *
 * Plain `save(input)` — no `activeOnly` override. Every @openldr/terminology loader
 * writes `status: null` for imported concepts by design, but
 * `terminology-admin-store.ts`'s `vsDeps.listSystemConcepts`/`filterConcepts` now treat NULL status
 * as active (same convention `termRow` already applies for display), so the store's default
 * `activeOnly: true` expansion picks up loader-fed concepts without an opt-in override. A concept an
 * admin later marks non-active (DEPRECATED/DISABLED/DRAFT/DISCOURAGED/TRIAL) is still excluded.
 */
export async function reexpandValueSetsForSystem(admin: TerminologyAdminStore, system: string): Promise<void> {
  const summaries = await admin.valueSets.list();
  const targets = summaries.filter((vs) => vs.primarySystem === system);
  for (const t of targets) {
    const vs = await admin.valueSets.get(t.id);
    await admin.valueSets.save({
      url: vs.url,
      version: vs.version,
      name: vs.name,
      title: vs.title,
      status: vs.status,
      experimental: vs.experimental,
      description: vs.description,
      compose: vs.compose,
      publisherId: vs.publisherId,
      category: vs.category,
    });
  }
}

/**
 * The `loaders.resource` wiring, shared by `terminology-context.ts` (lab boot) and `index.ts`
 * (`createAppContext`), so both boot paths re-expand the same way. A CodeSystem import re-expands
 * every ValueSet built on that system. Without it, migration 069's result-role sets stay empty after
 * a lab imports its result codes. An admin import unless the caller says otherwise (CE's seed passes
 * 'core', a pack 'pack').
 */
export function createResourceLoader(
  admin: TerminologyAdminStore,
  loaderStore: LoaderStore,
): (json: unknown, from?: ImportOrigin) => Promise<LoadResult> {
  return async (json, from) => {
    const result = await importTerminologyResource(json, loaderStore, from ?? { origin: 'import' });
    if ((json as { resourceType?: unknown }).resourceType === 'CodeSystem') await reexpandValueSetsForSystem(admin, result.system);
    return result;
  };
}
