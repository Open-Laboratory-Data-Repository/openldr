import { describe, it, expect, vi } from 'vitest';
import { createWorkflowTriggerRunner, heldSummary, armWorkflowSchedule } from './trigger-runner';
import { runWorkflow } from './engine/run-workflow';

function fakeEventing() {
  const handlers = new Map<string, (e: { type: string; payload: unknown }) => Promise<void>>();
  const published: Array<{ type: string; payload: unknown; availableAt?: Date }> = [];
  return {
    handlers,
    published,
    port: {
      healthCheck: async () => ({ ok: true } as never),
      publish: async (e: never, o?: { availableAt?: Date }) => {
        published.push({ ...(e as object), availableAt: o?.availableAt } as never);
      },
      subscribe: async (t: string, h: never) => {
        handlers.set(t, h as never);
      },
    },
  };
}

const wfWith = (nodes: unknown[], edges: unknown[] = []) => ({
  id: 'w1',
  name: 'W',
  description: null,
  definition: { nodes, edges },
  enabled: true,
  createdBy: null,
});

describe('workflow trigger runner', () => {
  it('on schedule.due: runs the workflow, records it, and re-arms', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([{ id: 't', type: 'trigger', data: {} }]) } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: {
        get: async () => ({
          workflowId: 'w1', nodeId: 's', cron: '0 9 * * *', tz: 'UTC',
          enabled: true, nextDueAt: null,
        }),
        list: async () => [],
        setNextDue: async () => {},
        claimDue: async () => true,
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('workflow.schedule.due')!({
      type: 'workflow.schedule.due',
      payload: { workflowId: 'w1', nodeId: 's' },
    });

    expect(recorded.length).toBe(1);
    expect(ev.published.some((p) => p.type === 'workflow.schedule.due' && p.availableAt instanceof Date)).toBe(true);
  });

  it('skips run when schedule is disabled', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([]) } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: {
        get: async () => ({
          workflowId: 'w1', nodeId: 's', cron: '0 9 * * *', tz: 'UTC',
          enabled: false, nextDueAt: null,
        }),
        list: async () => [],
        setNextDue: async () => {},
        claimDue: async () => true,
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('workflow.schedule.due')!({
      type: 'workflow.schedule.due',
      payload: { workflowId: 'w1', nodeId: 's' },
    });

    expect(recorded.length).toBe(0);
    expect(ev.published.length).toBe(0);
  });

  it('on ingest.batch.done: runs workflows whose trigger set includes ingest', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: {
        get: async () => wfWith([{ id: 'i', type: 'trigger', data: { triggerType: 'ingest' } }]),
      } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: {
        list: async () => [],
        get: async () => undefined,
        setNextDue: async () => {},
        claimDue: async () => true,
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    runner.setIngestWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('ingest.batch.done')!({
      type: 'ingest.batch.done',
      payload: { source: 'whonet', count: 3 },
    });

    expect(recorded.length).toBe(1);
    expect((recorded[0] as { triggerSource: string }).triggerSource).toBe('ingest');
  });

  it('ingest sourceFilter: skips workflows whose filter does not match the batch source', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: {
        get: async () => wfWith([
          { id: 'i', type: 'trigger', data: { triggerType: 'ingest', config: { sourceFilter: 'whonet' } } },
        ]),
      } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: { list: async () => [], get: async () => undefined, setNextDue: async () => {} } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    runner.setIngestWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);

    // Non-matching source → skipped.
    await ev.handlers.get('ingest.batch.done')!({ type: 'ingest.batch.done', payload: { source: 'dhis2', count: 1 } });
    expect(recorded.length).toBe(0);

    // Matching source (case-insensitive) → runs.
    await ev.handlers.get('ingest.batch.done')!({ type: 'ingest.batch.done', payload: { source: 'WHONET', count: 1 } });
    expect(recorded.length).toBe(1);
  });

  it('reconcile arms schedules with no future nextDueAt', async () => {
    const ev = fakeEventing();
    const setNextDueCalls: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([]) } as never,
      runs: { record: async () => {} } as never,
      schedules: {
        list: async () => [
          { workflowId: 'w1', nodeId: 'n1', cron: '0 9 * * *', tz: 'UTC', enabled: true, nextDueAt: null },
        ],
        get: async () => undefined,
        setNextDue: async (...args: unknown[]) => { setNextDueCalls.push(args); },
        claimDue: async () => true,
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    await runner.reconcile(ev.port as never);
    expect(setNextDueCalls.length).toBe(1);
    expect(ev.published.some((p) => p.type === 'workflow.schedule.due')).toBe(true);
  });

  it('reconcile skips schedules already armed in the future', async () => {
    const ev = fakeEventing();
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([]) } as never,
      runs: { record: async () => {} } as never,
      schedules: {
        list: async () => [
          { workflowId: 'w1', nodeId: 'n1', cron: '0 9 * * *', tz: 'UTC', enabled: true, nextDueAt: futureDate },
        ],
        get: async () => undefined,
        setNextDue: async () => {},
        claimDue: async () => true,
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    await runner.reconcile(ev.port as never);
    expect(ev.published.length).toBe(0);
  });

  it('ingest event with a blob ref runs the workflow with a file on the trigger', async () => {
    const ev = fakeEventing();
    const runWorkflowSpy = vi.fn().mockResolvedValue({
      status: 'completed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      results: [],
    });
    const runner = createWorkflowTriggerRunner({
      store: {
        get: async () => wfWith([{ id: 'i', type: 'trigger', data: { triggerType: 'ingest' } }]),
      } as never,
      runs: { record: async () => {} } as never,
      schedules: {
        list: async () => [],
        get: async () => undefined,
        setNextDue: async () => {},
        claimDue: async () => true,
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow: runWorkflowSpy as never,
      logger: { error: () => {}, warn: () => {} },
    });

    runner.setIngestWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('ingest.batch.done')!({
      type: 'ingest.batch.done',
      payload: { source: 'WHONET', count: 1, blobKey: 'ingest/b1/whonet.sqlite', byteSize: 10 },
    });

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        files: {
          file: expect.objectContaining({
            objectKey: 'ingest/b1/whonet.sqlite',
            byteSize: 10,
          }),
        },
      }),
    );
  });
});

const eventRunner = (nodes: unknown[], recorded: unknown[]) =>
  createWorkflowTriggerRunner({
    store: { get: async () => wfWith(nodes) } as never,
    runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
    schedules: { list: async () => [], get: async () => undefined, setNextDue: async () => {} } as never,
    webhooks: { resolve: () => undefined } as never,
    runWorkflow,
    logger: { error: () => {}, warn: () => {} },
  });

const fireDataPersisted = async (ev: ReturnType<typeof fakeEventing>, payload: unknown) =>
  ev.handlers.get('data.persisted')!({ type: 'data.persisted', payload });

describe('a queued scheduled run', () => {
  function build(rows: Array<{ workflowId: string; nodeId: string; cron: string; tz: string; enabled: boolean; nextDueAt: string | null }>, claim: (dueAt: string | null) => boolean = () => true) {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const claims: Array<string | null> = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([{ id: 't', type: 'trigger', data: {} }]) } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: {
        get: async (w: string, n: string) => rows.find((r) => r.workflowId === w && r.nodeId === n),
        list: async () => rows,
        setNextDue: async (w: string, n: string, at: string) => { const r = rows.find((x) => x.workflowId === w && x.nodeId === n); if (r) r.nextDueAt = at; },
        claimDue: async (_w: string, _n: string, dueAt: string | null) => { claims.push(dueAt); return claim(dueAt); },
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });
    return { ev, recorded, claims, runner, rows };
  }
  const row = () => ({ workflowId: 'w1', nodeId: 's', cron: '*/5 * * * *', tz: 'UTC', enabled: true, nextDueAt: null as string | null });

  it('a queued run claims its time before it starts the workflow', async () => {
    const { ev, runner, recorded, claims } = build([{ ...row(), nextDueAt: '2026-01-01T10:00:00.000Z' }]);
    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('workflow.schedule.due')!({ type: 'workflow.schedule.due', payload: { workflowId: 'w1', nodeId: 's', dueAt: '2026-01-01T10:00:00.000Z' } });
    expect(claims).toEqual(['2026-01-01T10:00:00.000Z']);
    expect(recorded).toHaveLength(1);
  });

  it('a queued run that loses the claim neither runs nor queues another', async () => {
    const { ev, runner, recorded } = build([{ ...row(), nextDueAt: '2026-01-01T10:05:00.000Z' }], () => false);
    await runner.registerRunner(ev.port as never);
    // Left over from before an edit: it names a time the schedule is no longer armed for.
    await ev.handlers.get('workflow.schedule.due')!({ type: 'workflow.schedule.due', payload: { workflowId: 'w1', nodeId: 's', dueAt: '2026-01-01T10:00:00.000Z' } });
    expect(recorded).toHaveLength(0);
    expect(ev.published).toHaveLength(0);
  });

  it('a run that throws still queues the next one: the claimed time is gone, so nothing else would', async () => {
    const ev = fakeEventing();
    const rows = [{ ...row(), nextDueAt: '2026-01-01T10:00:00.000Z' as string | null }];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => { throw new Error('database is away'); } } as never,
      runs: { record: async () => {} } as never,
      schedules: {
        get: async () => rows[0], list: async () => rows,
        setNextDue: async (_w: string, _n: string, at: string) => { rows[0].nextDueAt = at; },
        claimDue: async () => { rows[0].nextDueAt = null; return true; },
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });
    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('workflow.schedule.due')!({ type: 'workflow.schedule.due', payload: { workflowId: 'w1', nodeId: 's', dueAt: '2026-01-01T10:00:00.000Z' } }).catch(() => {});
    expect(ev.published.filter((p) => p.type === 'workflow.schedule.due')).toHaveLength(1);
    expect(rows[0].nextDueAt).not.toBeNull();
  });

  it('a run queued by an older version names no time, and claims with none', async () => {
    const { ev, runner, recorded, claims } = build([{ ...row(), nextDueAt: '2026-01-01T10:00:00.000Z' }]);
    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('workflow.schedule.due')!({ type: 'workflow.schedule.due', payload: { workflowId: 'w1', nodeId: 's' } });
    expect(claims).toEqual([null]);
    expect(recorded).toHaveLength(1);
  });
});

describe('event trigger (data.persisted)', () => {
  it('runs an event-trigger workflow when source + resourceType filters match', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = eventRunner(
      [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: { source: 'demo-lab', resourceType: 'Observation' } } }],
      recorded,
    );
    runner.setEventWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await fireDataPersisted(ev, { source: 'demo-lab', resourceTypes: ['Observation'], count: 1 });
    expect(recorded.length).toBe(1);
    expect((recorded[0] as { triggerSource: string }).triggerSource).toBe('event');
  });

  it('skips when the source filter does not match', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = eventRunner(
      [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: { source: 'other' } } }],
      recorded,
    );
    runner.setEventWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await fireDataPersisted(ev, { source: 'demo-lab', resourceTypes: ['Observation'], count: 1 });
    expect(recorded.length).toBe(0);
  });

  it('skips when the resourceType filter is not among the event resource types', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = eventRunner(
      [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: { resourceType: 'ServiceRequest' } } }],
      recorded,
    );
    runner.setEventWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await fireDataPersisted(ev, { source: 'demo-lab', resourceTypes: ['Observation'], count: 1 });
    expect(recorded.length).toBe(0);
  });

  it('empty filters match any data.persisted event', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = eventRunner(
      [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: {} } }],
      recorded,
    );
    runner.setEventWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await fireDataPersisted(ev, { source: 'anything', resourceTypes: ['Patient'], count: 9 });
    expect(recorded.length).toBe(1);
  });
});

// A run can persist and THEN fail: the Persist Store node succeeds, a later node throws. The
// caller must be able to tell that apart from "nothing happened" — a clerk told only "failed"
// resubmits, and the ingest path mints fresh resource ids per submission, so the retry writes a
// duplicate clinical record. Each node's `meta` is already computed; runAndRecord now returns it.
describe('runAndRecord — nodeMeta', () => {
  function metaRunner(recorded: unknown[]) {
    return createWorkflowTriggerRunner({
      store: {
        get: async () => wfWith(
          [
            { id: 't', type: 'trigger', data: {} },
            { id: 'p', type: 'action', data: { action: 'persist-store', config: { source: 's' } } },
            // Fails for certain: form-validate throws when its service is not injected, and only
            // persistStore is. Stands in for the real post-persist failures (Log node, the
            // data.persisted publish, the run-store insert).
            { id: 'boom', type: 'action', data: { action: 'form-validate', config: { formId: 'f1' } } },
          ],
          [{ id: 'e0', source: 't', target: 'p' }, { id: 'e1', source: 'p', target: 'boom' }],
        ),
      } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: { get: async () => null, list: async () => [], setNextDue: async () => {} } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
      codeLimits: { enabled: true, timeoutMs: 1000, memoryMb: 16 },
      services: {
        persistStore: async ({ items }: { items: unknown[] }) => ({
          items,
          meta: { persisted: items.length, flattened: { written: items.length, skipped: 0, degraded: 0 }, resourceTypes: ['Observation'] },
        }),
      } as never,
    });
  }

  it('surfaces the persist node meta on a run that stored and then failed', async () => {
    const recorded: unknown[] = [];
    const outcome = await metaRunner(recorded).runAndRecord('w1', 'form', { body: [{ resourceType: 'Observation' }] });

    expect(outcome).not.toBeNull();
    expect(outcome!.status).toBe('failed');
    expect((outcome!.nodeMeta.p as { persisted: number }).persisted).toBe(1);
  });

  it('returns an empty nodeMeta when no node reported any', async () => {
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([{ id: 't', type: 'trigger', data: {} }]) } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: { get: async () => null, list: async () => [], setNextDue: async () => {} } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    const outcome = await runner.runAndRecord('w1', 'form', {});
    expect(outcome!.nodeMeta).toEqual({});
  });
});

it('builds a run using the reserved identity without recording it', async () => {
  const { executeWorkflowRun } = await import('./trigger-runner');
  const run = await executeWorkflowRun({ runWorkflow }, { nodes: [{ id: 't', type: 'trigger', data: {} }], edges: [] }, { id: 'reserved', workflowId: 'w', source: 'webhook', input: { test: true } });
  expect(run).toMatchObject({ id: 'reserved', workflowId: 'w', triggerSource: 'webhook', status: 'completed' });
});

describe('heldSummary', () => {
  it('adds up held items across Map to FHIR steps and keeps the first reasons', () => {
    const metas = [
      { mapped: 3, held: 2, heldReasons: ['no mapping for this shape', 'not a row'] },
      { batchId: 'b1', persisted: 3 },
      { mapped: 0, held: 5, heldReasons: ['a', 'b', 'c', 'd', 'e'] },
    ];
    expect(heldSummary(metas)).toEqual({ count: 7, reasons: ['no mapping for this shape', 'not a row', 'a', 'b', 'c'] });
  });

  it('is undefined when nothing was held', () => {
    expect(heldSummary([{ mapped: 2, held: 0, heldReasons: [] }, { batchId: 'b', persisted: 2 }, undefined])).toBeUndefined();
  });
});

describe('armWorkflowSchedule', () => {
  const row = { workflowId: 'w1', nodeId: 's', cron: '*/5 * * * *', tz: 'UTC' };

  it('stores the next time and queues a run that names it', async () => {
    const ev = fakeEventing();
    const stored: Array<string | null> = [];
    await armWorkflowSchedule({ setNextDue: async (_w, _n, at) => { stored.push(at); } }, ev.port as never, row);
    expect(stored).toHaveLength(1);
    expect(ev.published).toHaveLength(1);
    expect(ev.published[0].payload).toEqual({ workflowId: 'w1', nodeId: 's', dueAt: stored[0] });
    expect(ev.published[0].availableAt?.toISOString()).toBe(stored[0]);
  });

  it('when the run cannot be queued, takes the time off again and says so', async () => {
    const stored: Array<string | null> = [];
    const bus = { publish: async () => { throw new Error('queue is away'); } };
    await expect(armWorkflowSchedule({ setNextDue: async (_w, _n, at) => { stored.push(at); } }, bus as never, row)).rejects.toThrow('queue is away');
    // A stored time with no queued run would look armed, and a start before that time would skip it.
    expect(stored).toHaveLength(2);
    expect(stored[1]).toBeNull();
  });
});
