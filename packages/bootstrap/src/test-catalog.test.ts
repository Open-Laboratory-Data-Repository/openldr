import { describe, it, expect, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import { createTestMapping } from './test-mapping';
import {
  createFhirStore, createTerminologyStore, createTerminologyAdminStore,
  type InternalSchema, type ValueSetProjection,
} from '@openldr/db';
import { createOperations, LOINC_SYSTEM, type Operations } from '@openldr/terminology';
import { createTerminologyBulkSync } from '@openldr/sync';
import {
  createTestCatalog, newTestId, parseCatalogListQuery, catalogChangeAction, readCatalogImportFile, TEST_CATALOG_SYSTEM, TEST_CATEGORY_SYSTEM, TEST_CODE_SYSTEM,
  LAB_TESTS_VALUE_SET, TEST_CATEGORY_VALUE_SET, withLabTestsList,
  type CatalogListQuery, type CatalogListResult, type CatalogTestInput, type CatalogImportInput,
} from './test-catalog';
import type { CatalogColumnMap } from './test-catalog-import';
import { countryCodes, createLabIdentity, labCountry } from './lab-identity';

const LOCAL = 'urn:openldr:cs:local';
// Three of the four codes the seeded specimen-type ValueSet lists (migration 014).
const BLD = { system: LOCAL, code: 'BLD' };
const UR = { system: LOCAL, code: 'UR' };
const CSF = { system: LOCAL, code: 'CSF' };

// The terminology context bootstrap builds (terminology-context.ts), over a migrated pg-mem db.
// Mirrors reexpand-value-sets.test.ts.
// Tests written before tests had their own id pass `legacyIds`, so a new test's id is its Test code,
// as every test saved before the change reads. The tests of the id itself use the real one.
async function buildCatalog(opts: {
  realIds?: boolean; labCountry?: string | null;
  /** Wires a real lab identity service, as bootstrap does. Given the catalog's ops so it can read the seeded country list. */
  labIdentity?: (ops: ReturnType<typeof createOperations>) => () => Promise<string | null>;
} = {}) {
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
  const makeId = opts.realIds ? undefined : (testCode: string) => testCode;
  const labCountry = opts.labIdentity ? { labCountry: opts.labIdentity(ops) }
    : opts.labCountry === undefined ? {} : { labCountry: async () => opts.labCountry ?? null };
  return { db, admin, ops, catalog: createTestCatalog({ db, admin, ops, ...(makeId ? { makeId } : {}), ...labCountry }) };
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
        code: 'HIVVL', testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR],
        resultParams: [], codings: [],
        loinc: '25836-8', active: true, expectedTatHours: null, criticalTatHours: null, requiresVerification: true,
        lab: { enabled: true, specimenTypes: [BLD], localDisplay: 'Viral load' },
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
      testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
      specimenTypes: [BLD, UR, BLD], loinc: '25836-8',
    });
    expect(created).toEqual({
      code: 'HIVVL', testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR],
      resultParams: [], codings: [],
      loinc: '25836-8', active: true, expectedTatHours: null, criticalTatHours: null, requiresVerification: true,
      lab: { enabled: false, specimenTypes: null, localDisplay: null },
    });
    expect(await storedConcept(db, 'HIVVL')).toEqual({
      status: 'ACTIVE', properties: { shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR] },
    });
  });

  it('refuses a test it cannot store, and says why', async () => {
    const { catalog } = await buildCatalog();
    const cases: Array<[CatalogTestInput, string]> = [
      [{ testCode: 'X', display: '  ' }, 'A test needs a name.'],
      [{ display: 'No codes' }, 'A test needs a Test code.'],
      // The LOINC code is a mapping, never the test's code.
      [{ display: 'Only LOINC', loinc: '25836-8' }, 'A test needs a Test code.'],
      [{ testCode: '  ', display: 'Blank' }, 'A test needs a Test code.'],
      [{ testCode: 'X', display: 'X', loinc: 'ABC' }, '"ABC" is not a LOINC code. LOINC codes look like 12345-6.'],
      [{ testCode: 'X', display: 'X', category: 'NOPE' }, 'Category NOPE is not in the test category list.'],
      [
        { testCode: 'X', display: 'X', specimenTypes: [{ system: LOCAL, code: 'XYZ' }] },
        'Specimen XYZ (urn:openldr:cs:local) is not in the specimen type list.',
      ],
    ];
    for (const [input, message] of cases) {
      await expect(catalog.create(input)).rejects.toMatchObject({ kind: 'invalid', message });
    }
  });

  it('refuses a Test code already in the catalog', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    await expect(catalog.create({ testCode: 'HIVVL', display: 'Again' }))
      .rejects.toMatchObject({ kind: 'conflict', message: 'Test code HIVVL is already used by HIV viral load (HIVVL).' });
  });

  it('checks a LOINC code against LOINC when LOINC is loaded', async () => {
    const { db, catalog } = await buildCatalog();
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    await expect(catalog.create({ testCode: 'VL', display: 'Viral load', loinc: '25836-8' }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'LOINC code 25836-8 is not in the LOINC loaded on this install.' });
    expect((await catalog.create({ testCode: 'GLU', display: 'Glucose', loinc: '2345-7' })).loinc).toBe('2345-7');
  });

  it('does not count the DRAFT stubs earlier links leave as a loaded LOINC', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'A', display: 'A', loinc: '25836-8' });
    const stub = await db.selectFrom('terminology_concepts').select('status')
      .where('system', '=', LOINC_SYSTEM).where('code', '=', '25836-8').executeTakeFirstOrThrow();
    expect(stub.status).toBe('DRAFT');
    expect((await catalog.create({ testCode: 'B', display: 'B', loinc: '11111-1' })).loinc).toBe('11111-1');
  });

  it('edits the whole test, keeps keys it does not manage, and keeps the id', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD] });
    // A key set elsewhere, such as `meta` from the Terminology page's Metadata field.
    await db.updateTable('terminology_concepts')
      .set({ properties: JSON.stringify({ shortName: 'VL', category: 'MOL', specimenTypes: [BLD], meta: { owner: 'lab' } }) as never })
      .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', 'HIVVL').execute();

    const updated = await catalog.update('HIVVL', { display: 'HIV-1 viral load', category: null, specimenTypes: [] });
    expect(updated).toMatchObject({ code: 'HIVVL', display: 'HIV-1 viral load', shortName: null, category: null, specimenTypes: [] });
    expect((await storedConcept(db, 'HIVVL')).properties).toEqual({ meta: { owner: 'lab' } });

    await expect(catalog.update('HIVVL', { testCode: null, display: 'x' }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'A test needs a Test code.' });
    await expect(catalog.update('NOPE', { display: 'x' }))
      .rejects.toMatchObject({ kind: 'not-found', message: 'Test NOPE is not in the catalog.' });
  });

  it('relinks and unlinks LOINC, keeping one active link', async () => {
    const { admin, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    const active = async () => (await admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, 'HIVVL'))
      .filter((m) => m.isActive).map((m) => m.toCode);

    expect((await catalog.update('HIVVL', { display: 'HIV viral load', loinc: '20447-9' })).loinc).toBe('20447-9');
    expect(await active()).toEqual(['20447-9']);

    expect((await catalog.update('HIVVL', { display: 'HIV viral load', loinc: null })).loinc).toBeNull();
    expect(await active()).toEqual([]);
  });

  it('retires a test as DEPRECATED, and restores it', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    expect((await catalog.update('HIVVL', { display: 'HIV viral load', active: false })).active).toBe(false);
    expect((await storedConcept(db, 'HIVVL')).status).toBe('DEPRECATED');
    expect(codes(await catalog.list(q()))).toEqual([]);
    expect((await catalog.update('HIVVL', { display: 'HIV viral load', active: true })).active).toBe(true);
    expect(codes(await catalog.list(q()))).toEqual(['HIVVL']);
  });

  it('refuses to add or edit tests once the catalog came from central', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    await markCentral(db);
    await expect(catalog.create({ testCode: 'CD4', display: 'CD4 count' })).rejects.toMatchObject({ kind: 'central-managed' });
    await expect(catalog.update('HIVVL', { display: 'Changed' })).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('signals every edit so labs pull it', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
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
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    const t = await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: '  Viral load ' });
    expect(t.lab).toEqual({ enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
  });

  it('lets a lab narrow the specimen list but never add to it', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
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
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
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
    // 014's four, and the eleven migration 143 adds.
    expect(o.specimenTypes.map((t) => t.display)).toEqual([
      'Ascitic fluid', 'Blood', 'Bone marrow', 'CSF', 'Nasal swab', 'Plasma', 'Pleural fluid', 'Saliva',
      'Serum', 'Sputum', 'Stool', 'Synovial fluid', 'Throat swab', 'Urine', 'Wound specimen',
    ]);
    expect(o.specimenTypes[1]).toEqual({ system: LOCAL, code: 'BLD', display: 'Blood' });
    expect(o.sexes.map((s) => s.code)).toEqual(['male', 'female', 'other', 'unknown']);
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
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    await catalog.setLabSettings('HIVVL', { enabled: false, specimenTypes: [UR], localDisplay: 'Viral load' });
    expect((await catalog.setEnabled('HIVVL', true)).lab).toEqual({ enabled: true, specimenTypes: [UR], localDisplay: 'Viral load' });
    expect((await catalog.setEnabled('HIVVL', false)).lab).toEqual({ enabled: false, specimenTypes: [UR], localDisplay: 'Viral load' });
  });

  it('switches on a test the lab has never touched', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'CD4', display: 'CD4 count' });
    expect((await catalog.setEnabled('CD4', true)).lab).toEqual({ enabled: true, specimenTypes: null, localDisplay: null });
  });

  it('still switches a test on after central dropped a specimen the lab had kept', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD] });
    // The lab kept UR, which the catalog no longer lists, as after a later pull from central.
    await db.insertInto('test_catalog_lab_settings')
      .values({ code: 'HIVVL', enabled: false, specimen_types: JSON.stringify([UR]) }).execute();
    expect((await catalog.setEnabled('HIVVL', true)).lab.enabled).toBe(true);
  });

  it('lets a lab that receives central catalog switch tests, and refuses an unknown test', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    await markCentral(db);
    expect((await catalog.setEnabled('HIVVL', true)).lab.enabled).toBe(true);
    await expect(catalog.setEnabled('NOPE', true))
      .rejects.toMatchObject({ kind: 'not-found', message: 'Test NOPE is not in the catalog.' });
  });

  it('never signals a sync change for a switch', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    const count = async () => (await db.selectFrom('reference_change_log').select('seq').execute()).length;
    const before = await count();
    await catalog.setEnabled('HIVVL', true);
    expect(await count()).toBe(before);
  });

  it('retires and restores a test and changes nothing else', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    expect(await catalog.setActive('HIVVL', false))
      .toMatchObject({ active: false, category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    expect((await storedConcept(db, 'HIVVL')).status).toBe('DEPRECATED');
    expect((await catalog.setActive('HIVVL', true)).active).toBe(true);
    expect((await storedConcept(db, 'HIVVL')).status).toBe('ACTIVE');
  });

  it('retires a test whose LOINC code a later LOINC load does not hold', async () => {
    const { db, catalog } = await buildCatalog();
    // With no LOINC loaded, the link stubs a DRAFT 25836-8. Loading LOINC without it makes a full re-save fail.
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    await expect(catalog.update('HIVVL', { display: 'HIV viral load', loinc: '25836-8', active: false }))
      .rejects.toMatchObject({ kind: 'invalid' });
    expect((await catalog.setActive('HIVVL', false)).active).toBe(false);
  });

  it('signals one sync change per real status change, and none when nothing changes', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
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
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
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
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', category: 'MOL', specimenTypes: [BLD] });
    await catalog.create({ testCode: 'CD4', display: 'CD4 count', category: 'HAEM' });
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
        { line: 5, code: null, reason: 'A test needs a Test code.' },
        { line: 6, code: 'HIVVL', reason: 'Test HIVVL is already on row 2 of this file.' },
      ],
      notes: [],
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
      ['VL1', 'Viral load 1', '', '', 'Virology', 'Semen'],
      ['VL2', 'Viral load 2', '', '', 'virology', 'Blood'],
    ];

    const unanswered = await catalog.importPreview(importInput(rows));
    expect(unanswered.counts).toEqual({ new: 0, changed: 0, unchanged: 0, refused: 2 });
    expect(unanswered.refused).toEqual([
      {
        line: 2, code: 'VL1',
        reason: 'Category "Virology" is not in the test category list. Choose a category for it. '
          + 'Specimen "Semen" is not in the specimen type list. Choose a specimen for it.',
      },
      { line: 3, code: 'VL2', reason: 'Category "virology" is not in the test category list. Choose a category for it.' },
    ]);
    expect(unanswered.unmatched).toEqual({ categories: [{ text: 'Virology', rows: 2 }], specimens: [{ text: 'Semen', rows: 1 }] });

    const answered = await catalog.importPreview(importInput(rows, {
      valueMap: {
        categories: [{ text: 'VIROLOGY', kind: 'new', code: 'VIRO', display: 'Virology' }],
        specimens: [{ text: 'semen', system: LOCAL, code: 'BLD' }],
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
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
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
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
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

describe('test catalog: import apply and export', () => {
  it('writes the rows it can, skips refused ones, and opens one transaction for all of them', async () => {
    const { db, catalog } = await buildCatalog();
    const opened = vi.spyOn(db, 'transaction');
    const report = await catalog.importApply(importInput([
      ['HIVVL', 'HIV viral load', 'VL', '25836-8', 'Virology', 'Blood'],
      ['CD4', 'CD4 count', '', '24467-3', 'HAEM', 'blood; urine'],
      ['', 'No code', '', '', '', ''],
    ], { valueMap: { categories: [{ text: 'Virology', kind: 'new', code: 'VIRO', display: 'Virology' }], specimens: [] } }));

    expect(report.counts).toEqual({ new: 2, changed: 0, unchanged: 0, refused: 1 });
    expect(report.categoriesToAdd).toEqual([{ code: 'VIRO', display: 'Virology' }]);
    // The import's own transaction, then one sync signal for the catalog and one for the categories.
    // A LOINC link that opened a transaction of its own would make this 5.
    expect(opened).toHaveBeenCalledTimes(3);
    expect(await catalog.get('HIVVL')).toMatchObject({
      shortName: 'VL', loinc: '25836-8', category: 'VIRO', specimenTypes: [BLD], active: true,
    });
    expect(await catalog.get('CD4')).toMatchObject({ loinc: '24467-3', category: 'HAEM', specimenTypes: [BLD, UR] });
    // The category ValueSet includes its whole system, so the new category is offered at once.
    expect((await catalog.options()).categories.map((c) => c.code)).toContain('VIRO');
    expect(await catalogGeneration(db)).toBe(1);
    const categories = await db.selectFrom('terminology_systems').select('generation')
      .where('url', '=', TEST_CATEGORY_SYSTEM).executeTakeFirstOrThrow();
    expect(Number(categories.generation)).toBe(1);
  });

  it('clears a field whose mapped cell is empty, and leaves an unmapped one alone', async () => {
    const { admin, catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    const report = await catalog.importApply({
      table: { headers: ['code', 'name', 'short_name', 'loinc'], rows: [['HIVVL', 'HIV viral load', '', '']] },
      columnMap: { code: 'code', name: 'name', shortName: 'short_name', loinc: 'loinc' },
    });
    expect(report.counts.changed).toBe(1);
    expect(await catalog.get('HIVVL')).toMatchObject({ shortName: null, loinc: null, category: 'MOL', specimenTypes: [BLD] });
    const links = await admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, 'HIVVL');
    expect(links.filter((m) => m.isActive)).toEqual([]);
  });

  it('never changes a test status or this lab settings', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    await catalog.setEnabled('HIVVL', true);
    await catalog.setActive('HIVVL', false);
    await catalog.importApply(importInput([['HIVVL', 'HIV-1 viral load', '', '', '', '']]));
    expect(await catalog.get('HIVVL')).toMatchObject({ display: 'HIV-1 viral load', active: false, lab: { enabled: true } });
  });

  it('changes nothing, and signals nothing, when the same file is applied twice', async () => {
    const { db, catalog } = await buildCatalog();
    const file = importInput([
      ['HIVVL', 'HIV viral load', 'VL', '25836-8', 'MOL', 'Blood'],
      ['CD4', 'CD4 count', '', '', 'HAEM', ''],
    ]);
    await catalog.importApply(file);
    const generation = await catalogGeneration(db);
    const opened = vi.spyOn(db, 'transaction');
    expect((await catalog.importApply(file)).counts).toEqual({ new: 0, changed: 0, unchanged: 2, refused: 0 });
    expect(opened).not.toHaveBeenCalled();
    expect(await catalogGeneration(db)).toBe(generation);
  });

  it('exports the active tests in the import layout, and the export imports back unchanged', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR], loinc: '25836-8' });
    await catalog.create({ testCode: 'CD4', display: 'CD4 count, absolute', category: 'HAEM' });
    await catalog.create({ testCode: 'OLD', display: 'Old test' });
    await catalog.setActive('OLD', false);

    const csv = await catalog.exportCsv();
    expect(csv).toBe(
      'id,code,name,short_name,loinc,category,specimen_types,expected_tat_hours,critical_tat_hours,requires_verification,codings\n'
      + 'CD4,CD4,"CD4 count, absolute",,,HAEM,,,,yes,\n'
      + 'HIVVL,HIVVL,HIV viral load,VL,25836-8,MOL,BLD;UR,,,yes,\n',
    );
    const file = readCatalogImportFile(new TextEncoder().encode(csv), 'csv');
    const report = await catalog.importPreview({ table: file, columnMap: file.suggested });
    expect(report.counts).toEqual({ new: 0, changed: 0, unchanged: 2, refused: 0 });
  });

  it('refuses to apply at a lab whose catalog comes from central', async () => {
    const { db, catalog } = await buildCatalog();
    await markCentral(db);
    await expect(catalog.importApply(importInput([['A', 'A', '', '', '', '']]))).rejects.toMatchObject({ kind: 'central-managed' });
  });
});

// The lab list is read through withLabTestsList, as bootstrap builds ops (index.ts, terminology-context.ts).
async function buildWithLabList() {
  const built = await buildCatalog();
  const store = createTerminologyStore(built.db, createFhirStore(built.db));
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c),
    findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q),
    getResourceByUrl: withLabTestsList(built.db, (u) => store.getResourceByUrl(u)),
    translate: (q) => store.translate(q),
  });
  return { ...built, ops };
}

async function labList(ops: Operations, filter?: string): Promise<Array<[string, string | undefined]>> {
  const vs = await ops.expand(LAB_TESTS_VALUE_SET, { count: 100, ...(filter ? { filter } : {}) });
  return (vs.expansion?.contains ?? []).map((c) => [c.code ?? '', c.display]);
}

describe('test catalog: the lab test list', () => {
  it('lists nothing, not the whole catalog, when no test is switched on here', async () => {
    const { catalog, ops } = await buildWithLabList();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    await catalog.create({ testCode: 'CD4', display: 'CD4 count' });
    expect(await labList(ops)).toEqual([]);
  });

  it('lists the active tests switched on here, under the local name when there is one', async () => {
    const { catalog, ops } = await buildWithLabList();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    await catalog.create({ testCode: 'CD4', display: 'CD4 count' });
    await catalog.create({ testCode: 'GLU', display: 'Glucose' });
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
    await catalog.setEnabled('CD4', true);
    expect(await labList(ops)).toEqual([['CD4', 'CD4 count'], ['HIVVL', 'Viral load']]);
  });

  it('drops a retired test, even while it stays switched on', async () => {
    const { catalog, ops } = await buildWithLabList();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    await catalog.setEnabled('HIVVL', true);
    await catalog.setActive('HIVVL', false);
    expect(await labList(ops)).toEqual([]);
  });

  it('searches the local name, and the submit check accepts only listed tests', async () => {
    const { catalog, ops } = await buildWithLabList();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load' });
    await catalog.create({ testCode: 'GLU', display: 'Glucose' });
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
    expect(await labList(ops, 'viral')).toEqual([['HIVVL', 'Viral load']]);
    const check = (code: string) => ops.validateCode({ valueSetUrl: LAB_TESTS_VALUE_SET, code, system: TEST_CATALOG_SYSTEM });
    expect((await check('HIVVL')).result).toBe(true);
    expect((await check('GLU')).result).toBe(false);
  });

  it('keeps a test switched on here through a pull from central', async () => {
    const { db, catalog, ops } = await buildWithLabList();
    const central = [{ code: 'HIVVL', display: 'HIV viral load', status: 'ACTIVE', properties: null }];
    const bulk = createTerminologyBulkSync({
      labDb: db,
      fetchConceptsPage: async () => ({ concepts: central, nextCode: null }),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
      getToken: async () => 'token',
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    await bulk.syncSystem(TEST_CATALOG_SYSTEM, { kind: 'CodeSystem', generation: 1 });
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
    await bulk.syncSystem(TEST_CATALOG_SYSTEM, { kind: 'CodeSystem', generation: 2 });
    expect(await labList(ops)).toEqual([['HIVVL', 'Viral load']]);
  });

  it('reads every other url exactly as stored', async () => {
    const { ops } = await buildWithLabList();
    const categories = (await ops.expand(TEST_CATEGORY_VALUE_SET, { count: 100 })).expansion?.contains?.map((c) => c.code);
    expect(categories).toEqual(expect.arrayContaining(['CHEM', 'HAEM', 'MICRO', 'MOL', 'SERO']));
  });
});

describe('test catalog: what an order needs', () => {
  const test = (code: string) => ({ system: TEST_CATALOG_SYSTEM, code });

  it('offers the specimens at least one chosen test accepts, by this lab narrower list', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    await catalog.create({ testCode: 'GLU', display: 'Glucose', specimenTypes: [BLD, CSF] });
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: [UR], localDisplay: null });
    expect(await catalog.specimensFor([test('HIVVL'), test('GLU')])).toEqual([
      { system: LOCAL, code: 'BLD', display: 'Blood' },
      { system: LOCAL, code: 'CSF', display: 'CSF' },
      { system: LOCAL, code: 'UR', display: 'Urine' },
    ]);
    expect(await catalog.specimensFor([test('HIVVL')])).toEqual([{ system: LOCAL, code: 'UR', display: 'Urine' }]);
  });

  it('offers nothing to narrow by for codings outside the catalog, or tests with no specimens', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'CD4', display: 'CD4 count' });
    expect(await catalog.specimensFor([{ system: LOINC_SYSTEM, code: '718-7' }])).toEqual([]);
    expect(await catalog.specimensFor([test('CD4'), test('NOPE')])).toEqual([]);
  });

  it('names the codings an order writes in front of each catalog test: LOINC when linked, then the Test code', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    await catalog.create({ testCode: 'CD4', display: 'CD4 count' });
    await catalog.create({ testCode: 'GLU', display: 'Glucose', loinc: '2345-7' });
    await catalog.update('GLU', { display: 'Glucose', loinc: null });
    const found = await catalog.orderCodingsFor([test('HIVVL'), test('CD4'), test('GLU'), test('NOPE'), { system: LOINC_SYSTEM, code: '718-7' }]);
    expect([...found].sort(([a], [b]) => a.localeCompare(b))).toEqual([
      [`${TEST_CATALOG_SYSTEM}|CD4`, [{ system: TEST_CODE_SYSTEM, code: 'CD4' }]],
      [`${TEST_CATALOG_SYSTEM}|GLU`, [{ system: TEST_CODE_SYSTEM, code: 'GLU' }]],
      [`${TEST_CATALOG_SYSTEM}|HIVVL`, [{ system: LOINC_SYSTEM, code: '25836-8' }, { system: TEST_CODE_SYSTEM, code: 'HIVVL' }]],
    ]);
  });

  it('keys the codings by the id and names the Test code a test has now', async () => {
    const { catalog } = await buildCatalog({ realIds: true });
    const made = await catalog.create({ testCode: 'VL', display: 'HIV viral load' });
    expect(made.code).toMatch(/^tst-/);
    await catalog.update(made.code, { display: 'HIV viral load', testCode: 'HIVVL2' });
    const found = await catalog.orderCodingsFor([test(made.code)]);
    expect([...found]).toEqual([[`${TEST_CATALOG_SYSTEM}|${made.code}`, [{ system: TEST_CODE_SYSTEM, code: 'HIVVL2' }]]]);
  });
});

/** The site result dictionary, seeded so a test may name parameters from it. */
async function seedResultParams(db: Kysely<InternalSchema>, codes: string[]): Promise<void> {
  for (const code of codes) {
    await db.insertInto('terminology_concepts').values({
      system: 'urn:openldr:default_result', code, display: code, status: 'ACTIVE',
      properties: JSON.stringify({ result_role: 'result', parm_units: 'g/dL' }) as never,
    }).execute();
  }
}

describe('test catalog: result parameters on a test', () => {
  const HGB = { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null,
    bands: [{ name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }] };

  it('keeps the parameters a save writes, bands and all', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    expect((await catalog.get('FBC'))?.resultParams).toEqual([HGB]);
  });

  it('offers each parameter with its default unit, and null for one with none', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await db.insertInto('terminology_concepts').values({
      system: 'urn:openldr:default_result', code: 'WBC', display: 'WBC', status: 'ACTIVE',
      properties: JSON.stringify({ result_role: 'result' }) as never,
    }).execute();
    const params = (await catalog.options()).resultParams;
    expect(params.find((p) => p.code === 'HGB')?.units).toBe('g/dL');
    expect(params.find((p) => p.code === 'WBC')).toMatchObject({ units: null });
  });

  it('names the UCUM system migration 017 seeds, and null without it', async () => {
    const { db, catalog } = await buildCatalog();
    expect((await catalog.options()).ucum).toEqual({ systemId: 'cs-ucum-seed', system: 'http://unitsofmeasure.org' });
    await db.deleteFrom('coding_systems').where('url', '=', 'http://unitsofmeasure.org').execute();
    expect((await catalog.options()).ucum).toBeNull();
  });

  it('answers an empty list for a test that names none', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'CD4', display: 'CD4 count' });
    expect((await catalog.get('CD4'))?.resultParams).toEqual([]);
  });

  it('clears the parameters when a save sends an empty list, and keeps them when it sends none', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    await catalog.update('FBC', { display: 'Full blood count' });
    expect((await catalog.get('FBC'))?.resultParams).toEqual([HGB]);
    await catalog.update('FBC', { display: 'Full blood count', resultParams: [] });
    expect((await catalog.get('FBC'))?.resultParams).toEqual([]);
  });

  it('refuses a parameter that is not in the reportable-result list', async () => {
    const { catalog } = await buildCatalog();
    await expect(catalog.create({
      testCode: 'FBC', display: 'Full blood count',
      resultParams: [{ ...HGB, code: 'NOT-A-PARAM' }],
    })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('refuses a coded parameter that names no value set', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['MRDT']);
    await expect(catalog.create({
      testCode: 'MAL', display: 'Malaria RDT',
      resultParams: [{ system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded', valueSetUrl: null, bands: [] }],
    })).rejects.toMatchObject({ kind: 'invalid' });
  });

  const range = (b: object) => ({ name: null, low: null, high: null, unit: null, sex: null, ageLow: null, ageHigh: null, ...b });

  it('keeps a range name through a save', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ name: 'Highland women', low: 12, high: 16 })] }] });
    expect((await catalog.get('FBC'))?.resultParams[0].bands[0].name).toBe('Highland women');
  });

  it('refuses two ranges with the same name on one parameter, ignoring case', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await expect(catalog.create({
      testCode: 'FBC', display: 'Full blood count',
      resultParams: [{ ...HGB, bands: [range({ name: 'Highland', low: 12, high: 16 }), range({ name: 'highland', low: 11, high: 15 })] }],
    })).rejects.toMatchObject({ kind: 'invalid', message: 'HGB has two ranges named highland.' });
  });

  // The refusal must echo the name as the second range typed it, not lower-cased for the compare.
  // A fixture where both ranges already type the name in lower case cannot show that: the lower-cased
  // compare key and the typed name are the same string either way.
  it('echoes the second range name as typed, not lower-cased', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await expect(catalog.create({
      testCode: 'FBC', display: 'Full blood count',
      resultParams: [{ ...HGB, bands: [range({ name: 'highland', low: 12, high: 16 }), range({ name: 'HIGHLAND', low: 11, high: 15 })] }],
    })).rejects.toMatchObject({ kind: 'invalid', message: 'HGB has two ranges named HIGHLAND.' });
  });

  it('refuses a range whose low is above its high, or whose age from is above its age to', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await expect(catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ low: 16, high: 12 })] }] }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1 has a low above its high.' });
    await expect(catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ ageLow: 20, ageHigh: 15 })] }] }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1 has an age from above its age to.' });
  });

  it('keeps critical limits through a save and a read', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    const withLimits = { ...HGB, bands: [range({ low: 12, high: 15, criticalLow: 7, criticalHigh: 20 }), range({ low: 11, criticalLow: 6 })] };
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [withLimits] });
    const [stored] = (await catalog.get('FBC'))?.resultParams ?? [];
    expect(stored.bands[0]).toMatchObject({ low: 12, high: 15, criticalLow: 7, criticalHigh: 20 });
    expect(stored.bands[1]).toMatchObject({ low: 11, criticalLow: 6 });
    expect('criticalHigh' in stored.bands[1]).toBe(false);
  });

  it('refuses critical limits inside the band or crossed, and allows one alone or at the edge', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    let n = 0;
    const save = (b: object) => catalog.create({ testCode: `FBC${++n}`, display: 'Full blood count', resultParams: [{ ...HGB, bands: [range(b)] }] });
    await expect(save({ low: 12, high: 15, criticalLow: 13 }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1: the critical low limit must be at or below the low limit.' });
    await expect(save({ low: 12, high: 15, criticalHigh: 14 }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1: the critical high limit must be at or above the high limit.' });
    await expect(save({ criticalLow: 20, criticalHigh: 10 }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1: the critical low limit must be below the critical high limit.' });
    await expect(save({ criticalLow: 10, criticalHigh: 10 }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1: the critical low limit must be below the critical high limit.' });
    // Each rule compares only what the band gives, and a limit equal to its edge is allowed.
    await expect(save({ low: 12, high: 15, criticalLow: 12, criticalHigh: 15 })).resolves.toBeDefined();
    await expect(save({ high: 15, criticalLow: 5 })).resolves.toBeDefined();
    await expect(save({ criticalHigh: 20 })).resolves.toBeDefined();
  });

  it('refuses a range whose age unit is not d, mo or y, naming the test, parameter and range', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    const days = { ...range({ ageLow: 0, ageHigh: 28 }), ageUnit: 'days' } as never;
    await expect(catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({}), days] }] }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'FBC: HGB range 2 has the age unit "days". Use d (days), mo (months) or y (years).' });
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    await expect(catalog.update('FBC', { display: 'Full blood count', resultParams: [{ ...HGB, bands: [days] }] }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'FBC: HGB range 1 has the age unit "days". Use d (days), mo (months) or y (years).' });
  });

  it('refuses a range whose sex is not one of the Patient codes', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await expect(catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ sex: 'woman' })] }] }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1 names woman, which is not a sex this install knows.' });
  });
});

describe('test catalog: what a result sheet needs', () => {
  const test = (code: string) => ({ system: TEST_CATALOG_SYSTEM, code });
  const HGB = {
    system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null,
    bands: [
      { name: null, low: 13, high: 17, unit: 'g/dL', sex: 'male', ageLow: 18, ageHigh: null },
      { name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
    ],
  };

  it('answers each test its parameters, with the band that fits the patient', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    const answer = await catalog.resultParamsFor([test('FBC')], { sex: 'female', birthDate: '1996-01-01', at: Date.parse('2026-11-23T12:00:00Z') });
    expect(answer).toEqual([{
      test: { system: TEST_CATALOG_SYSTEM, code: 'FBC', testCode: 'FBC' },
      params: [{
        ...HGB, unit: 'g/dL', display: 'HGB',
        band: { name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
        fits: ['no', 'yes'],
      }],
    }]);
  });

  it('answers a null band when no band fits, rather than a wrong one', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    const answer = await catalog.resultParamsFor([test('FBC')], { sex: null, birthDate: null });
    expect(answer[0].params[0].band).toBeNull();
  });

  it('answers an empty parameter list for a test that names none', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'CD4', display: 'CD4 count' });
    expect(await catalog.resultParamsFor([test('CD4')], {})).toEqual([{ test: { system: TEST_CATALOG_SYSTEM, code: 'CD4', testCode: 'CD4' }, params: [] }]);
  });

  // The order screen shows the Test code. The coding it keys on stays the id.
  it('answers each test its Test code beside its id', async () => {
    const { catalog } = await buildCatalog({ realIds: true });
    const made = await catalog.create({ testCode: 'CD4', display: 'CD4 count' });
    expect(made.code).not.toBe('CD4');
    expect(await catalog.resultParamsFor([test(made.code)], {}))
      .toEqual([{ test: { system: TEST_CATALOG_SYSTEM, code: made.code, testCode: 'CD4' }, params: [] }]);
  });

  it('answers no Test code for an id with no test', async () => {
    const { catalog } = await buildCatalog();
    expect(await catalog.resultParamsFor([test('NOPE')], {})).toEqual([{ test: { system: TEST_CATALOG_SYSTEM, code: 'NOPE' }, params: [] }]);
  });

  it('ignores codings that are not catalog tests', async () => {
    const { catalog } = await buildCatalog();
    expect(await catalog.resultParamsFor([{ system: LOINC_SYSTEM, code: '718-7' }], {})).toEqual([]);
  });

  it('stores a range age unit, reads it back, and fits a newborn by days and a child by years', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    const neonatal = { name: null, low: 14, high: 22, unit: 'g/dL', sex: null, ageLow: 0, ageHigh: 28, ageUnit: 'd' as const };
    const infant = { name: null, low: 10, high: 14, unit: 'g/dL', sex: null, ageLow: 1, ageHigh: 12, ageUnit: 'mo' as const };
    const child = { name: null, low: 11, high: 14, unit: 'g/dL', sex: null, ageLow: 1, ageHigh: 5, ageUnit: 'y' as const };
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [neonatal, infant, child, ...HGB.bands] }] });
    expect((await catalog.get('FBC'))?.resultParams[0].bands.map((b) => b.ageUnit)).toEqual(['d', 'mo', 'y', undefined, undefined]);
    const at = Date.parse('2026-11-23T12:00:00Z');
    const [newborn] = await catalog.resultParamsFor([test('FBC')], { sex: 'female', birthDate: '2026-11-23', at });
    expect(newborn.params[0].band).toEqual(neonatal);
    expect(newborn.params[0].fits).toEqual(['yes', 'no', 'no', 'no', 'no']);
    const [twoYears] = await catalog.resultParamsFor([test('FBC')], { sex: 'female', birthDate: '2024-11-23', at });
    expect(twoYears.params[0].band).toEqual(child);
    expect(twoYears.params[0].fits).toEqual(['no', 'no', 'yes', 'no', 'no']);
  });

  it('answers unknown for a range that names a fact the patient record lacks', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    const answer = await catalog.resultParamsFor([test('FBC')], { sex: null, birthDate: null });
    expect(answer[0].params[0].fits).toEqual(['unknown', 'unknown']);
  });
});

describe('test catalog: turnaround times and verification', () => {
  it('reads null, null and true for a test stored before these fields', async () => {
    const { db, catalog } = await buildCatalog();
    await seedTest(db, 'OLD', 'Old test', { shortName: 'O' });
    expect(await catalog.get('OLD')).toMatchObject({ expectedTatHours: null, criticalTatHours: null, requiresVerification: true });
    expect((await catalog.list(q())).rows[0]).toMatchObject({ expectedTatHours: null, criticalTatHours: null, requiresVerification: true });
  });

  it('stores them as concept properties through create and update, and keeps them when an update leaves them out', async () => {
    const { db, catalog } = await buildCatalog();
    const created = await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', expectedTatHours: 0.5, criticalTatHours: 72, requiresVerification: false });
    expect(created).toMatchObject({ expectedTatHours: 0.5, criticalTatHours: 72, requiresVerification: false });
    expect((await storedConcept(db, 'HIVVL')).properties).toEqual({ expectedTatHours: 0.5, criticalTatHours: 72, requiresVerification: false });

    // Left out keeps them, as the CLI's other edits send a test without them.
    expect(await catalog.update('HIVVL', { display: 'HIV-1 viral load' }))
      .toMatchObject({ expectedTatHours: 0.5, criticalTatHours: 72, requiresVerification: false });

    // null clears a TAT, and true is the default, so neither leaves a key.
    expect(await catalog.update('HIVVL', { display: 'HIV-1 viral load', expectedTatHours: 24, criticalTatHours: null, requiresVerification: true }))
      .toMatchObject({ expectedTatHours: 24, criticalTatHours: null, requiresVerification: true });
    expect((await storedConcept(db, 'HIVVL')).properties).toEqual({ expectedTatHours: 24 });
  });

  it('refuses a TAT that is zero, negative or not a number, and a switch that is not a boolean', async () => {
    const { catalog } = await buildCatalog();
    for (const bad of [{ expectedTatHours: 0 }, { expectedTatHours: -2 }, { criticalTatHours: Number.NaN }, { criticalTatHours: '48' }]) {
      await expect(catalog.create({ testCode: 'X', display: 'X', ...(bad as object) }))
        .rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('must be a positive number of hours') });
    }
    await expect(catalog.create({ testCode: 'X', display: 'X', requiresVerification: 'yes' as never }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'Requires verification must be true or false.' });
    expect(await catalog.get('X')).toBeNull();
  });

  it('keeps the values central sent, and refuses a lab edit of them', async () => {
    const { db, catalog } = await buildCatalog();
    const central = [{
      code: 'HIVVL', display: 'HIV viral load', status: 'ACTIVE',
      properties: { expectedTatHours: 48, criticalTatHours: 96, requiresVerification: false },
    }];
    const bulk = createTerminologyBulkSync({
      labDb: db,
      fetchConceptsPage: async () => ({ concepts: central, nextCode: null }),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
      getToken: async () => 'token',
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    await bulk.syncSystem(TEST_CATALOG_SYSTEM, { kind: 'CodeSystem', generation: 1 });
    expect(await catalog.get('HIVVL')).toMatchObject({ expectedTatHours: 48, criticalTatHours: 96, requiresVerification: false });
    await expect(catalog.update('HIVVL', { display: 'HIV viral load', expectedTatHours: 2 })).rejects.toMatchObject({ kind: 'central-managed' });
    // The lab's own settings do not touch them.
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'VL' });
    expect(await catalog.get('HIVVL')).toMatchObject({ expectedTatHours: 48, criticalTatHours: 96, requiresVerification: false });
  });

  it('imports and exports the three columns, and the export imports back unchanged', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'CD4', display: 'CD4 count', expectedTatHours: 99 });
    const headers = ['code', 'name', 'expected_tat_hours', 'critical_tat_hours', 'requires_verification'];
    const file = readCatalogImportFile(new TextEncoder().encode(
      headers.join(',') + '\nHIVVL,HIV viral load,48,0.5,No\nCD4,CD4 count,,,yes\n',
    ), 'csv');
    expect(file.suggested).toMatchObject({
      expectedTatHours: 'expected_tat_hours', criticalTatHours: 'critical_tat_hours', requiresVerification: 'requires_verification',
    });
    const report = await catalog.importApply({ table: file, columnMap: file.suggested });
    expect(report.counts).toEqual({ new: 1, changed: 1, unchanged: 0, refused: 0 });
    expect(await catalog.get('HIVVL')).toMatchObject({ expectedTatHours: 48, criticalTatHours: 0.5, requiresVerification: false });
    // A mapped empty cell clears, as for every other column.
    expect(await catalog.get('CD4')).toMatchObject({ expectedTatHours: null, criticalTatHours: null, requiresVerification: true });

    const csv = await catalog.exportCsv();
    expect(csv).toContain('HIVVL,HIV viral load,,,,,48,0.5,no,\n');
    const back = readCatalogImportFile(new TextEncoder().encode(csv), 'csv');
    expect((await catalog.importPreview({ table: back, columnMap: back.suggested })).counts)
      .toEqual({ new: 0, changed: 0, unchanged: 2, refused: 0 });
  });

  it('leaves the three alone when their columns are not mapped', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'HIVVL', display: 'HIV viral load', expectedTatHours: 48, requiresVerification: false });
    const report = await catalog.importApply(importInput([['HIVVL', 'HIV-1 viral load', '', '', '', '']]));
    expect(report.counts.changed).toBe(1);
    expect(await catalog.get('HIVVL')).toMatchObject({ display: 'HIV-1 viral load', expectedTatHours: 48, requiresVerification: false });
  });

  it('refuses an import row whose TAT is not a positive number or whose verification is not yes or no', async () => {
    const { catalog } = await buildCatalog();
    const report = await catalog.importPreview({
      table: { headers: ['code', 'name', 'tat', 'critical_tat_hours', 'verify'], rows: [
        ['A', 'A', 'two', '', ''], ['B', 'B', '-1', '', ''], ['C', 'C', '', '', 'maybe'], ['D', 'D', '1.5', '3', 'true'],
      ] },
      columnMap: { code: 'code', name: 'name', expectedTatHours: 'tat', criticalTatHours: 'critical_tat_hours', requiresVerification: 'verify' },
    });
    expect(report.counts).toEqual({ new: 1, changed: 0, unchanged: 0, refused: 3 });
    expect(report.refused.map((r) => [r.code, r.reason])).toEqual([
      ['A', 'Expected TAT "two" is not a number of hours.'],
      ['B', 'The expected turnaround time must be a positive number of hours, not -1.'],
      ['C', 'Requires verification "maybe" must be yes or no.'],
    ]);
  });
});

describe('test catalog: an internal id and a Test code', () => {
  const ID = /^tst-[0-9a-f]{16}$/;

  it('makes ids of tst- and 16 hex characters, a new one each time', () => {
    const a = newTestId();
    const b = newTestId();
    expect(a).toMatch(ID);
    expect(b).toMatch(ID);
    expect(a).not.toBe(b);
  });

  it('gives a new test its own id and stores the Test code as a property', async () => {
    const { db, catalog } = await buildCatalog({ realIds: true });
    const created = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    expect(created.code).toMatch(ID);
    expect(created.testCode).toBe('HB');
    expect((await storedConcept(db, created.code)).properties).toEqual({ testCode: 'HB' });
    expect((await catalog.get(created.code))?.testCode).toBe('HB');
  });

  it('reads a test saved without a Test code by its concept code, and finds it by that code', async () => {
    const { db, catalog } = await buildCatalog({ realIds: true });
    await seedTest(db, 'CD4', 'CD4 count', { category: 'HAEM' });
    expect((await catalog.get('CD4'))?.testCode).toBe('CD4');
    expect(codes(await catalog.list(q({ q: 'cd4' })))).toEqual(['CD4']);
    expect((await catalog.findByTestCode('CD4'))?.code).toBe('CD4');
    // An edit that leaves the Test code out keeps it, and writes no property it does not need.
    await catalog.update('CD4', { display: 'CD4 count, absolute', category: 'HAEM' });
    expect((await storedConcept(db, 'CD4')).properties).toEqual({ category: 'HAEM' });
    expect((await catalog.get('CD4'))?.testCode).toBe('CD4');
  });

  it('searches by Test code and by name', async () => {
    const { catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    await catalog.create({ testCode: 'GLU', display: 'Glucose' });
    expect(codes(await catalog.list(q({ q: 'hb' })))).toEqual([hb.code]);
    expect(codes(await catalog.list(q({ q: 'haemo' })))).toEqual([hb.code]);
  });

  it('refuses a Test code another test holds, counting a saved test by its concept code and a retired test', async () => {
    const { db, catalog } = await buildCatalog({ realIds: true });
    await seedTest(db, 'CD4', 'CD4 count', null);
    await expect(catalog.create({ testCode: 'CD4', display: 'Again' }))
      .rejects.toMatchObject({ kind: 'conflict', message: 'Test code CD4 is already used by CD4 count (CD4).' });

    const old = await catalog.create({ testCode: 'OLD', display: 'Old test' });
    await catalog.setActive(old.code, false);
    await expect(catalog.create({ testCode: 'OLD', display: 'New test' }))
      .rejects.toMatchObject({ kind: 'conflict', message: `Test code OLD is already used by Old test (${old.code}).` });

    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    await expect(catalog.update(hb.code, { testCode: 'CD4', display: 'Haemoglobin' }))
      .rejects.toMatchObject({ kind: 'conflict', message: 'Test code CD4 is already used by CD4 count (CD4).' });
    // A test keeps its own Test code on an edit.
    expect((await catalog.update(hb.code, { testCode: 'HB', display: 'Haemoglobin, total' })).testCode).toBe('HB');
  });

  it('changes a Test code and keeps the id, the lab settings, the LOINC link and the lab-code mappings', async () => {
    const { admin, catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin', loinc: '718-7', specimenTypes: [BLD] });
    await catalog.setLabSettings(hb.code, { enabled: true, specimenTypes: null, localDisplay: 'Hb' });
    // A lab-code mapping, as test mapping writes it, points at the id.
    await admin.termMappings.create({
      fromSystem: 'urn:openldr:disa', fromCode: 'HGB', toSystem: TEST_CATALOG_SYSTEM, toCode: hb.code,
      toDisplay: null, mapType: 'SAME-AS', isActive: true,
    });

    const changed = await catalog.update(hb.code, { testCode: 'HGB', display: 'Haemoglobin', loinc: '718-7', specimenTypes: [BLD] });
    expect(changed).toMatchObject({ code: hb.code, testCode: 'HGB', loinc: '718-7', lab: { enabled: true, localDisplay: 'Hb' } });
    expect((await catalog.findByTestCode('HGB'))?.code).toBe(hb.code);
    expect(await catalog.findByTestCode('HB')).toBeNull();
    const mapped = await admin.termMappings.listOutgoing('urn:openldr:disa', 'HGB');
    expect(mapped.map((m) => m.toCode)).toEqual([hb.code]);
    // The old Test code is not free: earlier orders still carry it (fix round 1 ruling).
    await expect(catalog.create({ testCode: 'HB', display: 'Another' })).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('resolves a Test code first, then an id', async () => {
    const { db, catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    expect((await catalog.resolve('HB'))?.code).toBe(hb.code);
    expect((await catalog.resolve(hb.code))?.code).toBe(hb.code);
    expect(await catalog.resolve('NOPE')).toBeNull();
    // Trimmed and case ignored.
    expect((await catalog.resolve(' hb '))?.code).toBe(hb.code);
    // A saved test whose Test code moved away from its id is still found by both.
    await seedTest(db, 'GLU', 'Glucose', null);
    await catalog.update('GLU', { testCode: 'GLUC', display: 'Glucose' });
    expect((await catalog.resolve('GLU'))?.code).toBe('GLU');
    expect((await catalog.resolve('gluc'))?.code).toBe('GLU');
  });

  it('compares Test codes trimmed and ignoring case, and keeps the one stored as typed', async () => {
    const { catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    await expect(catalog.create({ testCode: ' hb ', display: 'Again' }))
      .rejects.toMatchObject({ kind: 'conflict', message: `Test code HB is already used by Haemoglobin (${hb.code}).` });
    const glu = await catalog.create({ testCode: 'Glu', display: 'Glucose' });
    expect(glu.testCode).toBe('Glu');
    await expect(catalog.update(glu.code, { testCode: 'hb', display: 'Glucose' }))
      .rejects.toMatchObject({ kind: 'conflict', message: `Test code HB is already used by Haemoglobin (${hb.code}).` });
    expect((await catalog.findByTestCode('GLU'))?.code).toBe(glu.code);
  });

  it('refuses a Test code that is another test id, and lets a test use its own id', async () => {
    const { db, catalog } = await buildCatalog({ realIds: true });
    await seedTest(db, 'GLU', 'Glucose', null);
    await catalog.update('GLU', { testCode: 'GLUC', display: 'Glucose' });
    // GLU is no longer a Test code, but it is still the id of the test that had it.
    await expect(catalog.create({ testCode: 'glu', display: 'Glucose, fasting' }))
      .rejects.toMatchObject({ kind: 'conflict', message: 'Test code glu is the id of another test, Glucose (GLU).' });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    await expect(catalog.update(hb.code, { testCode: 'GLU', display: 'Haemoglobin' }))
      .rejects.toMatchObject({ kind: 'conflict', message: 'Test code GLU is the id of another test, Glucose (GLU).' });
    await expect(catalog.create({ testCode: hb.code.toUpperCase(), display: 'Copy' }))
      .rejects.toMatchObject({ kind: 'conflict' });
    // The test itself may go back to its own id.
    expect((await catalog.update('GLU', { testCode: 'glu', display: 'Glucose' })).testCode).toBe('glu');
    // Now GLU's Test code is its own id again, so a row giving it to another test names the holder.
    const report = await catalog.importPreview({
      table: { headers: ['id', 'code', 'name'], rows: [[hb.code, 'GLU', 'Haemoglobin']] },
      columnMap: { id: 'id', code: 'code', name: 'name' },
    });
    expect(report.refused).toEqual([
      { line: 2, code: 'GLU', reason: 'Test code glu is already used by Glucose (GLU).' },
    ]);
  });

  it('exports an id column beside the Test code, and an edited Test code imports back onto the same test', async () => {
    const { catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    const csv = await catalog.exportCsv();
    expect(csv).toBe(
      'id,code,name,short_name,loinc,category,specimen_types,expected_tat_hours,critical_tat_hours,requires_verification,codings\n'
      + `${hb.code},HB,Haemoglobin,,,,,,,yes,\n`,
    );
    const edited = csv.replace(`${hb.code},HB,`, `${hb.code},HGB,`);
    const file = readCatalogImportFile(new TextEncoder().encode(edited), 'csv');
    expect(file.suggested).toMatchObject({ id: 'id', code: 'code' });
    const report = await catalog.importApply({ table: file, columnMap: file.suggested });
    expect(report.counts).toEqual({ new: 0, changed: 1, unchanged: 0, refused: 0 });
    expect((await catalog.list(q())).rows.map((t) => [t.code, t.testCode])).toEqual([[hb.code, 'HGB']]);
  });

  it('matches a row on its Test code trimmed and ignoring case, and makes no second test', async () => {
    const { catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    const report = await catalog.importApply(importInput([['hb', 'Haemoglobin, total', '', '', '', '']]));
    expect(report.counts).toEqual({ new: 0, changed: 1, unchanged: 0, refused: 0 });
    expect((await catalog.list(q())).rows.map((t) => [t.code, t.display])).toEqual([[hb.code, 'Haemoglobin, total']]);
  });

  it('refuses an import row whose Test code is another test id', async () => {
    const { db, catalog } = await buildCatalog({ realIds: true });
    await seedTest(db, 'GLU', 'Glucose', null);
    await catalog.update('GLU', { testCode: 'GLUC', display: 'Glucose' });
    const report = await catalog.importPreview(importInput([['glu', 'Glucose, fasting', '', '', '', '']]));
    expect(report.refused).toEqual([{ line: 2, code: 'glu', reason: 'Test code glu is the id of another test, Glucose (GLU).' }]);
  });

  it('matches a row with no id on its Test code, and makes a new test with its own id for a new one', async () => {
    const { catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    const report = await catalog.importApply(importInput([
      ['HB', 'Haemoglobin, total', '', '', '', ''],
      ['GLU', 'Glucose', '', '', '', ''],
    ]));
    expect(report.counts).toEqual({ new: 1, changed: 1, unchanged: 0, refused: 0 });
    expect((await catalog.get(hb.code))?.display).toBe('Haemoglobin, total');
    const glu = await catalog.findByTestCode('GLU');
    expect(glu?.code).toMatch(ID);
  });

  it('refuses a row with no Test code and a Test code another test or row holds, and adds a row whose id names no test', async () => {
    const { catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    await catalog.create({ testCode: 'GLU', display: 'Glucose' });
    const headers = ['id', 'code', 'name'];
    const report = await catalog.importPreview({
      table: { headers, rows: [
        ['', '', 'No code'],
        ['tst-0000000000000000', 'NEW', 'Made-up id'],
        [hb.code, 'GLU', 'Haemoglobin'],
        ['', 'CRP', 'C-reactive protein'],
        ['', 'CRP', 'C-reactive protein again'],
      ] },
      columnMap: { id: 'id', code: 'code', name: 'name' },
    });
    expect(report.refused).toEqual([
      { line: 2, code: null, reason: 'A test needs a Test code.' },
      { line: 4, code: 'GLU', reason: `Test code GLU is already used by Glucose (${(await catalog.findByTestCode('GLU'))?.code}).` },
      { line: 6, code: 'CRP', reason: 'Test code CRP is already on row 5 of this file.' },
    ]);
    expect(report.counts).toEqual({ new: 2, changed: 0, unchanged: 0, refused: 3 });
  });
});

describe('test catalog: earlier Test codes', () => {
  it('keeps each earlier Test code once, never the current one, and refuses it to another test', async () => {
    const { db, catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    await catalog.update(hb.code, { testCode: 'HGB', display: 'Haemoglobin' });
    expect((await storedConcept(db, hb.code)).properties).toEqual({ testCode: 'HGB', previousTestCodes: ['HB'] });

    // HB still means this test's earlier orders, so no other test may take it, in any case.
    await expect(catalog.create({ testCode: 'hb', display: 'Copy' }))
      .rejects.toMatchObject({ kind: 'conflict', message: 'Test code hb was used by Haemoglobin (' + hb.code + ') before. Earlier orders still carry it.' });
    const glu = await catalog.create({ testCode: 'GLU', display: 'Glucose' });
    await expect(catalog.update(glu.code, { testCode: 'HB', display: 'Glucose' })).rejects.toMatchObject({ kind: 'conflict' });

    // The test itself may go back, and HB is not listed twice.
    await catalog.update(hb.code, { testCode: 'HB', display: 'Haemoglobin' });
    expect((await storedConcept(db, hb.code)).properties).toEqual({ testCode: 'HB', previousTestCodes: ['HGB'] });
    // Earlier orders carry the code as it was spelt, so a spelling that differs only in case is kept
    // for its test_map self row (test identity review, M1).
    await catalog.update(hb.code, { testCode: 'hgb', display: 'Haemoglobin' });
    expect((await storedConcept(db, hb.code)).properties).toEqual({ testCode: 'hgb', previousTestCodes: ['HGB', 'HB'] });
    await catalog.update(hb.code, { testCode: 'HGB', display: 'Haemoglobin' });
    expect((await storedConcept(db, hb.code)).properties).toEqual({ testCode: 'HGB', previousTestCodes: ['HB', 'hgb'] });
  });

  it('keeps an earlier Test code that differs only in case, and publishes a self row for it', async () => {
    const { db, admin, catalog } = await buildCatalog({ realIds: true });
    const externalDb = await makeMigratedExternalDb();
    const mapping = createTestMapping({ internalDb: db, externalDb, admin, logger: { warn: () => {} } });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    await catalog.update(hb.code, { testCode: 'Hb', display: 'Haemoglobin' });
    expect((await storedConcept(db, hb.code)).properties).toEqual({ testCode: 'Hb', previousTestCodes: ['HB'] });
    // Uniqueness still ignores case: no other test may take hb.
    await expect(catalog.create({ testCode: 'hb', display: 'Copy' })).rejects.toMatchObject({ kind: 'conflict' });
    await mapping.publish({ apply: true });
    const rows = await externalDb.selectFrom('test_map').select(['source_code', 'catalog_code'])
      .where('source_system', '=', TEST_CODE_SYSTEM).orderBy('source_code').execute();
    expect(rows).toEqual([{ source_code: 'HB', catalog_code: 'Hb' }, { source_code: 'Hb', catalog_code: 'Hb' }]);
  });

  it('keeps the earlier Test code when an import renames a test, and refuses a row that takes one', async () => {
    const { db, catalog } = await buildCatalog({ realIds: true });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    const columnMap = { id: 'id', code: 'code', name: 'name' };
    const renamed = await catalog.importApply({ table: { headers: ['id', 'code', 'name'], rows: [[hb.code, 'HGB', 'Haemoglobin']] }, columnMap });
    expect(renamed.counts.changed).toBe(1);
    expect((await storedConcept(db, hb.code)).properties).toEqual({ testCode: 'HGB', previousTestCodes: ['HB'] });

    const taken = await catalog.importPreview({ table: { headers: ['id', 'code', 'name'], rows: [['', 'HB', 'Another']] }, columnMap });
    expect(taken.refused).toEqual([
      { line: 2, code: 'HB', reason: `Test code HB was used by Haemoglobin (${hb.code}) before. Earlier orders still carry it.` },
    ]);
  });

  it('publishes a test_map self row for each earlier Test code, all naming the current one', async () => {
    const { db, admin, catalog } = await buildCatalog({ realIds: true });
    const externalDb = await makeMigratedExternalDb();
    const mapping = createTestMapping({ internalDb: db, externalDb, admin, logger: { warn: () => {} } });
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    await catalog.update(hb.code, { testCode: 'HGB', display: 'Haemoglobin' });
    await mapping.publish({ apply: true });
    const rows = await externalDb.selectFrom('test_map').select(['source_system', 'source_code', 'catalog_code'])
      .where('source_system', '=', TEST_CODE_SYSTEM).orderBy('source_code').execute();
    expect(rows).toEqual([
      { source_system: TEST_CODE_SYSTEM, source_code: 'HB', catalog_code: 'HGB' },
      { source_system: TEST_CODE_SYSTEM, source_code: 'HGB', catalog_code: 'HGB' },
    ]);
  });
});


describe('test catalog: identity review fixes', () => {
  const ID = /^tst-[0-9a-f]{16}$/;
  const HEAD = ['id', 'code', 'name'];
  const MAP = { id: 'id', code: 'code', name: 'name' };

  // I2: an id that names no test here falls back to the Test code, else adds a new test with its own id.
  it('imports a file exported from another install into a fresh catalog, with a note on each row', async () => {
    const a = await buildCatalog({ realIds: true });
    const hb = await a.catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    const glu = await a.catalog.create({ testCode: 'GLU', display: 'Glucose' });
    const file = readCatalogImportFile(new TextEncoder().encode(await a.catalog.exportCsv()), 'csv');

    const b = await buildCatalog({ realIds: true });
    const report = await b.catalog.importApply({ table: file, columnMap: file.suggested });
    expect(report.counts).toEqual({ new: 2, changed: 0, unchanged: 0, refused: 0 });
    expect(report.notes).toEqual([
      { line: 2, code: 'GLU', note: `The id ${glu.code} is not in this catalog, so the row adds a new test with an id of its own.` },
      { line: 3, code: 'HB', note: `The id ${hb.code} is not in this catalog, so the row adds a new test with an id of its own.` },
    ]);
    const made = (await b.catalog.list(q())).rows;
    expect(made.map((t) => t.testCode)).toEqual(['GLU', 'HB']);
    for (const t of made) expect(t.code).toMatch(ID);
    expect(made.map((t) => t.code)).not.toContain(hb.code);
    expect(made.map((t) => t.code)).not.toContain(glu.code);
  });

  it('imports that file into a catalog that has one of its Test codes, and updates that test', async () => {
    const a = await buildCatalog({ realIds: true });
    const hb = await a.catalog.create({ testCode: 'HB', display: 'Haemoglobin, total' });
    await a.catalog.create({ testCode: 'GLU', display: 'Glucose' });
    const file = readCatalogImportFile(new TextEncoder().encode(await a.catalog.exportCsv()), 'csv');

    const b = await buildCatalog({ realIds: true });
    const own = await b.catalog.create({ testCode: 'hb', display: 'Haemoglobin' });
    const report = await b.catalog.importApply({ table: file, columnMap: file.suggested });
    expect(report.counts).toEqual({ new: 1, changed: 1, unchanged: 0, refused: 0 });
    expect(report.notes).toContainEqual(
      { line: 3, code: 'HB', note: `The id ${hb.code} is not in this catalog, so the row was matched on its Test code HB.` },
    );
    expect(await b.catalog.get(own.code)).toMatchObject({ testCode: 'HB', display: 'Haemoglobin, total' });
    expect((await b.catalog.list(q())).total).toBe(2);
  });

  // M2: the catalog reads in Test code order, case ignored, then by id.
  it('lists and exports tests in Test code order, not id order', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ testCode: 'A1', display: 'First by id' });
    await catalog.update('A1', { testCode: 'ZZ', display: 'First by id' });
    await catalog.create({ testCode: 'b2', display: 'Second' });
    await catalog.create({ testCode: 'C3', display: 'Third' });
    expect((await catalog.list(q())).rows.map((t) => t.testCode)).toEqual(['b2', 'C3', 'ZZ']);
    const lines = (await catalog.exportCsv()).trim().split(/\r?\n/).slice(1);
    expect(lines.map((l) => l.split(',')[1])).toEqual(['b2', 'C3', 'ZZ']);
  });

  // M7: a row that renames A from X to Y, then a row that gives X to B. X still names A's earlier orders.
  it('refuses a later row that gives another test the code an earlier row renamed away', async () => {
    const { catalog } = await buildCatalog({ realIds: true });
    const a = await catalog.create({ testCode: 'X', display: 'Test A' });
    const b = await catalog.create({ testCode: 'B', display: 'Test B' });
    const report = await catalog.importApply({
      table: { headers: HEAD, rows: [[a.code, 'Y', 'Test A'], [b.code, 'X', 'Test B'], ['', 'X', 'Test C']] },
      columnMap: MAP,
    });
    expect(report.counts).toEqual({ new: 0, changed: 1, unchanged: 0, refused: 2 });
    expect(report.refused.map((r) => [r.line, r.code])).toEqual([[3, 'X'], [4, 'X']]);
    expect(await catalog.get(a.code)).toMatchObject({ testCode: 'Y' });
    expect(await catalog.get(b.code)).toMatchObject({ testCode: 'B' });
    await expect(catalog.update(b.code, { testCode: 'X', display: 'Test B' })).rejects.toMatchObject({ kind: 'conflict' });
  });
});

describe('test catalog: field settings, more types and range fields (plan B, Task 1)', () => {
  const S = 'urn:openldr:default_result';
  const HGB = { system: S, code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null, bands: [] as object[] };
  const range = (b: object) => ({ name: null, low: null, high: null, unit: null, sex: null, ageLow: null, ageHigh: null, ...b });
  const test = (code: string) => ({ system: TEST_CATALOG_SYSTEM, code });

  async function refuses(param: object, message: string) {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB', 'NOTE', 'SEEN', 'SYM']);
    await expect(catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [param as never] }))
      .rejects.toMatchObject({ kind: 'invalid', message });
  }

  it('keeps the field settings, the new types and the range fields through a save', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB', 'NOTE', 'SEEN', 'POS', 'SYM']);
    const params = [
      { ...HGB, required: false, min: 0, max: 30, decimals: 1, bands: [range({
        low: 11, high: 14, pregnancy: 'pregnant', country: 'TZA', validFrom: '2026-01-01', validTo: '2026-12-31', source: 'WHO', scope: 'national',
      })] },
      { system: S, code: 'NOTE', resultType: 'text' as const, valueSetUrl: null, bands: [], minLength: 2, maxLength: 200 },
      { system: S, code: 'SEEN', resultType: 'date' as const, valueSetUrl: null, bands: [], dateLimit: 'past' as const },
      { system: S, code: 'POS', resultType: 'boolean' as const, valueSetUrl: null, bands: [] },
      { system: S, code: 'SYM', resultType: 'multicoded' as const, valueSetUrl: 'urn:x:vs:symptoms', bands: [] },
    ];
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: params as never });
    expect((await catalog.get('FBC'))?.resultParams).toEqual(params);
  });

  it('refuses a min above the max, and negative or fractional decimals', async () => {
    await refuses({ ...HGB, min: 10, max: 5 }, 'HGB has a minimum above its maximum.');
    await refuses({ ...HGB, decimals: -1 }, 'HGB: decimals must be a whole number, 0 or more.');
    await refuses({ ...HGB, decimals: 1.5 }, 'HGB: decimals must be a whole number, 0 or more.');
  });

  it('refuses a minimum length above the maximum length, and a negative length', async () => {
    const NOTE = { system: S, code: 'NOTE', resultType: 'text', valueSetUrl: null, bands: [] };
    await refuses({ ...NOTE, minLength: 10, maxLength: 5 }, 'NOTE has a minimum length above its maximum length.');
    await refuses({ ...NOTE, maxLength: -1 }, 'NOTE: the maximum length must be a whole number, 0 or more.');
  });

  it('refuses a date limit it does not know, and a setting of another type', async () => {
    const SEEN = { system: S, code: 'SEEN', resultType: 'date', valueSetUrl: null, bands: [] };
    await refuses({ ...SEEN, dateLimit: 'yesterday' }, 'SEEN has the date limit "yesterday". Use any, past or future.');
    await refuses({ ...SEEN, min: 1 }, 'SEEN is a date field, so it cannot have min.');
    await refuses({ ...HGB, maxLength: 4 }, 'HGB is a numeric field, so it cannot have maxLength.');
  });

  it('refuses required that is not true or false', async () => {
    await refuses({ ...HGB, required: 'yes' }, 'HGB: required must be true or false.');
  });

  it('refuses a multicoded param without a value set', async () => {
    await refuses({ system: S, code: 'SYM', resultType: 'multicoded', valueSetUrl: null, bands: [] }, 'SYM is a several-answer result and needs a value set.');
  });

  it('refuses a country not in the country value set, valid dates the wrong way round, and an unknown source or scope', async () => {
    await refuses({ ...HGB, bands: [range({ country: 'XXX' })] }, 'HGB range 1 names the country XXX, which is not in the country list.');
    await refuses({ ...HGB, bands: [range({ validFrom: '2026-06-01', validTo: '2026-01-01' })] }, 'HGB range 1 is valid from a date after its valid to date.');
    await refuses({ ...HGB, bands: [range({ validFrom: '2026-02-30' })] }, 'HGB range 1 has the valid from date "2026-02-30". Use a date such as 2026-01-31.');
    await refuses({ ...HGB, bands: [range({ source: 'Mayo' })] }, 'HGB range 1 has the source "Mayo". Use WHO, CLSI, EUCAST, national or facility.');
    await refuses({ ...HGB, bands: [range({ scope: 'world' })] }, 'HGB range 1 has the scope "world". Use global, national or facility.');
    await refuses({ ...HGB, bands: [range({ pregnancy: 'yes' })] }, 'HGB range 1 has the pregnancy "yes". Use pregnant, not-pregnant or any.');
  });

  it('accepts a country from the country value set', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ country: 'TZA' })] }] as never });
    expect((await catalog.get('FBC'))?.resultParams[0].bands[0].country).toBe('TZA');
  });

  it('passes the lab country into the fit', async () => {
    const at = Date.parse('2026-11-23T12:00:00Z');
    const bands = [range({ low: 1, country: 'TZA' }), range({ low: 2, country: 'KEN' }), range({ low: 3 })];
    for (const [labCountry, fits, low] of [
      ['TZA', ['yes', 'no', 'yes'], 1], ['KEN', ['no', 'yes', 'yes'], 2], [null, ['unknown', 'unknown', 'yes'], 3],
    ] as const) {
      const { db, catalog } = await buildCatalog({ labCountry });
      await seedResultParams(db, ['HGB']);
      await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands }] as never });
      const [answer] = await catalog.resultParamsFor([test('FBC')], { sex: null, birthDate: null, at });
      expect(answer.params[0].fits).toEqual(fits);
      expect(answer.params[0].band?.low).toBe(low);
    }
  });

  it('uses the country saved in the lab settings', async () => {
    const rows = new Map<string, string>();
    const appStore = {
      get: async (k: string) => (rows.has(k) ? { key: k, value: rows.get(k)!, updatedAt: '', updatedBy: null } : undefined),
      set: async (k: string, v: string) => { rows.set(k, v); },
    } as never;
    let identity: ReturnType<typeof createLabIdentity> | null = null;
    const { db, catalog } = await buildCatalog({
      labIdentity: (ops) => {
        identity = createLabIdentity(appStore, { countries: () => countryCodes(ops) });
        return () => labCountry(identity);
      },
    });
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ low: 1, country: 'TZA' }), range({ low: 3 })] }] as never });
    expect(await identity!.set({ 'lab.country': 'XXX' }, 'tester')).toEqual([{ key: 'lab.country', reason: 'invalid-country' }]);
    expect(await identity!.set({ 'lab.country': 'KEN' }, 'tester')).toEqual([]);
    const [answer] = await catalog.resultParamsFor([test('FBC')], {});
    expect(answer.params[0].fits).toEqual(['no', 'yes']);
  });

  it('answers a band with no country when the catalog has no country dependency', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ low: 1, country: 'TZA' }), range({ low: 3 })] }] as never });
    const [answer] = await catalog.resultParamsFor([test('FBC')], {});
    expect(answer.params[0].fits).toEqual(['unknown', 'yes']);
  });

  it('answers the field settings to the bench', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ testCode: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, required: false, min: 0, decimals: 2 }] as never });
    const [answer] = await catalog.resultParamsFor([test('FBC')], {});
    expect(answer.params[0]).toMatchObject({ required: false, min: 0, decimals: 2 });
  });
});

describe('test catalog: additional codings (plan B, Task 5)', () => {
  const EXTRA = 'urn:test:cs:extra';
  const OTHER = 'urn:test:cs:other';
  const test = (code: string) => ({ system: TEST_CATALOG_SYSTEM, code });

  /** A loaded coding system: a coding_systems row and its concepts. */
  async function loadSystem(db: Kysely<InternalSchema>, url: string, concepts: Array<[string, string]>): Promise<void> {
    await db.insertInto('coding_systems').values({
      id: `cs-${url}`, system_code: url, system_name: url, url, active: true, publisher_id: 'pub-system', seeded: false,
    } as never).execute();
    for (const [code, display] of concepts) {
      await db.insertInto('terminology_concepts').values({ system: url, code, display, status: 'ACTIVE', properties: null }).execute();
    }
  }

  async function withSystems() {
    const built = await buildCatalog();
    await loadSystem(built.db, EXTRA, [['X1', 'Extra one'], ['X2', 'Extra two']]);
    await loadSystem(built.db, OTHER, [['O1', 'Other one']]);
    return built;
  }

  it('stores codings on create, reads them back with the concept name, and defaults the purpose to additional', async () => {
    const { db, catalog } = await withSystems();
    const made = await catalog.create({
      testCode: 'GLU', display: 'Glucose',
      codings: [{ system: EXTRA, code: 'X1', display: 'typed name', note: '  for reports  ' }, { system: OTHER, code: 'O1', purpose: 'INDICATION' }],
    });
    expect(made.codings).toEqual([
      { system: EXTRA, code: 'X1', display: 'Extra one', purpose: 'ADDITIONAL', note: 'for reports' },
      { system: OTHER, code: 'O1', display: 'Other one', purpose: 'INDICATION', note: null },
    ]);
    expect((await storedConcept(db, 'GLU')).properties).toEqual({
      codings: [
        { system: EXTRA, code: 'X1', display: 'Extra one', purpose: 'ADDITIONAL', note: 'for reports' },
        { system: OTHER, code: 'O1', display: 'Other one', purpose: 'INDICATION' },
      ],
    });
    expect((await catalog.get('GLU'))?.codings).toEqual(made.codings);
  });

  it('reads no codings for a test saved before them', async () => {
    const { catalog } = await withSystems();
    expect((await catalog.create({ testCode: 'GLU', display: 'Glucose' })).codings).toEqual([]);
  });

  it('replaces the codings on update, keeps them when an update leaves them out, and clears them with an empty list', async () => {
    const { catalog } = await withSystems();
    await catalog.create({ testCode: 'GLU', display: 'Glucose', codings: [{ system: EXTRA, code: 'X1' }] });
    const edited = await catalog.update('GLU', { display: 'Glucose', codings: [{ system: EXTRA, code: 'X2', purpose: 'CATEGORY' }] });
    expect(edited.codings).toEqual([{ system: EXTRA, code: 'X2', display: 'Extra two', purpose: 'CATEGORY', note: null }]);
    expect((await catalog.update('GLU', { display: 'Glucose 2' })).codings).toHaveLength(1);
    expect((await catalog.update('GLU', { display: 'Glucose', codings: [] })).codings).toEqual([]);
  });

  it('refuses a coding with no system or code, a system not loaded, a code not in it, an unknown purpose and a repeat', async () => {
    const { catalog } = await withSystems();
    const cases: Array<[unknown, string]> = [
      [[{ system: ' ', code: 'X1' }], 'Coding 1 needs a system.'],
      [[{ system: EXTRA, code: '' }], 'Coding 1 needs a code.'],
      [[{ system: 'urn:test:cs:missing', code: 'X1' }], 'Coding 1 names the system urn:test:cs:missing, which is not loaded on this install.'],
      [[{ system: EXTRA, code: 'X9' }], `Coding 1: X9 is not in ${EXTRA}.`],
      [[{ system: EXTRA, code: 'X1', purpose: 'PRIMARY' }], 'Coding 1 has the purpose "PRIMARY". Use ADDITIONAL, INDICATION, PROCEDURE or CATEGORY.'],
      [[{ system: EXTRA, code: 'X1' }, { system: EXTRA, code: 'X1', purpose: 'INDICATION' }], `Coding 2 repeats ${EXTRA} X1.`],
      [[{ system: TEST_CATALOG_SYSTEM, code: 'GLU' }], `Coding 1: ${TEST_CATALOG_SYSTEM} holds the catalog's own codes, so it cannot be an additional coding.`],
      ['X1', 'Codings must be a list.'],
    ];
    for (const [codings, message] of cases) {
      await expect(catalog.create({ testCode: 'GLU', display: 'Glucose', codings: codings as never }))
        .rejects.toMatchObject({ kind: 'invalid', message });
    }
  });

  it('exports codings as a JSON column, and the export imports back unchanged', async () => {
    const { catalog } = await withSystems();
    await catalog.create({
      testCode: 'GLU', display: 'Glucose',
      codings: [{ system: EXTRA, code: 'X1', note: 'a, "quoted" note' }, { system: OTHER, code: 'O1', purpose: 'PROCEDURE' }],
    });
    await catalog.create({ testCode: 'CD4', display: 'CD4 count' });
    const csv = await catalog.exportCsv();
    expect(csv.split('\n')[0]).toBe(
      'id,code,name,short_name,loinc,category,specimen_types,expected_tat_hours,critical_tat_hours,requires_verification,codings',
    );
    const file = readCatalogImportFile(new TextEncoder().encode(csv), 'csv');
    expect(file.suggested.codings).toBe('codings');
    expect((await catalog.importPreview({ table: file, columnMap: file.suggested })).counts)
      .toEqual({ new: 0, changed: 0, unchanged: 2, refused: 0 });
  });

  it('imports a codings cell, counts a changed one as changed, refuses one that is not a JSON list, and leaves them alone when unmapped', async () => {
    const { catalog } = await withSystems();
    await catalog.create({ testCode: 'GLU', display: 'Glucose', codings: [{ system: EXTRA, code: 'X1' }] });
    const headers = ['code', 'name', 'codings'];
    const table = (cell: string) => ({ headers, rows: [['GLU', 'Glucose', cell]] });
    const columnMap = { code: 'code', name: 'name', codings: 'codings' };
    const changed = JSON.stringify([{ system: EXTRA, code: 'X2' }]);
    expect((await catalog.importPreview({ table: table(changed), columnMap })).counts).toMatchObject({ changed: 1, unchanged: 0 });
    const bad = await catalog.importPreview({ table: table('X2'), columnMap });
    expect(bad.refused).toEqual([{ line: 2, code: 'GLU', reason: 'Codings "X2" must be a JSON list of codings.' }]);
    const missing = await catalog.importPreview({ table: table(JSON.stringify([{ system: EXTRA, code: 'X9' }])), columnMap });
    expect(missing.refused[0].reason).toBe(`Coding 1: X9 is not in ${EXTRA}.`);
    await catalog.importApply({ table: table(changed), columnMap });
    expect((await catalog.get('GLU'))?.codings.map((c) => c.code)).toEqual(['X2']);
    // A mapped empty cell clears; an unmapped column keeps.
    await catalog.importApply({ table: { headers: ['code', 'name'], rows: [['GLU', 'Glucose']] }, columnMap: { code: 'code', name: 'name' } });
    expect((await catalog.get('GLU'))?.codings.map((c) => c.code)).toEqual(['X2']);
    await catalog.importApply({ table: table(''), columnMap });
    expect((await catalog.get('GLU'))?.codings).toEqual([]);
  });

  it('writes the codings after LOINC and the Test code on an order, so the first coding does not change', async () => {
    const { catalog } = await withSystems();
    await catalog.create({ testCode: 'GLU', display: 'Glucose', loinc: '2345-7', codings: [{ system: EXTRA, code: 'X1' }, { system: OTHER, code: 'O1' }] });
    await catalog.create({ testCode: 'CD4', display: 'CD4 count', codings: [{ system: EXTRA, code: 'X2' }] });
    const found = await catalog.orderCodingsFor([test('GLU'), test('CD4')]);
    expect(found.get(`${TEST_CATALOG_SYSTEM}|GLU`)).toEqual([
      { system: LOINC_SYSTEM, code: '2345-7' }, { system: TEST_CODE_SYSTEM, code: 'GLU' },
      { system: EXTRA, code: 'X1' }, { system: OTHER, code: 'O1' },
    ]);
    expect(found.get(`${TEST_CATALOG_SYSTEM}|CD4`)).toEqual([{ system: TEST_CODE_SYSTEM, code: 'CD4' }, { system: EXTRA, code: 'X2' }]);
  });
});
