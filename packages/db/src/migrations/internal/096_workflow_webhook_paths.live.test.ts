import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CompiledQuery, Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from '../../schema/internal';
import * as workflows from './027_workflows';
import * as paths from './096_workflow_webhook_paths';
import { createWorkflowStore } from '../../../../workflows/src/store';

const url = process.env.WEBHOOK_TEST_DATABASE_URL;
describe.skipIf(!url)('webhook paths on isolated Postgres', () => {
  it('backfills batches, preserves conflicts, rolls back writes and uses the path index', async () => {
    const schema = `webhook_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    let lastQuery: { sql: string; parameters: readonly unknown[] } | undefined;
    const db = new Kysely<InternalSchema>({ log: event => { if (event.level === 'query') lastQuery = event.query; }, dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` }) }) });
    try {
      await workflows.up(db as Kysely<unknown>);
      await sql`insert into workflows(id,name,definition) select 'w' || n, 'w' || n, jsonb_build_object('nodes', jsonb_build_array(jsonb_build_object('id','n','type','webhook','data',jsonb_build_object('path','/path' || n || '/','secret','legacy'))),'edges','[]'::jsonb) from generate_series(1,1205) n`.execute(db);
      await sql`insert into workflows(id,name,definition) values ('duplicate','duplicate','{"nodes":[{"id":"a","type":"trigger","data":{"triggerType":"webhook","path":"/path1/"}},{"id":"b","type":"webhook","data":{"path":"path1"}}],"edges":[]}')`.execute(db);
      await paths.up(db as Kysely<unknown>);
      expect((await sql<{ count: number }>`select count(*)::int as count from workflow_webhook_paths`.execute(db)).rows[0].count).toBe(1206);
      const store = createWorkflowStore(db);
      expect(await store.findByWebhookPath('path1')).toHaveLength(2);
      const w = (await store.get('w2'))!;
      await sql`alter table workflow_webhook_paths add constraint reject_test_path check (path <> 'reject')`.execute(db);
      const changed = { ...w, definition: { nodes: [{ id: 'n', type: 'webhook', data: { path: 'reject' } }], edges: [] } };
      await expect(store.update(w.id, changed)).rejects.toThrow();
      expect((await store.get(w.id))?.definition).toEqual(w.definition);
      expect((await store.findByWebhookPath('path2'))[0].id).toBe('w2');
      await expect(store.create({ ...changed, id: 'failed-create' })).rejects.toThrow();
      expect(await store.get('failed-create')).toBeUndefined();
      await store.update(w.id, { ...changed, definition: { nodes: [{ id: 'n', type: 'webhook', data: { path: 'replacement' } }], edges: [] } });
      expect(await store.findByWebhookPath('path2')).toEqual([]);
      expect((await store.findByWebhookPath('replacement'))[0].id).toBe('w2');
      await store.remove(w.id);
      expect(await store.findByWebhookPath('replacement')).toEqual([]);
      await sql`analyze workflow_webhook_paths`.execute(db);
      await sql`analyze workflows`.execute(db);
      await store.findByWebhookPath('path1000');
      const lookup = lastQuery!;
      const plan = await db.executeQuery(CompiledQuery.raw('explain (format json) ' + lookup.sql, [...lookup.parameters]));
      expect(JSON.stringify(plan.rows)).toContain('idx_workflow_webhook_paths_path');
      expect(JSON.stringify(plan.rows)).toContain('Limit');
      await paths.down(db as Kysely<unknown>);
      expect(await store.get('w1')).toBeDefined();
    } finally {
      await db.destroy(); await admin.query(`drop schema ${schema} cascade`); await admin.end();
    }
  });
});
