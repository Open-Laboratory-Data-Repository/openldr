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
  // As migration 120: the path is the key, so two enabled workflows cannot both claim it.
  await db.schema.createTable('workflow_webhook_claims')
    .addColumn('path', 'text', c => c.primaryKey())
    .addColumn('workflow_id', 'text', c => c.notNull().references('workflows.id').onDelete('cascade')).execute();
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
  // Three enabled workflows on one path: data from before migration 120, which a save now refuses.
  for (const id of ['w2', 'w3', 'w4']) {
    await db.insertInto('workflows').values({ id, name: id, definition: JSON.stringify(w.definition), enabled: true }).execute();
    await db.insertInto('workflow_webhook_paths').values({ workflow_id: id, path: 'old' }).execute();
  }
  expect(await store.findByWebhookPath('old')).toHaveLength(2);
  await store.update('w1', { ...w, enabled: false });
  expect(await store.findByWebhookPath('new')).toEqual([]);
  await store.remove('w2'); await store.remove('w3'); await store.remove('w4');
  expect(await store.findByWebhookPath('old')).toEqual([]);
});

describe('one enabled workflow per webhook path, held by the database', () => {
  const hook = (id: string, name: string, path: string, enabled = true) => ({
    id, name, description: null, enabled, createdBy: null,
    definition: { nodes: [{ id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { triggerType: 'webhook', path } }], edges: [] },
  }) as never;

  it('refuses a second enabled workflow on a path, naming the first, and stores nothing', async () => {
    const store = createWorkflowStore(db);
    await store.create(hook('wf-a', 'Lab A results', 'lab-a'));
    await expect(store.create(hook('wf-b', 'Lab A copy', '/lab-a/'))).rejects.toMatchObject({
      name: 'WebhookPathClaimedError', path: 'lab-a', workflowName: 'Lab A results',
    });
    expect(await store.get('wf-b')).toBeUndefined();
  });

  it('lets a disabled workflow share the path, refuses enabling it, and allows it on another path', async () => {
    const store = createWorkflowStore(db);
    await store.create(hook('wf-a', 'Lab A results', 'lab-a'));
    await store.create(hook('wf-c', 'Lab A copy', 'lab-a', false));
    await expect(store.update('wf-c', hook('wf-c', 'Lab A copy', 'lab-a'))).rejects.toMatchObject({ name: 'WebhookPathClaimedError' });
    expect((await store.get('wf-c'))!.enabled).toBe(false);
    await store.update('wf-c', hook('wf-c', 'Lab A copy', 'lab-c'));
    expect((await store.get('wf-c'))!.enabled).toBe(true);
  });

  it('frees the path when its workflow is disabled or deleted, and lets a workflow save again on its own path', async () => {
    const store = createWorkflowStore(db);
    await store.create(hook('wf-a', 'Lab A results', 'lab-a'));
    await store.update('wf-a', hook('wf-a', 'Lab A results, renamed', 'lab-a'));
    await store.update('wf-a', hook('wf-a', 'Lab A results', 'lab-a', false));
    await store.create(hook('wf-b', 'Lab B', 'lab-a'));
    await store.remove('wf-b');
    await store.create(hook('wf-d', 'Lab D', 'lab-a'));
    expect((await store.get('wf-d'))!.enabled).toBe(true);
  });

  it('lets only one of two saves made at the same moment claim a path', async () => {
    const store = createWorkflowStore(db);
    const results = await Promise.allSettled([
      store.create(hook('wf-x', 'Sender X', 'lab-x')),
      store.create(hook('wf-y', 'Sender Y', 'lab-x')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ name: 'WebhookPathClaimedError', path: 'lab-x' });
  });
});
