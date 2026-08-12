# Facilities Phase 1 — resolve picker hygiene + `facility_map` governance

Three audit findings, scoped by the operator from a verdict table on 2026-08-12. The other five
findings of sub-projects C and D were refuted, partly refuted, or deferred; they are **not** in scope.

Branch `slice/fac-resolve-governance`, off `main` at `223d6b9e`. Slice branch → `--no-ff` merge to
local `main`.

## What is being fixed, and what is NOT

- **P1-14** — `TermPicker` drops the status filter whenever more than one status is selected, so a
  facility search asking for `ACTIVE` + `DRAFT` sends none and can return retired/ghost terms. Its
  search also has no loading or error state and no generation guard, so a slow response can overwrite
  a newer one.
- **P1-10 (real half only)** — the facility form is chosen implicitly (`summaries[0]`), and the schema
  load has no cancel guard, so a quickly closed or switched dialog can receive stale schema/answers.
  ⛔ **The audit's other half is REFUTED and must not be "fixed":** it claims a failed load is
  presented as "no form published". It is not — `FacilityDialog.tsx`'s `.catch()` sets `error` and
  never `noForm`, and `noForm` starts `false`. Do not restructure that path.
- **P1-17** — `facility_map` is registered in no data-exposure policy. It carries curated facility
  names, codes and administrative areas and is a report join, but it is absent from `GOVERNED`
  (`apps/server/src/dashboards-routes.ts`) and from `HARDCODED_DENY_UNION` / `PII_COLUMNS`
  (`packages/dashboards/src/models/registry.ts`).

Out of scope, decided: P1-11 (partly a convention conflict — the ⋯ menu the audit calls "hidden" is
the pattern AGENTS §5 mandates), P1-12 (a redesign, sized separately), P1-13 and P1-16 (largely
refuted), P1-15 (a terminology-layer defect, wider than facilities).

## Global constraints

- ⛔ **NEVER `git add -A`.** The working directory is shared with concurrent sessions. Stage named paths.
- ⛔ **NEVER add a `Co-Authored-By` trailer.**
- ⛔ **NEVER revert a mutation with `git checkout -- <file>`.** In-place reverse edits only.
- ⛔ **TDD:** write the failing test, RUN it, paste the failure, then implement.
- ⛔ **Mutation-prove every behavioural claim,** printing the compared value at the mutated line.
- ⛔ **Every comment must be true of the code it describes.**
- ⛔ **Every action control lives in a `⋯` `DropdownMenu`.** Inputs are exempt and keep label-left /
  input-right `grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`.
- ⛔ **New i18n keys go in `en.ts`, `fr.ts` AND `pt.ts` in the same commit** — `parity.test.ts` enforces it.
- **`vitest` does not typecheck.** Run `npx tsc --noEmit` in every package touched.
- **pg-mem is not Postgres:** no correlated subqueries, no rollback on a thrown error, stable scan
  order, `now()` collides ~50% of consecutive calls.
- **No migration.** All three findings are behaviour or configuration.
- Gate: `pnpm turbo run typecheck test --force --continue`. ⛔ Never pipe turbo through `tail`.

---

## Task 1: `TermPicker` sends the status filter it was given

**Files:** `apps/studio/src/terminology/TermPicker.tsx`, `apps/studio/src/terminology/TermPicker.test.tsx`

Today: `status: statuses && statuses.length === 1 ? statuses[0] : undefined`. Two statuses ⇒ no filter.

- [ ] **Step 1** — failing test: with `statuses={['ACTIVE','DRAFT']}`, the request carries both, and a
      retired term is not offered. Check what `searchTerms` / the terms route actually accepts for
      multiple statuses **before** choosing the wire shape — if it takes only one, widening the API is
      part of this task and the route test is what pins the new shape.
- [ ] **Step 2** — add distinct loading, error-with-retry, no-results and minimum-query states.
- [ ] **Step 3** — generation-guard the debounced search so a stale response cannot overwrite a newer
      one. ⚠ A debounce narrows the race; only a monotonic counter closes it. This exact defect has
      already been shipped once on the Facilities page.
- [ ] **Step 4** — mutation-prove the status pass-through and the generation guard.
- [ ] **Step 5** — commit.

⚠ `TermPicker` is shared. Check its other call sites before changing its props, and say what you found.

---

## Task 2: the facility form is chosen explicitly, and its load is cancellable

**Files:** `apps/studio/src/facilities/FacilityDialog.tsx`, `apps/studio/src/facilities/FacilityDialog.test.tsx`

- [ ] **Step 1** — failing test: two published facility-targeted forms ⇒ the dialog does not silently
      take `summaries[0]`. Decide the rule and state it in the test's name: either refuse with a
      named configuration error, or select by a documented deterministic key. **Do not invent a new
      settings surface** — that is P1-10's deferred half.
- [ ] **Step 2** — failing test: the dialog is closed (or `facility` switches) mid-load; the late
      response must not set schema or answers.
- [ ] **Step 3** — implement. ⛔ The cancel guard already exists **25 lines above** in the same file,
      on the `lastImportAt` effect (`let cancelled = false`). Copy that shape rather than inventing a
      second one — this repo has shipped an asymmetric pair written as a symmetric one three times.
- [ ] **Step 4** — mutation-prove both.
- [ ] **Step 5** — commit.

---

## Task 3: `facility_map` is governed, not accidentally available

**Files:** `apps/server/src/dashboards-routes.ts`, `packages/dashboards/src/models/registry.ts`,
their tests, and the studio Data Exposure page if the new table needs a label there.

`facility_map`'s columns (`EXTERNAL_TABLE_COLUMNS`, `packages/db/src/schema/external.ts:198`):
`id, source_system, performer_system, source_code, registry_id, local_code, name, level, status,
region, district, council, national_system, national_code, resolved_via, updated_at`.

- [ ] **Step 1** — establish the blast radius FIRST and paste it: does `HARDCODED_DENY_UNION` /
      the column policy constrain **raw-SQL seeded reports**, or only the builder/dashboard model
      layer? The answer decides whether hiding a column can break a shipped report.
      ⛔ The seeded reports join `facility_map` on `source_system`, `performer_system` and
      `source_code` (`packages/reporting/src/seed/report-seeds.ts:228,235,242,821,848,875`). **Those
      three columns must stay exposed** whatever else is decided.
- [ ] **Step 2** — add `facility_map` to `GOVERNED` with a label, and give it `HARDCODED_DENY_UNION`
      and `PII_COLUMNS` entries. **Default decision, to implement unless Step 1 refutes it:** hide the
      internal surrogate ids `id` and `registry_id` — mirroring how `facilities` hides
      `plugin_id`/`plugin_version`/`batch_id` — and record `PII_COLUMNS.facility_map = []`, because
      facility name, code and administrative area are not patient data. State the decision in a
      comment with its reason.
- [ ] **Step 3** — a route test pinning the wire shape. ⛔ AGENTS §7: `typecheck` green does not pin a
      route's contract; a route test is the only thing that does.
- [ ] **Step 4** — mutation-prove that a denied column is actually withheld.
- [ ] **Step 5** — commit.

---

## Task 4: gate, review, merge

- [ ] Full gate, read the log, re-run any failing package alone before blaming a change.
      ⚠ Known flaky under parallel turbo, all measured this week and all passing alone:
      `@openldr/forms` `store.test.ts`, `@openldr/studio` `DashboardPage.test.tsx`,
      `@openldr/bootstrap` `terminology-dist-extract.test.ts`.
- [ ] Whole-branch review. Ask explicitly: **which guard introduced early did a later commit make
      vacuous?** and **which new assertion cannot fail?**
- [ ] ⚠ **Re-read `main` immediately before moving it** — it moved twice during the previous slice.
      Then `--no-ff` merge, confirm `git diff <verified tip> HEAD` is empty, delete the branch.
