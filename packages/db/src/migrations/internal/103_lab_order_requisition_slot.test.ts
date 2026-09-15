import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_ORDER_BOUND_FIELDS_SNAPSHOT,
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  up,
  down,
} from './103_lab_order_requisition_slot';
// Imported to PROVE this migration's frozen copy still matches what 102 actually shipped.
// The migration itself must never import it.
import { LAB_ORDER_BOUND_FIELDS_SNAPSHOT as SHIPPED_102 } from './102_lab_order_notes_ward_paths';

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

describe('103 lab order requisition slot', () => {
  it('gives an install still carrying 102\'s Lab order form its requisition slot', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_BOUND_FIELDS_SNAPSHOT);
  });

  it("leaves an operator's own edit alone", async () => {
    const db = await freshDb();
    const edited = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).map((f) => (f.id === 'fld-ord-ref-number' ? { ...f, displayLabel: 'Requisition' } : f));
    await seedOrderForm(db, edited);
    await up(db);
    expect(await readFields(db)).toEqual(edited);
  });

  it('leaves an already-migrated row alone, so a second run changes nothing', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_BOUND_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_BOUND_FIELDS_SNAPSHOT);
  });

  it('does not guess when two forms share the name', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-a');
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-b');
    await up(db);
    const rows = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').execute();
    for (const row of rows) {
      const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
      expect(schema.fields).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    }
  });

  it('down() restores exactly the shape up() found', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    await down(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
  });

  it('binds the reference number to the requisition entry of ServiceRequest.identifier, and changes nothing else', () => {
    expect(byId(LAB_ORDER_BOUND_FIELDS_SNAPSHOT, 'fld-ord-ref-number')).toMatchObject({
      fhirPath: 'ServiceRequest.identifier.value',
      fhirDiscriminator: { system: 'urn:openldr:order:requisition' },
      fhirValueField: 'value',
    });
    const others = (fields: readonly unknown[]) => (fields as any[]).filter((f) => f.id !== 'fld-ord-ref-number');
    expect(others(LAB_ORDER_BOUND_FIELDS_SNAPSHOT)).toEqual(others(LAB_ORDER_PREV_FIELDS_SNAPSHOT));
  });

  it("the frozen copy of 102's Lab order shape still matches what 102 actually shipped", () => {
    expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_102);
  });
});
