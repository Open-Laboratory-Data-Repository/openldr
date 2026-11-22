import { beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import {
  FACILITY_REGISTRY_SYSTEM, createFhirStore, createTerminologyAdminStore, createTerminologyStore, findByRequisition,
  indexRequisitions, type FhirStore, type InternalSchema, type ValueSetProjection,
} from '@openldr/db';
import { createOperations } from '@openldr/terminology';
import { ORDER_ORIGIN_SYSTEM, ORDER_REQUISITION_SYSTEM, facilityReference, labOrderId, labSpecimenId, orderRequester } from '@openldr/forms';
import { createLabReception, ReceptionError, type LabReception, type OrderChanges } from './lab-reception';
import { createTestCatalog, TEST_CATALOG_SYSTEM } from './test-catalog';

const silent = { info() {}, error() {}, warn() {}, debug() {}, trace() {}, fatal() {}, child() { return silent; } } as never;
const LOCAL = 'urn:openldr:cs:local';
const BLD = { system: LOCAL, code: 'BLD' };

interface World { db: Kysely<InternalSchema>; fhirStore: FhirStore; reception: LabReception }

async function seedTest(db: Kysely<InternalSchema>, code: string, display: string, enabled = true): Promise<void> {
  await db.insertInto('terminology_concepts').values({
    system: TEST_CATALOG_SYSTEM, code, display, status: 'ACTIVE',
    properties: JSON.stringify({ specimenTypes: [BLD] }) as never,
  }).execute();
  await db.insertInto('test_catalog_lab_settings').values({ code, enabled } as never).execute();
}

async function world(): Promise<World> {
  delete process.env.OPENLDR_SITE_ID;
  const db = await makeMigratedDb();
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(resource) {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? '';
    },
    async registerSystem(url, version, kind, resourceId) { await store.saveSystem(url, version, kind, resourceId); },
    async deleteValueSetResource() {},
  };
  const admin = createTerminologyAdminStore(db, projection);
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
  return { db, fhirStore, reception: createLabReception({ db, fhirStore, catalog, logger: silent }) };
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
      { serviceRequestId: 'old-1', system: TEST_CATALOG_SYSTEM, code: 'HB', display: 'Haemoglobin', status: 'active' },
      { serviceRequestId: 'old-1', system: TEST_CATALOG_SYSTEM, code: 'GLU', display: 'Glucose', status: 'active' },
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

  it('reads a Specimen at the fixed id and one that names a request', async () => {
    const [sr] = formOrder('FAC-1', 'R-300', [{ code: 'HB', display: 'Haemoglobin' }]);
    await save(w, [sr!], 'form-capture');
    await w.fhirStore.saveMany([
      { resourceType: 'Specimen', id: labSpecimenId('FAC-1', 'R-300', BLD), status: 'available', type: { coding: [{ ...BLD, display: 'Blood' }] }, receivedTime: '2026-11-22T08:00:00Z' },
      { resourceType: 'Specimen', id: 'sp-other', status: 'unsatisfactory', request: [{ reference: `ServiceRequest/${sr!.id}` }], condition: [{ coding: [{ system: LOCAL, code: 'HAEM', display: 'Haemolysed' }] }] },
      { resourceType: 'Specimen', id: 'sp-unrelated', status: 'available', request: [{ reference: 'ServiceRequest/nope' }] },
    ] as never);
    const [o] = await w.reception.findOrders('R-300');
    expect(o!.specimens).toEqual([
      { id: labSpecimenId('FAC-1', 'R-300', BLD), type: { ...BLD, display: 'Blood' }, condition: null, receivedTime: '2026-11-22T08:00:00Z' },
      { id: 'sp-other', type: null, condition: 'Haemolysed', receivedTime: null },
    ].sort((a, b) => a.id.localeCompare(b.id)));
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
