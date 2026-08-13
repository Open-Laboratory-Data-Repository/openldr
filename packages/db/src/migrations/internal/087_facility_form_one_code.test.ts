import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { up, down, BOUND_FIELDS_SNAPSHOT } from './087_facility_form_one_code';
import { BOUND_FIELDS_SNAPSHOT as PREV } from './085_facility_national_code_field';

// pg-mem hands jsonb back already parsed — same guard 072/073/085's tests carry.
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

describe('087 — the copied PREV snapshot has not drifted from 085', () => {
  it('⛔ matches 085\'s exported snapshot EXACTLY', async () => {
    // This is the test that matters most in this file. `PREV_BOUND_FIELDS_SNAPSHOT` is a hand-copy of
    // 085's array (copied, not imported, so a frozen snapshot cannot be changed from a distance). A
    // single transcription slip makes `repointForm`'s deep-equality guard never match, and the
    // migration silently does NOTHING on every install — green tests, unmigrated form.
    //
    // Reaching into the module's private constant via up() is not possible, so this drives it the
    // only way that proves the match: seed 085's REAL exported array and assert up() rewrites it.
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm(PREV) as never).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(BOUND_FIELDS_SNAPSHOT);
    await db.destroy();
  });
});

describe('087_facility_form_one_code — the snapshot itself', () => {
  const byId = Object.fromEntries((BOUND_FIELDS_SNAPSHOT as any[]).map((f) => [f.id, f]));

  it('carries ONE code and the system that names it, both required, system first', () => {
    expect(byId['fld-fac-system'].apiProperty).toBe('facilitySystem');
    expect(byId['fld-fac-system'].required).toBe(true);
    expect(byId['fld-fac-code'].apiProperty).toBe('facilityCode');
    expect(byId['fld-fac-code'].required).toBe(true);
    expect(byId['fld-fac-system'].order).toBeLessThan(byId['fld-fac-code'].order);
  });

  it('⛔ drops the three fields the two columns needed', () => {
    // Two code boxes is the confusion this whole arc came from — an operator moved their code from
    // one to the other and was refused.
    expect(byId['fld-fac-local-code']).toBeUndefined();
    expect(byId['fld-fac-national-code']).toBeUndefined();
    expect(byId['fld-fac-national-system']).toBeUndefined();
  });

  it('requires exactly System, Facility code, Name, Country, Zone, District, Status, Level', () => {
    const required = (BOUND_FIELDS_SNAPSHOT as any[]).filter((f) => f.required).map((f) => f.apiProperty).sort();
    expect(required).toEqual(
      ['country', 'district', 'facilityCode', 'facilitySystem', 'level', 'name', 'status', 'zone'].sort(),
    );
  });

  it('leaves region and council optional', () => {
    expect(byId['fld-fac-region'].required).toBe(false);
    expect(byId['fld-fac-council'].required).toBe(false);
  });

  it('gives every field a distinct, gap-free order', () => {
    const orders = (BOUND_FIELDS_SNAPSHOT as any[]).map((f) => f.order).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: BOUND_FIELDS_SNAPSHOT.length }, (_, i) => i));
  });
});

describe('087_facility_form_one_code — form repoint', () => {
  it('⛔ leaves an OPERATOR-EDITED form alone (a relabelled field is never clobbered)', async () => {
    const db = await makeMigratedDb();
    const edited = (PREV as any[]).map((f, i) => (i === 3 ? { ...f, displayLabel: 'Facility name (custom)' } : f));
    await db.insertInto('form_definitions' as never).values(seededForm(edited) as never).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(edited);
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
    await db.insertInto('form_definitions' as never).values(seededForm(PREV) as never).execute();
    await up(db);
    await expect(up(db)).resolves.not.toThrow();
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(BOUND_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it('round-trips a migrated row back to 085\'s snapshot', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm(PREV) as never).execute();
    await up(db);
    await down(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(PREV);
    await db.destroy();
  });

  it('down() does NOT touch a row up() itself left alone', async () => {
    const db = await makeMigratedDb();
    const edited = (PREV as any[]).map((f, i) => (i === 3 ? { ...f, displayLabel: 'custom' } : f));
    await db.insertInto('form_definitions' as never).values(seededForm(edited) as never).execute();
    await down(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(edited);
    await db.destroy();
  });
});
