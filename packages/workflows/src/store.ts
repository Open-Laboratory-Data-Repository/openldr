import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type Workflow, WorkflowSchema } from './types';
import { normalizeWebhookPath, webhookNodePath } from './shared-webhook-resolver';

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
  });
}

export interface WorkflowStore {
  list(): Promise<Workflow[]>;
  findByWebhookPath(path: string): Promise<Workflow[]>;
  get(id: string): Promise<Workflow | undefined>;
  create(w: Workflow): Promise<Workflow>;
  update(id: string, w: Workflow): Promise<Workflow>;
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
      await db.transaction().execute(async trx => {
        await trx.insertInto('workflows').values(toRow(parsed) as never).execute();
        await replacePaths(trx, parsed);
      });
      return (await store.get(w.id))!;
    },
    async update(id, w) {
      const parsed = WorkflowSchema.parse({ ...w, id });
      await db.transaction().execute(async trx => {
        const updated = await trx.updateTable('workflows').set(toRow(parsed) as never)
          .where('id', '=', id).executeTakeFirst();
        if (updated.numUpdatedRows > 0n) await replacePaths(trx, parsed);
      });
      return (await store.get(id))!;
    },
    async remove(id) {
      await db.deleteFrom('workflows').where('id', '=', id).execute();
    },
  };
  return store;
}

async function replacePaths(db: Kysely<InternalSchema>, workflow: Workflow): Promise<void> {
  await db.deleteFrom('workflow_webhook_paths').where('workflow_id', '=', workflow.id).execute();
  const paths = [...new Set(workflow.definition.nodes.map(webhookNodePath).filter((path): path is string => !!path))];
  if (paths.length) await db.insertInto('workflow_webhook_paths')
    .values(paths.map(path => ({ workflow_id: workflow.id, path }))).execute();
}
