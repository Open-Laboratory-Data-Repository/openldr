import { buildLifecycle, type Lifecycle, type LifecycleRun } from '@openldr/workflows';

/** Structural view of a workflow run; `result` is widened to `unknown` so the store's
 *  own WorkflowRun type (which has `result?: unknown`) is assignable here. `buildLifecycle`
 *  reads `result.results` defensively, so the loose shape is safe. */
export type ActivityRun = Omit<LifecycleRun, 'result'> & { result?: unknown };

/** An import run (import-run.ts), as much of it as Activity shows. An import saves records through
 *  the same save step as the ingest workflow, but starts no workflow run, so without this it
 *  would never appear here. */
export interface ActivityImportRun {
  id: string;
  pluginId: string;
  pluginVersion: string;
  status: string;
  dryRun: boolean;
  counts: { keys: number; imported: number; failed: number; resources: number };
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  startedBy: string;
}

/** An ingest batch (packages/ingest batch-store.ts), as much of it as Activity shows. `openldr
 *  ingest` saves a batch directly and starts no workflow run, so without this a lab that loads from
 *  the CLI saw nothing here (bug 14). */
export interface ActivityBatch {
  batch_id: string;
  source: string | null;
  converter: string;
  status: string;
  resource_count: number;
  last_error: string | null;
  created_at: Date | string;
}

export interface ActivityDeps {
  runs: {
    listByCorrelation(id: string): Promise<ActivityRun[]>;
    listCorrelations(opts?: { limit?: number; offset?: number }): Promise<Array<{ correlationId: string; latestAt: string; latestStatus: string; workflowId: string }>>;
  };
  batches: { get(batchId: string): Promise<Partial<ActivityBatch> | null | undefined> };
  /** Reads the data.persisted event for a batch from outbox_events (null if not yet persisted). */
  persistedEvent(correlationId: string): Promise<{ at: string; count: number; resourceTypes: string[] } | null>;
  /** Every import run. Optional so older callers and tests need not supply it. */
  importRuns?: () => Promise<ActivityImportRun[]>;
  /** The newest ingest batches. Optional so older callers and tests need not supply it. */
  ingestBatches?: () => Promise<ActivityBatch[]>;
}

export interface RecentPayload { correlationId: string; workflowId: string; source: string | null; startedAt: string; currentStage: string; status: string; }

/** A payload's lifecycle, or an import run's. An import can also be running or stopped, which a
 *  workflow payload cannot. */
export type ActivityLifecycle = Omit<Lifecycle, 'status'> & { status: Lifecycle['status'] | 'running' | 'stopped' };

export interface ActivityService {
  getLifecycle(correlationId: string): Promise<ActivityLifecycle | null>;
  listRecent(opts?: { limit?: number; offset?: number }): Promise<RecentPayload[]>;
}

function importStatus(status: string): ActivityLifecycle['status'] {
  if (status === 'completed') return 'complete';
  if (status === 'failed') return 'failed';
  return status === 'running' || status === 'stopping' ? 'running' : 'stopped';
}

/** One import run as a lifecycle: who started it, then what it has saved so far. */
function importLifecycle(run: ActivityImportRun): ActivityLifecycle {
  const stages: ActivityLifecycle['stages'] = [
    { stage: 'received', status: 'ok', at: run.startedAt, detail: `import: ${run.pluginId} ${run.pluginVersion}, started by ${run.startedBy}` },
  ];
  if (run.counts.imported > 0 || run.status === 'failed') {
    stages.push({
      stage: 'persisted', status: run.status === 'failed' ? 'failed' : 'ok',
      // A run that has not finished is dated by its last saved page.
      at: run.finishedAt ?? run.updatedAt,
      detail: `${run.counts.imported} imported, ${run.counts.failed} failed, ${run.counts.resources} resources`,
    });
  }
  return { correlationId: run.id, status: importStatus(run.status), stages, runIds: [] };
}

function batchStatus(status: string): ActivityLifecycle['status'] {
  if (status === 'done') return 'complete';
  if (status === 'failed') return 'failed';
  return 'running';
}

const isoOf = (v: Date | string | undefined): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

/** One batch with no workflow run as a lifecycle: where it came from, then what it saved. Read from
 *  the batch's own status, not from runs, so a failed batch reads as failed rather than stuck. */
function batchLifecycle(b: Partial<ActivityBatch> & { batch_id?: string }, id: string): ActivityLifecycle {
  const at = isoOf(b.created_at);
  const stages: ActivityLifecycle['stages'] = [
    { stage: 'received', status: 'ok', at, detail: `${b.source ?? 'cli'}: ${b.converter ?? ''}`.replace(/: $/, '') },
  ];
  if (b.status === 'done') stages.push({ stage: 'persisted', status: 'ok', at, detail: `${b.resource_count ?? 0} resources` });
  if (b.status === 'failed') stages.push({ stage: 'persisted', status: 'failed', at, detail: b.last_error ?? 'failed' });
  return { correlationId: id, status: batchStatus(String(b.status ?? '')), stages, runIds: [] };
}

export function createActivityService(deps: ActivityDeps): ActivityService {
  async function assemble(correlationId: string): Promise<ActivityLifecycle | null> {
    const runs = await deps.runs.listByCorrelation(correlationId);
    const batchRow = await deps.batches.get(correlationId);
    if (runs.length === 0 && batchRow) return batchLifecycle(batchRow, correlationId);
    const persistedEvent = await deps.persistedEvent(correlationId);
    if (runs.length === 0 && !batchRow) return null;
    const ingestBatch = batchRow
      ? { receivedAt: String(batchRow.created_at ?? runs[0]?.startedAt ?? ''), source: (batchRow.source as string) ?? null, status: String(batchRow.status ?? '') }
      : null;
    return buildLifecycle({ correlationId, runs: runs as LifecycleRun[], persistedEvent, ingestBatch });
  }
  /** Import runs that saved, or are saving, records. A dry run saves nothing and is left out.
   *  Activity must keep working when these cannot be read, so a failure reads as none. */
  async function importRuns(): Promise<ActivityImportRun[]> {
    if (!deps.importRuns) return [];
    try {
      return (await deps.importRuns()).filter((r) => !r.dryRun);
    } catch {
      return [];
    }
  }

  /** The newest ingest batches. Activity must keep working when they cannot be read. */
  async function ingestBatches(): Promise<ActivityBatch[]> {
    if (!deps.ingestBatches) return [];
    try {
      return await deps.ingestBatches();
    } catch {
      return [];
    }
  }

  function batchPayload(b: ActivityBatch): RecentPayload {
    const lc = batchLifecycle(b, b.batch_id);
    return { correlationId: b.batch_id, workflowId: `ingest:${b.converter}`, source: b.source ?? 'cli',
      startedAt: isoOf(b.created_at), currentStage: lc.stages[lc.stages.length - 1]!.stage, status: lc.status };
  }

  async function workflowPayload(h: { correlationId: string; latestAt: string; workflowId: string }): Promise<RecentPayload> {
    const lc = await assemble(h.correlationId);
    const last = lc?.stages[lc.stages.length - 1];
    // Source = how the payload arrived (the `received` stage detail = webhook/ingest source),
    // not the last stage's detail (which for a persisted payload is a resource count).
    const received = lc?.stages.find((s) => s.stage === 'received');
    return { correlationId: h.correlationId, workflowId: h.workflowId,
      source: received?.detail ?? null, startedAt: h.latestAt,
      currentStage: last?.stage ?? 'received', status: lc?.status ?? 'stuck' };
  }

  function importPayload(run: ActivityImportRun): RecentPayload {
    const lc = importLifecycle(run);
    return { correlationId: run.id, workflowId: `import:${run.pluginId}`, source: `import: ${run.pluginId}`,
      startedAt: run.startedAt, currentStage: lc.stages[lc.stages.length - 1].stage, status: lc.status };
  }

  return {
    async getLifecycle(correlationId) {
      const payload = await assemble(correlationId);
      if (payload) return payload;
      const run = (await importRuns()).find((r) => r.id === correlationId);
      return run ? importLifecycle(run) : null;
    },
    async listRecent(opts) {
      const imports = await importRuns();
      const batches = await ingestBatches();
      if (imports.length === 0 && batches.length === 0) {
        const out: RecentPayload[] = [];
        for (const h of await deps.runs.listCorrelations(opts)) out.push(await workflowPayload(h));
        return out;
      }
      // Three sources, one page. Ask the store for enough rows to cover the page once the import
      // runs and batches are merged in, order all by time, then cut the page. Only the rows on the
      // page are assembled, which is the costly part. A batch that also has a workflow run is shown
      // once, as the payload.
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit;
      const heads = await deps.runs.listCorrelations(limit === undefined ? opts : { limit: offset + limit, offset: 0 });
      const merged = [
        ...heads.map((h) => ({ at: h.latestAt, head: h, run: undefined as ActivityImportRun | undefined, batch: undefined as ActivityBatch | undefined })),
        ...imports.map((run) => ({ at: run.startedAt, head: undefined, run })),
        ...batches
          .filter((b) => !heads.some((h) => h.correlationId === b.batch_id))
          .map((b) => ({ at: isoOf(b.created_at), head: undefined, run: undefined, batch: b })),
      // Compare as times, not text: the two sources need not format a timestamp the same way.
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      const page = limit === undefined ? merged : merged.slice(offset, offset + limit);
      const out: RecentPayload[] = [];
      for (const e of page) out.push(e.run ? importPayload(e.run) : e.batch ? batchPayload(e.batch) : await workflowPayload(e.head!));
      return out;
    },
  };
}
