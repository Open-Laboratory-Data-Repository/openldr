import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createWorkflowStore } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('workflows')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('description', 'text')
    .addColumn('definition', 'jsonb')
    .addColumn('enabled', 'boolean')
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'text')
    .addColumn('updated_at', 'text')
    .execute();
  await db.schema.createTable('workflow_webhook_paths')
    .addColumn('workflow_id', 'text', c => c.notNull().references('workflows.id').onDelete('cascade'))
    .addColumn('path', 'text', c => c.notNull())
    .addPrimaryKeyConstraint('workflow_webhook_paths_pkey', ['workflow_id', 'path']).execute();
});

describe('WorkflowStore', () => {
  it('creates, lists, gets, updates, deletes', async () => {
    const store = createWorkflowStore(db);
    const created = await store.create({
      id: 'w1', name: 'Main', description: null,
      definition: { nodes: [], edges: [] }, enabled: true, createdBy: null,
    });
    expect(created.name).toBe('Main');
    expect((await store.list()).length).toBe(1);
    await store.update('w1', { ...created, name: 'Renamed' });
    expect((await store.get('w1'))?.name).toBe('Renamed');
    await store.remove('w1');
    expect(await store.get('w1')).toBeUndefined();
  });
});

it('keeps normalized webhook paths current and limits enabled candidates', async () => {
  const store = createWorkflowStore(db);
  const w = { id: 'w1', name: 'w1', description: null, createdBy: null, enabled: true, definition: { nodes: [{ id: 'n', type: 'trigger', data: { triggerType: 'webhook', path: '/old/' } }], edges: [] } };
  await store.create(w);
  expect((await store.findByWebhookPath('old')).map(w => w.id)).toEqual(['w1']);
  await store.update('w1', { ...w, definition: { nodes: [{ id: 'n', type: 'webhook', data: { path: '/new/' } }], edges: [] } });
  expect(await store.findByWebhookPath('old')).toEqual([]);
  expect((await store.findByWebhookPath('/new/')).map(w => w.id)).toEqual(['w1']);
  for (const id of ['w2', 'w3', 'w4']) await store.create({ ...w, id });
  expect(await store.findByWebhookPath('old')).toHaveLength(2);
  await store.update('w1', { ...w, enabled: false });
  expect(await store.findByWebhookPath('new')).toEqual([]);
  await store.remove('w2'); await store.remove('w3'); await store.remove('w4');
  expect(await store.findByWebhookPath('old')).toEqual([]);
});
