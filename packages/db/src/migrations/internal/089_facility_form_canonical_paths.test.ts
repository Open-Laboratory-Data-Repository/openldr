import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  BOUND_FIELDS_SNAPSHOT,
  PREV_BOUND_FIELDS_SNAPSHOT,
  PREV_CANONICALISED_SNAPSHOT,
  up,
  down,
} from './089_facility_form_canonical_paths';
// Imported to PROVE this migration's frozen copy still matches what 087 actually shipped.
// 087's own test does the same against 085. The migration itself must never import it.
import { BOUND_FIELDS_SNAPSHOT as SHIPPED_087 } from './087_facility_form_one_code';

async function seedFacilityForm(db: any, fields: readonly unknown[]): Promise<void> {
  await db.insertInto('form_definitions').values({
    id: 'form-sample-facility', name: 'Facility', status: 'published', active: true,
    target_pages: JSON.stringify(['facilities']),
    schema: JSON.stringify({ id: 'form-sample-facility', name: 'Facility', fields, targetPages: ['facilities'] }),
  } as never).execute();
}

async function readFields(db: any): Promise<unknown> {
  const row = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Facility').executeTakeFirst();
  const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
  return schema.fields;
}

describe('089 facility form canonical paths', () => {
  it('repoints an install still carrying 087 shape', async () => {
    const db = await makeMigratedDb();
    await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
    await seedFacilityForm(db, PREV_BOUND_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(BOUND_FIELDS_SNAPSHOT);
  });

  it('repoints an install whose operator already saved the form since Phase 1', async () => {
    // normalize.ts prefixes every path on the next builder save. Without this shape in the
    // guard, such an install is skipped and keeps Zone on Location.address.district forever.
    const db = await makeMigratedDb();
    await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
    await seedFacilityForm(db, PREV_CANONICALISED_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(BOUND_FIELDS_SNAPSHOT);
  });

  it("leaves an operator's own edit alone", async () => {
    const db = await makeMigratedDb();
    await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
    const edited = (PREV_BOUND_FIELDS_SNAPSHOT as any[]).map((f, i) =>
      i === 0 ? { ...f, displayLabel: 'Register' } : f,
    );
    await seedFacilityForm(db, edited);
    await up(db);
    expect(await readFields(db)).toEqual(edited);
  });

  it('leaves an already-corrected row alone', async () => {
    const db = await makeMigratedDb();
    await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
    await seedFacilityForm(db, BOUND_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(BOUND_FIELDS_SNAPSHOT);
  });

  it('down() restores exactly the shape up() found, for both prior shapes', async () => {
    for (const prior of [PREV_BOUND_FIELDS_SNAPSHOT, PREV_CANONICALISED_SNAPSHOT]) {
      const db = await makeMigratedDb();
      await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
      await seedFacilityForm(db, prior);
      await up(db);
      await down(db);
      expect(await readFields(db)).toEqual(prior);
    }
  });

  it('the corrected snapshot binds Zone and Council to nothing, and District to address.district', () => {
    const by = (id: string) => (BOUND_FIELDS_SNAPSHOT as any[]).find((f) => f.id === id);
    expect(by('fld-fac-zone').fhirPath).toBeNull();
    expect(by('fld-fac-council').fhirPath).toBeNull();
    expect(by('fld-fac-region').fhirPath).toBe('Location.address.state');
    expect(by('fld-fac-district').fhirPath).toBe('Location.address.district');
    expect((BOUND_FIELDS_SNAPSHOT as any[]).some((f) => f.fhirPath === 'Location.address.city')).toBe(false);
  });

  it('the two prior snapshots differ only in their fhirPath values', () => {
    const strip = (fields: readonly unknown[]) =>
      (fields as any[]).map(({ fhirPath, ...rest }) => rest);
    expect(strip(PREV_CANONICALISED_SNAPSHOT)).toEqual(strip(PREV_BOUND_FIELDS_SNAPSHOT));
  });

  it("the frozen copy of 087's shape still matches what 087 actually shipped", () => {
    // The migration must NOT import 087. This test may, and it is what catches the frozen
    // copy being transcribed wrong. Same discipline as 087's own test against 085.
    expect(PREV_BOUND_FIELDS_SNAPSHOT).toEqual(SHIPPED_087);
  });
});
