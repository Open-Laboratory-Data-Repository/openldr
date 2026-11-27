import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createInternalDb } from '@openldr/db';
import { createEventBus } from '@openldr/adapter-event-bus';
import { createWorkflowScheduleStore } from '@openldr/workflows';

// Real Postgres only. pg-mem does not undo a failed transaction and stores a time as text, so it
// can show neither that arming is one write nor that a claim matches a timestamptz. Run with
// QUEUE_TEST_DATABASE_URL set, as the queue's own live tests are. Each test gets its own schema.
const url = process.env.QUEUE_TEST_DATABASE_URL;

describe.skipIf(!url)('arming a workflow schedule on real Postgres', () => {
  const DUE = '2026-01-01T10:00:00.000Z';
  const EVENT = { type: 'workflow.schedule.due', payload: { workflowId: 'w1', nodeId: 'n1', dueAt: DUE } };
  let admin: pg.Pool;
  let pool: pg.Pool;
  let schema: string;
  let internal: ReturnType<typeof createInternalDb>;
  const scoped = () => { const u = new URL(url!); u.searchParams.set('options', `-c search_path=${schema}`); return u.toString(); };

  beforeEach(async () => {
    schema = `workflow_schedule_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    // The columns of migrations 029 (schedules) and 002 + 094 (queue).
    await pool.query(`create table workflow_schedules (
      workflow_id text not null, node_id text not null, cron text not null, tz text,
      enabled boolean not null default true, next_due_at timestamptz, primary key (workflow_id, node_id))`);
    await pool.query(`create table outbox_events (
      id text primary key, type text not null, payload jsonb not null,
      status text not null default 'pending', attempts integer not null default 0,
      max_attempts integer not null default 5, last_error text, batch_id text,
      claim_token text, available_at timestamptz not null default now(),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
    internal = createInternalDb(url!, { pool: pool as never });
    await createWorkflowScheduleStore(internal.db).upsert({ workflowId: 'w1', nodeId: 'n1', cron: '0 10 * * *', tz: 'UTC', enabled: true, nextDueAt: null });
  });
  afterEach(async () => {
    await internal.close();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });

  const storedTime = async () => (await pool.query('select next_due_at from workflow_schedules')).rows[0].next_due_at as Date | null;

  it('stores the time and queues the run in one write', async () => {
    const store = createWorkflowScheduleStore(internal.db);
    expect(await store.armDue('w1', 'n1', DUE, EVENT)).toBe(true);
    expect((await storedTime())?.toISOString()).toBe(DUE);
    const queued = (await pool.query('select type, payload, available_at, status, batch_id from outbox_events')).rows;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ type: 'workflow.schedule.due', payload: EVENT.payload, status: 'pending', batch_id: null });
    expect((queued[0].available_at as Date).toISOString()).toBe(DUE);
  });

  it('when the run cannot be queued, the time is not stored either', async () => {
    const store = createWorkflowScheduleStore(internal.db);
    await pool.query('drop table outbox_events');
    await expect(store.armDue('w1', 'n1', DUE, EVENT)).rejects.toThrow();
    expect(await storedTime()).toBeNull();
  });

  it('a claim that names the armed time wins once, against a timestamptz column', async () => {
    const store = createWorkflowScheduleStore(internal.db);
    await store.armDue('w1', 'n1', DUE, EVENT);
    expect(await store.claimDue('w1', 'n1', '2026-01-01T09:00:00.000Z', DUE)).toBe(false);
    expect(await store.claimDue('w1', 'n1', DUE, DUE)).toBe(true);
    expect(await store.claimDue('w1', 'n1', DUE, DUE)).toBe(false);
    expect(await storedTime()).toBeNull();
  });

  it('two arms for one time: the real queue delivers both runs, and only the first claims', async () => {
    const store = createWorkflowScheduleStore(internal.db);
    const due = new Date(Date.now() - 1_000).toISOString();
    const event = { type: 'workflow.schedule.due', payload: { workflowId: 'w1', nodeId: 'n1', dueAt: due } };
    await store.armDue('w1', 'n1', due, event);
    await store.armDue('w1', 'n1', due, event);
    const bus = createEventBus({ url: scoped() });
    const claims: boolean[] = [];
    try {
      await bus.subscribe('workflow.schedule.due', async (e) => {
        const p = e.payload as { workflowId: string; nodeId: string; dueAt: string };
        claims.push(await store.claimDue(p.workflowId, p.nodeId, p.dueAt, new Date().toISOString()));
      });
      await bus.drain();
    } finally { await bus.close(); }
    expect(claims.sort()).toEqual([false, true]);
  });
});
