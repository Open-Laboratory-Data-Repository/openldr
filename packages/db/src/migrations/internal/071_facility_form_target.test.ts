import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { up, down, OLD_FIELDS_SNAPSHOT, NEW_FIELDS_SNAPSHOT } from './071_facility_form_target';

// pg-mem (like the real Postgres jsonb driver path — see 069_result_role_valuesets.test.ts's
// `compose` handling) hands a jsonb column back already parsed, not as a JSON string. An unguarded
// `JSON.parse(row.target_pages)` blows up (`JSON.parse` stringifies the array first, so
// `['facilities']` becomes the bare word `facilities`, which isn't valid JSON) — verified
// empirically before writing this, since the brief's row shape is a starting point, not a
// guarantee.
const parseJson = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

const seeded = (over: Record<string, unknown> = {}) => ({
  id: 'form-sample-facility', name: 'Facility', version_label: 'v1',
  fhir_resource_type: 'Location', fhir_version: 'R4', status: 'draft', active: true,
  schema: JSON.stringify({ id: 'sample-facility', fields: OLD_FIELDS_SNAPSHOT }),
  target_pages: JSON.stringify(['forms']),
  ...over,
});

const getRow = async (db: any, id: string) =>
  db.selectFrom('form_definitions').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

describe('071_facility_form_target up()', () => {
  it('repoints and publishes an untouched seeded Facility form, delivering the NEW schema', async () => {
    const db = await makeMigratedDb();
    // Insert BEFORE 071 would have run in a real upgrade; here the table already exists, so write
    // the pre-071 state and re-run 071's up() directly.
    await db.insertInto('form_definitions' as never).values(seeded() as never).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['facilities']);
    expect(row.status).toBe('published');

    // C2: the embedded schema must ALSO carry the new fields (every one with an apiProperty that
    // is a real facilities column) — repointing target_pages alone ships a page that can never
    // save, since none of the OLD fields write localCode/nationalCode.
    const schema: any = parseJson(row.schema);
    expect(schema.fields).toEqual(NEW_FIELDS_SNAPSHOT);
    expect(schema.fields.every((f: any) => !!f.apiProperty)).toBe(true);

    // I2: schema.targetPages and the target_pages column must agree — FormBuilderPage.tsx writes
    // `targetPages: schema.targetPages` back to the column on every save, so disagreement here
    // would self-revert the very next time an operator opens and saves the form.
    expect(schema.targetPages).toEqual(['facilities']);
    await db.destroy();
  });

  it('⛔ leaves an EDITED form alone — a relabelled field is never clobbered', async () => {
    const db = await makeMigratedDb();
    const editedFields = OLD_FIELDS_SNAPSHOT.map((f: any, i: number) =>
      i === 0 ? { ...f, displayLabel: 'Facility name (custom)' } : f,
    );
    await db.insertInto('form_definitions' as never).values(
      seeded({ schema: JSON.stringify({ id: 'sample-facility', fields: editedFields }) }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['forms']);
    expect(row.status).toBe('draft');
    await db.destroy();
  });

  it('⛔ leaves an EDITED form alone — a bound valueSetUrl is never clobbered', async () => {
    const db = await makeMigratedDb();
    const editedFields = OLD_FIELDS_SNAPSHOT.map((f: any, i: number) =>
      i === 0 ? { ...f, valueSetUrl: 'urn:openldr:valueset:some-op-authored-set' } : f,
    );
    await db.insertInto('form_definitions' as never).values(
      seeded({ schema: JSON.stringify({ id: 'sample-facility', fields: editedFields }) }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['forms']);
    await db.destroy();
  });

  it('⛔ leaves an EDITED form alone — a field marked not-required is never clobbered', async () => {
    const db = await makeMigratedDb();
    const editedFields = OLD_FIELDS_SNAPSHOT.map((f: any, i: number) =>
      i === 0 ? { ...f, required: false } : f,
    );
    await db.insertInto('form_definitions' as never).values(
      seeded({ schema: JSON.stringify({ id: 'sample-facility', fields: editedFields }) }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['forms']);
    await db.destroy();
  });

  it('⛔ leaves an EDITED form alone — a disabled field is never clobbered', async () => {
    const db = await makeMigratedDb();
    const editedFields = OLD_FIELDS_SNAPSHOT.map((f: any, i: number) =>
      i === 0 ? { ...f, enabled: false } : f,
    );
    await db.insertInto('form_definitions' as never).values(
      seeded({ schema: JSON.stringify({ id: 'sample-facility', fields: editedFields }) }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['forms']);
    await db.destroy();
  });

  it('⛔ an EMPTIED fields array ([]) is never mistaken for "untouched" and republished', async () => {
    // `fields.every(...)` is vacuously TRUE for an empty array — a naive id-prefix guard would
    // treat an operator's deleted-all-fields draft as "untouched" and push it live.
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({ schema: JSON.stringify({ id: 'sample-facility', fields: [] }) }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['forms']);
    expect(row.status).toBe('draft');
    await db.destroy();
  });

  it('I1: repoints a LEGACY row seeded before the deterministic-id change (form-<uuid>, not form-sample-facility)', async () => {
    // Ids only became deterministic in commit ede345a7 (2026-07-30); an install seeded before that
    // still carries a random `form-<uuid>`. Matching on the hardcoded id would silently skip it —
    // matching on name (what the seeder itself dedupes on) catches it regardless.
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({ id: 'form-b3f1c2a4-64b1-4e7a-9c3a-8f2d1a9e0b11' }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-b3f1c2a4-64b1-4e7a-9c3a-8f2d1a9e0b11');
    expect(parseJson(row.target_pages)).toEqual(['facilities']);
    expect(row.status).toBe('published');
    await db.destroy();
  });

  it('is a no-op when no seeded form exists', async () => {
    const db = await makeMigratedDb();
    await expect(up(db)).resolves.not.toThrow();
    await db.destroy();
  });

  it('is a no-op when the match is ambiguous (more than one row named "Facility")', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seeded({ id: 'form-a' }) as never).execute();
    await db.insertInto('form_definitions' as never).values(seeded({ id: 'form-b' }) as never).execute();
    await up(db);
    const a: any = await getRow(db, 'form-a');
    const b: any = await getRow(db, 'form-b');
    expect(parseJson(a.target_pages)).toEqual(['forms']);
    expect(parseJson(b.target_pages)).toEqual(['forms']);
    await db.destroy();
  });

  it('is idempotent across a re-run of up()', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seeded() as never).execute();
    await up(db);
    await expect(up(db)).resolves.not.toThrow();
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['facilities']);
    await db.destroy();
  });
});

describe('071_facility_form_target down()', () => {
  it('C1: reverses exactly what up() did — round-trips a migrated legacy row back to its prior state', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seeded({ status: 'draft' }) as never).execute();
    await up(db);
    const migrated: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(migrated.target_pages)).toEqual(['facilities']); // sanity: up() did apply

    await down(db);
    const reverted: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(reverted.target_pages)).toEqual(['forms']);
    expect(reverted.status).toBe('draft'); // restored, not left published
    expect((parseJson(reverted.schema) as any).fields).toEqual(OLD_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it('C1: restores whatever status the row had BEFORE up() ran, not always "draft"', async () => {
    const db = await makeMigratedDb();
    // An operator had manually published the OLD "Forms"-targeting draft before this migration
    // ever ran — up() does not gate on status, only on target_pages + field content.
    await db.insertInto('form_definitions' as never).values(seeded({ status: 'published' }) as never).execute();
    await up(db);
    await down(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(row.status).toBe('published');
    await db.destroy();
  });

  it('C1: does NOT touch a FRESH install seeded after this release — up() never ran on it', async () => {
    // A fresh install's seed already produces target_pages=['facilities'], status='published' and
    // the NEW fields — content-identical to a row up() just repointed, but down() must still leave
    // it alone. This is the exact scenario the old unconditional down() broke: "rolling back any
    // later migration... permanently emptying its Facilities page."
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({
        status: 'published',
        target_pages: JSON.stringify(['facilities']),
        schema: JSON.stringify({ id: 'sample-facility', fields: NEW_FIELDS_SNAPSHOT, targetPages: ['facilities'] }),
      }) as never,
    ).execute();
    await down(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['facilities']);
    expect(row.status).toBe('published');
    await db.destroy();
  });

  it('C1: does NOT touch a legacy row up() itself left alone (still targeting ["forms"])', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seeded() as never).execute();
    // up() never ran (or ran and no-opped) — down() must not go looking for something to revert.
    await down(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['forms']);
    expect(row.status).toBe('draft');
    await db.destroy();
  });

  it('C1: does NOT touch a row an operator has already re-saved through the builder since the migration', async () => {
    // normalizeFormSchema() → FormSchema.parse() strips unknown keys by default, so the very first
    // builder save after up() drops the __migration071 marker even if content stayed otherwise
    // identical. Simulate that here directly against the row.
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seeded() as never).execute();
    await up(db);
    const migrated: any = await getRow(db, 'form-sample-facility');
    const schemaWithoutMarker = { ...parseJson(migrated.schema) as object };
    delete (schemaWithoutMarker as any).__migration071;
    await db.updateTable('form_definitions')
      .set({ schema: JSON.stringify(schemaWithoutMarker) } as never)
      .where('id', '=', 'form-sample-facility').execute();

    await down(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['facilities']); // unchanged — marker was gone
    expect(row.status).toBe('published');
    await db.destroy();
  });

  it('is a no-op when no seeded form exists', async () => {
    const db = await makeMigratedDb();
    await expect(down(db)).resolves.not.toThrow();
    await db.destroy();
  });
});

// Review round 2 (Finding 1 + Finding 3): the fixtures below are HAND-TRANSCRIBED from git history,
// NOT built from OLD_FIELDS_SNAPSHOT / PRE_DISCRIMINATOR_FIELDS_SNAPSHOT (the migration's own
// constants, as `seeded()` above does). That is the whole point — a fixture derived from the same
// constant the migration compares against can never catch that constant itself being wrong, which is
// exactly how round 1 shipped a migration that silently no-op'd on the six-week window of installs
// that constitutes essentially every real deployment. Provenance for each shape is the literal
// `git show` command used to pull it, so it is auditable independent of this file.
describe('071_facility_form_target — literal historical fixtures (not derived from the migration)', () => {
  // git show efde1594:packages/forms/src/samples/forms.ts
  // Era 1: 2026-06-19 -> 2026-06-21 (efde1594..0ef91c21~1). Shipped with target_pages ['facilities']
  // already — the facility form pointed at a page that didn't exist yet.
  const ERA1_FIELDS = [
    { id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null, fieldType: 'text', required: true, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, apiProperty: 'name' },
    { id: 'fld-fac-local-id', fhirPath: 'identifier.value', displayLabel: 'Local ID', description: null, fieldType: 'identifier', required: false, enabled: true, order: 1, cardinality: { min: 0, max: '1' }, apiProperty: 'localId' },
    { id: 'fld-fac-mfl-id', fhirPath: 'identifier.value', displayLabel: 'MFL ID', description: null, fieldType: 'identifier', required: false, enabled: true, order: 2, cardinality: { min: 0, max: '1' } },
    {
      id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null, fieldType: 'select', required: false, enabled: true, order: 3, cardinality: { min: 0, max: '1' },
      valueSetOptions: [
        { code: 'national', display: 'National' }, { code: 'regional', display: 'Regional' },
        { code: 'district', display: 'District' }, { code: 'facility', display: 'Facility' },
      ],
    },
    { id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null, fieldType: 'text', required: false, enabled: true, order: 4, cardinality: { min: 0, max: '1' } },
    { id: 'fld-fac-district', fhirPath: 'address.district', displayLabel: 'District', description: null, fieldType: 'text', required: false, enabled: true, order: 5, cardinality: { min: 0, max: '1' } },
    { id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null, fieldType: 'text', required: false, enabled: true, order: 6, cardinality: { min: 0, max: '1' } },
    { id: 'fld-fac-phone', fhirPath: 'telecom.value', displayLabel: 'Phone', description: null, fieldType: 'phone', required: false, enabled: true, order: 7, cardinality: { min: 0, max: '1' } },
  ];

  // git show 0ef91c21:packages/forms/src/samples/forms.ts
  // Era 2: 2026-06-21 -> 2026-08-04 09:17 (0ef91c21..7b4d4d58~1) — the six-week window that is
  // essentially every real install. Fields are byte-for-byte identical to ERA1_FIELDS; only
  // target_pages changed (['forms'] here, retargeted off the LIS-only pages).
  const ERA2_FIELDS = ERA1_FIELDS;

  // git show 7b4d4d58:packages/forms/src/samples/forms.ts
  // Era 3: 2026-08-04 09:17 -> today (7b4d4d58..4b7b181f~1) — adds fhirDiscriminator to Local ID and
  // MFL ID (and an apiProperty to MFL ID), fixing the fhirPath collision. `git diff 7b4d4d58
  // 4b7b181f~1 -- packages/forms/src/samples/forms.ts` is empty, confirming this is the exact shape
  // right up until 4b7b181f moved the sample again.
  const ERA3_FIELDS = [
    { id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null, fieldType: 'text', required: true, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, apiProperty: 'name' },
    {
      id: 'fld-fac-local-id', fhirPath: 'identifier.value', fhirDiscriminator: { system: 'urn:openldr:facility:local' },
      displayLabel: 'Local ID', description: null, fieldType: 'identifier', required: false, enabled: true, order: 1,
      cardinality: { min: 0, max: '1' }, apiProperty: 'localId',
    },
    {
      id: 'fld-fac-mfl-id', fhirPath: 'identifier.value', fhirDiscriminator: { system: 'urn:openldr:facility:national' },
      displayLabel: 'MFL ID', description: null, fieldType: 'identifier', required: false, enabled: true, order: 2,
      cardinality: { min: 0, max: '1' }, apiProperty: 'mflId',
    },
    {
      id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null, fieldType: 'select', required: false, enabled: true, order: 3, cardinality: { min: 0, max: '1' },
      valueSetOptions: [
        { code: 'national', display: 'National' }, { code: 'regional', display: 'Regional' },
        { code: 'district', display: 'District' }, { code: 'facility', display: 'Facility' },
      ],
    },
    { id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null, fieldType: 'text', required: false, enabled: true, order: 4, cardinality: { min: 0, max: '1' } },
    { id: 'fld-fac-district', fhirPath: 'address.district', displayLabel: 'District', description: null, fieldType: 'text', required: false, enabled: true, order: 5, cardinality: { min: 0, max: '1' } },
    { id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null, fieldType: 'text', required: false, enabled: true, order: 6, cardinality: { min: 0, max: '1' } },
    { id: 'fld-fac-phone', fhirPath: 'telecom.value', displayLabel: 'Phone', description: null, fieldType: 'phone', required: false, enabled: true, order: 7, cardinality: { min: 0, max: '1' } },
  ];

  it('Era 1: repoints an install that already targets facilities under the pre-discriminator fields (Finding 1 + 2)', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({
        target_pages: JSON.stringify(['facilities']),
        schema: JSON.stringify({ id: 'sample-facility', fields: ERA1_FIELDS }),
      }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['facilities']);
    expect(row.status).toBe('published');
    expect((parseJson(row.schema) as any).fields).toEqual(NEW_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it('Era 2: repoints an install targeting forms under the pre-discriminator fields (Finding 1 — the six-week window)', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({
        target_pages: JSON.stringify(['forms']),
        schema: JSON.stringify({ id: 'sample-facility', fields: ERA2_FIELDS }),
      }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['facilities']);
    expect(row.status).toBe('published');
    expect((parseJson(row.schema) as any).fields).toEqual(NEW_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it('Era 3: repoints an install targeting forms under the discriminator fields, verified against a literal independent of OLD_FIELDS_SNAPSHOT', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({
        target_pages: JSON.stringify(['forms']),
        schema: JSON.stringify({ id: 'sample-facility', fields: ERA3_FIELDS }),
      }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['facilities']);
    expect(row.status).toBe('published');
    expect((parseJson(row.schema) as any).fields).toEqual(NEW_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it("down() round-trips an Era 1 row back to target_pages ['facilities'] with the PRE-discriminator fields, not Era 3's OLD_FIELDS", async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({
        status: 'draft',
        target_pages: JSON.stringify(['facilities']),
        schema: JSON.stringify({ id: 'sample-facility', fields: ERA1_FIELDS }),
      }) as never,
    ).execute();
    await up(db);
    await down(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['facilities']);
    expect(row.status).toBe('draft');
    expect((parseJson(row.schema) as any).fields).toEqual(ERA1_FIELDS);
    await db.destroy();
  });

  it("down() round-trips an Era 2 row back to target_pages ['forms'] with the PRE-discriminator fields", async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({
        status: 'draft',
        target_pages: JSON.stringify(['forms']),
        schema: JSON.stringify({ id: 'sample-facility', fields: ERA2_FIELDS }),
      }) as never,
    ).execute();
    await up(db);
    await down(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect(parseJson(row.target_pages)).toEqual(['forms']);
    expect(row.status).toBe('draft');
    expect((parseJson(row.schema) as any).fields).toEqual(ERA2_FIELDS);
    await db.destroy();
  });

  it('⛔ an Era 1 install with an operator-edited field is never clobbered even though target_pages already matches', async () => {
    // Same shape as Era 1 except one field is relabelled — proves the widened ['facilities'] guard
    // did not become a loose match: it still requires exact field equality, just against a second
    // accepted shape.
    const db = await makeMigratedDb();
    const editedFields = ERA1_FIELDS.map((f, i) => (i === 0 ? { ...f, displayLabel: 'Facility name (custom)' } : f));
    await db.insertInto('form_definitions' as never).values(
      seeded({
        target_pages: JSON.stringify(['facilities']),
        schema: JSON.stringify({ id: 'sample-facility', fields: editedFields }),
      }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(editedFields); // untouched
    expect(row.status).toBe('draft'); // seeded() default — never republished
    await db.destroy();
  });
});
