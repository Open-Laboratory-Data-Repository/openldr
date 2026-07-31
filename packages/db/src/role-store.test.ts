import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createRoleStore } from './role-store';

describe('RoleStore', () => {
  it('seedSystemRoles is idempotent and creates 5 roles with preset caps', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    await store.seedSystemRoles(); // twice — no duplicates
    const roles = await store.list();
    expect(roles.length).toBe(5);
    const admin = roles.find((r) => r.slug === 'lab_admin')!;
    expect(admin.isSystem).toBe(true);
    expect(admin.locked).toBe(true);
    expect(admin.capabilities).toContain('roles.manage');
    await db.destroy();
  });

  it('resolveCapabilities returns the union across assigned roles', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const analyst = (await store.getBySlug('data_analyst'))!;
    const auditor = (await store.getBySlug('system_auditor'))!;
    await store.assignRole('sub-x', analyst.id);
    await store.assignRole('sub-x', auditor.id);
    const caps = await store.resolveCapabilities('sub-x');
    expect(caps).toContain('query.run'); // from analyst
    expect(caps).toContain('audit.view'); // from auditor
    expect(new Set(caps).size).toBe(caps.length); // deduped
    await db.destroy();
  });

  it('create rejects unknown capability', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await expect(store.create({ name: 'X', capabilities: ['not.a.cap'] })).rejects.toThrow();
    await db.destroy();
  });

  it('cannot edit or delete the locked administrator role', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    await expect(store.update(admin.id, { capabilities: ['forms.view'] })).rejects.toThrow();
    await expect(store.remove(admin.id)).rejects.toThrow();
    await db.destroy();
  });

  it('cannot unassign the last roles.manage holder', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    await store.assignRole('sub-admin', admin.id);
    await expect(store.unassignRole('sub-admin', admin.id)).rejects.toThrow();
    await db.destroy();
  });

  it('backfillUserFromRoleNames maps token role names to system roles once', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    await store.backfillUserFromRoleNames('sub-y', ['lab_manager', 'unknown_role']);
    const caps = await store.resolveCapabilities('sub-y');
    expect(caps).toContain('workflows.edit');
    await db.destroy();
  });

  it('remove rejects a non-locked system role', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const manager = (await store.getBySlug('lab_manager'))!;
    await expect(store.remove(manager.id)).rejects.toThrow();
    await db.destroy();
  });

  it('remove rejects deleting the last custom role granting roles.manage', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    const custom = await store.create({ name: 'Super Manager', capabilities: ['roles.manage'] });
    await expect(store.remove(custom.id)).rejects.toThrow();
    await db.destroy();
  });

  it('setUserRoles rejects (without mutating) a write that would leave zero roles.manage holders', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    const technician = (await store.getBySlug('lab_technician'))!;
    // sub-admin is the only holder of roles.manage.
    await store.assignRole('sub-admin', admin.id);

    await expect(store.setUserRoles('sub-admin', [technician.id])).rejects.toThrow();

    // The failed write must not have partially applied.
    const rolesAfter = await store.rolesForUser('sub-admin');
    expect(rolesAfter.map((r) => r.slug)).toEqual(['lab_admin']);
    const caps = await store.resolveCapabilities('sub-admin');
    expect(caps).toContain('roles.manage');
    await db.destroy();
  });

  it('remove rejects deleting a custom role that is the only actual roles.manage holder, even if lab_admin also grants it but has no members', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles(); // lab_admin exists and grants roles.manage, but nobody is assigned to it
    const custom = await store.create({ name: 'Super Manager', capabilities: ['roles.manage'] });
    await store.assignRole('sub-only-admin', custom.id);

    await expect(store.remove(custom.id)).rejects.toThrow();

    // Must not have partially applied.
    const rolesAfter = await store.rolesForUser('sub-only-admin');
    expect(rolesAfter.map((r) => r.slug)).toContain(custom.slug);
    await db.destroy();
  });

  it('remove succeeds deleting a roles.manage-granting custom role when another user still holds roles.manage', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    const custom = await store.create({ name: 'Super Manager', capabilities: ['roles.manage'] });
    await store.assignRole('sub-admin', admin.id); // another real manage holder
    await store.assignRole('sub-custom', custom.id);

    await expect(store.remove(custom.id)).resolves.toBeUndefined();
    expect(await store.get(custom.id)).toBeNull();
    await db.destroy();
  });

  it('setUserRoles succeeds when roles.manage is still held by someone else', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    const technician = (await store.getBySlug('lab_technician'))!;
    await store.assignRole('sub-admin-1', admin.id);
    await store.assignRole('sub-admin-2', admin.id);

    await store.setUserRoles('sub-admin-2', [technician.id]);

    const rolesAfter = await store.rolesForUser('sub-admin-2');
    expect(rolesAfter.map((r) => r.slug)).toEqual(['lab_technician']);
    await db.destroy();
  });

  // ── Capability reconciliation ────────────────────────────────────────────────────────────
  // Simulate an EXISTING install: role rows created by an earlier version's seed, from a catalog
  // that did not yet contain some key. This is the shape of the live field defect.
  async function seedStaleAdmin(db: any, missing: string[]): Promise<void> {
    const { CAPABILITY_KEYS } = await import('@openldr/rbac');
    await db.insertInto('roles')
      .values({ id: 'r-admin', slug: 'lab_admin', name: 'Administrator', description: null, is_system: true })
      .execute();
    for (const capability of CAPABILITY_KEYS.filter((c: string) => !missing.includes(c))) {
      await db.insertInto('role_capabilities').values({ role_id: 'r-admin', capability }).execute();
    }
  }

  // THE test for the live field defect: an install created from the 641ca678 image froze lab_admin
  // without data_exposure.manage, and nothing could ever add it. Next boot must repair it.
  it('repairs lab_admin when a capability was added to the catalog after the role existed', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await seedStaleAdmin(db, ['data_exposure.manage']);

    const result = await store.seedSystemRoles();

    const admin = (await store.getBySlug('lab_admin'))!;
    expect(admin.capabilities).toContain('data_exposure.manage');
    expect(result.granted).toContainEqual({ slug: 'lab_admin', roleId: 'r-admin', capability: 'data_exposure.manage' });
    await db.destroy();
  });

  // lab_admin is LOCKED — update() throws for it, so an absence can never be a deliberate revoke.
  // It is therefore reconciled unconditionally, even though the ledger has seen the key.
  it('reconciles lab_admin even when the key is already in the ledger', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await seedStaleAdmin(db, ['data_exposure.manage']);
    const before = await db.selectFrom('capability_introductions').select('capability')
      .where('capability', '=', 'data_exposure.manage').executeTakeFirst();
    expect(before).toBeDefined(); // migration 067 seeded it

    await store.seedSystemRoles();

    expect((await store.getBySlug('lab_admin'))!.capabilities).toContain('data_exposure.manage');
    await db.destroy();
  });

  // The unlocked presets CAN be diverged. A key the ledger has seen has had its one free grant,
  // so an absence is an operator decision and must survive every restart.
  it('does NOT re-grant an unlocked preset capability the ledger has already seen', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const tech = (await store.getBySlug('lab_technician'))!;
    await store.update(tech.id, { capabilities: ['forms.view'] }); // operator revokes forms.submit

    await store.seedSystemRoles();
    await store.seedSystemRoles(); // and again — a revoke must not decay over restarts

    expect((await store.getBySlug('lab_technician'))!.capabilities).toEqual(['forms.view']);
    await db.destroy();
  });

  // A brand-new key has never existed, so no operator can have revoked it: grant it once.
  it('grants an unlocked preset a capability the ledger has never seen', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const tech = (await store.getBySlug('lab_technician'))!;
    await store.update(tech.id, { capabilities: ['forms.view'] });
    // Simulate "forms.submit is brand new in this version" by forgetting it from the ledger.
    await db.deleteFrom('capability_introductions').where('capability', '=', 'forms.submit').execute();

    const result = await store.seedSystemRoles();

    expect((await store.getBySlug('lab_technician'))!.capabilities).toContain('forms.submit');
    expect(result.granted.some((g) => g.slug === 'lab_technician' && g.capability === 'forms.submit')).toBe(true);

    // The write half of the ledger contract: the first pass must RECORD forms.submit, so this
    // second pass sees it as already-introduced and lets the operator's revoke stand. If
    // recordLedger() were a no-op, the key would look brand-new again and be re-granted here.
    const after = (await store.getBySlug('lab_technician'))!;
    await store.update(after.id, { capabilities: ['forms.view'] });
    await store.seedSystemRoles();

    expect((await store.getBySlug('lab_technician'))!.capabilities).toEqual(['forms.view']);
    await db.destroy();
  });

  // ⚠ THE TRAP. A failed ledger read must mean "reconciliation disabled", NEVER "empty ledger":
  // an empty set makes every preset capability look brand-new and re-grants the lot, silently
  // undoing every revoke on the install — strictly worse than the bug this fixes.
  it('grants NOTHING to unlocked presets when the ledger is unreadable', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const tech = (await store.getBySlug('lab_technician'))!;
    await store.update(tech.id, { capabilities: ['forms.view'] });
    await db.schema.dropTable('capability_introductions').execute(); // ledger read now throws

    await store.seedSystemRoles();

    expect((await store.getBySlug('lab_technician'))!.capabilities).toEqual(['forms.view']);
    await db.destroy();
  });

  // The locked role's rule never consults the ledger, so it still self-heals in that state.
  it('still reconciles lab_admin when the ledger is unreadable', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await seedStaleAdmin(db, ['data_exposure.manage']);
    await db.schema.dropTable('capability_introductions').execute();

    await store.seedSystemRoles();

    expect((await store.getBySlug('lab_admin'))!.capabilities).toContain('data_exposure.manage');
    await db.destroy();
  });

  it('reports created roles on a fresh install and grants nothing on the second run', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);

    const first = await store.seedSystemRoles();
    const second = await store.seedSystemRoles();

    expect(first.created.sort()).toEqual(
      ['data_analyst', 'lab_admin', 'lab_manager', 'lab_technician', 'system_auditor'].sort(),
    );
    expect(first.granted).toEqual([]);
    expect(second.created).toEqual([]);
    expect(second.granted).toEqual([]);
    await db.destroy();
  });

  it('diagnoses a stale lab_admin as pending, not revoked', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await seedStaleAdmin(db, ['data_exposure.manage']);

    const d = await store.diagnoseCapabilities();

    const admin = d.roles.find((r) => r.slug === 'lab_admin')!;
    expect(admin.present).toBe(true);
    expect(admin.pending).toContain('data_exposure.manage');
    expect(admin.revoked).not.toContain('data_exposure.manage');
    await db.destroy();
  });

  // An operator revoke on an UNLOCKED preset is a decision, not a defect — it must not be
  // reported as something the next boot will undo.
  it('classifies an operator revoke on an unlocked preset as revoked', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const tech = (await store.getBySlug('lab_technician'))!;
    await store.update(tech.id, { capabilities: ['forms.view'] });

    const d = await store.diagnoseCapabilities();

    const row = d.roles.find((r) => r.slug === 'lab_technician')!;
    expect(row.revoked).toContain('forms.submit');
    expect(row.pending).toEqual([]);
    expect(row.ok).toContain('forms.view');
    await db.destroy();
  });

  it('classifies a never-introduced capability on an unlocked preset as pending', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const tech = (await store.getBySlug('lab_technician'))!;
    await store.update(tech.id, { capabilities: ['forms.view'] });
    await db.deleteFrom('capability_introductions').where('capability', '=', 'forms.submit').execute();

    const d = await store.diagnoseCapabilities();

    expect(d.roles.find((r) => r.slug === 'lab_technician')!.pending).toContain('forms.submit');
    await db.destroy();
  });

  // The mirror-image drift: a key retired from the catalog leaves orphan rows behind.
  it('reports capability rows whose key no longer exists in the catalog', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const tech = (await store.getBySlug('lab_technician'))!;
    await db.insertInto('role_capabilities').values({ role_id: tech.id, capability: 'retired.key' }).execute();

    const d = await store.diagnoseCapabilities();

    expect(d.orphaned).toContainEqual({ slug: 'lab_technician', capability: 'retired.key' });
    await db.destroy();
  });

  it('reports a preset role whose row is absent entirely', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);

    const d = await store.diagnoseCapabilities();

    expect(d.roles.every((r) => r.present === false)).toBe(true);
    expect(d.roles).toHaveLength(5);
    await db.destroy();
  });

  it('reports a fully seeded install as clean', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();

    const d = await store.diagnoseCapabilities();

    expect(d.roles.every((r) => r.present && r.pending.length === 0 && r.revoked.length === 0)).toBe(true);
    expect(d.orphaned).toEqual([]);
    await db.destroy();
  });
});
