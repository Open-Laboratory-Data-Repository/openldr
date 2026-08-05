# Facility CSV import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** make the facility registry populatable. `parseFacilityCsv` exists, is tested, and has
**zero callers** — no CLI, no route, no UI.

**Spec:** `docs/superpowers/specs/2026-08-05-facility-import-design.md`. Read it before Task 1.

**Architecture:** one shared import function in `@openldr/bootstrap` (parse → report → optionally
apply), called by both a CLI command and a Facilities-page upload, per the repo's CLI-parity rule.
Plus the server-side `extras`-preservation fix, which this slice makes reachable for the first time.

## Global Constraints

- **Never `git add -A`.** This repo directory is shared with concurrent sessions — add exact paths.
- **No `Co-Authored-By` trailer** on any commit.
- **Gate before merge:** `pnpm turbo run typecheck test --force` must be 67/67, run with nothing else
  competing. Before blaming a change, `grep 'Test timed out'` and re-run that package alone.
- ⛔ **Do NOT build `upsertByNationalCode`.** Measured: `parseFacilityCsv` sets
  `id = sha256(nationalSystem|nationalCode)`, so `onConflict('id')` already gives keyed re-import.
  Spec §1.1.
- ⛔ **Dry-run by default.** Never silently rewrite 14 000 rows.
- ⛔ **Never delete rows absent from an import** — an incomplete export must not orphan aliases.
- ⛔ **`managed_origin` stays NULL on an imported row.** Slice 1 fixed an inverted version of this
  that made a lab's own imported rows deletable by a central down-sync.
- ⛔ **`nationalSystem` is configuration** — never hardcode a register.
- ⚠ Insert in BATCHES. 14k rows is the stated workload; per-row loops have repeatedly tipped this
  repo's suites over their timeouts.
- ⚠ `apps/server` is the ONLY package with real ESLint, including the `return/await reply.send` rule.
- studio i18n is parity-enforced across en/fr/pt — REAL translations, never English in fr/pt, and
  `{{...}}` only where genuinely interpolated at the call site.
- UI actions live in a ⋯ `DropdownMenu`; shadcn primitives only; `TruncatedText` for clipped labels.

---

## Task 1: Preserve importer-written `extras` on edit

**Files:** Modify `apps/server/src/facilities-routes.ts` + its test

The CSV parser writes unrecognised columns into `extras` under raw header names. `seedAnswers` only
iterates the form's fields, and PUT replaces the bag wholesale — so **editing an imported facility
silently drops every importer-written extra.** Unreachable today only because nothing imports; this
slice makes it live, so it lands first.

- [ ] **Step 1: Read the PUT handler in full.** It survived two fix rounds — note `clearedCoreKeys`,
  the `hasCoreField`/`targetsFacilitiesPage` guards, and that `extras` is currently assigned wholesale.
- [ ] **Step 2: Write the failing tests.**
  - an `extras` key the submitted form does NOT map survives a PUT untouched
  - an `extras` key the form DOES map is still updated by the submission
  - clearing a form-mapped extra still removes it (do not trade this away)
  - `PUT {answers:{}}` no longer wipes unmapped importer keys
- [ ] **Step 3: Implement.** Preserve the `extras` keys the submitted form's field list does not map;
  the form's fields own the keys they do map.
- [ ] **Step 4: Verify.** `cd apps/server && npx vitest run src/facilit`, the package lint, `tsc`.
- [ ] **Step 5: Commit.** `fix(server): keep importer-written facility extras through an edit`

---

## Task 2: The shared import function

**Files:** Create `packages/bootstrap/src/facility-import.ts` (+ test); export from the package index

- [ ] **Step 1: Read** `packages/terminology/src/facility-csv.ts` (the parser contract) and
  `packages/db/src/facility-registry-store.ts` (`upsert`, and the capture binding).
- [ ] **Step 2: Write the failing tests.**
  - dry-run reports `parsed` / `skipped` / `unknownColumns` and writes **nothing**
  - apply inserts new rows and UPDATES existing ones in place (re-import of the same register is
    idempotent — same codes ⇒ same hashed ids)
  - a row already present keeps its `id`, and its attached `facility_aliases` survive
  - unknown columns block the import unless allowed, then land in `extras`
  - rows missing a required field are counted in `skipped`, not thrown
  - a ragged row does not throw
  - **rows absent from the import are NOT deleted**
  - `managed_origin` is NULL on every imported row
- [ ] **Step 3: Implement.** Signature roughly
  `importFacilities(deps, csv, { nationalSystem, allowUnknownColumns?, apply? }) → { parsed, skipped, unknownColumns, created, updated }`.
  Batch the writes. Decide deliberately whether to reuse `store.upsert` per row or add a batched path,
  and justify it in the report — 14k rows through a per-row transaction is the thing to avoid.
  ⚠ Note in the report how many `reference_change_log` rows a 14k import produces (the store's
  capture binding fires per upsert) and whether that needs batching.
- [ ] **Step 4: Verify.** `npx vitest run --dir packages/bootstrap/src facility-import` + `tsc`.
- [ ] **Step 5: Commit.** `feat(bootstrap): shared facility CSV import (parse, report, apply)`

---

## Task 3: The CLI command

**Files:** Modify `packages/cli/src/index.ts`; create `packages/cli/src/facilities.ts` (+ test)

- [ ] **Step 1: Read** how `term.command('import <kind> <path>')` wires to `runTerminologyImport`,
  and how that module audits (`coding_system.import` / `term.import`). Follow both shapes.
- [ ] **Step 2: Write the failing tests.** `--dry-run` writes nothing and prints the summary; apply
  reports created/updated; a missing file and an unreadable file each exit non-zero with a clear
  message (not a stack trace); `--json` emits machine-readable output; unknown columns without
  `--allow-unknown-columns` refuses and names them.
- [ ] **Step 3: Implement**
  `openldr facilities import <path> --national-system <sys> [--dry-run] [--allow-unknown-columns] [--json]`.
  Audit the applied import the way the terminology commands audit theirs.
  ⚠ `@openldr/cli` cannot be built on Windows (esbuild native dep) — run it via
  `node_modules/.bin/tsx packages/cli/src/index.ts …`.
- [ ] **Step 4: Verify.** `npx vitest run --dir packages/cli/src` + `tsc`.
- [ ] **Step 5: Commit.** `feat(cli): openldr facilities import`

---

## Task 4: The HTTP route

**Files:** Modify `apps/server/src/facilities-routes.ts` (+ test)

- [ ] **Step 1: Write the failing tests.**
  - gated on `facilities.manage` (a write) — a `facilities.view`-only user gets 403
  - dry-run returns the summary and writes nothing
  - apply returns created/updated counts
  - the upload is size-capped and a non-CSV/oversized body is rejected with a clear 400
  - unknown columns are reported, not swallowed
  - the mutation is audited
- [ ] **Step 2: Implement**, calling Task 2's function. Follow the file's existing conventions:
  capability gating passed as the route options argument, `mapFacilityDbError`, `ownFirstString`.
- [ ] **Step 3: Verify.** `cd apps/server && npx vitest run src/facilit`, the package lint, `tsc`.
- [ ] **Step 4: Commit.** `feat(server): facility CSV import endpoint`

---

## Task 5: The Facilities-page upload

**Files:** Modify `apps/studio/src/pages/Facilities.tsx`, `apps/studio/src/api.ts`, the three i18n
files; create an import sheet component (+ tests)

- [ ] **Step 1: Read `Facilities.tsx`.** ⚠ Preserve what prior reviews fixed: the two empty states
  stay DISTINCT ("no published facilities form" names its own cause vs "no facilities yet"); write
  affordances are gated on `facilities.manage`; the table renders whenever rows exist even without a
  published form; the truncation banner.
- [ ] **Step 2: Write the failing tests.** The ⋯ menu offers **Import facilities** only with
  `facilities.manage`; choosing a file and a national system shows the **dry-run summary first**;
  confirming applies and reloads the list; unknown columns are shown with the explicit opt-in; a
  failed import surfaces the server's message and does not close the sheet.
- [ ] **Step 3: Implement.** ⋯ menu item + sheet. Real fr/pt for every new string.
- [ ] **Step 4: Verify.** `cd apps/studio && npx vitest run` (full package) + `tsc`.
- [ ] **Step 5: Commit.** `feat(studio): import facilities from a CSV on the Facilities page`

---

## Task 6: Gate, verify live, merge

- [ ] **Step 1: Full gate** → 67/67, nothing else competing.
- [ ] **Step 2: Prove it on the live dev DB.** Import a small CSV via the CLI against
  `INTERNAL_DATABASE_URL`: report the dry-run summary, then the applied counts, then **re-import the
  same file** and show it UPDATES rather than duplicating (row count unchanged). Confirm
  `managed_origin` is NULL on every imported row.
- [ ] **Step 3: Merge** to local `main` with `--no-ff`. **Do not push.**
- [ ] **Step 4: Report what is NOT done** — `upsertByNationalCode` (deliberately, spec §1.1); the
  hand-created-vs-imported duplicate (spec §6); reconciling the 23 `performer` strings; the entity
  resolver (Slice B, needs its own brainstorm).
