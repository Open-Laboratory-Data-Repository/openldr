import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT,
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  up,
  down,
} from './138_lab_order_form_orders_only';
// Imported to PROVE this migration's frozen copy still matches what 115 actually shipped.
// The migration itself must never import it.
import { LAB_ORDER_REQUESTER_FIELDS_SNAPSHOT as SHIPPED_115 } from './115_lab_order_requester';

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

const ids = (fields: unknown) => (fields as any[]).map((f) => f.id);
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

describe('138 the Lab order orders tests and no longer enters results', () => {
  afterEach(() => vi.restoreAllMocks());

  it("removes the Results field from an install still carrying 115's Lab order", async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    const fields = await readFields(db);
    expect(fields).toEqual(LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT);
    expect(ids(fields)).not.toContain('fld-ord-results');
  });

  it('drops only the Results field, keeps the order rejection field, and leaves no gap in the order', () => {
    expect(ids(LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT)).toEqual(ids(LAB_ORDER_PREV_FIELDS_SNAPSHOT).filter((id) => id !== 'fld-ord-results'));
    expect(ids(LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT)).toContain('fld-ord-rejection');
    expect((LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT as any[]).map((f) => f.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const withoutOrder = (fields: readonly unknown[]) => (fields as any[]).map(({ order, ...rest }) => rest);
    expect(withoutOrder(LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT))
      .toEqual(withoutOrder(LAB_ORDER_PREV_FIELDS_SNAPSHOT).filter((f: any) => f.id !== 'fld-ord-results'));
  });

  it('leaves a form edited by the lab alone, and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = await freshDb();
    const edited = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).map((f) => (f.id === 'fld-ord-results' ? { ...f, displayLabel: 'Bench results' } : f));
    await seedOrderForm(db, edited);
    await up(db);
    expect(await readFields(db)).toEqual(edited);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/edited after it shipped/);
  });

  it('a second run changes nothing and says nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    const once = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').executeTakeFirst();
    await up(db);
    const twice = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').executeTakeFirst();
    expect(json(twice.schema)).toEqual(json(once.schema));
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not guess when two forms share the name, and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-a');
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-b');
    await up(db);
    const rows = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').execute();
    for (const row of rows) expect(json(row.schema).fields).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    expect(String(warn.mock.calls[0][0])).toMatch(/2 forms are named "Lab order"/);
  });

  it('down() restores the Results field exactly as up() found it', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    await down(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    const row = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').executeTakeFirst();
    expect(json(row.schema)).not.toHaveProperty('__migration138');
  });

  it("the frozen copy of 115's Lab order shape still matches what 115 actually shipped", () => {
    expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_115);
  });
});
