import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import {
  FACILITY_REGISTRY_SYSTEM, createFhirStore, createTerminologyStore, indexRequisitions,
  type FhirStore, type InternalSchema,
} from '@openldr/db';
import { createOperations } from '@openldr/terminology';
import {
  LAB_TASK_SYSTEM, ORDER_REQUISITION_SYSTEM, facilityReference, labOrderId, labRejectionObservationId, labSpecimenId,
  labTaskId, orderKey, orderRequester,
} from '@openldr/forms';
import { createLabReception, type LabReception } from './lab-reception';
import { createLabRejection, type LabRejection } from './lab-rejection';
import { createTestCatalog, TEST_CATALOG_SYSTEM } from './test-catalog';
import { createPatientIndex } from './patient-index';
import { buildPatientIndexFixture } from './test-support/patient-index-fixture';

type Json = Record<string, unknown>;
const silent = { info() {}, error() {}, warn() {}, debug() {}, trace() {}, fatal() {}, child() { return silent; } } as never;
const LOCAL = 'urn:openldr:cs:local';
const BLD = { system: LOCAL, code: 'BLD' };
const URINE = { system: LOCAL, code: 'UR' };
const RETURN_SYSTEM = 'urn:openldr:cs:order-return-reason';
const ORDER_REJECT_SYSTEM = 'urn:openldr:cs:reject-order';
const TEST_REJECT_SYSTEM = 'urn:openldr:cs:reject-test';
const CONDITION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v2-0493';
const REJECTION_EXT = 'urn:openldr:ext:rejection';

interface World {
  db: Kysely<InternalSchema>; fhirStore: FhirStore; reception: LabReception; rejection: LabRejection;
}

async function seedTest(db: Kysely<InternalSchema>, code: string, display: string, types: Array<{ system: string; code: string }>): Promise<void> {
  await db.insertInto('terminology_concepts').values({
    system: TEST_CATALOG_SYSTEM, code, display, status: 'ACTIVE',
    properties: JSON.stringify({ specimenTypes: types }) as never,
  }).execute();
  await db.insertInto('test_catalog_lab_settings').values({ code, enabled: true } as never).execute();
}

async function world(labName: string | null = 'Central Lab'): Promise<World> {
  delete process.env.OPENLDR_SITE_ID;
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
  await seedTest(db, 'HB', 'Haemoglobin', [BLD]);
  await seedTest(db, 'GLU', 'Glucose', [BLD]);
  await seedTest(db, 'UA', 'Urinalysis', [URINE]);
  for (const [code, display] of [['FAC-1', 'Clinic One'], ['FAC-2', 'Clinic Two']]) {
    await db.insertInto('terminology_concepts').values({ system: FACILITY_REGISTRY_SYSTEM, code, display, status: 'ACTIVE', properties: null }).execute();
  }
  await fhirStore.saveMany([
    { resourceType: 'Patient', id: 'p1', name: [{ given: ['Asha'], family: 'Mrema' }] },
    { resourceType: 'Patient', id: 'p2', name: [{ given: ['Juma'], family: 'Said' }] },
  ] as never);
  const patientIndex = createPatientIndex({ externalDb, systems: f.systems, engine: 'postgres', refKey: randomBytes(32) });
  const deps = { db, externalDb, fhirStore, catalog, ops, patientIndex, logger: silent };
  return {
    db, fhirStore,
    reception: createLabReception(deps),
    rejection: createLabRejection({ ...deps, labName: async () => labName }),
  };
}

const cat = (code: string, display: string) => ({ system: TEST_CATALOG_SYSTEM, code, display });
const srId = (facility: string, requisition: string, code: string) => labOrderId(facility, requisition, { system: TEST_CATALOG_SYSTEM, code });

/** An order as the Lab order form saves it: one request per test. */
function formOrder(facility: string, requisition: string, tests: Array<{ code: string; display: string }>) {
  const requester = orderRequester('Dr Kweka', facilityReference({ system: FACILITY_REGISTRY_SYSTEM, code: facility, display: 'Clinic One' }))!;
  const number = { system: ORDER_REQUISITION_SYSTEM, value: requisition };
  return tests.map((t) => ({
    resourceType: 'ServiceRequest', id: srId(facility, requisition, t.code),
    status: 'active', intent: 'order', priority: 'urgent',
    subject: { reference: 'Patient/p1', display: 'Asha Mrema' },
    identifier: [{ ...number }], requisition: { ...number },
    code: { coding: [cat(t.code, t.display)], text: t.display },
    contained: [requester.contained], requester: requester.requester,
  }));
}

async function save(w: World, resources: Json[], sourceSystem = 'form-capture'): Promise<void> {
  await w.fhirStore.saveMany(resources as never, { sourceSystem });
  await indexRequisitions(w.db, resources);
}

const HB_GLU = [{ code: 'HB', display: 'Haemoglobin' }, { code: 'GLU', display: 'Glucose' }];

async function get(w: World, type: string, id: string): Promise<Json> {
  const r = await w.fhirStore.get(type, id) as Json | null;
  if (!r) throw new Error(`${type}/${id} missing`);
  return r;
}

async function allOf(w: World, type: string): Promise<Json[]> {
  const rows = await w.db.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', type).execute();
  return rows.map((r) => (typeof r.resource === 'string' ? JSON.parse(r.resource) : r.resource) as Json);
}

async function provenancesFor(w: World, ref: string): Promise<Json[]> {
  return (await allOf(w, 'Provenance'))
    .filter((p) => (p['target'] as Array<{ reference: string }>).some((t) => t.reference.startsWith(ref)));
}

async function historyCount(w: World): Promise<number> {
  const row = await w.db.selectFrom('fhir.resource_history').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
  return Number(row.n);
}

async function versionsOf(w: World, type: string, id: string): Promise<Json[]> {
  const rows = await w.db.selectFrom('fhir.resource_history').select(['version', 'resource'])
    .where('resource_type', '=', type).where('id', '=', id).orderBy('version').execute();
  return rows.map((r) => (typeof r.resource === 'string' ? JSON.parse(r.resource) : r.resource) as Json);
}

const rejectionExt = (sr: Json) => (sr['extension'] as Json[] | undefined)?.find((e) => e['url'] === REJECTION_EXT);

describe('lab rejection, return an order to its site', () => {
  let w: World;
  beforeEach(async () => { w = await world(); });

  it('puts every live request on hold and writes the return Task', async () => {
    await save(w, formOrder('FAC-1', 'R-1', HB_GLU));
    const o = await w.rejection.returnOrder({ requisition: 'R-1', facilityCode: 'FAC-1', reasonCode: 'form-incomplete', note: 'no ward' }, 'Neema');
    expect(o.tests.every((t) => t.status === 'on-hold')).toBe(true);
    expect(o.returned).toMatchObject({ reason: { code: 'form-incomplete', display: 'Form incomplete' }, by: 'Neema' });
    expect(typeof o.returned!.at).toBe('string');

    const hb = srId('FAC-1', 'R-1', 'HB');
    const glu = srId('FAC-1', 'R-1', 'GLU');
    for (const id of [hb, glu]) {
      expect((await get(w, 'ServiceRequest', id))['status']).toBe('on-hold');
      const prov = await provenancesFor(w, `ServiceRequest/${id}`);
      expect(prov.map((p) => p['reason'])).toContainEqual([{ text: 'Form incomplete' }]);
    }
    const task = await get(w, 'Task', labTaskId('correct-request', orderKey('FAC-1', 'R-1')));
    expect(task).toMatchObject({
      status: 'requested', intent: 'order',
      code: { coding: [{ system: LAB_TASK_SYSTEM, code: 'correct-request' }] },
      focus: { reference: `ServiceRequest/${o.tests[0]!.serviceRequestId}` },
      for: { reference: 'Patient/p1' },
      owner: { identifier: { system: FACILITY_REGISTRY_SYSTEM, value: 'FAC-1' }, display: 'Clinic One' },
      requester: { display: 'Central Lab' },
      statusReason: { coding: [{ system: RETURN_SYSTEM, code: 'form-incomplete', display: 'Form incomplete' }] },
      note: [{ text: 'no ward' }],
    });
    expect((task['basedOn'] as Json[]).map((r) => r['reference']).sort()).toEqual([`ServiceRequest/${hb}`, `ServiceRequest/${glu}`].sort());
    expect(typeof task['authoredOn']).toBe('string');
    // The order still reads the same in findOrders.
    expect((await w.reception.findOrders('R-1'))[0]).toEqual(o);
  });

  it('names the lab "Laboratory" when the Laboratory settings name is unset', async () => {
    w = await world(null);
    await save(w, formOrder('FAC-1', 'R-1b', HB_GLU));
    await w.rejection.returnOrder({ requisition: 'R-1b', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' }, 'Neema');
    const task = await get(w, 'Task', labTaskId('correct-request', orderKey('FAC-1', 'R-1b')));
    expect(task['requester']).toEqual({ display: 'Laboratory' });
    expect(task['note']).toBeUndefined();
  });

  it('refuses a desk order and an order already on hold with conflict, writing nothing (focus 1)', async () => {
    await w.reception.registerOrder({
      requisition: 'R-2', facilityCode: 'FAC-1', patientId: 'p1', tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }],
    }, 'Neema');
    let before = await historyCount(w);
    await expect(w.rejection.returnOrder({ requisition: 'R-2', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'conflict' });
    expect(await historyCount(w)).toBe(before);

    await save(w, formOrder('FAC-1', 'R-3', HB_GLU));
    await w.rejection.returnOrder({ requisition: 'R-3', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' }, 'Neema');
    before = await historyCount(w);
    await expect(w.rejection.returnOrder({ requisition: 'R-3', facilityCode: 'FAC-1', reasonCode: 'clerical-mistake' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'conflict' });
    expect(await historyCount(w)).toBe(before);
  });

  it('refuses a reason outside the return reasons, and an unknown order', async () => {
    await save(w, formOrder('FAC-1', 'R-4', HB_GLU));
    await expect(w.rejection.returnOrder({ requisition: 'R-4', facilityCode: 'FAC-1', reasonCode: 'WRONGPT' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    await expect(w.rejection.returnOrder({ requisition: 'R-none', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'not-found' });
    expect(await w.fhirStore.exists('Task', labTaskId('correct-request', orderKey('FAC-1', 'R-4')))).toBe(false);
  });

  it('refuses a typo correction while the return Task is open (ruling 8)', async () => {
    await save(w, formOrder('FAC-1', 'R-5', HB_GLU));
    await w.rejection.returnOrder({ requisition: 'R-5', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' }, 'Neema');
    await expect(w.reception.correctOrder({ requisition: 'R-5', facilityCode: 'FAC-1', changes: { priority: 'stat' }, reason: 'typo' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'conflict' });
  });
});

describe('lab rejection, mark a returned order corrected', () => {
  let w: World;
  beforeEach(async () => { w = await world(); });

  it('applies the changes, sets the requests active and completes the Task', async () => {
    await save(w, formOrder('FAC-1', 'R-10', HB_GLU));
    await w.rejection.returnOrder({ requisition: 'R-10', facilityCode: 'FAC-1', reasonCode: 'wrong-patient-details' }, 'Neema');
    const o = await w.rejection.markCorrected({
      requisition: 'R-10', facilityCode: 'FAC-1', changes: { patientId: 'p2', note: 'ward 3' }, reason: 'site sent the right patient',
    }, 'Neema');
    expect(o.returned).toBeNull();
    expect(o.tests.every((t) => t.status === 'active')).toBe(true);
    expect(o.patient).toEqual({ id: 'p2', display: 'Juma Said' });
    expect(o.note).toBe('ward 3');
    for (const t of o.tests) {
      const sr = await get(w, 'ServiceRequest', t.serviceRequestId);
      expect(sr['status']).toBe('active');
      expect(sr['subject']).toEqual({ reference: 'Patient/p2', display: 'Juma Said' });
      const prov = await provenancesFor(w, `ServiceRequest/${t.serviceRequestId}`);
      expect(prov.map((p) => p['reason'])).toContainEqual([{ text: 'site sent the right patient' }]);
    }
    const task = await get(w, 'Task', labTaskId('correct-request', orderKey('FAC-1', 'R-10')));
    expect(task['status']).toBe('completed');
  });

  it('refuses an order with no open return Task', async () => {
    await save(w, formOrder('FAC-1', 'R-11', HB_GLU));
    const before = await historyCount(w);
    await expect(w.rejection.markCorrected({ requisition: 'R-11', facilityCode: 'FAC-1', changes: {}, reason: 'fixed' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'conflict' });
    expect(await historyCount(w)).toBe(before);
  });

  it('return, corrected, return again: one Task id with three versions (focus 2)', async () => {
    await save(w, formOrder('FAC-1', 'R-12', HB_GLU));
    const input = { requisition: 'R-12', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' };
    await w.rejection.returnOrder(input, 'Neema');
    await w.rejection.markCorrected({ requisition: 'R-12', facilityCode: 'FAC-1', changes: {}, reason: 'site completed the form' }, 'Neema');
    const o = await w.rejection.returnOrder({ ...input, reasonCode: 'form-unreadable' }, 'Baraka');
    expect(o.returned).toMatchObject({ reason: { code: 'form-unreadable' }, by: 'Baraka' });
    const id = labTaskId('correct-request', orderKey('FAC-1', 'R-12'));
    const versions = await versionsOf(w, 'Task', id);
    expect(versions.map((v) => v['status'])).toEqual(['requested', 'completed', 'requested']);
    expect(await allOf(w, 'Task')).toHaveLength(1);
  });
});

describe('lab rejection, reject a sample', () => {
  let w: World;
  beforeEach(async () => { w = await world(); });

  it('a sample serving two tests: both revoked, one redraw Task names both (focus 3)', async () => {
    await save(w, formOrder('FAC-1', 'R-20', HB_GLU));
    await w.reception.receiveSample({ requisition: 'R-20', facilityCode: 'FAC-1', type: BLD, receivedTime: '2026-11-23T08:00:00Z' }, 'Neema');
    const o = await w.rejection.rejectSample({
      requisition: 'R-20', facilityCode: 'FAC-1', specimenTypeCode: 'BLD', conditionCode: 'HEM', reasonCode: 'UNLABELLED', redraw: true,
    }, 'Neema');
    const spId = labSpecimenId('FAC-1', 'R-20', BLD);
    const sp = await get(w, 'Specimen', spId);
    expect(sp['status']).toBe('unsatisfactory');
    expect(sp['condition']).toEqual([{ coding: [{ system: CONDITION_SYSTEM, code: 'HEM', display: 'Hemolyzed' }] }]);
    expect(sp['receivedTime']).toBe('2026-11-23T08:00:00Z');
    const ids = [srId('FAC-1', 'R-20', 'HB'), srId('FAC-1', 'R-20', 'GLU')];
    for (const id of ids) {
      const sr = await get(w, 'ServiceRequest', id);
      expect(sr['status']).toBe('revoked');
      expect(rejectionExt(sr)).toEqual({ url: REJECTION_EXT, extension: [{ url: 'code', valueCode: 'UNLABELLED' }, { url: 'reason', valueString: 'Unlabelled specimen' }] });
      const prov = await provenancesFor(w, `ServiceRequest/${id}`);
      expect(prov.map((p) => p['reason'])).toContainEqual([{ text: 'Unlabelled specimen' }]);
    }
    const tasks = (await allOf(w, 'Task'));
    expect(tasks).toHaveLength(1);
    const task = tasks[0]!;
    expect(task).toMatchObject({
      id: labTaskId('recollect-sample', spId), status: 'requested', intent: 'order',
      code: { coding: [{ system: LAB_TASK_SYSTEM, code: 'recollect-sample' }] },
      focus: { reference: `Specimen/${spId}` },
      owner: { identifier: { system: FACILITY_REGISTRY_SYSTEM, value: 'FAC-1' } },
      requester: { display: 'Central Lab' },
      statusReason: { coding: [{ system: ORDER_REJECT_SYSTEM, code: 'UNLABELLED', display: 'Unlabelled specimen' }] },
    });
    expect((task['basedOn'] as Json[]).map((r) => r['reference']).sort()).toEqual(ids.map((i) => `ServiceRequest/${i}`).sort());
    expect(o.tests.map((t) => [t.status, t.rejection])).toEqual([
      ['revoked', { code: 'UNLABELLED', display: 'Unlabelled specimen' }],
      ['revoked', { code: 'UNLABELLED', display: 'Unlabelled specimen' }],
    ]);
    expect(o.redraws).toEqual([{ taskId: task['id'], status: 'requested', focus: `Specimen/${spId}`, replacedBy: null }]);
  });

  it('a sample never received gets a receivedTime now; no redraw writes no Task', async () => {
    w = await world();
    await save(w, formOrder('FAC-1', 'R-21', [{ code: 'HB', display: 'Haemoglobin' }, { code: 'UA', display: 'Urinalysis' }]));
    const o = await w.rejection.rejectSample({
      requisition: 'R-21', facilityCode: 'FAC-1', specimenTypeCode: 'UR', conditionCode: 'CON', reasonCode: 'WRONGPT', redraw: false,
    }, 'Neema');
    const sp = await get(w, 'Specimen', labSpecimenId('FAC-1', 'R-21', URINE));
    expect(sp['status']).toBe('unsatisfactory');
    expect(typeof sp['receivedTime']).toBe('string');
    expect(sp['request']).toEqual([{ reference: `ServiceRequest/${srId('FAC-1', 'R-21', 'UA')}` }]);
    // Only the urine test is revoked; the blood test stays live.
    expect(Object.fromEntries(o.tests.map((t) => [t.code, t.status]))).toEqual({ HB: 'active', UA: 'revoked' });
    expect(await allOf(w, 'Task')).toHaveLength(0);
    expect(o.redraws).toEqual([]);
  });

  it('refuses a sample type the order does not take, a condition or reason outside its set', async () => {
    await save(w, formOrder('FAC-1', 'R-22', HB_GLU));
    const base = { requisition: 'R-22', facilityCode: 'FAC-1', specimenTypeCode: 'BLD', conditionCode: 'HEM', reasonCode: 'WRONGPT', redraw: true };
    const before = await historyCount(w);
    for (const bad of [{ ...base, specimenTypeCode: 'UR' }, { ...base, conditionCode: 'NOPE' }, { ...base, reasonCode: 'HAEM' }]) {
      await expect(w.rejection.rejectSample(bad, 'Neema'), JSON.stringify(bad)).rejects.toMatchObject({ reason: 'invalid' });
    }
    expect(await historyCount(w)).toBe(before);
  });

  it('rejecting a returned order\'s sample cancels its open return Task (ruling 8)', async () => {
    await save(w, formOrder('FAC-1', 'R-23', HB_GLU));
    await w.rejection.returnOrder({ requisition: 'R-23', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' }, 'Neema');
    const o = await w.rejection.rejectSample({
      requisition: 'R-23', facilityCode: 'FAC-1', specimenTypeCode: 'BLD', conditionCode: 'CLOT', reasonCode: 'WRONGPT', redraw: false,
    }, 'Neema');
    expect((await get(w, 'Task', labTaskId('correct-request', orderKey('FAC-1', 'R-23'))))['status']).toBe('cancelled');
    expect(o.returned).toBeNull();
    expect(o.tests.every((t) => t.status === 'revoked')).toBe(true);
  });

  it('rejecting one sample of a returned order keeps the return Task open while a test stays on hold', async () => {
    await save(w, formOrder('FAC-1', 'R-25', [{ code: 'HB', display: 'Haemoglobin' }, { code: 'UA', display: 'Urinalysis' }]));
    await w.rejection.returnOrder({ requisition: 'R-25', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' }, 'Neema');
    const taskId = labTaskId('correct-request', orderKey('FAC-1', 'R-25'));
    const o = await w.rejection.rejectSample({
      requisition: 'R-25', facilityCode: 'FAC-1', specimenTypeCode: 'BLD', conditionCode: 'CLOT', reasonCode: 'WRONGPT', redraw: false,
    }, 'Neema');
    expect((await get(w, 'Task', taskId))['status']).toBe('requested');
    expect(o.returned).not.toBeNull();
    expect(Object.fromEntries(o.tests.map((t) => [t.code, t.status]))).toEqual({ HB: 'revoked', UA: 'on-hold' });
    // Corrected by site still takes the urine test out of hold.
    const after = await w.rejection.markCorrected({ requisition: 'R-25', facilityCode: 'FAC-1', changes: {}, reason: 'site fixed the form' }, 'Neema');
    expect(Object.fromEntries(after.tests.map((t) => [t.code, t.status]))).toEqual({ HB: 'revoked', UA: 'active' });
    expect((await get(w, 'Task', taskId))['status']).toBe('completed');
  });

  it('a rejected sample shows its status on the order', async () => {
    await save(w, formOrder('FAC-1', 'R-26', [{ code: 'HB', display: 'Haemoglobin' }, { code: 'UA', display: 'Urinalysis' }]));
    await w.reception.receiveSample({ requisition: 'R-26', facilityCode: 'FAC-1', type: URINE, receivedTime: '2026-11-23T08:00:00Z' }, 'Neema');
    const o = await w.rejection.rejectSample({
      requisition: 'R-26', facilityCode: 'FAC-1', specimenTypeCode: 'BLD', conditionCode: 'CLOT', reasonCode: 'WRONGPT', redraw: false,
    }, 'Neema');
    expect(Object.fromEntries(o.specimens.map((s) => [s.type?.code, s.status]))).toEqual({ BLD: 'unsatisfactory', UR: 'available' });
  });

  it('refuses to receive a rejected sample again, writing nothing', async () => {
    await save(w, formOrder('FAC-1', 'R-27', HB_GLU));
    // The receipt names the haemoglobin request only, so glucose stays live and still takes blood.
    await w.reception.receiveSample({
      requisition: 'R-27', facilityCode: 'FAC-1', type: BLD, serviceRequestIds: [srId('FAC-1', 'R-27', 'HB')], receivedTime: '2026-11-23T08:00:00Z',
    }, 'Neema');
    await w.rejection.rejectSample({
      requisition: 'R-27', facilityCode: 'FAC-1', specimenTypeCode: 'BLD', conditionCode: 'CLOT', reasonCode: 'WRONGPT', redraw: false,
    }, 'Neema');
    const before = await historyCount(w);
    await expect(w.reception.receiveSample({ requisition: 'R-27', facilityCode: 'FAC-1', type: BLD }, 'Neema'))
      .rejects.toMatchObject({ reason: 'conflict', message: expect.stringMatching(/was rejected\. Register a redraw/) });
    expect(await historyCount(w)).toBe(before);
    expect((await get(w, 'Specimen', labSpecimenId('FAC-1', 'R-27', BLD)))['status']).toBe('unsatisfactory');
  });

  it('a retried sample reject writes nothing more (focus 5)', async () => {
    await save(w, formOrder('FAC-1', 'R-24', HB_GLU));
    const input = { requisition: 'R-24', facilityCode: 'FAC-1', specimenTypeCode: 'BLD', conditionCode: 'HEM', reasonCode: 'WRONGPT', redraw: true };
    const first = await w.rejection.rejectSample(input, 'Neema');
    const before = await historyCount(w);
    const again = await w.rejection.rejectSample(input, 'Neema');
    expect(await historyCount(w)).toBe(before);
    expect(again).toEqual(first);
    expect(await allOf(w, 'Task')).toHaveLength(1);
  });
});

describe('lab rejection, reject one test', () => {
  let w: World;
  beforeEach(async () => { w = await world(); });

  it('writes a cancelled Observation, revokes the request and asks for a redraw', async () => {
    await save(w, formOrder('FAC-1', 'R-30', HB_GLU));
    const hb = srId('FAC-1', 'R-30', 'HB');
    const o = await w.rejection.rejectTest({ serviceRequestId: hb, reasonCode: 'QNS', redraw: true }, 'Neema');
    const obs = await get(w, 'Observation', labRejectionObservationId(hb));
    expect(obs).toMatchObject({
      status: 'cancelled',
      code: { coding: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }] },
      subject: { reference: 'Patient/p1' },
      basedOn: [{ reference: `ServiceRequest/${hb}` }],
      dataAbsentReason: { coding: [{ system: TEST_REJECT_SYSTEM, code: 'QNS', display: 'Insufficient volume' }] },
    });
    const sr = await get(w, 'ServiceRequest', hb);
    expect(sr['status']).toBe('revoked');
    expect(rejectionExt(sr)).toEqual({ url: REJECTION_EXT, extension: [{ url: 'code', valueCode: 'QNS' }, { url: 'reason', valueString: 'Insufficient volume' }] });
    expect((await provenancesFor(w, `ServiceRequest/${hb}`)).map((p) => p['reason'])).toContainEqual([{ text: 'Insufficient volume' }]);
    const task = await get(w, 'Task', labTaskId('recollect-sample', hb));
    expect(task).toMatchObject({
      status: 'requested', focus: { reference: `ServiceRequest/${hb}` }, basedOn: [{ reference: `ServiceRequest/${hb}` }],
      owner: { identifier: { value: 'FAC-1' } },
    });
    expect(Object.fromEntries(o.tests.map((t) => [t.code, t.status]))).toEqual({ HB: 'revoked', GLU: 'active' });
    expect(o.tests.find((t) => t.code === 'HB')!.rejection).toEqual({ code: 'QNS', display: 'Insufficient volume' });
    expect(o.redraws).toEqual([{ taskId: task['id'], status: 'requested', focus: `ServiceRequest/${hb}`, replacedBy: null }]);
  });

  it('on a returned order, the return Task closes only when the last live test is rejected', async () => {
    await save(w, formOrder('FAC-1', 'R-33', HB_GLU));
    await w.rejection.returnOrder({ requisition: 'R-33', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' }, 'Neema');
    const taskId = labTaskId('correct-request', orderKey('FAC-1', 'R-33'));
    const first = await w.rejection.rejectTest({ serviceRequestId: srId('FAC-1', 'R-33', 'HB'), reasonCode: 'QNS', redraw: false }, 'Neema');
    expect((await get(w, 'Task', taskId))['status']).toBe('requested');
    expect(first.returned).not.toBeNull();
    const last = await w.rejection.rejectTest({ serviceRequestId: srId('FAC-1', 'R-33', 'GLU'), reasonCode: 'QNS', redraw: false }, 'Neema');
    expect((await get(w, 'Task', taskId))['status']).toBe('cancelled');
    expect(last.returned).toBeNull();
  });

  it('a retried test reject writes no second Observation or Task (focus 5)', async () => {
    await save(w, formOrder('FAC-1', 'R-31', HB_GLU));
    const hb = srId('FAC-1', 'R-31', 'HB');
    await w.rejection.rejectTest({ serviceRequestId: hb, reasonCode: 'QNS', redraw: true }, 'Neema');
    const before = await historyCount(w);
    await w.rejection.rejectTest({ serviceRequestId: hb, reasonCode: 'QNS', redraw: true }, 'Neema');
    expect(await historyCount(w)).toBe(before);
    expect(await allOf(w, 'Observation')).toHaveLength(1);
    expect(await allOf(w, 'Task')).toHaveLength(1);
  });

  it('refuses an unknown request and a reason outside the test reasons', async () => {
    await save(w, formOrder('FAC-1', 'R-32', HB_GLU));
    await expect(w.rejection.rejectTest({ serviceRequestId: 'sr-none', reasonCode: 'QNS', redraw: false }, 'Neema'))
      .rejects.toMatchObject({ reason: 'not-found' });
    await expect(w.rejection.rejectTest({ serviceRequestId: srId('FAC-1', 'R-32', 'HB'), reasonCode: 'WRONGPT', redraw: false }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
  });
});

describe('lab rejection, link a redraw', () => {
  let w: World;
  beforeEach(async () => { w = await world(); });

  async function rejectedAndRedrawn(): Promise<void> {
    await save(w, formOrder('FAC-1', 'R-40', HB_GLU));
    await w.rejection.rejectSample({
      requisition: 'R-40', facilityCode: 'FAC-1', specimenTypeCode: 'BLD', conditionCode: 'HEM', reasonCode: 'WRONGPT', redraw: true,
    }, 'Neema');
    await w.reception.registerOrder({
      requisition: 'R-41', facilityCode: 'FAC-1', patientId: 'p1', tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }],
    }, 'Neema');
  }

  it('sets replaces on each matching test and completes the redraw Task', async () => {
    await rejectedAndRedrawn();
    const o = await w.rejection.linkRedraw({ requisition: 'R-41', facilityCode: 'FAC-1', replacesRequisition: 'R-40' }, 'Neema');
    const sr = await get(w, 'ServiceRequest', srId('FAC-1', 'R-41', 'HB'));
    expect(sr['replaces']).toEqual([{ reference: `ServiceRequest/${srId('FAC-1', 'R-40', 'HB')}` }]);
    expect((await provenancesFor(w, `ServiceRequest/${srId('FAC-1', 'R-41', 'HB')}`)).map((p) => p['reason']))
      .toContainEqual([{ text: 'Redraw of R-40' }]);
    const spId = labSpecimenId('FAC-1', 'R-40', BLD);
    expect((await get(w, 'Task', labTaskId('recollect-sample', spId)))['status']).toBe('completed');
    expect(o.requisition).toBe('R-41');
    const [old] = await w.reception.findOrders('R-40');
    expect(old!.redraws).toEqual([{ taskId: labTaskId('recollect-sample', spId), status: 'completed', focus: `Specimen/${spId}`, replacedBy: 'R-41' }]);
  });

  it('one link that replaces tests from two redraw Tasks: each Task\'s output names its own new request', async () => {
    await save(w, formOrder('FAC-1', 'R-50', HB_GLU));
    const oldHb = srId('FAC-1', 'R-50', 'HB');
    const oldGlu = srId('FAC-1', 'R-50', 'GLU');
    await w.rejection.rejectTest({ serviceRequestId: oldHb, reasonCode: 'QNS', redraw: true }, 'Neema');
    await w.rejection.rejectTest({ serviceRequestId: oldGlu, reasonCode: 'HAEM', redraw: true }, 'Neema');
    await w.reception.registerOrder({
      requisition: 'R-51', facilityCode: 'FAC-1', patientId: 'p1',
      tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }, { system: TEST_CATALOG_SYSTEM, code: 'GLU' }],
    }, 'Neema');
    await w.rejection.linkRedraw({ requisition: 'R-51', facilityCode: 'FAC-1', replacesRequisition: 'R-50' }, 'Neema');
    for (const [oldId, code] of [[oldHb, 'HB'], [oldGlu, 'GLU']] as const) {
      const task = await get(w, 'Task', labTaskId('recollect-sample', oldId));
      expect(task['status']).toBe('completed');
      expect(task['output']).toEqual([{
        type: { text: 'Redraw order' },
        valueReference: { reference: `ServiceRequest/${srId('FAC-1', 'R-51', code)}`, display: 'R-51' },
      }]);
      expect((await get(w, 'ServiceRequest', srId('FAC-1', 'R-51', code)))['replaces']).toEqual([{ reference: `ServiceRequest/${oldId}` }]);
    }
  });

  it('refuses a number at another facility, or with no matching test, and writes nothing (focus 4)', async () => {
    await rejectedAndRedrawn();
    await save(w, formOrder('FAC-2', 'R-42', [{ code: 'HB', display: 'Haemoglobin' }]));
    await w.reception.registerOrder({
      requisition: 'R-43', facilityCode: 'FAC-1', patientId: 'p1', tests: [{ system: TEST_CATALOG_SYSTEM, code: 'UA' }],
    }, 'Neema');
    const before = await historyCount(w);
    await expect(w.rejection.linkRedraw({ requisition: 'R-42', facilityCode: 'FAC-2', replacesRequisition: 'R-40' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    await expect(w.rejection.linkRedraw({ requisition: 'R-43', facilityCode: 'FAC-1', replacesRequisition: 'R-40' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    await expect(w.rejection.linkRedraw({ requisition: 'R-41', facilityCode: 'FAC-1', replacesRequisition: 'R-41' }, 'Neema'))
      .rejects.toMatchObject({ reason: 'invalid' });
    expect(await historyCount(w)).toBe(before);
  });
});

describe('lab rejection, the Provenance of a Task write', () => {
  it('targets the Task version the store stamped, on a first and a second write', async () => {
    const w = await world();
    await save(w, formOrder('FAC-1', 'R-60', HB_GLU));
    const id = labTaskId('correct-request', orderKey('FAC-1', 'R-60'));
    const check = async (expected: string) => {
      const task = await get(w, 'Task', id);
      const versionId = String((task['meta'] as Json)['versionId']);
      expect(versionId).toBe(expected);
      const history = task['relevantHistory'] as Array<{ reference: string }>;
      const prov = await get(w, 'Provenance', history[history.length - 1]!.reference.slice('Provenance/'.length));
      expect(prov['target']).toEqual([{ reference: `Task/${id}/_history/${versionId}` }]);
    };
    await w.rejection.returnOrder({ requisition: 'R-60', facilityCode: 'FAC-1', reasonCode: 'form-incomplete' }, 'Neema');
    await check('1');
    await w.rejection.markCorrected({ requisition: 'R-60', facilityCode: 'FAC-1', changes: {}, reason: 'site fixed it' }, 'Neema');
    await check('2');
  });
});
