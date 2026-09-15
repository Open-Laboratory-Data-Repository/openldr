import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import {
  createFhirStore, createTerminologyStore, createTerminologyAdminStore,
  type InternalSchema, type ValueSetProjection,
} from '@openldr/db';
import { createOperations, LOINC_SYSTEM } from '@openldr/terminology';
import { createTerminologyBulkSync } from '@openldr/sync';
import {
  createTestCatalog, parseCatalogListQuery, catalogChangeAction, readCatalogImportFile, TEST_CATALOG_SYSTEM,
  type CatalogListQuery, type CatalogListResult, type CatalogTestInput, type CatalogImportInput,
} from './test-catalog';
import type { CatalogColumnMap } from './test-catalog-import';

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

// The export's own layout, so every import test also exercises the headers an export writes.
const IMPORT_HEAD = ['code', 'name', 'short_name', 'loinc', 'category', 'specimen_types'];
const ALL_COLUMNS: CatalogColumnMap = {
  code: 'code', name: 'name', shortName: 'short_name', loinc: 'loinc', category: 'category', specimenTypes: 'specimen_types',
};

function importInput(rows: string[][], over: Partial<CatalogImportInput> = {}): CatalogImportInput {
  return { table: { headers: IMPORT_HEAD, rows }, columnMap: ALL_COLUMNS, ...over };
}

async function catalogGeneration(db: Kysely<InternalSchema>): Promise<number> {
  const row = await db.selectFrom('terminology_systems').select('generation')
    .where('url', '=', TEST_CATALOG_SYSTEM).executeTakeFirst();
  return row ? Number(row.generation) : 0;
}

async function storedConcept(db: Kysely<InternalSchema>, code: string): Promise<{ status: string | null; properties: unknown }> {
  const row = await db.selectFrom('terminology_concepts').select(['status', 'properties'])
    .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', code).executeTakeFirstOrThrow();
  return { status: row.status, properties: typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties };
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

describe('test catalog: writes', () => {
  it('creates a test with its properties and LOINC link', async () => {
    const { db, catalog } = await buildCatalog();
    const created = await catalog.create({
      code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
      specimenTypes: [BLD, UR, BLD], loinc: '25836-8',
    });
    expect(created).toEqual({
      code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR],
      loinc: '25836-8', active: true, lab: { enabled: false, specimenTypes: null, localDisplay: null },
    });
    expect(await storedConcept(db, 'HIVVL')).toEqual({
      status: 'ACTIVE', properties: { shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR] },
    });
  });

  it('gives a test with no national code its LOINC code', async () => {
    const { catalog } = await buildCatalog();
    expect((await catalog.create({ display: 'HIV viral load', loinc: '25836-8' })).code).toBe('25836-8');
  });

  it('refuses a test it cannot store, and says why', async () => {
    const { catalog } = await buildCatalog();
    const cases: Array<[CatalogTestInput, string]> = [
      [{ code: 'X', display: '  ' }, 'A test needs a name.'],
      [{ display: 'No codes' }, 'A test needs a national code or a LOINC code.'],
      [{ code: 'X', display: 'X', loinc: 'ABC' }, '"ABC" is not a LOINC code. LOINC codes look like 12345-6.'],
      [{ code: 'X', display: 'X', category: 'NOPE' }, 'Category NOPE is not in the test category list.'],
      [
        { code: 'X', display: 'X', specimenTypes: [{ system: LOCAL, code: 'XYZ' }] },
        'Specimen XYZ (urn:openldr:cs:local) is not in the specimen type list.',
      ],
    ];
    for (const [input, message] of cases) {
      await expect(catalog.create(input)).rejects.toMatchObject({ kind: 'invalid', message });
    }
  });

  it('refuses a code already in the catalog', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await expect(catalog.create({ code: 'HIVVL', display: 'Again' }))
      .rejects.toMatchObject({ kind: 'conflict', message: 'Test HIVVL is already in the catalog.' });
  });

  it('checks a LOINC code against LOINC when LOINC is loaded', async () => {
    const { db, catalog } = await buildCatalog();
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    await expect(catalog.create({ code: 'VL', display: 'Viral load', loinc: '25836-8' }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'LOINC code 25836-8 is not in the LOINC loaded on this install.' });
    expect((await catalog.create({ code: 'GLU', display: 'Glucose', loinc: '2345-7' })).loinc).toBe('2345-7');
  });

  it('does not count the DRAFT stubs earlier links leave as a loaded LOINC', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'A', display: 'A', loinc: '25836-8' });
    const stub = await db.selectFrom('terminology_concepts').select('status')
      .where('system', '=', LOINC_SYSTEM).where('code', '=', '25836-8').executeTakeFirstOrThrow();
    expect(stub.status).toBe('DRAFT');
    expect((await catalog.create({ code: 'B', display: 'B', loinc: '11111-1' })).loinc).toBe('11111-1');
  });

  it('edits the whole test, keeps keys it does not manage, and keeps the code', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD] });
    // A key set elsewhere, such as `meta` from the Terminology page's Metadata field.
    await db.updateTable('terminology_concepts')
      .set({ properties: JSON.stringify({ shortName: 'VL', category: 'MOL', specimenTypes: [BLD], meta: { owner: 'lab' } }) as never })
      .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', 'HIVVL').execute();

    const updated = await catalog.update('HIVVL', { display: 'HIV-1 viral load', category: null, specimenTypes: [] });
    expect(updated).toMatchObject({ code: 'HIVVL', display: 'HIV-1 viral load', shortName: null, category: null, specimenTypes: [] });
    expect((await storedConcept(db, 'HIVVL')).properties).toEqual({ meta: { owner: 'lab' } });

    await expect(catalog.update('HIVVL', { code: 'OTHER', display: 'x' }))
      .rejects.toMatchObject({ kind: 'invalid', message: "A test's code cannot change once saved (HIVVL)." });
    await expect(catalog.update('NOPE', { display: 'x' }))
      .rejects.toMatchObject({ kind: 'not-found', message: 'Test NOPE is not in the catalog.' });
  });

  it('relinks and unlinks LOINC, keeping one active link', async () => {
    const { admin, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    const active = async () => (await admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, 'HIVVL'))
      .filter((m) => m.isActive).map((m) => m.toCode);

    expect((await catalog.update('HIVVL', { display: 'HIV viral load', loinc: '20447-9' })).loinc).toBe('20447-9');
    expect(await active()).toEqual(['20447-9']);

    expect((await catalog.update('HIVVL', { display: 'HIV viral load', loinc: null })).loinc).toBeNull();
    expect(await active()).toEqual([]);
  });

  it('retires a test as DEPRECATED, and restores it', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    expect((await catalog.update('HIVVL', { display: 'HIV viral load', active: false })).active).toBe(false);
    expect((await storedConcept(db, 'HIVVL')).status).toBe('DEPRECATED');
    expect(codes(await catalog.list(q()))).toEqual([]);
    expect((await catalog.update('HIVVL', { display: 'HIV viral load', active: true })).active).toBe(true);
    expect(codes(await catalog.list(q()))).toEqual(['HIVVL']);
  });

  it('refuses to add or edit tests once the catalog came from central', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await markCentral(db);
    await expect(catalog.create({ code: 'CD4', display: 'CD4 count' })).rejects.toMatchObject({ kind: 'central-managed' });
    await expect(catalog.update('HIVVL', { display: 'Changed' })).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('signals every edit so labs pull it', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await catalog.update('HIVVL', { display: 'HIV-1 viral load' });
    const sys = await db.selectFrom('terminology_systems').select('generation')
      .where('url', '=', TEST_CATALOG_SYSTEM).executeTakeFirstOrThrow();
    expect(Number(sys.generation)).toBe(2);
    const logged = await db.selectFrom('reference_change_log').select('op')
      .where('entity_type', '=', 'terminology_system').where('entity_id', '=', TEST_CATALOG_SYSTEM).execute();
    expect(logged).toHaveLength(2);
  });
});

describe('test catalog: this lab', () => {
  it('switches a test on with a local name', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    const t = await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: '  Viral load ' });
    expect(t.lab).toEqual({ enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
  });

  it('lets a lab narrow the specimen list but never add to it', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    expect((await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: [UR], localDisplay: null })).lab.specimenTypes)
      .toEqual([UR]);
    await expect(catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: [CSF], localDisplay: null })).rejects.toMatchObject({
      kind: 'invalid',
      message: "Specimen CSF is not on this test's catalog list. A lab can narrow the list but not add to it.",
    });
    expect((await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: null })).lab.specimenTypes)
      .toBeNull();
  });

  it('refuses settings for a test not in the catalog', async () => {
    const { catalog } = await buildCatalog();
    await expect(catalog.setLabSettings('NOPE', { enabled: true, specimenTypes: null, localDisplay: null }))
      .rejects.toMatchObject({ kind: 'not-found', message: 'Test NOPE is not in the catalog.' });
  });

  it('never signals a sync change for lab settings', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    const count = async () => (await db.selectFrom('reference_change_log').select('seq').execute()).length;
    const before = await count();
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
    expect(await count()).toBe(before);
  });

  it('keeps lab settings through a pull from central, which hands the catalog to central', async () => {
    const { db, catalog } = await buildCatalog();
    const central = [
      { code: 'CD4', display: 'CD4 count', status: 'ACTIVE', properties: null },
      { code: 'HIVVL', display: 'HIV viral load', status: 'ACTIVE', properties: { specimenTypes: [BLD, UR] } },
    ];
    const bulk = createTerminologyBulkSync({
      labDb: db,
      fetchConceptsPage: async () => ({ concepts: central, nextCode: null }),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
      getToken: async () => 'token',
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });

    await bulk.syncSystem(TEST_CATALOG_SYSTEM, { kind: 'CodeSystem', generation: 1 });
    expect(await catalog.ownedHere()).toBe(false);
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: [BLD], localDisplay: 'Viral load' });

    await bulk.syncSystem(TEST_CATALOG_SYSTEM, { kind: 'CodeSystem', generation: 2 });
    expect((await catalog.get('HIVVL'))?.lab).toEqual({ enabled: true, specimenTypes: [BLD], localDisplay: 'Viral load' });
    expect(codes(await catalog.list(q()))).toEqual(['CD4', 'HIVVL']);
    await expect(catalog.update('HIVVL', { display: 'Changed' })).rejects.toMatchObject({ kind: 'central-managed' });
  });
});

describe('test catalog: options and row changes', () => {
  it('offers the categories and specimen types the save accepts, with their names, sorted by name', async () => {
    const { catalog } = await buildCatalog();
    const o = await catalog.options();
    expect(o.categories).toEqual([
      { code: 'CHEM', display: 'Chemistry' },
      { code: 'HAEM', display: 'Haematology' },
      { code: 'MICRO', display: 'Microbiology' },
      { code: 'MOL', display: 'Molecular' },
      { code: 'SERO', display: 'Serology' },
    ]);
    expect(o.specimenTypes).toEqual([
      { system: LOCAL, code: 'BLD', display: 'Blood' },
      { system: LOCAL, code: 'CSF', display: 'CSF' },
      { system: LOCAL, code: 'SPT', display: 'Sputum' },
      { system: LOCAL, code: 'UR', display: 'Urine' },
    ]);
    expect(o.loinc).toBeNull();
  });

  it('names the LOINC system only when LOINC is loaded', async () => {
    const { db, catalog } = await buildCatalog();
    await db.insertInto('coding_systems').values({
      id: 'cs-url-LOINC', system_code: 'LOINC', system_name: 'LOINC', url: LOINC_SYSTEM,
      active: true, publisher_id: 'pub-system', seeded: false,
    } as never).execute();
    expect((await catalog.options()).loinc).toBeNull();
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    expect((await catalog.options()).loinc).toEqual({ systemId: 'cs-url-LOINC', system: LOINC_SYSTEM });
  });

  it('switches a test on and off and keeps the lab narrowed specimens and local name', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    await catalog.setLabSettings('HIVVL', { enabled: false, specimenTypes: [UR], localDisplay: 'Viral load' });
    expect((await catalog.setEnabled('HIVVL', true)).lab).toEqual({ enabled: true, specimenTypes: [UR], localDisplay: 'Viral load' });
    expect((await catalog.setEnabled('HIVVL', false)).lab).toEqual({ enabled: false, specimenTypes: [UR], localDisplay: 'Viral load' });
  });

  it('switches on a test the lab has never touched', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'CD4', display: 'CD4 count' });
    expect((await catalog.setEnabled('CD4', true)).lab).toEqual({ enabled: true, specimenTypes: null, localDisplay: null });
  });

  it('still switches a test on after central dropped a specimen the lab had kept', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD] });
    // The lab kept UR, which the catalog no longer lists, as after a later pull from central.
    await db.insertInto('test_catalog_lab_settings')
      .values({ code: 'HIVVL', enabled: false, specimen_types: JSON.stringify([UR]) }).execute();
    expect((await catalog.setEnabled('HIVVL', true)).lab.enabled).toBe(true);
  });

  it('lets a lab that receives central catalog switch tests, and refuses an unknown test', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await markCentral(db);
    expect((await catalog.setEnabled('HIVVL', true)).lab.enabled).toBe(true);
    await expect(catalog.setEnabled('NOPE', true))
      .rejects.toMatchObject({ kind: 'not-found', message: 'Test NOPE is not in the catalog.' });
  });

  it('never signals a sync change for a switch', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    const count = async () => (await db.selectFrom('reference_change_log').select('seq').execute()).length;
    const before = await count();
    await catalog.setEnabled('HIVVL', true);
    expect(await count()).toBe(before);
  });

  it('retires and restores a test and changes nothing else', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    expect(await catalog.setActive('HIVVL', false))
      .toMatchObject({ active: false, category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    expect((await storedConcept(db, 'HIVVL')).status).toBe('DEPRECATED');
    expect((await catalog.setActive('HIVVL', true)).active).toBe(true);
    expect((await storedConcept(db, 'HIVVL')).status).toBe('ACTIVE');
  });

  it('retires a test whose LOINC code a later LOINC load does not hold', async () => {
    const { db, catalog } = await buildCatalog();
    // With no LOINC loaded, the link stubs a DRAFT 25836-8. Loading LOINC without it makes a full re-save fail.
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    await expect(catalog.update('HIVVL', { display: 'HIV viral load', loinc: '25836-8', active: false }))
      .rejects.toMatchObject({ kind: 'invalid' });
    expect((await catalog.setActive('HIVVL', false)).active).toBe(false);
  });

  it('signals one sync change per real status change, and none when nothing changes', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    const generation = async () => Number((await db.selectFrom('terminology_systems').select('generation')
      .where('url', '=', TEST_CATALOG_SYSTEM).executeTakeFirstOrThrow()).generation);
    expect(await generation()).toBe(1);
    await catalog.setActive('HIVVL', true);
    expect(await generation()).toBe(1);
    await catalog.setActive('HIVVL', false);
    expect(await generation()).toBe(2);
  });

  it('refuses to retire an unknown test, or at a lab that receives central catalog', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await expect(catalog.setActive('NOPE', false)).rejects.toMatchObject({ kind: 'not-found' });
    await markCentral(db);
    await expect(catalog.setActive('HIVVL', false)).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('names the audit action for each row change', () => {
    expect([
      catalogChangeAction('enabled', true), catalogChangeAction('enabled', false),
      catalogChangeAction('active', false), catalogChangeAction('active', true),
    ]).toEqual(['test_catalog.enable', 'test_catalog.disable', 'test_catalog.retire', 'test_catalog.restore']);
  });
});

describe('test catalog: import preview', () => {
  it('reads a file for import and suggests its columns, and refuses a bad one as invalid', () => {
    const file = readCatalogImportFile(new TextEncoder().encode('Test code,Test name\nHIVVL,HIV viral load\n'), 'csv');
    expect(file).toEqual({
      headers: ['Test code', 'Test name'], rows: [['HIVVL', 'HIV viral load']], sheetName: null, sheetCount: 1,
      suggested: { code: 'Test code', name: 'Test name' },
    });
    let caught: unknown;
    try {
      readCatalogImportFile(new TextEncoder().encode('code,name\n'), 'xlsx');
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ kind: 'invalid', message: 'The file is not an Excel workbook (.xlsx).' });
  });

  it('counts new, changed, unchanged and refused rows, and writes nothing', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', category: 'MOL', specimenTypes: [BLD] });
    await catalog.create({ code: 'CD4', display: 'CD4 count', category: 'HAEM' });
    const generation = await catalogGeneration(db);

    const report = await catalog.importPreview(importInput([
      ['HIVVL', 'HIV viral load', '', '', 'Molecular', 'Blood'],
      ['CD4', 'CD4 cell count', '', '', 'haem', ''],
      ['GLU', 'Glucose', '', '', 'Chemistry', 'Blood; urine'],
      ['', 'No code', '', '', '', ''],
      ['HIVVL', 'HIV viral load again', '', '', '', ''],
    ]));

    expect(report).toEqual({
      counts: { new: 1, changed: 1, unchanged: 1, refused: 2 },
      refused: [
        { line: 5, code: null, reason: 'A test needs a national code or a LOINC code.' },
        { line: 6, code: 'HIVVL', reason: 'Test HIVVL is already on row 2 of this file.' },
      ],
      unmatched: { categories: [], specimens: [] },
      categoriesToAdd: [],
      loincChecked: false,
    });
    expect((await catalog.get('CD4'))?.display).toBe('CD4 count');
    expect(await catalog.get('GLU')).toBeNull();
    expect(await catalogGeneration(db)).toBe(generation);
  });

  it('lists text that matched nothing, refuses its rows until answered, and adds a category the operator names', async () => {
    const { catalog } = await buildCatalog();
    const rows = [
      ['VL1', 'Viral load 1', '', '', 'Virology', 'Plasma'],
      ['VL2', 'Viral load 2', '', '', 'virology', 'Blood'],
    ];

    const unanswered = await catalog.importPreview(importInput(rows));
    expect(unanswered.counts).toEqual({ new: 0, changed: 0, unchanged: 0, refused: 2 });
    expect(unanswered.refused).toEqual([
      {
        line: 2, code: 'VL1',
        reason: 'Category "Virology" is not in the test category list. Choose a category for it. '
          + 'Specimen "Plasma" is not in the specimen type list. Choose a specimen for it.',
      },
      { line: 3, code: 'VL2', reason: 'Category "virology" is not in the test category list. Choose a category for it.' },
    ]);
    expect(unanswered.unmatched).toEqual({ categories: [{ text: 'Virology', rows: 2 }], specimens: [{ text: 'Plasma', rows: 1 }] });

    const answered = await catalog.importPreview(importInput(rows, {
      valueMap: {
        categories: [{ text: 'VIROLOGY', kind: 'new', code: 'VIRO', display: 'Virology' }],
        specimens: [{ text: 'plasma', system: LOCAL, code: 'BLD' }],
      },
    }));
    expect(answered.counts).toEqual({ new: 2, changed: 0, unchanged: 0, refused: 0 });
    expect(answered.categoriesToAdd).toEqual([{ code: 'VIRO', display: 'Virology' }]);
    // Answered text stays listed, so the Values step can show the answer.
    expect(answered.unmatched).toEqual(unanswered.unmatched);
  });

  it('refuses a new category with no code or name, or one that already exists', async () => {
    const { catalog } = await buildCatalog();
    const withNew = (code: string, display: string) => importInput([['VL1', 'Viral load', '', '', 'Virology', '']], {
      valueMap: { categories: [{ text: 'Virology', kind: 'new', code, display }], specimens: [] },
    });
    await expect(catalog.importPreview(withNew(' ', 'Virology')))
      .rejects.toMatchObject({ kind: 'invalid', message: 'The new category for "Virology" needs a code.' });
    await expect(catalog.importPreview(withNew('VIRO', ' ')))
      .rejects.toMatchObject({ kind: 'invalid', message: 'The new category VIRO needs a name.' });
    await expect(catalog.importPreview(withNew('MOL', 'Molecular again')))
      .rejects.toMatchObject({ kind: 'invalid', message: 'Category MOL already exists. Choose it instead of adding it.' });
  });

  it('leaves a field alone when its column is not mapped', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    const report = await catalog.importPreview({
      table: { headers: ['code', 'name'], rows: [['HIVVL', 'HIV viral load']] },
      columnMap: { code: 'code', name: 'name' },
    });
    expect(report.counts).toEqual({ new: 0, changed: 0, unchanged: 1, refused: 0 });
  });

  it('checks LOINC codes against LOINC when it is loaded, and says when it could check only their format', async () => {
    const { db, catalog } = await buildCatalog();
    const rows = [['A', 'A', '', 'ABC', '', ''], ['B', 'B', '', '25836-8', '', ''], ['C', 'C', '', '2345-7', '', '']];

    const unloaded = await catalog.importPreview(importInput(rows));
    expect(unloaded.loincChecked).toBe(false);
    expect(unloaded.refused).toEqual([{ line: 2, code: 'A', reason: '"ABC" is not a LOINC code. LOINC codes look like 12345-6.' }]);

    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    const loaded = await catalog.importPreview(importInput(rows));
    expect(loaded.loincChecked).toBe(true);
    expect(loaded.counts).toEqual({ new: 1, changed: 0, unchanged: 0, refused: 2 });
    expect(loaded.refused[1]).toEqual({ line: 3, code: 'B', reason: 'LOINC code 25836-8 is not in the LOINC loaded on this install.' });
  });

  it('does not check again a LOINC code the test already has', async () => {
    const { db, catalog } = await buildCatalog();
    // Linked before LOINC was loaded, so only a DRAFT stub stands behind the code.
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    const report = await catalog.importPreview(importInput([['HIVVL', 'HIV viral load', '', '25836-8', '', '']]));
    expect(report.counts).toEqual({ new: 0, changed: 0, unchanged: 1, refused: 0 });
  });

  it('refuses a map with no name, a table over the row limit, and a lab whose catalog comes from central', async () => {
    const { db, catalog } = await buildCatalog();
    await expect(catalog.importPreview(importInput([], { columnMap: { code: 'code' } })))
      .rejects.toMatchObject({ kind: 'invalid', message: 'Choose the column that holds the test name. It is required.' });
    const many = Array.from({ length: 5001 }, (_, i) => [`T${i}`, `Test ${i}`, '', '', '', '']);
    await expect(catalog.importPreview(importInput(many)))
      .rejects.toMatchObject({ kind: 'invalid', message: 'The file has 5001 rows under its header. The limit is 5000.' });
    await markCentral(db);
    await expect(catalog.importPreview(importInput([]))).rejects.toMatchObject({ kind: 'central-managed' });
  });
});
