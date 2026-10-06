import { describe, it, expect } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import {
  createFhirStore, createRelationalWriter, createProjectionRunner, createTerminologyStore, markTerminologyChanged,
  type InternalSchema,
} from '@openldr/db';
import { importTerminologyResource, type LoaderStore } from '@openldr/terminology';
import { withRegisteredResourceId } from './content-pack-terminology';

const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

const CS_URL = 'urn:test:pack-colours';
const VS_URL = 'urn:test:pack-colour-set';
const codeSystem = {
  resourceType: 'CodeSystem', url: CS_URL, name: 'Colours', status: 'active', content: 'complete',
  concept: [{ code: 'R', display: 'Red' }, { code: 'G', display: 'Green' }],
};
const valueSet = {
  resourceType: 'ValueSet', url: VS_URL, name: 'Colour set', status: 'active',
  expansion: {
    timestamp: '2026-01-01T00:00:00Z',
    contains: [{ system: CS_URL, code: 'R', display: 'Red' }, { system: CS_URL, code: 'G', display: 'Green' }],
  },
};

async function build() {
  const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
  const externalDb = await makeMigratedExternalDb();
  const fhirStore = createFhirStore(db);
  const termStore = createTerminologyStore(db, fhirStore);
  const loaderStore: LoaderStore = {
    upsertConcepts: (r) => termStore.upsertConcepts(r),
    upsertMapElements: (r) => termStore.upsertMapElements(r),
    markSystemChanged: (url) => markTerminologyChanged(db, url),
    saveResource: (res) => fhirStore.save(res as never),
    saveSystem: (url, version, kind, id) => termStore.saveSystem(url, version, kind, id),
  };
  // The same shape as the content pack wiring in index.ts.
  const load = async (json: unknown) => importTerminologyResource(await withRegisteredResourceId(db, json), loaderStore);
  const loadWithoutReuse = (json: unknown) => importTerminologyResource(json, loaderStore);

  async function project() {
    // fetchSafeChangeRows is Postgres only. Feed every change_log row, as valueset-delete.test.ts does.
    const rows = await db.selectFrom('fhir.change_log').select(['seq', 'resource_type', 'resource_id', 'op']).orderBy('seq').execute();
    await createProjectionRunner({
      internalDb: db as never, fhirStore, relationalWriter: createRelationalWriter(externalDb as never, 'postgres'), logger,
      fetch: async () => ({
        rows: rows.map((r) => ({ seq: Number(r.seq), xid: 1, resource_type: r.resource_type, resource_id: r.resource_id, op: r.op })),
        boundary: 100_000, xmax: 200_000,
      }),
      batchSize: 500,
    }).runCycle();
  }

  async function resourcesFor(type: string, url: string): Promise<string[]> {
    const rows = await db.selectFrom('fhir.fhir_resources').select(['id', 'resource']).where('resource_type', '=', type).execute();
    return rows
      .filter((r) => (typeof r.resource === 'string' ? JSON.parse(r.resource) : r.resource).url === url)
      .map((r) => r.id);
  }

  async function codesFor(url: string): Promise<{ value_set_id: string; code: string }[]> {
    const out = await sql<{ value_set_id: string; code: string }>`select value_set_id, code from terminology_codes where value_set_url = ${url} order by code`.execute(externalDb);
    return out.rows;
  }

  return { db, externalDb, load, loadWithoutReuse, project, resourcesFor, codesFor };
}

describe('content pack terminology on reinstall', () => {
  it('a second install leaves one resource and one set of codes per URL', async () => {
    const t = await build();
    for (let i = 0; i < 2; i++) {
      await t.load(structuredClone(codeSystem));
      await t.load(structuredClone(valueSet));
    }
    await t.project();

    expect(await t.resourcesFor('CodeSystem', CS_URL)).toHaveLength(1);
    const vsIds = await t.resourcesFor('ValueSet', VS_URL);
    expect(vsIds).toHaveLength(1);

    const codes = await t.codesFor(VS_URL);
    expect(codes.map((c) => c.code)).toEqual(['G', 'R']);
    expect(new Set(codes.map((c) => c.value_set_id))).toEqual(new Set(vsIds));

    const systems = await t.db.selectFrom('terminology_systems').select(['url', 'resource_id']).where('url', 'in', [CS_URL, VS_URL]).execute();
    expect(systems).toHaveLength(2);
    expect(systems.find((s) => s.url === VS_URL)?.resource_id).toBe(vsIds[0]);

    await t.db.destroy();
    await t.externalDb.destroy();
  });

  it('without the id reuse a second load duplicates the value set and its codes', async () => {
    // Control: proves the test above would catch the duplicate.
    const t = await build();
    await t.loadWithoutReuse(structuredClone(valueSet));
    await t.loadWithoutReuse(structuredClone(valueSet));
    await t.project();
    expect(await t.resourcesFor('ValueSet', VS_URL)).toHaveLength(2);
    expect(await t.codesFor(VS_URL)).toHaveLength(4);
    await t.db.destroy();
    await t.externalDb.destroy();
  });

  it('keeps an id the resource names itself, and ignores a URL registered as another type', async () => {
    const t = await build();
    expect(await withRegisteredResourceId(t.db, { ...valueSet, id: 'own-id' })).toMatchObject({ id: 'own-id' });
    await t.load(structuredClone(codeSystem));
    const asValueSet = await withRegisteredResourceId(t.db, { resourceType: 'ValueSet', url: CS_URL });
    expect((asValueSet as { id?: string }).id).toBeUndefined();
    await t.db.destroy();
    await t.externalDb.destroy();
  });
});
