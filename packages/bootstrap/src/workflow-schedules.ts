import { armWorkflowSchedule, WorkflowDefinitionSchema, type WorkflowScheduleStore } from '@openldr/workflows';
import type { EventingPort } from '@openldr/ports';

/**
 * Stores a workflow's schedules after it is saved or switched on or off, and queues their first
 * run. The save routes and `openldr workflows enable|disable` both call this, so a schedule
 * starts and stops the same way from Studio and from the CLI, with no restart.
 *
 * - The rows take the workflow's own on or off. A switched-off workflow gets rows that are off and
 *   nothing queued; a run still queued for it finds the row off and queues no other.
 * - Only this workflow's rows are touched. Another workflow that is due keeps its stored time, so
 *   its queued run can still claim it.
 * - The workflow itself is already saved. When a run cannot be queued, this warns and returns;
 *   the row is left with no time, and the next start or save arms it.
 */
export async function syncWorkflowSchedules(
  deps: {
    schedules: Pick<WorkflowScheduleStore, 'upsert' | 'removeForWorkflow' | 'setNextDue'>;
    eventing: Pick<EventingPort, 'publish'>;
    logger: { warn(obj: unknown, msg: string): void };
  },
  workflow: { id: string; enabled: boolean; definition: unknown },
): Promise<void> {
  const def = WorkflowDefinitionSchema.parse(workflow.definition);
  await deps.schedules.removeForWorkflow(workflow.id);
  for (const n of def.nodes as Array<{ id: string; type?: string; data?: Record<string, unknown> }>) {
    const isSchedule = n.type === 'trigger' && n.data?.triggerType === 'schedule';
    const cron = n.data?.cron as string | undefined;
    if (!isSchedule || !cron || !cron.trim()) continue;
    const row = { workflowId: workflow.id, nodeId: n.id, cron, tz: (n.data?.tz as string) ?? null };
    await deps.schedules.upsert({ ...row, enabled: workflow.enabled, nextDueAt: null });
    if (!workflow.enabled) continue;
    try {
      await armWorkflowSchedule(deps.schedules, deps.eventing, row);
    } catch (err) {
      deps.logger.warn({ err, workflowId: workflow.id, nodeId: n.id }, 'queueing the saved workflow schedule failed');
    }
  }
}
