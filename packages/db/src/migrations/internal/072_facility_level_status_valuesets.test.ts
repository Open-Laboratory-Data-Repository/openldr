import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from './test-helpers';
import { up, down, BOUND_FIELDS_SNAPSHOT } from './072_facility_level_status_valuesets';
import { NEW_FIELDS_SNAPSHOT } from './071_facility_form_target';

// pg-mem hands a jsonb column back already parsed, not as a JSON string — see
// 071_facility_form_target.test.ts's identical guard for why this can't be an unconditional
// JSON.parse.
const parseJson = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

describe('072_facility_level_status_valuesets — Status ValueSet', () => {
  it('seeds urn:openldr:valueset:location-status with the three FHIR location-status codes', async () => {
    const db = await makeMigratedDb();
    const vs = await db.selectFrom('value_sets').select(['id', 'status'])
      .where('url', '=', 'urn:openldr:valueset:location-status').executeTakeFirstOrThrow();
    expect(vs.status).toBe('active');

    const exp = await db.selectFrom('valueset_expansions').select(['code', 'display'])
      .where('value_set_id', '=', vs.id).orderBy('code').execute();
    expect(exp).toHaveLength(3);
    expect(exp.map((e) => e.code)).toEqual(['active', 'inactive', 'suspended']);
    expect(exp.find((e) => e.code === 'active')?.display).toBe('Active');
    await db.destroy();
  });

  it('every seeded concept has UPPERCASE status ACTIVE', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('terminology_concepts').select(['code', 'status'])
      .where('system', '=', 'http://hl7.org/fhir/location-status').execute();
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.status).toBe('ACTIVE');
    await db.destroy();
  });

  it('flips a PRE-EXISTING inactive coding_systems stub to active, without inserting a duplicate row', async () => {
    // A real install's FHIR-core catalog import already seeds this row (outside any numbered
    // migration) as an inactive stub with zero concepts, at some pre-existing id. Simulate that
    // here and re-run up() to prove it flips the existing row rather than adding a second one.
    const db = await makeMigratedDb(); // 072 already ran once via makeMigratedDb()
    await db.deleteFrom('coding_systems').where('url', '=', 'http://hl7.org/fhir/location-status').execute();
    await db.insertInto('coding_systems' as never).values({
      id: 'cs-live-random-uuid', system_code: 'LOCATION-STATUS', system_name: 'LocationStatus',
      url: 'http://hl7.org/fhir/location-status', system_version: null, description: null,
      active: false, publisher_id: 'pub-hl7-fhir', seeded: true,
    } as never).execute();

    await up(db);

    const rows = await db.selectFrom('coding_systems').select(['id', 'active'])
      .where('url', '=', 'http://hl7.org/fhir/location-status').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('cs-live-random-uuid'); // the pre-existing row, not a new one
    expect(rows[0]!.active).toBe(true);
    await db.destroy();
  });

  it('inserts a minimal active row when no coding_systems stub exists at all (a bare test/CI database)', async () => {
    const db = await makeMigratedDb();
    const row = await db.selectFrom('coding_systems').select(['active', 'seeded'])
      .where('url', '=', 'http://hl7.org/fhir/location-status').executeTakeFirstOrThrow();
    expect(row.active).toBe(true);
    expect(row.seeded).toBe(true);
    await db.destroy();
  });
});

describe('072_facility_level_status_valuesets — Level (facility-type) ValueSet', () => {
  it('registers a DEDICATED coding system, not the shared urn:openldr:cs:local space', async () => {
    const db = await makeMigratedDb();
    const cs = await db.selectFrom('coding_systems').select(['url', 'active'])
      .where('url', '=', 'urn:openldr:cs:facility-type').executeTakeFirstOrThrow();
    expect(cs.active).toBe(true);
    await db.destroy();
  });

  it('seeds urn:openldr:valueset:facility-type with exactly 63 concepts, unique codes and displays', async () => {
    const db = await makeMigratedDb();
    const vs = await db.selectFrom('value_sets').select(['id'])
      .where('url', '=', 'urn:openldr:valueset:facility-type').executeTakeFirstOrThrow();
    const exp = await db.selectFrom('valueset_expansions').select(['code', 'display'])
      .where('value_set_id', '=', vs.id).execute();

    expect(exp).toHaveLength(63);
    expect(new Set(exp.map((e) => e.code)).size).toBe(63);
    expect(new Set(exp.map((e) => e.display)).size).toBe(63);

    // A known code, to guard against the silent-empty-expansion failure mode.
    const dispensary = exp.find((e) => e.code === 'dispensary');
    expect(dispensary?.display).toBe('Dispensary');
    // Verbatim inconsistent casing preserved, not "fixed".
    const mobileDental = exp.find((e) => e.code === 'mobile-dental-clinic');
    expect(mobileDental?.display).toBe('Mobile Dental clinic');
    await db.destroy();
  });

  it('every seeded concept has UPPERCASE status ACTIVE', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('terminology_concepts').select(['status'])
      .where('system', '=', 'urn:openldr:cs:facility-type').execute();
    expect(rows).toHaveLength(63);
    for (const r of rows) expect(r.status).toBe('ACTIVE');
    await db.destroy();
  });

  it("neither ValueSet's compose uses a FHIR filter clause", async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('value_sets').select(['compose'])
      .where('url', 'in', ['urn:openldr:valueset:facility-type', 'urn:openldr:valueset:location-status']).execute();
    for (const r of rows) {
      const compose = parseJson(r.compose) as { include: { concept?: unknown; filter?: unknown }[] };
      for (const inc of compose.include) {
        expect(inc.filter).toBeUndefined();
        expect(Array.isArray(inc.concept)).toBe(true);
      }
    }
    await db.destroy();
  });
});

describe('072_facility_level_status_valuesets — idempotency', () => {
  it('running up() twice is a no-op: no duplicate rows, no throw', async () => {
    const db = await makeMigratedDb();
    await expect(up(db)).resolves.not.toThrow();

    const statusExp = await db.selectFrom('valueset_expansions').selectAll()
      .where('value_set_id', '=', 'vs-location-status').execute();
    expect(statusExp).toHaveLength(3);

    const levelExp = await db.selectFrom('valueset_expansions').selectAll()
      .where('value_set_id', '=', 'vs-facility-type').execute();
    expect(levelExp).toHaveLength(63);

    const codingSystems = await db.selectFrom('coding_systems').select(['id'])
      .where('url', 'in', ['http://hl7.org/fhir/location-status', 'urn:openldr:cs:facility-type']).execute();
    expect(codingSystems).toHaveLength(2);
    await db.destroy();
  });
});

describe('072_facility_level_status_valuesets — change_log projection reachability', () => {
  it('writes a fhir.change_log row for each seeded ValueSet (both carry an expansion, unlike 069)', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('fhir.change_log').select(['resource_type', 'resource_id', 'version', 'op', 'content_hash', 'site_id'])
      .where('resource_type', '=', 'ValueSet')
      .where('resource_id', 'in', ['vs-location-status', 'vs-facility-type'])
      .execute();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.op).toBe('upsert');
      expect(r.version).toBe(1);
      expect(typeof r.content_hash).toBe('string');
      expect((r.content_hash as string).length).toBe(64); // sha256 hex, matches fhir-store.ts's contentHash()
    }
    await db.destroy();
  });

  it('running up() twice does not duplicate the change_log rows', async () => {
    const db = await makeMigratedDb(); // 072 already ran once via makeMigratedDb()
    await up(db);

    const rows = await db.selectFrom('fhir.change_log').select(['seq'])
      .where('resource_type', '=', 'ValueSet')
      .where('resource_id', 'in', ['vs-location-status', 'vs-facility-type'])
      .execute();
    expect(rows).toHaveLength(2);
    await db.destroy();
  });
});

describe('072_facility_level_status_valuesets — fhir.resource_history (version-reuse fix)', () => {
  it('writes a fhir.resource_history row at version 1, op upsert, for each seeded ValueSet', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('fhir.resource_history').select(['resource_type', 'id', 'version', 'op', 'resource'])
      .where('resource_type', '=', 'ValueSet')
      .where('id', 'in', ['vs-location-status', 'vs-facility-type'])
      .execute();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.version).toBe(1);
      expect(r.op).toBe('upsert');
      expect(r.resource).toBeTruthy();
    }
    await db.destroy();
  });

  it('a fhirStore.save()-style version derivation (coalesce(max(resource_history.version),0)+1) yields 2, not 1', async () => {
    const db = await makeMigratedDb();
    for (const id of ['vs-location-status', 'vs-facility-type']) {
      const hi = await db.selectFrom('fhir.resource_history')
        .select(sql<number>`coalesce(max(version), 0)`.as('maxv'))
        .where('resource_type', '=', 'ValueSet')
        .where('id', '=', id)
        .executeTakeFirst();
      const next = Number(hi?.maxv ?? 0) + 1;
      expect(next).toBe(2); // NOT 1 — the defect this fix closes
    }
    await db.destroy();
  });

  it('running up() twice does not duplicate the resource_history rows', async () => {
    const db = await makeMigratedDb(); // 072 already ran once via makeMigratedDb()
    await up(db);

    const rows = await db.selectFrom('fhir.resource_history').select(['id'])
      .where('resource_type', '=', 'ValueSet')
      .where('id', 'in', ['vs-location-status', 'vs-facility-type'])
      .execute();
    expect(rows).toHaveLength(2);
    await db.destroy();
  });
});

const seededForm = (over: Record<string, unknown> = {}) => ({
  id: 'form-sample-facility', name: 'Facility', version_label: 'v1',
  fhir_resource_type: 'Location', fhir_version: 'R4', status: 'published', active: true,
  schema: JSON.stringify({ id: 'sample-facility', fields: NEW_FIELDS_SNAPSHOT, targetPages: ['facilities'] }),
  target_pages: JSON.stringify(['facilities']),
  ...over,
});

const getRow = async (db: any, id: string) =>
  db.selectFrom('form_definitions').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

describe('072_facility_level_status_valuesets — form repoint up()', () => {
  it("repoints a Facility form matching 071's NEW_FIELDS_SNAPSHOT to the bound level/status fields", async () => {
    const db = await makeMigratedDb(); // 072 already ran once via makeMigratedDb() against no matching row
    await db.insertInto('form_definitions' as never).values(seededForm() as never).execute();
    await up(db);

    const row: any = await getRow(db, 'form-sample-facility');
    const schema: any = parseJson(row.schema);
    expect(schema.fields).toEqual(BOUND_FIELDS_SNAPSHOT);

    const status = schema.fields.find((f: any) => f.id === 'fld-fac-status');
    expect(status.fieldType).toBe('reference');
    expect(status.valueSetUrl).toBe('urn:openldr:valueset:location-status');
    const level = schema.fields.find((f: any) => f.id === 'fld-fac-level');
    expect(level.fieldType).toBe('reference');
    expect(level.valueSetUrl).toBe('urn:openldr:valueset:facility-type');

    // Every other field, and every other property of status/level, is untouched.
    expect(schema.fields.filter((f: any) => f.id !== 'fld-fac-status' && f.id !== 'fld-fac-level'))
      .toEqual(NEW_FIELDS_SNAPSHOT.filter((f: any) => f.id !== 'fld-fac-status' && f.id !== 'fld-fac-level'));
    await db.destroy();
  });

  it('⛔ leaves an OPERATOR-EDITED form alone (a relabelled field is never clobbered)', async () => {
    const db = await makeMigratedDb();
    const editedFields = (NEW_FIELDS_SNAPSHOT as any[]).map((f, i) => (i === 1 ? { ...f, displayLabel: 'Facility name (custom)' } : f));
    await db.insertInto('form_definitions' as never).values(
      seededForm({ schema: JSON.stringify({ id: 'sample-facility', fields: editedFields, targetPages: ['facilities'] }) }) as never,
    ).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(editedFields);
    await db.destroy();
  });

  it('leaves a form ALREADY carrying the new bound fields alone', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seededForm({ schema: JSON.stringify({ id: 'sample-facility', fields: BOUND_FIELDS_SNAPSHOT, targetPages: ['facilities'] }) }) as never,
    ).execute();
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
    await db.insertInto('form_definitions' as never).values(seededForm() as never).execute();
    await up(db);
    await expect(up(db)).resolves.not.toThrow();
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(BOUND_FIELDS_SNAPSHOT);
    await db.destroy();
  });
});

describe('072_facility_level_status_valuesets — form repoint down()', () => {
  it('reverses exactly what up() did — round-trips a migrated row back to its NEW_FIELDS_SNAPSHOT fields', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm() as never).execute();
    await up(db);
    const migrated: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(migrated.schema) as any).fields).toEqual(BOUND_FIELDS_SNAPSHOT); // sanity

    await down(db);
    const reverted: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(reverted.schema) as any).fields).toEqual(NEW_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it('does NOT touch a row up() itself left alone (an operator edit)', async () => {
    const db = await makeMigratedDb();
    const editedFields = (NEW_FIELDS_SNAPSHOT as any[]).map((f, i) => (i === 1 ? { ...f, displayLabel: 'custom' } : f));
    await db.insertInto('form_definitions' as never).values(
      seededForm({ schema: JSON.stringify({ id: 'sample-facility', fields: editedFields, targetPages: ['facilities'] }) }) as never,
    ).execute();
    await down(db); // up() never ran / no-opped — down() must not go looking for anything
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(editedFields);
    await db.destroy();
  });

  it('does NOT touch a row an operator has already re-saved through the builder since up() ran (marker stripped)', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm() as never).execute();
    await up(db);
    const migrated: any = await getRow(db, 'form-sample-facility');
    const schemaWithoutMarker = { ...(parseJson(migrated.schema) as object) };
    delete (schemaWithoutMarker as any).__migration072;
    await db.updateTable('form_definitions').set({ schema: JSON.stringify(schemaWithoutMarker) } as never)
      .where('id', '=', 'form-sample-facility').execute();

    await down(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(BOUND_FIELDS_SNAPSHOT); // unchanged — marker was gone
    await db.destroy();
  });

  it('is a no-op when no seeded form exists', async () => {
    const db = await makeMigratedDb();
    await expect(down(db)).resolves.not.toThrow();
    await db.destroy();
  });
});

describe('072_facility_level_status_valuesets — down() concept ownership', () => {
  it('does NOT delete ANY location-status concept, but removes every facility-type concept', async () => {
    const db = await makeMigratedDb(); // 072 already ran once via makeMigratedDb()

    // Simulate a concept that predates up() entirely (e.g. imported separately from the FHIR core
    // CodeSystem bundle), alongside the three up() itself seeded under the same STATUS_SYSTEM.
    await db.insertInto('terminology_concepts' as never).values({
      system: 'http://hl7.org/fhir/location-status', code: 'unknown', display: 'Unknown (pre-existing)',
      status: 'ACTIVE', properties: null,
    } as never).execute();

    await down(db);

    // down() never deletes anything under STATUS_SYSTEM — FHIR's own standard codes, unprovable
    // ownership — so BOTH the pre-existing row and up()'s own three seeded codes survive.
    const statusRemaining = await db.selectFrom('terminology_concepts').select(['code'])
      .where('system', '=', 'http://hl7.org/fhir/location-status').execute();
    expect(statusRemaining.map((r: any) => r.code).sort()).toEqual(['active', 'inactive', 'suspended', 'unknown']);

    // LEVEL_SYSTEM, by contrast, is a namespace this migration created outright — down() removes
    // every concept under it unconditionally.
    const levelRemaining = await db.selectFrom('terminology_concepts').select(['code'])
      .where('system', '=', 'urn:openldr:cs:facility-type').execute();
    expect(levelRemaining).toHaveLength(0);
    await db.destroy();
  });
});
