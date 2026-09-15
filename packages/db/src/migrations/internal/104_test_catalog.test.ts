import { describe, expect, it } from 'vitest';
import { makeMigratedDb, makeMigratedDbUpTo } from './test-helpers';
import { up, down, CATALOG_SYSTEM, CATEGORY_SYSTEM, CATEGORY_VALUE_SET } from './104_test_catalog';

describe('104 test catalog', () => {
  it('seeds the catalog and category systems under the System publisher', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('coding_systems').select(['id', 'url', 'publisher_id', 'seeded'])
      .where('url', 'in', [CATALOG_SYSTEM, CATEGORY_SYSTEM]).orderBy('id').execute();
    expect(rows).toEqual([
      { id: 'cs-url-TEST-CATALOG', url: CATALOG_SYSTEM, publisher_id: 'pub-system', seeded: true },
      { id: 'cs-url-TEST-CATEGORY', url: CATEGORY_SYSTEM, publisher_id: 'pub-system', seeded: true },
    ]);
  });

  it('seeds the five starting categories as active concepts', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('terminology_concepts').select(['code', 'display', 'status'])
      .where('system', '=', CATEGORY_SYSTEM).orderBy('code').execute();
    expect(rows).toEqual([
      { code: 'CHEM', display: 'Chemistry', status: 'ACTIVE' },
      { code: 'HAEM', display: 'Haematology', status: 'ACTIVE' },
      { code: 'MICRO', display: 'Microbiology', status: 'ACTIVE' },
      { code: 'MOL', display: 'Molecular', status: 'ACTIVE' },
      { code: 'SERO', display: 'Serology', status: 'ACTIVE' },
    ]);
  });

  it('registers the category ValueSet and writes no fhir.change_log row for it', async () => {
    const db = await makeMigratedDb();
    const reg = await db.selectFrom('terminology_systems').select(['kind', 'resource_id'])
      .where('url', '=', CATEGORY_VALUE_SET).executeTakeFirstOrThrow();
    expect(reg).toEqual({ kind: 'ValueSet', resource_id: 'vs-test-category' });
    const canonical = await db.selectFrom('fhir.fhir_resources').select('id')
      .where('resource_type', '=', 'ValueSet').where('id', '=', 'vs-test-category').execute();
    expect(canonical).toHaveLength(1);
    const logged = await db.selectFrom('fhir.change_log').select('seq')
      .where('resource_type', '=', 'ValueSet').where('resource_id', '=', 'vs-test-category').execute();
    expect(logged).toEqual([]);
  });

  it('creates the lab settings table with a test switched off by default', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('test_catalog_lab_settings').values({ code: 'HIVVL' }).execute();
    const row = await db.selectFrom('test_catalog_lab_settings').selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ code: 'HIVVL', enabled: false, specimen_types: null, local_display: null });
  });

  it('keeps a system already at the catalog url instead of replacing it', async () => {
    // Stops at 103 rather than calling down() first: pg-mem's DROP TABLE keeps the table's
    // primary key index name, so a second up() fails on "test_catalog_lab_settings_pkey already
    // exists". Postgres drops the index with the table. Same approach as 077's test.
    const db = await makeMigratedDbUpTo('103_lab_order_requisition_slot');
    await db.insertInto('coding_systems').values({
      id: 'cs-operator-made', system_code: 'MY-CATALOG', system_name: 'Mine', url: CATALOG_SYSTEM,
      active: true, publisher_id: 'pub-system', seeded: false,
    } as never).execute();
    await up(db as never);
    const rows = await db.selectFrom('coding_systems').select('id').where('url', '=', CATALOG_SYSTEM).execute();
    expect(rows).toEqual([{ id: 'cs-operator-made' }]);
  });

  it('down removes what up seeded', async () => {
    const db = await makeMigratedDb();
    await down(db as never);
    expect(await db.selectFrom('coding_systems').select('id').where('url', 'in', [CATALOG_SYSTEM, CATEGORY_SYSTEM]).execute()).toEqual([]);
    expect(await db.selectFrom('terminology_concepts').select('code').where('system', '=', CATEGORY_SYSTEM).execute()).toEqual([]);
    expect(await db.selectFrom('value_sets').select('id').where('url', '=', CATEGORY_VALUE_SET).execute()).toEqual([]);
    expect(await db.selectFrom('terminology_systems').select('url').where('url', '=', CATEGORY_VALUE_SET).execute()).toEqual([]);
  });
});
