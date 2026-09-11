import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('workflow_webhook_paths').ifNotExists()
    .addColumn('workflow_id', 'text', c => c.notNull().references('workflows.id').onDelete('cascade'))
    .addColumn('path', 'text', c => c.notNull())
    .addPrimaryKeyConstraint('workflow_webhook_paths_pkey', ['workflow_id', 'path'])
    .execute();
  await db.schema.createIndex('idx_workflow_webhook_paths_path').ifNotExists()
    .on('workflow_webhook_paths').column('path').execute();

  // Keep migration extraction independent of application code that may change later.
  const tables = db as Kysely<{ workflows: { id: string; definition: unknown }; workflow_webhook_paths: { workflow_id: string; path: string } }>;
  let cursor: string | undefined;
  for (;;) {
    let query = tables.selectFrom('workflows').select(['id', 'definition']).orderBy('id').limit(500);
    if (cursor !== undefined) query = query.where('id', '>', cursor);
    const rows = await query.execute();
    if (!rows.length) break;
    for (const row of rows) {
      const definition = typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition;
      const nodes = definition && typeof definition === 'object' && Array.isArray(definition.nodes) ? definition.nodes : [];
      const paths = new Set<string>();
      for (const node of nodes) {
        if (node?.type !== 'webhook' && !(node?.type === 'trigger' && node.data?.triggerType === 'webhook')) continue;
        const path = node.data?.path;
        if (typeof path !== 'string' || !path.trim()) continue;
        const normalized = path.replace(/^\/+/, '').replace(/\/+$/, '');
        if (normalized) paths.add(normalized);
      }
      if (paths.size) await tables.insertInto('workflow_webhook_paths')
        .values([...paths].map(path => ({ workflow_id: row.id, path })))
        .onConflict(oc => oc.columns(['workflow_id', 'path']).doNothing()).execute();
    }
    cursor = rows[rows.length - 1].id;
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflow_webhook_paths').ifExists().execute();
}
