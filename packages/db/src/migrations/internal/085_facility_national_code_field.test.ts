import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { up, down, BOUND_FIELDS_SNAPSHOT } from './085_facility_national_code_field';
import { BOUND_FIELDS_SNAPSHOT as PREV_BOUND_FIELDS_SNAPSHOT } from './073_facility_country_and_admin_fields';

// pg-mem hands a jsonb column back already parsed, not as a JSON string — same guard as
// 072/073's own tests.
const parseJson = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

const seededForm = (fields: readonly unknown[], over: Record<string, unknown> = {}) => ({
  id: 'form-sample-facility', name: 'Facility', version_label: 'v1',
  fhir_resource_type: 'Location', fhir_version: 'R4', status: 'published', active: true,
  schema: JSON.stringify({ id: 'sample-facility', fields, targetPages: ['facilities'] }),
  target_pages: JSON.stringify(['facilities']),
  ...over,
});

const getRow = async (db: any, id: string) =>
  db.selectFrom('form_definitions').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

describe('085_facility_national_code_field — the snapshot itself', () => {
  const byId = Object.fromEntries((BOUND_FIELDS_SNAPSHOT as any[]).map((f) => [f.id, f]));

  it('offers both codes, neither required, with the national one first', () => {
    expect(byId['fld-fac-national-code'].apiProperty).toBe('nationalCode');
    expect(byId['fld-fac-national-code'].required).toBe(false);
    expect(byId['fld-fac-national-code'].cardinality.min).toBe(0);
    expect(byId['fld-fac-local-code'].apiProperty).toBe('localCode');
    expect(byId['fld-fac-local-code'].required).toBe(false);
    expect(byId['fld-fac-local-code'].cardinality.min).toBe(0);
    expect(byId['fld-fac-national-code'].order).toBeLessThan(byId['fld-fac-local-code'].order);
  });

  it('relabels the local code so it stops reading as the table\'s CODE column', () => {
    // The Facilities table shows `localCode ?? nationalCode`, so a field labelled with the generic
    // "Facility code" read as the same thing while binding only one of the two.
    expect(byId['fld-fac-local-code'].displayLabel).toBe('Local code');
    expect(byId['fld-fac-national-code'].displayLabel).toBe('National code');
  });

  it('carries a facility-register field bound to nationalSystem', () => {
    expect(byId['fld-fac-national-system'].apiProperty).toBe('nationalSystem');
    expect(byId['fld-fac-national-system'].fieldType).toBe('suggest');
    expect(byId['fld-fac-national-system'].required).toBe(false);
    // No standard R4 element fits a register identifier here, and the `ambiguous-fhir-path` lint
    // rule skips falsy paths — same choice 073 made for council.
    expect(byId['fld-fac-national-system'].fhirPath).toBeNull();
  });

  it('leaves region OPTIONAL — a register with no tier between province and district has none', () => {
    expect(byId['fld-fac-region'].required).toBe(false);
    expect(byId['fld-fac-region'].cardinality.min).toBe(0);
  });

  it('leaves the other admin tiers required, so this relaxation is narrow', () => {
    for (const id of ['fld-fac-zone', 'fld-fac-district', 'fld-fac-country']) {
      expect(byId[id].required, `${id}.required`).toBe(true);
    }
    expect(byId['fld-fac-council'].required).toBe(false); // already optional in 073
  });

  it('gives every field a distinct, gap-free order', () => {
    const orders = (BOUND_FIELDS_SNAPSHOT as any[]).map((f) => f.order).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: BOUND_FIELDS_SNAPSHOT.length }, (_, i) => i));
  });
});

describe('085_facility_national_code_field — form repoint up()', () => {
  it("repoints a Facility form matching 073's BOUND_FIELDS_SNAPSHOT", async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm(PREV_BOUND_FIELDS_SNAPSHOT) as never).execute();
    await up(db);

    const row: any = await getRow(db, 'form-sample-facility');
    const schema: any = parseJson(row.schema);
    expect(schema.fields).toEqual(BOUND_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it('⛔ leaves an OPERATOR-EDITED form alone (a relabelled field is never clobbered)', async () => {
    const db = await makeMigratedDb();
    const editedFields = (PREV_BOUND_FIELDS_SNAPSHOT as any[]).map((f, i) => (i === 1 ? { ...f, displayLabel: 'Facility name (custom)' } : f));
    await db.insertInto('form_definitions' as never).values(seededForm(editedFields) as never).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(editedFields);
    await db.destroy();
  });

  it('leaves a form ALREADY carrying the new fields alone', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm(BOUND_FIELDS_SNAPSHOT) as never).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(BOUND_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it('is a no-op when no seeded form exists', async () => {
    const db = await makeMigratedDb();
    await expect(up(db)).resolves.not.toThrow();
    await db.destroy();
  });

  it('is idempotent across a re-run of up()', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm(PREV_BOUND_FIELDS_SNAPSHOT) as never).execute();
    await up(db);
    await expect(up(db)).resolves.not.toThrow();
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(BOUND_FIELDS_SNAPSHOT);
    await db.destroy();
  });
});

describe('085_facility_national_code_field — form repoint down()', () => {
  it("round-trips a migrated row back to 073's BOUND_FIELDS_SNAPSHOT", async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm(PREV_BOUND_FIELDS_SNAPSHOT) as never).execute();
    await up(db);
    const migrated: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(migrated.schema) as any).fields).toEqual(BOUND_FIELDS_SNAPSHOT); // sanity

    await down(db);
    const reverted: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(reverted.schema) as any).fields).toEqual(PREV_BOUND_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it('does NOT touch a row up() itself left alone (an operator edit)', async () => {
    const db = await makeMigratedDb();
    const editedFields = (PREV_BOUND_FIELDS_SNAPSHOT as any[]).map((f, i) => (i === 1 ? { ...f, displayLabel: 'custom' } : f));
    await db.insertInto('form_definitions' as never).values(seededForm(editedFields) as never).execute();
    await down(db); // up() never ran / no-opped — down() must not go looking for anything
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(editedFields);
    await db.destroy();
  });
});
