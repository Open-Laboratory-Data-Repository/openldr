import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from './test-helpers';
import { up, down, BOUND_FIELDS_SNAPSHOT, COUNTRY_CONCEPTS } from './073_facility_country_and_admin_fields';
import { BOUND_FIELDS_SNAPSHOT as PREV_BOUND_FIELDS_SNAPSHOT } from './072_facility_level_status_valuesets';
import { createTerminologyAdminStore } from '../../terminology-admin-store';
import { ISO3166_COUNTRIES } from '../../iso3166';

// pg-mem hands a jsonb column back already parsed, not as a JSON string — same guard as
// 072_facility_level_status_valuesets.test.ts.
const parseJson = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

describe('073_facility_country_and_admin_fields — inlined literals never drift from ISO3166_COUNTRIES', () => {
  it('COUNTRY_CONCEPTS equals ISO3166_COUNTRIES exactly, in order', () => {
    expect(COUNTRY_CONCEPTS.map(([code, name]) => [code, name])).toEqual(
      ISO3166_COUNTRIES.map(([a3, name]) => [a3, name]),
    );
  });

  it('has exactly 249 entries', () => {
    expect(COUNTRY_CONCEPTS).toHaveLength(249);
  });
});

describe('073_facility_country_and_admin_fields — Country ValueSet', () => {
  it('seeds urn:openldr:valueset:country with all 249 ISO 3166-1 concepts', async () => {
    const db = await makeMigratedDb();
    const vs = await db.selectFrom('value_sets').select(['id', 'status'])
      .where('url', '=', 'urn:openldr:valueset:country').executeTakeFirstOrThrow();
    expect(vs.status).toBe('active');

    const exp = await db.selectFrom('valueset_expansions').select(['code', 'display'])
      .where('value_set_id', '=', vs.id).execute();
    expect(exp).toHaveLength(249);
    expect(new Set(exp.map((e) => e.code)).size).toBe(249);

    // A known code, and one of the six diacritic names, to guard against transcription mangling.
    const tza = exp.find((e) => e.code === 'TZA');
    expect(tza?.display).toBe('Tanzania, United Republic of');
    const civ = exp.find((e) => e.code === 'CIV');
    expect(civ?.display).toBe("Côte d'Ivoire");
    await db.destroy();
  });

  it('every seeded concept has UPPERCASE status ACTIVE', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('terminology_concepts').select(['code', 'status'])
      .where('system', '=', 'urn:iso:std:iso:3166').execute();
    expect(rows).toHaveLength(249);
    for (const r of rows) expect(r.status).toBe('ACTIVE');
    await db.destroy();
  });

  it("compose does not use a FHIR filter clause — enumerates every concept explicitly", async () => {
    const db = await makeMigratedDb();
    const row = await db.selectFrom('value_sets').select(['compose'])
      .where('url', '=', 'urn:openldr:valueset:country').executeTakeFirstOrThrow();
    const compose = parseJson(row.compose) as { include: { concept?: unknown; filter?: unknown }[] };
    for (const inc of compose.include) {
      expect(inc.filter).toBeUndefined();
      expect(Array.isArray(inc.concept)).toBe(true);
    }
    await db.destroy();
  });

  it('does NOT overwrite the HL7-published iso3166-1-3 ValueSet', async () => {
    const db = await makeMigratedDb();
    // Nothing in this repo seeds http://hl7.org/fhir/ValueSet/iso3166-1-3 under makeMigratedDb()
    // (that only happens via a real bundled R4-catalog import), so without a stand-in row this
    // test's entire body used to sit inside `if (hl7)` and never ran — green while asserting
    // nothing. Seed a stand-in row ourselves, filter-shaped like HL7's real publication (never
    // `concept: [...]`, unlike this migration's own enumerated seed), so up() actually has
    // something to potentially clobber.
    const hl7Compose = { include: [{ system: 'urn:iso:std:iso:3166', filter: [{ property: 'code', op: 'regex', value: '^[A-Z]{3}$' }] }] };
    await db.insertInto('value_sets').values({
      id: 'vs-hl7-iso3166-1-3', url: 'http://hl7.org/fhir/ValueSet/iso3166-1-3', version: null,
      name: 'iso3166-1-3', title: 'ISO 3166-1 (alpha-3)', status: 'active', experimental: false,
      description: null, compose: JSON.stringify(hl7Compose) as never, immutable: false, category: null,
      publisher_id: 'pub-hl7-fhir', expanded_at: null,
    } as never).execute();

    await up(db);

    const hl7 = await db.selectFrom('value_sets').select(['id', 'status', 'compose'])
      .where('url', '=', 'http://hl7.org/fhir/ValueSet/iso3166-1-3').executeTakeFirstOrThrow();
    // Byte-identical to what was seeded: same id (no row swapped in under it), same status, and the
    // compose is still filter-shaped rather than rewritten to our enumerated concepts.
    expect(hl7.id).toBe('vs-hl7-iso3166-1-3');
    expect(hl7.status).toBe('active');
    expect(parseJson(hl7.compose)).toEqual(hl7Compose);
    await db.destroy();
  });

  it("the expansion actually returns rows through the real runtime expander (not just the cache table)", async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyAdminStore(db as never);
    const vs = await db.selectFrom('value_sets').select(['id'])
      .where('url', '=', 'urn:openldr:valueset:country').executeTakeFirstOrThrow();
    const { codes, total } = await store.valueSets.expand(vs.id);
    expect(total).toBe(249);
    expect(codes).toHaveLength(249);
    expect(codes.every((c) => c.system === 'urn:iso:std:iso:3166')).toBe(true);
    await db.destroy();
  });

  it('registers the ValueSet in terminology_systems so the picker resolves it by URL', async () => {
    const db = await makeMigratedDb();
    const row = await db.selectFrom('terminology_systems').select(['url', 'kind'])
      .where('url', '=', 'urn:openldr:valueset:country').executeTakeFirstOrThrow();
    expect(row.kind).toBe('ValueSet');
    await db.destroy();
  });
});

describe('073_facility_country_and_admin_fields — coding_systems ownership (existing foreign-id row)', () => {
  it('flips a PRE-EXISTING inactive urn:iso:std:iso:3166 row to active without inserting a duplicate, and down() leaves it alone', async () => {
    // A real install could plausibly have imported ISO 3166 separately (a future terminology
    // import, say), landing a coding_systems row for this url at some foreign id before this
    // migration ever ran — same possibility 072 accounts for with STATUS_SYSTEM, and the same
    // scenario that migration's own test pins for its own url. Nothing in makeMigratedDb() creates
    // such a row on its own (only the fallback-insert branch runs there), so simulate it directly.
    const db = await makeMigratedDb(); // 073 already ran once via makeMigratedDb(), inserting its own fallback row
    await db.deleteFrom('coding_systems').where('url', '=', 'urn:iso:std:iso:3166').execute();
    await db.insertInto('coding_systems' as never).values({
      id: 'cs-live-random-uuid-iso3166', system_code: 'ISO-3166', system_name: 'ISO 3166-1 (imported)',
      url: 'urn:iso:std:iso:3166', system_version: null, description: null,
      active: false, publisher_id: 'pub-hl7-fhir', seeded: true,
    } as never).execute();

    await up(db);

    const afterUp = await db.selectFrom('coding_systems').select(['id', 'active'])
      .where('url', '=', 'urn:iso:std:iso:3166').execute();
    expect(afterUp).toHaveLength(1);
    expect(afterUp[0]!.id).toBe('cs-live-random-uuid-iso3166'); // the pre-existing row, not a new one
    expect(afterUp[0]!.active).toBe(true);

    await down(db);

    // down() only ever deletes ITS OWN fallback id (COUNTRY_CS_FALLBACK_ID); since the "existing"
    // branch ran above, that fallback row was never (re-)inserted, so down() has nothing of its own
    // to remove here and the site's foreign-id row survives untouched.
    const afterDown = await db.selectFrom('coding_systems').select(['id', 'active'])
      .where('url', '=', 'urn:iso:std:iso:3166').execute();
    expect(afterDown).toHaveLength(1);
    expect(afterDown[0]!.id).toBe('cs-live-random-uuid-iso3166');
    expect(afterDown[0]!.active).toBe(true);
    await db.destroy();
  });
});

describe('073_facility_country_and_admin_fields — idempotency', () => {
  it('running up() twice is a no-op: no duplicate rows, no throw', async () => {
    const db = await makeMigratedDb();
    await expect(up(db)).resolves.not.toThrow();

    const exp = await db.selectFrom('valueset_expansions').selectAll()
      .where('value_set_id', '=', 'vs-country').execute();
    expect(exp).toHaveLength(249);

    const codingSystems = await db.selectFrom('coding_systems').select(['id'])
      .where('url', '=', 'urn:iso:std:iso:3166').execute();
    expect(codingSystems).toHaveLength(1);
    await db.destroy();
  });
});

describe('073_facility_country_and_admin_fields — change_log projection reachability', () => {
  it('writes a fhir.change_log row for the seeded Country ValueSet', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('fhir.change_log').select(['resource_type', 'resource_id', 'version', 'op', 'content_hash', 'site_id'])
      .where('resource_type', '=', 'ValueSet')
      .where('resource_id', '=', 'vs-country')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.op).toBe('upsert');
    expect(rows[0]!.version).toBe(1);
    expect(typeof rows[0]!.content_hash).toBe('string');
    expect((rows[0]!.content_hash as string).length).toBe(64);
    await db.destroy();
  });

  it('running up() twice does not duplicate the change_log row', async () => {
    const db = await makeMigratedDb();
    await up(db);
    const rows = await db.selectFrom('fhir.change_log').select(['seq'])
      .where('resource_type', '=', 'ValueSet').where('resource_id', '=', 'vs-country').execute();
    expect(rows).toHaveLength(1);
    await db.destroy();
  });
});

describe('073_facility_country_and_admin_fields — fhir.resource_history (version-reuse fix)', () => {
  it('writes a fhir.resource_history row at version 1, op upsert', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('fhir.resource_history').select(['resource_type', 'id', 'version', 'op', 'resource'])
      .where('resource_type', '=', 'ValueSet').where('id', '=', 'vs-country').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(1);
    expect(rows[0]!.op).toBe('upsert');
    expect(rows[0]!.resource).toBeTruthy();
    await db.destroy();
  });

  it('a fhirStore.save()-style version derivation yields 2, not 1', async () => {
    const db = await makeMigratedDb();
    const hi = await db.selectFrom('fhir.resource_history')
      .select(sql<number>`coalesce(max(version), 0)`.as('maxv'))
      .where('resource_type', '=', 'ValueSet').where('id', '=', 'vs-country').executeTakeFirst();
    expect(Number(hi?.maxv ?? 0) + 1).toBe(2);
    await db.destroy();
  });

  it('running up() twice does not duplicate the resource_history row', async () => {
    const db = await makeMigratedDb();
    await up(db);
    const rows = await db.selectFrom('fhir.resource_history').select(['id'])
      .where('resource_type', '=', 'ValueSet').where('id', '=', 'vs-country').execute();
    expect(rows).toHaveLength(1);
    await db.destroy();
  });
});

const seededForm = (fields: readonly unknown[], over: Record<string, unknown> = {}) => ({
  id: 'form-sample-facility', name: 'Facility', version_label: 'v1',
  fhir_resource_type: 'Location', fhir_version: 'R4', status: 'published', active: true,
  schema: JSON.stringify({ id: 'sample-facility', fields, targetPages: ['facilities'] }),
  target_pages: JSON.stringify(['facilities']),
  ...over,
});

const getRow = async (db: any, id: string) =>
  db.selectFrom('form_definitions').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

describe('073_facility_country_and_admin_fields — form repoint up()', () => {
  it("repoints a Facility form matching 072's BOUND_FIELDS_SNAPSHOT to the new country/admin-chain fields", async () => {
    const db = await makeMigratedDb(); // 073 already ran once via makeMigratedDb() against no matching row
    await db.insertInto('form_definitions' as never).values(seededForm(PREV_BOUND_FIELDS_SNAPSHOT) as never).execute();
    await up(db);

    const row: any = await getRow(db, 'form-sample-facility');
    const schema: any = parseJson(row.schema);
    expect(schema.fields).toEqual(BOUND_FIELDS_SNAPSHOT);

    const country = schema.fields.find((f: any) => f.id === 'fld-fac-country');
    expect(country.fieldType).toBe('reference');
    expect(country.valueSetUrl).toBe('urn:openldr:valueset:country');

    for (const id of ['fld-fac-zone', 'fld-fac-region', 'fld-fac-district', 'fld-fac-council']) {
      const f = schema.fields.find((x: any) => x.id === id);
      expect(f.fieldType, id).toBe('suggest');
    }
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

  it('leaves a form ALREADY carrying the new bound fields alone', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm(BOUND_FIELDS_SNAPSHOT) as never).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(BOUND_FIELDS_SNAPSHOT);
    await db.destroy();
  });

  it('leaves a form that never reached 072\'s shape alone (e.g. still on 071\'s NEW_FIELDS)', async () => {
    const db = await makeMigratedDb();
    // A minimal, unrelated fields array — never matches 072's snapshot, so up() must not guess.
    const unrelated = [{ id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null, fieldType: 'text', required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' }, apiProperty: 'name' }];
    await db.insertInto('form_definitions' as never).values(seededForm(unrelated) as never).execute();
    await up(db);
    const row: any = await getRow(db, 'form-sample-facility');
    expect((parseJson(row.schema) as any).fields).toEqual(unrelated);
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

describe('073_facility_country_and_admin_fields — form repoint down()', () => {
  it("reverses exactly what up() did — round-trips a migrated row back to 072's BOUND_FIELDS_SNAPSHOT", async () => {
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

  it('does NOT touch a row an operator has already re-saved through the builder since up() ran (marker stripped)', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(seededForm(PREV_BOUND_FIELDS_SNAPSHOT) as never).execute();
    await up(db);
    const migrated: any = await getRow(db, 'form-sample-facility');
    const schemaWithoutMarker = { ...(parseJson(migrated.schema) as object) };
    delete (schemaWithoutMarker as any).__migration073;
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

describe('073_facility_country_and_admin_fields — down() concept ownership', () => {
  it('does NOT delete ANY urn:iso:std:iso:3166 concept — unprovable ownership of a real ISO/FHIR system', async () => {
    const db = await makeMigratedDb(); // 073 already ran once via makeMigratedDb()

    // Simulate a concept that predates up() entirely, or was added by a later real ISO 3166 import.
    await db.insertInto('terminology_concepts' as never).values({
      system: 'urn:iso:std:iso:3166', code: 'XKX', display: 'Kosovo (pre-existing/imported)',
      status: 'ACTIVE', properties: null,
    } as never).execute();

    await down(db);

    const remaining = await db.selectFrom('terminology_concepts').select(['code'])
      .where('system', '=', 'urn:iso:std:iso:3166').execute();
    // All 249 of up()'s own concepts survive, plus the pre-existing one — down() never deletes
    // anything under this system.
    expect(remaining.length).toBe(250);
    expect(remaining.some((r: any) => r.code === 'XKX')).toBe(true);
    expect(remaining.some((r: any) => r.code === 'TZA')).toBe(true);
    await db.destroy();
  });
});
