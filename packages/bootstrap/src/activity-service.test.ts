import { describe, it, expect } from 'vitest';
import { createActivityService } from './activity-service';

const runs = [
  { id: 'r1', workflowId: 'w', triggerSource: 'webhook', status: 'completed', startedAt: '2026-07-03T10:00:00Z',
    finishedAt: '2026-07-03T10:00:01Z', error: null, correlationId: 'A',
    result: { results: [{ nodeId: 'persist', nodeType: 'persist-store', status: 'success', meta: { batchId: 'A' } }] } },
];
const deps = {
  runs: { listByCorrelation: async (id: string) => runs.filter((r) => r.correlationId === id),
          listCorrelations: async () => [{ correlationId: 'A', latestAt: '2026-07-03T10:00:00Z', latestStatus: 'completed', workflowId: 'w' }] },
  batches: { get: async () => null },
  persistedEvent: async (_id: string) => ({ at: '2026-07-03T10:00:02Z', count: 1, resourceTypes: ['ServiceRequest'] }),
};

it('assembles a lifecycle for a correlation id', async () => {
  const svc = createActivityService(deps as any);
  const lc = await svc.getLifecycle('A');
  expect(lc?.status).toBe('complete');
  expect(lc?.stages.some((s) => s.stage === 'persisted')).toBe(true);
});

it('lists recent payloads', async () => {
  const svc = createActivityService(deps as any);
  const list = await svc.listRecent({ limit: 10, offset: 0 });
  expect(list[0].correlationId).toBe('A');
  expect(list[0].currentStage).toBe('persisted');
});

// Import runs (import-run.ts) save records without a workflow run, so they would never show here.
// Layer proven: the merge and the mapping, with fake sources. Not proven: the real stores.
const importRun = (over: Record<string, unknown> = {}) => ({
  id: 'imp-1', pluginId: 'openldr-v1-import', pluginVersion: '0.1.0', status: 'completed', dryRun: false,
  counts: { keys: 20000, imported: 19998, failed: 2, resources: 286000 },
  startedAt: '2026-07-03T12:00:00Z', updatedAt: '2026-07-03T12:20:00Z', finishedAt: '2026-07-03T12:20:00Z', startedBy: 'admin',
  ...over,
});

it('lists a finished import run as one entry, newest first among the payloads', async () => {
  const svc = createActivityService({ ...deps, importRuns: async () => [importRun()] } as any);
  const list = await svc.listRecent({ limit: 10, offset: 0 });
  expect(list.map((p) => p.correlationId)).toEqual(['imp-1', 'A']);
  expect(list[0]).toEqual({
    correlationId: 'imp-1', workflowId: 'import:openldr-v1-import', source: 'import: openldr-v1-import',
    startedAt: '2026-07-03T12:00:00Z', currentStage: 'persisted', status: 'complete',
  });
});

it('leaves dry runs out, because they save nothing', async () => {
  const svc = createActivityService({ ...deps, importRuns: async () => [importRun({ id: 'dry', dryRun: true })] } as any);
  expect((await svc.listRecent({ limit: 10, offset: 0 })).map((p) => p.correlationId)).toEqual(['A']);
  expect(await svc.getLifecycle('dry')).toBeNull();
});

it('names an import that is running, stopped or failed as what it is, not as stuck', async () => {
  const status = async (run: Record<string, unknown>) => {
    const svc = createActivityService({ ...deps, importRuns: async () => [importRun(run)] } as any);
    const row = (await svc.listRecent({ limit: 10, offset: 0 })).find((p) => p.correlationId === 'imp-1');
    return `${row?.status}/${row?.currentStage}`;
  };
  expect(await status({ status: 'running', counts: { keys: 0, imported: 0, failed: 0, resources: 0 }, finishedAt: null })).toBe('running/received');
  expect(await status({ status: 'stopping', finishedAt: null })).toBe('running/persisted');
  expect(await status({ status: 'stopped' })).toBe('stopped/persisted');
  expect(await status({ status: 'interrupted', finishedAt: null })).toBe('stopped/persisted');
  expect(await status({ status: 'failed' })).toBe('failed/persisted');
});

it('gives an import run a lifecycle with who started it and what it saved', async () => {
  const svc = createActivityService({ ...deps, importRuns: async () => [importRun()] } as any);
  expect(await svc.getLifecycle('imp-1')).toEqual({
    correlationId: 'imp-1', status: 'complete', runIds: [],
    stages: [
      { stage: 'received', status: 'ok', at: '2026-07-03T12:00:00Z', detail: 'import: openldr-v1-import 0.1.0, started by admin' },
      { stage: 'persisted', status: 'ok', at: '2026-07-03T12:20:00Z', detail: '19998 imported, 2 failed, 286000 resources' },
    ],
  });
  const failed = await createActivityService({ ...deps, importRuns: async () => [importRun({ status: 'failed', finishedAt: null })] } as any).getLifecycle('imp-1');
  expect(failed?.status).toBe('failed');
  // A run that has not finished is dated by its last saved page.
  expect(failed?.stages[1]).toMatchObject({ stage: 'persisted', status: 'failed', at: '2026-07-03T12:20:00Z' });
});

it('pages over payloads and import runs together', async () => {
  const heads = ['2026-07-03T09:00:00Z', '2026-07-03T11:00:00Z', '2026-07-03T13:00:00Z'].map((at, i) => ({ correlationId: `W${i}`, latestAt: at, latestStatus: 'completed', workflowId: 'w' }));
  const asked: unknown[] = [];
  const svc = createActivityService({
    runs: {
      listByCorrelation: async () => [],
      listCorrelations: async (opts: unknown) => { asked.push(opts); return [...heads].reverse(); },
    },
    batches: { get: async () => ({ created_at: '2026-07-03T09:00:00Z', source: 'webhook', status: 'done' }) },
    persistedEvent: async () => null,
    importRuns: async () => [importRun()],
  } as any);
  // Newest first: W2 (13:00), imp-1 (12:00), W1 (11:00), W0 (09:00).
  expect((await svc.listRecent({ limit: 2, offset: 0 })).map((p) => p.correlationId)).toEqual(['W2', 'imp-1']);
  expect((await svc.listRecent({ limit: 2, offset: 2 })).map((p) => p.correlationId)).toEqual(['W1', 'W0']);
  // The store is asked for enough rows to cover the page after merging.
  expect(asked).toEqual([{ limit: 2, offset: 0 }, { limit: 4, offset: 0 }]);
});

it('still lists payloads when the import runs cannot be read', async () => {
  const svc = createActivityService({ ...deps, importRuns: async () => { throw new Error('gone'); } } as any);
  expect((await svc.listRecent({ limit: 10, offset: 0 })).map((p) => p.correlationId)).toEqual(['A']);
});


// Bug 14: `openldr ingest` saves a batch directly (ingest-context.ts handleIngestEvent) and starts no
// workflow run, so a lab that loads from the CLI saw nothing in Activity. Layer proven: the merge
// and the mapping, with fake sources. Not proven: the real batch store.
const batch = (over: Record<string, unknown> = {}) => ({
  batch_id: 'b-1', source: 'cli', converter: 'fhir-bundle', status: 'done', resource_count: 42,
  last_error: null, created_at: new Date('2026-07-03T11:00:00Z'), ...over,
});
const withBatches = (rows: ReturnType<typeof batch>[], extra: Record<string, unknown> = {}) => createActivityService({
  ...deps,
  batches: { get: async (id: string) => rows.find((b) => b.batch_id === id) ?? null },
  ingestBatches: async () => rows,
  ...extra,
} as any);

describe('batches loaded from the CLI', () => {
  it('lists a CLI batch beside the payloads, newest first', async () => {
    const list = await withBatches([batch()]).listRecent({ limit: 10, offset: 0 });
    expect(list.map((r) => r.correlationId)).toEqual(['b-1', 'A']);
    expect(list[0]).toMatchObject({ workflowId: 'ingest:fhir-bundle', source: 'cli', currentStage: 'persisted', status: 'complete' });
  });

  it('names a failed batch failed, with its error, and a waiting one running', async () => {
    const svc = withBatches([batch({ batch_id: 'bad', status: 'failed', resource_count: 0, last_error: 'no converter' }), batch({ batch_id: 'wait', status: 'processing' })]);
    const failed = await svc.getLifecycle('bad');
    expect(failed?.status).toBe('failed');
    expect(failed?.stages.at(-1)).toMatchObject({ stage: 'persisted', status: 'failed', detail: 'no converter' });
    expect((await svc.getLifecycle('wait'))?.status).toBe('running');
  });

  it('gives a finished batch a lifecycle with its source and what it saved', async () => {
    const lc = await withBatches([batch()]).getLifecycle('b-1');
    expect(lc?.status).toBe('complete');
    expect(lc?.stages.map((s) => s.stage)).toEqual(['received', 'persisted']);
    expect(lc?.stages[1]?.detail).toBe('42 resources');
  });

  it('shows a batch once when a workflow run shares its id', async () => {
    const list = await withBatches([batch({ batch_id: 'A' })]).listRecent({ limit: 10, offset: 0 });
    expect(list.map((r) => r.correlationId)).toEqual(['A']);
  });

  it('pages over payloads, import runs and batches together', async () => {
    const svc = withBatches([batch()], { importRuns: async () => [importRun()] });
    expect((await svc.listRecent({ limit: 2, offset: 0 })).map((r) => r.correlationId)).toEqual(['imp-1', 'b-1']);
    expect((await svc.listRecent({ limit: 2, offset: 2 })).map((r) => r.correlationId)).toEqual(['A']);
  });

  it('still lists payloads when the batches cannot be read', async () => {
    const svc = withBatches([], { ingestBatches: async () => { throw new Error('gone'); } });
    expect((await svc.listRecent({ limit: 10, offset: 0 })).map((r) => r.correlationId)).toEqual(['A']);
  });
});
