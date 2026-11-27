import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type WorkflowSchedule, WorkflowScheduleSchema } from './types';

function fromRow(r: Record<string, unknown>): WorkflowSchedule {
  return WorkflowScheduleSchema.parse({
    workflowId: r.workflow_id, nodeId: r.node_id, cron: r.cron,
    tz: r.tz ?? null, enabled: r.enabled == null ? true : Boolean(r.enabled),
    nextDueAt: r.next_due_at ? String(r.next_due_at) : null,
  });
}

export interface WorkflowScheduleStore {
  upsert(s: WorkflowSchedule): Promise<void>;
  removeForWorkflow(workflowId: string): Promise<void>;
  list(opts: { enabledOnly?: boolean }): Promise<WorkflowSchedule[]>;
  get(workflowId: string, nodeId: string): Promise<WorkflowSchedule | undefined>;
  /** Stores the time the schedule is armed for. */
  setNextDue(workflowId: string, nodeId: string, nextDueAt: string): Promise<void>;
  /**
   * Takes the armed time off a schedule, once. True for the caller that took it, false for every
   * other. `dueAt` is the time the queued run names: it must be the time the schedule is armed
   * for. A run queued by an older version names none (null): it takes a row that is due at `now`.
   * A queued run claims before it starts the workflow, so two runs queued for one time, or a run
   * left from before an edit, cannot both start it.
   */
  claimDue(workflowId: string, nodeId: string, dueAt: string | null, now: string): Promise<boolean>;
}

export function createWorkflowScheduleStore(db: Kysely<InternalSchema>): WorkflowScheduleStore {
  const T = 'workflow_schedules' as const;
  return {
    async upsert(s) {
      const v = WorkflowScheduleSchema.parse(s);
      await db.deleteFrom(T).where('workflow_id', '=', v.workflowId).where('node_id', '=', v.nodeId).execute();
      await db.insertInto(T).values({
        workflow_id: v.workflowId, node_id: v.nodeId, cron: v.cron, tz: v.tz ?? null,
        enabled: v.enabled, next_due_at: v.nextDueAt ?? null,
      } as never).execute();
    },
    async removeForWorkflow(workflowId) {
      await db.deleteFrom(T).where('workflow_id', '=', workflowId).execute();
    },
    async list(opts) {
      let q = db.selectFrom(T).selectAll();
      if (opts.enabledOnly) q = q.where('enabled', '=', true);
      const rows = await q.execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(workflowId, nodeId) {
      const r = await db.selectFrom(T).selectAll().where('workflow_id', '=', workflowId).where('node_id', '=', nodeId).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async setNextDue(workflowId, nodeId, nextDueAt) {
      await db.updateTable(T).set({ next_due_at: nextDueAt } as never).where('workflow_id', '=', workflowId).where('node_id', '=', nodeId).execute();
    },
    async claimDue(workflowId, nodeId, dueAt, now) {
      // One UPDATE, so the database decides which caller wins.
      let q = db.updateTable(T).set({ next_due_at: null } as never).where('workflow_id', '=', workflowId).where('node_id', '=', nodeId);
      q = dueAt === null ? q.where('next_due_at', '<=', now as never) : q.where('next_due_at', '=', dueAt as never);
      const taken = await q.returning('workflow_id').execute();
      return taken.length > 0;
    },
  };
}
