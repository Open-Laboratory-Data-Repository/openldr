import { describe, it, expect } from 'vitest';
import { syncWorkflowSchedules } from './workflow-schedules';

function world() {
  const rows: Array<{ workflowId: string; nodeId: string; cron: string; tz: string | null; enabled: boolean; nextDueAt: string | null }> = [];
  const published: Array<{ type: string; payload: { workflowId: string; nodeId: string; dueAt: string }; availableAt?: Date }> = [];
  const warned: unknown[] = [];
  const find = (w: string, n: string) => rows.find((r) => r.workflowId === w && r.nodeId === n);
  return {
    rows, published, warned,
    deps: {
      schedules: {
        upsert: async (s: (typeof rows)[number]) => { const i = rows.findIndex((r) => r.workflowId === s.workflowId && r.nodeId === s.nodeId); if (i >= 0) rows[i] = { ...s }; else rows.push({ ...s }); },
        removeForWorkflow: async (w: string) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].workflowId === w) rows.splice(i, 1); },
        setNextDue: async (w: string, n: string, at: string | null) => { const r = find(w, n); if (r) r.nextDueAt = at; },
        claimDue: async (w: string, n: string, dueAt: string | null) => { const r = find(w, n); if (!r || dueAt === null || r.nextDueAt !== dueAt) return false; r.nextDueAt = null; return true; },
      },
      eventing: { publish: async (e: never, o?: { availableAt?: Date }) => { published.push({ ...(e as object), availableAt: o?.availableAt } as never); } },
      logger: { warn: (...a: unknown[]) => { warned.push(a); } },
    },
  };
}
const timed = (id: string, enabled = true, cron = '*/5 * * * *') => ({
  id, enabled,
  definition: { nodes: [{ id: 'tick', type: 'trigger', position: { x: 0, y: 0 }, data: { triggerType: 'schedule', cron, tz: 'UTC' } }, { id: 'other', type: 'action', position: { x: 1, y: 0 }, data: {} }], edges: [] },
});

describe('syncWorkflowSchedules', () => {
  it('stores the schedule of a switched-on workflow and queues its first run', async () => {
    const w = world();
    await syncWorkflowSchedules(w.deps as never, timed('wf1'));
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ workflowId: 'wf1', nodeId: 'tick', cron: '*/5 * * * *', tz: 'UTC', enabled: true });
    expect(w.published.map((e) => e.payload)).toEqual([{ workflowId: 'wf1', nodeId: 'tick', dueAt: w.rows[0].nextDueAt }]);
  });

  it('stores the schedule of a switched-off workflow as off, and queues nothing', async () => {
    const w = world();
    await syncWorkflowSchedules(w.deps as never, timed('wf1', false));
    expect(w.rows).toEqual([{ workflowId: 'wf1', nodeId: 'tick', cron: '*/5 * * * *', tz: 'UTC', enabled: false, nextDueAt: null }]);
    expect(w.published).toEqual([]);
  });

  it('switching off after on leaves a row that stops the queued run from starting another', async () => {
    const w = world();
    await syncWorkflowSchedules(w.deps as never, timed('wf1'));
    await syncWorkflowSchedules(w.deps as never, timed('wf1', false));
    expect(w.rows[0]).toMatchObject({ enabled: false, nextDueAt: null });
    expect(w.published).toHaveLength(1);
  });

  it('touches only the workflow it was given: another one that is overdue keeps its time and gets no second run', async () => {
    const w = world();
    await syncWorkflowSchedules(w.deps as never, timed('wfA'));
    w.rows[0].nextDueAt = '2020-01-01T00:00:00.000Z';
    await syncWorkflowSchedules(w.deps as never, timed('wfB'));
    expect(w.rows.find((r) => r.workflowId === 'wfA')?.nextDueAt).toBe('2020-01-01T00:00:00.000Z');
    expect(w.published.filter((e) => e.payload.workflowId === 'wfA')).toHaveLength(1);
    expect(w.published.filter((e) => e.payload.workflowId === 'wfB')).toHaveLength(1);
  });

  it('when the run cannot be queued: does not throw, warns, and leaves no stored time', async () => {
    const w = world();
    w.deps.eventing.publish = async () => { throw new Error('queue is away'); };
    await expect(syncWorkflowSchedules(w.deps as never, timed('wf1'))).resolves.toBeUndefined();
    expect(w.rows[0]).toMatchObject({ enabled: true, nextDueAt: null });
    expect(w.warned).toHaveLength(1);
  });

  it('removes the rows of a workflow that no longer has a schedule', async () => {
    const w = world();
    await syncWorkflowSchedules(w.deps as never, timed('wf1'));
    await syncWorkflowSchedules(w.deps as never, { id: 'wf1', enabled: true, definition: { nodes: [], edges: [] } });
    expect(w.rows).toEqual([]);
  });
});
