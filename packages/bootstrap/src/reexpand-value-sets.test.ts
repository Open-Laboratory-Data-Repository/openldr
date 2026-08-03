import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFhirStore, createTerminologyStore, createTerminologyAdminStore, type ValueSetProjection } from '@openldr/db';
import { importResultParameters, type LoaderStore } from '@openldr/terminology';
import { reexpandValueSetsForSystem } from './reexpand-value-sets';

// Mirrors bootstrap's exact terminology-context.ts construction (createTerminologyContext can't run
// against pg-mem itself — see index.test.ts's reference-capture describe block for why): a real
// fhirStore + terminologyStore + terminology-admin-store wired with a projection that routes through
// fhirStore.save(), against a fully-migrated pg-mem db carrying Task 3's migration 069 seed.
async function buildContext() {
  const db = await makeMigratedDb();
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(resource) {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url, version, kind, resourceId) {
      await store.saveSystem(url, version, kind, resourceId);
    },
    async deleteValueSetResource(url, id) {
      await fhirStore.delete('ValueSet', id);
      await db.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const admin = createTerminologyAdminStore(db, projection);
  const loaderStore: LoaderStore = {
    upsertConcepts: (r) => store.upsertConcepts(r),
    upsertMapElements: (r) => store.upsertMapElements(r),
    markSystemChanged: async () => {}, // sync signal — irrelevant to this test
    saveResource: (res) => fhirStore.save(res as never),
    saveSystem: async (url, version, kind, id) => { await store.saveSystem(url, version, kind, id); },
  };
  const codesIn = async (url: string) => {
    const vs = await db.selectFrom('value_sets').select(['id']).where('url', '=', url).executeTakeFirstOrThrow();
    const rows = await db.selectFrom('valueset_expansions').select(['code']).where('value_set_id', '=', vs.id).orderBy('code').execute();
    return rows.map((r) => r.code);
  };
  return { db, admin, loaderStore, codesIn };
}

describe('reexpandValueSetsForSystem (Task 4, S2b)', () => {
  it('re-expands the intensional sets after an import, so they are not empty', async () => {
    const { admin, loaderStore, codesIn } = await buildContext();

    const result = await importResultParameters(
      [
        { code: 'CD4', description: 'CD4 Count', result_role: 'result' },
        { code: 'COLBY', description: 'Collected By', result_role: 'metadata' },
      ],
      loaderStore,
    );

    await reexpandValueSetsForSystem(admin, result.system);

    expect(await codesIn('urn:openldr:valueset:non-reportable')).toEqual(['COLBY']);
    expect(await codesIn('urn:openldr:valueset:reportable-result')).toEqual(['CD4']);
    expect(await codesIn('urn:openldr:valueset:result-observation')).toEqual(['CD4', 'COLBY']);
  });

  it('projects through valueSets.save() — a fhir.change_log row lands for each re-expanded set (not just expand())', async () => {
    const { db, admin, loaderStore } = await buildContext();

    await importResultParameters(
      [{ code: 'CD4', description: 'CD4 Count', result_role: 'result' }],
      loaderStore,
    );
    await reexpandValueSetsForSystem(admin, 'urn:openldr:default_result');

    const vsIds = ['vs-result-observation', 'vs-reportable-result', 'vs-non-reportable'];
    const log = await db.selectFrom('fhir.change_log').selectAll()
      .where('resource_id', 'in', vsIds).execute();
    // One upsert change_log row per set, proving save() (not expand()) was the path taken —
    // expand() never touches fhir.change_log at all.
    expect(log.length).toBe(3);
  });

  it('leaves the sets empty when the re-expansion call never runs (import alone is not enough)', async () => {
    const { loaderStore, codesIn } = await buildContext();

    await importResultParameters(
      [
        { code: 'CD4', description: 'CD4 Count', result_role: 'result' },
        { code: 'COLBY', description: 'Collected By', result_role: 'metadata' },
      ],
      loaderStore,
    );
    // Deliberately no reexpandValueSetsForSystem call here — migration 069 seeded these sets with
    // expanded_at: null and zero valueset_expansions rows, and an import alone never touches them.

    expect(await codesIn('urn:openldr:valueset:non-reportable')).toEqual([]);
    expect(await codesIn('urn:openldr:valueset:reportable-result')).toEqual([]);
  });
});
