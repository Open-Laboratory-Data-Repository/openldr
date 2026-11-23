import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import type { RoleRecord } from '@openldr/db';

// The Roles page saves a role by sending its whole capability list back, including any stored key
// the catalog no longer lists (the lab keys, once they move to a plugin). This runs the real store
// on pg-mem with every lab.* key dropped from the catalog, to show such a save works and keeps the key.
vi.mock('@openldr/rbac', async () => {
  const actual = await vi.importActual<typeof import('@openldr/rbac')>('@openldr/rbac');
  return { ...actual, CAPABILITY_KEYS: actual.CAPABILITY_KEYS.filter((k) => !k.startsWith('lab.')) };
});

import { createRoleStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { registerRolesRoutes } from './roles-routes';
import './auth-plugin';

async function setup() {
  const db = await makeMigratedDb();
  const roles = createRoleStore(db);
  const role = await roles.create({ name: 'Bench', capabilities: ['forms.view'] });
  await db.insertInto('role_capabilities').values({ role_id: role.id, capability: 'lab.receive' }).execute();
  const ctx = {
    roles,
    packItems: { owners: async () => new Map() },
    audit: { record: async (e: Record<string, unknown>) => ({ ...e, id: 'audit-1', occurredAt: new Date().toISOString() }) },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'actor-1', username: 'actor', displayName: null, roles: [], capabilities: ['roles.view', 'roles.manage'] };
  });
  registerRolesRoutes(app, ctx);
  return { db, app, roleId: role.id };
}

describe('PUT /api/roles/:id keeps stored keys the catalog no longer lists', () => {
  it('saves the list the page sends back and keeps the stored lab key', async () => {
    const { db, app, roleId } = await setup();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/roles/${roleId}`,
      payload: { capabilities: ['forms.view', 'lab.receive', 'reports.view'] },
    });

    expect(res.statusCode).toBe(200);
    expect([...(res.json() as RoleRecord).capabilities].sort()).toEqual(['forms.view', 'lab.receive', 'reports.view']);
    await db.destroy();
  });

  it('refuses a save that adds an unknown key, with 400', async () => {
    const { db, app, roleId } = await setup();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/roles/${roleId}`,
      payload: { capabilities: ['forms.view', 'lab.receive', 'bogus.key'] },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain('unknown capability: bogus.key');
    await db.destroy();
  });
});
