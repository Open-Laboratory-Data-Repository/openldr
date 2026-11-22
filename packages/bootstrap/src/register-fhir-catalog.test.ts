import { describe, it, expect, beforeAll } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import {
  createFhirStore, createTerminologyStore, createTerminologyAdminStore, readBundledTerminology, BUNDLED_TERMINOLOGY,
  type InternalSchema, type TerminologyAdminStore, type ValueSetProjection,
} from '@openldr/db';
import { createOperations, type Operations } from '@openldr/terminology';
import { catalogStoredExpansion, registerFhirCatalogValueSets } from './register-fhir-catalog';
import { seedFhirValueSetCatalog } from './seed';

const GENDER = 'http://hl7.org/fhir/ValueSet/administrative-gender';

// The terminology context bootstrap builds (terminology-context.ts), over a migrated pg-mem db.
// Mirrors test-catalog.test.ts.
async function build(): Promise<{ db: Kysely<InternalSchema>; admin: TerminologyAdminStore; ops: Operations }> {
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
    storedExpansion: catalogStoredExpansion(admin),
  });
  return { db, admin, ops };
}

async function counts(db: Kysely<InternalSchema>) {
  const n = async (table: 'fhir.fhir_current' | 'fhir.resource_history' | 'fhir.change_log' | 'terminology_systems') => {
    const r = await db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    return Number(r?.n ?? 0);
  };
  return {
    current: await n('fhir.fhir_current'),
    history: await n('fhir.resource_history'),
    changeLog: await n('fhir.change_log'),
    systems: await n('terminology_systems'),
  };
}

describe('registerFhirCatalogValueSets', () => {
  let ctx: Awaited<ReturnType<typeof build>>;
  let catalogCount = 0;
  let firstRun = 0;
  let changeLogBefore = 0;

  beforeAll(async () => {
    ctx = await build();
    const catalog = await readBundledTerminology(BUNDLED_TERMINOLOGY.fhirR4Catalog);
    const imported = await ctx.admin.valueSets.importFhirCatalog(catalog);
    catalogCount = imported.imported;
    // An install whose operator already registered one catalog set some other way keeps that row.
    const held = await ctx.admin.valueSets.getByUrl('http://hl7.org/fhir/ValueSet/address-use');
    await ctx.db.insertInto('terminology_systems')
      .values({ url: held!.url, version: null, kind: 'ValueSet', resource_id: 'held-elsewhere' }).execute();
    changeLogBefore = (await counts(ctx.db)).changeLog;
    firstRun = (await registerFhirCatalogValueSets(ctx.db)).registered;
  }, 120_000);

  it('registers every catalog set that had no terminology_systems row', () => {
    expect(catalogCount).toBeGreaterThan(100);
    expect(firstRun).toBe(catalogCount - 1);
  });

  it('makes administrative-gender expand to its four codes', async () => {
    const r = await ctx.ops.expand(GENDER, {});
    expect(r.expansion?.contains?.map((c) => c.code).sort()).toEqual(['female', 'male', 'other', 'unknown']);
    expect(r.expansion?.total).toBe(4);
  });

  it('leaves a terminology_systems row it did not write alone', async () => {
    const row = await ctx.db.selectFrom('terminology_systems').select('resource_id')
      .where('url', '=', 'http://hl7.org/fhir/ValueSet/address-use').executeTakeFirst();
    expect(row?.resource_id).toBe('held-elsewhere');
  });

  it('writes no change_log row, so nothing syncs', async () => {
    const catalogIds = (await ctx.db.selectFrom('value_sets').select('id')
      .where('publisher_id', '=', 'pub-hl7-fhir').where('url', 'like', 'http://hl7.org/%').execute()).map((r) => r.id);
    const rows = await ctx.db.selectFrom('fhir.change_log').select('seq')
      .where('resource_type', '=', 'ValueSet').where('resource_id', 'in', catalogIds).execute();
    expect(rows).toEqual([]);
    expect((await counts(ctx.db)).changeLog).toBe(changeLogBefore);
  });

  it('a second run registers nothing and writes nothing', async () => {
    const before = await counts(ctx.db);
    expect(await registerFhirCatalogValueSets(ctx.db)).toEqual({ registered: 0 });
    expect(await counts(ctx.db)).toEqual(before);
  });

  it('a value set saved through save still expands from its concepts', async () => {
    const system = 'urn:test:cs:register-catalog';
    await ctx.db.insertInto('terminology_concepts').values([
      { system, code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null },
      { system, code: 'B', display: 'Beta', status: 'ACTIVE', properties: null },
    ] as never).execute();
    const url = 'urn:test:vs:register-catalog';
    await ctx.admin.valueSets.save({ url, status: 'active', compose: { include: [{ system }] } });
    // The stored expansion is made stale, so a result from it would show here.
    const saved = await ctx.admin.valueSets.getByUrl(url);
    await ctx.db.insertInto('valueset_expansions')
      .values({ value_set_id: saved!.id, system_url: system, code: 'STALE', display: 'Stale', inactive: false } as never).execute();
    const r = await ctx.ops.expand(url, {});
    expect(r.expansion?.contains?.map((c) => c.code)).toEqual(['A', 'B']);
  });

  it('a saved set whose compose finds nothing stays empty, whatever codes it has stored', async () => {
    const url = 'urn:test:vs:register-catalog-empty';
    const system = 'urn:test:cs:register-catalog-empty';
    await ctx.admin.valueSets.save({ url, status: 'active', compose: { include: [{ system }] } });
    const saved = await ctx.admin.valueSets.getByUrl(url);
    await ctx.db.insertInto('valueset_expansions')
      .values({ value_set_id: saved!.id, system_url: system, code: 'STALE', display: 'Stale', inactive: false } as never).execute();
    const r = await ctx.ops.expand(url, {});
    expect(r.expansion?.total).toBe(0);
    expect(r.expansion?.contains).toEqual([]);
  });
});

describe('the boot seed repairs an install that imported the catalog earlier', () => {
  it('registers the held sets even when the import itself is skipped', async () => {
    const { db, admin, ops } = await build();
    // A one-set catalog stands in for an earlier import: a catalog URL is present, so the seed skips
    // the import and only the registration step runs.
    await admin.valueSets.importFhirCatalog({
      version: '4.0.1',
      valueSets: [{
        url: GENDER, version: '4.0.1', name: 'AdministrativeGender', status: 'active',
        compose: { include: [{ system: 'http://hl7.org/fhir/administrative-gender' }] },
        expansion: ['male', 'female', 'other', 'unknown'].map((code) => ({ system: 'http://hl7.org/fhir/administrative-gender', code, display: code })),
      }],
    });
    await expect(ops.expand(GENDER, {})).rejects.toThrow(/not found/);
    expect(await seedFhirValueSetCatalog({ terminology: { admin }, internalDb: db })).toBe(0);
    const r = await ops.expand(GENDER, {});
    expect(r.expansion?.contains?.map((c) => c.code).sort()).toEqual(['female', 'male', 'other', 'unknown']);
  });
});
