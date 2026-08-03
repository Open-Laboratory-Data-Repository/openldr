import type { TerminologyAdminStore } from '@openldr/db';

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
 * `{ activeOnly: false }`: every @openldr/terminology loader (result-parameters included) writes
 * `status: null` for imported concepts by design — see `terminology-admin-store.ts`'s
 * `refreshCacheAndProject` comment. The default `activeOnly: true` gates on `status = 'ACTIVE'`
 * exactly, which a null-status concept never satisfies, so re-expanding with the default would
 * silently yield zero codes on every real install — the exact failure this task exists to prevent,
 * just moved one layer down.
 */
export async function reexpandValueSetsForSystem(admin: TerminologyAdminStore, system: string): Promise<void> {
  const summaries = await admin.valueSets.list();
  const targets = summaries.filter((vs) => vs.primarySystem === system);
  for (const t of targets) {
    const vs = await admin.valueSets.get(t.id);
    await admin.valueSets.save(
      {
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
      },
      { activeOnly: false },
    );
  }
}
