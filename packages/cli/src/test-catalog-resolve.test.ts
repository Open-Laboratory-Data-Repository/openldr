import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import { createFhirStore, createTerminologyAdminStore, createTerminologyStore, type ValueSetProjection } from '@openldr/db';
import { createOperations } from '@openldr/terminology';

// The CLI commands over a real catalog on pg-mem, so the way they find a test (Test code trimmed and
// case ignored, then id) is the service's own, not a mock's.
const mocks = vi.hoisted(() => ({ createAppContext: vi.fn(), recordAuditEvent: vi.fn() }));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock('./cli-actor', () => ({ cliActor: () => ({ actorType: 'cli', actorId: null, actorName: 'tester' }) }));
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return { ...actual, createAppContext: mocks.createAppContext, recordAuditEvent: mocks.recordAuditEvent };
});

import { createTestCatalog, createTestMapping, TEST_CATALOG_SYSTEM } from '@openldr/bootstrap';
import { runTestCatalogChange, runTestCatalogSet } from './test-catalog';
import { runTestMappingSet } from './test-mapping';

async function realCatalog() {
  const db = await makeMigratedDb();
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(resource) {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url, version, kind, resourceId) { await store.saveSystem(url, version, kind, resourceId); },
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
  const catalog = createTestCatalog({ db, admin, ops });
  const externalDb = await makeMigratedExternalDb();
  const testMapping = createTestMapping({ internalDb: db, externalDb, admin, logger: { warn: () => {} } });
  mocks.createAppContext.mockResolvedValue({ testCatalog: catalog, testMapping, close: async () => {} });
  return Object.assign(catalog, { db, externalDb });
}

describe('openldr test-catalog over a real catalog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.createAppContext.mockReset();
    mocks.recordAuditEvent.mockReset();
  });

  it('finds HB when given " hb ", and acts on its id', async () => {
    const catalog = await realCatalog();
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    expect(await runTestCatalogChange('enable', ' hb ', { json: false })).toBe(0);
    expect(out.join('')).toBe('HB is now on at this lab.\n');
    expect((await catalog.get(hb.code))?.lab.enabled).toBe(true);
    expect(mocks.recordAuditEvent.mock.calls[0][2]).toMatchObject({ entityId: hb.code });
  });

  it('set --test-code renames the test it finds, and refuses a code another test holds in any case', async () => {
    const catalog = await realCatalog();
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    await catalog.create({ testCode: 'GLU', display: 'Glucose' });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    expect(await runTestCatalogSet('hb', { testCode: 'HGB', json: false })).toBe(0);
    expect((await catalog.get(hb.code))?.testCode).toBe('HGB');
    expect(await runTestCatalogSet('HGB', { testCode: 'glu', json: false })).toBe(1);
    expect(err.join('')).toContain('Test code GLU is already used by Glucose');
  });

  it('map set finds its target by Test code, then id, stores the id, and publishes the Test code', async () => {
    const catalog = await realCatalog();
    const hb = await catalog.create({ testCode: 'HB', display: 'Haemoglobin' });
    const glu = await catalog.create({ testCode: 'GLU', display: 'Glucose' });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stored = (code: string) => catalog.db.selectFrom('term_mappings').select('to_code')
      .where('from_system', '=', 'urn:disa').where('from_code', '=', code)
      .where('to_system', '=', TEST_CATALOG_SYSTEM).where('is_active', '=', true).execute();

    expect(await runTestMappingSet('urn:disa', 'HGB', ' hb ', { json: false })).toBe(0);
    expect(await stored('HGB')).toEqual([{ to_code: hb.code }]);
    expect(await runTestMappingSet('urn:disa', 'GLUC', glu.code, { json: false })).toBe(0);
    expect(await stored('GLUC')).toEqual([{ to_code: glu.code }]);
    expect(mocks.recordAuditEvent.mock.calls[0][2]).toMatchObject({ after: { catalogCode: hb.code } });
    const published = await catalog.externalDb.selectFrom('test_map').select(['source_code', 'catalog_code'])
      .where('source_system', '=', 'urn:disa').orderBy('source_code').execute();
    expect(published).toEqual([{ source_code: 'GLUC', catalog_code: 'GLU' }, { source_code: 'HGB', catalog_code: 'HB' }]);
    expect(await runTestMappingSet('urn:disa', 'X', 'NOPE', { json: false })).toBe(1);
  });
});
