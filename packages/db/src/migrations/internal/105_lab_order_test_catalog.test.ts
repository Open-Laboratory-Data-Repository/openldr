import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_ORDER_CATALOG_FIELDS_SNAPSHOT,
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  LAB_TESTS_VALUE_SET,
  up,
  down,
} from './105_lab_order_test_catalog';
// Imported to PROVE this migration's frozen copy still matches what 103 actually shipped.
// The migration itself must never import it.
import { LAB_ORDER_BOUND_FIELDS_SNAPSHOT as SHIPPED_103 } from './103_lab_order_requisition_slot';

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

describe('105 lab order test catalog', () => {
  it("rebinds an install still carrying 103's Lab order to the lab's test list", async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT);
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
    await seedOrderForm(db, LAB_ORDER_CATALOG_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT);
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

  it('binds tests to the lab list and makes the specimen type depend on it, and changes nothing else', () => {
    const tests = byId(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT, 'tests');
    expect(tests).toMatchObject({ valueSetUrl: 'urn:openldr:valueset:lab-tests', referenceMultiple: true, fhirPath: 'ServiceRequest.code' });
    expect(tests).not.toHaveProperty('referenceTarget');
    expect(byId(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT, 'fld-ord-specimen-type'))
      .toMatchObject({ referenceDependsOn: 'tests', valueSetUrl: 'urn:openldr:valueset:specimen-type' });
    const others = (fields: readonly unknown[]) => (fields as any[]).filter((f) => f.id !== 'tests' && f.id !== 'fld-ord-specimen-type');
    expect(others(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT)).toEqual(others(LAB_ORDER_PREV_FIELDS_SNAPSHOT));
  });

  it("the frozen copy of 103's Lab order shape still matches what 103 actually shipped", () => {
    expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_103);
  });

  it('registers the lab test list, immutable, with an empty stored list and no fhir.change_log row', async () => {
    const db = await makeMigratedDb();
    const vs = await db.selectFrom('value_sets').select(['id', 'immutable', 'compose'])
      .where('url', '=', LAB_TESTS_VALUE_SET).executeTakeFirstOrThrow();
    expect({ id: vs.id, immutable: vs.immutable, compose: json(vs.compose) })
      .toEqual({ id: 'vs-lab-tests', immutable: true, compose: { include: [] } });
    expect(await db.selectFrom('terminology_systems').select(['kind', 'resource_id']).where('url', '=', LAB_TESTS_VALUE_SET).executeTakeFirstOrThrow())
      .toEqual({ kind: 'ValueSet', resource_id: 'vs-lab-tests' });
    expect(await db.selectFrom('fhir.fhir_resources').select('id').where('resource_type', '=', 'ValueSet').where('id', '=', 'vs-lab-tests').execute())
      .toHaveLength(1);
    expect(await db.selectFrom('fhir.change_log').select('seq').where('resource_type', '=', 'ValueSet').where('resource_id', '=', 'vs-lab-tests').execute())
      .toEqual([]);
  });

  it('down removes the lab test list', async () => {
    const db = await makeMigratedDb();
    await down(db);
    expect(await db.selectFrom('value_sets').select('id').where('url', '=', LAB_TESTS_VALUE_SET).execute()).toEqual([]);
    expect(await db.selectFrom('terminology_systems').select('url').where('url', '=', LAB_TESTS_VALUE_SET).execute()).toEqual([]);
    expect(await db.selectFrom('fhir.fhir_resources').select('id').where('id', '=', 'vs-lab-tests').execute()).toEqual([]);
  });
});
