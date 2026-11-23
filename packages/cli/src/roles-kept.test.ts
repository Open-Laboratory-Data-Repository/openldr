import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';

// `roles grant` and `roles revoke` pass the role's stored keys back to the store. A role that holds
// a key the catalog no longer lists (the lab keys, once they move to a plugin) must still be
// editable, and must keep that key. These tests run the real store on pg-mem with every lab.* key
// dropped from the catalog.
vi.mock('@openldr/rbac', async () => {
  const actual = await vi.importActual<typeof import('@openldr/rbac')>('@openldr/rbac');
  return { ...actual, CAPABILITY_KEYS: actual.CAPABILITY_KEYS.filter((k) => !k.startsWith('lab.')) };
});

const mocks = vi.hoisted(() => ({
  appCtx: { roles: null as unknown, close: vi.fn() },
  createAppContext: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
  createDbContext: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

import { createRoleStore, type RoleStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { runRolesGrant, runRolesRevoke } from './roles';

describe('roles grant / revoke keep stored keys the catalog no longer lists', () => {
  let db: Kysely<never>;
  let store: RoleStore;
  let err: string;

  beforeEach(async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    err = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    const migrated = await makeMigratedDb();
    db = migrated as unknown as Kysely<never>;
    store = createRoleStore(migrated);
    const role = await store.create({ name: 'Bench', capabilities: ['forms.view'] });
    await migrated.insertInto('role_capabilities').values({ role_id: role.id, capability: 'lab.receive' }).execute();
    mocks.appCtx.roles = store;
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.destroy();
  });

  it('grant adds the key and keeps the stored lab key', async () => {
    const code = await runRolesGrant('bench', 'reports.view', { json: false });

    expect(code).toBe(0);
    const caps = (await store.getBySlug('bench'))!.capabilities;
    expect([...caps].sort()).toEqual(['forms.view', 'lab.receive', 'reports.view']);
  });

  it('revoke removes the key and keeps the stored lab key', async () => {
    const code = await runRolesRevoke('bench', 'forms.view', { json: false });

    expect(code).toBe(0);
    expect((await store.getBySlug('bench'))!.capabilities).toEqual(['lab.receive']);
  });

  it('revoke of the kept key says it is kept for a plugin and changes nothing', async () => {
    const code = await runRolesRevoke('bench', 'lab.receive', { json: false });

    expect(code).toBe(1);
    expect(err).toContain('lab.receive is kept for a plugin');
    expect(err).toContain('cannot be granted or revoked here');
    expect(err).not.toContain('unknown capability');
    expect([...(await store.getBySlug('bench'))!.capabilities].sort()).toEqual(['forms.view', 'lab.receive']);
  });

  it('revoke of a key the role does not hold and the catalog does not list is still unknown', async () => {
    const code = await runRolesRevoke('bench', 'bogus.key', { json: false });

    expect(code).toBe(1);
    expect(err).toContain('unknown capability: bogus.key');
  });
});
