# Facility Level + Status ValueSets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** an operator picks facility **Level** (63 HFR types) and **Status** (FHIR location-status)
from a searchable list instead of typing them.

**Spec:** `docs/superpowers/specs/2026-08-04-facility-level-status-valuesets-design.md`. Read it before Task 1.

**Architecture:** Two ValueSets seeded by migration `072` following `014_value_sets.ts`'s six-table
pattern. The Facility form's `level`/`status` fields become `reference` fields bound by `valueSetUrl`.
`splitFacilityAnswers` flattens the picked coding to its `display` so it lands in the existing `text`
column. `072` also repoints the fields on installs `071` already rewrote, since migrations never re-run.

## Global Constraints

- **Never `git add -A`.** This repo directory is shared with concurrent sessions — add exact paths.
- **No `Co-Authored-By` trailer** on any commit.
- **Gate before merge:** `pnpm turbo run typecheck test --force` must be 67/67. Never pipe turbo through `tail`.
  ⚠ Run it with **nothing else competing** — the user's `--watch` dev servers cause `Test timed out`
  failures in untouched packages, and turbo aborts all 67 tasks on the first failure.
- ⛔ **Concept `status` must be written UPPERCASE `'ACTIVE'`.** `filterConcepts` compares
  case-sensitively; lowercase yields a **silently empty** expansion, not an error.
- ⛔ **Never compose a ValueSet with a FHIR `filter`.** `filterConcepts` ignores the filter `op`
  entirely, so `is-a` and friends match nothing, silently. Enumerate concepts explicitly.
- ⛔ **`data-select2-id` numbers are NOT codes** — select2 assigns them at render time. Use the slugs below.
- **`@openldr/db` must not import `@openldr/forms`** (forms already depends on db).
- ⚠ `packages/db/src/migrations/migrations.test.ts` pins the exact ordered migration list and lives one
  directory **ABOVE** `migrations/internal/`. A `--dir .../internal` run will NOT catch a missing entry.
- Migration `071` is **merged and frozen** — do not edit it. `072` builds on its exported snapshots.

---

## Task 1: Flatten a coding answer onto a core column

**Files:** Modify `packages/db/src/facility-answers.ts`, `packages/db/src/facility-answers.test.ts`

A `reference` field's answer is `{ system, code, display }`. Written to `facility_registry.level`
(a `text` column) that object raises Postgres `22P02`, surfacing as a raw 500.

- [ ] **Step 1: Write the failing tests.** Append to `facility-answers.test.ts`:
  - a coding answer on a core key (`level`) yields `record.level === 'Level IA2 (Dispensary Laboratory)'`
  - a coding answer with a null/absent `display` falls back to its `code`
  - a **bare string** answer on the same key still passes through unchanged (the pre-existing
    free-text path — this is what makes the edit round-trip safe)
  - a coding answer on a **non-core** key still lands in `extras` **unflattened**, as the object
    (extras is jsonb; flattening there would lose the code for no benefit)
  - blank/whitespace handling is unchanged for both shapes

- [ ] **Step 2: Run them and see them fail.** `npx vitest run --dir packages/db/src facility-answers`

- [ ] **Step 3: Implement.** Add a narrow type guard (a record with string `system` and `code`) and
  flatten to `display ?? code` **only** on the `CORE_FACILITY_KEYS` branch. Do not touch the numeric
  (`latitude`/`longitude`) branch or the extras branch. Document *why* display wins over code —
  the spec's §2.3 reasoning, one sentence.

- [ ] **Step 4: Verify.** Tests pass; `npx tsc --noEmit -p packages/db/tsconfig.json` clean.

- [ ] **Step 5: Commit.** `git add packages/db/src/facility-answers.ts packages/db/src/facility-answers.test.ts`
  → `feat(db): flatten a picked coding answer onto its facility column`

---

## Task 2: Bind the form's Level and Status fields

**Files:** Modify `packages/forms/src/samples/forms.ts`, `packages/forms/src/samples/forms.test.ts`

**Interfaces produced (Task 3 writes these exact shapes into already-migrated installs):**
- `urn:openldr:valueset:facility-type`
- `urn:openldr:valueset:location-status`

- [ ] **Step 1: Write the failing test.** In `forms.test.ts`, assert the Facility form's `status` and
  `level` fields each have `fieldType: 'reference'` and the exact `valueSetUrl` above, that both are
  still `required`, and that the existing "every `apiProperty` is in `CORE_FACILITY_KEYS`" and
  "exactly the agreed required set" assertions still hold unchanged.

- [ ] **Step 2: Run it and see it fail.**

- [ ] **Step 3: Change the two fields.** Keep `id`, `fhirPath`, `displayLabel`, `order`, `required`,
  `cardinality` and `apiProperty` exactly as they are. Change only `fieldType` to `'reference'` and
  add `valueSetUrl`. Do **not** set `referenceTarget` — `valueSetUrl` wins and the lint rule warns
  when both are present.

- [ ] **Step 4: Run the whole forms package.** `npx vitest run --dir packages/forms/src` — includes
  the lint suite (`ambiguous-fhir-path`, `target-contract-violation`). All must stay clean.

- [ ] **Step 5: Commit.** `git add packages/forms/src/samples/forms.ts packages/forms/src/samples/forms.test.ts`
  → `feat(forms): bind facility Level and Status to ValueSets`

---

## Task 3: Migration 072 — seed the ValueSets and repoint migrated forms

**Files:** Create `packages/db/src/migrations/internal/072_facility_level_status_valuesets.ts` + its
test; modify `packages/db/src/migrations/internal/index.ts` and `packages/db/src/migrations/migrations.test.ts`

- [ ] **Step 1: Read `packages/db/src/migrations/internal/014_value_sets.ts` in full.** It is the
  pattern to follow — six coordinated writes per ValueSet: `coding_systems` → `terminology_concepts`
  (status `'ACTIVE'`) → `value_sets` → `valueset_expansions` → `fhir_resources` (via
  `valueSetToFhirResource`) → `terminology_systems`. Every insert is `onConflict(...).doNothing()`
  so re-running is a no-op. Follow it exactly rather than inventing a shorter path.

- [ ] **Step 2: Write the failing tests.** Cover:
  - both ValueSets seed, and **each expansion actually returns its concepts** (the guard against the
    silent-empty-expansion failure mode — assert a non-zero row count and one known code)
  - every seeded concept has **UPPERCASE** `status = 'ACTIVE'`
  - the facility-type ValueSet has **63** concepts, with unique codes and unique displays
  - `up()` run twice is a no-op (no duplicate rows, no throw)
  - a Facility form matching `071`'s `NEW_FIELDS_SNAPSHOT` gets its `level`/`status` fields repointed
  - ⛔ an **operator-edited** form (any field differing from that snapshot) is left completely alone
  - a form already carrying the new bound fields is left alone

- [ ] **Step 3: Run them and see them fail.**

- [ ] **Step 4: Write the migration.**
  - **Status ValueSet:** url `urn:openldr:valueset:location-status`, id `vs-seed-location-status`,
    over system `http://hl7.org/fhir/location-status` with FHIR's own codes:
    `['active','Active'], ['suspended','Suspended'], ['inactive','Inactive']`.
    Flip that system's existing `coding_systems` row to `active: true` (it ships as an inactive stub).
  - **Level ValueSet:** url `urn:openldr:valueset:facility-type`, id `vs-seed-facility-type`, over a
    **new** system `urn:openldr:cs:facility-type` (⚠ NOT `urn:openldr:cs:local` — 014's shared code
    space dedups on code alone and would silently drop collisions). Register that system in
    `coding_systems` the way 014 registers its local one. The 63 `[code, display]` pairs are listed
    verbatim at the bottom of this plan — transcribe them exactly.
  - **The form repoint:** find the Facility form by `name = 'Facility'` (as `071` does — the
    deterministic id misses installs seeded before `ede345a7`). Deep-equal its `schema.fields`
    against `071`'s exported `NEW_FIELDS_SNAPSHOT`; only on an exact match, rewrite the `level` and
    `status` fields to the Task 2 shapes. Inline those two field literals — a migration is a frozen
    snapshot and must not import the moving sample.
  - **`down()`:** reverse only what `up()` did, and only on rows it actually changed. Follow `071`'s
    marker discipline rather than an unconditional restore — `071`'s `down()` was a Critical review
    finding for exactly that.

- [ ] **Step 5: Register it.** Add `072_facility_level_status_valuesets` to
  `migrations/internal/index.ts`, then append it to the expected array in
  `packages/db/src/migrations/migrations.test.ts`. ⚠ That file is one directory **above**
  `internal/` — this exact miss broke the gate in slice 1.

- [ ] **Step 6: Run the PARENT directory.** `npx vitest run --dir packages/db/src/migrations`
  (not `--dir .../internal`), plus `npx tsc --noEmit -p packages/db/tsconfig.json`.

- [ ] **Step 7: Commit.** Add the four exact paths →
  `feat(db): seed facility-type and location-status ValueSets and bind the form`

---

## Task 4: Gate, verify against the dev DB, merge

- [ ] **Step 1: Full gate.** `pnpm turbo run typecheck test --force` → 67/67, run with nothing else
  competing. If a package you did not touch fails, `grep 'Test timed out'` and re-run it alone before
  blaming the change.

- [ ] **Step 2: Prove it on the live dev DB.** The user's install has already run `071`. Apply `072`
  against `INTERNAL_DATABASE_URL` and confirm: both ValueSets expand to 3 and 63 concepts, all with
  `status = 'ACTIVE'`; and the Facility form's `level`/`status` now carry their `valueSetUrl`.
  Report the actual counts — a silently empty expansion is the failure mode this whole plan guards.

- [ ] **Step 3: Merge.** Branch → local `main` with `--no-ff`. **Do not push.**

- [ ] **Step 4: Report what is NOT done.** No FHIR `Location` export (when added it must emit the
  ValueSet *code*, recovered from the stored display); no back-fill of existing typo'd rows;
  `zone`/`region`/`district`/`council` remain free text.

---

## Appendix: the 63 facility-type concepts

Generated by slugifying the HFR display strings; verified 63/63 unique codes and 63/63 unique
displays. Displays are verbatim from the source, including its inconsistent casing
(`Mobile Dental clinic`, `speech and language therapy clinic`) — do not "fix" them, they are the
vocabulary as published.

```
['dispensary', 'Dispensary'],
['health-center', 'Health Center'],
['mobile-medical-clinic', 'Mobile Medical Clinic'],
['polyclinic', 'PolyClinic'],
['super-specialised-clinic', 'Super Specialised Clinic'],
['specialised-clinic', 'Specialised Clinic'],
['medical-clinic', 'Medical Clinic'],
['eye-clinic', 'Eye Clinic'],
['basic-dental-clinic', 'Basic Dental Clinic'],
['radiology-services-center', 'Radiology Services Center'],
['physiotherapy-clinic', 'Physiotherapy Clinic'],
['ambulance-and-air-services', 'Ambulance and Air Services'],
['ship-services', 'Ship Services'],
['optometry-clinic', 'Optometry Clinic'],
['specimen-collection-point', 'Specimen Collection Point'],
['nursing-home', 'Nursing Home'],
['maternity-home', 'Maternity Home'],
['maternity-and-nursing-home', 'Maternity and Nursing Home'],
['warehouse', 'Warehouse'],
['national-hospital', 'National Hospital'],
['national-super-specialized-hospital', 'National Super Specialized Hospital'],
['zonal-referral-hospital', 'Zonal Referral Hospital'],
['regional-referral-hospital', 'Regional Referral Hospital'],
['district-hospital', 'District Hospital'],
['optical-laboratory', 'Optical Laboratory'],
['optical-manufacturing-factory', 'Optical Manufacturing Factory'],
['optical-surfacing-unit', 'Optical Surfacing Unit'],
['supplying-and-distribution-unit-of-optical', 'Supplying and Distribution unit of Optical'],
['hospital-at-zonal-level', 'Hospital at Zonal Level'],
['hospital-at-regional-level', 'Hospital at Regional Level'],
['hospital-at-district-level', 'Hospital at District Level'],
['dental-hospital', 'Dental Hospital'],
['dialysis-clinic', 'Dialysis Clinic'],
['general-clinic', 'General Clinic'],
['specialized-polyclinic', 'Specialized Polyclinic'],
['super-specialized-polyclinic', 'Super Specialized Polyclinic'],
['comprehensive-dental-clinic', 'Comprehensive Dental Clinic'],
['mobile-dental-clinic', 'Mobile Dental clinic'],
['level-ia2-dispensary-laboratory', 'Level IA2 (Dispensary Laboratory)'],
['level-ia1-health-center-laboratory', 'Level IA1 (Health Center Laboratory)'],
['level-iia2-district-laboratory', 'Level IIA2 (District Laboratory)'],
['level-iia1-regional-laboratory', 'Level IIA1 (Regional Laboratory)'],
['level-iii-multipurpose-health-laboratory', 'Level III Multipurpose Health Laboratory'],
['level-iii-single-purpose-health-laboratory', 'Level III Single purpose Health Laboratory'],
['dental-laboratory', 'Dental Laboratory'],
['prosthetics-and-orthotics-clinic', 'Prosthetics and Orthotics clinic'],
['speech-and-language-therapy-clinic', 'speech and language therapy clinic'],
['mobile-radiology-and-imaging-centre', 'Mobile Radiology and Imaging Centre'],
['occupational-therapy-clinic', 'Occupational Therapy Clinic'],
['psychiatric-clinic', 'Psychiatric Clinic'],
['diagnostic-centre', 'Diagnostic Centre'],
['specialised-dental-clinic', 'Specialised Dental Clinic'],
['specialised-eye-clinic', 'Specialised Eye Clinic'],
['district-vaccine-store', 'District Vaccine Store'],
['specialised-hospital-level-iii', 'Specialised Hospital (Level III)'],
['specialised-hospital-level-ii', 'Specialised Hospital (Level II)'],
['specialised-hospital-level-i', 'Specialised Hospital (Level I)'],
['aesthetic-clinic-level-iii', 'Aesthetic Clinic (Level III)'],
['aesthetic-clinic-level-ii', 'Aesthetic Clinic (Level II)'],
['aesthetic-clinic-level-i', 'Aesthetic Clinic (Level I)'],
['health-post', 'Health Post'],
['consultation-clinic', 'Consultation Clinic'],
['gym', 'Gym'],
```
