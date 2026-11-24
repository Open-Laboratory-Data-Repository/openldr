# Test catalog Corlix parity, plan B: field settings, more types, range fields, codings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A test's result fields carry Corlix's settings and types, its ranges carry Corlix's extra fields, and a test holds additional codings.

**Architecture:** Everything new lives in the test concept (`resultParams` and a `codings` property), so there is no migration, and it syncs with the test. One exception: the lab's country is a new lab identity setting. Bootstrap owns the rules (`result-params.ts`, `test-catalog.ts`). The route, the CLI, the forms extractor, the studio and the lab plugin follow.

**Tech stack:** TypeScript, Kysely, Fastify, React with shadcn, vitest and pg-mem; Rust and React in the lab plugin.

**Spec:** `docs/superpowers/specs/2026-11-24-loinc-pick-parity-design.md`, section 4 (calls 8 to 11) and section 6. Those calls are rulings. The test identity change (`docs/superpowers/specs/2026-11-24-test-identity-design.md`) is built: a test's concept code is its fixed id, and `testCode` is the national code.

**Research:** every touch point with file:line is in `.superpowers/sdd/plan-b-research/touch-points.md`. Read the part for your task first.

**Corlix reference:** `/home/fredrick/Projects/Repositories/corlix` at `0f308aee`. The touch-points file names the lines for each call.

## Global constraints

- CE work in this worktree, branch `claude/test-catalog-corlix-parity-967249`. Plugin work in `/home/fredrick/Projects/Repositories/openldr-ce-plugin-lab-corlix-parity`, branch `feat/corlix-parity`. Nothing is merged or pushed.
- No migration. Never use ports 3000, 5433, 3210, 3212, 3213, 3220, 54320, 54331, 54332 or 54340. Never connect to the dev databases.
- Never hardcode clinical vocabulary (AGENTS.md section 8). Countries come from CE's country value set; coding systems from the loaded systems.
- **Band compatibility.** Every new band field is written only when it is set, like `ageUnit`. Absent means: pregnancy any, no country, no dates, no source, no scope. Every band equality check reads absent and the "any" value as equal. There are five such checks (touch points, risk 1), and each must follow this.
- **`required` defaults to true when absent**, so saved tests keep today's behaviour.
- AGENTS.md section 5 UI rules: ⋯ menus, sheets not dialogs, label left and input right, shadcn only, mobile at 375 px. Strings in en, fr and pt. No em dashes. No `Co-Authored-By` trailer.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue`, `pnpm turbo run typecheck --force --concurrency=2`, `pnpm --filter @openldr/server lint`. Never pipe turbo through `tail`.

## Calls made in this plan (for the report)

1. **The lab's country** is a new lab identity setting (`country`, ISO 3166-1 alpha-3 from CE's country value set `urn:openldr:valueset:country`). It is set in Settings, Laboratory, the settings route and `openldr lab set --country`. A band's `country` uses the same alpha-3 codes. Corlix's input looks alpha-2, but CE's list is alpha-3, so CE uses alpha-3.
2. **A band with a country** fits when it matches the lab's country, does not fit when it differs, and answers unknown when the lab has no country set.
3. **Validity dates** compare with the result date (the bench's `at`, else today). Outside the dates, the band does not fit. These checks live in the fit only (`bandFit`), never in the band equality check, so a band picked at the bench is never refused at submit for its dates.
4. **Pregnancy** answers unknown for a band marked pregnant or not pregnant, as the spec says. Nothing in CE holds pregnancy status.
5. **`min`, `max`, `decimals`, `minLength`, `maxLength`, `dateLimit`** are entry limits, not ranges. The lab plugin refuses a value outside them. The bench shows them and does not refuse (spec call 8: "the bench shows them").
6. **New types in the warehouse.** No warehouse schema change. `boolean` lands as result type `ST` with value text `true` or `false`. `date` lands as `DT` with the ISO date as value text. `multicoded` lands one row per answer, as `CE`.
7. **`multicoded`** sends one Observation per chosen answer. The lab plugin's Observation id adds the answer code for this type only, so other types keep their ids.
8. **Field order.** The Test sheet draws the ticked fields in `resultParams` order, then the unticked ones. Move up and Move down change that order. The Reference ranges section follows the same order.
9. **Field settings** open in a sheet ("Field settings"), from the field's ⋯ menu. Corlix uses an inline panel; AGENTS.md section 5 wants sheets.
10. **Codings.** `codings: Array<{ system, code, display, purpose, note }>`, with purpose `ADDITIONAL | INDICATION | PROCEDURE | CATEGORY` (Corlix's names). The CSV carries them as one `codings` column holding a JSON array. The CLI takes `test-catalog set --codings <file.json>`. ServiceRequest codings become LOINC, Test code, then each coding, then the id, so `panel_code` does not change.
11. **The lab plugin** sends LOINC first too (moved here from the identity review), then the Test code, the codings and the id, the same order as CE.
12. **An older lab plugin** with this CE treats the new types as text and refuses them. The plugin from this branch ships with it, and the docs say so. No version gate.

## Review focus

1. A test saved before plan B (no `required`, no new band fields) behaves exactly as today in the bench, the forms route band check, and the lab plugin's submit and authorise (Tasks 1, 3, 6).
2. A band with only `pregnancy: 'any'` or `scope` set compares equal to the same band saved without them, in all five equality checks (Tasks 1, 3, 6).
3. An optional field left empty does not block the plugin's submit or authorise; a required one still does (Task 6).
4. A multicoded result with three answers sends three Observations with distinct ids, and lands as three warehouse rows (Tasks 3, 6).
5. A CSV with codings, exported and imported again, reports no change (Task 5).

---

### Task 1: Field settings, types and range fields in bootstrap, route and CLI

**Files:** `packages/bootstrap/src/result-params.ts`, `packages/bootstrap/src/test-catalog.ts` (checkTest, resultParamsFor), `apps/server/src/test-catalog-routes.ts` (band and resultParam schemas), `packages/cli/src/test-catalog.ts` (formatResultParams), `packages/forms/src/test-details.ts` (`ResultBandRef`, `TypedResult`), `apps/studio/src/api.ts` (types only). Tests beside each.

**Interfaces (produces):**

```ts
export type ResultType = 'numeric' | 'coded' | 'text' | 'boolean' | 'date' | 'multicoded';
export type DateLimit = 'any' | 'past' | 'future';
TestResultParam gains (all optional; absent = default):
  required?: boolean;                 // default true
  min?: number | null; max?: number | null; decimals?: number | null;   // numeric only
  minLength?: number | null; maxLength?: number | null;                  // text only
  dateLimit?: DateLimit;                                                 // date only, default 'any'
ResultBand gains (all optional, written only when set):
  pregnancy?: 'pregnant' | 'not-pregnant';   // absent = any
  country?: string;                           // ISO 3166-1 alpha-3
  validFrom?: string; validTo?: string;       // YYYY-MM-DD
  source?: 'WHO' | 'CLSI' | 'EUCAST' | 'national' | 'facility';
  scope?: 'global' | 'national' | 'facility';
BandPatient gains: labCountry?: string | null;   // the fit's context; add `at` if it is not there
```

`coded` and `multicoded` both need a value set. Settings that do not belong to the type are dropped by `parseResultParams` and refused by the route.

- [ ] **Step 1: Write the failing tests:**
  - `parseResultParams` keeps `required`, the per-type settings and the new band fields; drops settings of another type; keeps a saved param with none of them unchanged (review focus 1).
  - `toBand` writes a new band field only when set; `pregnancy: 'any'` is not written.
  - `bandFit`: an equal country fits, another country does not, and a lab with no country answers unknown. A date before `validFrom` or after `validTo` does not fit. A pregnancy band answers unknown.
  - `findCatalogBand` ignores the validity dates and country when comparing (call 3), and treats absent and any as equal (review focus 2).
  - `checkTest` refuses `min > max`, negative `decimals`, `minLength > maxLength`, a country not in the country value set, `validFrom > validTo`, an unknown source or scope, and a multicoded param without a value set.
  - The route accepts and answers every new field (wire shape test); zod declares each.
  - `openldr test-catalog params <code>` prints type, required and settings; `--set` round-trips them.
- [ ] **Step 2: Run and see them fail** (bootstrap, server, cli, forms).
- [ ] **Step 3: Implement.** `resultParamsFor` passes the lab's country into the fit. Add it to the catalog deps from lab identity. Task 2 adds the setting; until then the deps may answer null, and tests pass a value.
- [ ] **Step 4: Run and see them pass**, plus the full suites of the touched packages and their typecheck.
- [ ] **Step 5: Commit** `feat(test-catalog): field settings, more result types and range fields`.

### Task 2: The lab's country setting

**Files:** `packages/config/src/lab-identity.ts:69-100`, `apps/server/src/settings-routes.ts:17-28`, `packages/cli/src/program.ts:542-549` (`lab set --country`), the studio Settings, Laboratory page (find it beside the time zone field), and the catalog deps that Task 1 reads. i18n en, fr, pt.

- [ ] **Step 1: Write the failing tests:** the setting saves and reads (route, CLI); a code not in `urn:openldr:valueset:country` is refused; the Settings page shows a country picker (shadcn, from the value set), label left; `resultParamsFor` uses the saved country.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, plus the full suites of touched packages, typecheck and server lint.
- [ ] **Step 5: Commit** `feat(settings): the lab's country`.

### Task 3: New types through the forms, the extractor, the warehouse and the bench

**Files:**
- `packages/forms/src/test-details.ts`: parse keeps the new types; QR items write boolean as `valueBoolean`, date as `valueDate`, and multicoded as one answer per chosen code; `readTestDetails` reads every answer for multicoded.
- `packages/forms/src/extract/test-results.ts:14-24`: `valueBoolean`, `valueDateTime`; multicoded makes one Observation per answer, each with the field's code.
- `packages/fhir/src/resources/observation.ts`: declare `valueBoolean` and `valueDateTime`.
- `packages/db/src/relational/observation.ts:20-45`: call 6.
- Studio `TestDetailSheet.tsx`: entry per type (boolean a Switch; date the shadcn DatePicker; multicoded the shadcn multi-select); the required mark and the limits shown; `sameBand` per review focus 2.
- `apps/studio/src/forms-runtime/rangeLabel.ts`: criteria labels for pregnancy, country and validity, en, fr, pt.
- `apps/server/src/forms-routes.ts:108-114`: the band check follows call 3.

- [ ] **Step 1: Write the failing tests:** each new type round-trips from the bench answer to the Observation and to the warehouse row (call 6); three multicoded answers give three Observations and three rows (review focus 4); an old saved answer reads as before; the bench shows required and the limits; `criteriaLabel` names pregnancy, country and validity; the forms route accepts a band picked outside its dates.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, plus the full forms, fhir, db, server and studio suites and their typecheck.
- [ ] **Step 5: Commit** `feat(results): yes/no, date and several-answer fields reach the warehouse`.

### Task 4: The Test sheet edits field settings and range fields (studio)

**Files:** `apps/studio/src/test-catalog/TestSheet.tsx`, a new `FieldSettingsSheet.tsx` beside it, `loinc-draft.ts` and `AddResultFieldSheet.tsx` (build params leaving the new optional keys out, so defaults apply), i18n en, fr, pt.

- Each ticked field's ⋯ menu holds Required (a checkbox item), Settings (opens FieldSettingsSheet, fields per type, label left), Move up and Move down. Plan A gave `param-menu-<code>` to the ranges sub-heading menu; name the field menu `field-menu-<code>` and leave `param-menu-<code>` where it is.
- The type Select offers the six types.
- Fields and ranges are drawn in `resultParams` order (call 8).
- Each band block gains Pregnancy (Select: any, pregnant, not pregnant), Country (picker from the country value set, with "none"), Valid from and Valid to (shadcn DatePicker), and Source and Scope (Select with "none"). Label left, input right; on a phone one per line, as the block does today.

- [ ] **Step 1: Write the failing tests:** each menu item; settings saved per type and dropped when the type changes; Move up and Move down reorder the saved `resultParams` and the drawn order; the band fields save and leave out unset ones; old tests render unchanged.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, plus the full studio suite and typecheck.
- [ ] **Step 5: Commit** `feat(test-catalog): field settings, order and range fields on the Test sheet`.

### Task 5: Additional codings

**Files:**
- `packages/bootstrap/src/test-catalog.ts`: `CatalogTest.codings`, `CatalogTestInput.codings`, `ValidTest`, `sameTest`, the `writeConceptOn` managed keys, `toTest`, the import merge, and `orderCodingsFor` per call 10.
- `test-catalog-import.ts`: a `codings` column holding JSON.
- `apps/server/src/test-catalog-routes.ts`: `testInput.codings`.
- `packages/cli/src/test-catalog.ts` and `program.ts`: `set --codings <file.json>`.
- Studio `TestSheet.tsx`: the Additional codings section where plan A left the comment. It lists the codings with a ⋯ per row (Edit, Remove); the section's ⋯ holds "Add coding".
- A new studio `AddCodingSheet.tsx`: a system Select over `listCodingSystems`, then `TermPicker` over that system, a purpose Select, and a note Textarea.
- i18n en, fr, pt.

Validation: system and code are required; the code must exist in that system (`termExists`); a system not loaded here is refused; the purpose is one of the four; no two codings share a system and code.

- [ ] **Step 1: Write the failing tests:** create, update and read codings; the refusals above; `sameTest` sees a codings change; CSV export then import reports no change (review focus 5); CLI `set --codings`; `testCatalog.get` answers codings; the ServiceRequest coding order (call 10) with `panel_code` unchanged; the studio section adds, edits and removes a coding.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, plus the full bootstrap, server, cli, forms and studio suites, typecheck and server lint.
- [ ] **Step 5: Commit** `feat(test-catalog): additional codings on a test`.

### Task 6: The lab plugin (plugin repo)

**Files (plugin worktree):**
- `src/results.rs`: `checked_values` for boolean, date and multicoded; enforce `min`, `max`, `decimals`, `minLength`, `maxLength` and `dateLimit` (call 5); `missing` skips optional params; `same_json` and `same_band` read absent and any as equal; `observation()` per type, multicoded one per answer with the answer code in the id (call 7); the reference range text names the new band fields.
- `src/sends.rs`: LOINC, Test code, codings, id (call 11).
- `ui/src/results/ResultEntrySheet.tsx`: entry per type, the required mark, the limits shown, refusal messages.
- `ui/src/results/ranges.ts`: the `sameBand` key list, and labels for pregnancy, country and validity, en, fr, pt.
- `ui/src/api.ts` types, and contract fixtures from CE's new answers.
- `docs/GUIDE*.md` en, fr, pt: the new types and checks, and that this plugin version is needed (call 12).

- [ ] **Step 1: Write the failing tests:** each type saves and sends; each limit refuses; an optional empty field does not block submit or authorise (review focus 3); an old saved band still passes authorise (review focus 1, 2); three multicoded answers give three ids (review focus 4); the send order of codings; UI labels.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, plus cargo test, clippy, the UI tests and typecheck, the plugin build and the manifest check.
- [ ] **Step 5: Commit** `feat: field settings, more result types and range fields`.

### Task 7: Docs, gate, live run

- [ ] **Step 1: Docs.** The Test catalog guide in-app and web, en, fr, pt (field settings, types, range fields, codings, the lab's country); the Settings guide for the country; the CLI page (`lab set --country`, the `params --set` fields, `set --codings`). Commit `docs: field settings, result types, range fields and codings`.
- [ ] **Step 2: Gate** (CE). Grep for `out of memory`, `VirtualAlloc`, `Test timed out` before reading a failure as a regression.
- [ ] **Step 3: Live run** on the throwaway install, with the plugin built from the plugin worktree and installed there. Set the lab's country. On a test, add a boolean, a date and a multicoded field, one of them optional; a numeric field with min, max and decimals; a band for another country and one out of date; a coding. Register an order in the plugin, enter results, see the limits refuse, the optional field pass empty and the bands labelled; authorise; see the Observations. Screenshots on the operator's Artifact page.

Order: 1, 2, 3, 4, 5, 6, 7. Task 3 needs Task 1. Task 6 needs the answer shapes of Tasks 1 and 5.
