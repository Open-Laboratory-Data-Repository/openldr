import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import { createFhirStore, createProjectionRunner, createRelationalWriter, findByRequisition, type FetchSafeRows } from '@openldr/db';
import { withRequisitionIndex } from './lab-requisition-hooks';

const silent = { info() {}, error() {}, warn() {}, debug() {} };

function order(id: string, number: string) {
  return {
    resourceType: 'ServiceRequest', id, status: 'active', intent: 'order', subject: { display: 'x' },
    identifier: [{ value: number }], requisition: { value: number },
    requester: { reference: '#requester', type: 'PractitionerRole' },
    contained: [{ resourceType: 'PractitionerRole', id: 'requester', organization: { identifier: { value: 'FAC-1' } } }],
  };
}

const rowsFor = (ids: Array<[string, string]>): Awaited<ReturnType<FetchSafeRows>>['rows'] =>
  ids.map(([type, id], i) => ({ seq: i + 1, xid: 1, resource_type: type, resource_id: id, op: 'upsert' as const }));

async function world() {
  delete process.env.OPENLDR_SITE_ID;
  const internalDb = await makeMigratedDb();
  const externalDb = await makeMigratedExternalDb();
  const fhirStore = createFhirStore(internalDb as never);
  return { internalDb, externalDb, fhirStore, relationalWriter: createRelationalWriter(externalDb as never, 'postgres') };
}

describe('withRequisitionIndex', () => {
  it('indexes a request projected in bulk and still runs the inner batch hook', async () => {
    const w = await world();
    await w.fhirStore.saveMany([order('sr-1', 'R-1'), order('sr-2', 'R-1'), { resourceType: 'Patient', id: 'p1' }] as never);
    const inner: string[] = [];
    const hooks = withRequisitionIndex({ internalDb: w.internalDb as never, logger: silent }, {
      onProjected: async () => {},
      onProjectedMany: async (items) => { inner.push(...items.map((it) => it.resource.id as string)); },
    });
    await createProjectionRunner({
      internalDb: w.internalDb as never, fhirStore: w.fhirStore, relationalWriter: w.relationalWriter, logger: silent,
      fetch: async () => ({ rows: rowsFor([['ServiceRequest', 'sr-1'], ['ServiceRequest', 'sr-2'], ['Patient', 'p1']]), boundary: 100, xmax: 200 }),
      ...hooks,
    }).runCycle();
    expect(await findByRequisition(w.internalDb as never, 'R-1')).toEqual([
      { serviceRequestId: 'sr-1', facility: 'FAC-1' },
      { serviceRequestId: 'sr-2', facility: 'FAC-1' },
    ]);
    expect(inner.sort()).toEqual(['p1', 'sr-1', 'sr-2']);
    await w.internalDb.destroy(); await w.externalDb.destroy();
  });

  it('indexes a request projected alone and still runs the inner record hook', async () => {
    const w = await world();
    await w.fhirStore.save(order('sr-1', ' R-7 ') as never);
    const inner: string[] = [];
    const hooks = withRequisitionIndex({ internalDb: w.internalDb as never, logger: silent }, {
      onProjected: async (_t, r) => { inner.push(r.id as string); },
      onProjectedMany: async () => {},
    });
    // A writer whose bulk path fails sends every record down the one-at-a-time path.
    const relationalWriter = { ...w.relationalWriter, atomically: undefined, writeMany: async () => { throw new Error('bulk refused'); } };
    await createProjectionRunner({
      internalDb: w.internalDb as never, fhirStore: w.fhirStore, relationalWriter: relationalWriter as never, logger: silent,
      fetch: async () => ({ rows: rowsFor([['ServiceRequest', 'sr-1']]), boundary: 100, xmax: 200 }),
      ...hooks,
    }).runCycle();
    expect(await findByRequisition(w.internalDb as never, 'R-7')).toEqual([{ serviceRequestId: 'sr-1', facility: 'FAC-1' }]);
    expect(inner).toEqual(['sr-1']);
    await w.internalDb.destroy(); await w.externalDb.destroy();
  });

  it('logs an index failure and still runs the inner hooks', async () => {
    const w = await world();
    const errors: string[] = [];
    const logger = { ...silent, error: (_o: unknown, m?: string) => { errors.push(m ?? ''); } };
    await w.internalDb.schema.dropTable('lab_requisitions').execute();
    const inner: string[] = [];
    const hooks = withRequisitionIndex({ internalDb: w.internalDb as never, logger }, {
      onProjected: async (_t, r) => { inner.push(`one ${r.id as string}`); },
      onProjectedMany: async (items) => { inner.push(`many ${items.length}`); },
    });
    await hooks.onProjected('ServiceRequest', order('sr-1', 'R-1'), {});
    await hooks.onProjectedMany([{ resourceType: 'ServiceRequest', resource: order('sr-2', 'R-2'), provenance: {} }]);
    expect(inner).toEqual(['one sr-1', 'many 1']);
    expect(errors).toHaveLength(2);
    await w.internalDb.destroy(); await w.externalDb.destroy();
  });

  it('does not touch the table for a resource that is not a ServiceRequest', async () => {
    const w = await world();
    const hooks = withRequisitionIndex({ internalDb: w.internalDb as never, logger: silent }, { onProjected: async () => {}, onProjectedMany: async () => {} });
    await hooks.onProjected('Observation', { resourceType: 'Observation', id: 'o1', identifier: [{ value: 'R-1' }] }, {});
    expect(await w.internalDb.selectFrom('lab_requisitions').selectAll().execute()).toEqual([]);
    await w.internalDb.destroy(); await w.externalDb.destroy();
  });
});
