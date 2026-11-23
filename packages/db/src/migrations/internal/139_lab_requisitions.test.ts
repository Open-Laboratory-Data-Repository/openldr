import { describe, expect, it } from 'vitest';
import { makeMigratedDbUpTo } from './test-helpers';
import { createFhirStore } from '../../fhir-store';
import { up, down } from './139_lab_requisitions';

const REQ = 'urn:openldr:order:requisition';

describe('139 lab requisitions', () => {
  it('fills the table from the current ServiceRequests and is safe to run twice', async () => {
    delete process.env.OPENLDR_SITE_ID;
    const db = await makeMigratedDbUpTo('138_lab_order_form_orders_only');
    const store = createFhirStore(db);
    await store.saveMany([
      {
        resourceType: 'ServiceRequest', id: 'sr-new', status: 'active', intent: 'order', subject: { display: 'x' },
        identifier: [{ system: REQ, value: 'R-1' }], requisition: { system: REQ, value: 'R-1' },
        requester: { reference: '#requester', type: 'PractitionerRole' },
        contained: [{ resourceType: 'PractitionerRole', id: 'requester', organization: { identifier: { value: 'FAC-1' } } }],
      },
      { resourceType: 'ServiceRequest', id: 'sr-old', status: 'active', intent: 'order', subject: { display: 'x' }, identifier: [{ value: ' OLD-1 ' }] },
      { resourceType: 'ServiceRequest', id: 'sr-none', status: 'active', intent: 'order', subject: { display: 'x' } },
      { resourceType: 'Patient', id: 'p1', identifier: [{ value: 'R-1' }] },
    ] as never);
    await store.save({ resourceType: 'ServiceRequest', id: 'sr-deleted', status: 'active', intent: 'order', subject: { display: 'x' }, identifier: [{ value: 'D-1' }] } as never);
    await store.delete('ServiceRequest', 'sr-deleted');

    await up(db);
    await up(db);

    const rows = await db.selectFrom('lab_requisitions').select(['service_request_id', 'requisition', 'facility']).orderBy('service_request_id').execute();
    expect(rows).toEqual([
      { service_request_id: 'sr-new', requisition: 'R-1', facility: 'FAC-1' },
      { service_request_id: 'sr-old', requisition: 'OLD-1', facility: null },
    ]);
    await db.destroy();
  });

  it('down drops the table', async () => {
    const db = await makeMigratedDbUpTo('139_lab_requisitions');
    await down(db);
    await expect(db.selectFrom('lab_requisitions').selectAll().execute()).rejects.toThrow();
    await db.destroy();
  });
});
