import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { createInternalDb, createWorkflowSecretStore, type InternalDb } from '@openldr/db';
import { createSharedWebhookResolver, createWorkflowStore, type Workflow } from '@openldr/workflows';
import type { AppContext } from '@openldr/bootstrap';
import { up as workflowsUp } from '../../../packages/db/src/migrations/internal/027_workflows';
import { up as secretsUp } from '../../../packages/db/src/migrations/internal/053_workflow_secrets';
import { up as pathsUp } from '../../../packages/db/src/migrations/internal/096_workflow_webhook_paths';
import { registerWorkflowRoutes } from './workflows-routes';
import { registerErrorHandler } from './error-handler';

// Opt in only against a disposable database. Each test owns one isolated schema.
// Two listeners and pools exercise HTTP and PostgreSQL, within one Node process.
const databaseUrl = process.env.P14_TEST_DATABASE_URL;
const live = databaseUrl ? describe : describe.skip;

function workflow(id: string, path: string, secret?: string): Workflow {
  return {
    id, name: id, description: null, enabled: true, createdBy: null,
    definition: { nodes: [{ id: 'hook', type: 'trigger', data: {
      triggerType: 'webhook', path, ...(secret === undefined ? {} : { secret }),
    } }], edges: [] },
  };
}

live('webhook authentication across two HTTP instances on PostgreSQL', () => {
  let admin: InternalDb;
  let schema: string;
  const databases: InternalDb[] = [];
  const servers: FastifyInstance[] = [];
  const addresses: string[] = [];
  const runners: ReturnType<typeof vi.fn>[] = [];

  beforeEach(async () => {
    schema = `p14_http_${randomUUID().replaceAll('-', '')}`;
    admin = createInternalDb(databaseUrl!);
    await sql`create schema ${sql.id(schema)}`.execute(admin.db);
    const scopedUrl = new URL(databaseUrl!);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    const key = randomBytes(32).toString('base64');
    for (let index = 0; index < 2; index++) {
      const internal = createInternalDb(scopedUrl.toString());
      databases.push(internal);
      if (index === 0) {
        const migrationDb = internal.db as unknown as Kysely<unknown>;
        await workflowsUp(migrationDb);
        await secretsUp(internal.db);
        await pathsUp(migrationDb);
      }
      const store = createWorkflowStore(internal.db);
      const secretStore = createWorkflowSecretStore(internal.db);
      const runAndRecord = vi.fn(async () => ({
        runId: `instance-${index}-run`, correlationId: null, status: 'completed', error: null,
      }));
      runners.push(runAndRecord);
      const ctx = {
        workflows: {
          store, secretStore,
          // P14 tests configuration lookup; P05 tests durable dispatch separately.
          receipts: {
            accept: async ({workflowId}: {workflowId:string}) => {
              const outcome = await runAndRecord();
              return {created:true,receipt:{id:'receipt',workflowId,status:'completed',runId:outcome.runId,outcome}};
            },
          },
          webhooks: createSharedWebhookResolver({
            findByPath: (path) => store.findByWebhookPath(path),
            resolveRef: (ref) => secretStore.resolveIfAvailable(ref, key),
          }),
          schedules: { removeForWorkflow: async () => {}, upsert: async () => {} },
          runner: { runAndRecord, setIngestWorkflowIds() {}, setEventWorkflowIds() {} },
          listeners: { reconcile: async () => {} },
        },
        cfg: { SECRETS_ENCRYPTION_KEY: key, WORKFLOW_FILE_MAX_BYTES: 52_428_800 },
        audit: { record: async () => {} },
        logger: { warn() {}, error() {}, info() {} },
      } as unknown as AppContext;
      const app = Fastify();
      servers.push(app);
      app.addHook('onRequest', async (req) => {
        req.user = {
          id: 'p14-operator', username: 'p14-operator', displayName: null,
          roles: ['lab_manager'],
          capabilities: ['workflows.view', 'workflows.edit', 'workflows.run', 'workflows.manage_secrets'],
        };
      });
      registerErrorHandler(app);
      registerWorkflowRoutes(app, ctx);
      addresses.push(await app.listen({ host: '127.0.0.1', port: 0 }));
    }
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((app) => app.close()));
    await Promise.all(databases.splice(0).map((db) => db.close()));
    addresses.length = 0;
    runners.length = 0;
    if (admin) {
      try { await sql`drop schema if exists ${sql.id(schema)} cascade`.execute(admin.db); }
      finally { await admin.close(); }
    }
  });

  async function request(index: number, method: string, path: string, body?: unknown, token?: string) {
    const response = await fetch(`${addresses[index]}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token === undefined ? {} : { 'x-webhook-token': token }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }

  async function save(value: Workflow, create = false) {
    const result = await request(0, create ? 'POST' : 'PUT',
      create ? '/api/workflows' : `/api/workflows/${value.id}`, value);
    expect(result, 'workflow edit must complete before webhook requests').toMatchObject({ status: 200 });
    return result.body as Workflow;
  }

  async function both(path: string, token: string | undefined, status: number) {
    for (let index = 0; index < 2; index++) {
      const before = runners[index].mock.calls.length;
      const result = await request(index, 'POST', `/api/workflows/hooks/${path}`, { event: 'test' }, token);
      expect(result.status, `instance ${index}: ${JSON.stringify(result.body)}`).toBe(status);
      expect(runners[index].mock.calls.length).toBe(before + (status === 200 ? 1 : 0));
      if (status === 200) expect(result.body).toEqual({
        ok: true, runId: `instance-${index}-run`, correlationId: null,
      });
    }
  }

  it('observes secret rotation, path rename, disable and delete immediately after API edits', async () => {
    await save(workflow('rotation', '/initial/', 'old-token'), true);
    await both('initial', 'old-token', 200);
    const rotated = await save(workflow('rotation', '/initial/', 'new-token'));
    expect(rotated.definition.nodes[0].data.secret).toEqual({ secretRef: expect.any(String) });
    await both('initial', 'old-token', 401);
    await both('initial', 'new-token', 200);
    const renamed = await save(workflow('rotation', '/renamed/', 'new-token'));
    await both('initial', 'new-token', 404);
    await both('renamed', 'new-token', 200);
    await save({ ...renamed, enabled: false });
    await both('renamed', 'new-token', 404);
    await save(renamed);
    await both('renamed', 'new-token', 200);
    expect((await request(0, 'DELETE', '/api/workflows/rotation')).status).toBe(200);
    await both('renamed', 'new-token', 404);
  });

  it('denies unknown paths, absent or unreadable secrets, conflicts and database lookup failure', async () => {
    await both('unknown', 'token', 404);
    await save(workflow('absent', 'absent'), true);
    await both('absent', 'token', 401);
    await save(workflow('unreadable', 'unreadable', 'token'), true);
    await databases[0].db.deleteFrom('workflow_secrets').where('workflow_id', '=', 'unreadable').execute();
    await both('unreadable', 'token', 401);
    await save(workflow('first', 'conflict', 'token'), true);
    await save(workflow('second', '/conflict/', 'token'), true);
    await both('conflict', 'token', 503);
    await save(workflow('healthy', 'healthy', 'token'), true);
    await both('healthy', 'token', 200);
    await sql`alter table workflow_webhook_paths rename to unavailable_webhook_paths`.execute(databases[0].db);
    try {
      await both('healthy', 'token', 503);
      for (let index = 0; index < 2; index++) {
        const result = await request(index, 'POST', '/api/workflows/hooks/healthy', {}, 'token');
        expect(result.status).toBe(503);
        expect(JSON.stringify(result.body)).not.toMatch(/relation|workflow_webhook_paths|select|token|p14_http/i);
      }
    } finally {
      await sql`alter table unavailable_webhook_paths rename to workflow_webhook_paths`.execute(databases[0].db);
    }
    await both('healthy', 'token', 200);
    await sql`alter table workflow_secrets rename to unavailable_workflow_secrets`.execute(databases[0].db);
    try {
      await both('healthy', 'token', 503);
    } finally {
      await sql`alter table unavailable_workflow_secrets rename to workflow_secrets`.execute(databases[0].db);
    }
    await both('healthy', 'token', 200);
  });
});
