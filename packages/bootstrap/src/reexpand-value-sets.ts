import type { TerminologyAdminStore } from '@openldr/db';
import { importResultParameters, type LoaderStore, type ResultParamImportResult } from '@openldr/terminology';

/**
 * Task 4 (S2b, result-classification): re-expands and reprojects every ValueSet whose compose
 * references `system`, after a loader has finished writing that system's concepts.
 *
 * Why this exists: a migration cannot materialize an intensional ValueSet's expansion, because the
 * concepts it filters over do not exist yet at migration time. Task 3's migration
 * (069_result_role_valuesets) seeds `urn:openldr:valueset:{result-observation,reportable-result,
 * non-reportable}` with `expanded_at: null` and zero `valueset_expansions` rows for exactly this
 * reason — the concepts arrive later, via `importResultParameters`. If nothing re-expands those sets
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
 * (result-parameters included) writes `status: null` for imported concepts by design, but
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
 * The actual `loaders.parameters` wiring, shared by `terminology-context.ts` (lab/single-tenant
 * boot) and `index.ts` (`createAppContext`'s `terminology.loaders`) so there is exactly one place
 * that pairs `importResultParameters` with the `reexpandValueSetsForSystem` call above — previously
 * each file duplicated this closure inline (with only the `admin` binding differing), which let the
 * two copies silently drift and left the re-expansion call itself untested: a unit test that invokes
 * `reexpandValueSetsForSystem` directly (see `reexpand-value-sets.test.ts`'s first three cases)
 * proves the helper works, but not that either boot path actually calls it. A test that builds this
 * factory the same way production does and calls the resulting `loaders.parameters` closure exercises
 * the real seam.
 */
export function createResultParametersLoader(
  admin: TerminologyAdminStore,
  loaderStore: LoaderStore,
): (json: unknown) => Promise<ResultParamImportResult> {
  return async (json) => {
    const result = await importResultParameters(json, loaderStore);
    await reexpandValueSetsForSystem(admin, result.system);
    return result;
  };
}
