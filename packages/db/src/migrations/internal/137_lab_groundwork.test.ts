import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_SECTION_SYSTEM, LAB_SECTION_VALUE_SET, ORDER_RETURN_SYSTEM, ORDER_RETURN_VALUE_SET,
  SAMPLE_CONDITION_SYSTEM, SAMPLE_CONDITION_VALUE_SET, up, down,
} from './137_lab_groundwork';

const VALUE_SETS = [LAB_SECTION_VALUE_SET, ORDER_RETURN_VALUE_SET, SAMPLE_CONDITION_VALUE_SET];
const SYSTEMS = [LAB_SECTION_SYSTEM, ORDER_RETURN_SYSTEM, SAMPLE_CONDITION_SYSTEM];

async function concepts(db: any, system: string): Promise<Array<{ code: string; display: string }>> {
  return db.selectFrom('terminology_concepts').select(['code', 'display'])
    .where('system', '=', system).orderBy('code').execute();
}

async function seedTestRow(db: any): Promise<void> {
  await db.insertInto('test_catalog_lab_settings').values({ code: 'HIVVL', enabled: true }).execute();
}

describe('137 lab groundwork', () => {
  it('gives each lab settings row a section, none by default, and needs_review, true by default', async () => {
    const db = await makeMigratedDb();
    await seedTestRow(db);
    expect(await db.selectFrom('test_catalog_lab_settings').select(['section', 'needs_review']).executeTakeFirstOrThrow())
      .toEqual({ section: null, needs_review: true });
  });

  it('seeds the three lists, each a code system and a ValueSet that includes it', async () => {
    const db = await makeMigratedDb();
    for (const url of SYSTEMS) {
      expect(await db.selectFrom('coding_systems').select('url').where('url', '=', url).execute()).toEqual([{ url }]);
    }
    expect(await concepts(db, LAB_SECTION_SYSTEM)).toEqual([]);
    expect(await concepts(db, ORDER_RETURN_SYSTEM)).toEqual([
      { code: 'clerical-mistake', display: 'Clerical mistake' },
      { code: 'form-incomplete', display: 'Form incomplete' },
      { code: 'form-unreadable', display: 'Form not readable' },
      { code: 'wrong-patient-details', display: 'Wrong patient details' },
    ]);
    expect(await concepts(db, SAMPLE_CONDITION_SYSTEM)).toEqual([
      { code: 'AUT', display: 'Autolyzed' },
      { code: 'CFU', display: 'Centrifuged' },
      { code: 'CLOT', display: 'Clotted' },
      { code: 'CON', display: 'Contaminated' },
      { code: 'COOL', display: 'Cool' },
      { code: 'FROZ', display: 'Frozen' },
      { code: 'HEM', display: 'Hemolyzed' },
      { code: 'LIVE', display: 'Live' },
      { code: 'ROOM', display: 'Room temperature' },
      { code: 'SNR', display: 'Sample not received' },
    ]);
  });

  it('registers each ValueSet as a FHIR record with its include, and with no fhir.change_log row', async () => {
    const db = await makeMigratedDb();
    for (const [i, url] of VALUE_SETS.entries()) {
      const vs = await db.selectFrom('value_sets').select(['id', 'immutable']).where('url', '=', url).executeTakeFirstOrThrow();
      expect(vs.immutable).toBe(false);
      expect(await db.selectFrom('terminology_systems').select(['kind', 'resource_id']).where('url', '=', url).executeTakeFirstOrThrow())
        .toEqual({ kind: 'ValueSet', resource_id: vs.id });
      const row = await db.selectFrom('fhir.fhir_resources').select('resource')
        .where('resource_type', '=', 'ValueSet').where('id', '=', vs.id).executeTakeFirstOrThrow();
      const resource = typeof row.resource === 'string' ? JSON.parse(row.resource) : row.resource;
      expect(resource).toMatchObject({ resourceType: 'ValueSet', url, compose: { include: [{ system: SYSTEMS[i] }] } });
      expect(await db.selectFrom('fhir.change_log').select('seq').where('resource_type', '=', 'ValueSet').where('resource_id', '=', vs.id).execute())
        .toEqual([]);
    }
  });

  it('is safe to run twice', async () => {
    const db = await makeMigratedDb();
    await up(db);
    expect(await concepts(db, SAMPLE_CONDITION_SYSTEM)).toHaveLength(10);
    expect(await db.selectFrom('value_sets').select('id').where('url', 'in', VALUE_SETS).execute()).toHaveLength(3);
    expect(await db.selectFrom('fhir.resource_history').select('id').where('resource_type', '=', 'ValueSet')
      .where('id', 'in', ['vs-lab-section', 'vs-order-return-reason', 'vs-sample-condition']).execute()).toHaveLength(3);
  });

  it('down removes its columns and its rows, and leaves a lab-added concept and another coding system alone', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('terminology_concepts').values({
      system: ORDER_RETURN_SYSTEM, code: 'lab-own', display: 'A reason of our own', status: 'ACTIVE', properties: null,
    }).execute();
    await down(db);

    for (const url of VALUE_SETS) {
      expect(await db.selectFrom('value_sets').select('id').where('url', '=', url).execute()).toEqual([]);
      expect(await db.selectFrom('terminology_systems').select('url').where('url', '=', url).execute()).toEqual([]);
    }
    for (const url of SYSTEMS) {
      expect(await db.selectFrom('coding_systems').select('url').where('url', '=', url).execute()).toEqual([]);
    }
    expect(await db.selectFrom('fhir.fhir_resources').select('id').where('resource_type', '=', 'ValueSet')
      .where('id', 'in', ['vs-lab-section', 'vs-order-return-reason', 'vs-sample-condition']).execute()).toEqual([]);
    expect(await concepts(db, SAMPLE_CONDITION_SYSTEM)).toEqual([]);
    expect(await concepts(db, ORDER_RETURN_SYSTEM)).toEqual([{ code: 'lab-own', display: 'A reason of our own' }]);
    // 106's lists are another migration's rows.
    expect(await db.selectFrom('value_sets').select('id').where('url', '=', 'urn:openldr:valueset:order-reject-reason').execute())
      .toHaveLength(1);

    await seedTestRow(db);
    const row = await db.selectFrom('test_catalog_lab_settings').selectAll().executeTakeFirstOrThrow();
    expect(Object.keys(row)).not.toContain('section');
    expect(Object.keys(row)).not.toContain('needs_review');
  });

  it('down leaves a coding system it skipped, one already there under the same url with another id', async () => {
    const db = await makeMigratedDb();
    await down(db);
    await db.insertInto('coding_systems').values({
      id: 'cs-V2-0493-pub-hl7-fhir', system_code: 'V2-0493', system_name: 'Already here', url: SAMPLE_CONDITION_SYSTEM,
      active: true, publisher_id: 'pub-hl7-fhir', seeded: true,
    }).execute();
    await up(db);
    expect(await db.selectFrom('coding_systems').select('id').where('url', '=', SAMPLE_CONDITION_SYSTEM).execute())
      .toEqual([{ id: 'cs-V2-0493-pub-hl7-fhir' }]);
    await down(db);
    expect(await db.selectFrom('coding_systems').select('id').where('url', '=', SAMPLE_CONDITION_SYSTEM).execute())
      .toEqual([{ id: 'cs-V2-0493-pub-hl7-fhir' }]);
  });

  it("down leaves the concepts of a coding system it skipped, since up() did not create that system", async () => {
    const db = await makeMigratedDb();
    await down(db);
    await db.insertInto('coding_systems').values({
      id: 'cs-V2-0493-pub-hl7-fhir', system_code: 'V2-0493', system_name: 'Already here', url: SAMPLE_CONDITION_SYSTEM,
      active: true, publisher_id: 'pub-hl7-fhir', seeded: true,
    }).execute();
    await db.insertInto('terminology_concepts').values([
      { system: SAMPLE_CONDITION_SYSTEM, code: 'HEM', display: 'Haemolysed (ours)', status: 'ACTIVE', properties: null },
      { system: SAMPLE_CONDITION_SYSTEM, code: 'OWN', display: 'A condition of our own', status: 'ACTIVE', properties: null },
    ]).execute();
    await up(db);
    await down(db);
    const left = await concepts(db, SAMPLE_CONDITION_SYSTEM);
    expect(left).toContainEqual({ code: 'HEM', display: 'Haemolysed (ours)' });
    expect(left).toContainEqual({ code: 'OWN', display: 'A condition of our own' });
    // The nine codes up() added to that system stay too: once up() did not create the system, down()
    // leaves every concept in it, as the ruling asks.
    expect(left).toHaveLength(11);
    // The systems up() did create still lose their seeded concepts.
    expect(await concepts(db, ORDER_RETURN_SYSTEM)).toEqual([]);
  });
});
