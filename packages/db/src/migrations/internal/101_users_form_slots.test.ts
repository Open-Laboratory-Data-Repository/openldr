import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  USERS_BOUND_FIELDS_SNAPSHOT,
  USERS_PREV_CANONICALISED_SNAPSHOT,
  USERS_PREV_FIELDS_SNAPSHOT,
  up,
  down,
} from './101_users_form_slots';

async function seedUsersForm(db: any, fields: readonly unknown[], id = 'form-sample-users'): Promise<void> {
  await db.insertInto('form_definitions').values({
    id, name: 'Users', status: 'published', active: true,
    target_pages: JSON.stringify(['users']),
    schema: JSON.stringify({ id, name: 'Users', fields, targetPages: ['users'] }),
  } as never).execute();
}

async function readFields(db: any): Promise<unknown> {
  const row = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Users').executeTakeFirst();
  const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
  return schema.fields;
}

async function freshDb(): Promise<any> {
  const db = await makeMigratedDb();
  await db.deleteFrom('form_definitions').where('name', '=', 'Users').execute();
  return db;
}

describe('101 users form slots', () => {
  it('gives an install still carrying the shipped Users form its name and email slots', async () => {
    const db = await freshDb();
    await seedUsersForm(db, USERS_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(USERS_BOUND_FIELDS_SNAPSHOT);
  });

  it('does the same for an install whose operator saved the form in the builder', async () => {
    // The builder prefixes every path on save. Without this shape in the guard, such an install
    // is skipped and keeps its three warnings.
    const db = await freshDb();
    await seedUsersForm(db, USERS_PREV_CANONICALISED_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(USERS_BOUND_FIELDS_SNAPSHOT);
  });

  it("leaves an operator's own edit alone", async () => {
    const db = await freshDb();
    const edited = (USERS_PREV_FIELDS_SNAPSHOT as any[]).map((f, i) => (i === 2 ? { ...f, displayLabel: 'Work email' } : f));
    await seedUsersForm(db, edited);
    await up(db);
    expect(await readFields(db)).toEqual(edited);
  });

  it('leaves an already-migrated row alone, so a second run changes nothing', async () => {
    const db = await freshDb();
    await seedUsersForm(db, USERS_BOUND_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(USERS_BOUND_FIELDS_SNAPSHOT);
  });

  it('does not guess when two forms share the name', async () => {
    const db = await freshDb();
    await seedUsersForm(db, USERS_PREV_FIELDS_SNAPSHOT, 'form-a');
    await seedUsersForm(db, USERS_PREV_FIELDS_SNAPSHOT, 'form-b');
    await up(db);
    const rows = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Users').execute();
    for (const row of rows) {
      const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
      expect(schema.fields).toEqual(USERS_PREV_FIELDS_SNAPSHOT);
    }
  });

  it('down() restores exactly the shape up() found, for both prior shapes', async () => {
    for (const prior of [USERS_PREV_FIELDS_SNAPSHOT, USERS_PREV_CANONICALISED_SNAPSHOT]) {
      const db = await freshDb();
      await seedUsersForm(db, prior);
      await up(db);
      await down(db);
      expect(await readFields(db)).toEqual(prior);
    }
  });

  it('names the list entry each slot fills, with corlix values', () => {
    const by = (id: string) => (USERS_BOUND_FIELDS_SNAPSHOT as any[]).find((f) => f.id === id);
    expect(by('fld-usr-first-name')).toMatchObject({ fhirPath: 'Practitioner.name.given', fhirDiscriminator: { use: 'official' }, fhirValueField: 'given' });
    expect(by('fld-usr-last-name')).toMatchObject({ fhirPath: 'Practitioner.name.family', fhirDiscriminator: { use: 'official' }, fhirValueField: 'family' });
    expect(by('fld-usr-email')).toMatchObject({ fhirPath: 'Practitioner.telecom.value', fhirDiscriminator: { system: 'email' }, fhirValueField: 'value' });
  });

  it('the two prior shapes differ only in their paths, and the new one only adds the slot fields', () => {
    const noPath = (fields: readonly unknown[]) => (fields as any[]).map(({ fhirPath, ...rest }) => rest);
    expect(noPath(USERS_PREV_CANONICALISED_SNAPSHOT)).toEqual(noPath(USERS_PREV_FIELDS_SNAPSHOT));
    const noSlot = (fields: readonly unknown[]) => (fields as any[]).map(({ fhirDiscriminator, fhirValueField, ...rest }) => rest);
    expect(noSlot(USERS_BOUND_FIELDS_SNAPSHOT)).toEqual(noSlot(USERS_PREV_CANONICALISED_SNAPSHOT));
  });
});
