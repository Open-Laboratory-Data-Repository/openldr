import { describe, it, expect, vi } from 'vitest';
import { createWorkflowTriggerRunner } from './trigger-runner';
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
