import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_ORDER_NO_ORDER_SPECIMEN_SNAPSHOT,
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  up,
  down,
} from './107_lab_order_drop_specimen';
// Imported to PROVE this migration's frozen copy still matches what 106 actually shipped.
// The migration itself must never import it.
import { LAB_ORDER_RESULTS_FIELDS_SNAPSHOT as SHIPPED_106 } from './106_result_entry';

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

const ids = (fields: readonly unknown[]) => (fields as any[]).map((f) => f.id);
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

describe('107 lab order drops the order-level specimen', () => {
  it("drops the field from an install still carrying 106's Lab order", async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_NO_ORDER_SPECIMEN_SNAPSHOT);
    expect(ids(await readFields(db) as unknown[])).not.toContain('fld-ord-specimen-type');
  });

  it('leaves every other field, and their order, exactly as they were', () => {
    expect(ids(LAB_ORDER_NO_ORDER_SPECIMEN_SNAPSHOT)).toEqual(ids(LAB_ORDER_PREV_FIELDS_SNAPSHOT).filter((id) => id !== 'fld-ord-specimen-type'));
    const orders = (LAB_ORDER_NO_ORDER_SPECIMEN_SNAPSHOT as any[]).map((f) => f.order);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
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
    await seedOrderForm(db, LAB_ORDER_NO_ORDER_SPECIMEN_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_NO_ORDER_SPECIMEN_SNAPSHOT);
  });

  it('does not guess when two forms share the name', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-a');
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-b');
    await up(db);
    const rows = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').execute();
    for (const row of rows) expect(json(row.schema).fields).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
  });

  it('down() puts the specimen field back exactly as up() found it', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    await down(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
  });

  it("the frozen copy of 106's Lab order shape still matches what 106 actually shipped", () => {
    expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_106);
  });
});
