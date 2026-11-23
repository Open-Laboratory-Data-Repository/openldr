# Test catalog: ages in days, units from UCUM, LOINC hints

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ranges can be set for newborns and infants, units are picked from UCUM, and a LOINC code suggests a test's category, specimens and result fields.

**Architecture:** Shared rules live in `@openldr/bootstrap`. The Fastify routes and the CLI call the same functions. The Test catalog sheet reads one hints route. The lab plugin follows the band change.

**Tech stack:** TypeScript, Kysely, Fastify, React with shadcn, vitest and pg-mem; Rust in the lab plugin.

**Spec:** `docs/superpowers/specs/2026-11-23-test-catalog-hints-design.md`. Read its section 3 calls; they are the rulings of this plan.

## Global constraints

- CE work goes in worktree `.claude/worktrees/lab-module`, on branch `feat/test-catalog-hints` from main. Plugin work goes in `openldr-ce-plugin-lab`, on branch `feat/age-units` from its main.
- The test install at port 3220 runs from that worktree's built `dist`. Never build there. A live run builds in a separate detached worktree, which is removed after.
- No migration unless a task needs one. If one is needed, check that no other branch claims its number.
- Never hardcode clinical vocabulary (AGENTS.md section 8). Units, specimens, categories and answers come from terminology. The age unit codes `d`, `mo` and `a` are UCUM, and `y` is the stored form of `a`.
- AGENTS.md section 5 UI rules. Strings in en, fr and pt. No em dashes. No `Co-Authored-By` trailer.
- The gate:
  - `pnpm turbo run test --force --concurrency=2 --continue`;
  - `pnpm turbo run typecheck --force --concurrency=2`;
  - `pnpm --filter @openldr/server lint`.

  Never pipe turbo through `tail`.

## Review focus

1. A newborn (born today) gets a "0 to 28 days" range as `fits: yes`, and an adult range as `no`. A 2-year-old fits "1 to 5 years" and not "1 to 12 months" (Task 1).
2. A range saved before this change, with no `ageUnit`, matches exactly as before (Task 1).
3. A LOINC suggestion never overwrites a category, specimen or field someone already set (Task 5).
4. "Fill from panel" twice does not duplicate result fields or value sets (Task 4).
5. Without LOINC loaded, the sheet works as today and offers no hint controls (Tasks 4 and 5).

---

### Task 1: Age unit on ranges (CE)

**Files:**
- `packages/bootstrap/src/result-params.ts`: `ResultBand.ageUnit`, `toBand`, `parseResultParams`, and one exported `bandFits(band, patient: { sex, birthDate, at })`. `matchBand` and `fits` use it.
- the shared age helper from plan 2 (find it), changed to work in days;
- `test-catalog.ts` (`resultParamsFor`);
- `apps/server/src/test-catalog-routes.ts` (band schema);
- `packages/forms` (band types, extractor: `referenceRange.age` in UCUM);
- the studio's `CatalogResultBand` and `TestSheet.tsx` (an age-unit picker in the band row, labels from the unit);
- `plugin-host.ts` (`testCatalog.resultParams` answers `ageUnit`).

`resultParamsFor` and the bench route take the patient's birth date, not whole years.
- [ ] **Tests:**
  - Review focus 1 and 2.
  - Months as whole calendar months, at month ends.
  - Each copy place in spec section 4 keeps `ageUnit`; each test fails if it is dropped.
  - The studio band row saves the unit, and labels "Under 28 days".
- [ ] **Commit** `feat(test-catalog): reference ranges by days, months or years`.

### Task 2: Units from UCUM (CE)

**Files:**
- `test-catalog.ts` `options()` adds `ucum: { systemId, system }` when the UCUM system is present;
- `TestSheet.tsx`: the band unit becomes `TermPicker` over UCUM, with "Use '<typed>'" for a unit not in UCUM and a "Not a UCUM unit" note;
- a result field's default unit (`parm_units`) prefills a new band's unit.
- [ ] **Tests:** picking a UCUM unit saves its code; a typed unit is kept with the note; a saved non-UCUM unit opens unchanged; with no UCUM system the plain input stays.
- [ ] **Commit** `feat(test-catalog): pick a range's unit from UCUM`.

### Task 2b: Turnaround and review on the test (CE)

Spec section 3.9.

**Files:**
- `CatalogTest` and `CatalogTestInput` gain `expectedTatHours`, `criticalTatHours` and `requiresVerification`, stored as concept properties. A test without them reads `null`, `null` and `true`.
- the route schema;
- the CSV import and export columns, `test-catalog-import.ts` and `exportCsv`;
- the CLI `test-catalog set` options, or the existing edit command if there is one;
- `TestSheet.tsx`: two number inputs and a switch in basic information;
- `plugin-host.ts`: `testCatalog.get` and `list` answer them.
- [ ] **Tests:**
  - The values round-trip through create and update, CSV and CLI.
  - An old test reads the defaults.
  - A negative or non-number TAT is refused.
  - A test from central keeps the central values.
- [ ] **Commit** `feat(test-catalog): turnaround times and review on the test`.

### Task 3: Lab plugin follows the age unit (plugin repo)

**Files:** `src/results.rs` (band equality includes `ageUnit`; a missing unit equals `y`); `ui/src/results/ranges.ts` (labels by unit, en/fr/pt); contract fixtures regenerated from CE's new answer shape.
- [ ] **Tests:** a band differing only in `ageUnit` is refused on save; labels for d, mo and y; old bands without the unit still pass.
- [ ] **Commit** `feat: ranges by days, months or years`.

### Task 4: LOINC hints and fields from LOINC (CE, server and CLI)

**Files:**
- New `packages/bootstrap/src/loinc-hints.ts`:
  - `loincHints(code)` returns `{ display, class, categorySuggestion, unit, specimens: [{ snomed, equivalence, specimenType? }], answers, panelMembers }`. It returns null when LOINC or its ontology is not loaded.
  - `resultFieldsFromLoinc(codes)` creates missing result-field concepts in `urn:openldr:default_result` with the LOINC code, name and unit. For coded ones it also creates `urn:openldr:valueset:loinc-answers:<code>`. It returns the `TestResultParam` entries. It never duplicates.
- Specimen matching per spec 3.4: a concept code equal to the SNOMED code, or `$translate` through the local map.
- Route `GET /api/test-catalog/loinc-hints/:code` (`testCatalog.view`). Route `POST /api/test-catalog/result-fields/from-loinc` (`testCatalog.edit`, audited).
- CLI:
  - `openldr test-catalog loinc-hints <code> [--json]`;
  - `openldr test-catalog result-fields from-loinc <code...> [--panel] [--json]`.

  Both are registered in `packages/cli/src/index.ts`.
- [ ] **Tests (pg-mem plus the LOINC fixture under `packages/terminology`):**
  - Review focus 4 and 5.
  - Category suggested only on a value-set match.
  - One equivalent specimen match is flagged to tick, several are not.
  - A local-map translate matches BLD.
  - The route wire shapes.
  - The CLI output.
- [ ] **Commit** `feat(test-catalog): hints and result fields from a LOINC code`.

### Task 5: The sheet uses the hints (CE studio)

**Files:** `TestSheet.tsx`, its API client, i18n.
- On picking a LOINC code, the sheet reads the hints. It fills each field that is still empty: category, the one equivalent specimen, and the result field with its unit. Otherwise it shows a short hint line under each field.
- The Result parameters `⋯` menu gains "Use LOINC's result field" and, for a panel, "Fill from panel". Both call the Task 4 route, then add the fields.
- The same menu gains "Add field" (operator's Corlix screenshots, 2026-11-23). In Corlix a field is typed right on the test. Here a small sheet asks for:
  - a label;
  - a type (number, coded or text);
  - a unit from UCUM (Task 2), for a number;
  - a value set, for a coded field.

  It saves the field to `urn:openldr:default_result` through the existing result field path (reuse `ResultFieldSheet` from the Result fields tab) and ticks it on the test. Then nobody has to leave the test to define a field.
- [ ] **Tests:** Review focus 3 and 5; the panel fill adds members in order; hints are hidden when the route answers null.
- [ ] **Commit** `feat(test-catalog): the test sheet suggests from LOINC`.

### Task 6: Docs, live run, 3220

- **Docs:** the Test catalog guide, in-app and web, en/fr/pt: age units, the UCUM picker, LOINC hints and "Fill from panel". Say that LOINC must be loaded first, and how.
- **Live run** in a separate detached worktree on a throwaway install. Load the LOINC fixture with `openldr terminology import loinc` and build its ontology. Then:
  1. Define a test from a LOINC code and a panel.
  2. Set a newborn range.
  3. Register a newborn in the lab plugin, enter a result, and see the newborn range start selected.
- **Gate.**
- **3220**, after the operator approves merging. Rebuild, update the plugin, set Haemoglobin's newborn range, and take screenshots of the sheet and the plugin's picker for the newborn John Doe.

Order: 1, 2, 3, 4, 5, 6. Task 3 follows Task 1. Tasks 2 and 4 do not depend on each other.
