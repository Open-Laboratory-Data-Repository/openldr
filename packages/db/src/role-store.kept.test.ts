import { describe, it, expect, vi } from 'vitest';

// The lab keys are leaving the catalog for a plugin. A role that holds them must keep the stored
// rows, so the plugin picks them up later under the same keys. This file drops every lab.* key
// from the catalog the store sees, which is the state CE is moving to.
vi.mock('@openldr/rbac', async () => {
  const actual = await vi.importActual<typeof import('@openldr/rbac')>('@openldr/rbac');
  return { ...actual, CAPABILITY_KEYS: actual.CAPABILITY_KEYS.filter((k) => !k.startsWith('lab.')) };
});

import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createRoleStore } from './role-store';

async function roleWithStoredLabKey() {
  const db = await makeMigratedDb();
  const store = createRoleStore(db);
  const role = await store.create({ name: 'Bench', capabilities: ['forms.view'] });
  await db.insertInto('role_capabilities').values({ role_id: role.id, capability: 'lab.receive' }).execute();
  return { db, store, role };
}

describe('RoleStore keeps stored grants the catalog no longer lists', () => {
  it('an update that adds a key keeps the stored unlisted key', async () => {
    const { db, store, role } = await roleWithStoredLabKey();
    const before = (await store.get(role.id))!;

    const after = await store.update(role.id, { capabilities: [...before.capabilities, 'reports.view'] });

    expect([...after.capabilities].sort()).toEqual(['forms.view', 'lab.receive', 'reports.view']);
    await db.destroy();
  });

  it('an update that removes a key keeps the stored unlisted key', async () => {
    const { db, store, role } = await roleWithStoredLabKey();
    const before = (await store.get(role.id))!;

    const after = await store.update(role.id, { capabilities: before.capabilities.filter((c) => c !== 'forms.view') });

    expect(after.capabilities).toEqual(['lab.receive']);
    await db.destroy();
  });

  it('an update that leaves the unlisted key out of the list still keeps it', async () => {
    const { db, store, role } = await roleWithStoredLabKey();

    const after = await store.update(role.id, { capabilities: ['forms.view'] });

    expect([...after.capabilities].sort()).toEqual(['forms.view', 'lab.receive']);
    await db.destroy();
  });

  it('an update that adds an unknown key is refused', async () => {
    const { db, store, role } = await roleWithStoredLabKey();

    await expect(store.update(role.id, { capabilities: ['forms.view', 'lab.receive', 'bogus.key'] })).rejects.toThrow(
      'unknown capability: bogus.key',
    );
    expect([...(await store.get(role.id))!.capabilities].sort()).toEqual(['forms.view', 'lab.receive']);
    await db.destroy();
  });

  it('an unlisted key cannot be added to a role that does not hold it', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    const role = await store.create({ name: 'Bench', capabilities: ['forms.view'] });

    await expect(store.update(role.id, { capabilities: ['forms.view', 'lab.receive'] })).rejects.toThrow(
      'unknown capability: lab.receive',
    );
    await db.destroy();
  });

  it('diagnoseCapabilities lists the stored unlisted key under kept, not orphaned', async () => {
    const { db, store } = await roleWithStoredLabKey();

    const d = await store.diagnoseCapabilities();

    expect(d.kept).toEqual(['lab.receive']);
    expect(d.orphaned).toEqual([]);
    await db.destroy();
  });
});
