import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createWorkflowScheduleStore } from './schedule-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  db = newDb().adapters.createKysely();
  await db.schema.createTable('workflow_schedules')
    .addColumn('workflow_id', 'text')
    .addColumn('node_id', 'text')
    .addColumn('cron', 'text')
    .addColumn('tz', 'text')
    .addColumn('enabled', 'boolean')
    .addColumn('next_due_at', 'text')
    .execute();
});

describe('WorkflowScheduleStore', () => {
  it('upserts, lists enabled, sets next due, removes per workflow', async () => {
    const store = createWorkflowScheduleStore(db);
    await store.upsert({ workflowId: 'w1', nodeId: 'n1', cron: '0 9 * * *', tz: 'UTC', enabled: true, nextDueAt: null });
    await store.upsert({ workflowId: 'w1', nodeId: 'n1', cron: '0 10 * * *', tz: 'UTC', enabled: true, nextDueAt: null }); // update
    expect((await store.list({ enabledOnly: true })).length).toBe(1);
    await store.setNextDue('w1', 'n1', '2026-01-01T10:00:00Z');
    expect((await store.get('w1', 'n1'))?.nextDueAt).toBe('2026-01-01T10:00:00Z');
    await store.removeForWorkflow('w1');
    expect((await store.list({})).length).toBe(0);
  });

  // A due time is claimed once. Two pending runs for the same time, or a run left over from
  // before an edit, cannot both start the workflow.
  describe('claimDue', () => {
    const DUE = '2026-01-01T10:00:00.000Z';
    async function armed() {
      const store = createWorkflowScheduleStore(db);
      await store.upsert({ workflowId: 'w1', nodeId: 'n1', cron: '0 10 * * *', tz: 'UTC', enabled: true, nextDueAt: null });
      await store.setNextDue('w1', 'n1', DUE);
      return store;
    }

    it('the first claim of the armed time wins, and the second gets nothing', async () => {
      const store = await armed();
      expect(await store.claimDue('w1', 'n1', DUE, DUE)).toBe(true);
      expect(await store.claimDue('w1', 'n1', DUE, DUE)).toBe(false);
      expect((await store.get('w1', 'n1'))?.nextDueAt).toBeNull();
    });

    it('a run for another time than the armed one claims nothing and leaves the row alone', async () => {
      const store = await armed();
      expect(await store.claimDue('w1', 'n1', '2026-01-01T09:00:00.000Z', DUE)).toBe(false);
      expect((await store.get('w1', 'n1'))?.nextDueAt).toBe(DUE);
    });

    it('a run that names no time (queued by an older version) claims a row that is due', async () => {
      const store = await armed();
      expect(await store.claimDue('w1', 'n1', null, '2026-01-01T09:59:59.000Z')).toBe(false);
      expect(await store.claimDue('w1', 'n1', null, '2026-01-01T10:00:01.000Z')).toBe(true);
      expect(await store.claimDue('w1', 'n1', null, '2026-01-01T10:00:02.000Z')).toBe(false);
    });

    it('claims nothing for a row that is not armed or not there', async () => {
      const store = createWorkflowScheduleStore(db);
      await store.upsert({ workflowId: 'w1', nodeId: 'n1', cron: '0 10 * * *', tz: 'UTC', enabled: true, nextDueAt: null });
      expect(await store.claimDue('w1', 'n1', DUE, DUE)).toBe(false);
      expect(await store.claimDue('w1', 'n1', null, DUE)).toBe(false);
      expect(await store.claimDue('w9', 'n1', DUE, DUE)).toBe(false);
    });
  });
});
