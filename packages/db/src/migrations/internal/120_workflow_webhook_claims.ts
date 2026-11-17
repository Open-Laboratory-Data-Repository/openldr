import type { Kysely } from 'kysely';

/**
 * One enabled workflow per webhook path, held by the database itself.
 *
 * `workflow_webhook_paths` lists every workflow's paths and allows two workflows on one path. Two
 * enabled ones make the path unavailable to both, so a save that would cause that is refused. A check
 * in the route cannot stop two saves that arrive together, on one server or on two. A row here, keyed
 * by the path, can: the second insert fails, whichever replica sends it. The store writes a claim only
 * for an enabled workflow and removes it when the workflow is disabled or deleted.
 *
 * Existing data: each path of an enabled workflow is claimed. Where two enabled workflows already
 * share a path, the one with the lower id gets the claim and nothing else changes: the path stays
 * unavailable until one of them is saved on another path or disabled, as it is today.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('workflow_webhook_claims').ifNotExists()
    .addColumn('path', 'text', c => c.primaryKey())
    .addColumn('workflow_id', 'text', c => c.notNull().references('workflows.id').onDelete('cascade'))
    .execute();
  await db.schema.createIndex('idx_workflow_webhook_claims_workflow').ifNotExists()
    .on('workflow_webhook_claims').column('workflow_id').execute();

  const tables = db as Kysely<{
    workflows: { id: string; enabled: boolean };
    workflow_webhook_paths: { workflow_id: string; path: string };
    workflow_webhook_claims: { path: string; workflow_id: string };
  }>;
  const rows = await tables.selectFrom('workflow_webhook_paths')
    .innerJoin('workflows', 'workflows.id', 'workflow_webhook_paths.workflow_id')
    .select(['workflow_webhook_paths.path as path', 'workflow_webhook_paths.workflow_id as workflow_id'])
    .where('workflows.enabled', '=', true)
    .orderBy('workflow_webhook_paths.workflow_id')
    .execute();
  for (const row of rows) {
    await tables.insertInto('workflow_webhook_claims').values(row)
      .onConflict(oc => oc.column('path').doNothing()).execute();
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflow_webhook_claims').ifExists().execute();
}
