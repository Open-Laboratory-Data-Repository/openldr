import { type Kysely } from 'kysely';

// Split `forms.submit` out of `forms.view` (see packages/rbac/src/catalog.ts).
//
// Roles and their capabilities live in the DATABASE. `seedSystemRoles()` is create-if-absent by
// slug, so adding a capability to the preset code reaches FRESH installs only — on an upgraded
// deployment every role row already exists and is skipped. Without this backfill, an upgrade
// would move POST /api/forms/:id/responses from `forms.view` (held by every preset) to
// `forms.submit` (held by nobody), and hand capture would 403 for the entire install.
//
// The mechanism is the one the capability-roles design named for exactly this case: "A new app
// version may add capability keys; a seed/migration backfills the affected system roles"
// (docs/superpowers/specs/2026-07-24-capability-roles-rbac-design.md). A migration rather than
// the boot seed because it must run ONCE: the boot seed runs on every start, so an operator who
// deliberately revokes `forms.submit` from a role would have it silently re-granted at the next
// restart.
//
// Scope of the backfill:
//   - only the presets that should do data entry — Administrator, Lab Manager, Lab Technician.
//     `system_auditor` ("Read-only oversight") and `data_analyst` are deliberately NOT backfilled;
//     they held `forms.view` and could therefore write clinical records, which is the defect this
//     split fixes.
//   - only where the role still holds `forms.view`, i.e. only where the role could already submit
//     before the split. A site that had already revoked forms.view from Lab Manager keeps that
//     decision.
//   - CUSTOM roles are not touched. A site whose clerks use a hand-made role grants forms.submit
//     to it in Settings -> Roles (or `openldr roles grant <slug> forms.submit`); auto-granting a
//     clinical WRITE to arbitrary operator-defined roles is the wrong default.
const DATA_ENTRY_SLUGS = ['lab_admin', 'lab_manager', 'lab_technician'] as const;

export async function up(db: Kysely<any>): Promise<void> {
  const rows = await db
    .selectFrom('roles')
    .innerJoin('role_capabilities', 'role_capabilities.role_id', 'roles.id')
    .select('roles.id as id')
    .where('roles.slug', 'in', DATA_ENTRY_SLUGS as unknown as string[])
    .where('role_capabilities.capability', '=', 'forms.view')
    .execute();

  for (const { id } of rows as Array<{ id: string }>) {
    const already = await db
      .selectFrom('role_capabilities')
      .select('capability')
      .where('role_id', '=', id)
      .where('capability', '=', 'forms.submit')
      .executeTakeFirst();
    if (already) continue;
    await db.insertInto('role_capabilities').values({ role_id: id, capability: 'forms.submit' }).execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  // The key did not exist before this migration, so removing every grant of it is the exact
  // inverse — there is no pre-existing state to preserve.
  await db.deleteFrom('role_capabilities').where('capability', '=', 'forms.submit').execute();
}
