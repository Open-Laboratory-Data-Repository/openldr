# Examples Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested `examples/` folder at the repo root, one subfolder per studio page that imports a file, linked from each how-to guide at the running version's tag.

**Architecture:** Hand-written example files (approach A). Two test files prove each file passes the check its import runs: studio tests the three files studio reshapes before the server sees them (dashboards, workflows, forms), bootstrap tests the other four and runs the workflow's payload through its own mapping. The docs renderers replace a `{{version}}` placeholder in link targets with the running version.

**Tech Stack:** TypeScript, vitest, zod, pnpm workspaces, react-markdown (studio `DocMarkdown`, web `DocsPage`).

**Spec:** `docs/superpowers/specs/2026-11-20-examples-folder-design.md` (approved 2026-11-22). Read it before starting.

## Global Constraints

- Branch `feat/examples-folder` from `main`. Merge to local `main` when done; push only when the operator asks.
- No real patient data and no country's own codes in any example (AGENTS.md section 8). Made-up values only: patient surname `Example`, identifiers starting `EXAMPLE-`, register `Example facility register` (the name the facilities guide already uses).
- Commit messages: no `Co-Authored-By` trailer of any kind (AGENTS.md section 9).
- Every README and doc line follows the `unslop` skill: no em dashes, short sentences, no coined names.
- Docs land in en, fr and pt in the same commit. Edit the `0.1.8` docs folders in place, as recent commits do.
- Link format, exact: `https://github.com/Open-Laboratory-Data-Repository/openldr/tree/v{{version}}/examples/<folder>`.
- The example workflow: `"enabled": false`, no webhook secret, `formIds: []`, `targetId: "lab-result"`, webhook path not `ingest`.
- Gate before merge: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`.

## Review Focus

1. A secret committed in the example workflow or `send.sh` gives every importing lab an open endpoint. Task 3 asserts the webhook node has no secret and `send.sh` reads the secret only from `$OPENLDR_WEBHOOK_SECRET`.
2. An example that looks like real patient data. Task 2 asserts every patient identifier in `payload.json` starts `EXAMPLE-`.
3. A placeholder left in a rendered link shows `{{version}}` to the user. Task 4 tests both renderers replace it; Task 5 asserts every guide link to `examples/` uses the placeholder, never `main` or a fixed version.
4. A new example folder or file that no test reads. Task 2 asserts the set of subfolders is exactly the seven; each test asserts every non-README file in its folders is checked.
5. A folder with no README leaves the user guessing what to do. Both tests assert each of their folders has `README.md`.

---

### Task 1: Studio import reshaping as functions, form input schema shared

Studio's workflow and form imports reshape the file inline in components. Lift each into a pure function with no change in behavior, so Task 3 can test example files through the same code. Move the server's form input schema into `@openldr/forms/pure` so studio can reach it.

**Files:**
- Create: `apps/studio/src/workflows/workflow-import.ts`, test `apps/studio/src/workflows/workflow-import.test.ts`
- Create: `apps/studio/src/pages/form-import.ts`, test `apps/studio/src/pages/form-import.test.ts`
- Modify: `apps/studio/src/workflows/WorkflowList.tsx:29` (`isImportable`) and `:69-88` (`importJson`) to call the new function
- Modify: `apps/studio/src/pages/Forms.tsx:77` (`isImportableSchema`) and `:171-192` (`importJson`) to call the new function
- Create: `packages/forms/src/form-input.ts`; Modify: `packages/forms/src/pure.ts` (export it); Modify: `apps/server/src/forms-routes.ts:21-40` to import it instead of defining `formSchemaInput` and `formInput`
- Modify: `packages/workflows/package.json` exports, add `"./types": "./src/types.ts"`; Modify: `apps/studio/package.json` devDependencies, add `"@openldr/workflows": "workspace:*"`

**Interfaces:**
- Produces: `workflowCreateFromImport(raw: unknown, id: string): WorkflowCreateInput | null` where `WorkflowCreateInput = { id: string; name: string; description: string | null; definition: { nodes: unknown[]; edges: unknown[] }; enabled: boolean; createdBy: null }`. Returns null exactly when `isImportable` would refuse today.
- Produces: `formCreateFromImport(raw: unknown): FormCreateInput | null` returning `{ name, versionLabel, fhirResourceType, targetPages, schema }` exactly as `Forms.tsx:180-186` builds it today, or null when `isImportableSchema` would refuse.
- Produces: `FormCreateInputSchema` (the current `formInput` zod object, same fields) from `@openldr/forms/pure`.
- Produces: `WorkflowSchema` importable from `@openldr/workflows/types`.

- [ ] **Step 1: Write the failing tests**

`workflow-import.test.ts`: `returns null for a file with no definition`; `keeps enabled false when the file says false`; `defaults enabled to true when the file omits it` (matches `WorkflowList.tsx:81` today); `uses the given id and createdBy null`.
`form-import.test.ts`: `returns null for a file with no name`; `wraps the file as schema and defaults targetPages to ['forms']`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/studio && npx vitest run src/workflows/workflow-import.test.ts src/pages/form-import.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both functions, switch the two components to them, move the form schema, add the export and devDependency, run `pnpm install`**

- [ ] **Step 4: Run the new tests, the components' existing tests, and the server forms route tests**

Run: `cd apps/studio && npx vitest run src/workflows src/pages/Forms` then `cd apps/server && npx vitest run src/forms-routes.test.ts`
Expected: PASS, with no existing test changed.

- [ ] **Step 5: Commit**

`refactor(studio): workflow and form import reshaping as tested functions; form input schema in @openldr/forms`

---

### Task 2: Examples checked in bootstrap (queries, facilities, terminology, test catalog, workflow payload)

**Files:**
- Create: `examples/README.md` (what the folder is, one line per subfolder)
- Create: `examples/queries/queries.json` and `README.md`
- Create: `examples/facilities/facilities.csv` (`national_code,name`, at least 3 rows, codes `EXAMPLE-FAC-01`...) and `README.md`
- Create: `examples/terminology/value-set.json` (FHIR ValueSet), `examples/terminology/terms.csv` (`code,display`) and `README.md`
- Create: `examples/test-catalog/test-catalog.csv` and `README.md`
- Create: `examples/workflows/ingest-lab-rows.workflow.json` and `examples/workflows/payload.json` (Task 3 adds the studio check, `send.sh` and the README)
- Modify: `packages/bootstrap/src/custom-query-transfer.ts:63` export `parseFile` as `parseCustomQueryFile`
- Test: `packages/bootstrap/src/examples.test.ts`

**Interfaces:**
- Consumes: `parseFacilityCsv(csv, { nationalSystem })` and `parseTerminologyTerms(text, systemUrl, systemCode)` (`@openldr/terminology`), `fhirValueSetToInput(resource)` (`@openldr/db`), `readCatalogImportFile(bytes, 'csv')` (`test-catalog.ts:192`), `checkColumnMap(map, headers)` and `readCatalogRows(table, map)` (`test-catalog-import.ts:79,96`), `createMapToFhirService` and `createMapToFhirApi` (pattern at `map-to-fhir-api.test.ts:129`, `packs: async () => []`).
- Produces: `parseCustomQueryFile(file: unknown)`, same behavior as today's private `parseFile`.

- [ ] **Step 1: Write the failing test `examples.test.ts`**

Read files with `fs` from `new URL('../../../examples/', import.meta.url)`.
- `the examples folder has exactly the seven subfolders`: sorted dirs equal `['dashboards','facilities','forms','queries','terminology','test-catalog','workflows']`.
- `each folder this test owns has a README`: queries, facilities, terminology, test-catalog.
- `every file in queries, facilities, terminology and test-catalog is checked`: each non-README file name is in this test's checked list.
- `queries.json parses as a custom query file`: `parseCustomQueryFile` does not throw, at least one query.
- `facilities.csv imports with no problems`: `nationalSystem: 'urn:example:facility-register'`; `unknownColumns`, `duplicateColumns`, `columnMapErrors`, `quarantined`, `invalid` all empty; `records.length >= 3`.
- `terms.csv parses into concepts`: `parseTerminologyTerms(text, 'urn:example:cs', 'EXAMPLE')` returns at least 3 records.
- `value-set.json is a FHIR ValueSet the importer reads`: `fhirValueSetToInput` does not throw, `url` set.
- `test-catalog.csv maps with the suggested columns`: `checkColumnMap(file.suggested, file.headers)` is null; `readCatalogRows` returns one row per data row.
- `payload.json maps through the example workflow's own mapping, nothing held`: take the `map-to-fhir` node's config from the workflow file; run `createMapToFhirApi(...).test({ config, items })` with the payload rows; every result mapped, none held.
- `payload.json uses only made-up patients`: every patient identifier value starts `EXAMPLE-`.

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/bootstrap && npx vitest run src/examples.test.ts`
Expected: FAIL, folder and files missing.

- [ ] **Step 3: Export `parseCustomQueryFile`, write the example files and READMEs**

The workflow: same steps as the shipped Ingest (`packages/workflows/src/sample-workflow.ts:80-150`): webhook, Map to FHIR (`sourcePath: 'body'`, `targetId: 'lab-result'`, `formIds: []`, one saved mapping for the payload's columns), Persist store, Log persisted, Log held. Webhook path `examples/lab-rows`, no secret, `"enabled": false`. To get a correct saved mapping, build it in a dev studio with the mapping sheet on the payload, export the workflow, then remove the secret and set `enabled` false. Each README says what each file shows, the page and menu item that imports it, the CLI command where one exists, and what the user sees after. The facilities README names the `Example facility register`; the terminology README starts with "create or pick a code system".

- [ ] **Step 4: Run it to see it pass**

Run: `cd packages/bootstrap && npx vitest run src/examples.test.ts src/custom-query-transfer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(examples): queries, facilities, terminology, test catalog and the workflow payload, each checked by the import's own code`

---

### Task 3: Examples checked in studio (dashboards, workflows, forms)

**Files:**
- Create: `examples/dashboards/lab-overview.dashboard.json` (from `packages/dashboards/src/samples/openldr-general.json`), `examples/dashboards/one-widget.dashboard.json`, `README.md`
- Create: `examples/workflows/send.sh` (curl POST of `payload.json` to `$OPENLDR_URL/api/workflows/hooks/examples/lab-rows` with header `X-Webhook-Token: $OPENLDR_WEBHOOK_SECRET`), `examples/workflows/README.md`
- Create: `examples/forms/lab-order.form.json`, `README.md`
- Test: `apps/studio/src/examples.test.ts` (first line `// @vitest-environment node`)

**Interfaces:**
- Consumes: `importDashboard(raw, [])` (`apps/studio/src/dashboard/io.ts:59`), `DashboardSchema` (`@openldr/dashboards`), and from Task 1 `workflowCreateFromImport`, `WorkflowSchema` (`@openldr/workflows/types`), `formCreateFromImport`, `FormCreateInputSchema`.

- [ ] **Step 1: Write the failing test `examples.test.ts`**

- `each folder this test owns has a README`: dashboards, workflows, forms.
- `every file in dashboards, workflows and forms is checked`: `payload.json` counts as checked by bootstrap; list it.
- `each dashboard passes DashboardSchema after studio's import`.
- `the workflow passes WorkflowSchema after studio's import, switched off, with no secret`: `enabled` false; webhook node config has no `secret`, or an empty one; path is not `ingest`; map-to-fhir node `formIds` equals `[]` and `targetId` equals `'lab-result'`.
- `send.sh takes the secret from the environment only`: contains `$OPENLDR_WEBHOOK_SECRET`; no other `X-Webhook-Token` value.
- `the form passes the server's form input schema after studio's import`.

- [ ] **Step 2: Run it to see it fail**

Run: `cd apps/studio && npx vitest run src/examples.test.ts`
Expected: FAIL, files missing.

- [ ] **Step 3: Write the files and READMEs, `chmod +x send.sh`**

- [ ] **Step 4: Run it to see it pass**

Run: `cd apps/studio && npx vitest run src/examples.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(examples): dashboards, a switched-off workflow with send.sh, and a form, each checked by studio's own import`

---

### Task 4: `{{version}}` in docs links

**Files:**
- Create: `apps/studio/src/docs/version-link.ts`, test `version-link.test.ts`
- Modify: `apps/studio/src/docs/DocMarkdown.tsx:114` (external link branch)
- Create: `apps/web/src/docs/version-link.ts` (same function; web cannot import studio); Modify: `apps/web/src/docs/DocsPage.tsx:211` (`a` renderer); test in `apps/web/src/docs/DocsPage.test.tsx`

**Interfaces:**
- Produces: `withDocsVersion(href: string, version: string): string`, replacing every `{{version}}` with `version`.

- [ ] **Step 1: Failing tests**: `replaces the placeholder with the version`; `leaves a link with no placeholder unchanged`; in `DocsPage.test.tsx`, `renders an examples link with the site's version`.
- [ ] **Step 2: Run, expect FAIL**: `cd apps/studio && npx vitest run src/docs/version-link.test.ts`; `cd apps/web && npx vitest run src/docs/DocsPage.test.tsx`
- [ ] **Step 3: Implement. Studio passes `DOCS_VERSION` (`apps/studio/src/docs/version.ts:7`); web passes its `APP_VERSION` (`apps/web/src/docs/content.ts:42`, export it).**
- [ ] **Step 4: Run both, expect PASS**
- [ ] **Step 5: Commit** `feat(docs): a {{version}} placeholder in links, filled with the running version`

---

### Task 5: Guide lines in en, fr and pt

**Files:** in `apps/studio/src/docs/0.1.8/{en,fr,pt}/`: `dashboard.md` (after line 519), `workflows.md` (after line 369), `forms.md`, `query.md` (in "Review and import a query file", line 301), `facilities.md` (after line 233), `terminology.md` (after line 270), `test-catalog.md` (after line 177). In `apps/web/src/docs/0.1.8/{en,fr,pt}/load-data.md`, where it describes importing (line 127). Line numbers are for `en`; find the same place in fr and pt. Test: extend `apps/studio/src/docs/validation.test.ts`.

`forms.md` has no import step today. Add a short task "Import a form from a file": open the page dots menu, select **Import**, choose the `.form.json` file, then the examples line. Follow `apps/studio/src/docs/HOW-TO-TEMPLATE.md`.

The line, in English: `Examples you can import are in [examples/<folder>](https://github.com/Open-Laboratory-Data-Repository/openldr/tree/v{{version}}/examples/<folder>).` French and Portuguese say the same in plain words.

- [ ] **Step 1: Failing test** in `validation.test.ts`: `every link to the examples folder uses the version placeholder`: in every locale, each `github.com/.../examples/` link contains `/tree/v{{version}}/`, and each of the seven guides has one.
- [ ] **Step 2: Run, expect FAIL**: `cd apps/studio && npx vitest run src/docs`
- [ ] **Step 3: Add the lines and the forms task**
- [ ] **Step 4: Run studio and web docs tests, expect PASS**: `cd apps/studio && npx vitest run src/docs`; `cd apps/web && npx vitest run src/docs`
- [ ] **Step 5: Commit** `docs: each import guide links to its examples, in en, fr and pt`

---

### Task 6: Check by hand on a running install, gate, merge

The tests prove each file passes its import's checks. They do not prove the studio screens accept it, or that the dashboard returns rows (spec, "The test").

- [ ] **Step 1:** On the dev studio (`preview_start`), import each example through its page. Note which pass. Screenshot the dashboard and the workflow run.
- [ ] **Step 2:** For the workflow: set a secret, turn it on, run `send.sh` with `OPENLDR_URL` and `OPENLDR_WEBHOOK_SECRET`. Expected: HTTP 200, a Completed run, and the `Example` patient under Patients.
- [ ] **Step 3:** Check one guide at 375 px wide: the examples link wraps, no sideways scroll.
- [ ] **Step 4:** Full gate (Global Constraints). Both exit 0.
- [ ] **Step 5:** Say that the dev stack runs from main, merge `feat/examples-folder` into local `main`, then `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json` if it changed.
- [ ] **Step 6:** Report what the hand check could not prove: the version links resolve only once a release containing `examples/` is tagged.
