import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore } from './fhir-store';
import { findByRequisition, indexRequisitions, rebuildRequisitions, requisitionRowOf } from './lab-requisitions';

const REQ_SYSTEM = 'urn:openldr:order:requisition';

/** A request as the Lab order form writes one per test since slice 1b. */
function perTest(id: string, number: string, facility = 'FAC-1') {
  return {
    resourceType: 'ServiceRequest', id, status: 'active', intent: 'order', subject: { display: 'Unknown subject' },
    identifier: [{ system: REQ_SYSTEM, value: number }],
    requisition: { system: REQ_SYSTEM, value: number },
    requester: { reference: '#requester', type: 'PractitionerRole', display: 'Dr A' },
    contained: [{
      resourceType: 'PractitionerRole', id: 'requester', practitioner: { display: 'Dr A' },
      organization: { identifier: { system: 'urn:openldr:cs:facility-registry', value: facility }, display: 'Clinic' },
    }],
    code: { coding: [{ system: 'urn:test', code: 'T1' }] },
  };
}

/** A request saved through the form before slice 1b: every test a coding, the number in identifier only. */
function multiCoding(id: string, number: string) {
  return {
    resourceType: 'ServiceRequest', id, status: 'active', intent: 'order', subject: { display: 'Unknown subject' },
    identifier: [{ system: REQ_SYSTEM, value: number }],
    requester: { reference: '#requester', type: 'PractitionerRole' },
    contained: [{ resourceType: 'PractitionerRole', id: 'requester', organization: { identifier: { value: 'FAC-OLD' } } }],
    code: { coding: [{ system: 'urn:test', code: 'T1' }, { system: 'urn:test', code: 'T2' }] },
  };
}

describe('requisitionRowOf', () => {
  it('reads a per-test request, following #requester into contained for the facility', () => {
    expect(requisitionRowOf(perTest('sr-1', 'R-100'))).toEqual({ serviceRequestId: 'sr-1', requisition: 'R-100', facility: 'FAC-1' });
  });

  it('reads an old multi-coding request from identifier', () => {
    expect(requisitionRowOf(multiCoding('sr-2', 'OLD-7'))).toEqual({ serviceRequestId: 'sr-2', requisition: 'OLD-7', facility: 'FAC-OLD' });
  });

  it('prefers requisition.value over identifier', () => {
    const sr = { ...perTest('sr-3', 'R-1'), identifier: [{ value: 'OTHER' }] };
    expect(requisitionRowOf(sr)?.requisition).toBe('R-1');
  });

  it('trims the number', () => {
    expect(requisitionRowOf(perTest('sr-4', '  R-9  '))?.requisition).toBe('R-9');
  });

  it('gives null for a request with no identifier and no requisition', () => {
    expect(requisitionRowOf({ resourceType: 'ServiceRequest', id: 'sr-5', status: 'active' })).toBeNull();
    expect(requisitionRowOf({ resourceType: 'ServiceRequest', id: 'sr-6', identifier: [{ value: '   ' }] })).toBeNull();
  });

  it('reads a requester that is an Organization with an identifier', () => {
    const sr = { resourceType: 'ServiceRequest', id: 'sr-7', identifier: [{ value: 'N1' }], requester: { type: 'Organization', identifier: { value: 'FAC-9' } } };
    expect(requisitionRowOf(sr)?.facility).toBe('FAC-9');
  });

  it('gives a null facility for a reference that is not contained, or a contained one that is missing', () => {
    expect(requisitionRowOf({ resourceType: 'ServiceRequest', id: 'a', identifier: [{ value: 'N' }], requester: { reference: 'Organization/o1' } })?.facility).toBeNull();
    expect(requisitionRowOf({ resourceType: 'ServiceRequest', id: 'b', identifier: [{ value: 'N' }], requester: { reference: '#gone' } })?.facility).toBeNull();
    expect(requisitionRowOf({ resourceType: 'ServiceRequest', id: 'c', identifier: [{ value: 'N' }] })?.facility).toBeNull();
  });

  it('gives null for another resource type', () => {
    expect(requisitionRowOf({ resourceType: 'Observation', id: 'o1', identifier: [{ value: 'N' }] })).toBeNull();
  });
});

describe('lab_requisitions', () => {
  let db: Awaited<ReturnType<typeof makeMigratedDb>>;
  beforeEach(async () => { delete process.env.OPENLDR_SITE_ID; db = await makeMigratedDb(); });
  afterEach(async () => { await db.destroy(); });

  it('findByRequisition ignores surrounding spaces and finds every request of the number', async () => {
    const store = createFhirStore(db);
    await store.saveMany([perTest('sr-a', 'R-1'), perTest('sr-b', 'R-1'), perTest('sr-c', 'R-2')] as never);
    await indexRequisitions(db, [perTest('sr-a', 'R-1'), perTest('sr-b', 'R-1'), perTest('sr-c', 'R-2')]);
    expect(await findByRequisition(db, '  R-1 ')).toEqual([
      { serviceRequestId: 'sr-a', facility: 'FAC-1' },
      { serviceRequestId: 'sr-b', facility: 'FAC-1' },
    ]);
    expect(await findByRequisition(db, 'r-1')).toEqual([]);
    expect(await findByRequisition(db, '   ')).toEqual([]);
  });

  it('indexRequisitions updates a row and removes one whose number went', async () => {
    const store = createFhirStore(db);
    await store.save(perTest('sr-a', 'R-1') as never);
    await indexRequisitions(db, [perTest('sr-a', 'R-1')]);
    await indexRequisitions(db, [perTest('sr-a', 'R-5', 'FAC-2')]);
    expect(await findByRequisition(db, 'R-1')).toEqual([]);
    expect(await findByRequisition(db, 'R-5')).toEqual([{ serviceRequestId: 'sr-a', facility: 'FAC-2' }]);
    await indexRequisitions(db, [{ resourceType: 'ServiceRequest', id: 'sr-a', status: 'active' }]);
    expect(await db.selectFrom('lab_requisitions').selectAll().execute()).toEqual([]);
  });

  it('indexRequisitions keeps the last copy when one batch holds a request twice', async () => {
    expect(await indexRequisitions(db, [perTest('sr-a', 'R-1'), perTest('sr-a', 'R-2')])).toBe(1);
    expect(await db.selectFrom('lab_requisitions').select(['service_request_id', 'requisition']).execute())
      .toEqual([{ service_request_id: 'sr-a', requisition: 'R-2' }]);
  });

  it('findByRequisition does not return a request deleted from the store', async () => {
    const store = createFhirStore(db);
    await store.save(perTest('sr-a', 'R-1') as never);
    await indexRequisitions(db, [perTest('sr-a', 'R-1')]);
    await store.delete('ServiceRequest', 'sr-a');
    expect(await findByRequisition(db, 'R-1')).toEqual([]);
  });

  it('rebuildRequisitions writes the table again from the store and drops rows of deleted requests', async () => {
    const store = createFhirStore(db);
    await store.saveMany([perTest('sr-a', 'R-1'), multiCoding('sr-b', 'OLD-1'), { resourceType: 'ServiceRequest', id: 'sr-c', status: 'active', intent: 'order', subject: { display: 'x' } }] as never);
    await db.insertInto('lab_requisitions').values({ service_request_id: 'sr-gone', requisition: 'R-1', facility: null }).execute();
    expect(await rebuildRequisitions(db)).toEqual({ indexed: 2 });
    expect(await db.selectFrom('lab_requisitions').select(['service_request_id', 'requisition', 'facility']).orderBy('service_request_id').execute()).toEqual([
      { service_request_id: 'sr-a', requisition: 'R-1', facility: 'FAC-1' },
      { service_request_id: 'sr-b', requisition: 'OLD-1', facility: 'FAC-OLD' },
    ]);
  });
});
