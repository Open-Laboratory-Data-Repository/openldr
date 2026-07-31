# Form capture persistence (S2) — design

**Date:** 2026-07-31
**Status:** Agreed, not implemented
**Scope:** Make a studio form submission persist through the same pipeline as automated ingest, and protect that pipeline from being disabled or broken.

## Why

The goal this serves is larger than this slice: **a site with no LIMS should be able to capture, by hand, the same data a LIMS would push automatically.** Today it cannot. `POST /api/forms/:id/responses` validates the answers, builds a `QuestionnaireResponse`, records an audit event, and **returns it to the browser without storing anything**. Manual capture produces no data at all.

Everything the conversion needs already exists and is proven — it is simply unreachable from the capture page.

## Roadmap context

This spec covers **S2 only**. The wider work decomposes into five independently shippable slices:

| | Slice | Depends on |
|---|---|---|
| S1 | Result/rejection model — project `Observation.status`, home for a rejection code, derive `DiagnosticReport.status` from its children | — |
| **S2** | **Form capture persistence (this spec)** | — |
| S3 | Port the CDR audit quality rules into CE so both paths are gated | S2 |
| S4 | `ServiceRequest` entity resolver, so results can reference an order | — |
| S5 | The capture forms themselves: one-sitting episode form, and results-against-order | S2, S4; encodes S1 |

Agreed ordering: **S2 → S1 → S4 → S5 → S3.**

## What already exists (measured 2026-07-31)

- **`wf-ingest`** seeds one workflow: `Webhook → Switch → { fhir: Unwrap Bundle | form: Form Validate } → shared Persist → Log`. The switch has one rule, `Array.isArray($json.body) || $json.body.resourceType === 'Bundle'`, with `fallbackOutput: "form"`.
- The **FHIR branch is proven**: 565 of 600 CDR labs posted through it tonight, projecting 566 patients / 1,231 requests / 4,415 results.
- **`toTransactionBundle(qr, extracted)`** already emits the `QuestionnaireResponse` as `entry[0]`, followed by one entry per extracted resource.
- **`persistResources`** (behind the Persist Store node) enforces the runtime validation-strictness gate, stamps provenance, and writes both `fhir.fhir_resources` and the flat read model. `createPersistStoreService` wraps it with a per-run `batchId` and publishes `data.persisted`, which reactive workflows listen for.

Four defects found in the **form** branch while reading it. This spec routes around all four rather than inheriting them; fixing that branch for external producers is out of scope here.

1. `form-validate-1` is hardcoded to `formId: "form-sample-order"`, so it validates *every* non-FHIR payload against the Lab order schema. Fatal for a multi-form capture story.
2. `createFormValidateService` hardcodes `ObservationExtractor` + `ServiceRequestExtractor` instead of calling `extractorsForForm(model)`, so a `Patient`-bound intake form would still run the ServiceRequest extractor.
3. It runs only the pure `validateAnswers`; it never runs `validateReferences`, so references are not existence-checked on that path.
4. It discards the `QuestionnaireResponse`, emitting only extracted resources.

## Non-goals

- The result/rejection model (S1), the CE quality gate (S3), the `ServiceRequest` resolver (S4), and the capture forms themselves (S5).
- Fixing the form branch's hardcoded `formId` or its extractor selection for external producers.
- Any change to how the CDR toolchain posts.

## Design

### 1. The route builds a Bundle and runs the ingest workflow

`POST /api/forms/:id/responses` becomes:

```
validateAnswers            (pure, existing)
validateReferences         (async, existing)
extractorsForForm(model)   → resources
toTransactionBundle(qr, resources)
run wf-ingest in-process with that Bundle as the webhook body
→ Switch matches `fhir` → Unwrap Bundle → Persist → Log
```

**Manual capture goes through the FHIR branch, not the form branch.** That is deliberate and is the central decision of this spec:

- it is form-agnostic, so it sidesteps the hardcoded `formId` (defect 1);
- the QR rides along as `entry[0]`, satisfying the requirement to keep a verbatim record of what was typed (defect 4) with no extra work;
- extraction happens in the route, where `extractorsForForm(model)` selects extractors by form domain (defect 2);
- reference validation already runs in the route (defect 3);
- it reuses the branch with the most real-world evidence behind it.

The route keeps its existing 400 behaviour for invalid answers. Persistence is attempted only after both validators pass.

**Mechanism.** The route invokes the workflow through the runner already on `AppContext` (`ctx.workflows.runner`), the same entry point the webhook route uses, seeding the run input with the webhook-shaped envelope the graph expects (`{ method, body, headers, query }`, with the Bundle at `body`) so the Switch condition evaluates unchanged. It does **not** make a loopback HTTP call, so no webhook secret is involved and errors stay in-process.

### 2. Provenance

The Persist Store node stamps `source` from static node config (`webhook-ingest`). Manual capture must be distinguishable from LIMS/CDR data and must record who typed it.

The route passes a provenance override through the run input: `sourceSystem: 'form-capture'`. The Persist Store node prefers a source supplied on the run input and falls back to its configured `data.config.source` when absent, so the webhook path is unchanged and no seeded graph needs editing.

**The submitting user is recorded on `QuestionnaireResponse.author`, not on provenance.** `Provenance` carries only `sourceSystem`, `pluginId`, `pluginVersion` and `batchId`; adding an actor there would mean a migration touching `fhir.fhir_resources` and every flat table. `QuestionnaireResponse.author` is FHIR's own field for "who filled this in", the QR is already being persisted as the record of what was typed, and the route additionally records the real request actor on its audit event. That covers traceability with no schema change.

**Mechanism.** The override travels on the run input alongside the envelope rather than in the node graph, because the graph is operator-editable and provenance must not be. Concretely: the runner's input carries a reserved key the Persist Store handler reads before falling back to node config. The handler must ignore an override arriving from a *webhook* payload — otherwise an external caller could forge `source: 'form-capture'` and disguise machine data as hand-entered. Only an in-process invocation may set it.

Rationale for recording the actor: hand-entered data has different error characteristics from instrument-fed data, and a suspect value needs to be traceable to a person. The provenance columns already exist.

### 3. Protecting the pipeline

Routing capture through `wf-ingest` makes clinical data entry depend on a workflow an operator can disable, edit, or delete. Three guards:

**Delete is refused.** `wf-ingest` is marked a protected system workflow. The delete route rejects it with an error naming what depends on it, rather than a generic failure.

**Editing warns loudly.** Saving a modified protected workflow requires an explicit confirmation in the builder that states plainly that form capture and automated ingest both run through it, and that a broken edit stops clerks saving data.

**Reset to default.** A protected workflow can be restored to its seeded definition from the builder.

> ⚠ **Reset MUST preserve the existing webhook secret.** The seed mints it with `randomUUID()` per install (`seed.ts`), so regenerating on reset would silently invalidate every external producer's token. That exact failure cost 565 labs a 401 wall during live testing on 2026-07-31. Reset restores the node graph and re-points the secret *reference* at the existing stored secret; it never mints a new one.

**Mechanism.** Protection is a property of seeded system workflows generally, not a special case for `wf-ingest`, so `wf-sample-reactive` gets it too. It is derived from the seed — a workflow whose id appears in `buildDefaultWorkflows` is protected — rather than stored as a mutable column, so protection cannot be edited away through the same surface it is meant to guard. Reset restores that workflow's definition by rebuilding it from the same seed function, then re-points the webhook node's `secretRef` at the already-stored secret.

**Possible split.** If the implementation plan grows unwieldy, §3 is the natural seam: §1–2 (route → Bundle → workflow, with provenance) deliver working manual capture on their own, and the protection guards can follow as S2b. They are specified together because the dependency §3 mitigates is one §1 creates.

### 4. Failure handling

| Condition | Behaviour |
|---|---|
| Answers fail either validator | 400 with the existing `AnswerError[]` body; nothing persisted |
| `wf-ingest` missing, disabled, or invalid | **Specific** operator-facing error naming the workflow and its state — never a generic 500. The browser retains the clerk's answers so nothing is lost |
| Workflow runs but persistence fails | The run's own error surfaces; the response reports which resources were and were not stored |
| Extraction yields no resources | Treated as an error, not a silent success — a submission that produces nothing is a form-configuration bug |

The clerk-facing rule throughout: **never report success for a submission that stored nothing.**

### 5. Testing

- A submission persists: extracted resources land in `fhir.fhir_resources` and project into the read model, with `source = form-capture` and the actor recorded.
- The `QuestionnaireResponse` is stored alongside the extracted resources, and is `entry[0]` of the Bundle.
- A `Patient`-bound form runs only its domain's extractors — pinning the `extractorsForForm` fix, since the current hardcoded pair would fail this.
- Disabled `wf-ingest` → the specific operator error, not a 500, and no partial write.
- Delete of a protected workflow is refused.
- **Reset preserves the webhook secret**: capture the secret, reset, assert the same token still authenticates a webhook POST. This is the regression test for the trap above.
- The existing webhook path is unaffected: a CDR-shaped Bundle still persists with `source = webhook-ingest`.

## Consequences

- Form submission changes from a read-only echo to a write. Any client relying on the old "returns a QR, stores nothing" behaviour changes semantics — no such client is known in-repo.
- Clinical capture gains a dependency on a workflow. The guards in §3 mitigate it; the residual risk is accepted deliberately in exchange for both paths sharing one pipeline.
- The form branch keeps its four defects for external producers. They are documented here so the next person meets them as known issues rather than discoveries.
