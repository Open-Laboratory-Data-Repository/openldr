import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { createInternalDb, type InternalDb, type InternalSchema } from '@openldr/db';
import { createWorkflowStore, type Workflow } from '@openldr/workflows';
import * as workflows from '../../../packages/db/src/migrations/internal/027_workflows';
import * as paths from '../../../packages/db/src/migrations/internal/096_workflow_webhook_paths';
import * as claims from '../../../packages/db/src/migrations/internal/120_workflow_webhook_claims';
import * as version from '../../../packages/db/src/migrations/internal/121_workflow_version';

// Two saves that arrive together, each through its own connection pool, as two server replicas
// would send them. Real PostgreSQL only: pg-mem cannot run two transactions at once.
const url = process.env.WEBHOOK_TEST_DATABASE_URL;

const hook = (id: string, path: string, enabled: boolean): Workflow => ({
  id, name: id, description: null, enabled, createdBy: null,
  definition: { nodes: [{ id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { triggerType: 'webhook', path } }], edges: [] },
});

describe.skipIf(!url)('webhook path claims on disposable PostgreSQL', () => {
  let admin: InternalDb, replicaA: InternalDb, replicaB: InternalDb, schema: string;
  beforeEach(async () => {
    schema = 'claims_' + randomUUID().replaceAll('-', '');
    admin = createInternalDb(url!);
    await sql`create schema ${sql.id(schema)}`.execute(admin.db);
    const scoped = new URL(url!);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    replicaA = createInternalDb(scoped.toString());
    replicaB = createInternalDb(scoped.toString());
    for (const m of [workflows, paths, claims, version]) await m.up(replicaA.db as Kysely<unknown>);
  });
  afterEach(async () => {
    await replicaA?.close();
    await replicaB?.close();
    if (admin) {
      await sql`drop schema ${sql.id(schema)} cascade`.execute(admin.db);
      await admin.close();
    }
  });

  const enabledOn = async (db: Kysely<InternalSchema>, path: string) =>
    (await createWorkflowStore(db).findByWebhookPath(path)).length;

  it('lets exactly one of two concurrent creates claim a path, 25 times over', async () => {
    const a = createWorkflowStore(replicaA.db), b = createWorkflowStore(replicaB.db);
    for (let i = 0; i < 25; i++) {
      const path = `race-${i}`;
      const results = await Promise.allSettled([a.create(hook(`a-${i}`, path, true)), b.create(hook(`b-${i}`, path, true))]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ name: 'WebhookPathClaimedError', path });
      expect(await enabledOn(replicaA.db, path)).toBe(1);
    }
  });

  it('lets exactly one of two concurrent enables claim a path, 25 times over', async () => {
    const a = createWorkflowStore(replicaA.db), b = createWorkflowStore(replicaB.db);
    for (let i = 0; i < 25; i++) {
      const path = `enable-${i}`;
      await a.create(hook(`a-${i}`, path, false));
      await a.create(hook(`b-${i}`, path, false));
      const results = await Promise.allSettled([a.update(`a-${i}`, hook(`a-${i}`, path, true)), b.update(`b-${i}`, hook(`b-${i}`, path, true))]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ name: 'WebhookPathClaimedError', path });
      expect(await enabledOn(replicaA.db, path)).toBe(1);
    }
  });

  it('lets exactly one of two concurrent updates from one version land, 25 times over', async () => {
    const a = createWorkflowStore(replicaA.db), b = createWorkflowStore(replicaB.db);
    for (let i = 0; i < 25; i++) {
      const id = `v-${i}`;
      await a.create(hook(id, `version-${i}`, false));
      const base = (await a.get(id))!.version!;
      const results = await Promise.allSettled([
        a.update(id, { ...hook(id, `version-${i}`, false), name: 'from A' }, { expectedVersion: base }),
        b.update(id, { ...hook(id, `version-${i}`, false), name: 'from B' }, { expectedVersion: base }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ name: 'WorkflowChangedError' });
      expect((await a.get(id))!.version).toBe(base + 1);
    }
  });
});
