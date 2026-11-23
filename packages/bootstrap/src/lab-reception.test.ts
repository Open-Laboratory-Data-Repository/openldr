import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import {
  FACILITY_REGISTRY_SYSTEM, createFhirStore, createTerminologyStore, findByRequisition,
  indexRequisitions, type ExternalSchema, type FhirStore, type InternalSchema,
} from '@openldr/db';
import { createOperations } from '@openldr/terminology';
import { ORDER_ORIGIN_SYSTEM, ORDER_REQUISITION_SYSTEM, facilityReference, labOrderId, labSpecimenId, orderRequester } from '@openldr/forms';
import { createLabReception, orderSpecimenTypes, ReceptionError, type LabReception, type OrderChanges } from './lab-reception';
import { createTestCatalog, TEST_CATALOG_SYSTEM } from './test-catalog';
import { createPatientIndex } from './patient-index';
import { buildPatientIndexFixture, seedIdentifier, seedPatient } from './test-support/patient-index-fixture';

const silent = { info() {}, error() {}, warn() {}, debug() {}, trace() {}, fatal() {}, child() { return silent; } } as never;
const LOCAL = 'urn:openldr:cs:local';
const BLD = { system: LOCAL, code: 'BLD' };

interface World {
  db: Kysely<InternalSchema>; externalDb: Kysely<ExternalSchema>; fhirStore: FhirStore;
  catalog: ReturnType<typeof createTestCatalog>; reception: LabReception;
}

async function seedTest(db: Kysely<InternalSchema>, code: string, display: string, enabled = true): Promise<void> {
  await db.insertInto('terminology_concepts').values({
    system: TEST_CATALOG_SYSTEM, code, display, status: 'ACTIVE',
    properties: JSON.stringify({ specimenTypes: [BLD] }) as never,
  }).execute();
  await db.insertInto('test_catalog_lab_settings').values({ code, enabled } as never).execute();
}

async function world(opts: { now?: () => Date; labTimeZone?: () => Promise<string | undefined> } = {}): Promise<World> {
  delete process.env.OPENLDR_SITE_ID;
  // The patient index fixture: a migrated internal db and warehouse, with md5 for the masked list.
  const f = await buildPatientIndexFixture();
  const db = f.internalDb;
  const { externalDb, admin } = f;
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c),
    findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q),
    getResourceByUrl: (u) => store.getResourceByUrl(u),
    translate: (q) => store.translate(q),
  });
  const catalog = createTestCatalog({ db, admin, ops });
  await seedTest(db, 'HB', 'Haemoglobin');
  await seedTest(db, 'GLU', 'Glucose');
  await seedTest(db, 'OFF', 'Not offered', false);
  for (const [code, display] of [['FAC-1', 'Clinic One'], ['FAC-2', 'Clinic Two']]) {
    await db.insertInto('terminology_concepts').values({ system: FACILITY_REGISTRY_SYSTEM, code, display, status: 'ACTIVE', properties: null }).execute();
  }
  await fhirStore.saveMany([
    { resourceType: 'Patient', id: 'p1', name: [{ given: ['Asha'], family: 'Mrema' }] },
    { resourceType: 'Patient', id: 'p2', name: [{ given: ['Juma'], family: 'Said' }] },
  ] as never);
  const patientIndex = createPatientIndex({ externalDb, systems: f.systems, engine: 'postgres', refKey: randomBytes(32) });
  return {
    db, externalDb, fhirStore, catalog,
    reception: createLabReception({ db, externalDb, fhirStore, catalog, ops, patientIndex, logger: silent, ...opts }),
  };
}

const cat = (code: string, display: string) => ({ system: TEST_CATALOG_SYSTEM, code, display });

/** An order as the Lab order form saves it now: one request per test. */
function formOrder(facility: string, requisition: string, tests: Array<{ code: string; display: string }>) {
  const requester = orderRequester('Dr Kweka', facilityReference({ system: FACILITY_REGISTRY_SYSTEM, code: facility, display: 'Clinic One' }))!;
  const number = { system: ORDER_REQUISITION_SYSTEM, value: requisition };
  return tests.map((t) => ({
    resourceType: 'ServiceRequest', id: labOrderId(facility, requisition, { system: TEST_CATALOG_SYSTEM, code: t.code }),
    status: 'active', intent: 'order', priority: 'urgent',
    subject: { reference: 'Patient/p1', display: 'Asha Mrema' },
    identifier: [{ ...number }], requisition: { ...number },
    code: { coding: [cat(t.code, t.display)], text: t.display },
    contained: [requester.contained], requester: requester.requester,
  }));
}

async function save(w: World, resources: Record<string, unknown>[], sourceSystem: string): Promise<void> {
  await w.fhirStore.saveMany(resources as never, { sourceSystem });
  await indexRequisitions(w.db, resources);
}

async function provenancesFor(w: World, id: string): Promise<Array<Record<string, unknown>>> {
  const rows = await w.db.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Provenance').execute();
  return rows
    .map((r) => (typeof r.resource === 'string' ? JSON.parse(r.resource) : r.resource) as Record<string, unknown>)
    .filter((p) => (p['target'] as Array<{ reference: string }>).some((t) => t.reference.startsWith(`ServiceRequest/${id}`)));
}

describe('lab reception, orders', () => {
  let w: World;
  beforeEach(async () => { w = await world(); });

  it('finds an order the Lab order form saved, with its tests, patient and requester', async () => {
    await save(w, formOrder('FAC-1', 'R-100', [{ code: 'HB', display: 'Haemoglobin' }, { code: 'GLU', display: 'Glucose' }]), 'form-capture');
    const found = await w.reception.findOrders('  R-100 ');
    expect(found).toHaveLength(1);
    const o = found[0]!;
    expect(o).toMatchObject({
      requisition: 'R-100', facility: { code: 'FAC-1', display: 'Clinic One' }, origin: 'form',
      patient: { id: 'p1', display: 'Asha Mrema' }, priority: 'urgent', clinician: 'Dr Kweka', note: null,
    });
    expect(o.tests.map((t) => t.code).sort()).toEqual(['GLU', 'HB']);
    expect(o.tests.every((t) => t.status === 'active')).toBe(true);
  });

  it('finds an old multi-coding order with every test, each with that one request id', async () => {
    const old = {
      resourceType: 'ServiceRequest', id: 'old-1', status: 'active', intent: 'order',
      subject: { display: 'Unknown subject' }, identifier: [{ system: ORDER_REQUISITION_SYSTEM, value: 'R-OLD' }],
      code: { coding: [{ system: 'http://loinc.org', code: '718-7' }, cat('HB', 'Haemoglobin'), cat('GLU', 'Glucose')] },
    };
    await save(w, [old], 'form-capture');
    const [o] = await w.reception.findOrders('R-OLD');
    expect(o!.facility).toBeNull();
    expect(o!.patient).toBeNull();
    expect(o!.tests).toEqual([
      { serviceRequestId: 'old-1', system: TEST_CATALOG_SYSTEM, code: 'HB', display: 'Haemoglobin', status: 'active', rejection: null },
      { serviceRequestId: 'old-1', system: TEST_CATALOG_SYSTEM, code: 'GLU', display: 'Glucose', status: 'active', rejection: null },
    ]);
  });

  it('finds two facilities\' orders under one number, one order each', async () => {
    await save(w, formOrder('FAC-1', 'R-200', [{ code: 'HB', display: 'Haemoglobin' }]), 'form-capture');
    await save(w, formOrder('FAC-2', 'R-200', [{ code: 'GLU', display: 'Glucose' }]), 'cdr-source');
    const found = await w.reception.findOrders('R-200');
    expect(found.map((o) => [o.facility?.code, o.origin, o.tests.map((t) => t.code)])).toEqual([
      ['FAC-1', 'form', ['HB']],
      ['FAC-2', 'other', ['GLU']],
    ]);
  });

  it('reads a Specimen at its fixed id and runs no scan for any other', async () => {
    const [sr] = formOrder('FAC-1', 'R-300', [{ code: 'HB', display: 'Haemoglobin' }]);
    await save(w, [sr!], 'form-capture');
    const fixed = labSpecimenId('FAC-1', 'R-300', BLD);
    await w.fhirStore.saveMany([
      { resourceType: 'Specimen', id: fixed, status: 'available', request: [{ reference: `ServiceRequest/${sr!.id}` }], type: { coding: [{ ...BLD, display: 'Blood' }] }, condition: [{ coding: [{ system: LOCAL, code: 'HAEM', display: 'Haemolysed' }] }], receivedTime: '2026-11-22T08:00:00Z' },
      // The random-id Specimen of an order rejected through the old form path: not shown.
      { resourceType: 'Specimen', id: 'sp-random', status: 'unsatisfactory', request: [{ reference: `ServiceRequest/${sr!.id}` }] },
    ] as never);
    const read: string[] = [];
    const get = w.fhirStore.get.bind(w.fhirStore);
    w.fhirStore.get = async (type, id) => { read.push(`${type}/${id}`); return get(type, id); };
    const [o] = await w.reception.findOrders('R-300');
    expect(o!.specimens).toEqual([
      { id: fixed, type: { ...BLD, display: 'Blood' }, condition: 'Haemolysed', receivedTime: '2026-11-22T08:00:00Z' },
    ]);
    expect(read.filter((r) => r.startsWith('Specimen/'))).toEqual([`Specimen/${fixed}`]);
  });

  it('lists an order\'s sample types once each, from the catalog tests only', async () => {
    const types = await orderSpecimenTypes(w.catalog, [
      { system: TEST_CATALOG_SYSTEM, code: 'HB' }, { system: TEST_CATALOG_SYSTEM, code: 'GLU' },
      { system: 'http://loinc.org', code: '718-7' }, { system: TEST_CATALOG_SYSTEM, code: 'NOPE' },
    ]);
    expect(types).toEqual([BLD]);
  });

  it('registers an order at the desk, one request per test, and finds it again', async () => {
    const o = await w.reception.registerOrder({
      requisition: ' R-400 ', facilityCode: 'FAC-1', patientId: 'p1',
      tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }, { system: TEST_CATALOG_SYSTEM, code: 'GLU' }],
      priority: 'stat', clinician: 'Dr Kweka', note: 'fasting',
    }, 'Neema');
    expect(o).toMatchObject({
      requisition: 'R-400', facility: { code: 'FAC-1', display: 'Clinic One' }, origin: 'lab-desk',
      patient: { id: 'p1', display: 'Asha Mrema' }, priority: 'stat', clinician: 'Dr Kweka', note: 'fasting',
    });
    const hbId = labOrderId('FAC-1', 'R-400', { system: TEST_CATALOG_SYSTEM, code: 'HB' });
    expect(o.tests.map((t) => t.serviceRequestId).sort()).toEqual(
      [hbId, labOrderId('FAC-1', 'R-400', { system: TEST_CATALOG_SYSTEM, code: 'GLU' })].sort());
    const sr = await w.fhirStore.get('ServiceRequest', hbId) as Record<string, unknown>;
    expect((sr['meta'] as { tag: unknown[] }).tag).toEqual([{ system: ORDER_ORIGIN_SYSTEM, code: 'lab-desk' }]);
    expect(sr['subject']).toEqual({ reference: 'Patient/p1', display: 'Asha Mrema' });
    expect(sr['requisition']).toEqual({ system: ORDER_REQUISITION_SYSTEM, value: 'R-400' });
    expect(sr['requester']).toEqual({ reference: '#requester', type: 'PractitionerRole', display: 'Dr Kweka' });
    expect(await findByRequisition(w.db, 'R-400')).toHaveLength(2);
    const prov = await provenancesFor(w, hbId);
    expect(prov[0]!['agent']).toEqual([{ who: { display: 'Neema' } }]);
    expect(await w.reception.findOrders('R-400')).toEqual([o]);
  });

  it('refuses a retried register with conflict and writes nothing more', async () => {
    const input = { requisition: 'R-500', facilityCode: 'FAC-1', patientId: 'p1', tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }] };
    await w.reception.registerOrder(input, 'Neema');
    const before = await w.db.selectFrom('fhir.resource_history').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    await expect(w.reception.registerOrder(input, 'Neema')).rejects.toMatchObject({ reason: 'conflict' });
    // A different test under the same number and facility is the same order, so it is refused too.
    await expect(w.reception.registerOrder({ ...input, tests: [{ system: TEST_CATALOG_SYSTEM, code: 'GLU' }] }, 'Neema'))
      .rejects.toMatchObject({ reason: 'conflict' });
    const after = await w.db.selectFrom('fhir.resource_history').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    expect(Number(after.n)).toBe(Number(before.n));
  });

  it('refuses a number a form order already holds for that facility, even before it is indexed', async () => {
    await w.fhirStore.saveMany(formOrder('FAC-1', 'R-510', [{ code: 'HB', display: 'Haemoglobin' }]) as never, { sourceSystem: 'form-capture' });
    await expect(w.reception.registerOrder({
      requisition: 'R-510', facilityCode: 'FAC-1', patientId: 'p1', tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }],
    }, 'Neema')).rejects.toMatchObject({ reason: 'conflict' });
  });

  it('refuses an unknown test, a test the lab does not offer, an unknown facility and an unknown patient', async () => {
    const base = { requisition: 'R-600', facilityCode: 'FAC-1', patientId: 'p1', tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }] };
    for (const bad of [
      { ...base, tests: [{ system: TEST_CATALOG_SYSTEM, code: 'NOPE' }] },
      { ...base, tests: [{ system: TEST_CATALOG_SYSTEM, code: 'OFF' }] },
      { ...base, tests: [{ system: 'http://loinc.org', code: '718-7' }] },
      { ...base, tests: [] },
      { ...base, facilityCode: 'FAC-9' },
      { ...base, patientId: 'p-none' },
      { ...base, requisition: '   ' },
      { ...base, priority: 'whenever' },
    ]) {
      const err = await w.reception.registerOrder(bad, 'Neema').catch((e: unknown) => e);
      expect(err, JSON.stringify(bad)).toBeInstanceOf(ReceptionError);
      expect((err as ReceptionError).reason).toBe('invalid');
    }
    expect(await findByRequisition(w.db, 'R-600')).toEqual([]);
    expect(await w.fhirStore.exists('ServiceRequest', labOrderId('FAC-1', 'R-600', { system: TEST_CATALOG_SYSTEM, code: 'HB' }))).toBe(false);
  });

  it('corrects the priority and links a patient on every request, each with a Provenance carrying the reason', async () => {
    const old = {
      resourceType: 'ServiceRequest', id: 'old-2', status: 'active', intent: 'order',
      subject: { display: 'Unknown subject' }, identifier: [{ value: 'R-700' }], code: { coding: [cat('HB', 'Haemoglobin')] },
    };
    const desk = await w.reception.registerOrder({
      requisition: 'R-700', facilityCode: 'FAC-1', patientId: 'p1',
      tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }, { system: TEST_CATALOG_SYSTEM, code: 'GLU' }], priority: 'routine',
    }, 'Neema');
    await save(w, [old], 'form-capture');
    const o = await w.reception.correctOrder({
      requisition: 'R-700', facilityCode: 'FAC-1', changes: { priority: 'urgent', patientId: 'p2', clinician: 'Dr Lema' }, reason: 'typed the wrong patient',
    }, 'Neema');
    expect(o).toMatchObject({ priority: 'urgent', patient: { id: 'p2', display: 'Juma Said' }, clinician: 'Dr Lema', facility: { code: 'FAC-1', display: 'Clinic One' }, origin: 'lab-desk' });
    for (const t of desk.tests) {
      const sr = await w.fhirStore.get('ServiceRequest', t.serviceRequestId) as Record<string, unknown>;
      expect(sr['priority']).toBe('urgent');
      expect(sr['subject']).toEqual({ reference: 'Patient/p2', display: 'Juma Said' });
      expect((sr['meta'] as { tag: unknown[] }).tag).toEqual([{ system: ORDER_ORIGIN_SYSTEM, code: 'lab-desk' }]);
      const reasons = (await provenancesFor(w, t.serviceRequestId)).flatMap((p) => (p['reason'] as Array<{ text: string }> | undefined) ?? []);
      expect(reasons).toEqual([{ text: 'typed the wrong patient' }]);
    }
    // The order with no facility under the same number is left alone.
    expect((await w.fhirStore.get('ServiceRequest', 'old-2') as Record<string, unknown>)['priority']).toBeUndefined();
    // A null clears a field.
    const cleared = await w.reception.correctOrder({ requisition: 'R-700', facilityCode: 'FAC-1', changes: { priority: null }, reason: 'no priority given' }, 'Neema');
    expect(cleared.priority).toBeNull();
  });

  it('refuses a correction of the requisition number, the facility or the tests', async () => {
    await w.reception.registerOrder({ requisition: 'R-800', facilityCode: 'FAC-1', patientId: 'p1', tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }] }, 'Neema');
    // @ts-expect-error the requisition number is not a correctable field
    const typed: OrderChanges = { requisition: 'R-801' };
    void typed;
    for (const changes of [{ requisition: 'R-801' }, { facilityCode: 'FAC-2' }, { tests: [] }, {}]) {
      const err = await w.reception.correctOrder({ requisition: 'R-800', facilityCode: 'FAC-1', changes: changes as never, reason: 'x' }, 'Neema').catch((e: unknown) => e);
      expect((err as ReceptionError).reason).toBe('invalid');
    }
    await expect(w.reception.correctOrder({ requisition: 'R-800', facilityCode: 'FAC-1', changes: { priority: 'stat' }, reason: '  ' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    await expect(w.reception.correctOrder({ requisition: 'R-999', facilityCode: 'FAC-1', changes: { priority: 'stat' }, reason: 'x' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'not-found' });
    const [o] = await w.reception.findOrders('R-800');
    expect(o!.priority).toBeNull();
  });
});

describe('lab reception, correcting an old order', () => {
  let w: World;
  beforeEach(async () => { w = await world(); });

  it('links a patient on an old multi-coding order that names no facility', async () => {
    const old = {
      resourceType: 'ServiceRequest', id: 'old-3', status: 'active', intent: 'order',
      subject: { display: 'Unknown subject' }, identifier: [{ system: ORDER_REQUISITION_SYSTEM, value: 'R-OLD3' }],
      code: { coding: [{ system: 'http://loinc.org', code: '718-7' }, cat('HB', 'Haemoglobin'), cat('GLU', 'Glucose')] },
    };
    await save(w, [old], 'form-capture');
    const o = await w.reception.correctOrder({
      requisition: 'R-OLD3', facilityCode: null, changes: { patientId: 'p1' }, reason: 'patient was not linked',
    }, 'Neema');
    expect(o.facility).toBeNull();
    expect(o.patient).toEqual({ id: 'p1', display: 'Asha Mrema' });
    expect(o.tests.map((t) => t.code)).toEqual(['HB', 'GLU']);
    const sr = await w.fhirStore.get('ServiceRequest', 'old-3') as Record<string, unknown>;
    expect(sr['subject']).toEqual({ reference: 'Patient/p1', display: 'Asha Mrema' });
    expect((sr['code'] as { coding: unknown[] }).coding).toHaveLength(3);
  });

  it('changes the clinician on a requester role whose contained id is not "requester"', async () => {
    const [sr] = formOrder('FAC-1', 'R-ROLE', [{ code: 'HB', display: 'Haemoglobin' }]);
    const role = { ...(sr!.contained[0] as unknown as Record<string, unknown>), id: 'role-7' };
    const renamed = { ...sr!, contained: [role], requester: { ...(sr!.requester as Record<string, unknown>), reference: '#role-7' } };
    await save(w, [renamed], 'form-capture');
    const o = await w.reception.correctOrder({
      requisition: 'R-ROLE', facilityCode: 'FAC-1', changes: { clinician: 'Dr Lema' }, reason: 'wrong clinician',
    }, 'Neema');
    expect(o.clinician).toBe('Dr Lema');
    // The facility the role named stays, and the old role is replaced, not kept beside the new one.
    expect(o.facility).toEqual({ code: 'FAC-1', display: 'Clinic One' });
    const after = await w.fhirStore.get('ServiceRequest', sr!.id) as Record<string, unknown>;
    expect((after['contained'] as unknown[])).toHaveLength(1);
  });
});

describe('lab reception, patients', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await seedPatient(w.externalDb, { id: 'wp1', surname: 'Mrema', firstname: 'Asha', dob: '1990-04-02', sex: 'F', guid: 'G-1' });
    await seedPatient(w.externalDb, { id: 'wp2', surname: 'Mrema', firstname: 'Baraka', dob: '1990-04-02', sex: 'M' });
    await seedPatient(w.externalDb, { id: 'wp3', surname: 'Mrema', firstname: 'Asha', dob: '1990-04-02', active: false });
    await seedIdentifier(w.externalDb, 'wp1', 'urn:test:mrn', 'MRN-77');
  });

  it('finds a patient by an exact identifier, unmasked', async () => {
    const found = await w.reception.searchPatients({ identifier: ' MRN-77 ' });
    expect(found).toEqual([{ id: 'wp1', name: 'Asha Mrema', birthDate: '1990-04-02', gender: 'female', identifiers: [] }]);
    expect(await w.reception.searchPatients({ identifier: 'MRN-7' })).toEqual([]);
  });

  it('finds a patient by a full name and the full birth date, in either name order', async () => {
    for (const name of ['Asha Mrema', 'mrema  ASHA']) {
      const found = await w.reception.searchPatients({ name, birthDate: '1990-04-02' });
      expect(found.map((p) => p.id), name).toEqual(['wp1']);
    }
  });

  it('shows nothing for a partial name, a name without a birth date, or a birth date alone', async () => {
    for (const q of [
      { name: 'Asha', birthDate: '1990-04-02' },
      { name: 'Mrema', birthDate: '1990-04-02' },
      { name: 'Ash Mrema', birthDate: '1990-04-02' },
      { name: 'Asha Mrema' },
      { name: 'Asha Mrema', birthDate: '1990' },
      { name: 'Asha Mrema', birthDate: '1990-04' },
      { birthDate: '1990-04-02' },
      { name: '', birthDate: '1990-04-02' },
      {},
    ]) {
      expect(await w.reception.searchPatients(q), JSON.stringify(q)).toEqual([]);
    }
  });

  it('registers a patient from a birth date, with a Provenance naming who', async () => {
    const p = await w.reception.registerPatient({
      given: ' Neema ', family: 'Lyimo', gender: 'female', birthDate: '2001-07-15',
      identifier: { system: 'urn:test:mrn', value: 'MRN-90' },
    }, 'Neema');
    expect(p.display).toBe('Neema Lyimo');
    const saved = await w.fhirStore.get('Patient', p.id) as Record<string, unknown>;
    expect(saved).toMatchObject({
      name: [{ given: ['Neema'], family: 'Lyimo' }], gender: 'female', birthDate: '2001-07-15',
      identifier: [{ system: 'urn:test:mrn', value: 'MRN-90' }],
    });
    expect(saved['extension']).toBeUndefined();
    const rows = await w.db.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Provenance').execute();
    const prov = rows.map((r) => (typeof r.resource === 'string' ? JSON.parse(r.resource) : r.resource) as Record<string, unknown>)
      .find((x) => (x['target'] as Array<{ reference: string }>).some((t) => t.reference === `Patient/${p.id}`));
    expect(prov).toMatchObject({ agent: [{ who: { display: 'Neema' } }], activity: { coding: [{ code: 'CREATE' }] } });
  });

  it('registers a patient from an age, with an estimated birth date and the extension', async () => {
    const p = await w.reception.registerPatient({ given: 'Juma', family: 'Said', gender: 'male', ageYears: 30 }, 'Neema');
    const saved = await w.fhirStore.get('Patient', p.id) as Record<string, unknown>;
    expect(saved['birthDate']).toBe(`${new Date().getUTCFullYear() - 30}-01-01`);
    expect(saved['extension']).toEqual([{ url: 'urn:openldr:ext:birthdate-estimated', valueBoolean: true }]);
    const baby = await w.reception.registerPatient({ given: 'Baby', family: 'Said', gender: 'unknown', ageYears: 0 }, 'Neema');
    expect((await w.fhirStore.get('Patient', baby.id) as Record<string, unknown>)['birthDate']).toBe(`${new Date().getUTCFullYear()}-01-01`);
  });

  it('refuses a bad gender, no birth date or age, an age out of range, a missing name and no actor', async () => {
    const base = { given: 'Juma', family: 'Said', gender: 'male' as const, ageYears: 30 };
    const before = await w.db.selectFrom('fhir.resource_history').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    for (const [bad, who] of [
      [{ ...base, gender: 'M' as never }, 'Neema'],
      [{ ...base, gender: undefined as never }, 'Neema'],
      [{ ...base, ageYears: undefined }, 'Neema'],
      [{ ...base, ageYears: 131 }, 'Neema'],
      [{ ...base, ageYears: -1 }, 'Neema'],
      [{ ...base, ageYears: 2.5 }, 'Neema'],
      [{ ...base, ageYears: undefined, birthDate: '1990' }, 'Neema'],
      [{ ...base, ageYears: undefined, birthDate: '2999-01-01' }, 'Neema'],
      [{ ...base, given: '  ' }, 'Neema'],
      [{ ...base, family: '' }, 'Neema'],
      [{ ...base, identifier: { system: 'urn:test:mrn', value: ' ' } }, 'Neema'],
      [base, ' '],
    ] as const) {
      const err = await w.reception.registerPatient(bad, who).catch((e: unknown) => e);
      expect(err, JSON.stringify(bad)).toBeInstanceOf(ReceptionError);
      expect((err as ReceptionError).reason).toBe('invalid');
    }
    const after = await w.db.selectFrom('fhir.resource_history').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    expect(Number(after.n)).toBe(Number(before.n));
  });
});

describe('lab reception, samples', () => {
  let w: World;
  beforeEach(async () => { w = await world(); });

  async function specimenProvenances(id: string): Promise<Array<Record<string, unknown>>> {
    const rows = await w.db.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Provenance').execute();
    return rows
      .map((r) => (typeof r.resource === 'string' ? JSON.parse(r.resource) : r.resource) as Record<string, unknown>)
      .filter((p) => (p['target'] as Array<{ reference: string }>).some((t) => t.reference.startsWith(`Specimen/${id}/`)))
      .sort((a, b) => String((a['target'] as Array<{ reference: string }>)[0]!.reference).localeCompare(String((b['target'] as Array<{ reference: string }>)[0]!.reference)));
  }

  it('offers the sample types the order\'s tests take', async () => {
    await w.reception.registerOrder({
      requisition: 'R-S1', facilityCode: 'FAC-1', patientId: 'p1',
      tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }, { system: TEST_CATALOG_SYSTEM, code: 'GLU' }],
    }, 'Neema');
    // The display is the terminology's (migration 014 seeds BLD as Blood).
    expect(await w.reception.sampleChoices(' R-S1 ', 'FAC-1')).toEqual({ types: [{ ...BLD, display: 'Blood' }] });
    await expect(w.reception.sampleChoices('R-NONE', 'FAC-1')).rejects.toMatchObject({ reason: 'not-found' });
  });

  it('receives a sample: writes the Specimen at its fixed id and a Provenance, then updates it on a second receive', async () => {
    const order = await w.reception.registerOrder({
      requisition: 'R-S2', facilityCode: 'FAC-1', patientId: 'p1',
      tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }, { system: TEST_CATALOG_SYSTEM, code: 'GLU' }],
    }, 'Neema');
    const id = labSpecimenId('FAC-1', 'R-S2', BLD);
    const o = await w.reception.receiveSample({
      requisition: ' R-S2 ', facilityCode: 'FAC-1', type: { ...BLD, display: 'Blood' }, receivedTime: '2026-11-23T08:00:00Z',
    }, 'Neema');
    expect(o.specimens).toEqual([{ id, type: { ...BLD, display: 'Blood' }, condition: null, receivedTime: '2026-11-23T08:00:00Z' }]);
    const sp = await w.fhirStore.get('Specimen', id) as Record<string, unknown>;
    expect(sp).toMatchObject({
      status: 'available', subject: { reference: 'Patient/p1', display: 'Asha Mrema' },
      type: { coding: [{ ...BLD, display: 'Blood' }] },
    });
    expect((sp['meta'] as { versionId: string }).versionId).toBe('1');
    expect((sp['request'] as Array<{ reference: string }>).map((r) => r.reference).sort())
      .toEqual(order.tests.map((t) => `ServiceRequest/${t.serviceRequestId}`).sort());

    // A second receive of the same type updates it, with the condition this time.
    const again = await w.reception.receiveSample({
      requisition: 'R-S2', facilityCode: 'FAC-1', type: BLD,
      condition: { system: 'http://terminology.hl7.org/CodeSystem/v2-0493', code: 'CLOT' },
      serviceRequestIds: [order.tests[0]!.serviceRequestId],
    }, 'Baraka');
    expect(again.specimens).toHaveLength(1);
    expect(again.specimens[0]!.condition).toBe('Clotted');
    const sp2 = await w.fhirStore.get('Specimen', id) as Record<string, unknown>;
    expect((sp2['meta'] as { versionId: string }).versionId).toBe('2');
    expect(sp2['request']).toEqual([{ reference: `ServiceRequest/${order.tests[0]!.serviceRequestId}` }]);
    expect(sp2['condition']).toEqual([{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0493', code: 'CLOT', display: 'Clotted' }] }]);
    // The second receive gave no time, so the stored one stays (ruling 16).
    expect(sp2['receivedTime']).toBe('2026-11-23T08:00:00Z');

    const provs = await specimenProvenances(id);
    expect(provs.map((p) => [(p['target'] as Array<{ reference: string }>)[0]!.reference, (p['activity'] as { coding: Array<{ code: string }> }).coding[0]!.code, (p['agent'] as Array<{ who: { display: string } }>)[0]!.who.display]))
      .toEqual([[`Specimen/${id}/_history/1`, 'CREATE', 'Neema'], [`Specimen/${id}/_history/2`, 'UPDATE', 'Baraka']]);
  });

  it('refuses a condition outside the value set, a type the order does not take, and a request not on the order', async () => {
    const order = await w.reception.registerOrder({
      requisition: 'R-S3', facilityCode: 'FAC-1', patientId: 'p1', tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }],
    }, 'Neema');
    const base = { requisition: 'R-S3', facilityCode: 'FAC-1', type: BLD };
    for (const bad of [
      { ...base, condition: { system: 'http://terminology.hl7.org/CodeSystem/v2-0493', code: 'NOPE' } },
      { ...base, condition: { system: LOCAL, code: 'CLOT' } },
      { ...base, type: { system: LOCAL, code: 'URINE' } },
      { ...base, serviceRequestIds: ['someone-else'] },
      { ...base, serviceRequestIds: [] },
      { ...base, receivedTime: 'yesterday' },
    ]) {
      const err = await w.reception.receiveSample(bad, 'Neema').catch((e: unknown) => e);
      expect(err, JSON.stringify(bad)).toBeInstanceOf(ReceptionError);
      expect((err as ReceptionError).reason).toBe('invalid');
    }
    await expect(w.reception.receiveSample({ ...base, requisition: 'R-NONE' }, 'Neema')).rejects.toMatchObject({ reason: 'not-found' });
    expect(await w.fhirStore.exists('Specimen', labSpecimenId('FAC-1', 'R-S3', BLD))).toBe(false);
    void order;
  });

  it('receives a sample on an old multi-coding order and links its one request', async () => {
    const old = {
      resourceType: 'ServiceRequest', id: 'old-s', status: 'active', intent: 'order',
      subject: { reference: 'Patient/p2', display: 'Juma Said' }, identifier: [{ system: ORDER_REQUISITION_SYSTEM, value: 'R-OLDS' }],
      code: { coding: [{ system: 'http://loinc.org', code: '718-7' }, cat('HB', 'Haemoglobin'), cat('GLU', 'Glucose')] },
    };
    await save(w, [old], 'form-capture');
    const o = await w.reception.receiveSample({ requisition: 'R-OLDS', facilityCode: null, type: BLD }, 'Neema');
    const id = labSpecimenId(null, 'R-OLDS', BLD);
    expect(o.specimens.map((s) => s.id)).toEqual([id]);
    const sp = await w.fhirStore.get('Specimen', id) as Record<string, unknown>;
    expect(sp['request']).toEqual([{ reference: 'ServiceRequest/old-s' }]);
    expect(sp['subject']).toEqual({ reference: 'Patient/p2', display: 'Juma Said' });
  });
});

describe('lab reception, cancelling a desk order', () => {
  let w: World;
  beforeEach(async () => { w = await world(); });
  const HB = { system: TEST_CATALOG_SYSTEM, code: 'HB' };
  const GLU = { system: TEST_CATALOG_SYSTEM, code: 'GLU' };

  it('voids every request of a desk order with the reason, and keeps listing them with their status', async () => {
    const desk = await w.reception.registerOrder({ requisition: 'R-C1', facilityCode: 'FAC-1', patientId: 'p1', tests: [HB, GLU] }, 'Neema');
    const o = await w.reception.cancelOrder({ requisition: ' R-C1 ', facilityCode: 'FAC-1', reason: 'wrong test list' }, 'Neema');
    expect(o.tests.map((t) => t.status)).toEqual(['entered-in-error', 'entered-in-error']);
    for (const t of desk.tests) {
      const sr = await w.fhirStore.get('ServiceRequest', t.serviceRequestId) as Record<string, unknown>;
      expect(sr['status']).toBe('entered-in-error');
      const reasons = (await provenancesFor(w, t.serviceRequestId)).flatMap((p) => (p['reason'] as Array<{ text: string }> | undefined) ?? []);
      expect(reasons).toEqual([{ text: 'wrong test list' }]);
    }
    expect((await w.reception.findOrders('R-C1'))[0]!.tests.map((t) => t.status)).toEqual(['entered-in-error', 'entered-in-error']);
    await expect(w.reception.cancelOrder({ requisition: 'R-C1', facilityCode: 'FAC-1', reason: 'again' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
  });

  it('refuses a form order, an unknown order, and a cancellation with no reason', async () => {
    await save(w, formOrder('FAC-1', 'R-C2', [{ code: 'HB', display: 'Haemoglobin' }]), 'form-capture');
    const err = await w.reception.cancelOrder({ requisition: 'R-C2', facilityCode: 'FAC-1', reason: 'x' }, 'Neema').catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: 'invalid' });
    expect((err as Error).message).toMatch(/form entry/);
    await expect(w.reception.cancelOrder({ requisition: 'R-NONE', facilityCode: 'FAC-1', reason: 'x' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'not-found' });
    await w.reception.registerOrder({ requisition: 'R-C3', facilityCode: 'FAC-1', patientId: 'p1', tests: [HB] }, 'Neema');
    await expect(w.reception.cancelOrder({ requisition: 'R-C3', facilityCode: 'FAC-1', reason: '  ' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    expect((await w.reception.findOrders('R-C3'))[0]!.tests[0]!.status).toBe('active');
  });

  it('registers the number again after a cancel: one live order with the new tests, the old request stays voided', async () => {
    const first = await w.reception.registerOrder({ requisition: 'R-C4', facilityCode: 'FAC-1', patientId: 'p1', tests: [HB], priority: 'routine' }, 'Neema');
    await w.reception.cancelOrder({ requisition: 'R-C4', facilityCode: 'FAC-1', reason: 'wrong test' }, 'Neema');
    const again = await w.reception.registerOrder({ requisition: 'R-C4', facilityCode: 'FAC-1', patientId: 'p2', tests: [GLU], priority: 'stat' }, 'Neema');
    const live = again.tests.filter((t) => t.status === 'active');
    expect(live.map((t) => t.code)).toEqual(['GLU']);
    expect(again.tests.find((t) => t.code === 'HB')).toMatchObject({ serviceRequestId: first.tests[0]!.serviceRequestId, status: 'entered-in-error' });
    // The order's details come from the live request.
    expect(again).toMatchObject({ priority: 'stat', patient: { id: 'p2' } });
    // A third registration is refused: the new order holds the number.
    await expect(w.reception.registerOrder({ requisition: 'R-C4', facilityCode: 'FAC-1', patientId: 'p1', tests: [HB] }, 'Neema'))
      .rejects.toMatchObject({ reason: 'conflict' });
  });

  it('registers the same test again after a cancel, as a new version of its fixed id', async () => {
    const first = await w.reception.registerOrder({ requisition: 'R-C5', facilityCode: 'FAC-1', patientId: 'p1', tests: [HB] }, 'Neema');
    await w.reception.cancelOrder({ requisition: 'R-C5', facilityCode: 'FAC-1', reason: 'wrong patient' }, 'Neema');
    const again = await w.reception.registerOrder({ requisition: 'R-C5', facilityCode: 'FAC-1', patientId: 'p2', tests: [HB] }, 'Neema');
    expect(again.tests).toEqual([expect.objectContaining({ serviceRequestId: first.tests[0]!.serviceRequestId, status: 'active' })]);
    const sr = await w.fhirStore.get('ServiceRequest', first.tests[0]!.serviceRequestId) as Record<string, unknown>;
    expect((sr['meta'] as { versionId: string }).versionId).toBe('3');
    expect(sr['subject']).toEqual({ reference: 'Patient/p2', display: 'Juma Said' });
  });

  it('a correction skips voided requests, and refuses when none is left', async () => {
    await w.reception.registerOrder({ requisition: 'R-C6', facilityCode: 'FAC-1', patientId: 'p1', tests: [HB] }, 'Neema');
    await w.reception.cancelOrder({ requisition: 'R-C6', facilityCode: 'FAC-1', reason: 'wrong test' }, 'Neema');
    await expect(w.reception.correctOrder({ requisition: 'R-C6', facilityCode: 'FAC-1', changes: { priority: 'stat' }, reason: 'x' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    const again = await w.reception.registerOrder({ requisition: 'R-C6', facilityCode: 'FAC-1', patientId: 'p1', tests: [GLU] }, 'Neema');
    await w.reception.correctOrder({ requisition: 'R-C6', facilityCode: 'FAC-1', changes: { priority: 'stat' }, reason: 'urgent now' }, 'Neema');
    const voided = again.tests.find((t) => t.code === 'HB')!;
    const live = again.tests.find((t) => t.code === 'GLU')!;
    expect((await w.fhirStore.get('ServiceRequest', voided.serviceRequestId) as Record<string, unknown>)['priority']).toBeUndefined();
    expect((await w.fhirStore.get('ServiceRequest', live.serviceRequestId) as Record<string, unknown>)['priority']).toBe('stat');
  });

  it('refuses a sample for a cancelled order, a voided request, or a revoked one', async () => {
    await w.reception.registerOrder({ requisition: 'R-C7', facilityCode: 'FAC-1', patientId: 'p1', tests: [HB] }, 'Neema');
    await w.reception.cancelOrder({ requisition: 'R-C7', facilityCode: 'FAC-1', reason: 'wrong test' }, 'Neema');
    await expect(w.reception.receiveSample({ requisition: 'R-C7', facilityCode: 'FAC-1', type: BLD }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    const again = await w.reception.registerOrder({ requisition: 'R-C7', facilityCode: 'FAC-1', patientId: 'p1', tests: [GLU] }, 'Neema');
    const voided = again.tests.find((t) => t.code === 'HB')!;
    await expect(w.reception.receiveSample({ requisition: 'R-C7', facilityCode: 'FAC-1', type: BLD, serviceRequestIds: [voided.serviceRequestId] }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    // With no ids, the sample serves the live request only.
    await w.reception.receiveSample({ requisition: 'R-C7', facilityCode: 'FAC-1', type: BLD }, 'Neema');
    const sp = await w.fhirStore.get('Specimen', labSpecimenId('FAC-1', 'R-C7', BLD)) as Record<string, unknown>;
    expect(sp['request']).toEqual([{ reference: `ServiceRequest/${again.tests.find((t) => t.code === 'GLU')!.serviceRequestId}` }]);

    const revoked = { ...formOrder('FAC-1', 'R-C8', [{ code: 'HB', display: 'Haemoglobin' }])[0]!, status: 'revoked' };
    await save(w, [revoked], 'form-capture');
    await expect(w.reception.receiveSample({ requisition: 'R-C8', facilityCode: 'FAC-1', type: BLD }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    expect((await w.reception.findOrders('R-C8'))[0]!.tests[0]!.status).toBe('revoked');
  });

  it('linking a patient also moves the received samples to that patient, with the same reason', async () => {
    await w.reception.registerOrder({ requisition: 'R-C9', facilityCode: 'FAC-1', patientId: 'p1', tests: [HB] }, 'Neema');
    await w.reception.receiveSample({ requisition: 'R-C9', facilityCode: 'FAC-1', type: BLD }, 'Neema');
    const id = labSpecimenId('FAC-1', 'R-C9', BLD);
    await w.reception.correctOrder({ requisition: 'R-C9', facilityCode: 'FAC-1', changes: { patientId: 'p2' }, reason: 'wrong patient' }, 'Baraka');
    const sp = await w.fhirStore.get('Specimen', id) as Record<string, unknown>;
    expect(sp['subject']).toEqual({ reference: 'Patient/p2', display: 'Juma Said' });
    const rows = await w.db.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Provenance').execute();
    const reasons = rows.map((r) => (typeof r.resource === 'string' ? JSON.parse(r.resource) : r.resource) as Record<string, unknown>)
      .filter((p) => (p['target'] as Array<{ reference: string }>).some((t) => t.reference.startsWith(`Specimen/${id}/`)))
      .flatMap((p) => (p['reason'] as Array<{ text: string }> | undefined) ?? []);
    expect(reasons).toEqual([{ text: 'wrong patient' }]);
  });
});

describe('lab reception, dates and names', () => {
  it('refuses a date that is not a real day', async () => {
    const w = await world();
    await expect(w.reception.registerPatient({ given: 'Juma', family: 'Said', gender: 'male', birthDate: '1990-02-31' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    expect(await w.reception.searchPatients({ name: 'Asha Mrema', birthDate: '1990-02-31' })).toEqual([]);
  });

  it('takes a baby born today at the lab, just after the lab\'s midnight, while UTC is still yesterday', async () => {
    // 21:30 UTC on 22 November is 00:30 on 23 November in Dar es Salaam (UTC+3).
    const now = () => new Date('2026-11-22T21:30:00Z');
    const w = await world({ now, labTimeZone: async () => 'Africa/Dar_es_Salaam' });
    const p = await w.reception.registerPatient({ given: 'Baby', family: 'Said', gender: 'unknown', birthDate: '2026-11-23' }, 'Neema');
    expect((await w.fhirStore.get('Patient', p.id) as Record<string, unknown>)['birthDate']).toBe('2026-11-23');
    await expect(w.reception.registerPatient({ given: 'Baby', family: 'Said', gender: 'unknown', birthDate: '2026-11-24' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    // With no zone set the lab's date is the UTC date, so the same birth date is in the future.
    const utc = await world({ now });
    await expect(utc.reception.registerPatient({ given: 'Baby', family: 'Said', gender: 'unknown', birthDate: '2026-11-23' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
  });

  it('estimates an age from the lab\'s year', async () => {
    // 22:00 UTC on 31 December 2026 is 1 January 2027 in Dar es Salaam.
    const w = await world({ now: () => new Date('2026-12-31T22:00:00Z'), labTimeZone: async () => 'Africa/Dar_es_Salaam' });
    const p = await w.reception.registerPatient({ given: 'Juma', family: 'Said', gender: 'male', ageYears: 30 }, 'Neema');
    expect((await w.fhirStore.get('Patient', p.id) as Record<string, unknown>)['birthDate']).toBe('1997-01-01');
  });

  it('takes the birth date when both a birth date and an age are given', async () => {
    const w = await world();
    const p = await w.reception.registerPatient({ given: 'Juma', family: 'Said', gender: 'male', birthDate: '2001-07-15', ageYears: 3 }, 'Neema');
    const saved = await w.fhirStore.get('Patient', p.id) as Record<string, unknown>;
    expect(saved['birthDate']).toBe('2001-07-15');
    expect(saved['extension']).toBeUndefined();
  });

  it('finds a patient stored with the first given name only, from a name with a middle name', async () => {
    const w = await world();
    await seedPatient(w.externalDb, { id: 'wa', surname: 'Juma', firstname: 'Amina', dob: '1985-03-09', sex: 'F' });
    for (const name of ['Amina Rose Juma', 'Juma Amina Rose']) {
      expect((await w.reception.searchPatients({ name, birthDate: '1985-03-09' })).map((p) => p.id), name).toEqual(['wa']);
    }
    // The surname stays whole: a middle name is not tried as one.
    expect(await w.reception.searchPatients({ name: 'Amina Rose', birthDate: '1985-03-09' })).toEqual([]);
  });

  it('finds no one for a name of more than six words', async () => {
    const w = await world();
    await seedPatient(w.externalDb, { id: 'wa', surname: 'Juma', firstname: 'Amina', dob: '1985-03-09', sex: 'F' });
    expect(await w.reception.searchPatients({ name: 'Amina a b c d e Juma', birthDate: '1985-03-09' })).toEqual([]);
    expect((await w.reception.searchPatients({ name: 'Amina a b c d Juma', birthDate: '1985-03-09' })).map((p) => p.id)).toEqual(['wa']);
  });
});
