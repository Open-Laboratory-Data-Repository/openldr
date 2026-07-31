import { type Kysely, sql } from 'kysely';

// Ledger of capability keys that have ever existed in the catalog.
// See docs/superpowers/specs/2026-07-31-rbac-capability-reconciliation-design.md.
//
// Its only consumer is seedSystemRoles()'s reconciliation pass. A key ABSENT from this table has
// never existed on this install, so no operator can have revoked it, and granting it to the preset
// roles that presets.ts says should hold it is safe. A key PRESENT here has had its one free grant
// and is never granted again, so a later revoke sticks permanently.
//
// The list below is FROZEN at the 38 keys of 2026-07-31 and must never be edited.
//   - It deliberately does NOT import CAPABILITY_KEYS from @openldr/rbac: a migration is a snapshot
//     of its moment, and importing it would make this migration's behaviour drift every time the
//     catalog grows. Migration 066 sets the same precedent by hardcoding 'forms.submit'.
//   - It deliberately does NOT derive the list from `SELECT DISTINCT capability FROM
//     role_capabilities`: a capability an operator had revoked from EVERY role would look
//     never-introduced and be re-granted on the next boot — the exact trap this design avoids.
//
// NOTE this migration performs NO backfill. `lab_admin` is reconciled unconditionally by
// seedSystemRoles() — it is locked and its preset is the whole catalog, so no operator intent can
// exist to protect — and that is what repairs `data_exposure.manage` on an existing install. A
// backfill pass over the UNLOCKED presets would be wrong: nothing there is missing (066 handled
// forms.submit; data_exposure.manage was never theirs), so it could only re-grant capabilities
// operators had deliberately revoked.
const FROZEN_CAPABILITY_KEYS = [
  'dashboards.view', 'dashboards.create', 'dashboards.edit', 'dashboards.delete',
  'reports.view', 'reports.run', 'reports.export', 'reports.edit_templates',
  'forms.view', 'forms.submit', 'forms.edit', 'forms.publish',
  'workflows.view', 'workflows.edit', 'workflows.run', 'workflows.manage_secrets',
  'query.run',
  'users.view', 'users.manage', 'users.reset_password', 'users.force_logout',
  'roles.view', 'roles.manage',
  'terminology.view', 'terminology.manage',
  'marketplace.view', 'marketplace.manage',
  'connectors.manage',
  'sync.view', 'sync.manage',
  'settings.view', 'settings.edit_general', 'settings.feature_flags', 'settings.danger_zone',
  'data_exposure.manage',
  'activity.view', 'notifications.view',
  'audit.view',
] as const;

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('capability_introductions')
    .ifNotExists()
    .addColumn('capability', 'text', (c) => c.primaryKey())
    .addColumn('introduced_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db
    .insertInto('capability_introductions')
    .values(FROZEN_CAPABILITY_KEYS.map((capability) => ({ capability })))
    .onConflict((oc) => oc.column('capability').doNothing())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('capability_introductions').ifExists().execute();
}
