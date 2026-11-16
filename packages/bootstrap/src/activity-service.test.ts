import { describe, it, expect } from 'vitest';
import { checkForActivity, copyForActivity, createActivityService } from './activity-service';

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

it('names an import that is waiting for its source as running', async () => {
  const svc = createActivityService({ ...deps, importRuns: async () => [importRun({ status: 'waiting', finishedAt: null })] } as any);
  expect((await svc.listRecent({ limit: 10, offset: 0 })).find((p) => p.correlationId === 'imp-1')?.status).toBe('running');
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

// A copy (import-copy.ts) stores source rows on CE's own disk and starts no workflow run.
// Layer proven: the mapping of a copy run to Activity's shape, and the merge, with fake sources.
// Not proven: the real copy service or the context wiring in index.ts.
const SECRET_KEY = 'REQ-SECRET-0042';
const copyRun = (over: Record<string, unknown> = {}) => ({
  id: 'cp-1', kind: 'copy', rev: 9, pluginId: 'openldr-v1-import', pluginVersion: '0.2.0', connectorId: 'c1', status: 'completed',
  options: {}, pageSize: 500,
  sets: {
    requests: { cursor: SECRET_KEY, keys: 900, rows: 2500, bytes: 99000, skipped: 2, done: true },
    facilities: { cursor: SECRET_KEY, keys: 40, rows: 40, bytes: 1200, skipped: 1, done: true },
  },
  setOrder: ['requests', 'facilities'], setSql: {}, waiting: null, driver: 'proc-1',
  startedAt: '2026-07-03T12:30:00Z', updatedAt: '2026-07-03T13:00:00Z', finishedAt: '2026-07-03T13:00:00Z', lastError: null, startedBy: 'amina',
  ...over,
});

describe('copies', () => {
  const withCopies = (runs: ReturnType<typeof copyRun>[]) =>
    createActivityService({ ...deps, importCopies: async () => runs.map((r) => copyForActivity(r as any)) } as any);

  it('Activity lists a copy run with its rows and its state', async () => {
    const svc = withCopies([copyRun()]);
    const list = await svc.listRecent({ limit: 10, offset: 0 });
    expect(list.map((p) => p.correlationId)).toEqual(['cp-1', 'A']);
    expect(list[0]).toEqual({
      correlationId: 'cp-1', workflowId: 'copy:openldr-v1-import', source: 'copy: openldr-v1-import',
      startedAt: '2026-07-03T12:30:00Z', currentStage: 'persisted', status: 'complete',
    });
    expect(await svc.getLifecycle('cp-1')).toEqual({
      correlationId: 'cp-1', status: 'complete', runIds: [],
      stages: [
        { stage: 'received', status: 'ok', at: '2026-07-03T12:30:00Z', detail: 'copy: openldr-v1-import 0.2.0, started by amina' },
        { stage: 'persisted', status: 'ok', at: '2026-07-03T13:00:00Z', detail: '2540 rows copied, 3 keys skipped' },
      ],
    });
  });

  it('names each copy status as complete, failed, stopped or running', async () => {
    const status = async (s: string) => (await withCopies([copyRun({ status: s, finishedAt: null })]).getLifecycle('cp-1'))?.status;
    expect(await status('completed')).toBe('complete');
    expect(await status('failed')).toBe('failed');
    expect(await status('stopped')).toBe('stopped');
    for (const s of ['queued', 'running', 'waiting', 'stopping', 'deleting']) expect(await status(s)).toBe('running');
    // A failed copy marks its rows stage failed, dated by its last save.
    const failed = await withCopies([copyRun({ status: 'failed', finishedAt: null })]).getLifecycle('cp-1');
    expect(failed?.stages[1]).toMatchObject({ stage: 'persisted', status: 'failed', at: '2026-07-03T13:00:00Z' });
    // A queued copy has copied nothing yet.
    const zero = { cursor: null, keys: 0, rows: 0, bytes: 0, skipped: 0, done: false };
    const queued = await withCopies([copyRun({ status: 'queued', finishedAt: null, sets: { requests: zero } })]).getLifecycle('cp-1');
    expect(queued?.stages.map((s) => s.stage)).toEqual(['received']);
  });

  it('keeps counts and states only, never a cursor', async () => {
    const shown = copyForActivity(copyRun() as any);
    expect(shown).toEqual({
      id: 'cp-1', pluginId: 'openldr-v1-import', pluginVersion: '0.2.0', status: 'completed', rows: 2540, skipped: 3,
      startedAt: '2026-07-03T12:30:00Z', updatedAt: '2026-07-03T13:00:00Z', finishedAt: '2026-07-03T13:00:00Z', startedBy: 'amina',
    });
    const svc = withCopies([copyRun()]);
    const text = JSON.stringify([await svc.listRecent({ limit: 10, offset: 0 }), await svc.getLifecycle('cp-1')]);
    expect(text).not.toContain(SECRET_KEY);
  });

  it('pages over payloads, import runs and copies together, and lists payloads when copies cannot be read', async () => {
    const svc = createActivityService({ ...deps, importRuns: async () => [importRun()], importCopies: async () => [copyForActivity(copyRun() as any)] } as any);
    // cp-1 (12:30), imp-1 (12:00), A (10:00).
    expect((await svc.listRecent({ limit: 2, offset: 0 })).map((p) => p.correlationId)).toEqual(['cp-1', 'imp-1']);
    expect((await svc.listRecent({ limit: 2, offset: 2 })).map((p) => p.correlationId)).toEqual(['A']);
    const broken = createActivityService({ ...deps, importCopies: async () => { throw new Error('gone'); } } as any);
    expect((await broken.listRecent({ limit: 10, offset: 0 })).map((p) => p.correlationId)).toEqual(['A']);
  });
});

// A check run (import-check.ts) saves records without a workflow run. Layer proven: the mapping of a
// check run to Activity's shape, and the merge, with fake sources. Not proven: the real check
// service or the context wiring in index.ts.
const checkRun = (over: Record<string, unknown> = {}) => ({
  id: 'ck-1', kind: 'check', rev: 4, pluginId: 'openldr-v1-import', pluginVersion: '0.2.0', copyId: 'cp-1', referenceCopyId: null,
  status: 'completed', options: {}, pageSize: 500, cursor: SECRET_KEY,
  counts: { read: 900, saved: 850, held: 40, failed: 10, resources: 6800, labels: { passed: 850, secret_label: 50 } },
  waiting: null, driver: 'proc-1',
  startedAt: '2026-07-03T12:45:00Z', updatedAt: '2026-07-03T13:10:00Z', finishedAt: '2026-07-03T13:10:00Z', lastError: null, startedBy: 'amina',
  ...over,
});

describe('check runs', () => {
  const withChecks = (runs: ReturnType<typeof checkRun>[]) =>
    createActivityService({ ...deps, importChecks: async () => runs.map((r) => checkForActivity(r as any)) } as any);

  it('Activity lists a check run as check:<plugin>, with its counts and its state', async () => {
    const svc = withChecks([checkRun()]);
    const list = await svc.listRecent({ limit: 10, offset: 0 });
    expect(list.map((p) => p.correlationId)).toEqual(['ck-1', 'A']);
    expect(list[0]).toEqual({
      correlationId: 'ck-1', workflowId: 'check:openldr-v1-import', source: 'check: openldr-v1-import',
      startedAt: '2026-07-03T12:45:00Z', currentStage: 'persisted', status: 'complete',
    });
    expect(await svc.getLifecycle('ck-1')).toEqual({
      correlationId: 'ck-1', status: 'complete', runIds: [],
      stages: [
        { stage: 'received', status: 'ok', at: '2026-07-03T12:45:00Z', detail: 'check: openldr-v1-import 0.2.0, started by amina' },
        { stage: 'persisted', status: 'ok', at: '2026-07-03T13:10:00Z', detail: '900 read, 850 saved, 40 held back, 10 failed' },
      ],
    });
  });

  it('the start says whether the check carried on or began at the first request', async () => {
    const detail = async (over: Record<string, unknown>) => (await withChecks([checkRun(over)]).getLifecycle('ck-1'))?.stages[0]?.detail;
    expect(await detail({ carriedOn: true })).toBe('check: openldr-v1-import 0.2.0, started by amina, carried on from where it stopped');
    expect(await detail({ carriedOn: false })).toBe('check: openldr-v1-import 0.2.0, started by amina, from the first request');
    // A run stored before a check could carry on says neither.
    expect(await detail({})).toBe('check: openldr-v1-import 0.2.0, started by amina');
    expect(checkForActivity(checkRun({ carriedOn: true }) as any).carriedOn).toBe(true);
    expect('carriedOn' in checkForActivity(checkRun() as any)).toBe(false);
  });

  it('names each check status, and keeps neither the cursor nor the labels', async () => {
    const status = async (s: string) => (await withChecks([checkRun({ status: s, finishedAt: null })]).getLifecycle('ck-1'))?.status;
    expect(await status('completed')).toBe('complete');
    expect(await status('failed')).toBe('failed');
    expect(await status('stopped')).toBe('stopped');
    for (const s of ['queued', 'running', 'waiting', 'stopping']) expect(await status(s)).toBe('running');
    const queued = await withChecks([checkRun({ status: 'queued', counts: { read: 0, saved: 0, held: 0, failed: 0, resources: 0, labels: {} } })]).getLifecycle('ck-1');
    expect(queued?.stages.map((s) => s.stage)).toEqual(['received']);
    const svc = withChecks([checkRun()]);
    const text = JSON.stringify([checkForActivity(checkRun() as any), await svc.listRecent({ limit: 10, offset: 0 }), await svc.getLifecycle('ck-1')]);
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain('secret_label');
    const broken = createActivityService({ ...deps, importChecks: async () => { throw new Error('gone'); } } as any);
    expect((await broken.listRecent({ limit: 10, offset: 0 })).map((p) => p.correlationId)).toEqual(['A']);
  });
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
