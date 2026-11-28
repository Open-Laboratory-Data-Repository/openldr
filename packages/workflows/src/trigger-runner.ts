import { randomUUID } from 'node:crypto';
import type { EventingPort } from '@openldr/ports';
import type { WorkflowStore } from './store';
import type { WorkflowRunStore } from './run-store';
import type { WorkflowScheduleStore } from './schedule-store';
import type { WebhookRegistry } from './webhook-registry';
import type { SharedWebhookResolver } from './shared-webhook-resolver';
import type { runWorkflow as RunWorkflowFn } from './engine/run-workflow';
import type { WorkflowServices } from './engine/services';
import type { CodeLimits } from './engine/execution-context';
import type { BinaryRef } from './engine/items';
import { WorkflowDefinitionSchema, type TriggerSource, type WorkflowRun } from './types';
import { nextCronDate } from './cron';
import { extractCorrelationId } from './correlation';

interface RunnerDeps {
  store: Pick<WorkflowStore, 'get'>;
  runs: WorkflowRunStore;
  schedules: Pick<WorkflowScheduleStore, 'get' | 'list' | 'armDue' | 'claimDue'>;
  webhooks: Pick<WebhookRegistry, 'resolve'> | SharedWebhookResolver;
  runWorkflow: typeof RunWorkflowFn;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
  codeLimits?: CodeLimits;
  loopMaxItems?: number;
  services?: WorkflowServices;
}

const SCHEDULE_DUE = 'workflow.schedule.due';
const INGEST_DONE = 'ingest.batch.done';
const DATA_PERSISTED = 'data.persisted';

/**
 * What a run reports back to its caller.
 *
 * `nodeMeta` is each node's structured result metadata, keyed by node id — the same values the
 * run record stores, lifted out of `result.results` so a caller does not have to re-read the run.
 * A caller that must tell a HUMAN what happened needs it: a run can persist and THEN fail (the
 * Persist Store node succeeds, a later node throws), and "failed" on its own would send a clerk
 * off to re-enter clinical data that is already stored.
 */
export interface RunOutcome {
  runId: string;
  correlationId: string | null;
  status: WorkflowRun['status'];
  error: string | null;
  nodeMeta: Record<string, unknown>;
  /** Items Map to FHIR held back in this run, when any were. A run that completes can still have
   *  held some, when its held port goes to a node such as a Log. Callers must report them. */
  held?: HeldSummary;
}

export interface HeldSummary { count: number; reasons: string[] }

/** Held items across a run's Map to FHIR steps (their meta has `heldReasons`): how many, and the
 *  first `maxReasons` reasons. Undefined when none were held. */
export function heldSummary(metas: unknown[], maxReasons = 5): HeldSummary | undefined {
  let count = 0;
  const reasons: string[] = [];
  for (const m of metas) {
    if (!m || typeof m !== 'object') continue;
    const meta = m as { held?: unknown; heldReasons?: unknown };
    if (!Array.isArray(meta.heldReasons)) continue;
    if (typeof meta.held === 'number' && Number.isFinite(meta.held)) count += meta.held;
    for (const r of meta.heldReasons) if (reasons.length < maxReasons) reasons.push(String(r));
  }
  return count > 0 ? { count, reasons } : undefined;
}

export interface WorkflowTriggerRunner {
  registerRunner(eventing: EventingPort): Promise<void>;
  reconcile(eventing: EventingPort): Promise<void>;
  setIngestWorkflowIds(ids: string[]): void;
  setEventWorkflowIds(ids: string[]): void;
  runAndRecord(workflowId: string, source: TriggerSource, input: unknown, files?: Record<string, BinaryRef>): Promise<RunOutcome | null>;
}

/**
 * Arms one schedule for its next time. The store does it in one transaction: it stores the time
 * and puts the run for that time on the durable queue (schedule-store armDue). The queued run
 * names the time, and must claim it before it starts the workflow (claimDue). The runner calls
 * this after each run and at start; a save calls it for the schedule it just stored (bootstrap
 * syncWorkflowSchedules), so that schedule needs no restart.
 */
export async function armWorkflowSchedule(
  schedules: Pick<WorkflowScheduleStore, 'armDue'>,
  s: { workflowId: string; nodeId: string; cron: string; tz: string | null },
  now: () => Date = () => new Date(),
): Promise<void> {
  const dueAt = nextCronDate(s.cron, s.tz, now()).toISOString();
  await schedules.armDue(s.workflowId, s.nodeId, dueAt, { type: SCHEDULE_DUE, payload: { workflowId: s.workflowId, nodeId: s.nodeId, dueAt } });
}

export async function executeWorkflowRun(
  deps: Pick<RunnerDeps, 'runWorkflow' | 'codeLimits' | 'loopMaxItems' | 'services'>,
  def: ReturnType<typeof WorkflowDefinitionSchema.parse>,
  identity: { id: string; workflowId: string; source: TriggerSource; input: unknown; files?: Record<string, BinaryRef> },
): Promise<WorkflowRun> {
  let result: Awaited<ReturnType<typeof deps.runWorkflow>>;
  let error: string | null = null;
  try {
    result = await deps.runWorkflow(def.nodes, def.edges, {
      input: identity.input,
      files: identity.files,
      codeLimits: deps.codeLimits,
      loopMaxItems: deps.loopMaxItems,
      services: deps.services,
      workflowId: identity.workflowId,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    result = {
      status: 'failed' as const,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      results: [],
    };
  }
  const correlationId = extractCorrelationId(identity.input, result);
  const run: WorkflowRun = {
    id: identity.id,
    workflowId: identity.workflowId,
    triggerSource: identity.source,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    result,
    error,
    correlationId,
  };
  return run;
}

export function createWorkflowTriggerRunner(deps: RunnerDeps): WorkflowTriggerRunner {
  let ingestIds = new Set<string>();
  let eventIds = new Set<string>();

  async function runAndRecord(workflowId: string, source: TriggerSource, input: unknown, files?: Record<string, BinaryRef>): Promise<RunOutcome | null> {
    const wf = await deps.store.get(workflowId);
    if (!wf || !wf.enabled) return null;
    const def = WorkflowDefinitionSchema.parse(wf.definition);
    const run = await executeWorkflowRun(deps, def, { id: randomUUID(), workflowId, source, input, files });
    await deps.runs.record(run);
    // Surface the outcome, not just the id: the webhook route must be able to tell a failed
    // run from a successful one. Returning only {runId} is why POST /hooks/* answered
    // 200 {ok:true} on a run that stored nothing — silent data loss for the sender.
    //
    // nodeMeta rides along for the mirror-image case: a run that DID store and then failed
    // downstream. Without it the caller can only say "failed", and a clerk told that a
    // submission failed resubmits — writing a second copy of the same clinical event.
    const nodeMeta: Record<string, unknown> = {};
    for (const r of (run.result as Awaited<ReturnType<typeof deps.runWorkflow>>).results) {
      if (r.meta !== undefined) nodeMeta[r.nodeId] = r.meta;
    }
    const held = heldSummary(Object.values(nodeMeta));
    return { runId: run.id, correlationId: run.correlationId ?? null, status: run.status, error: run.error, nodeMeta, ...(held ? { held } : {}) };
  }

  /**
   * Does this workflow's ingest trigger accept a batch from `source`? An empty
   * (or absent) `data.config.sourceFilter` matches every batch; a set filter
   * matches case-insensitively against the event's `source`.
   */
  async function ingestNodeMatches(workflowId: string, source: string): Promise<boolean> {
    const wf = await deps.store.get(workflowId);
    if (!wf || !wf.enabled) return false;
    const def = WorkflowDefinitionSchema.parse(wf.definition);
    const ingestNode = (def.nodes as Array<{ type?: string; data?: Record<string, unknown> }>).find(
      (n) => n.type === 'trigger' && n.data?.triggerType === 'ingest',
    );
    const filter = String((ingestNode?.data?.config as { sourceFilter?: unknown } | undefined)?.sourceFilter ?? '')
      .trim()
      .toLowerCase();
    return filter === '' || filter === source;
  }

  /**
   * Does this workflow's event trigger accept this data.persisted event? Empty
   * source/resourceType filters match everything; a set source matches the event
   * source case-insensitively; a set resourceType must be among the event's
   * resourceTypes.
   * resourceType is matched exactly (FHIR resource type names are case-sensitive).
   */
  async function eventNodeMatches(
    workflowId: string,
    payload: { source?: unknown; resourceTypes?: unknown },
  ): Promise<boolean> {
    const wf = await deps.store.get(workflowId);
    if (!wf || !wf.enabled) return false;
    const def = WorkflowDefinitionSchema.parse(wf.definition);
    const node = (def.nodes as Array<{ type?: string; data?: Record<string, unknown> }>).find(
      (n) => n.type === 'trigger' && n.data?.triggerType === 'event',
    );
    const cfg = (node?.data?.config ?? {}) as { source?: unknown; resourceType?: unknown };
    const wantSource = String(cfg.source ?? '').trim().toLowerCase();
    const wantType = String(cfg.resourceType ?? '').trim();
    const evSource = String(payload.source ?? '').trim().toLowerCase();
    const evTypes = Array.isArray(payload.resourceTypes) ? payload.resourceTypes.map((t) => String(t).trim()) : [];
    if (wantSource !== '' && wantSource !== evSource) return false;
    if (wantType !== '' && !evTypes.includes(wantType)) return false;
    return true;
  }

  const arm = (workflowId: string, nodeId: string, cron: string, tz: string | null): Promise<void> =>
    armWorkflowSchedule(deps.schedules, { workflowId, nodeId, cron, tz });

  return {
    setIngestWorkflowIds(ids) {
      ingestIds = new Set(ids);
    },

    setEventWorkflowIds(ids) {
      eventIds = new Set(ids);
    },

    runAndRecord,

    async registerRunner(eventing) {
      await eventing.subscribe(SCHEDULE_DUE, async (event) => {
        const { workflowId, nodeId, dueAt } = event.payload as { workflowId: string; nodeId: string; dueAt?: string };
        const s = await deps.schedules.get(workflowId, nodeId);
        if (!s || !s.enabled) return;
        // Only one queued run may take a due time. A save arms the schedule again while a run
        // queued before the save is still waiting; without the claim both would start the
        // workflow, and each would queue the next, for ever.
        if (!(await deps.schedules.claimDue(workflowId, nodeId, dueAt ?? null, new Date().toISOString()))) return;
        try {
          await runAndRecord(workflowId, 'schedule', { scheduledAt: new Date().toISOString() });
        } finally {
          // Also when the run threw: the claim took the armed time, so nothing else queues the next.
          try {
            // Re-fetch after the run so a mid-run disable/edit is honored when re-arming.
            const after = await deps.schedules.get(workflowId, nodeId);
            // A save during the run has armed it again already.
            const armedAgain = !!after?.nextDueAt && new Date(after.nextDueAt).getTime() > Date.now();
            if (after && after.enabled && !armedAgain) await arm(workflowId, nodeId, after.cron, after.tz);
          } catch (err) {
            deps.logger.error({ err, workflowId, nodeId }, 'workflow schedule re-arm failed');
          }
        }
      });

      await eventing.subscribe(INGEST_DONE, async (event) => {
        const payload = (event.payload ?? {}) as { source?: unknown; blobKey?: unknown; byteSize?: unknown };
        const source = String(payload.source ?? '').trim().toLowerCase();
        const files = (typeof payload.blobKey === 'string' && typeof payload.byteSize === 'number')
          ? { file: { objectKey: payload.blobKey, contentType: 'application/octet-stream', fileName: payload.blobKey.split('/').pop() ?? 'payload', byteSize: payload.byteSize } as BinaryRef }
          : undefined;
        for (const workflowId of ingestIds) {
          try {
            if (!(await ingestNodeMatches(workflowId, source))) continue;
            await runAndRecord(workflowId, 'ingest', event.payload, files);
          } catch (err) {
            deps.logger.error({ err, workflowId }, 'ingest-triggered workflow run failed');
          }
        }
      });

      await eventing.subscribe(DATA_PERSISTED, async (event) => {
        const payload = (event.payload ?? {}) as { source?: unknown; resourceTypes?: unknown };
        for (const workflowId of eventIds) {
          try {
            if (!(await eventNodeMatches(workflowId, payload))) continue;
            await runAndRecord(workflowId, 'event', event.payload);
          } catch (err) {
            deps.logger.error({ err, workflowId }, 'event-triggered workflow run failed');
          }
        }
      });
    },

    // The bus is not used: arming writes the queued run with the stored time (armDue).
    async reconcile(_eventing) {
      const now = Date.now();
      for (const s of await deps.schedules.list({ enabledOnly: true })) {
        // Skip schedules already armed for a future time — avoids duplicate runs on restart.
        // One with a past time is armed again: its queued run then fails its claim, so a run that
        // was due while the server was down is skipped once, never made twice.
        if (s.nextDueAt && new Date(s.nextDueAt).getTime() > now) continue;
        try {
          await arm(s.workflowId, s.nodeId, s.cron, s.tz);
        } catch (err) {
          deps.logger.error(
            { err, workflowId: s.workflowId, nodeId: s.nodeId },
            'workflow schedule arm failed',
          );
        }
      }
    },
  };
}
