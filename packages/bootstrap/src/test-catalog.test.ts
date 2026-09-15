import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import {
  createFhirStore, createTerminologyStore, createTerminologyAdminStore,
  type InternalSchema, type ValueSetProjection,
} from '@openldr/db';
import { createOperations, LOINC_SYSTEM } from '@openldr/terminology';
import {
  createTestCatalog, parseCatalogListQuery, TEST_CATALOG_SYSTEM,
  type CatalogListQuery, type CatalogListResult,
} from './test-catalog';

const LOCAL = 'urn:openldr:cs:local';
// Three of the four codes the seeded specimen-type ValueSet lists (migration 014).
const BLD = { system: LOCAL, code: 'BLD' };
const UR = { system: LOCAL, code: 'UR' };
const CSF = { system: LOCAL, code: 'CSF' };

// The terminology context bootstrap builds (terminology-context.ts), over a migrated pg-mem db.
// Mirrors reexpand-value-sets.test.ts.
async function buildCatalog() {
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
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c),
    findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q),
    getResourceByUrl: (u) => store.getResourceByUrl(u),
    translate: (q) => store.translate(q),
  });
  return { db, admin, catalog: createTestCatalog({ db, admin, ops }) };
}

async function seedTest(
  db: Kysely<InternalSchema>, code: string, display: string,
  properties: Record<string, unknown> | null, status: string | null = 'ACTIVE',
): Promise<void> {
  await db.insertInto('terminology_concepts').values({
    system: TEST_CATALOG_SYSTEM, code, display, status,
    properties: (properties === null ? null : JSON.stringify(properties)) as never,
  }).execute();
}

// What the lab's terminology drain writes after pulling central's catalog (packages/sync/src/terminology-sync.ts).
async function markCentral(db: Kysely<InternalSchema>): Promise<void> {
  await db.insertInto('terminology_systems')
    .values({ url: TEST_CATALOG_SYSTEM, version: null, kind: 'CodeSystem', resource_id: '', managed_origin: 'central' })
    .onConflict((oc) => oc.column('url').doUpdateSet({ managed_origin: 'central' }))
    .execute();
}

function q(over: Partial<CatalogListQuery> = {}): CatalogListQuery {
  return { status: 'active', limit: 25, offset: 0, ...over };
}

function codes(result: CatalogListResult): string[] {
  return result.rows.map((t) => t.code);
}

describe('parseCatalogListQuery', () => {
  it('defaults to active tests, 25 a page, from the start', () => {
    expect(parseCatalogListQuery({})).toEqual({ ok: true, query: { status: 'active', limit: 25, offset: 0 } });
  });

  it('reads every filter, trimming the search', () => {
    expect(parseCatalogListQuery({
      q: '  viral ', category: 'MOL', loinc: 'none', enabled: 'off', status: 'all', limit: '50', offset: '25',
    })).toEqual({
      ok: true,
      query: { q: 'viral', category: 'MOL', loinc: 'none', enabled: false, status: 'all', limit: 50, offset: 25 },
    });
  });

  it('refuses a value it does not know, in words the route and the CLI share', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ loinc: 'yes' }, 'loinc must be "linked" or "none"'],
      [{ enabled: 'true' }, 'enabled must be "on" or "off"'],
      [{ status: 'gone' }, 'status must be "active", "retired" or "all"'],
      [{ limit: '0' }, 'limit must be a whole number from 1 to 200'],
      [{ limit: '201' }, 'limit must be a whole number from 1 to 200'],
      [{ limit: 'abc' }, 'limit must be a whole number from 1 to 200'],
      [{ offset: '-1' }, 'offset must be a whole number, 0 or more'],
      [{ offset: '1.5' }, 'offset must be a whole number, 0 or more'],
    ];
    for (const [raw, error] of cases) expect(parseCatalogListQuery(raw)).toEqual({ ok: false, error });
  });
});

describe('test catalog: reads', () => {
  it('starts empty, and this install owns it', async () => {
    const { catalog } = await buildCatalog();
    expect(await catalog.list(q())).toEqual({ rows: [], total: 0, ownedHere: true });
  });

  it('reads a test with its properties, its LOINC link and this lab settings', async () => {
    const { db, admin, catalog } = await buildCatalog();
    await seedTest(db, 'HIVVL', 'HIV viral load', { shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR] });
    await admin.termMappings.create({
      fromSystem: TEST_CATALOG_SYSTEM, fromCode: 'HIVVL', toSystem: LOINC_SYSTEM, toCode: '25836-8',
      toDisplay: null, mapType: 'SAME-AS', isActive: true,
    });
    await db.insertInto('test_catalog_lab_settings').values({
      code: 'HIVVL', enabled: true, specimen_types: JSON.stringify([BLD]), local_display: 'Viral load',
    }).execute();

    expect(await catalog.list(q())).toEqual({
      rows: [{
        code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR],
        loinc: '25836-8', active: true, lab: { enabled: true, specimenTypes: [BLD], localDisplay: 'Viral load' },
      }],
      total: 1,
      ownedHere: true,
    });
  });

  it('ignores an inactive LOINC link', async () => {
    const { db, admin, catalog } = await buildCatalog();
    await seedTest(db, 'HIVVL', 'HIV viral load', null);
    await admin.termMappings.create({
      fromSystem: TEST_CATALOG_SYSTEM, fromCode: 'HIVVL', toSystem: LOINC_SYSTEM, toCode: '25836-8',
      toDisplay: null, mapType: 'SAME-AS', isActive: false,
    });
    expect((await catalog.get('HIVVL'))?.loinc).toBeNull();
  });

  it('hides retired tests unless asked, and counts a NULL status as active', async () => {
    const { db, catalog } = await buildCatalog();
    await seedTest(db, 'A', 'Active', null, 'ACTIVE');
    await seedTest(db, 'B', 'Retired', null, 'DEPRECATED');
    await seedTest(db, 'N', 'Loader-written', null, null);
    expect(codes(await catalog.list(q()))).toEqual(['A', 'N']);
    expect(codes(await catalog.list(q({ status: 'retired' })))).toEqual(['B']);
    expect(codes(await catalog.list(q({ status: 'all' })))).toEqual(['A', 'B', 'N']);
  });

  it('filters by category, LOINC link and switch, and searches code, name, short name and local name', async () => {
    const { db, admin, catalog } = await buildCatalog();
    await seedTest(db, 'A1', 'Glucose', { category: 'CHEM' });
    await seedTest(db, 'B2', 'Malaria smear', { category: 'MICRO' });
    await seedTest(db, 'C3', 'Syphilis screen', { category: 'SERO', shortName: 'RPR' });
    await admin.termMappings.create({
      fromSystem: TEST_CATALOG_SYSTEM, fromCode: 'A1', toSystem: LOINC_SYSTEM, toCode: '2345-7',
      toDisplay: null, mapType: 'SAME-AS', isActive: true,
    });
    await db.insertInto('test_catalog_lab_settings').values({ code: 'B2', enabled: true, local_display: 'Blood film' }).execute();

    expect(codes(await catalog.list(q({ category: 'CHEM' })))).toEqual(['A1']);
    expect(codes(await catalog.list(q({ loinc: 'linked' })))).toEqual(['A1']);
    expect(codes(await catalog.list(q({ loinc: 'none' })))).toEqual(['B2', 'C3']);
    expect(codes(await catalog.list(q({ enabled: true })))).toEqual(['B2']);
    expect(codes(await catalog.list(q({ enabled: false })))).toEqual(['A1', 'C3']);
    expect(codes(await catalog.list(q({ q: 'film' })))).toEqual(['B2']);
    expect(codes(await catalog.list(q({ q: 'rpr' })))).toEqual(['C3']);
    expect(codes(await catalog.list(q({ q: 'a1' })))).toEqual(['A1']);
    expect(codes(await catalog.list(q({ q: 'GLU' })))).toEqual(['A1']);
  });

  it('pages, and the total counts every match', async () => {
    const { db, catalog } = await buildCatalog();
    for (const c of ['T1', 'T2', 'T3']) await seedTest(db, c, c, null);
    const first = await catalog.list(q({ limit: 2 }));
    expect([codes(first), first.total]).toEqual([['T1', 'T2'], 3]);
    const second = await catalog.list(q({ limit: 2, offset: 2 }));
    expect([codes(second), second.total]).toEqual([['T3'], 3]);
  });

  it('says this install does not own the catalog once it came from central', async () => {
    const { db, catalog } = await buildCatalog();
    await markCentral(db);
    expect((await catalog.list(q())).ownedHere).toBe(false);
    expect(await catalog.ownedHere()).toBe(false);
  });

  it('gets one test by code, or null', async () => {
    const { db, catalog } = await buildCatalog();
    await seedTest(db, 'HIVVL', 'HIV viral load', null);
    expect((await catalog.get('HIVVL'))?.display).toBe('HIV viral load');
    expect(await catalog.get('NOPE')).toBeNull();
  });
});
