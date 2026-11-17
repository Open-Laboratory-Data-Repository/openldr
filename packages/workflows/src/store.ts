import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type Workflow, WorkflowSchema } from './types';
import { normalizeWebhookPath, webhookNodePath, WebhookPathClaimedError, WorkflowChangedError } from './shared-webhook-resolver';
import { sql } from 'kysely';

function toRow(w: Workflow) {
  return {
    id: w.id,
    name: w.name,
    description: w.description ?? null,
    definition: JSON.stringify(w.definition),
    enabled: w.enabled,
    created_by: w.createdBy ?? null,
  };
}

function fromRow(r: Record<string, unknown>): Workflow {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? { nodes: [], edges: [] }));
  return WorkflowSchema.parse({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    definition: parse(r.definition),
    enabled: r.enabled == null ? true : Boolean(r.enabled),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
    version: r.version == null ? undefined : Number(r.version),
  });
}

export interface WorkflowStore {
  list(): Promise<Workflow[]>;
  findByWebhookPath(path: string): Promise<Workflow[]>;
  get(id: string): Promise<Workflow | undefined>;
  create(w: Workflow): Promise<Workflow>;
  /**
   * Store a new version. With `expectedVersion`, write only if that is still the stored version,
   * else throw `WorkflowChangedError`: the save was based on a version another save has replaced.
   */
  update(id: string, w: Workflow, opts?: { expectedVersion?: number }): Promise<Workflow>;
  remove(id: string): Promise<void>;
}

export function createWorkflowStore(db: Kysely<InternalSchema>): WorkflowStore {
  const t = () => db.selectFrom('workflows');
  const store: WorkflowStore = {
    async list() {
      const rows = await t().selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async findByWebhookPath(path) {
      const rows = await db.selectFrom('workflow_webhook_paths')
        .innerJoin('workflows', 'workflows.id', 'workflow_webhook_paths.workflow_id')
        .selectAll('workflows').where('workflow_webhook_paths.path', '=', normalizeWebhookPath(path))
        .where('workflows.enabled', '=', true).limit(2).execute();
      return rows.map(r => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await t().selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(w) {
      const parsed = WorkflowSchema.parse(w);
      await claiming(db, parsed, () => db.transaction().execute(async trx => {
        await assertPathsFree(trx, parsed);
        await trx.insertInto('workflows').values(toRow(parsed) as never).execute();
        await replacePaths(trx, parsed);
        await replaceClaims(trx, parsed);
      }));
      return (await store.get(w.id))!;
    },
    async update(id, w, opts) {
      const parsed = WorkflowSchema.parse({ ...w, id });
      const expected = opts?.expectedVersion;
      await claiming(db, parsed, () => db.transaction().execute(async trx => {
        await assertPathsFree(trx, parsed);
        let q = trx.updateTable('workflows').set({ ...toRow(parsed), version: sql`version + 1` } as never).where('id', '=', id);
        // Compare and set: a second save from the same version finds the version raised and writes nothing.
        if (expected !== undefined) q = q.where('version', '=', expected);
        const updated = await q.executeTakeFirst();
        if (updated.numUpdatedRows === 0n && expected !== undefined
          && await trx.selectFrom('workflows').select('id').where('id', '=', id).executeTakeFirst()) {
          throw new WorkflowChangedError();
        }
        if (updated.numUpdatedRows > 0n) {
          await replacePaths(trx, parsed);
          await replaceClaims(trx, parsed);
        }
      }));
      return (await store.get(id))!;
    },
    async remove(id) {
      await db.deleteFrom('workflows').where('id', '=', id).execute();
    },
  };
  return store;
}

function pathsOf(workflow: Workflow): string[] {
  return [...new Set(workflow.definition.nodes.map(webhookNodePath).filter((path): path is string => !!path))];
}

/** The enabled workflow, other than `selfId`, that holds one of `paths`: the first found, by path. */
async function heldBy(db: Kysely<InternalSchema>, paths: string[], selfId: string): Promise<{ path: string; name: string } | undefined> {
  if (!paths.length) return undefined;
  return db.selectFrom('workflow_webhook_claims')
    .innerJoin('workflows', 'workflows.id', 'workflow_webhook_claims.workflow_id')
    .select(['workflow_webhook_claims.path as path', 'workflows.name as name'])
    .where('workflow_webhook_claims.path', 'in', paths)
    .where('workflow_webhook_claims.workflow_id', '!=', selfId)
    .orderBy('workflow_webhook_claims.path')
    .executeTakeFirst();
}

/**
 * An enabled workflow claims each of its webhook paths (migration 120). The path is the table's key,
 * so a second claim fails in the database even when two saves arrive together on two replicas. A
 * disabled workflow claims nothing; a deleted one loses its claims by cascade.
 */
async function replaceClaims(trx: Kysely<InternalSchema>, workflow: Workflow): Promise<void> {
  await trx.deleteFrom('workflow_webhook_claims').where('workflow_id', '=', workflow.id).execute();
  if (!workflow.enabled) return;
  const paths = pathsOf(workflow);
  if (!paths.length) return;
  await trx.insertInto('workflow_webhook_claims').values(paths.map(path => ({ path, workflow_id: workflow.id }))).execute();
}

/** Refuse before anything is written, so a refused save changes nothing on any database. */
async function assertPathsFree(trx: Kysely<InternalSchema>, workflow: Workflow): Promise<void> {
  if (!workflow.enabled) return;
  const held = await heldBy(trx, pathsOf(workflow), workflow.id);
  if (held) throw new WebhookPathClaimedError(held.path, held.name);
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown };
  return e?.code === '23505' || (typeof e?.message === 'string' && /duplicate key|unique constraint/i.test(e.message));
}

/**
 * Run a save; when the database refuses its claim because another save took the path at the same
 * moment, report it as the same refusal a sequential save gets, naming the holder.
 */
async function claiming(db: Kysely<InternalSchema>, workflow: Workflow, save: () => Promise<void>): Promise<void> {
  try {
    await save();
  } catch (err) {
    if (!(err instanceof WebhookPathClaimedError) && workflow.enabled && isUniqueViolation(err)) {
      const held = await heldBy(db, pathsOf(workflow), workflow.id);
      if (held) throw new WebhookPathClaimedError(held.path, held.name);
    }
    throw err;
  }
}

async function replacePaths(db: Kysely<InternalSchema>, workflow: Workflow): Promise<void> {
  await db.deleteFrom('workflow_webhook_paths').where('workflow_id', '=', workflow.id).execute();
  const paths = pathsOf(workflow);
  if (paths.length) await db.insertInto('workflow_webhook_paths')
    .values(paths.map(path => ({ workflow_id: workflow.id, path }))).execute();
}
