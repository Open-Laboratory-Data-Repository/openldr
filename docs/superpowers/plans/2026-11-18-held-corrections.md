# Held corrections: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a permitted person corrects fields of a held cdr-source request and checks it again; it is saved if it now passes, with the correction recorded.

**Architecture:** CE stores corrections beside the source rows and passes them to the plugin's decode; the plugin applies them before its rules (not before the v1 comparison) and reports what it changed. The plugin's Held sheet gets the form; CE exposes two host calls behind a new capability.

**Tech Stack:** TypeScript (CE: db, bootstrap, plugin broker, plugin-ui-sdk, CLI), Rust (plugin decode), React (plugin UI).

**Spec:** `docs/superpowers/specs/2026-11-18-held-corrections-design.md` (read its "Settled after the builder check" section)

## Global Constraints

- Correctable fields are declared by the plugin, per source kind, in the manifest: `importSource.corrections.fields` (DISA: `dob_age`, `sex`, `specimen`, `taken`, `collected`, `received_in_lab`, `registered`; OpenLDR v1: the date fields its date rule reads).
- Source rows (`import_copy_rows`) are never written by this feature.
- Capability `imports.correct_held`, label "Correct held requests". In no preset role.
- Audit actions: `import.check.correct`, `import.check.recheck`; CLI acts as `cli`.
- Only held rows with `reason = 'held'` can be corrected.
- Migration 124. Check open branches for 124 before merging.
- Saved corrected request: `v1-corrected` (field names, sorted, comma-joined) and `v1-corrections` (JSON: field, original, value, reason, by, at) before the `v1-check` mark.
- A plugin without `corrections` in its manifest shows no Correct action, and its decode never receives `corrections`.

## Review Focus

- A correction to a field the plugin did not declare: refused by CE before it is stored.
- "Check again" while a check of the same copy is live: refused, nothing written.
- A corrected request that still fails: stays held, its new findings replace the old, corrections stay.
- A full re-run of the copy after a correction: the corrected request stays corrected.
- A user without `imports.correct_held`: both host calls and both CLI commands refused.

---

### Task 1: Storage (CE)

**Files:** create `packages/db/src/migrations/internal/124_import_check_corrections.ts` (+ register in `index.ts`), `packages/db/src/import-check-correction-store.ts` (+ test); modify `packages/db/src/import-check-held-store.ts` (new `fields` jsonb column on `import_check_held`, nullable), schema types.

**Interfaces — Produces:** `createImportCheckCorrectionStore(db)` with `put(row)` (upsert by copy_id+key+field), `listFor(copyId, keys): Map<key, Correction[]>`, `remove(copyId, keys)`, `deleteSome(copyId, limit)`. `Correction = { copyId, key, field, value, original, reason, correctedBy, correctedAt }`. `HeldItem.fields: Record<string, string | null> | null`.

- [ ] Tests first (pg-mem): put twice on one field keeps the second; listFor groups by key; held `put` round-trips `fields`.
- [ ] Implement, run `pnpm --filter @openldr/db exec vitest run src/import-check-correction-store.test.ts src/import-check-held-store.test.ts src/migrations/internal/registration.test.ts`, commit.

### Task 2: Capability (CE)

**Files:** `packages/rbac/src/catalog.ts` (group `imports`), its test, presets test (no preset grants it), studio role labels if the catalog needs i18n keys.

- [ ] Test, implement, run rbac tests, commit.

### Task 3: Check service (CE `packages/bootstrap/src/import-check.ts`)

**Interfaces — Consumes:** Task 1 store as `deps.corrections`. **Produces:** `correct(input: { pluginId, copyId, key, values: Record<string,string|null>, reason, actor }) → { corrections: Correction[] }` and `recheck(input: { pluginId, copyId, key, actor }) → { outcome: 'saved' | 'held' | 'error'; item: HeldItem | null }`; `heldItem` result gains `fields`, `corrections`, `correctable: string[]`.

- [ ] Tests first: `correct` refuses an undeclared field, a `reason='error'` row, an empty reason, a plugin with no `corrections`; stores `original` from the held row's `fields`; writes the audit row. `recheck` refuses a live check of the copy and a missing run; decodes the one key with the run's options, reference and the key's corrections; on pass saves resources under the run's provenance, removes the held row, moves held→saved in the run's counts; on fail re-puts the held row with new findings. `onePage` passes `corrections` for the page's keys when the plugin declares them. The decode output schema accepts `fields` on a group, stored on the held row. Copy deletion and held-row removal also remove corrections.
- [ ] Implement, run `pnpm --filter @openldr/bootstrap exec vitest run src/import-check.test.ts`, commit.

### Task 4: Host calls and SDK (CE)

**Files:** `packages/bootstrap/src/plugin-broker.ts` (ops `import.check.correct`, `import.check.recheck`, zod schemas, capability check `imports.correct_held`), `packages/plugin-ui-sdk/src/types.ts` and `mock.ts` (`correct`, `recheck` on `checks`), broker tests.

- [ ] Tests: both ops refused without the capability; pass-through with it; `heldItem` carries the new fields.
- [ ] Implement, run broker and SDK tests, commit.

### Task 5: CLI and CE docs

**Files:** `packages/cli/src/import-check.ts` (`correct <copyId> <key> --set field=value... --reason`, `recheck <copyId> <key>`), registration in `index.ts`, tests; `apps/web/src/docs/0.1.8/{en,fr,pt}/cli.md`.

- [ ] Tests, implement, docs, commit. Then the full CE gate.

### Task 6: Plugin decode (cdr-source, branch `feat/held-corrections` from `feat/anomaly-flags`)

**Files:** `src/decode.rs`, `src/v1/mod.rs`, a new `src/corrections.rs`, `scripts/build.mjs` (manifest `importSource.corrections.fields` per kind).

**Interfaces:** decode input `corrections: { [key]: [{ field, value, original, reason, by, at }] }` (absent = none). A held group gains `fields: { field: value|null }` for the declared fields.

- [ ] Tests first: a held DISA fixture whose date-of-birth finding goes away when `dob_age` is corrected is saved, with `v1-corrected`/`v1-corrections` before the mark, and its v1 check still compares the uncorrected value; a correction that does not fix it leaves it held with findings; a held group reports `fields`; the same for a v1 dates fixture.
- [ ] Implement, `cargo test`, commit.

### Task 7: Plugin page (cdr-source `ui/`)

**Files:** `ui/src/HeldPanel.tsx` (sheet ⋯ menu: Correct fields, Save and check again; label-left form; "As read" line; reason required), `ui/src/i18n.ts` en/fr/pt, guide en/fr/pt + `docs/GUIDE.md`, tests.

- [ ] Tests first (testing-library, the SDK mock): menu item only when `correctable` is non-empty and the user may correct; Save disabled without a reason; outcome shown. Implement, `pnpm test`, check at 375px, commit.

### Task 8: Ship

- [ ] Codex review of both repos. Merge CE (changelog). Plugin release version per the operator; signing on the laptop and publishing only on the operator's yes.
