# Unified Ingest Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two seeded ingest workflows (Ingest-form + Ingest-raw) with a single `wf-ingest` that inspects the posted payload and routes it to either the FHIR-unwrap or form-validate path, both re-converging on one Persist → Log.

**Architecture:** A `Switch` (`type: condition`, `templateId: switch`) node evaluates a JS condition against the webhook envelope's `body`; the runner prunes the non-chosen `sourceHandle` edge, so exactly one branch runs and a single downstream `Persist` node receives only the active branch's items. Pure builder change in `@openldr/workflows` plus a one-line seed wiring change.

**Tech Stack:** TypeScript, Vitest, Zod (workflow schemas), the in-repo workflow engine (`packages/workflows/src/engine`).

## Global Constraints

- No new node types — reuse `webhook`, `condition`/`switch`, `unwrap-bundle`, `form-validate`, `persist-store`, `log`, `event-trigger`.
- Single webhook path `ingest`, single secret, single Persist `source` `webhook-ingest`.
- FHIR detection rule (verbatim, a bare JS expression evaluated in the QuickJS isolate):
  `Array.isArray($json.body) || (!!$json.body && $json.body.resourceType === 'Bundle')`
- Branch edges MUST carry `sourceHandle` (`'fhir'` / `'form'`) or pruning won't fire.
- Seed stays create-if-absent by stable id — no deletion of existing `wf-ingest-form` / `wf-ingest-raw`.
- `buildDefaultWorkflows` returns exactly 2 workflows: the ingest one and the reactive companion.
- Node `data` is an open `z.record(z.unknown())`; edges support `sourceHandle` (`z.string().nullable().optional()`) — both verified in `types.ts`.

---

### Task 1: Rewrite the unified ingest builder + its unit tests

**Files:**
- Modify (full rewrite): `packages/workflows/src/sample-workflow.ts`
- Modify (full rewrite): `packages/workflows/src/sample-workflow.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `buildDefaultWorkflows({ orderFormId: string, webhookSecret: string }): Workflow[]` returning `[ingest, reactive]`. The ingest workflow has id `wf-ingest`, a webhook node (`path: 'ingest'`), a `route-1` switch node, `unwrap-1` / `form-validate-1` branch nodes, a shared `persist-1` (`source: 'webhook-ingest'`), and `log-1`. The reactive workflow keeps id `wf-sample-reactive` and its event trigger `source` is `webhook-ingest`. Task 3 (seed) consumes the new `DefaultWorkflowInput` shape (`webhookSecret` replaces `formWebhookSecret` + `rawWebhookSecret`).

- [ ] **Step 1: Replace the unit test file** with the new expectations.

Replace the entire contents of `packages/workflows/src/sample-workflow.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { buildDefaultWorkflows } from './sample-workflow';

describe('buildDefaultWorkflows', () => {
  const [ingest, reactive] = buildDefaultWorkflows({
    orderFormId: 'form-xyz',
    webhookSecret: 'ingest-secret',
  });

  it('returns exactly the Ingest + reactive workflows with stable ids', () => {
    expect(buildDefaultWorkflows({ orderFormId: 'form-xyz', webhookSecret: 's' })).toHaveLength(2);
    expect(ingest.id).toBe('wf-ingest');
    expect(ingest.name).toBe('Ingest');
    expect(reactive.id).toBe('wf-sample-reactive');
  });

  it('ships the ingest webhook disabled and the reactive enabled', () => {
    expect(ingest.enabled).toBe(false);
    expect(reactive.enabled).toBe(true);
  });

  it('injects the secret + path onto the single webhook node', () => {
    const hook = ingest.definition.nodes.find((n) => n.type === 'webhook');
    expect(hook?.data).toMatchObject({ secret: 'ingest-secret', path: 'ingest', method: 'POST' });
  });

  it('routes with a Switch: fhir rule + form fallback', () => {
    const route = ingest.definition.nodes.find((n) => n.type === 'condition');
    expect(route?.id).toBe('route-1');
    expect(route?.data.templateId).toBe('switch');
    expect(route?.data.fallbackOutput).toBe('form');
    const rules = route?.data.rules as Array<{ name: string; condition: string }>;
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('fhir');
    expect(rules[0].condition).toBe(
      "Array.isArray($json.body) || (!!$json.body && $json.body.resourceType === 'Bundle')",
    );
  });

  it('has both branch nodes reading body, bound to the form id', () => {
    const unwrap = ingest.definition.nodes.find((n) => n.data.action === 'unwrap-bundle');
    expect(unwrap?.data.config).toMatchObject({ sourcePath: 'body' });
    const fv = ingest.definition.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config).toMatchObject({ formId: 'form-xyz', sourcePath: 'body' });
  });

  it('wires one persist source; the reactive listens to it', () => {
    const persist = ingest.definition.nodes.find((n) => n.data.action === 'persist-store');
    expect(persist?.data.config).toMatchObject({ source: 'webhook-ingest' });
    const evt = reactive.definition.nodes.find((n) => n.data.triggerType === 'event');
    expect(evt?.data.config).toMatchObject({ source: 'webhook-ingest' });
  });

  it('branch edges carry sourceHandle and both converge on persist', () => {
    const edges = ingest.definition.edges;
    const toUnwrap = edges.find((e) => e.target === 'unwrap-1');
    const toForm = edges.find((e) => e.target === 'form-validate-1');
    expect(toUnwrap).toMatchObject({ source: 'route-1', sourceHandle: 'fhir' });
    expect(toForm).toMatchObject({ source: 'route-1', sourceHandle: 'form' });
    const intoPersist = edges.filter((e) => e.target === 'persist-1').map((e) => e.source).sort();
    expect(intoPersist).toEqual(['form-validate-1', 'unwrap-1']);
    expect(edges.some((e) => e.source === 'persist-1' && e.target === 'log-1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/workflows test -- --run sample-workflow`
Expected: FAIL — the current builder still takes `formWebhookSecret`/`rawWebhookSecret` and returns 3 workflows, so the destructure and `toHaveLength(2)`/`wf-ingest` assertions fail.

- [ ] **Step 3: Rewrite the builder** — replace the entire contents of `packages/workflows/src/sample-workflow.ts` with:

```ts
import type { Workflow } from './types';

// The seeded default workflows for a fresh install: ONE unified ingestion workflow that
// routes by the SHAPE of the posted payload, plus one reactive demo.
//
//   Ingest (wf-ingest, DISABLED):
//     Webhook (POST /api/workflows/hooks/ingest, X-Webhook-Token)
//       → Switch  rule "fhir": body is a FHIR transaction Bundle OR a bare resource array
//           ├─ handle "fhir" → Unwrap FHIR Bundle (sourcePath 'body'; entry[].resource →
//           │                   one item per FHIR resource, tolerates a bare array)
//           └─ fallback "form" → Form Validate ("Lab order" form; sourcePath 'body' →
//                                 answers → ServiceRequest/Observation)
//       → Persist Store (source: webhook-ingest → emits data.persisted)
//       → Log
//     ONE webhook handles BOTH form answers AND pre-built FHIR (e.g. the CDR toolchain); ONE
//     persist stores every resource and the projection routes each by resourceType
//     (Observation → lab_results, ServiceRequest → lab_requests,
//     QuestionnaireResponse → questionnaire_responses, …).
//
//   Reactive (wf-sample-reactive, ENABLED):
//     Event Trigger (data.persisted, source: webhook-ingest) → Log
//
// The ingest webhook ships DISABLED because it exposes a live HTTP endpoint — the operator
// opts in (enable + copy the per-install secret). The reactive one ships ENABLED (no external
// surface). Pure builder: the form id and the webhook secret are injected by the seed
// (packages/bootstrap/src/seed.ts) at seed time so no secret is committed.

/** Ingest webhook path. The CDR toolchain sets OPENLDR_CE_HOOK_PATH=ingest to target it. */
const INGEST_WEBHOOK_PATH = 'ingest';
/** Ingest Persist Store `source` — MUST match the reactive Event Trigger `source`. */
const INGEST_PERSIST_SOURCE = 'webhook-ingest';
/** Switch rule: route a FHIR transaction Bundle or a bare resource array to the "fhir" branch. */
const FHIR_ROUTE_CONDITION =
  "Array.isArray($json.body) || (!!$json.body && $json.body.resourceType === 'Bundle')";

export interface DefaultWorkflowInput {
  /** Id of the seeded "Lab order" form the ingest workflow's form branch validates against. */
  orderFormId: string;
  /** Per-install shared secret for the ingest webhook (sent as X-Webhook-Token). */
  webhookSecret: string;
}

export function buildDefaultWorkflows({ orderFormId, webhookSecret }: DefaultWorkflowInput): Workflow[] {
  const ingest: Workflow = {
    id: 'wf-ingest',
    name: 'Ingest',
    description:
      'Unified ingestion. POST to /api/workflows/hooks/ingest with header X-Webhook-Token → a ' +
      'Switch routes by payload shape: a FHIR transaction Bundle (or bare resource array) is ' +
      'unwrapped into one item per resource, while form ANSWERS are validated against the ' +
      '"Lab order" form → both persist to the FHIR store (the projection routes each resource ' +
      'by type) → emit data.persisted. Disabled by default: enable it and copy the webhook ' +
      'secret to accept requests.',
    enabled: false,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'webhook',
          position: { x: 60, y: 220 },
          data: {
            label: 'Ingest received',
            path: INGEST_WEBHOOK_PATH,
            method: 'POST',
            secret: webhookSecret,
            templateId: 'webhook-trigger',
            iconName: 'Webhook',
          },
        },
        {
          id: 'route-1',
          type: 'condition',
          position: { x: 360, y: 220 },
          data: {
            label: 'Route by payload shape',
            rules: [{ name: 'fhir', condition: FHIR_ROUTE_CONDITION }],
            fallbackOutput: 'form',
            templateId: 'switch',
            iconName: 'Split',
          },
        },
        {
          id: 'unwrap-1',
          type: 'action',
          position: { x: 660, y: 120 },
          data: {
            label: 'Unwrap FHIR Bundle',
            action: 'unwrap-bundle',
            config: { sourcePath: 'body' },
            templateId: 'unwrap-bundle',
            iconName: 'PackageOpen',
          },
        },
        {
          id: 'form-validate-1',
          type: 'action',
          position: { x: 660, y: 320 },
          data: {
            label: 'Validate form answers',
            action: 'form-validate',
            config: { formId: orderFormId, sourcePath: 'body' },
            templateId: 'form-validate',
            iconName: 'ClipboardCheck',
          },
        },
        {
          id: 'persist-1',
          type: 'action',
          position: { x: 960, y: 220 },
          data: {
            label: 'Persist store',
            action: 'persist-store',
            config: { source: INGEST_PERSIST_SOURCE },
            templateId: 'persist-store',
            iconName: 'Database',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 1260, y: 220 },
          data: {
            label: 'Log persisted',
            action: 'log',
            message: 'Persisted ingest: {{ $json }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'route-1' },
        { id: 'e2', source: 'route-1', target: 'unwrap-1', sourceHandle: 'fhir' },
        { id: 'e3', source: 'route-1', target: 'form-validate-1', sourceHandle: 'form' },
        { id: 'e4', source: 'unwrap-1', target: 'persist-1' },
        { id: 'e5', source: 'form-validate-1', target: 'persist-1' },
        { id: 'e6', source: 'persist-1', target: 'log-1' },
      ],
    },
  };

  const reactive: Workflow = {
    id: 'wf-sample-reactive',
    name: 'On Ingest Persisted → Log',
    description:
      'Reacts to the data.persisted event emitted when the Ingest workflow stores a record ' +
      '(source webhook-ingest) and logs a summary. Demonstrates the event-driven half of the ' +
      'ingestion loop — enable "Ingest" and POST to see it fire.',
    enabled: true,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'evt-1',
          type: 'trigger',
          position: { x: 60, y: 220 },
          data: {
            label: 'On data persisted',
            triggerType: 'event',
            config: { event: 'data.persisted', source: INGEST_PERSIST_SOURCE, resourceType: '' },
            templateId: 'event-trigger',
            iconName: 'Radio',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 300, y: 220 },
          data: {
            label: 'Log reaction',
            action: 'log',
            message: 'Reacted to {{ $json.count }} {{ $json.resourceTypes }} from {{ $json.source }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'evt-1', target: 'log-1' }],
    },
  };

  return [ingest, reactive];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/workflows test -- --run sample-workflow`
Expected: PASS (all `buildDefaultWorkflows` cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/sample-workflow.ts packages/workflows/src/sample-workflow.test.ts
git commit -m "feat(workflows): unify ingest into one Switch-routed workflow"
```

---

### Task 2: Engine-level routing integration test

**Files:**
- Create: `packages/workflows/src/engine/ingest-routing.test.ts`

**Interfaces:**
- Consumes: `buildDefaultWorkflows` (Task 1); `runWorkflow` from `./run-workflow`; `WorkflowServices` from `./services`.
- Produces: nothing consumed downstream (test-only). Proves the seeded `wf-ingest` graph routes a FHIR body to `unwrap-1` (skipping `form-validate-1`) and a form-answers body to `form-validate-1` (skipping `unwrap-1`), with `persist-1` running once each time.

- [ ] **Step 1: Write the failing test** — create `packages/workflows/src/engine/ingest-routing.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildDefaultWorkflows } from '../sample-workflow';
import { runWorkflow } from './run-workflow';
import type { WorkflowServices } from './services';
import type { WorkflowItem } from './items';

/** The seeded ingest workflow's nodes/edges, form-bound to a fake id. */
function ingestGraph() {
  const [ingest] = buildDefaultWorkflows({ orderFormId: 'form-1', webhookSecret: 's' });
  return ingest.definition;
}

/** Stub services: validateForm and persistStore just echo their items so we can assert calls. */
function stubServices() {
  const validateForm = vi.fn(async ({ formId, items }: { formId: string; items: WorkflowItem[] }) => ({
    items: [{ json: { resourceType: 'ServiceRequest' } }],
    meta: { formId, validated: items.length, invalid: [] },
  }));
  const persistStore = vi.fn(async ({ items, source }: { items: WorkflowItem[]; source?: string }) => ({
    items,
    meta: { persisted: items.length, flattened: { written: items.length, skipped: 0, degraded: 0 }, resourceTypes: [], source },
  }));
  return { validateForm, persistStore } as unknown as WorkflowServices;
}

const statusOf = (results: { nodeId: string; status: string }[], id: string) =>
  results.find((r) => r.nodeId === id)?.status;

describe('wf-ingest routing', () => {
  it('routes a FHIR transaction Bundle to unwrap and skips form-validate', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }],
    };
    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: bundle, headers: {}, query: {} },
      services,
    });
    expect(status).toBe('completed');
    expect(statusOf(results, 'unwrap-1')).toBe('success');
    expect(statusOf(results, 'form-validate-1')).toBe('skipped');
    expect(statusOf(results, 'persist-1')).toBe('success');
    expect((services.validateForm as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((services.persistStore as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('routes form answers to form-validate and skips unwrap', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: { patientName: 'Ada', testCode: 'CBC' }, headers: {}, query: {} },
      services,
    });
    expect(status).toBe('completed');
    expect(statusOf(results, 'form-validate-1')).toBe('success');
    expect(statusOf(results, 'unwrap-1')).toBe('skipped');
    expect(statusOf(results, 'persist-1')).toBe('success');
    expect((services.validateForm as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((services.persistStore as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('routes a bare resource array to unwrap', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const { results } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: [{ resourceType: 'Observation', id: 'o1' }], headers: {}, query: {} },
      services,
    });
    expect(statusOf(results, 'unwrap-1')).toBe('success');
    expect(statusOf(results, 'form-validate-1')).toBe('skipped');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/workflows test -- --run ingest-routing`
Expected: FAIL before Task 1's builder exists in the new shape (if run standalone) — otherwise this is the first run and should already exercise the real graph. If Task 1 is complete, it should PASS immediately; if it fails, the failure pinpoints a wiring bug (e.g. missing `sourceHandle`, wrong condition). Investigate before proceeding.

- [ ] **Step 3: (No implementation)** — this is a test-only task; the behavior is delivered by Task 1. If Step 2 revealed a wiring defect, fix `sample-workflow.ts` minimally and re-run.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/workflows test -- --run ingest-routing`
Expected: PASS (all three routing cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/engine/ingest-routing.test.ts
git commit -m "test(workflows): prove wf-ingest routes FHIR vs form payloads"
```

---

### Task 3: Wire the seed to the unified builder

**Files:**
- Modify: `packages/bootstrap/src/seed.ts:184` (the `buildDefaultWorkflows` call) + surrounding comments (`:171-176`, `:194-200`)
- Modify: `packages/bootstrap/src/seed.test.ts` (workflow-count + id + form-binding assertions at `:134-157`, `:159-186`, `:396`)

**Interfaces:**
- Consumes: `buildDefaultWorkflows({ orderFormId, webhookSecret })` (Task 1).
- Produces: nothing new; `seedDefaultWorkflowsFor` now seeds `wf-ingest` + `wf-sample-reactive`.

- [ ] **Step 1: Update the seed test expectations.** In `packages/bootstrap/src/seed.test.ts`:

Replace the `describe('seedDatabase — default workflows', …)` block (currently lines ~134-156) body so the three `it` cases read:

```ts
  it('seeds the Ingest + reactive default workflows', async () => {
    const { app, workflows } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.workflowsSeeded).toBe(2);
    expect(workflows.map((w) => w.id).sort()).toEqual(['wf-ingest', 'wf-sample-reactive']);
  });

  it('injects the seeded "Lab order" form id into the Ingest Form Validate node', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    const ingest = workflows.find((w) => w.id === 'wf-ingest');
    const def = ingest?.definition as { nodes: { data: { action?: string; config?: { formId?: string } } }[] };
    const fv = def.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config?.formId).toBe(ORDER_FORM_ID);
  });

  it('is idempotent — re-running seeds nothing new', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.workflowsSeeded).toBe(0);
    expect(workflows).toHaveLength(2);
  });
```

In the `describe('seedEssentials …')` block, update the first `it` (lines ~160-176) tail (from the `// All three…` comment onward) to:

```ts
    // Both default workflows seeded; the Ingest workflow is bound to the seeded Lab order form's id.
    expect(res.workflowsSeeded).toBe(2);
    expect(workflows.map((w) => w.id).sort()).toEqual(['wf-ingest', 'wf-sample-reactive']);
    const ingest = workflows.find((w) => w.id === 'wf-ingest');
    const def = ingest?.definition as { nodes: { data: { action?: string; config?: { formId?: string } } }[] };
    const orderForm = forms.find((f) => f.name === 'Lab order')!;
    expect(def.nodes.find((n) => n.data.action === 'form-validate')?.data.config?.formId).toBe(orderForm.id);
```

In the `seedEssentials` idempotency `it` (line ~185), change `expect(workflows).toHaveLength(3);` to:

```ts
    expect(workflows).toHaveLength(2);
```

In the terminology-fallback test (line ~396), change `expect(res.workflowsSeeded).toBe(3);` to:

```ts
    expect(res.workflowsSeeded).toBe(2);
```

- [ ] **Step 2: Run the seed tests to verify they fail**

Run: `pnpm --filter @openldr/bootstrap test -- --run seed`
Expected: FAIL — `seed.ts` still calls `buildDefaultWorkflows` with `formWebhookSecret`/`rawWebhookSecret` (TypeScript error) and seeds 3 ids.

- [ ] **Step 3: Update the seed call + comments.** In `packages/bootstrap/src/seed.ts`, change line 184 from:

```ts
  const defaults = buildDefaultWorkflows({ orderFormId, formWebhookSecret: randomUUID(), rawWebhookSecret: randomUUID() });
```

to:

```ts
  const defaults = buildDefaultWorkflows({ orderFormId, webhookSecret: randomUUID() });
```

Then refresh the two comment blocks that name the old workflows. Replace the `seedDefaultWorkflowsFor` header comment (lines ~171-176) with:

```ts
// Seed the default workflows — the unified inbound ingestion workflow (wf-ingest) + its
// reactive companion, seeded once each (idempotent by stable id) so a fresh install ships a
// real, runnable example. The ingest workflow's Form Validate branch is bound to the seeded
// "Lab order" form's actual id, and the webhook secret is generated per-install (so no secret
// is committed and reseeds never rotate it). Matched by id, not name, so operator-edited copies
// are never re-created. No-op (with a warning) when the order form is absent, since the form
// branch can't be bound without it.
```

In the `seedEssentials` comment (lines ~194-200), change the phrase
`the inbound lab-order ingestion workflow (+ its reactive companion)` to
`the unified ingestion workflow (+ its reactive companion)` and
`the ingestion loop can't validate without the "Lab order" form` to
`the ingest workflow's form branch can't validate without the "Lab order" form`.

- [ ] **Step 4: Run the seed tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap test -- --run seed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/seed.ts packages/bootstrap/src/seed.test.ts
git commit -m "feat(seed): seed the unified wf-ingest workflow (one secret)"
```

---

### Task 4: Full typecheck + test gate

**Files:** none (verification only).

- [ ] **Step 1: Run the workspace gate** for the two touched packages.

Run: `pnpm turbo run typecheck test --filter @openldr/workflows --filter @openldr/bootstrap`
Expected: typecheck clean, all tests pass. If a downstream consumer (e.g. `apps/server`) references the removed `DefaultWorkflowInput` fields, its typecheck will flag it — fix the call site the same way (single `webhookSecret`). Grep to confirm none remain:

Run: `git grep -n "formWebhookSecret\|rawWebhookSecret"`
Expected: no matches.

- [ ] **Step 2: Commit** (only if Step 1 required a downstream fix; otherwise skip).

```bash
git add -A
git commit -m "fix: update remaining buildDefaultWorkflows call sites to single secret"
```

---

## Self-Review

**Spec coverage:**
- Single workflow / one path / one secret / one toggle → Task 1 (builder) + Task 3 (seed).
- FHIR-vs-form routing via Switch with the exact condition → Task 1 (wiring) + Task 2 (proof).
- Shared Persist runs once; branches re-converge → Task 2 asserts `persist-1` success + one `persistStore` call.
- Reactive source updated to `webhook-ingest` → Task 1 test + builder.
- Seed create-if-absent, no deletion; 2 workflows → Task 3.
- Comment refresh naming the old workflows → Task 3 Step 3.
- No downstream call site left on the old signature → Task 4 `git grep`.

**Placeholder scan:** none — every code step shows full content; the only "no implementation" step (Task 2 Step 3) is a deliberate test-only task with an explicit fallback instruction.

**Type consistency:** `buildDefaultWorkflows({ orderFormId, webhookSecret })` used identically in Tasks 1, 2, 3; node ids (`trigger-1`, `route-1`, `unwrap-1`, `form-validate-1`, `persist-1`, `log-1`) and `sourceHandle`s (`fhir`/`form`) match across the builder, the unit test, and the routing test. Stub service shapes (`validateForm`, `persistStore`) copied from the existing `form-persist-handlers.test.ts` harness.

## Rollout Note (carry into implementation)

The CDR toolchain's default `OPENLDR_CE_HOOK_PATH` is `cdr-ingest`; to hit the unified endpoint it must be set to `ingest`. This plan does not modify the toolchain (separate repo). Flag to the operator/user when the work merges.
