import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_ORDER_BOUND_FIELDS_SNAPSHOT,
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  up,
  down,
} from './102_lab_order_notes_ward_paths';

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

const pathOf = (fields: readonly unknown[], id: string) => (fields as any[]).find((f) => f.id === id)?.fhirPath;

describe('102 lab order notes and ward paths', () => {
  it('points an install still carrying the shipped Lab order form at the first note and location', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_BOUND_FIELDS_SNAPSHOT);
  });

  it("leaves an operator's own edit alone", async () => {
    const db = await freshDb();
    const edited = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).map((f) => (f.id === 'fld-ord-notes' ? { ...f, displayLabel: 'Notes' } : f));
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

  it('changes only the notes and ward paths', () => {
    expect(pathOf(LAB_ORDER_BOUND_FIELDS_SNAPSHOT, 'fld-ord-notes')).toBe('ServiceRequest.note.0.text');
    expect(pathOf(LAB_ORDER_BOUND_FIELDS_SNAPSHOT, 'fld-ord-ward')).toBe('ServiceRequest.locationCode.0');
    const noPath = (fields: readonly unknown[]) => (fields as any[]).map(({ fhirPath, ...rest }) => rest);
    expect(noPath(LAB_ORDER_BOUND_FIELDS_SNAPSHOT)).toEqual(noPath(LAB_ORDER_PREV_FIELDS_SNAPSHOT));
    const others = (fields: readonly unknown[]) => (fields as any[]).filter((f) => f.id !== 'fld-ord-notes' && f.id !== 'fld-ord-ward');
    expect(others(LAB_ORDER_BOUND_FIELDS_SNAPSHOT)).toEqual(others(LAB_ORDER_PREV_FIELDS_SNAPSHOT));
  });
});
