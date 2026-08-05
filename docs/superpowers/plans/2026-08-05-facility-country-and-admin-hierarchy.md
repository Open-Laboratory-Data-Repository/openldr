# Facility Country ValueSet + derived admin hierarchy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** stop operators typing **Country** and the four admin levels (**zone / region / district /
council**) by hand, without hardcoding any country's geography into CE source.

**Spec:** `docs/superpowers/specs/2026-08-05-facility-country-and-admin-hierarchy-design.md`. Read it before Task 1.

**Architecture:** Country binds to a seeded ISO 3166-1 alpha-3 ValueSet (from a committed,
public-domain fixture). The four admin levels use a NEW `suggest` field type backed by a NEW
distinct-values endpoint over `facility_registry`, scoped by the parent already chosen — so the
hierarchy is *derived from the data*, is per-country by construction, and is bootstrapped in bulk by
slice 1's CSV importer. Migration `073` repoints the five fields on installs `072` already rewrote.

## Global Constraints

- **Never `git add -A`.** This repo directory is shared with concurrent sessions — add exact paths.
- **No `Co-Authored-By` trailer** on any commit.
- **Gate before merge:** `pnpm turbo run typecheck test --force` must be 67/67. Never pipe turbo
  through `tail`. ⚠ Run it with **nothing else competing** — the user's `--watch` dev servers cause
  `Test timed out` in untouched packages, and turbo aborts all 67 tasks on the first failure. Before
  blaming a change, `grep 'Test timed out'` and re-run that package alone.
- ⛔ **Concept `status` must be UPPERCASE `'ACTIVE'`** — `filterConcepts` compares case-sensitively
  and lowercase yields a **silently empty** expansion, not an error.
- ⛔ **Never compose a ValueSet with a FHIR `filter`** — `filterConcepts` ignores the `op`, so a
  filtered set matches nothing, silently. Enumerate concepts.
- ⛔ **Seeding a resource in a migration has an invisible blast radius.** It writes `fhir.change_log`,
  which shifts a **global bigserial `seq`** and the **global `pendingPush`** baseline
  (`sync-handle.ts` computes `head - cursor`). Last slice this broke tests in two packages the change
  never touched. Write all three rows (`resource_history` → `fhir_resources` → `change_log`, in that
  order — `save()` derives the next version from `max(resource_history.version)`), and expect to bump
  `MIGRATION_SEEDED_CHANGE_LOG_ROWS` in `packages/bootstrap/src/sync-handle.test.ts`.
- ⚠ `packages/db/src/migrations/migrations.test.ts` pins the exact ordered migration list and lives
  one directory **ABOVE** `migrations/internal/`. Run the PARENT dir.
- ⚠ Keep migration inserts **BATCHED**. Per-row loops over hundreds of concepts slow every test that
  calls `makeMigratedDb()` and tip unrelated files over their timeout.
- Migrations `071` and `072` are **merged and frozen** — do not edit them. `073` builds on `072`'s
  exported `BOUND_FIELDS_SNAPSHOT`.
- `@openldr/db` must not import from `@openldr/forms`.

---

## Task 1: The `suggest` field type

**Files:** Modify `packages/forms/src/schema/form-schema.ts`, `packages/forms/src/reference-source.ts`
(only if needed), `apps/studio/src/forms-runtime/FormRuntime.tsx` + its test

A field that **suggests but does not constrain**. Its answer is a **plain string**, so it lands
directly in the existing `text` column with no flattening — unlike `reference`, whose answer is a
`{system, code, display}` object.

- [ ] **Step 1: Read `FormRuntime.tsx`'s `select` and `reference` cases** to match the house shape.
- [ ] **Step 2: Write the failing tests.** A `suggest` field: renders a combobox; typing filters the
  suggestions; picking one sets the answer to that **string**; typing a value **not** in the list is
  accepted and submitted verbatim; an empty suggestion list still allows free typing and shows a
  "no suggestions" state distinct from a loading state.
- [ ] **Step 3: Add `'suggest'` to the `FieldType` enum** and implement the runtime case. Use shadcn
  primitives only — never a native `<select>` or `<datalist>`. Suggestions arrive via a prop/hook;
  the fetch itself is Task 3.
- [ ] **Step 4:** `npx vitest run --dir packages/forms/src` and `--dir apps/studio/src forms-runtime`.
- [ ] **Step 5: Commit.** `feat(forms): add a suggest field type that proposes without constraining`

---

## Task 2: Country ValueSet — fixture-pinned seed

**Files:** Create `packages/db/src/iso3166.ts` (+ test); the fixture at
`packages/db/fixtures/iso3166/` is already committed

- [ ] **Step 1: Read `packages/db/fixtures/iso3166/README.md`** — it records the source, licence and
  the verification that must keep holding.
- [ ] **Step 2: Write the failing test.** Parse the fixture CSV and assert: **249 rows**, 249 unique
  `alpha-3`, 249 unique names, every alpha-3 matches `/^[A-Z]{3}$/`, and the six diacritic names
  (`Åland Islands`, `Côte d'Ivoire`, `Curaçao`, `Réunion`, `Saint Barthélemy`, `Türkiye`) survive
  intact. Spot-check `TZA` = `Tanzania, United Republic of`.
- [ ] **Step 3: Export `ISO3166_COUNTRIES`** — the 249 `[alpha3, name]` pairs as frozen literals,
  generated from the fixture. Add a test asserting the literals still **equal the fixture**, so the
  two can never drift. ⚠ The CSV has quoted fields containing commas — use a real RFC4180 parse, not
  `split(',')`.
- [ ] **Step 4:** `npx vitest run --dir packages/db/src iso3166` + typecheck.
- [ ] **Step 5: Commit.** `feat(db): pin the ISO 3166-1 country list to a committed fixture`

---

## Task 3: The distinct-values endpoint

**Files:** Create `apps/server/src/facility-admin-values-routes.ts` (+ test) or extend
`facilities-routes.ts`; modify `apps/server/src/app.ts`; add the client call in `apps/studio/src/api.ts`

- [ ] **Step 1: Read `apps/server/src/facilities-routes.ts` in full.** It went through two fix rounds;
  follow its capability-gating, error-mapping and query-param sanitising exactly.
- [ ] **Step 2: Write the failing tests.**
  - `GET /api/facilities/admin-values?level=district&region=Dodoma` returns distinct districts for
    that region, **ranked by frequency**, with counts
  - an unknown/blank parent returns the unfiltered distinct list for that level
  - `level` is restricted to the four admin columns — ⛔ an arbitrary value must **not** reach the
    query (column-injection); assert a 400 for `level=password`
  - gated on `facilities.view`; a user without it gets 403
  - the result is capped, and a repeated or non-string query param cannot reach the DB as an array
- [ ] **Step 3: Implement.** Whitelist the four columns explicitly — never interpolate `level` into
  SQL. Cap the row count. Exclude NULL/blank values.
- [ ] **Step 4:** `cd apps/server && npx vitest run src/facility-admin-values` + the package lint
  (⚠ `apps/server` is the only package with real ESLint, incl. the `reply.send` rule) + typecheck.
- [ ] **Step 5: Commit.** `feat(server): distinct admin-area values scoped by the chosen parent`

---

## Task 4: Bind the five fields + migration 073

**Files:** Modify `packages/forms/src/samples/forms.ts` + its test; create
`packages/db/src/migrations/internal/073_facility_country_and_admin_fields.ts` (+ test); modify
`migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`,
`packages/bootstrap/src/sync-handle.test.ts`

- [ ] **Step 1: Read migration `072`** — it is the pattern for the six-write ValueSet seed, the
  `name = 'Facility'` match, the deep-equal guard against the previous frozen snapshot, and the
  marker-gated `down()`.
- [ ] **Step 2: Bind the fields in the sample.** `fld-fac-country` → `fieldType: 'reference'`,
  `valueSetUrl: 'urn:openldr:valueset:country'`. `fld-fac-zone/-region/-district/-council` →
  `fieldType: 'suggest'`. Everything else on each field unchanged. Repoint the existing pin from
  `072`'s `BOUND_FIELDS_SNAPSHOT` to `073`'s new one — **repoint, never delete or weaken**.
- [ ] **Step 3: Write the migration's failing tests.** Country ValueSet seeds 249 concepts, all
  `status='ACTIVE'`, no `filter` in the compose, and its **expansion actually returns rows**; the
  form's five fields are repointed only when the fields deep-equal `072`'s snapshot; an
  operator-edited form is left completely alone; `up()` twice is a no-op; `down()` reverses only what
  `up()` did.
- [ ] **Step 4: Write the migration.** Inline the 249 pairs as frozen literals (do **not** import
  `ISO3166_COUNTRIES` — a migration is a frozen snapshot). Seed concepts into
  **`urn:iso:std:iso:3166`** (FHIR's own system URL — it legitimately holds alpha-2, alpha-3 and
  numeric, so a later real import aligns instead of colliding) under ValueSet
  `urn:openldr:valueset:country`. ⛔ Do **not** overwrite `http://hl7.org/fhir/ValueSet/iso3166-1-3`
  — that is an HL7-published definition. Write all three FHIR rows per the Global Constraints.
- [ ] **Step 5: Register it** in `migrations/internal/index.ts` **and** append to the ordered list in
  `packages/db/src/migrations/migrations.test.ts` (one directory ABOVE `internal/`).
- [ ] **Step 6: Update `MIGRATION_SEEDED_CHANGE_LOG_ROWS`** in `packages/bootstrap/src/sync-handle.test.ts`
  — 073 adds one more seeded resource. Keep the exact arithmetic; do not loosen to a range.
- [ ] **Step 7:** `npx vitest run --dir packages/db/src/migrations` (PARENT), `--dir packages/forms/src`,
  `--dir packages/bootstrap/src`, plus typechecks.
- [ ] **Step 8: Commit.** `feat(db): seed the ISO 3166 country ValueSet and bind the admin fields`

---

## Task 5: Wire the studio page

**Files:** Modify `apps/studio/src/facilities/FacilityDialog.tsx` (+ test), `apps/studio/src/api.ts`

- [ ] **Step 1: Read `FacilityDialog.tsx`.** ⚠ It carries hard-won behaviour: `seedAnswers` reads
  `extras[field.id]` for no-`apiProperty` fields; the submit restores `''` **only for currently
  VISIBLE** fields (via `visibleIds`) so a hidden field is not silently NULLed; `formSchemaId` is the
  form-DEFINITION id. Do not disturb any of it.
- [ ] **Step 2: Write the failing tests.** A `suggest` field fetches its options with the parent
  values currently chosen; changing Region **refetches** District; a value typed but not suggested is
  still submitted; the fetch failing degrades to free text rather than blocking the form.
- [ ] **Step 3: Implement** the suggestions fetch and pass them to the `suggest` field.
- [ ] **Step 4:** `cd apps/studio && npx vitest run` (full package) + typecheck.
- [ ] **Step 5: Commit.** `feat(studio): drive the admin-area fields from registry suggestions`

---

## Task 6: Gate, verify live, merge

- [ ] **Step 1: Full gate** → 67/67, nothing else competing.
- [ ] **Step 2: Prove it on the live dev DB.** Apply `073` against `INTERNAL_DATABASE_URL` and report
  actual counts: the country ValueSet expands to **249**, all concepts `status='ACTIVE'`, the six
  diacritic names intact, and the form's five fields carry their new types/bindings.
- [ ] **Step 3: Merge** to local `main` with `--no-ff`. **Do not push.**
- [ ] **Step 4: Report what is NOT done** — ward/village still free text; no cleanup of already-typo'd
  values; no validation that a district truly belongs to its region (only that the pair has co-occurred).
