# Map to FHIR workflow node: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workflow node that turns FHIR, a known form's answers, or unknown rows into FHIR
records, with a sheet where a person maps unknown data on a real sample and tests it.

**Architecture:** A pure mapping core in `packages/forms/src/map/`, a service in
`@openldr/bootstrap` that the engine node, the Test route and the CLI all call, and a Sheet in
studio. The runner learns to carry items per output port.

**Tech stack:** TypeScript, zod, vitest, Fastify, React with the studio's shadcn components.

**Spec:** `docs/superpowers/specs/2026-11-17-workflow-map-node-design.md`

## Global constraints

- No sample value is ever written to a workflow definition, an audit row, a log line or a file.
  Config holds field names, types, rules and typed translations only.
- No clinical code or value set in source. Codes come from the terminology service, a starter
  pack, or what the person typed.
- A suggestion is never applied without the person accepting it.
- Every output record set passes CE's clinical rules at the configured level, or the item goes to `held`.
- Studio rules of AGENTS.md section 5: Sheet not dialog, actions in a dots menu, label left and
  input right, `StripedEmpty` and `LoadingState`, shadcn only, `h-dvh`.
- Every new string in en, fr and pt.
- Branch `map-node` in a worktree. `OPENLDR_SKIP_ENV_FILE=true`, port 3991, databases
  `sa_scratch_map_*` for anything started. Never port 3000.
- No `Co-Authored-By` or "Generated with" lines. No merge or push without the operator's yes.
- Node id `map-to-fhir`. Output ports `out` and `held`. Service name `mapToFhir`.

## Review focus

1. An item with a field the mapping never saw (same keys plus one). Expected: a new shape, so
   `held` with "no mapping for this shape". Task 2.
2. A date that does not fit the row's format. Expected: that item to `held` naming the field, the
   other items mapped. Task 2.
3. Two results in one row for one repeating target field. Expected: two Observations, both
   linked to the one order. Task 2.
4. An existing workflow with If, Switch or Filter after the runner change. Expected: same
   routing as before. Task 1.
5. A sample value in the saved node config after mapping and saving. Expected: none. Task 6.

---

### Task 1: The runner carries items per output port

**Files:** `packages/workflows/src/engine/execution-context.ts`, `run-workflow.ts`, their tests.

**Interfaces:**
- Produces: `ctx.portItems: Record<string, Record<string, WorkflowItem[]>>`. A handler sets
  `ctx.portItems[node.id] = { out: [...], held: [...] }` and returns the `out` items.

- [ ] **Step 1:** Failing test: a node that sets `portItems` with `out` 2 items and `held` 1
  item; an edge with `sourceHandle: 'held'` feeds its target 1 item, `out` feeds 2.
- [ ] **Step 2:** Failing test: a port with an empty list skips its edge, as a pruned branch does.
- [ ] **Step 3:** In the runner, when `ctx.portItems[node.id]` exists, the input of each
  outgoing edge's target is that port's items, and an edge whose port is empty or missing is
  added to `skippedEdges`. `ctx.branches` behaviour is untouched.
- [ ] **Step 4:** Run the engine tests. Expected: new tests pass, every existing If, Switch,
  Filter and loop test passes unchanged.
- [ ] **Step 5:** Commit `feat(workflows): a node can send different items down each output port`.

### Task 2: The mapping core

**Files:** create `packages/forms/src/map/{shape,rules,target,apply,classify,suggest,index}.ts`
with a test file each. Export from `packages/forms/src/index.ts`.

**Interfaces (produced):**
- `shapeOf(json: Record<string, unknown>): { hash: string; fields: { name: string; type: 'string' | 'number' | 'boolean' | 'list' | 'object' | 'null' }[] }`
- `type MapRule = { kind: 'date'; format: string } | { kind: 'values'; map: Record<string, string> } | { kind: 'codeList'; conceptMapUrl: string } | { kind: 'split'; by: string; take: 'first' | 'last' | number } | { kind: 'trim' } | { kind: 'number'; decimal: ',' | '.' }`
- `type FieldMapping = { targetPath: string; from: { field: string } | { fields: string[] } | { fixed: string }; rule?: MapRule }`
- `type SavedMapping = { shapeHash: string; fieldNames: string[]; targetId: string; rows: FieldMapping[] }`
- `type MapTarget = { id: string; name: string; records: { type: string; packId: string }[]; fields: { path: string; label: string; required: boolean; repeats: boolean; valueSet: string | null }[] }`
- `buildTarget(id, name, packs: { pack: StarterPack; entries: StarterPackEntry[] }[]): MapTarget`
- `applyMapping(mapping: SavedMapping, target: MapTarget, json, deps: { translateCode(conceptMapUrl, value): Promise<Coding | null>; newId(): string }): Promise<{ ok: true; resources: FhirResource[] } | { ok: false; reason: string; field?: string }>`
- `classify(json, forms: { id: string; fieldIds: string[]; requiredIds: string[] }[], mappings: SavedMapping[]): { kind: 'fhir' } | { kind: 'form'; formId: string } | { kind: 'mapped'; mapping: SavedMapping } | { kind: 'unknown'; shape }`
- `suggest(target: MapTarget, fieldNames: string[], synonyms: Record<string, string[]>): { targetPath: string; field: string; score: number }[]`

- [ ] **Step 1:** `shape.test.ts`: same keys in another order give the same hash; one more key
  gives another; a changed value gives the same; no value appears in the output.
- [ ] **Step 2:** `rules.test.ts`, one case per rule kind, with made-up values: `03/11/26` with
  `dd/MM/yy` gives `2026-11-03`; `M` through `{ M: 'male' }` gives `male`; an unmapped value
  fails naming the value's field, not the value; `12,5` with decimal `,` gives 12.5; `BANDA Mary`
  split by space take last gives `Mary`; a date that does not parse fails.
- [ ] **Step 3:** `apply.test.ts`: a Lab result target and one row give 1 Patient, 1 Specimen,
  1 ServiceRequest, 1 Observation; the Observation's `subject`, `specimen` and `basedOn` point at
  the three; a `{ fields: [a, b] }` source on a repeating field gives 2 Observations with the
  same `basedOn`; a missing required field returns `ok: false` with that field; values are
  written with `setPath`.
- [ ] **Step 4:** `classify.test.ts`: a resource, a bundle and a list of resources are `fhir`;
  keys all in one form and covering its required ids are `form`; a stray key is not; a saved
  shape is `mapped`; anything else is `unknown`.
- [ ] **Step 5:** `suggest.test.ts`: `pat_no` and `patient_id` rank for the patient identifier
  path through the synonym list; an unrelated name gives no suggestion; scores sort descending.
- [ ] **Step 6:** Implement the six files to pass. `suggest` reuses the similarity function of
  `packages/bootstrap/src/facility-mapping-suggest.ts`, moved to `@openldr/core` if it must be shared.
- [ ] **Step 7:** Commit `feat(forms): a mapping core that turns a row into linked FHIR records`.

### Task 3: Starter packs for Specimen and Observation, and the Lab result target

**Files:** `packages/forms/src/samples/starter-packs.ts`, `packages/forms/src/map/targets.ts`, tests.

- [ ] **Step 1:** Add `pack-specimen` and `pack-observation` in the shape of `pack-patient`. Every
  entry's `fhirPath` must exist in the path table; a test asserts it with `lookupFhirPath`.
- [ ] **Step 2:** `labResultTarget(packs)`: records Patient, Specimen, ServiceRequest,
  Observation; Observation fields repeat. Test: every required entry of the four packs is a
  required target field.
- [ ] **Step 3:** A synonym list as content, `packages/forms/src/map/synonyms.{en,fr,pt}.json`,
  keyed by target path. Test: every key is a path of the Lab result target.
- [ ] **Step 4:** Commit `feat(forms): Specimen and Observation starter packs and the Lab result target`.

### Task 4: The service, the node and its registration

**Files:** create `packages/bootstrap/src/map-to-fhir-service.ts` and test; modify
`packages/workflows/src/engine/services.ts`, `node-handlers/index.ts`, create
`node-handlers/map-to-fhir.ts`; `packages/workflows/src/host-nodes.ts`; `packages/bootstrap/src/index.ts`.

**Interfaces:**
- `services.mapToFhir(input: { items: WorkflowItem[]; config: { targetId: string; formIds: string[]; mappings: SavedMapping[] } }): Promise<{ out: WorkflowItem[]; held: WorkflowItem[]; meta: { fhir: number; form: number; mapped: number; held: number } }>`
- A held item is `{ json: { item: <original json>, reason: string, shape?: { hash, fields } } }`.

- [ ] **Step 1:** Service test with fakes: one FHIR item, one form item, one mapped item and one
  unknown give `out` from the first three and one `held`; a mapped item whose records fail the
  clinical rules goes to `held` with the rule's message.
- [ ] **Step 2:** Implement: `classify`, then unwrap, `validateForm`, or `applyMapping` followed
  by the same rule check `persistResources` uses, run without storing.
- [ ] **Step 3:** Handler: calls the service, sets `ctx.portItems[node.id] = { out, held }`,
  records `meta`, returns `out`. Handler test with a fake service.
- [ ] **Step 4:** Register in `handlers`, in `HOST_NODES` with ports `out` and `held`, and inject
  `workflowServices.mapToFhir` beside `validateForm`.
- [ ] **Step 5:** Commit `feat(workflows): the Map to FHIR node`.

### Task 5: Routes

**Files:** `apps/server/src/workflows-routes.ts` and its test.

- [ ] **Step 1:** `GET /api/workflows/map/targets` (VIEW): the targets with their fields.
- [ ] **Step 2:** `POST /api/workflows/map/suggest` (EDIT): `{ targetId, fieldNames, locale }`
  gives suggestions.
- [ ] **Step 3:** `POST /api/workflows/map/test` (EDIT): `{ config, items }` gives, per item,
  `{ ok, resourceTypes, resources }` or `{ ok: false, reason, field }`. It stores nothing and
  writes no audit row holding an item. Limit: 20 items.
- [ ] **Step 4:** Route tests pin all three wire shapes and the 20-item limit. Each handler
  returns or awaits `reply.send`, per the server lint rule.
- [ ] **Step 5:** Commit `feat(server): routes for map targets, suggestions and a mapping test`.

### Task 6: The sheet in studio

**Files:** create `apps/studio/src/workflows/components/node-forms/map-to-fhir-form.tsx`,
`apps/studio/src/workflows/components/map/MapToFhirSheet.tsx`, `map/useSamples.ts`, tests;
modify `node-forms/index.tsx`, `workflows/constants.ts`, `api.ts`, `i18n/{en,fr,pt}.ts`.
Copy the Sheet pattern from `forms-builder/FieldEditorSheet.tsx`.

- [ ] **Step 1:** Sidebar entry "Map to FHIR" with two output handles, and the node form: target
  select, allowed forms, a count of saved mappings, and "Open mapping" in a dots menu.
- [ ] **Step 2:** `useSamples`: "Use last run" reads the upstream node's output from the editor
  store; "Listen" polls `GET /api/workflows/:id/runs` for runs started after the press and reads
  the upstream node's output. Samples live in component state only.
- [ ] **Step 3:** The sheet of design 5.3: one row per target field, source select, example,
  rule editor, "Add a FHIR path" using `fhirPathOptionsFor`, suggestions shown grey with Accept.
- [ ] **Step 4:** Test button calls the test route and shows per-sample results. Save writes
  `SavedMapping` into the node config by shape hash.
- [ ] **Step 5:** Tests: accepting a suggestion fills the row; an unaccepted one is not saved;
  after Save the node config, serialised, contains no sample value; with no sample the sheet
  shows `StripedEmpty`.
- [ ] **Step 6:** Browser check at 1280 and at 375x812 against a throwaway CE with made-up
  data. Screenshots to the operator.
- [ ] **Step 7:** Commit `feat(studio): map unknown data to FHIR on a live sample`.

### Task 7: CLI

**Files:** `packages/cli/src/workflow-map.ts`, `program.ts`, `command-meta.ts`, tests.

- [ ] **Step 1:** `openldr workflows map-test <workflowId> <nodeId> <file> [--json]`: reads a
  JSON array or CSV, runs the node's saved config through the same service, prints counts and
  reasons. It prints no item values unless `--json`.
- [ ] **Step 2:** Tests for a mapped file, an unknown shape, and a missing node.
- [ ] **Step 3:** Commit `feat(cli): workflows map-test`.

### Task 8: The default workflow and the docs

- [ ] **Step 1:** In `sample-workflow.ts` the Ingest workflow becomes webhook, Map to FHIR,
  Persist store, with `held` to a Log node. Update its tests. Existing saved workflows are not migrated.
- [ ] **Step 2:** In-app how-to by `apps/studio/src/docs/HOW-TO-TEMPLATE.md`, and a web docs
  page, each in en, fr and pt.
- [ ] **Step 3:** Commit `feat(workflows): the default Ingest workflow uses Map to FHIR, with docs`.

### Task 9: Proof and gate

- [ ] **Step 1:** Throwaway CE. Post made-up JSON with unknown keys to a webhook workflow, map
  it in the sheet, test, save, post again. Expected: the second post is stored with no person
  involved, and results link to their order.
- [ ] **Step 2:** `samples/lab-sample.csv` through Extract from file and the node. Expected:
  records stored, bad rows in `held` with reasons.
- [ ] **Step 3:** Full gate: `pnpm turbo run test --force --concurrency=2 --continue` and
  `pnpm turbo run typecheck --force --concurrency=2`, and the server lint.
- [ ] **Step 4:** Ask the operator about the merge. After it, `pnpm make:changelog` and commit.

## What this plan does not prove

- Suggestions on a real lab's file. Only made-up names are tried.
- A real phone. 375 wide is a resized browser.
- HL7 v2, which this node does not read.
