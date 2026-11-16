import { buildLifecycle, type Lifecycle, type LifecycleRun } from '@openldr/workflows';
import type { CheckRun } from './import-check';
import type { CopyRun } from './import-copy';

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

/** A copy (import-copy.ts), cut down to the counts and states Activity shows. A copy stores source
 *  rows on CE's own disk and starts no workflow run. A set's cursor is a source key, so it is left
 *  out here, before Activity ever holds it. */
export interface ActivityCopyRun {
  id: string;
  pluginId: string;
  pluginVersion: string;
  status: string;
  /** Rows stored, over every set. */
  rows: number;
  /** Keys skipped, over every set. */
  skipped: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  startedBy: string;
}

/** The only way a copy reaches Activity: its counts added up over the sets, and its states. */
export function copyForActivity(run: CopyRun): ActivityCopyRun {
  let rows = 0;
  let skipped = 0;
  for (const s of Object.values(run.sets)) { rows += s.rows; skipped += s.skipped; }
  return {
    id: run.id, pluginId: run.pluginId, pluginVersion: run.pluginVersion, status: run.status, rows, skipped,
    startedAt: run.startedAt, updatedAt: run.updatedAt, finishedAt: run.finishedAt, startedBy: run.startedBy,
  };
}

/** A check run (import-check.ts), cut down to the counts and states Activity shows. Its cursor is
 *  a source key, and its labels are the plugin's own codes, so both are left out here. */
export interface ActivityCheckRun {
  id: string;
  pluginId: string;
  pluginVersion: string;
  status: string;
  read: number;
  saved: number;
  held: number;
  failed: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  startedBy: string;
}

/** The only way a check run reaches Activity: its counts and its states. */
export function checkForActivity(run: CheckRun): ActivityCheckRun {
  const { read, saved, held, failed } = run.counts;
  return {
    id: run.id, pluginId: run.pluginId, pluginVersion: run.pluginVersion, status: run.status, read, saved, held, failed,
    startedAt: run.startedAt, updatedAt: run.updatedAt, finishedAt: run.finishedAt, startedBy: run.startedBy,
  };
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
  /** Every copy, through `copyForActivity`. Optional so older callers and tests need not supply it. */
  importCopies?: () => Promise<ActivityCopyRun[]>;
  /** Every check run, through `checkForActivity`. Optional so older callers and tests need not supply it. */
  importChecks?: () => Promise<ActivityCheckRun[]>;
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
  // A run waiting for its source will carry on by itself, so it is still running.
  return status === 'running' || status === 'waiting' || status === 'stopping' ? 'running' : 'stopped';
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

function copyStatus(status: string): ActivityLifecycle['status'] {
  if (status === 'completed') return 'complete';
  if (status === 'failed') return 'failed';
  if (status === 'stopped') return 'stopped';
  // Queued, running, waiting, stopping and deleting all carry on by themselves.
  return 'running';
}

/** One copy as a lifecycle: who started it, then how many rows it holds so far. */
function copyLifecycle(run: ActivityCopyRun): ActivityLifecycle {
  const stages: ActivityLifecycle['stages'] = [
    { stage: 'received', status: 'ok', at: run.startedAt, detail: `copy: ${run.pluginId} ${run.pluginVersion}, started by ${run.startedBy}` },
  ];
  if (run.rows > 0 || run.skipped > 0 || run.status === 'failed') {
    stages.push({
      stage: 'persisted', status: run.status === 'failed' ? 'failed' : 'ok',
      // A copy that has not finished is dated by its last save.
      at: run.finishedAt ?? run.updatedAt,
      detail: `${run.rows} rows copied, ${run.skipped} keys skipped`,
    });
  }
  return { correlationId: run.id, status: copyStatus(run.status), stages, runIds: [] };
}

/** One check run as a lifecycle: who started it, then what it has read, saved and held so far. */
function checkLifecycle(run: ActivityCheckRun): ActivityLifecycle {
  const stages: ActivityLifecycle['stages'] = [
    { stage: 'received', status: 'ok', at: run.startedAt, detail: `check: ${run.pluginId} ${run.pluginVersion}, started by ${run.startedBy}` },
  ];
  if (run.read > 0 || run.status === 'failed') {
    stages.push({
      stage: 'persisted', status: run.status === 'failed' ? 'failed' : 'ok',
      at: run.finishedAt ?? run.updatedAt,
      detail: `${run.read} read, ${run.saved} saved, ${run.held} held back, ${run.failed} failed`,
    });
  }
  // A check has the same states as a copy, less deleting.
  return { correlationId: run.id, status: copyStatus(run.status), stages, runIds: [] };
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

  /** Every copy. Activity must keep working when they cannot be read, so a failure reads as none. */
  async function importCopies(): Promise<ActivityCopyRun[]> {
    if (!deps.importCopies) return [];
    try {
      return await deps.importCopies();
    } catch {
      return [];
    }
  }

  /** Every check run. Activity must keep working when they cannot be read, so a failure reads as none. */
  async function importChecks(): Promise<ActivityCheckRun[]> {
    if (!deps.importChecks) return [];
    try {
      return await deps.importChecks();
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

  function copyPayload(run: ActivityCopyRun): RecentPayload {
    const lc = copyLifecycle(run);
    return { correlationId: run.id, workflowId: `copy:${run.pluginId}`, source: `copy: ${run.pluginId}`,
      startedAt: run.startedAt, currentStage: lc.stages[lc.stages.length - 1].stage, status: lc.status };
  }

  function checkPayload(run: ActivityCheckRun): RecentPayload {
    const lc = checkLifecycle(run);
    return { correlationId: run.id, workflowId: `check:${run.pluginId}`, source: `check: ${run.pluginId}`,
      startedAt: run.startedAt, currentStage: lc.stages[lc.stages.length - 1].stage, status: lc.status };
  }

  return {
    async getLifecycle(correlationId) {
      const payload = await assemble(correlationId);
      if (payload) return payload;
      const run = (await importRuns()).find((r) => r.id === correlationId);
      if (run) return importLifecycle(run);
      const copy = (await importCopies()).find((c) => c.id === correlationId);
      if (copy) return copyLifecycle(copy);
      const check = (await importChecks()).find((c) => c.id === correlationId);
      return check ? checkLifecycle(check) : null;
    },
    async listRecent(opts) {
      const imports = await importRuns();
      const copies = await importCopies();
      const checks = await importChecks();
      const batches = await ingestBatches();
      if (imports.length === 0 && copies.length === 0 && checks.length === 0 && batches.length === 0) {
        const out: RecentPayload[] = [];
        for (const h of await deps.runs.listCorrelations(opts)) out.push(await workflowPayload(h));
        return out;
      }
      // Five sources, one page. Ask the store for enough rows to cover the page once the import
      // runs, copies, checks and batches are merged in, order all by time, then cut the page. Only the rows
      // on the page are assembled, which is the costly part. A batch that also has a workflow run is
      // shown once, as the payload.
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit;
      const heads = await deps.runs.listCorrelations(limit === undefined ? opts : { limit: offset + limit, offset: 0 });
      type Entry = {
        at: string;
        head?: { correlationId: string; latestAt: string; workflowId: string };
        run?: ActivityImportRun;
        copy?: ActivityCopyRun;
        check?: ActivityCheckRun;
        batch?: ActivityBatch;
      };
      const merged: Entry[] = [
        ...heads.map((h): Entry => ({ at: h.latestAt, head: h })),
        ...imports.map((run): Entry => ({ at: run.startedAt, run })),
        ...copies.map((copy): Entry => ({ at: copy.startedAt, copy })),
        ...checks.map((check): Entry => ({ at: check.startedAt, check })),
        ...batches
          .filter((b) => !heads.some((h) => h.correlationId === b.batch_id))
          .map((b): Entry => ({ at: isoOf(b.created_at), batch: b })),
      // Compare as times, not text: the sources need not format a timestamp the same way.
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      const page = limit === undefined ? merged : merged.slice(offset, offset + limit);
      const out: RecentPayload[] = [];
      for (const e of page) {
        out.push(e.run ? importPayload(e.run) : e.copy ? copyPayload(e.copy) : e.check ? checkPayload(e.check) : e.batch ? batchPayload(e.batch) : await workflowPayload(e.head!));
      }
      return out;
    },
  };
}
