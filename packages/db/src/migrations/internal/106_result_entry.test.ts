import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  LAB_ORDER_RESULTS_FIELDS_SNAPSHOT,
  ORDER_REJECT_VALUE_SET,
  TEST_REJECT_VALUE_SET,
  up,
  down,
} from './106_result_entry';
// Imported to PROVE this migration's frozen copy still matches what 105 actually shipped.
// The migration itself must never import it.
import { LAB_ORDER_CATALOG_FIELDS_SNAPSHOT as SHIPPED_105 } from './105_lab_order_test_catalog';

async function seedOrderForm(db: any, fields: readonly unknown[], id = 'form-sample-order'): Promise<void> {
  await db.insertInto('form_definitions').values({
    id, name: 'Lab order', status: 'published', active: true,
    target_pages: JSON.stringify(['forms']),
    schema: JSON.stringify({ id, name: 'Lab order', fields, targetPages: ['forms'] }),
  } as never).execute();
}

async function readFields(db: any): Promise<unknown> {
  const row = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').executeTakeFirst();
  const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
  return schema.fields;
}

async function freshDb(): Promise<any> {
  const db = await makeMigratedDb();
  await db.deleteFrom('form_definitions').where('name', '=', 'Lab order').execute();
  return db;
}

const byId = (fields: readonly unknown[], id: string) => (fields as any[]).find((f) => f.id === id);
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

describe('106 result entry', () => {
  it("gives an install still carrying 105's Lab order the results field", async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_RESULTS_FIELDS_SNAPSHOT);
  });

  it("leaves an operator's own edit alone", async () => {
    const db = await freshDb();
    const edited = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).map((f) => (f.id === 'tests' ? { ...f, displayLabel: 'Ordered tests' } : f));
    await seedOrderForm(db, edited);
    await up(db);
    expect(await readFields(db)).toEqual(edited);
  });

  it('leaves an already-migrated row alone, so a second run changes nothing', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_RESULTS_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_RESULTS_FIELDS_SNAPSHOT);
  });

  it('does not guess when two forms share the name', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-a');
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-b');
    await up(db);
    const rows = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').execute();
    for (const row of rows) expect(json(row.schema).fields).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
  });

  it('down() restores exactly the shape up() found', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    await down(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
  });

  it('puts the results field after Tests, depending on it, and shifts the later fields', () => {
    const results = byId(LAB_ORDER_RESULTS_FIELDS_SNAPSHOT, 'fld-ord-results');
    expect(results).toMatchObject({ fieldType: 'testDetails', referenceDependsOn: 'tests', order: 2, required: false });
    expect(byId(LAB_ORDER_RESULTS_FIELDS_SNAPSHOT, 'tests').order).toBe(1);
    expect(byId(LAB_ORDER_RESULTS_FIELDS_SNAPSHOT, 'fld-ord-priority').order).toBe(3);
    expect(byId(LAB_ORDER_RESULTS_FIELDS_SNAPSHOT, 'fld-ord-specimen-type').order).toBe(9);
    expect((LAB_ORDER_RESULTS_FIELDS_SNAPSHOT as any[]).length).toBe((LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).length + 1);
  });

  it("the frozen copy of 105's Lab order shape still matches what 105 actually shipped", () => {
    expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_105);
  });

  it('registers both rejection reason lists, with no fhir.change_log row', async () => {
    const db = await makeMigratedDb();
    for (const url of [ORDER_REJECT_VALUE_SET, TEST_REJECT_VALUE_SET]) {
      const vs = await db.selectFrom('value_sets').select(['id', 'immutable']).where('url', '=', url).executeTakeFirstOrThrow();
      expect(vs.immutable).toBe(false);
      expect(await db.selectFrom('terminology_systems').select('kind').where('url', '=', url).executeTakeFirstOrThrow())
        .toEqual({ kind: 'ValueSet' });
      expect(await db.selectFrom('fhir.fhir_resources').select('id').where('resource_type', '=', 'ValueSet').where('id', '=', vs.id).execute())
        .toHaveLength(1);
      expect(await db.selectFrom('fhir.change_log').select('seq').where('resource_type', '=', 'ValueSet').where('resource_id', '=', vs.id).execute())
        .toEqual([]);
    }
  });

  it('seeds the starting reasons for both levels', async () => {
    const db = await makeMigratedDb();
    const codes = async (system: string) => (await db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', system).orderBy('code').execute()).map((r: { code: string }) => r.code);
    expect(await codes('urn:openldr:cs:reject-order')).toEqual(['DUPLICATE', 'UNLABELLED', 'WRONGPT']);
    expect(await codes('urn:openldr:cs:reject-test')).toEqual(['CLOTTED', 'CONTAINER', 'HAEM', 'QNS']);
  });

  it('down removes both reason lists and their concepts', async () => {
    const db = await makeMigratedDb();
    await down(db);
    for (const url of [ORDER_REJECT_VALUE_SET, TEST_REJECT_VALUE_SET]) {
      expect(await db.selectFrom('value_sets').select('id').where('url', '=', url).execute()).toEqual([]);
      expect(await db.selectFrom('terminology_systems').select('url').where('url', '=', url).execute()).toEqual([]);
    }
    expect(await db.selectFrom('terminology_concepts').select('code').where('system', '=', 'urn:openldr:cs:reject-test').execute()).toEqual([]);
  });
});
