import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely, type Selectable } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { EventingPort } from '@openldr/ports';
import type { BinaryRef } from './engine/items';
import { heldSummary, type RunOutcome } from './trigger-runner';
import type { WorkflowRun } from './types';
import { WorkflowDefinitionSchema } from './types';
import { AUTH_HEADER_RE } from './secret-fields';
import { createWorkflowRunStore } from './run-store';


const ignoredHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding', 'user-agent', 'traceparent', 'tracestate', 'x-request-id', 'prefer', 'idempotency-key']);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(v => canonical(v ?? null)).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value ?? null);
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function cleanInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const result = { ...input as Record<string, unknown> };
  if (result.headers && typeof result.headers === 'object') {
    result.headers = Object.fromEntries(Object.entries(result.headers).map(([k,v]) => [k.toLowerCase(), v]).filter(([k]) => !AUTH_HEADER_RE.test(k)));
  }
  return result;
}
export async function webhookInputDigest(input: unknown, files?: Record<string, BinaryRef>, readBinary?: (key: string) => Promise<Uint8Array>): Promise<string> {
  const semantic = cleanInput(input);
  if (semantic && typeof semantic === 'object' && !Array.isArray(semantic)) {
    const obj = semantic as Record<string, unknown>;
    if (obj.headers && typeof obj.headers === 'object') obj.headers = Object.fromEntries(Object.entries(obj.headers).filter(([k]) => !ignoredHeaders.has(k)));
  }
  const binaries: Record<string, unknown> = {};
  for (const [name, ref] of Object.entries(files ?? {})) {
    if (!readBinary) throw new Error('Binary storage is unavailable');
    const bytes = await readBinary(ref.objectKey);
    binaries[name] = { contentType: ref.contentType, fileName: ref.fileName ?? null, byteSize: bytes.byteLength, digest: createHash('sha256').update(bytes).digest('hex') };
  }
  return digest({ input: semantic, files: binaries });
}


export class WebhookAcceptanceError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = 'WEBHOOK_ACCEPTANCE_INVALID') { super(message); this.name = 'WebhookAcceptanceError'; }
}
export class WebhookIdempotencyConflictError extends WebhookAcceptanceError {
  constructor() { super('Idempotency key was already used with different input', 409, 'WEBHOOK_IDEMPOTENCY_CONFLICT'); this.name = 'WebhookIdempotencyConflictError'; }
}
export interface WorkflowReceipt {
  id: string;
  workflowId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  runId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  reason: string | null;
  outcome: RunOutcome | null;
}
export interface WorkflowReceiptService {
  accept(input: { workflowId: string; input: unknown; files?: Record<string, BinaryRef>; idempotencyKey?: string }): Promise<{ receipt: WorkflowReceipt; created: boolean }>;
  get(id: string): Promise<WorkflowReceipt | undefined>;
  list(workflowId: string, opts?: { limit?: number; offset?: number }): Promise<WorkflowReceipt[]>;
  /** Continue on an interrupted run (design 2026-11-18-interrupted-jobs): a new run of the
   *  workflow's current definition with the stored input and files, under a fresh idempotency key.
   *  `definitionChanged` says the workflow changed since the cut run was accepted. `not-waiting`
   *  for any receipt that is not interrupted, or not this workflow's. */
  continueFrom(workflowId: string, id: string): Promise<{ receipt: WorkflowReceipt; definitionChanged: boolean } | 'not-waiting'>;
  /** What Continue would do, without doing it: whether the workflow changed since the cut run was
   *  accepted, so the page can ask before running it (review R5). */
  continueCheck(workflowId: string, id: string): Promise<{ definitionChanged: boolean } | 'not-waiting'>;
}
interface ReceiptDeps {
  db: Kysely<InternalSchema>;
  readBinary?: (key: string) => Promise<Uint8Array>;
  execute: (workflow: ReturnType<typeof WorkflowDefinitionSchema.parse>, runId: string, workflowId: string, input: unknown, files: Record<string, BinaryRef>) => Promise<WorkflowRun>;
}
const EVENT = 'workflow.webhook.accepted';
/** A queued receipt whose dispatch ended is requeued at most this many times (review R11). */
const MAX_REQUEUES = 3;
const publicColumns = ['id', 'workflow_id', 'status', 'run_id', 'created_at', 'started_at', 'finished_at', 'reason', 'outcome'] as const;
const parseJson = <T = unknown>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const iso = (v: unknown) => v == null ? null : new Date(v as string | Date).toISOString();
function publicReceipt(row: Pick<Selectable<InternalSchema['workflow_webhook_receipts']>, typeof publicColumns[number]>): WorkflowReceipt {
  return { id: row.id, workflowId: row.workflow_id, status: row.status as WorkflowReceipt['status'], runId: row.run_id, createdAt: iso(row.created_at)!, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at), reason: row.reason, outcome: parseJson<RunOutcome | null>(row.outcome) ?? null };
}
export function createWorkflowReceiptService(deps: ReceiptDeps): WorkflowReceiptService & { register(eventing: EventingPort): Promise<void> } {
  const db = deps.db;
  // Terminal outbox failure can exhaust its attempts before another delivery occurs.
  async function reconcile(ids: string[]) {
    if (!ids.length) return;
    // Receipts whose dispatch has ended: their outbox event is done, failed or gone.
    const ended = await db.selectFrom('workflow_webhook_receipts').select(['id', 'status', 'started_at', 'event_id'])
      // The event's last update: the bus renews it while a worker owns the run, so it is the last
      // time CE heard of the run (re-review R6). Null when the event is gone.
      .select(eb => eb.selectFrom('outbox_events').select('outbox_events.updated_at')
        .whereRef('outbox_events.id', '=', 'workflow_webhook_receipts.event_id').as('event_updated_at'))
      .where('id', 'in', ids).where('status', 'in', ['queued', 'running'])
      .where(eb => eb.not(eb.exists(eb.selectFrom('outbox_events').select('id')
        .whereRef('outbox_events.id', '=', 'workflow_webhook_receipts.event_id')
        .where('outbox_events.status', 'not in', ['failed', 'done'])))).execute();
    for (const row of ended) {
      if (row.status === 'running') {
        // Started, so it may already have sent an email or called another system: it waits for a
        // person's Continue, with the cut recorded and left open (design 2026-11-18, review R6).
        await db.transaction().execute(async trx => {
          const changed = await trx.updateTable('workflow_webhook_receipts')
            .set({ status: 'interrupted', reason: 'Worker ownership ended after execution started; outcome is uncertain', finished_at: new Date(), claim_token: null })
            .where('id', '=', row.id).where('status', '=', 'running').where('event_id', '=', row.event_id).returning('id').executeTakeFirst();
          if (changed) await recordCut(trx, row.id, row.event_updated_at ? new Date(row.event_updated_at) : new Date(), 'lease-expired', null);
        });
        continue;
      }
      // Never started, so running it cannot do anything twice: requeue it with a fresh event and
      // record the cut as carried on (review R11). After MAX_REQUEUES it waits for Continue, with the
      // cut left open (re-review R11).
      const cuts = await db.selectFrom('job_interruptions').select(eb => eb.fn.countAll<string>().as('n'))
        .where('job_kind', '=', 'workflow-receipt').where('job_id', '=', row.id).executeTakeFirstOrThrow();
      await db.transaction().execute(async trx => {
        if (Number(cuts.n) >= MAX_REQUEUES) {
          const changed = await trx.updateTable('workflow_webhook_receipts')
            .set({ status: 'interrupted', reason: `Dispatch ended before execution ${MAX_REQUEUES + 1} times; no workflow started. Use Continue to run it.`, finished_at: new Date(), claim_token: null })
            .where('id', '=', row.id).where('status', '=', 'queued').where('event_id', '=', row.event_id).returning('id').executeTakeFirst();
          if (changed) await recordCut(trx, row.id, new Date(), 'attempts-exhausted', null);
          return;
        }
        const eventId = randomUUID();
        const moved = await trx.updateTable('workflow_webhook_receipts').set({ event_id: eventId })
          .where('id', '=', row.id).where('status', '=', 'queued').where('event_id', '=', row.event_id).returning('id').executeTakeFirst();
        if (!moved) return;
        await trx.insertInto('outbox_events').values({ id: eventId, type: EVENT, payload: JSON.stringify({ receiptId: row.id }), claim_token: null, last_error: null, batch_id: null }).execute();
        const now = new Date();
        await recordCut(trx, row.id, now, 'attempts-exhausted', now);
        await sql`select pg_notify('openldr_events', ${EVENT})`.execute(trx);
      });
    }
  }
  /** An interrupted receipt of this workflow, and whether the workflow changed since it was accepted. */
  async function waiting(workflowId: string, id: string) {
    await reconcile([id]);
    const row = await db.selectFrom('workflow_webhook_receipts').select(['workflow_id', 'status', 'input', 'files', 'definition_digest']).where('id', '=', id).executeTakeFirst();
    if (!row || row.workflow_id !== workflowId || row.status !== 'interrupted') return 'not-waiting' as const;
    const wf = await db.selectFrom('workflows').select('definition').where('id', '=', workflowId).executeTakeFirst();
    const definitionChanged = !wf || digest(WorkflowDefinitionSchema.parse(parseJson(wf.definition))) !== row.definition_digest;
    return { row, definitionChanged };
  }
  /** Records a cut of a receipt in job_interruptions; `resumedAt` set means it carried on by itself. */
  async function recordCut(trx: Kysely<InternalSchema>, id: string, at: Date, cause: string, resumedAt: Date | null) {
    await trx.insertInto('job_interruptions').values({
      id: randomUUID(), job_kind: 'workflow-receipt', job_id: id, phase: null, at, cause,
      resumed_at: resumedAt, resumed_by: resumedAt ? 'self' : null, continued_as: null,
    }).onConflict(oc => oc.columns(['job_kind', 'job_id', 'at']).doNothing()).execute();
  }
  async function dispatch(id: string, delivery: { id: string; claimToken: string }): Promise<void> {
    const start = await db.transaction().execute(async trx => {
      // Lock outbox first, matching completion, so ownership cannot change during decisions.
      const identity = await trx.selectFrom('workflow_webhook_receipts').select('event_id').where('id', '=', id).executeTakeFirst();
      if (!identity || identity.event_id !== delivery.id) return;
      const event = await trx.selectFrom('outbox_events').selectAll().where('id', '=', identity.event_id).forUpdate().executeTakeFirst();
      if (!event || event.status !== 'processing' || event.claim_token !== delivery.claimToken) return;
      const row = await trx.selectFrom('workflow_webhook_receipts').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row) return;
      if (row.status === 'running') {
        if (row.claim_token !== event.claim_token) {
          await trx.updateTable('workflow_webhook_receipts').set({ status: 'interrupted', reason: 'Worker ownership changed after execution started; outcome is uncertain', finished_at: new Date(), claim_token: null }).where('id', '=', id).execute();
          // The bus already moved the event's last update to this claim, so the old owner's last
          // word is gone: the cut is dated when CE found it (re-review R6).
          await recordCut(trx as unknown as Kysely<InternalSchema>, id, new Date(), 'lease-expired', null);
        }
        return;
      }
      if (row.status !== 'queued') return;
      const wfRow = await trx.selectFrom('workflows').selectAll().where('id', '=', row.workflow_id).forShare().executeTakeFirst();
      const definition = wfRow ? WorkflowDefinitionSchema.parse(parseJson(wfRow.definition)) : undefined;
      const reason = !wfRow ? 'Workflow was deleted before execution' : !wfRow.enabled ? 'Workflow was disabled before execution' : digest(definition) !== row.definition_digest ? 'Workflow definition changed before execution' : null;
      if (reason) {
        await trx.updateTable('workflow_webhook_receipts').set({ status: 'cancelled', reason, finished_at: new Date() }).where('id', '=', id).execute();
        return;
      }
      await trx.updateTable('workflow_webhook_receipts').set({ status: 'running', started_at: new Date(), claim_token: event.claim_token }).where('id', '=', id).execute();
      return { row, definition: definition!, token: event.claim_token };
    });
    if (!start) return;
    // Unexpected execution/persistence errors leave the durable start intact. Redelivery must not replay it.
    const run = await deps.execute(start.definition, start.row.run_id, start.row.workflow_id, parseJson(start.row.input), parseJson<Record<string, BinaryRef>>(start.row.files));
    // Full node results remain in workflow_runs, outside paginated receipt metadata.
    // Held counts do ride along: the webhook answer must say what was held, even on a 200.
    const results = (run.result as { results?: { meta?: unknown }[] } | null | undefined)?.results ?? [];
    const held = heldSummary(results.map((r) => r.meta));
    const outcome: RunOutcome = { runId: start.row.run_id, correlationId: run.correlationId ?? null, status: run.status, error: run.error, nodeMeta: {}, ...(held ? { held } : {}) };
    await db.transaction().execute(async trx => {
      const event = await trx.selectFrom('outbox_events').selectAll().where('id', '=', start.row.event_id).forUpdate().executeTakeFirst();
      if (event?.status !== 'processing' || event.claim_token !== start.token) return;
      const changed = await trx.updateTable('workflow_webhook_receipts').set({ status: run.status, finished_at: new Date(), claim_token: null, outcome: JSON.stringify(outcome) }).where('id', '=', id).where('status', '=', 'running').where('claim_token', '=', start.token).returning('id').executeTakeFirst();
      if (changed) await createWorkflowRunStore(trx).record({ ...run, id: start.row.run_id, workflowId: start.row.workflow_id, triggerSource: 'webhook' });
    });
  }
  return {
    async accept(request) {
      const key = request.idempotencyKey;
      if (key !== undefined && !/^[\x21-\x7e]{1,200}$/.test(key)) throw new WebhookAcceptanceError('Idempotency-Key must contain 1 to 200 visible ASCII characters');
      const input = cleanInput(request.input);
      const hash = await webhookInputDigest(input, request.files, deps.readBinary);
      return db.transaction().execute(async trx => {
        const existing = key === undefined ? undefined : await trx.selectFrom('workflow_webhook_receipts').select([...publicColumns, 'input_digest']).where('workflow_id', '=', request.workflowId).where('idempotency_key', '=', key).executeTakeFirst();
        if (existing) {
          if (existing.input_digest !== hash) throw new WebhookIdempotencyConflictError();
          return { receipt: publicReceipt(existing), created: false };
        }
        const wf = await trx.selectFrom('workflows').selectAll().where('id', '=', request.workflowId).forShare().executeTakeFirst();
        if (!wf || !wf.enabled) throw new WebhookAcceptanceError('Workflow is unavailable', 404, 'WEBHOOK_WORKFLOW_UNAVAILABLE');
        const id = randomUUID();
        const eventId = randomUUID();
        const row = await trx.insertInto('workflow_webhook_receipts').values({ id, workflow_id: request.workflowId, event_id: eventId, run_id: randomUUID(), idempotency_key: key ?? null, input_digest: hash, definition_digest: digest(WorkflowDefinitionSchema.parse(parseJson(wf.definition))), input: JSON.stringify(input ?? null), files: JSON.stringify(request.files ?? {}), claim_token: null, started_at: null, finished_at: null, reason: null, outcome: null }).onConflict(oc => oc.columns(['workflow_id', 'idempotency_key']).doNothing()).returningAll().executeTakeFirst();
        if (!row) {
          const duplicate = await trx.selectFrom('workflow_webhook_receipts').select([...publicColumns, 'input_digest']).where('workflow_id', '=', request.workflowId).where('idempotency_key', '=', key!).executeTakeFirstOrThrow();
          if (duplicate.input_digest !== hash) throw new WebhookIdempotencyConflictError();
          return { receipt: publicReceipt(duplicate), created: false };
        }
        await trx.insertInto('outbox_events').values({ id: eventId, type: EVENT, payload: JSON.stringify({ receiptId: id }), claim_token: null, last_error: null, batch_id: null }).execute();
        // Wake the outbox worker now. Without this it finds the event only on its 2 second poll, and the
        // webhook caller waits for that poll. PostgreSQL delivers the notify only when this transaction
        // commits, so the worker never wakes before the row is visible. The poll stays as the fallback.
        await sql`select pg_notify('openldr_events', ${EVENT})`.execute(trx);
        return { receipt: publicReceipt(row), created: true };
      });
    },
    async continueCheck(workflowId, id) {
      const found = await waiting(workflowId, id);
      return found === 'not-waiting' ? found : { definitionChanged: found.definitionChanged };
    },
    async continueFrom(workflowId, id) {
      const found = await waiting(workflowId, id);
      if (found === 'not-waiting') return found;
      const { row, definitionChanged } = found;
      // A fixed key per interrupted receipt: a second Continue returns the same run (review R2).
      const { receipt } = await this.accept({ workflowId, input: parseJson(row.input), files: parseJson<Record<string, BinaryRef>>(row.files), idempotencyKey: `continue:${id}` });
      return { receipt, definitionChanged };
    },
    async get(id) {
      await reconcile([id]);
      const row = await db.selectFrom('workflow_webhook_receipts').select(publicColumns).where('id', '=', id).executeTakeFirst();
      return row ? publicReceipt(row) : undefined;
    },
    async list(workflowId, opts = {}) {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101 || !Number.isSafeInteger(offset) || offset < 0) throw new WebhookAcceptanceError('Invalid receipt pagination');
      const rows = await db.selectFrom('workflow_webhook_receipts').select(publicColumns).where('workflow_id', '=', workflowId).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).offset(offset).execute();
      const pending = rows.filter(r => r.status === 'running' || r.status === 'queued').map(r => r.id);
      await reconcile(pending);
      if (!pending.length) return rows.map(publicReceipt);
      const current = await db.selectFrom('workflow_webhook_receipts').select(publicColumns).where('id', 'in', rows.map(r => r.id)).execute();
      const byId = new Map(current.map(r => [r.id, r]));
      return rows.map(r => publicReceipt(byId.get(r.id) ?? r));
    },
    async register(eventing) { await eventing.subscribe(EVENT, async event => {
      const id = (event.payload as { receiptId?: unknown })?.receiptId;
      if (typeof id === 'string' && event.delivery) await dispatch(id, event.delivery);
    }); },
  };
}
