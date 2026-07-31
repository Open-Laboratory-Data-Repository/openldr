# RBAC Capability Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a capability added to the catalog reach existing installs automatically, and repair the one install-class where `lab_admin` is permanently missing `data_exposure.manage`.

**Architecture:** A new `capability_introductions` ledger records every capability key that has ever existed. `seedSystemRoles()` becomes create-**or-reconcile**: the locked `lab_admin` role is reconciled to the full catalog unconditionally (it cannot be diverged, so no operator intent exists to protect), while the four unlocked presets are granted only keys the ledger has never seen (so a deliberate revoke sticks forever). Grants are audited; a new `roles doctor` command makes drift visible.

**Tech Stack:** TypeScript, Kysely, Postgres, pg-mem (test harness), vitest, Commander (CLI).

**Spec:** `docs/superpowers/specs/2026-07-31-rbac-capability-reconciliation-design.md`

## Global Constraints

- **The frozen key list in migration 067 must never be changed.** A migration is a snapshot of its moment. It must not import `CAPABILITY_KEYS` from `@openldr/rbac`, and must not derive keys from `SELECT DISTINCT capability FROM role_capabilities`.
- **A failed ledger read means "reconciliation disabled", never "empty ledger".** An empty set makes every preset capability look brand-new and re-grants the lot, silently undoing every revoke on the install. `null` is the sentinel; do not default it to `new Set()`.
- **Migration 067 performs no backfill.** Repair happens through `lab_admin`'s unconditional reconcile, not through the migration.
- **Never add a `Co-Authored-By: Claude` trailer to any commit.**
- The catalog currently holds **38** capability keys.
- Run the full gate with `pnpm turbo run typecheck test --force`. **Never pipe turbo through `tail`.**
- Per-package test command form: `pnpm --filter <pkg> exec vitest run <path>`.

---

### Task 1: Migration 067 — the `capability_introductions` ledger

**Files:**
- Create: `packages/db/src/migrations/internal/067_capability_introductions.ts`
- Create: `packages/db/src/migrations/internal/067_capability_introductions.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts:67` (import) and `:135` (map entry)
- Modify: `packages/db/src/schema/internal.ts:628` (new table interface) and `:769` (`InternalSchema` entry)
- Modify: `packages/db/src/migrations/migrations.test.ts:7` (migration-map assertion)

**Interfaces:**
- Consumes: nothing.
- Produces: table `capability_introductions (capability text primary key, introduced_at timestamptz not null default now())`, seeded with 38 keys. Type `CapabilityIntroductionsTable { capability: string; introduced_at: Generated<Date> }` exported from `packages/db/src/schema/internal.ts`, registered on `InternalSchema` under key `capability_introductions`. Tasks 2 and 3 read this table.

- [ ] **Step 1: Write the failing migration test**

Create `packages/db/src/migrations/internal/067_capability_introductions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { up } from './067_capability_introductions';

async function ledger(db: Awaited<ReturnType<typeof makeMigratedDb>>): Promise<string[]> {
  const rows = await db.selectFrom('capability_introductions').select('capability').execute();
  return (rows as Array<{ capability: string }>).map((r) => r.capability).sort();
}

describe('067_capability_introductions', () => {
  it('seeds every capability key that exists as of 2026-07-31', async () => {
    const db = await makeMigratedDb();
    const keys = await ledger(db);

    expect(keys).toHaveLength(38);
    expect(keys).toContain('data_exposure.manage');
    expect(keys).toContain('forms.submit');
    expect(keys).toContain('audit.view');
  });

  // The ledger is read on every boot; a re-run must not violate the primary key.
  it('is idempotent', async () => {
    const db = await makeMigratedDb();
    await up(db);
    await up(db);

    expect(await ledger(db)).toHaveLength(38);
  });

  // The whole safety argument rests on this: the ledger says "this key has existed", so a
  // reconciler must never treat data_exposure.manage as brand-new on an upgraded install.
  it('records data_exposure.manage even though no role may hold it', async () => {
    const db = await makeMigratedDb();
    const row = await db
      .selectFrom('capability_introductions')
      .select('capability')
      .where('capability', '=', 'data_exposure.manage')
      .executeTakeFirst();

    expect(row).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/internal/067_capability_introductions.test.ts`

Expected: FAIL — `Cannot find module './067_capability_introductions'`.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/internal/067_capability_introductions.ts`:

```ts
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
```

- [ ] **Step 4: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add after the `m066` import (line 67):

```ts
import * as m067 from './067_capability_introductions';
```

and after the `'066_forms_submit_capability'` map entry (line 135):

```ts
  '067_capability_introductions': { up: m067.up, down: m067.down },
```

- [ ] **Step 5: Add the schema type**

In `packages/db/src/schema/internal.ts`, add after `AppSettingsTable` (line 628):

```ts
/** Ledger of capability keys that have ever existed in the catalog (migration 067).
 *  Read by RoleStore.seedSystemRoles() to decide whether a preset capability is brand-new
 *  (safe to grant once) or has already had its one free grant (a later absence is a revoke). */
export interface CapabilityIntroductionsTable {
  capability: string;
  introduced_at: Generated<Date>;
}
```

and add to `InternalSchema` after the `role_capabilities` entry (line 768):

```ts
  capability_introductions: CapabilityIntroductionsTable;
```

- [ ] **Step 6: Update the migration-map assertion**

In `packages/db/src/migrations/migrations.test.ts:7`, append `, '067_capability_introductions'` to the end of the internal-migrations array literal, immediately after `'066_forms_submit_capability'`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/internal/067_capability_introductions.test.ts src/migrations/migrations.test.ts`

Expected: PASS — 3 tests in the 067 file, 2 in the migration-map file.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/internal/067_capability_introductions.ts packages/db/src/migrations/internal/067_capability_introductions.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/internal.ts
git commit -m "feat(rbac): capability_introductions ledger (migration 067)"
```

---

### Task 2: `seedSystemRoles()` becomes create-or-reconcile

**Files:**
- Modify: `packages/db/src/role-store.ts` — `RoleStore` interface (line 42), `seedSystemRoles` implementation (lines 266-274), new exported result type
- Modify: `packages/db/src/index.ts:57` (re-export the new type)
- Modify: `packages/db/src/role-store.test.ts` (append tests)

**Interfaces:**
- Consumes: `capability_introductions` from Task 1.
- Produces: `seedSystemRoles(): Promise<CapabilityReconciliation>` where

```ts
export interface CapabilityReconciliation {
  created: string[];
  granted: Array<{ slug: string; roleId: string; capability: string }>;
}
```

  Task 4 consumes this return value. The internal helper `readLedger(): Promise<Set<string> | null>` is reused by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/role-store.test.ts` (inside the existing `describe('RoleStore', ...)` block):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/db exec vitest run src/role-store.test.ts`

Expected: FAIL — the repair tests fail because `seedSystemRoles` skips existing roles, and the `created`/`granted` assertions fail because it returns `undefined`.

- [ ] **Step 3: Add the result type and the ledger helpers**

In `packages/db/src/role-store.ts`, add after the `UpdateRoleInput` interface (line 28):

```ts
/** What a `seedSystemRoles()` pass actually changed. Returned so the caller can audit it —
 *  the store itself does no auditing (that lives in @openldr/bootstrap). */
export interface CapabilityReconciliation {
  created: string[];
  granted: Array<{ slug: string; roleId: string; capability: string }>;
}
```

Change the `RoleStore` interface member (line 42) from `seedSystemRoles(): Promise<void>;` to:

```ts
  seedSystemRoles(): Promise<CapabilityReconciliation>;
```

Add these helpers inside `createRoleStore`, next to `writeCaps` (after line 132):

```ts
  // The ledger of capability keys that have ever existed (migration 067).
  //
  // ⚠ Returns null — NOT an empty Set — when the table cannot be read (a pre-migration DB, a
  // transient failure). Null means "reconciliation disabled". An empty Set would mean "no key has
  // ever existed", which makes every preset capability look brand-new and re-grants the lot,
  // silently undoing every revoke on the install. Callers MUST branch on null explicitly.
  async function readLedger(): Promise<Set<string> | null> {
    try {
      const rows = await db.selectFrom('capability_introductions').select('capability').execute();
      return new Set(rows.map((r) => r.capability));
    } catch {
      return null;
    }
  }

  // Record every catalog key as introduced. Best-effort: on a pre-migration DB the table does not
  // exist yet, and role CREATION must still succeed exactly as it did before this feature.
  async function recordLedger(): Promise<void> {
    try {
      await db
        .insertInto('capability_introductions')
        .values(CAPABILITY_KEYS.map((capability) => ({ capability })))
        .onConflict((oc) => oc.column('capability').doNothing())
        .execute();
    } catch {
      /* ledger unavailable — reconciliation is already disabled in that state */
    }
  }
```

- [ ] **Step 3b: Export the new type from the package barrel**

`packages/db/src/index.ts:57` re-exports role-store types by name, so a type not listed there is invisible to `@openldr/db` consumers. Task 4 imports `CapabilityReconciliation`, so add it:

```ts
export type { RoleStore, RoleRecord, CreateRoleInput, UpdateRoleInput, CapabilityReconciliation } from './role-store';
```

- [ ] **Step 4: Replace `seedSystemRoles`**

Replace the whole `seedSystemRoles` implementation (lines 266-274) with:

```ts
    async seedSystemRoles() {
      const ledger = await readLedger();
      const created: string[] = [];
      const granted: CapabilityReconciliation['granted'] = [];

      for (const def of SYSTEM_ROLES) {
        const existing = await store.getBySlug(def.slug);
        if (!existing) {
          const id = randomUUID();
          await db.insertInto('roles').values({ id, slug: def.slug, name: def.name, description: def.description, is_system: true }).execute();
          await writeCaps(id, def.capabilities);
          created.push(def.slug);
          continue;
        }

        // Reconcile an EXISTING role. Adding a capability to the catalog used to reach fresh
        // installs only; this is what makes it reach upgraded ones.
        //
        // lab_admin: UNCONDITIONAL. Its preset is [...CAPABILITY_KEYS] and it is the locked role —
        // update() throws for it, create() cannot collide with its slug, remove() refuses system
        // roles. No operator-facing path can revoke from it, so no operator intent exists to
        // protect and reconciling it every boot cannot destroy information. This is what repairs
        // data_exposure.manage in the field.
        //
        // Unlocked presets: LEDGER-GATED. They genuinely can be diverged, so only ever grant a key
        // the ledger has never seen — a key that has never existed cannot have been revoked.
        //
        // ⚠ ledger === null means "disabled", NOT "empty". See readLedger().
        const want =
          def.slug === LOCKED_SLUG
            ? def.capabilities
            : ledger === null
              ? []
              : def.capabilities.filter((c) => !ledger.has(c));

        const have = new Set(existing.capabilities);
        for (const capability of want) {
          if (have.has(capability)) continue;
          await db
            .insertInto('role_capabilities')
            .values({ role_id: existing.id, capability })
            .onConflict((oc) => oc.columns(['role_id', 'capability']).doNothing())
            .execute();
          granted.push({ slug: def.slug, roleId: existing.id, capability });
        }
      }

      await recordLedger();
      return { created, granted };
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/db exec vitest run src/role-store.test.ts`

Expected: PASS — all pre-existing RoleStore tests plus the 7 new ones.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/role-store.ts packages/db/src/role-store.test.ts packages/db/src/index.ts
git commit -m "feat(rbac): reconcile preset capabilities in seedSystemRoles"
```

---

### Task 3: `RoleStore.diagnoseCapabilities()`

**Files:**
- Modify: `packages/db/src/role-store.ts` — `RoleStore` interface, new result type, new method
- Modify: `packages/db/src/index.ts:57` (re-export the new type)
- Modify: `packages/db/src/role-store.test.ts` (append tests)

**Interfaces:**
- Consumes: `readLedger()` from Task 2; `SYSTEM_ROLES` and `CAPABILITY_KEYS` from `@openldr/rbac`.
- Produces:

```ts
export interface CapabilityDiagnosis {
  roles: Array<{
    slug: string;
    present: boolean;
    ok: string[];
    revoked: string[];
    pending: string[];
  }>;
  orphaned: Array<{ slug: string; capability: string }>;
}
```

  `diagnoseCapabilities(): Promise<CapabilityDiagnosis>`. Task 5 consumes this.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/role-store.test.ts` (inside the same `describe` block):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/db exec vitest run src/role-store.test.ts`

Expected: FAIL — `store.diagnoseCapabilities is not a function`.

- [ ] **Step 3: Add the diagnosis type**

In `packages/db/src/role-store.ts`, add after `CapabilityReconciliation`:

```ts
/** Preset-vs-actual capability drift, for `openldr roles doctor` and any future UI.
 *  `revoked` (missing, key already introduced) is a deliberate operator decision;
 *  `pending` (missing, key never introduced — or any absence on the unconditionally
 *  reconciled locked role) is a real gap the next boot will close. */
export interface CapabilityDiagnosis {
  roles: Array<{
    slug: string;
    present: boolean;
    ok: string[];
    revoked: string[];
    pending: string[];
  }>;
  orphaned: Array<{ slug: string; capability: string }>;
}
```

Add to the `RoleStore` interface, after `seedSystemRoles`:

```ts
  diagnoseCapabilities(): Promise<CapabilityDiagnosis>;
```

- [ ] **Step 3b: Export the new type from the package barrel**

As in Task 2, add `CapabilityDiagnosis` to the named type re-export at `packages/db/src/index.ts:57`, which Task 5 imports:

```ts
export type { RoleStore, RoleRecord, CreateRoleInput, UpdateRoleInput, CapabilityReconciliation, CapabilityDiagnosis } from './role-store';
```

- [ ] **Step 4: Implement the method**

In `packages/db/src/role-store.ts`, add to the `store` object immediately after `seedSystemRoles`:

```ts
    async diagnoseCapabilities() {
      const ledger = await readLedger();
      const known = new Set(CAPABILITY_KEYS);
      const roles: CapabilityDiagnosis['roles'] = [];

      for (const def of SYSTEM_ROLES) {
        const existing = await store.getBySlug(def.slug);
        if (!existing) {
          roles.push({ slug: def.slug, present: false, ok: [], revoked: [], pending: [] });
          continue;
        }
        const have = new Set(existing.capabilities);
        const ok: string[] = [];
        const revoked: string[] = [];
        const pending: string[] = [];
        for (const c of def.capabilities) {
          if (have.has(c)) ok.push(c);
          // The locked role is reconciled UNCONDITIONALLY, so anything missing from it will be
          // granted on the next boot no matter what the ledger says. Reporting it as `revoked`
          // would be wrong twice over: nothing can revoke from lab_admin, and it is not durable.
          else if (def.slug === LOCKED_SLUG) pending.push(c);
          // Ledger unreadable → cannot prove a key is new, so report the conservative class.
          else if (ledger === null || ledger.has(c)) revoked.push(c);
          else pending.push(c);
        }
        roles.push({ slug: def.slug, present: true, ok, revoked, pending });
      }

      const rows = await db
        .selectFrom('role_capabilities')
        .innerJoin('roles', 'roles.id', 'role_capabilities.role_id')
        .select(['roles.slug as slug', 'role_capabilities.capability as capability'])
        .execute();
      const orphaned = rows
        .filter((r) => !known.has(r.capability))
        .map((r) => ({ slug: r.slug, capability: r.capability }));

      return { roles, orphaned };
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/db exec vitest run src/role-store.test.ts`

Expected: PASS — all RoleStore tests including the 6 new diagnosis tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/role-store.ts packages/db/src/role-store.test.ts packages/db/src/index.ts
git commit -m "feat(rbac): RoleStore.diagnoseCapabilities — preset drift and orphaned keys"
```

---

### Task 4: Audit the boot-time reconciliation

**Files:**
- Modify: `packages/bootstrap/src/index.ts:440-442` (the seed call)
- Modify: `packages/bootstrap/src/index.test.ts` (append test)

**Interfaces:**
- Consumes: `CapabilityReconciliation` from Task 2; `recordAuditEvent` from `./record-audit`; the `audit` store constructed at `index.ts:426`.
- Produces: audit events with `action: 'role.capability.backfill'`, `entityType: 'role'`, `entityId` = the role id, `metadata: { slug, capabilities }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/bootstrap/src/index.test.ts`:

```ts
describe('boot-time capability reconciliation audit', () => {
  // Reconciliation grants a privilege without anyone asking for it. That is exactly what an audit
  // log is for — otherwise the Data Exposure pane simply appears one day with no explanation.
  it('groups granted capabilities into one event per role', async () => {
    const granted = [
      { slug: 'lab_admin', roleId: 'r-admin', capability: 'data_exposure.manage' },
      { slug: 'lab_admin', roleId: 'r-admin', capability: 'audit.view' },
      { slug: 'lab_technician', roleId: 'r-tech', capability: 'forms.submit' },
    ];

    const events = capabilityBackfillEvents(granted);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      action: 'role.capability.backfill',
      entityType: 'role',
      entityId: 'r-admin',
      metadata: { slug: 'lab_admin', capabilities: ['data_exposure.manage', 'audit.view'] },
    });
    expect(events[1].entityId).toBe('r-tech');
  });

  // An ordinary restart changes nothing; it must not write an event, or the signal is worthless.
  it('emits no events when nothing was granted', () => {
    expect(capabilityBackfillEvents([])).toEqual([]);
  });
});
```

Add `capabilityBackfillEvents` to the existing import from `./index` at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/index.test.ts`

Expected: FAIL — `capabilityBackfillEvents is not exported by './index'`.

- [ ] **Step 3: Add the pure grouping helper**

In `packages/bootstrap/src/index.ts`, add near the other exported helpers (before `createAppContext`):

```ts
/** Group a reconciliation's grants into one audit event per role. Pure, so the grouping is
 *  testable without a live context. Empty in → empty out: a boot that changed nothing writes
 *  no events, which is what keeps the signal meaningful across ordinary restarts. */
export function capabilityBackfillEvents(
  granted: CapabilityReconciliation['granted'],
): AuditDetails[] {
  const byRole = new Map<string, { slug: string; capabilities: string[] }>();
  for (const g of granted) {
    const entry = byRole.get(g.roleId) ?? { slug: g.slug, capabilities: [] };
    entry.capabilities.push(g.capability);
    byRole.set(g.roleId, entry);
  }
  return [...byRole].map(([roleId, { slug, capabilities }]) => ({
    action: 'role.capability.backfill',
    entityType: 'role',
    entityId: roleId,
    metadata: { slug, capabilities },
  }));
}
```

Import `CapabilityReconciliation` from `@openldr/db` and ensure `AuditDetails` and `recordAuditEvent` are imported from `./record-audit`.

- [ ] **Step 4: Wire it into the boot seed**

Replace `packages/bootstrap/src/index.ts:440-442` with:

```ts
  const reconciliation = await roles.seedSystemRoles().catch((err) => {
    logger.warn({ err }, 'system-role seed failed');
    return { created: [], granted: [] } as CapabilityReconciliation;
  });
  // Reconciliation can GRANT a capability without an operator asking — the mechanism that repairs
  // a capability added to the catalog after this install's roles were created. Record it, so the
  // change is traceable rather than appearing as if by magic after an upgrade. recordAuditEvent is
  // already best-effort (safeRecord logs and never throws), so no extra guard is needed.
  for (const details of capabilityBackfillEvents(reconciliation.granted)) {
    await recordAuditEvent({ audit, logger }, { actorType: 'system', actorId: null, actorName: 'boot' }, details);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/index.test.ts`

Expected: PASS — including the pre-existing factory-reset reseed test, which still works because `seedSystemRoles()` returns a value rather than throwing.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/index.test.ts
git commit -m "feat(rbac): audit boot-time capability backfill"
```

---

### Task 5: `openldr roles doctor`

**Files:**
- Modify: `packages/cli/src/roles.ts` (pure summariser + runner)
- Create: `packages/cli/src/roles-doctor.test.ts`
- Modify: `packages/cli/src/index.ts:22` (import) and after `:207` (command registration)

**Interfaces:**
- Consumes: `CapabilityDiagnosis` from Task 3.
- Produces: `summarizeDiagnosis(d: CapabilityDiagnosis): { lines: string[]; exitCode: number }` (pure, exported for test) and `runRolesDoctor(opts: JsonOpt): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/roles-doctor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarizeDiagnosis } from './roles';
import type { CapabilityDiagnosis } from '@openldr/db';

const clean: CapabilityDiagnosis = {
  roles: [{ slug: 'lab_admin', present: true, ok: ['roles.manage'], revoked: [], pending: [] }],
  orphaned: [],
};

describe('summarizeDiagnosis', () => {
  it('exits 0 and says so when there is no drift', () => {
    const { exitCode, lines } = summarizeDiagnosis(clean);
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('no capability drift requiring action');
  });

  // A revoke is an operator DECISION, not a defect — reporting it must not fail the command.
  it('exits 0 for a revoked-only diagnosis but still names it', () => {
    const { exitCode, lines } = summarizeDiagnosis({
      roles: [{ slug: 'lab_technician', present: true, ok: ['forms.view'], revoked: ['forms.submit'], pending: [] }],
      orphaned: [],
    });
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('forms.submit');
  });

  // This is the state the live defect produces; the command exists to make it visible.
  it('exits 1 when a capability is pending', () => {
    const { exitCode, lines } = summarizeDiagnosis({
      roles: [{ slug: 'lab_admin', present: true, ok: [], revoked: [], pending: ['data_exposure.manage'] }],
      orphaned: [],
    });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('pending=[data_exposure.manage]');
  });

  it('exits 1 when a capability key is orphaned', () => {
    const { exitCode } = summarizeDiagnosis({ ...clean, orphaned: [{ slug: 'bench', capability: 'retired.key' }] });
    expect(exitCode).toBe(1);
  });

  it('exits 1 when a preset role row is missing entirely', () => {
    const { exitCode, lines } = summarizeDiagnosis({
      roles: [{ slug: 'lab_admin', present: false, ok: [], revoked: [], pending: [] }],
      orphaned: [],
    });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('MISSING');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/cli exec vitest run src/roles-doctor.test.ts`

Expected: FAIL — `summarizeDiagnosis is not exported by './roles'`.

- [ ] **Step 3: Implement the summariser and runner**

In `packages/cli/src/roles.ts`, add `CapabilityDiagnosis` to the existing `@openldr/db` type import, then append:

```ts
/** Format a capability diagnosis and decide the exit code. Pure, so the classification and exit
 *  policy are testable without a live AppContext.
 *
 *  Exit 1 for `pending` (a real backfill gap the next boot will close) and for `orphaned` (a key
 *  retired from the catalog leaving rows behind) — both are states an operator should act on.
 *  Exit 0 for `revoked`: that is a deliberate decision, not a defect. */
export function summarizeDiagnosis(d: CapabilityDiagnosis): { lines: string[]; exitCode: number } {
  const lines: string[] = [];
  let problems = d.orphaned.length > 0;

  for (const r of d.roles) {
    if (!r.present) {
      lines.push(`${r.slug}\tMISSING (role row absent — the next boot will create it)`);
      problems = true;
      continue;
    }
    const bits = [`ok=${r.ok.length}`];
    if (r.revoked.length) bits.push(`revoked=[${r.revoked.join(', ')}]`);
    if (r.pending.length) {
      bits.push(`pending=[${r.pending.join(', ')}]`);
      problems = true;
    }
    lines.push(`${r.slug}\t${bits.join('\t')}`);
  }

  for (const o of d.orphaned) lines.push(`${o.slug}\torphaned=${o.capability}`);
  if (!problems) lines.push('no capability drift requiring action');

  return { lines, exitCode: problems ? 1 : 0 };
}

export async function runRolesDoctor(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const diagnosis = await ctx.roles.diagnoseCapabilities();
    const { lines, exitCode } = summarizeDiagnosis(diagnosis);
    emit(opts.json, diagnosis, lines.join('\n'));
    return exitCode;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 4: Register the command**

In `packages/cli/src/index.ts:22`, add `runRolesDoctor` to the import list from `./roles`. Then add after the `revoke` registration (line 207):

```ts
rolesCmd.command('doctor').description('Report preset-capability drift and orphaned capability keys').option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runRolesDoctor(opts); } catch (err) { process.stderr.write(`roles doctor failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/cli exec vitest run src/roles-doctor.test.ts`

Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/roles.ts packages/cli/src/roles-doctor.test.ts packages/cli/src/index.ts
git commit -m "feat(rbac): openldr roles doctor — report capability drift"
```

---

### Task 6: Document the reconciliation rule

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/roles.md` (append a section)
- Modify: `docs/CLI-REFERENCE.md` (add a roles row to the command table)

**Interfaces:**
- Consumes: behaviour from Tasks 2–5. Produces no code.

- [ ] **Step 1: Append the section to the in-app roles guide**

Add to the end of `apps/studio/src/docs/0.1.0/en/roles.md`:

```markdown
## How capabilities reach an existing install

New OpenLDR versions add capabilities. Roles live in the database, so a role created by an earlier
version does not automatically know about a capability introduced later. OpenLDR reconciles this on
every start:

- **Administrator** is always brought up to the full capability list. The role is locked and is
  defined as "every capability", so there is no customisation to preserve — if a release adds a
  capability, the Administrator role has it after the next restart.
- **The other built-in roles** receive a capability **only the first time that capability exists**.
  After that, OpenLDR never re-grants it. If you remove a capability from Lab Manager, it stays
  removed across restarts and upgrades.
- **Custom roles you create are never modified.** If a new capability is relevant to one of your own
  roles, grant it yourself in Settings → Roles.

A capability granted this way is recorded in the audit log as `role.capability.backfill`, so an
upgrade that widens a role leaves a trace.

To see how your install compares with the built-in definitions, run `openldr roles doctor`. It
reports, per built-in role, which capabilities are held, which you have deliberately removed, and
which are still pending — plus any capability keys left behind by a retired feature.
```

- [ ] **Step 2: Add the CLI reference row**

In `docs/CLI-REFERENCE.md`, add to the command table immediately after the `openldr users list` row (line 35):

```markdown
| `openldr roles ...` | Manage capability roles. `roles doctor` reports capability drift against the built-in role definitions. |
```

- [ ] **Step 3: Verify the docs registry test still passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs/registry.test.ts`

Expected: PASS — the file already exists in the registry, so appending a section changes nothing structural.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs/0.1.0/en/roles.md docs/CLI-REFERENCE.md
git commit -m "docs(rbac): document capability reconciliation and roles doctor"
```

---

### Task 7: Full gate and merge

**Files:** none — verification only.

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run typecheck test --force`

Expected: PASS. Do **not** pipe through `tail`. Known-acceptable noise, per repo conventions: `@openldr/cli#build` fails on Windows (esbuild native dep — not part of this command), and parallel-turbo flakes in audit/studio-pages/users/db/marketplace/plugins/bootstrap pass when the package is run alone. If a package fails, re-run it alone with `pnpm --filter <pkg> exec vitest run` before treating it as a real regression, and grep for `Test timed out` — timeouts are not regressions.

- [ ] **Step 2: Verify the repair against a real Postgres**

Reproduce the field defect end to end rather than trusting pg-mem alone. With dev Postgres up (`docker compose up -d postgres`, port 5433, credentials from `INTERNAL_DATABASE_URL`):

```bash
psql "$INTERNAL_DATABASE_URL" -c "delete from role_capabilities where capability = 'data_exposure.manage';"
```

Then start the API (`cd apps/server && node dev.mjs`), wait for boot, and confirm the repair:

```bash
psql "$INTERNAL_DATABASE_URL" -c "select r.slug, rc.capability from role_capabilities rc join roles r on r.id = rc.role_id where rc.capability = 'data_exposure.manage';"
```

Expected: one row, `lab_admin`. Then confirm the audit trace:

```bash
psql "$INTERNAL_DATABASE_URL" -c "select action, entity_id, metadata from audit_events where action = 'role.capability.backfill' order by created_at desc limit 5;"
```

Expected: one event naming `data_exposure.manage`. Finally run `openldr roles doctor` and expect exit 0 with no `pending`.

⚠ If `AUTH_DEV_BYPASS=true` the API binds `0.0.0.0` with **no auth** — stop the server when finished (`netstat -ano | grep :3000` → `taskkill //PID <pid> //F`).

- [ ] **Step 3: Merge to local main**

```bash
git checkout main
git merge --no-ff fix/rbac-capability-reconciliation -m "merge: RBAC capability reconciliation — ledger-gated backfill"
```

Push only if the user asks.

---

## Self-review notes

- **Spec coverage.** Migration + frozen list + schema type → Task 1. Two reconciliation rules and the `null`-ledger trap → Task 2. `diagnoseCapabilities` with `ok`/`revoked`/`pending`/`orphaned` → Task 3. Audit event → Task 4. `roles doctor` and its exit-code policy → Task 5. Docs → Task 6. Rejected alternatives are recorded as code comments in Task 1 so the reasoning survives next to the frozen list.
- **A classification bug caught while writing Task 3.** After migration 067 the ledger contains `data_exposure.manage`, so the naive rule (`missing && ledger.has(c) → revoked`) would report a broken `lab_admin` as *revoked* — wrong twice over, since nothing can revoke from the locked role and the next boot will grant it anyway. `LOCKED_SLUG` is therefore checked **before** the ledger in `diagnoseCapabilities`, and Task 3's first test pins exactly that.
- **Type consistency.** `CapabilityReconciliation.granted` carries `{ slug, roleId, capability }` in Tasks 2, 4 and their tests; `entityId` is the `roleId`, with `slug` in metadata, matching the `role.create`/`role.update` events. `CapabilityDiagnosis` field names are identical in Tasks 3 and 5.
- **Known deviation from the spec's prose.** The spec said the audit call would need its own guard; it does not — `recordAuditEvent` already routes through `safeRecord`, which logs and never throws. Task 4 notes this inline instead of adding a redundant `try`.
