import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMigratedDbWithMem } from '../migrations/internal/test-helpers';
import { makeMigratedExternalDb } from '../test-helpers-external';
import { createFhirStore } from '../fhir-store';
import { createRelationalWriter } from '../relational-writer';
import { createProjectionRunner, type FetchSafeRows } from './cycle';
import { readCursor } from './cursor';

const logger = { info() {}, error() {}, warn() {}, debug() {} };
afterEach(() => vi.useRealTimers());

async function fixture() {
  const { db: internalDb, mem } = await makeMigratedDbWithMem();
  const externalDb = await makeMigratedExternalDb();
  const fhirStore = createFhirStore(internalDb as never);
  const writer = createRelationalWriter(externalDb as never, 'postgres');
  const fetch: FetchSafeRows = async (_db, cursor) => ({
    rows: ['bad', 'good'].map((id, i) => ({ seq: i + 1, xid: 1, resource_type: 'Patient', resource_id: id, op: 'upsert' })).filter(r => r.seq > cursor),
    boundary: 100, xmax: 200,
  });
  for (const id of ['bad', 'good']) await fhirStore.save({ resourceType: 'Patient', id } as never);
  return { internalDb, externalDb, fhirStore, writer, fetch, mem };
}

describe('durable projection retries', () => {
  it('recovers after restart without another change and reads the newest canonical resource', async () => {
    const f = await fixture();
    try {
      const deps = { ...f, internalDb: f.internalDb as never, relationalWriter: { ...f.writer, write: async () => { throw new Error('offline'); } }, logger };
      await createProjectionRunner(deps).runCycle();
      expect(await readCursor(f.internalDb as never, 'projection')).toBe(2);
      await f.fhirStore.save({ resourceType: 'Patient', id: 'bad', name: [{ family: 'Latest' }] } as never);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 3_600_000);
      await createProjectionRunner({ ...deps, relationalWriter: f.writer }).runCycle();
      const rows = await f.externalDb.selectFrom('patients').selectAll().execute();
      expect(rows).toHaveLength(2);
      expect(rows.find(r => r.id === 'bad')?.surname).toBe('Latest');
      expect(await f.internalDb.selectFrom('fhir.projection_retries').selectAll().execute()).toHaveLength(0);
    } finally { await f.internalDb.destroy(); await f.externalDb.destroy(); }
  });

  it('backs off poison resources while projecting later valid resources', async () => {
    const f = await fixture();
    try {
      const relationalWriter = { ...f.writer, write: async (...args: Parameters<typeof f.writer.write>) => {
        if ((args[0] as { id?: string }).id === 'bad') throw new Error('poison');
        return f.writer.write(...args);
      } };
      const runner = createProjectionRunner({ ...f, internalDb: f.internalDb as never, relationalWriter, logger });
      await runner.runCycle();
      await runner.runCycle();
      expect(await f.externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(1);
      const [retry] = await f.internalDb.selectFrom('fhir.projection_retries').selectAll().execute();
      expect(retry.attempts).toBe(1);
      expect(new Date(retry.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    } finally { await f.internalDb.destroy(); await f.externalDb.destroy(); }
  });
});


it('retains ledger failures and repairs them idempotently', async () => {
  const f = await fixture();
  try {
    await f.fhirStore.save({ resourceType: 'ServiceRequest', id: 'request' } as never);
    const fetch: FetchSafeRows = async (_db, cursor) => ({ rows: cursor ? [] : [
      { seq: 1, xid: 1, resource_type: 'ServiceRequest', resource_id: 'request', op: 'upsert' },
    ], boundary: 100, xmax: 200 });
    const deps = { ...f, internalDb: f.internalDb as never, fetch, logger };
    await createProjectionRunner({ ...deps, relationalWriter: { ...f.writer, writeIngestEvents: async () => { throw new Error('ledger offline'); } } }).runCycle();
    expect(await f.internalDb.selectFrom('fhir.projection_retries').selectAll().execute()).toHaveLength(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3_600_000);
    const runner = createProjectionRunner({ ...deps, relationalWriter: f.writer });
    await runner.runCycle();
    await runner.runCycle();
    expect(await f.externalDb.selectFrom('ingest_events').selectAll().execute()).toHaveLength(1);
    expect(await f.internalDb.selectFrom('fhir.projection_retries').selectAll().execute()).toHaveLength(0);
  } finally { await f.internalDb.destroy(); await f.externalDb.destroy(); }
});

it('keeps the cursor when retry persistence fails', async () => {
  const f = await fixture();
  try {
    f.mem.public.interceptQueries(query => {
      if (query.startsWith('insert into') && query.includes('projection_retries')) throw new Error('retry storage offline');
      return null;
    });
    const runner = createProjectionRunner({ ...f, internalDb: f.internalDb as never,
      relationalWriter: { ...f.writer, write: async () => { throw new Error('offline'); } }, logger });
    await expect(runner.runCycle()).rejects.toThrow('retry storage offline');
    expect(await readCursor(f.internalDb as never, 'projection')).toBe(0);
  } finally { await f.internalDb.destroy(); await f.externalDb.destroy(); }
});

it('retries a deletion against current canonical state', async () => {
  const f = await fixture();
  try {
    await f.writer.write({ resourceType: 'Patient', id: 'bad' }, {});
    await f.fhirStore.delete('Patient', 'bad');
    const deps = { ...f, internalDb: f.internalDb as never, logger };
    await createProjectionRunner({ ...deps, relationalWriter: { ...f.writer, deleteById: async () => { throw new Error('delete offline'); } } }).runCycle();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3_600_000);
    await createProjectionRunner({ ...deps, relationalWriter: f.writer }).runCycle();
    expect(await f.externalDb.selectFrom('patients').select('id').execute()).toEqual([{ id: 'good' }]);
    expect(await f.internalDb.selectFrom('fhir.projection_retries').selectAll().execute()).toHaveLength(0);
  } finally { await f.internalDb.destroy(); await f.externalDb.destroy(); }
});

it('limits retries per cycle and eventually visits the remaining backlog', async () => {
  const f = await fixture();
  try {
    await f.internalDb.insertInto('fhir.projection_retries').values(Array.from({ length: 105 }, (_, i) => ({
      resource_type: 'Patient', resource_id: `retry-${i}`, attempts: 1, next_attempt_at: new Date(0),
    }))).execute();
    const deps = { ...f, internalDb: f.internalDb as never, relationalWriter: f.writer, logger };
    await createProjectionRunner(deps).runCycle();
    expect(await f.internalDb.selectFrom('fhir.projection_retries').selectAll().execute()).toHaveLength(5);
    expect(await f.externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(2);
    await createProjectionRunner(deps).runCycle();
    expect(await f.internalDb.selectFrom('fhir.projection_retries').selectAll().execute()).toHaveLength(0);
  } finally { await f.internalDb.destroy(); await f.externalDb.destroy(); }
});

it('caps repeated failure backoff at five minutes without dropping the retry', async () => {
  const f = await fixture();
  try {
    vi.useFakeTimers({ toFake: ['Date'] });
    const runner = createProjectionRunner({ ...f, internalDb: f.internalDb as never,
      relationalWriter: { ...f.writer, write: async () => { throw new Error('still offline'); } }, logger });
    for (let i = 0; i < 12; i++) {
      await runner.runCycle();
      const rows = await f.internalDb.selectFrom('fhir.projection_retries').selectAll().execute();
      expect(rows).toHaveLength(2);
      const delay = new Date(rows[0].next_attempt_at).getTime() - Date.now();
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(300_000);
      if (i === 11) expect(delay).toBe(300_000);
      vi.setSystemTime(Date.now() + 360_000);
    }
  } finally { await f.internalDb.destroy(); await f.externalDb.destroy(); }
});
