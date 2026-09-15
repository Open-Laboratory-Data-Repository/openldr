import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  FACILITY_BOUND_FIELDS_SNAPSHOT,
  FACILITY_PREV_FIELDS_SNAPSHOT,
  PATIENT_BOUND_FIELDS_SNAPSHOT,
  PATIENT_PREV_FIELDS_SNAPSHOT,
  up,
  down,
} from './100_sample_form_slots';
// Imported to PROVE this migration's frozen copy still matches what 089 actually shipped.
// The migration itself must never import it. Same discipline as 089's test against 087.
import { BOUND_FIELDS_SNAPSHOT as SHIPPED_089 } from './089_facility_form_canonical_paths';

async function seedForm(db: any, name: string, fields: readonly unknown[], id = `form-sample-${name.toLowerCase()}`): Promise<void> {
  await db.insertInto('form_definitions').values({
    id, name, status: 'published', active: true,
    target_pages: JSON.stringify([]),
    schema: JSON.stringify({ id, name, fields, targetPages: [] }),
  } as never).execute();
}

async function readFields(db: any, name: string): Promise<unknown> {
  const row = await db.selectFrom('form_definitions').select('schema').where('name', '=', name).executeTakeFirst();
  const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
  return schema.fields;
}

async function freshDb(): Promise<any> {
  const db = await makeMigratedDb();
  await db.deleteFrom('form_definitions').where('name', 'in', ['Patient', 'Facility']).execute();
  return db;
}

describe('100 sample form slots', () => {
  it('gives an install still carrying the shipped Patient form its name and phone slots', async () => {
    const db = await freshDb();
    await seedForm(db, 'Patient', PATIENT_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db, 'Patient')).toEqual(PATIENT_BOUND_FIELDS_SNAPSHOT);
  });

  it("gives an install still carrying 089's Facility form a value field on its code", async () => {
    const db = await freshDb();
    await seedForm(db, 'Facility', FACILITY_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db, 'Facility')).toEqual(FACILITY_BOUND_FIELDS_SNAPSHOT);
  });

  it("leaves an operator's own edit alone", async () => {
    const db = await freshDb();
    const edited = (PATIENT_PREV_FIELDS_SNAPSHOT as any[]).map((f, i) => (i === 0 ? { ...f, displayLabel: 'Given name' } : f));
    await seedForm(db, 'Patient', edited);
    await up(db);
    expect(await readFields(db, 'Patient')).toEqual(edited);
  });

  it('leaves an already-migrated row alone, so a second run changes nothing', async () => {
    const db = await freshDb();
    await seedForm(db, 'Patient', PATIENT_BOUND_FIELDS_SNAPSHOT);
    await seedForm(db, 'Facility', FACILITY_BOUND_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db, 'Patient')).toEqual(PATIENT_BOUND_FIELDS_SNAPSHOT);
    expect(await readFields(db, 'Facility')).toEqual(FACILITY_BOUND_FIELDS_SNAPSHOT);
  });

  it('does not guess when two forms share the name', async () => {
    const db = await freshDb();
    await seedForm(db, 'Patient', PATIENT_PREV_FIELDS_SNAPSHOT, 'form-a');
    await seedForm(db, 'Patient', PATIENT_PREV_FIELDS_SNAPSHOT, 'form-b');
    await up(db);
    const rows = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Patient').execute();
    for (const row of rows) {
      const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
      expect(schema.fields).toEqual(PATIENT_PREV_FIELDS_SNAPSHOT);
    }
  });

  it('down() restores exactly the shapes up() found', async () => {
    const db = await freshDb();
    await seedForm(db, 'Patient', PATIENT_PREV_FIELDS_SNAPSHOT);
    await seedForm(db, 'Facility', FACILITY_PREV_FIELDS_SNAPSHOT);
    await up(db);
    await down(db);
    expect(await readFields(db, 'Patient')).toEqual(PATIENT_PREV_FIELDS_SNAPSHOT);
    expect(await readFields(db, 'Facility')).toEqual(FACILITY_PREV_FIELDS_SNAPSHOT);
  });

  it('names the list entry each Patient slot fills, as corlix seeds its own Patient form', () => {
    const by = (id: string) => (PATIENT_BOUND_FIELDS_SNAPSHOT as any[]).find((f) => f.id === id);
    expect(by('fld-pat-first-name')).toMatchObject({ fhirDiscriminator: { use: 'official' }, fhirValueField: 'given' });
    expect(by('fld-pat-last-name')).toMatchObject({ fhirDiscriminator: { use: 'official' }, fhirValueField: 'family' });
    expect(by('fld-pat-phone')).toMatchObject({ fhirDiscriminator: { system: 'phone' }, fhirValueField: 'value' });
  });

  it('changes nothing but the discriminator and value field', () => {
    const strip = (fields: readonly unknown[]) =>
      (fields as any[]).map(({ fhirDiscriminator, fhirValueField, ...rest }) => rest);
    expect(strip(PATIENT_BOUND_FIELDS_SNAPSHOT)).toEqual(strip(PATIENT_PREV_FIELDS_SNAPSHOT));
    const facilityStrip = (fields: readonly unknown[]) => (fields as any[]).map(({ fhirValueField, ...rest }) => rest);
    expect(facilityStrip(FACILITY_BOUND_FIELDS_SNAPSHOT)).toEqual(facilityStrip(FACILITY_PREV_FIELDS_SNAPSHOT));
  });

  it("the frozen copy of 089's Facility shape still matches what 089 actually shipped", () => {
    expect(FACILITY_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_089);
  });
});
