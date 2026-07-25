# Unified Ingest Workflow — Design

**Date:** 2026-07-25
**Status:** Approved (design)
**Area:** `packages/workflows`, `packages/bootstrap` (seed)

## Problem

A fresh install currently seeds **two** inbound ingestion workflows, split by the
*shape* of the posted payload:

- **Ingest-form** (`wf-ingest-form`): `Webhook (/hooks/lab-orders)` → `Form Validate` →
  `Persist` → `Log`. For senders that POST **form answers**.
- **Ingest-raw** (`wf-ingest-raw`): `Webhook (/hooks/cdr-ingest)` → `Unwrap FHIR Bundle` →
  `Persist` → `Log`. For senders that POST a **FHIR transaction Bundle** (or bare array),
  e.g. the CDR toolchain.

Two endpoints, two secrets, two enable toggles is confusing: operators expect a single
"ingest" entry point. This design **merges the two into one workflow** that inspects the
payload and routes it to the correct validation path, while preserving both behaviours.

## Goals

- One seeded ingest workflow, one webhook path, one secret, one enable toggle.
- FHIR Bundles / bare resource arrays continue to be unwrapped and persisted per-resource.
- Form-answer payloads continue to be validated against the "Lab order" form and persisted.
- No new node types; the routing is visible on the canvas.

## Non-Goals (YAGNI)

- **No auto-deletion / migration** of the old `wf-ingest-form` / `wf-ingest-raw` on
  existing installs. The seed is create-if-absent by stable id and must never delete
  operator-editable rows. The old workflows ship disabled and are harmless; operators can
  delete them manually. Fresh installs receive only the new `wf-ingest`.
- No change to the projection layer — it already routes each persisted resource by
  `resourceType`.
- No support for a **single bare FHIR resource** without a Bundle/array wrapper beyond what
  `unwrap-bundle` already tolerates. (The detection rule below still catches
  `resourceType: 'Bundle'` and arrays, which are the two documented shapes.)

## Chosen Approach

**Switch-branch** (of three considered):

- **A — Switch-branch (chosen):** one webhook → a `Switch` node evaluates the payload shape
  → routes to either `Unwrap FHIR Bundle` or `Form Validate` → both branches re-converge on
  one shared `Persist` → `Log`. Reuses existing nodes; branch is visible.
- B — a new single "smart validate" node that detects + handles both internally. Rejected:
  new node type, hides the logic, more code to maintain.
- C — keep two webhooks, relabel as one. Rejected: does not actually merge.

### Engine facts this relies on (verified)

- **Switch node** (`type: 'condition'`, `data.templateId: 'switch'`): evaluates each
  `data.rules[].condition` (a bare JS expression) in the QuickJS isolate against a scope
  where `$json` is the first input item's `.json`. The first truthy rule's `name` becomes
  the chosen output handle; no match → `data.fallbackOutput`. Items pass through unchanged.
  (`engine/node-handlers/switch.ts`.)
- **Branch pruning:** after a node runs, the runner skips every outgoing edge whose
  `sourceHandle` is set and differs from the chosen branch.
  (`engine/run-workflow.ts` — branch pruning block.)
- **Branch re-convergence:** a node's input is the concatenation of all its **non-skipped**
  incoming edges' items. So a single `Persist` fed by both branch edges runs exactly once,
  with only the active branch's output. (`engine/run-workflow.ts` — `upstreamItemsFor`.)
- **Webhook envelope:** the webhook route seeds `ctx.input = { method, body, headers, query }`,
  so `$json.body` is the posted payload. (`apps/server/src/workflows-routes.ts`.)
- Both `form-validate` and `unwrap-bundle` read their payload from `config.sourcePath`
  (`'body'`), so each branch node keeps its existing `{ sourcePath: 'body' }` config
  unchanged.

## The Workflow (`wf-ingest`, name "Ingest")

Seeded **disabled** (exposes a live HTTP endpoint; operator opts in and copies the secret).

```
Webhook  (POST /api/workflows/hooks/ingest, header X-Webhook-Token, one per-install secret)
   │
   ▼
Switch   rule "fhir" ──▶ Unwrap FHIR Bundle ─┐
   │                     (sourcePath: body)   │
   └── fallback "form" ─▶ Form Validate ──────┼──▶ Persist Store ──▶ Log
                          (Lab order form,     │    (source: webhook-ingest)
                           sourcePath: body)  ─┘
```

### Nodes

| id | type | key data |
|----|------|----------|
| `trigger-1` | `webhook` | `path: 'ingest'`, `method: 'POST'`, `secret: <webhookSecret>`, `templateId: 'webhook-trigger'` |
| `route-1` | `condition` | `templateId: 'switch'`, `rules: [{ name: 'fhir', condition: <FHIR test> }]`, `fallbackOutput: 'form'` |
| `unwrap-1` | `action` | `action: 'unwrap-bundle'`, `config: { sourcePath: 'body' }`, `templateId: 'unwrap-bundle'` |
| `form-validate-1` | `action` | `action: 'form-validate'`, `config: { formId: <orderFormId>, sourcePath: 'body' }`, `templateId: 'form-validate'` |
| `persist-1` | `action` | `action: 'persist-store'`, `config: { source: 'webhook-ingest' }`, `templateId: 'persist-store'` |
| `log-1` | `action` | `action: 'log'`, `message: 'Persisted ingest: {{ $json }}'`, `level: 'info'`, `templateId: 'log'` |

**FHIR detection rule** (`route-1`, rule `fhir`, bare JS expression):

```js
Array.isArray($json.body) || (!!$json.body && $json.body.resourceType === 'Bundle')
```

Truthy → handle `fhir` (Unwrap). Otherwise → fallback `form` (Form Validate).

### Edges

| id | source | target | sourceHandle |
|----|--------|--------|--------------|
| `e1` | `trigger-1` | `route-1` | — |
| `e2` | `route-1` | `unwrap-1` | `fhir` |
| `e3` | `route-1` | `form-validate-1` | `form` |
| `e4` | `unwrap-1` | `persist-1` | — |
| `e5` | `form-validate-1` | `persist-1` | — |
| `e6` | `persist-1` | `log-1` | — |

`e2`/`e3` MUST carry `sourceHandle` matching the Switch rule name / fallback, or pruning
will not fire and both branches would run.

## Ripple Changes

- **`packages/workflows/src/sample-workflow.ts`**
  - `DefaultWorkflowInput`: replace `formWebhookSecret` + `rawWebhookSecret` with a single
    `webhookSecret`.
  - Replace the `ingestForm` and `ingestRaw` builders with a single `ingest` builder (graph
    above). Replace the path/source constants accordingly: one `INGEST_WEBHOOK_PATH = 'ingest'`
    and one `INGEST_PERSIST_SOURCE = 'webhook-ingest'`.
  - Update the reactive companion (`wf-sample-reactive`) event-trigger `source` from
    `webhook-lab-orders` to `webhook-ingest`, and refresh its name/description to reference
    "Ingest".
  - Rewrite the file header comment to describe the single unified workflow + reactive demo.
  - `buildDefaultWorkflows` returns `[ingest, reactive]` (2 workflows).

- **`packages/bootstrap/src/seed.ts`**
  - `seedDefaultWorkflowsFor`: call `buildDefaultWorkflows({ orderFormId, webhookSecret: randomUUID() })`.
  - No change to the create-if-absent-by-id loop; it now seeds `wf-ingest` + `wf-sample-reactive`.
  - Refresh the surrounding comments (`seedDefaultWorkflowsFor` header + `seedEssentials`
    comment) that currently name "the inbound lab-order ingestion loop" to describe the
    single unified ingest workflow.

## Testing

- **`sample-workflow.test.ts`** (rewrite affected cases):
  - `buildDefaultWorkflows` returns 2 workflows; the ingest one has id `wf-ingest`, is
    disabled, and its webhook path is `ingest`.
  - The Switch node exists with a `fhir` rule and `fallbackOutput: 'form'`.
  - Edges `route-1 → unwrap-1` and `route-1 → form-validate-1` carry `sourceHandle`
    `'fhir'` and `'form'` respectively; both branch nodes edge into the single `persist-1`.
  - Persist `source` is `webhook-ingest`; the reactive event trigger's `source` matches.
  - The Form Validate node is bound to the passed `orderFormId`.

- **Engine integration** (new test, `run-workflow`-level, using `buildDefaultWorkflows`):
  - Run the ingest workflow with `input = { method: 'POST', body: <FHIR transaction Bundle> }`
    → `unwrap-1` runs and persists the Bundle's resources; `form-validate-1` is **skipped**.
  - Run with `input = { method: 'POST', body: <form answers object> }` → `form-validate-1`
    runs and persists; `unwrap-1` is **skipped**.
  - Run with `input = { method: 'POST', body: [<resource>, <resource>] }` (bare array) →
    `unwrap-1` runs; `form-validate-1` is skipped.
  - Assert the skipped branch is reported `status: 'skipped'` and Persist ran once.

## Rollout Notes

- Fresh installs: seed produces `wf-ingest` (disabled) + `wf-sample-reactive` (enabled).
- Existing installs: the old `wf-ingest-form` / `wf-ingest-raw` remain (disabled). Document
  that they can be deleted manually; the new `wf-ingest` is added alongside on next
  essentials seed.
- CDR toolchain: its default `OPENLDR_CE_HOOK_PATH` (`cdr-ingest`) must be set to `ingest`
  to target the unified endpoint. Call this out in the plan's operator note.
