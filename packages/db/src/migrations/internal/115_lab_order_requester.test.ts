import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_ORDER_REQUESTER_FIELDS_SNAPSHOT,
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  up,
  down,
} from './115_lab_order_requester';
// Imported to PROVE this migration's frozen copy still matches what 110 actually shipped.
// The migration itself must never import it.
import { LAB_ORDER_REJECTION_FIELDS_SNAPSHOT as SHIPPED_110 } from './110_lab_order_rejection';

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

describe('115 the referring facility and clinician fill the requester', () => {
  it("rewrites an install still carrying 110's Lab order", async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_REQUESTER_FIELDS_SNAPSHOT);
  });

  it('moves the facility off the performer and gives it the facility registry to search', () => {
    expect(byId(LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'fld-ord-ref-facility').fhirPath).toBe('ServiceRequest.performer');
    expect(byId(LAB_ORDER_REQUESTER_FIELDS_SNAPSHOT, 'fld-ord-ref-facility')).toMatchObject({
      fhirPath: 'ServiceRequest.requester',
      fhirDiscriminator: { type: 'Organization' },
      referenceTarget: 'urn:openldr:cs:facility-registry',
    });
    expect(byId(LAB_ORDER_REQUESTER_FIELDS_SNAPSHOT, 'fld-ord-clinician')).toMatchObject({
      fhirPath: 'ServiceRequest.requester',
      fhirDiscriminator: { type: 'Practitioner' },
    });
  });

  it('changes only those two fields, and moves none', () => {
    const others = (fields: readonly unknown[]) => (fields as any[]).filter((f) => !['fld-ord-clinician', 'fld-ord-ref-facility'].includes(f.id));
    expect(others(LAB_ORDER_REQUESTER_FIELDS_SNAPSHOT)).toEqual(others(LAB_ORDER_PREV_FIELDS_SNAPSHOT));
    const ids = (fields: readonly unknown[]) => (fields as any[]).map((f) => f.id);
    expect(ids(LAB_ORDER_REQUESTER_FIELDS_SNAPSHOT)).toEqual(ids(LAB_ORDER_PREV_FIELDS_SNAPSHOT));
  });

  it("leaves an operator's own edit alone", async () => {
    const db = await freshDb();
    const edited = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).map((f) => (f.id === 'fld-ord-ref-facility' ? { ...f, displayLabel: 'Sent from' } : f));
    await seedOrderForm(db, edited);
    await up(db);
    expect(await readFields(db)).toEqual(edited);
  });

  it('leaves an already-migrated row alone, so a second run changes nothing', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_REQUESTER_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_REQUESTER_FIELDS_SNAPSHOT);
  });

  it('does not guess when two forms share the name', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-a');
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-b');
    await up(db);
    const rows = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').execute();
    for (const row of rows) expect(json(row.schema).fields).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
  });

  it("down() restores 110's shape exactly as up() found it", async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    await down(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
  });

  it("the frozen copy of 110's Lab order shape still matches what 110 actually shipped", () => {
    expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_110);
  });
});
