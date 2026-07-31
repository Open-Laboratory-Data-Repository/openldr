import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { up } from './066_forms_submit_capability';

/** Roles as an EXISTING install has them: created by an earlier version's seed, before
 *  `forms.submit` existed, so every preset that could submit holds only `forms.view`. */
async function seedPreSplitRoles(db: Awaited<ReturnType<typeof makeMigratedDb>>): Promise<void> {
  const roles: Array<[string, string, string[]]> = [
    ['r-admin', 'lab_admin', ['forms.view', 'forms.edit', 'forms.publish', 'roles.manage']],
    ['r-manager', 'lab_manager', ['forms.view', 'forms.edit', 'forms.publish']],
    ['r-tech', 'lab_technician', ['forms.view']],
    ['r-analyst', 'data_analyst', ['forms.view', 'query.run']],
    ['r-auditor', 'system_auditor', ['forms.view', 'audit.view']],
    ['r-custom', 'bench-clerks', ['forms.view']],
  ];
  for (const [id, slug, caps] of roles) {
    await db.insertInto('roles').values({ id, slug, name: slug, description: null, is_system: true }).execute();
    for (const capability of caps) {
      await db.insertInto('role_capabilities').values({ role_id: id, capability }).execute();
    }
  }
}

async function capsOf(db: Awaited<ReturnType<typeof makeMigratedDb>>, roleId: string): Promise<string[]> {
  const rows = await db.selectFrom('role_capabilities').select('capability').where('role_id', '=', roleId).execute();
  return (rows as Array<{ capability: string }>).map((r) => r.capability).sort();
}

describe('066_forms_submit_capability', () => {
  // The upgrade hazard this migration exists for: without it, POST /api/forms/:id/responses moves
  // from forms.view (held by everyone) to forms.submit (held by nobody) and NO ONE on an existing
  // install can capture data by hand.
  it('backfills forms.submit onto the data-entry presets', async () => {
    const db = await makeMigratedDb();
    await seedPreSplitRoles(db);
    await up(db);

    expect(await capsOf(db, 'r-admin')).toContain('forms.submit');
    expect(await capsOf(db, 'r-manager')).toContain('forms.submit');
    expect(await capsOf(db, 'r-tech')).toContain('forms.submit');
  });

  it('does NOT grant it to the read-only presets', async () => {
    const db = await makeMigratedDb();
    await seedPreSplitRoles(db);
    await up(db);

    expect(await capsOf(db, 'r-analyst')).not.toContain('forms.submit');
    expect(await capsOf(db, 'r-auditor')).not.toContain('forms.submit');
  });

  it('leaves custom operator-defined roles alone', async () => {
    const db = await makeMigratedDb();
    await seedPreSplitRoles(db);
    await up(db);

    expect(await capsOf(db, 'r-custom')).toEqual(['forms.view']);
  });

  // A site that had already revoked forms.view from a preset made a decision; the backfill must
  // not hand that role a stronger capability than the one it was told to drop.
  it('skips a data-entry preset that no longer holds forms.view', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('roles').values({ id: 'r-tech', slug: 'lab_technician', name: 'Lab Technician', description: null, is_system: true }).execute();
    await db.insertInto('role_capabilities').values({ role_id: 'r-tech', capability: 'dashboards.view' }).execute();

    await up(db);

    expect(await capsOf(db, 'r-tech')).toEqual(['dashboards.view']);
  });

  it('is idempotent (the primary key is not violated on a re-run)', async () => {
    const db = await makeMigratedDb();
    await seedPreSplitRoles(db);
    await up(db);
    await up(db);

    const rows = await db
      .selectFrom('role_capabilities')
      .select('role_id')
      .where('capability', '=', 'forms.submit')
      .execute();
    expect(rows).toHaveLength(3);
  });

  it('is a no-op on a fresh install with no roles yet', async () => {
    const db = await makeMigratedDb();
    await expect(up(db)).resolves.toBeUndefined();
  });
});
