# RBAC capability reconciliation — design

**Date:** 2026-07-31
**Status:** Implemented on `fix/rbac-capability-reconciliation` (plan: `docs/superpowers/plans/2026-07-31-rbac-capability-reconciliation.md`)
**Scope:** Repair installs whose `lab_admin` role is missing `data_exposure.manage`, and remove the class of defect where a capability added to the catalog never reaches an existing install.

## Why

Adding a capability key to `packages/rbac/src/catalog.ts` reaches **fresh installs only**. On any install whose role rows already exist, the key is permanently absent from every role, and there is no supported way to add it. Three facts compose into that, all verified against current code on 2026-07-31:

1. `seedSystemRoles()` is create-if-absent by slug — `if (existing) continue`, with **no capability reconciliation** ([role-store.ts:266-274](../../../packages/db/src/role-store.ts:266)). An existing role keeps exactly the capabilities it was created with, forever.
2. `update()` **throws** for the locked role: *"the Administrator role cannot be modified"* ([role-store.ts:164](../../../packages/db/src/role-store.ts:164)).
3. The CLI is not an escape hatch — `openldr roles grant` funnels through that same `update()` ([roles.ts:184](../../../packages/cli/src/roles.ts:184)).

The only workaround available today is to create a custom role carrying the missing capability and assign it to the admin *user* as a second role, since capabilities are UNIONed across a user's roles ([role-store.ts:200-208](../../../packages/db/src/role-store.ts:200)).

### What is actually broken, and where

`catalog.ts` has exactly three commits in its history, which makes the affected set knowable rather than guessed:

| Commit | Date | Added | Backfill |
|---|---|---|---|
| `9d14d0fc` | 2026-07-24 | the initial catalog | n/a — shipped with migration 062, which creates the tables |
| `a3a5af4f` | 2026-07-24 | `data_exposure.manage` | **none** ← the defect |
| `f6c40869` | 2026-07-31 | `forms.submit` | migration 066 |

So **`data_exposure.manage` is the complete repair list.** No other capability is in this state.

The exposure window is real, not theoretical. The RBAC work merged at `641ca678` — and a GHCR image was published at that point. `data_exposure.manage` arrived later, inside the data-exposure branch merged at `6705a649`. Any install that first booted RBAC from the `641ca678` image created its `lab_admin` row from a catalog that did not yet contain the key, and froze it there. On such an install the administrator cannot open Settings → Data Exposure: the capability gates the routes at [dashboards-routes.ts:18](../../../apps/server/src/dashboards-routes.ts:18) and the whole pane at [App.tsx:69](../../../apps/studio/src/App.tsx:69).

## The principle

**A capability key that has never existed cannot have been revoked.**

So granting a brand-new key to the preset roles that `presets.ts` says should hold it is unambiguously safe — *the first time*. Every time after that, silence is required: by then a missing key might be a deliberate operator decision. This is why migration 066 was a migration and not a change to the boot seed, which runs on every start.

A **ledger of introduced capability keys** turns that one-time safety into something the system can enforce by itself, instead of something each author must remember.

## Design

### Two reconciliation rules

`seedSystemRoles()` becomes create-**or-reconcile**, with different rules for the locked role and the rest:

- **`lab_admin` — unconditional.** Its preset is `[...CAPABILITY_KEYS]` ([presets.ts:45](../../../packages/rbac/src/presets.ts:45)) — "the whole catalog, by definition" — and it is the locked role. Every writer of `role_capabilities` was traced: `create()` cannot collide with its slug (unique constraint), `update()` throws, `remove()` refuses system roles. **No operator-facing path can revoke a capability from `lab_admin`.** There is therefore no operator intent to protect, and reconciling it to the full catalog on every boot cannot destroy information. It ignores the ledger entirely.
- **The four unlocked presets — ledger-gated.** `lab_manager`, `data_analyst`, `system_auditor`, `lab_technician` genuinely can be diverged. Grant a preset capability only when its key is **absent from the ledger**; then record the key. A revoke made afterwards sticks permanently.

### No repair migration

Migration 067 creates and seeds the ledger. **It performs no repair.** The repair of `data_exposure.manage` falls out of the unconditional `lab_admin` rule on the next boot — that role is the only place the key was ever meant to live, being absent from MANAGER, ANALYST, AUDITOR, and the technician preset.

A repair pass over the unlocked presets would be actively wrong. Nothing there needs repairing (`forms.submit` was handled by 066; `data_exposure.manage` was never theirs), so a blanket "grant every missing preset capability" would do nothing except re-grant capabilities operators had deliberately revoked — the exact failure this design exists to prevent.

### Data model

Migration **`067_capability_introductions`**:

```
capability_introductions (
  capability     text        primary key,
  introduced_at  timestamptz not null default now()
)
```

`up()` creates the table and inserts a **frozen, hardcoded list of the 38 capability keys as they exist on 2026-07-31**, with `on conflict do nothing`. `down()` drops the table — the exact inverse, since nothing existed before it.

The list is hardcoded deliberately. Two rejected alternatives:

- **Importing `CAPABILITY_KEYS` from `@openldr/rbac`** would make the migration drift as the catalog grows; a migration must be a frozen snapshot of its moment. Migration 066 sets this precedent, hardcoding `'forms.submit'` and its target slugs.
- **Deriving it from `SELECT DISTINCT capability FROM role_capabilities`** is self-adjusting and tempting, but a capability an operator had revoked from *every* role would look un-introduced and be re-granted on the next boot — the same trap wearing a clever hat.

Registered in `migrations/internal/index.ts` and added to the migration-map assertion in `migrations.test.ts` (the step 066 also required).

### Boot algorithm

```
ledger = read capability_introductions   → Set, or null if the read fails
for each def in SYSTEM_ROLES:
  existing = getBySlug(def.slug)
  if !existing: create with def.capabilities        (unchanged behaviour)
  else:
    want = def.slug === LOCKED_SLUG
             ? def.capabilities                              // unconditional
             : ledger === null ? []                          // reconciliation disabled
             : def.capabilities.filter(c => !ledger.has(c))  // ledger-gated
    grant each of `want` not already held; collect for audit
if ledger !== null: record every CAPABILITY_KEYS entry into the ledger, on conflict do nothing
```

**Trap, built in deliberately:** a failed ledger read must mean *"reconciliation disabled"*, never *"empty ledger"*. An empty set makes every preset capability look brand-new and re-grants the lot, silently undoing every revoke on the install — strictly worse than the bug being fixed. A pre-migration DB or a transient connection blip is exactly when this fires, so it is not hypothetical. `lab_admin` still reconciles in that case, since its rule never consults the ledger. The same applies to the write: recording keys after a failed read would mark a brand-new capability as introduced without ever granting it, permanently burning its one free grant — so the ledger is recorded only when it was readable.

Both writes use `on conflict do nothing`, which also makes concurrent replica boots harmless: two boots may both grant, but the `(role_id, capability)` primary key absorbs the duplicate and the ledger insert absorbs the other. This mirrors the race-free `on conflict` column-policy seed already in `bootstrap` (`3ff2d0a5`).

### Signature change

`seedSystemRoles()` returns `{ created: string[], granted: Array<{ slug: string; capability: string }> }` instead of `void`, so the caller can audit what changed. The store stays in `@openldr/db` and knows nothing about auditing; `@openldr/bootstrap` owns that. Its two existing callers both keep working:

- `createAppContext` (every boot) — audits the result.
- the post-`dangerFactoryReset` reseed — reports everything as `created`, since `wipeInternalDatabase()` discovers tables via `pg_tables` and therefore truncates the ledger and the roles together, leaving a consistent fresh-install state.

### Audit

When `granted` is non-empty, `createAppContext` records one **`role.capability.backfill`** event per affected role: `entityType: 'role'`, `entityId` the role id, metadata carrying the granted keys. The actor mirrors `cliActor()`'s shape — `{ actorType: 'system', actorId: null, actorName: 'boot' }`.

It fires **only when something was actually granted**, so an ordinary restart writes nothing and the signal stays meaningful. Like the seed call it wraps, an audit failure logs and never aborts boot. The dotted action name matches the existing `role.create` / `role.update` / `user.role.assign` family.

On the installs this repairs, the first restart after upgrade leaves a permanent, traceable record that `lab_admin` gained `data_exposure.manage`.

### Diagnosis: `RoleStore.diagnoseCapabilities()`

The diagnosis lives in the store rather than the CLI, so the SQL stays in `@openldr/db`, it is unit-testable there, and a future Settings → Roles panel can render the same data without reimplementing it.

For each preset role it classifies every preset capability:

| Class | Meaning |
|---|---|
| `ok` | held |
| `revoked` | missing, key **is** in the ledger → deliberate operator action; informational |
| `pending` | missing, key **not** in the ledger → genuine backfill gap; will be granted on next boot |

Plus one install-wide check: **`orphaned`** — capability rows present in `role_capabilities` (any role, including custom ones) whose key no longer exists in the catalog. That is the mirror-image drift, left behind when a capability is retired.

The `revoked`/`pending` split is the heart of it: it separates "someone decided this" from "the system failed to deliver this" — precisely the distinction that was invisible when this defect was found. Run against a broken install today it reports `lab_admin: pending data_exposure.manage`.

### CLI

`openldr roles doctor [--json]` formats `diagnoseCapabilities()`. Exit **0** when clean or when the only findings are `revoked`; exit **1** when anything is `pending` or `orphaned`, since both are states an operator should act on (restart, or clean up). Satisfies the standing CLI-parity convention for new operator-facing behaviour.

## Rejected alternatives

- **Migration per capability, forever (status quo).** Correct when done, but depends on every author remembering; the defect being fixed is precisely a missed instance. Leaves the class intact.
- **Relaxing the locked-role guard to permit additions.** Once `lab_admin` self-reconciles, nothing needs to grant to it by hand, so this buys no capability while widening a privilege-escalation surface and complicating `update()`'s contract. The existing second-role workaround remains for anyone who needs it.
- **A catalog manifest test that fails CI when a key is added without a backfill migration.** Real, but it converts a silent bug into a recurring chore. The ledger removes the chore instead. (If wanted later, it composes fine with this design.)
- **Unconditional reconciliation of all five presets on boot.** Simplest to write, and wrong: it silently re-grants deliberately revoked capabilities on every restart.

## Testing

Store-level (`packages/db`, pg-mem harness as with 062/066):

1. Existing role missing a preset capability whose key is **absent** from the ledger → granted.
2. Same, key **present** in the ledger → **not** granted (a revoke sticks across restarts).
3. `lab_admin` missing a capability whose key **is** in the ledger → granted anyway (unconditional rule).
4. **The field defect, end to end:** create `lab_admin` holding the catalog *minus* `data_exposure.manage`, seed the ledger with all 38 keys, run `seedSystemRoles()` → the role gains `data_exposure.manage`. This is the test that proves the repair.
5. **The trap:** ledger read fails → unlocked presets receive **no** grants (asserting the failure is not treated as an empty ledger), while `lab_admin` still reconciles.
6. Fresh install: all five roles created with full preset capabilities; ledger ends up holding every catalog key.
7. Idempotence: a second `seedSystemRoles()` grants nothing and returns an empty `granted`.
8. `diagnoseCapabilities()` classifies `ok` / `revoked` / `pending` / `orphaned` correctly.

Migration (`067_capability_introductions.test.ts`, mirroring `066`'s):

9. `up()` creates the table and seeds all 38 keys; re-running is a no-op.
10. `067` present in the internal migration-map assertion in `migrations.test.ts`.

Bootstrap:

11. A boot that grants something records `role.capability.backfill`; a boot that grants nothing records no event.

CLI:

12. `roles doctor` exit codes — 0 for clean and for `revoked`-only, 1 for `pending` or `orphaned`.

## Out of scope

- Reconciling capability **removals** (a key dropped from a preset in code). Revocation is destructive and should stay an explicit migration.
- Preset **name/description** drift; only capabilities are reconciled.
- Any change to how custom roles work. They are never touched by reconciliation.

## Files touched

| File | Change |
|---|---|
| `packages/db/src/migrations/internal/067_capability_introductions.ts` | new — table + frozen 38-key seed |
| `packages/db/src/migrations/internal/067_capability_introductions.test.ts` | new |
| `packages/db/src/migrations/internal/index.ts` | register 067 |
| `packages/db/src/migrations/migrations.test.ts` | migration-map assertion |
| `packages/db/src/schema/internal.ts` | `CapabilityIntroductionsTable` + `InternalSchema` entry |
| `packages/db/src/role-store.ts` | reconcile in `seedSystemRoles()`, new return type, `diagnoseCapabilities()` |
| `packages/db/src/role-store.test.ts` | tests 1–8 |
| `packages/bootstrap/src/index.ts` | audit the seed result |
| `packages/cli/src/roles.ts` + CLI program registration | `roles doctor` |
| `docs/` | document the reconciliation rule and `roles doctor` |
