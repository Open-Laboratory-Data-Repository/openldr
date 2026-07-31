# Form Capture Persistence (S2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a studio form submission persist through the same pipeline as automated ingest, so a site with no LIMS can capture by hand the data a LIMS would push — and protect that pipeline from being deleted or broken.

**Architecture:** The submit route validates answers (as today), extracts FHIR resources with `extractorsForForm`, packages them with the QuestionnaireResponse into a transaction Bundle, and runs the seeded `wf-ingest` workflow in-process with that Bundle. The Switch routes it down the **FHIR** branch — deliberately not the form branch, which is hardcoded to one `formId`. Seeded workflows become protected: undeletable, warned-on-edit, resettable.

**Tech Stack:** TypeScript, Fastify, Zod, React, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-form-capture-persistence-design.md`. Read it before Task 1.
- **No `Co-Authored-By` trailer on any commit.** The user is sole contributor.
- Manual capture routes through the **FHIR** branch of `wf-ingest`, never the form branch. The form branch is hardcoded to `formId: 'form-sample-order'` and stays untouched in this slice.
- **Never report success for a submission that stored nothing.** A missing/disabled workflow, a failed run, or an extraction that yields no resources are all errors.
- **Reset must preserve the existing webhook secret.** The seed mints it with `randomUUID()`; regenerating on reset silently invalidates every external producer's token.
- `Provenance` has no actor field (`sourceSystem`/`pluginId`/`pluginVersion`/`batchId` only). Who submitted is recorded on `QuestionnaireResponse.author` and in the audit event — **do not add a provenance column**.
- Run a package's tests with `pnpm --filter <name> exec vitest run <file>`. Never pipe turbo through `tail`.

---

### Task 1: Engine support — `form` trigger and a provenance override

**Files:**
- Modify: `packages/workflows/src/types.ts:70` (TRIGGER_SOURCES)
- Modify: `packages/workflows/src/engine/node-handlers/persist-store.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.test.ts` (or the persist-store test file if one exists)

**Interfaces:**
- Produces: `TriggerSource` gains `'form'`. The Persist Store handler reads `ctx.input.__provenance.sourceSystem` in preference to `node.data.config.source`. Task 2 relies on both.

Why this is safe rather than a forgery hole: the webhook route builds the run input itself as `{ method, body, headers, query }` — a client controls only `body`, nested one level down, so it can never set a top-level `__provenance`. Anyone who *can* set it (manual run from the builder) already has workflow-edit rights and could simply edit the persist node's `source` config directly, so this grants no new privilege.

- [ ] **Step 1: Write the failing test**

Append to the persist-store handler's test file:

```ts
describe('persist-store provenance override', () => {
  const node = { id: 'p1', type: 'action', data: { config: { source: 'webhook-ingest' } } };

  it('prefers a run-input provenance source over node config', async () => {
    const calls: { source?: string }[] = [];
    const ctx = {
      input: { method: 'POST', body: {}, __provenance: { sourceSystem: 'form-capture' } },
      nodeMeta: {},
      services: { persistStore: async (i: { source?: string }) => { calls.push(i); return { items: [], meta: {} }; } },
    } as never;

    await persistStoreHandler(node as never, ctx, []);
    expect(calls[0]!.source).toBe('form-capture');
  });

  it('falls back to node config when no override is present', async () => {
    const calls: { source?: string }[] = [];
    const ctx = {
      input: { method: 'POST', body: {} },
      nodeMeta: {},
      services: { persistStore: async (i: { source?: string }) => { calls.push(i); return { items: [], meta: {} }; } },
    } as never;

    await persistStoreHandler(node as never, ctx, []);
    expect(calls[0]!.source).toBe('webhook-ingest');
  });

  it('ignores an override nested in a webhook body', async () => {
    const calls: { source?: string }[] = [];
    const ctx = {
      input: { method: 'POST', body: { __provenance: { sourceSystem: 'form-capture' } } },
      nodeMeta: {},
      services: { persistStore: async (i: { source?: string }) => { calls.push(i); return { items: [], meta: {} }; } },
    } as never;

    await persistStoreHandler(node as never, ctx, []);
    expect(calls[0]!.source).toBe('webhook-ingest');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/workflows exec vitest run src/engine/node-handlers`
Expected: FAIL — the first test gets `'webhook-ingest'`, because the handler reads only node config.

- [ ] **Step 3: Implement**

Replace `packages/workflows/src/engine/node-handlers/persist-store.ts` with:

```ts
import type { NodeHandler } from './types';

/** Reserved top-level key on the run input carrying a provenance override.
 *  Only an in-process caller can set it: the webhook route builds the input
 *  envelope itself, so a client's payload lands at `body` and can never reach
 *  this level. */
function overrideSource(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const prov = (input as Record<string, unknown>).__provenance;
  if (typeof prov !== 'object' || prov === null) return undefined;
  const s = (prov as Record<string, unknown>).sourceSystem;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}

export const persistStoreHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Persist Store node requires server services');
  if (!ctx.services.persistStore) throw new Error('Persist Store node: persistStore service not injected');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const configured = String(config.source ?? '').trim() || undefined;
  const source = overrideSource(ctx.input) ?? configured;
  const result = await ctx.services.persistStore({ items: input, source });
  ctx.nodeMeta[node.id] = result.meta;
  return result.items;
};
```

- [ ] **Step 4: Add the `form` trigger source**

In `packages/workflows/src/types.ts`, extend the array on line 70:

```ts
export const TRIGGER_SOURCES = ['manual', 'schedule', 'webhook', 'ingest', 'event', 'postgres', 'email', 'form'] as const;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/workflows exec vitest run`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/types.ts packages/workflows/src/engine/node-handlers/persist-store.ts packages/workflows/src/engine/node-handlers/index.test.ts
git commit -m "feat(workflows): let an in-process run override the persist source"
```

---

### Task 2: Submit persists through the ingest workflow

**Files:**
- Modify: `apps/server/src/forms-routes.ts` (the `POST /api/forms/:id/responses` handler)
- Modify: `apps/server/src/forms-routes.test.ts`

**Interfaces:**
- Consumes: `ctx.workflows.runner.runAndRecord(workflowId, source, input, files?)` → `{ runId, correlationId, status, error } | null` (null = workflow missing or disabled); the `'form'` trigger and `__provenance` override from Task 1.
- Consumes: `extractorsForForm(model)`, `toTransactionBundle(qr, resources)`, `toQuestionnaireResponse(model, answers)` from `@openldr/forms`.
- Produces: the response body `{ ok: true, runId, correlationId, resourceTypes: string[] }` on success. Task 5's UI relies on `runId` being present.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/src/forms-routes.test.ts`. Extend `fakeCtx()` additively with a `workflows.runner` stub that records its arguments:

```ts
  it('persists a submission through the ingest workflow', async () => {
    const ctx = fakeCtx();
    const runs: { workflowId: string; source: string; input: any }[] = [];
    (ctx as any).workflows = {
      runner: {
        runAndRecord: async (workflowId: string, source: string, input: any) => {
          runs.push({ workflowId, source, input });
          return { runId: 'run-1', correlationId: null, status: 'completed', error: null };
        },
      },
    };
    const app = authedApp(ctx);
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] },
    });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, runId: 'run-1' });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.workflowId).toBe('wf-ingest');
    expect(runs[0]!.source).toBe('form');
    // Routed down the FHIR branch: the body is a transaction Bundle.
    expect(runs[0]!.input.body.resourceType).toBe('Bundle');
    expect(runs[0]!.input.body.type).toBe('transaction');
    // The QuestionnaireResponse rides along as entry[0].
    expect(runs[0]!.input.body.entry[0].resource.resourceType).toBe('QuestionnaireResponse');
    // Provenance override is top-level, not inside body.
    expect(runs[0]!.input.__provenance.sourceSystem).toBe('form-capture');
  });

  it('records the submitting user as the QuestionnaireResponse author', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(runs[0].body.entry[0].resource.author).toMatchObject({ display: 'admin' });
  });

  it('reports a specific error when the ingest workflow is disabled', async () => {
    const ctx = fakeCtx();
    (ctx as any).workflows = { runner: { runAndRecord: async () => null } };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('wf-ingest');
    expect(res.json().error).toMatch(/disabled|not enabled|unavailable/i);
  });

  it('reports a failed run rather than success', async () => {
    const ctx = fakeCtx();
    (ctx as any).workflows = {
      runner: { runAndRecord: async () => ({ runId: 'run-2', correlationId: null, status: 'failed', error: 'persist blew up' }) },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, runId: 'run-2' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/server exec vitest run src/forms-routes.test.ts`
Expected: FAIL — the route still returns a bare QuestionnaireResponse and never calls the runner.

- [ ] **Step 3: Implement**

In `apps/server/src/forms-routes.ts`, extend the `@openldr/forms` import to include `extractorsForForm` and `toTransactionBundle`. Then replace the body of the responses handler, from after the `validateReferences` block through the existing `try { ... }`, with:

```ts
    // Manual capture goes through the SAME pipeline as automated ingest, down the FHIR
    // branch: the form branch is hardcoded to one formId and cannot serve multiple
    // capture forms. toTransactionBundle puts the QuestionnaireResponse at entry[0], so
    // the verbatim record of what was typed is persisted alongside what was derived.
    const actor = req.user?.username ?? 'unknown';
    const response = toQuestionnaireResponse(f.schema, p.data.answers as never) as Record<string, unknown>;
    response.author = { display: actor };

    const resources = extractorsForForm(f.schema as never)
      .flatMap((ex) => ex.extract(response as never, toQuestionnaire(f.schema) as never, {}));
    if (resources.length === 0) {
      reply.code(400);
      return { error: 'form produced no resources', errors: [] };
    }

    const bundle = toTransactionBundle(response as never, resources);
    const outcome = await ctx.workflows.runner.runAndRecord(
      'wf-ingest',
      'form',
      { method: 'POST', body: bundle, headers: {}, query: {}, __provenance: { sourceSystem: 'form-capture' } },
    );

    if (!outcome) {
      // runAndRecord returns null when the workflow is missing or disabled: nothing ran.
      reply.code(409);
      return { ok: false, error: "capture pipeline unavailable: the 'wf-ingest' workflow is missing or disabled" };
    }
    if (outcome.status !== 'completed') {
      reply.code(500);
      return { ok: false, runId: outcome.runId, correlationId: outcome.correlationId, status: outcome.status, error: outcome.error };
    }

    await recordAudit(ctx, req, {
      action: 'form.response.submit', entityType: 'form', entityId: f.id,
      before: null, after: response, metadata: { formId: f.id, runId: outcome.runId },
    });
    reply.code(201);
    return {
      ok: true,
      runId: outcome.runId,
      correlationId: outcome.correlationId,
      resourceTypes: resources.map((r) => (r as { resourceType: string }).resourceType),
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/forms-routes.test.ts`
Expected: PASS. The pre-existing audit-ordering test must still pass — `form.response.submit` is still recorded, only for accepted submissions.

- [ ] **Step 5: Run the package suite and typecheck**

Run: `pnpm --filter @openldr/server exec vitest run && pnpm --filter @openldr/server exec tsc --noEmit`
Expected: PASS, no output from tsc.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git commit -m "feat(server): persist form submissions through the ingest pipeline"
```

---

### Task 3: Protected system workflows — delete is refused

**Files:**
- Create: `apps/server/src/system-workflows.ts`
- Create: `apps/server/src/system-workflows.test.ts`
- Modify: `apps/server/src/workflows-routes.ts:219` (the delete handler)
- Modify: `apps/server/src/workflows-routes.test.ts`

**Interfaces:**
- Produces: `isProtectedWorkflowId(id: string): boolean` and `PROTECTED_WORKFLOW_IDS: readonly string[]`. Task 4 and Task 5 both consume `isProtectedWorkflowId`.

Protection is **derived from the seed**, not stored as a column: a workflow whose id `buildDefaultWorkflows` produces is protected. A mutable flag could be edited away through the very surface it guards.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/system-workflows.test.ts
import { describe, expect, it } from 'vitest';
import { isProtectedWorkflowId, PROTECTED_WORKFLOW_IDS } from './system-workflows';

describe('protected system workflows', () => {
  it('protects the seeded ingest workflow', () => {
    expect(isProtectedWorkflowId('wf-ingest')).toBe(true);
  });

  it('protects the seeded reactive companion', () => {
    expect(isProtectedWorkflowId('wf-sample-reactive')).toBe(true);
  });

  it('does not protect a user-created workflow', () => {
    expect(isProtectedWorkflowId('wf-something-else')).toBe(false);
  });

  it('derives the list from the seed rather than hardcoding it', () => {
    // If buildDefaultWorkflows gains or renames a workflow, this list must follow
    // automatically — that is the point of deriving it.
    expect(PROTECTED_WORKFLOW_IDS.length).toBeGreaterThanOrEqual(2);
    expect([...PROTECTED_WORKFLOW_IDS]).toContain('wf-ingest');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server exec vitest run src/system-workflows.test.ts`
Expected: FAIL — `Failed to resolve import "./system-workflows"`.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/system-workflows.ts
import { buildDefaultWorkflows } from '@openldr/workflows';

/**
 * Ids of the workflows the seed always creates. Derived from the seed itself so the
 * set follows automatically when `buildDefaultWorkflows` changes — and so protection
 * cannot be edited away through the same API it is meant to guard.
 *
 * The arguments here only shape node config, never the ids, so throwaway values are
 * fine for enumeration.
 */
export const PROTECTED_WORKFLOW_IDS: readonly string[] = buildDefaultWorkflows({
  orderFormId: 'enumeration-only',
  webhookSecret: 'enumeration-only',
}).map((w) => w.id);

export function isProtectedWorkflowId(id: string): boolean {
  return PROTECTED_WORKFLOW_IDS.includes(id);
}
```

- [ ] **Step 4: Guard the delete route**

In `apps/server/src/workflows-routes.ts`, add the import and insert the guard as the first statement of the delete handler (before `store.get`):

```ts
import { isProtectedWorkflowId } from './system-workflows';
```

```ts
  app.delete('/api/workflows/:id', EDIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (isProtectedWorkflowId(id)) {
      reply.code(409);
      return {
        error: `'${id}' is a system workflow and cannot be deleted. Form capture and automated ingest both run through it. Use reset to restore it to its default.`,
      };
    }
```

Note the handler signature gains `reply` if it does not already take it.

- [ ] **Step 5: Mark protected workflows in the list response**

Task 5's UI needs to know which workflows are protected without duplicating the id list client-side. In `apps/server/src/workflows-routes.ts:172-175`, extend the list mapping:

```ts
  app.get('/api/workflows', VIEW, async () => {
    const all = await ctx.workflows.store.list();
    return all.map((w) => ({
      ...w,
      definition: redactWorkflowSecrets(w.definition),
      protected: isProtectedWorkflowId(w.id),
    }));
  });
```

Do the same for `GET /api/workflows/:id` (line ~177) so the builder can gate its save warning.

- [ ] **Step 6: Add the route tests**

Append to `apps/server/src/workflows-routes.test.ts`:

```ts
  it('marks seeded workflows as protected in the list response', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    (ctx as any).workflows.store.list = async () => ([
      { id: 'wf-ingest', name: 'Ingest', definition: { nodes: [], edges: [] } },
      { id: 'wf-mine', name: 'Mine', definition: { nodes: [], edges: [] } },
    ]);
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'a', username: 'a', displayName: null, roles: ['lab_admin'], capabilities: ['workflows.view'] } as never;
    });
    registerWorkflowRoutes(app, ctx as never);

    const res = await app.inject({ method: 'GET', url: '/api/workflows' });
    const byId = Object.fromEntries(res.json().map((w: any) => [w.id, w.protected]));
    expect(byId['wf-ingest']).toBe(true);
    expect(byId['wf-mine']).toBe(false);
  });

  it('refuses to delete a protected system workflow', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'a', username: 'a', displayName: null, roles: ['lab_admin'], capabilities: ['workflows.edit'] } as never;
    });
    registerWorkflowRoutes(app, ctx as never);

    const res = await app.inject({ method: 'DELETE', url: '/api/workflows/wf-ingest' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('cannot be deleted');
  });
```

- [ ] **Step 7: Run tests and commit**

Run: `pnpm --filter @openldr/server exec vitest run src/system-workflows.test.ts src/workflows-routes.test.ts`
Expected: PASS

```bash
git add apps/server/src/system-workflows.ts apps/server/src/system-workflows.test.ts apps/server/src/workflows-routes.ts apps/server/src/workflows-routes.test.ts
git commit -m "feat(server): refuse deletion of seeded system workflows"
```

---

### Task 4: Reset a protected workflow, preserving its webhook secret

**Files:**
- Modify: `apps/server/src/system-workflows.ts`
- Modify: `apps/server/src/system-workflows.test.ts`
- Modify: `apps/server/src/workflows-routes.ts` (add the reset route)
- Modify: `apps/server/src/workflows-routes.test.ts`

**Interfaces:**
- Produces: `POST /api/workflows/:id/reset` → `{ ok: true, secretPreserved: boolean }`, and `rebuildSystemWorkflow(existing): { workflow, secretPreserved }` used by the route. Task 5's UI consumes the route.

**This is the task with the trap.** The seed mints the webhook secret with `randomUUID()`. If reset regenerates it, every external producer's token silently stops working — that failure cost 565 CDR labs a 401 wall during live testing on 2026-07-31. Reset therefore restores the **graph** while re-pointing the webhook node at the **already-stored** `secretRef`.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/src/system-workflows.test.ts`:

```ts
import { rebuildSystemWorkflow } from './system-workflows';

describe('rebuildSystemWorkflow', () => {
  const existing = {
    id: 'wf-ingest',
    name: 'Ingest (mangled)',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'webhook', data: { templateId: 'webhook-trigger', path: 'ingest', secret: { secretRef: 'wsec_KEEP_ME' } } },
        { id: 'form-validate-1', type: 'action', data: { templateId: 'form-validate', config: { formId: 'form-sample-order', sourcePath: 'body' } } },
      ],
      edges: [],
    },
  };

  it('restores the default graph', () => {
    const { workflow } = rebuildSystemWorkflow(existing as never);
    expect(workflow.name).toBe('Ingest');
    expect(workflow.definition.nodes.length).toBeGreaterThan(2);
  });

  it('PRESERVES the existing webhook secretRef', () => {
    const { workflow, secretPreserved } = rebuildSystemWorkflow(existing as never);
    const trigger = workflow.definition.nodes.find((n: any) => n.data?.templateId === 'webhook-trigger');
    expect((trigger as any).data.secret.secretRef).toBe('wsec_KEEP_ME');
    expect(secretPreserved).toBe(true);
  });

  it('preserves the existing form binding', () => {
    const { workflow } = rebuildSystemWorkflow(existing as never);
    const fv = workflow.definition.nodes.find((n: any) => n.data?.templateId === 'form-validate');
    expect((fv as any).data.config.formId).toBe('form-sample-order');
  });

  it('reports secretPreserved=false when the old graph has no secret to keep', () => {
    const gutted = { id: 'wf-ingest', name: 'x', definition: { nodes: [], edges: [] } };
    const { secretPreserved } = rebuildSystemWorkflow(gutted as never);
    expect(secretPreserved).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server exec vitest run src/system-workflows.test.ts`
Expected: FAIL — `rebuildSystemWorkflow` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/server/src/system-workflows.ts`:

```ts
const SEEDED_ORDER_FORM_ID = 'form-sample-order';

function findNode(def: { nodes?: unknown[] }, templateId: string): Record<string, any> | undefined {
  return (def.nodes ?? []).find(
    (n) => (n as any)?.data?.templateId === templateId,
  ) as Record<string, any> | undefined;
}

/**
 * Rebuild a seeded workflow's definition from `buildDefaultWorkflows`, carrying two
 * things over from whatever is currently stored:
 *
 *  - the webhook node's `secretRef`. The seed mints secrets with randomUUID(), so
 *    minting a fresh one here would silently invalidate every external producer's
 *    token. Reset restores structure, never credentials.
 *  - the form-validate node's `formId`, so a site that re-pointed it keeps its binding.
 *
 * `secretPreserved: false` means the stored graph had no secret to carry over and the
 * rebuilt one carries the freshly generated default — callers must surface that.
 */
export function rebuildSystemWorkflow(existing: { id: string; definition: { nodes?: unknown[] } }): {
  workflow: any;
  secretPreserved: boolean;
} {
  const oldTrigger = findNode(existing.definition, 'webhook-trigger');
  const oldSecretRef = oldTrigger?.data?.secret?.secretRef as string | undefined;
  const oldFormId = findNode(existing.definition, 'form-validate')?.data?.config?.formId as string | undefined;

  const defaults = buildDefaultWorkflows({
    orderFormId: oldFormId ?? SEEDED_ORDER_FORM_ID,
    webhookSecret: randomUUID(),
  });
  const fresh = defaults.find((w) => w.id === existing.id);
  if (!fresh) throw new Error(`'${existing.id}' is not a seeded system workflow`);

  const workflow = JSON.parse(JSON.stringify(fresh));
  const newTrigger = findNode(workflow.definition, 'webhook-trigger');
  if (newTrigger && oldSecretRef) newTrigger.data.secret = { secretRef: oldSecretRef };

  return { workflow, secretPreserved: Boolean(oldSecretRef) || !newTrigger };
}
```

Add `import { randomUUID } from 'node:crypto';` at the top of the file.

- [ ] **Step 4: Add the reset route**

In `apps/server/src/workflows-routes.ts`, next to the delete handler:

```ts
  app.post('/api/workflows/:id/reset', EDIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProtectedWorkflowId(id)) {
      reply.code(400);
      return { error: `'${id}' is not a system workflow; there is no default to reset to` };
    }
    const before = await ctx.workflows.store.get(id);
    if (!before) { reply.code(404); return { error: 'workflow not found' }; }

    const { workflow, secretPreserved } = rebuildSystemWorkflow(before as never);
    await ctx.workflows.store.update(id, workflow);
    ctx.workflows.runner.setIngestWorkflowIds(await listIngestWorkflowIds(ctx));
    ctx.workflows.runner.setEventWorkflowIds(await listEventWorkflowIds(ctx));
    void ctx.workflows.listeners.reconcile().catch((err) => ctx.logger.warn({ err }, 'listener reconcile failed'));
    await recordAudit(ctx, req, {
      action: 'workflow.reset', entityType: 'workflow', entityId: id,
      before, after: workflow, metadata: { secretPreserved },
    });
    return { ok: true, secretPreserved };
  });
```

Import `rebuildSystemWorkflow` alongside `isProtectedWorkflowId`.

- [ ] **Step 5: Add the route regression test**

Append to `apps/server/src/workflows-routes.test.ts`:

```ts
  it('reset preserves the webhook secret so existing tokens keep working', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    let saved: any;
    (ctx as any).workflows.store.get = async () => ({
      id: 'wf-ingest', name: 'mangled',
      definition: { nodes: [{ id: 't', type: 'webhook', data: { templateId: 'webhook-trigger', secret: { secretRef: 'wsec_ORIGINAL' } } }], edges: [] },
    });
    (ctx as any).workflows.store.update = async (_id: string, wf: any) => { saved = wf; return wf; };
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'a', username: 'a', displayName: null, roles: ['lab_admin'], capabilities: ['workflows.edit'] } as never;
    });
    registerWorkflowRoutes(app, ctx as never);

    const res = await app.inject({ method: 'POST', url: '/api/workflows/wf-ingest/reset' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, secretPreserved: true });
    const trigger = saved.definition.nodes.find((n: any) => n.data?.templateId === 'webhook-trigger');
    expect(trigger.data.secret.secretRef).toBe('wsec_ORIGINAL');
  });

  it('refuses to reset a workflow that is not a system workflow', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'a', username: 'a', displayName: null, roles: ['lab_admin'], capabilities: ['workflows.edit'] } as never;
    });
    registerWorkflowRoutes(app, ctx as never);

    const res = await app.inject({ method: 'POST', url: '/api/workflows/wf-custom/reset' });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter @openldr/server exec vitest run src/system-workflows.test.ts src/workflows-routes.test.ts`
Expected: PASS

```bash
git add apps/server/src/system-workflows.ts apps/server/src/system-workflows.test.ts apps/server/src/workflows-routes.ts apps/server/src/workflows-routes.test.ts
git commit -m "feat(server): reset a system workflow without regenerating its secret"
```

---

### Task 5: Studio — protected workflows in the UI

**Files:**
- Modify: `apps/studio/src/api.ts` (near `deleteWorkflow`, ~line 1446)
- Modify: `apps/studio/src/workflows/WorkflowList.tsx:111`
- Modify: `apps/studio/src/workflows/page.tsx` (the builder's save action)
- Modify: `apps/studio/src/workflows/WorkflowList.test.tsx`

**Interfaces:**
- Consumes: `POST /api/workflows/:id/reset` from Task 4; `isProtectedWorkflowId` semantics (the client keeps its own copy of the id list — see note).

The client does not duplicate the protected-id list: Task 3 Step 5 already added `protected: boolean` to the list and get responses, so the UI just reads `w.protected`.

- [ ] **Step 1: Write the failing test**

Append to `apps/studio/src/workflows/WorkflowList.test.tsx`:

The existing rows render their menu items with `data-testid={`delete-${w.id}`}` etc. (`WorkflowList.tsx:186-191`), so assert on those rather than on accessible names. Follow the file's existing `@/api` mocking style and its existing way of opening a row menu.

```tsx
  it('offers reset instead of delete for a protected workflow', async () => {
    vi.mocked(fetchWorkflows).mockResolvedValue([
      { id: 'wf-ingest', name: 'Ingest', enabled: true, protected: true } as never,
      { id: 'wf-mine', name: 'Mine', enabled: true, protected: false } as never,
    ]);
    render(<WorkflowList />);
    await screen.findByTestId('open-wf-ingest');

    expect(screen.queryByTestId('delete-wf-ingest')).not.toBeInTheDocument();
    expect(screen.getByTestId('reset-wf-ingest')).toBeInTheDocument();
  });

  it('still offers delete for a user workflow', async () => {
    vi.mocked(fetchWorkflows).mockResolvedValue([
      { id: 'wf-mine', name: 'Mine', enabled: true, protected: false } as never,
    ]);
    render(<WorkflowList />);
    await screen.findByTestId('open-wf-mine');

    expect(screen.getByTestId('delete-wf-mine')).toBeInTheDocument();
    expect(screen.queryByTestId('reset-wf-mine')).not.toBeInTheDocument();
  });
```

If the file's dropdown only mounts its items once opened, open the row menu first using whatever interaction its existing tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/workflows/WorkflowList.test.tsx`
Expected: FAIL — Delete is rendered for every workflow.

- [ ] **Step 3: Add the API client function**

In `apps/studio/src/api.ts`, next to `deleteWorkflow`:

```ts
/** Restore a seeded system workflow to its default definition. The webhook secret is
 *  preserved server-side; `secretPreserved: false` means a new one had to be minted and
 *  external producers will need the new token. */
export async function resetWorkflow(id: string): Promise<{ ok: true; secretPreserved: boolean }> {
  return authFetch(`/api/workflows/${encodeURIComponent(id)}/reset`, jbody({}, 'POST'))
    .then((r) => okJson<{ ok: true; secretPreserved: boolean }>(r, 'reset workflow'));
}
```

Add `protected?: boolean` to the exported `Workflow` interface in the same file.

- [ ] **Step 4: Update the list menu**

In `apps/studio/src/workflows/WorkflowList.tsx`, add a reset handler alongside the existing `onDelete` (line ~108):

```tsx
  const onReset = useCallback(async (w: Workflow) => {
    try {
      const r = await resetWorkflow(w.id);
      if (r.secretPreserved) toast.success(`${w.name} restored to its default.`);
      // Never swallow this: every external sender's token has just stopped working.
      else toast.warning(`${w.name} restored, but a NEW webhook secret was generated — existing senders must be given the new token.`);
      await load();
    } catch (e) {
      toast.error(`Reset failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [load]);
```

Then replace the row menu's Delete item (`WorkflowList.tsx:190`) with a conditional pair:

```tsx
                          {w.protected ? (
                            <DropdownMenuItem data-testid={`reset-${w.id}`} onClick={() => { void onReset(w); }}>
                              Reset to default
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem data-testid={`delete-${w.id}`} onClick={() => setPendingDelete(w)}>
                              Delete
                            </DropdownMenuItem>
                          )}
```

Import `resetWorkflow` from `@/api` alongside the existing imports.

- [ ] **Step 5: Warn on saving a protected workflow**

In `apps/studio/src/workflows/page.tsx`, gate the save action when the loaded workflow has `protected === true`, using the same confirm-dialog component `WorkflowList.tsx` already uses for delete (its usage is at `WorkflowList.tsx:222-228`) — not `window.confirm`:

```tsx
  const [pendingProtectedSave, setPendingProtectedSave] = useState(false);

  // Protected workflows carry form capture AND automated ingest. A broken edit stops
  // clerks saving data, so make the operator acknowledge it rather than discover it.
  const requestSave = useCallback(() => {
    if (workflow?.protected) setPendingProtectedSave(true);
    else void doSave();
  }, [workflow, doSave]);
```

and render the dialog:

```tsx
        <ConfirmDialog
          open={pendingProtectedSave}
          onOpenChange={(o) => { if (!o) setPendingProtectedSave(false); }}
          title="Save changes to a system workflow?"
          body="Form capture and automated ingest both run through this workflow. If your changes break it, clerks will not be able to save data and incoming data will stop being stored. You can restore the default from the workflow list."
          confirmLabel="Save anyway"
          onConfirm={() => { setPendingProtectedSave(false); void doSave(); }}
        />
```

Point the existing save button at `requestSave`. Match the dialog component's real name and prop names as used in `WorkflowList.tsx`, and substitute that file's actual save function for `doSave`.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run: `pnpm --filter @openldr/studio exec vitest run && pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: PASS, no tsc output.

```bash
git add apps/studio/src/api.ts apps/studio/src/workflows/WorkflowList.tsx apps/studio/src/workflows/page.tsx apps/studio/src/workflows/WorkflowList.test.tsx
git commit -m "feat(studio): protect seeded workflows and offer reset to default"
```

---

### Task 6: Full gate

- [ ] **Step 1: Run the whole gate**

Run: `pnpm turbo run typecheck test --force`
Expected: all tasks pass. A failure mentioning `Test timed out` is a known flake — re-run that package alone before treating it as a regression.

- [ ] **Step 2: Commit any fixes**

Only if the gate surfaced something. Otherwise nothing to commit.

---

## Verification

After Task 6, confirm against the running app:

1. Open the seeded Lab order form, pick a patient and tests, submit. The response carries `ok: true` and a `runId`.
2. `select source_system, count(*) from patients group by 1` in the target DB shows a `form-capture` row distinct from `webhook-ingest`.
3. The submitted `QuestionnaireResponse` is stored, with `author` naming the signed-in user.
4. Disable `wf-ingest`, submit again: the UI shows the specific "capture pipeline unavailable" message and the typed answers are still in the form.
5. Attempt to delete `wf-ingest` from the workflow list — no delete action is offered.
6. Reset `wf-ingest`, then re-run a CDR `export-batch` with the **unchanged** token. It still authenticates — proving the secret survived.
