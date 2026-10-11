# Bench entry: link results to the order, and reject a whole order. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Controller ruling during Task 3:** the field binds `ServiceRequest.extension` with `fhirDiscriminator: { url: 'urn:openldr:ext:rejection' }`, not `ServiceRequest.rejection`, because the FHIR path lint rule refuses a path that is not an R4 element. Read every mention below in that light.

**Goal:** Every Observation from a Lab order submit points at its order, and the bench can reject a
whole order with a coded reason that reaches the warehouse.

**Architecture:** A pure helper `linkToOrder` gives the extracted ServiceRequest an id before the
bundle is built and points every Observation and Specimen at it. A new Lab order field, found by the
CE path `ServiceRequest.rejection`, holds an order rejection. The ServiceRequest extractor turns it
into `status: revoked`, the `urn:openldr:ext:rejection` extension and an `unsatisfactory` Specimen;
the results extractor then writes nothing. The studio sets the field from the page's ⋯ menu.

**Tech Stack:** TypeScript, vitest, Fastify, React + shadcn, Kysely migrations, FHIR R4 types.

**Spec:** `docs/superpowers/specs/2026-10-11-bench-order-link-and-rejection-design.md`

## Global Constraints

- Work in this worktree: `D:/Projects/Repositories/openldr_ce/.claude/worktrees/bench-order-reject`.
  Check `git branch --show-current` before every commit. Stage by exact path. No `Co-Authored-By`.
- The order-rejection field is found by `fhirPath === 'ServiceRequest.rejection'`, never by its id.
- The extension URL is exactly `urn:openldr:ext:rejection`, with sub-extensions `code` (`valueCode`)
  and `reason` (`valueString`). The warehouse already reads this shape
  (`packages/db/src/relational/request-facts.ts:50-56`; tested in `request-facts.test.ts:25-36`).
- The order reason value set URL is exactly `urn:openldr:valueset:order-reject-reason`.
- Migration number **110** (`packages/db/src/migrations/internal/110_lab_order_rejection.ts`). Before
  Task 3, re-check that no unmerged branch claims 110 (see Task 3 Step 1).
- Rejection wins: on a rejected order, no Observation of any kind is written.
- The studio names no value set and no clinical code (AGENTS.md section 8). Reasons come from the
  server (`catalogResultParams`, `rejectReasons.order`).
- UI follows AGENTS.md section 5: actions in a `⋯` menu, a Sheet for the choice, no footer buttons.
- All new user-facing text in en, fr and pt. A missing key renders braces.
- Writing rules for docs and comments: `.claude/skills/unslop/SKILL.md`. No em dashes.
- Test gate: `pnpm turbo run test --force --concurrency=2 --continue` and
  `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`.
  `apps/server` lint must stay clean.

---

## File map

| File | Change | Task |
|---|---|---|
| `packages/forms/src/order-rejection-path.ts` | create: the path and extension constants, `orderRejectionFieldId` | 1 |
| `packages/forms/src/extract/order-rejection.ts` | create: `orderRejectionOf(response, questionnaire)` | 1 |
| `packages/forms/src/extract/extract.ts` | ServiceRequestExtractor: revoked, extension, Specimen | 1 |
| `packages/forms/src/extract/test-results.ts` | export `readTestDetails`; write nothing on a rejected order | 1 |
| `packages/forms/src/extract/index.ts`, `src/index.ts`, `src/pure.ts` | exports | 1, 2 |
| `packages/forms/src/extraction.test.ts` | extractor tests | 1 |
| `packages/forms/src/link-to-order.ts` (+ `.test.ts`) | create: `linkToOrder` | 2 |
| `apps/server/src/forms-routes.ts` (+ `.test.ts`) | call `linkToOrder`; route tests | 2 |
| `packages/db/src/migrations/internal/110_lab_order_rejection.ts` (+ `.test.ts`), `index.ts`, `packages/db/src/index.ts` | migration 110 | 3 |
| `packages/forms/src/samples/forms.ts`, `forms.test.ts`, `samples/starter-packs.ts` | sample field, pin, rationale, version | 3 |
| `apps/studio/src/forms-runtime/order-rejection-context.ts` | create: context | 4 |
| `apps/studio/src/forms-runtime/FormRuntime.tsx`, `TestDetailsField.tsx` (+ tests) | hide field, merge answer, close rows | 4 |
| `apps/studio/src/pages/FormCapture.tsx` (+ test), `i18n/en.ts`, `fr.ts`, `pt.ts` | menu, sheet, banner, copy | 4 |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`, `apps/web/src/docs/0.1.8/forms.md` | docs | 5 |

---

### Task 1: Extractors write a rejected order

**Files:**
- Create: `packages/forms/src/order-rejection-path.ts`
- Create: `packages/forms/src/extract/order-rejection.ts`
- Modify: `packages/forms/src/extract/extract.ts` (ServiceRequestExtractor, about lines 160-222)
- Modify: `packages/forms/src/extract/test-results.ts` (export `readTestDetails`, guard in `extract`)
- Modify: `packages/forms/src/extract/index.ts`, `packages/forms/src/index.ts`, `packages/forms/src/pure.ts`
- Test: `packages/forms/src/extraction.test.ts`

**Interfaces:**
- Produces: `ORDER_REJECTION_PATH = 'ServiceRequest.rejection'`,
  `ORDER_REJECTION_EXTENSION = 'urn:openldr:ext:rejection'`,
  `orderRejectionFieldId(schema: { fields: ReadonlyArray<{ id: string; fhirPath?: string | null; enabled?: boolean }> }): string | null`
  (all from `@openldr/forms` and `@openldr/forms/pure`);
  `orderRejectionOf(response: QuestionnaireResponse, questionnaire: Questionnaire): Coding | null`
  (from `@openldr/forms`).

- [ ] **Step 1: Write the failing tests.** Append to `packages/forms/src/extraction.test.ts`:

```ts
describe('order-level rejection (2026-10-11 spec, part 2)', () => {
  const CATALOG = 'urn:openldr:codesystem:test-catalog'
  const REASON = { system: 'urn:openldr:cs:reject-order', code: 'UNLABELLED', display: 'Unlabelled specimen' }
  const order = () =>
    makeSchema({
      id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [
        makeField({ id: 'tests', displayLabel: 'Tests', fieldType: 'reference', order: 0, fhirPath: 'ServiceRequest.code', referenceMultiple: true, cardinality: { min: 1, max: '*' } }),
        makeField({ id: 'details', displayLabel: 'Results', fieldType: 'testDetails', order: 1, referenceDependsOn: 'tests' }),
        makeField({ id: 'rej', displayLabel: 'Order rejection', fieldType: 'reference', order: 2, fhirPath: 'ServiceRequest.rejection', valueSetUrl: 'urn:openldr:valueset:order-reject-reason' }),
      ],
    })
  const run = (answers: Record<string, unknown>) => {
    const model = order()
    const qr = toQuestionnaireResponse(model, answers as never)
    const q = toQuestionnaire(model)
    return { sr: ServiceRequestExtractor.extract(qr, q, ctx), results: TestResultsExtractor.extract(qr, q, ctx) }
  }
  const typed = (specimen: unknown) => ({
    [`${CATALOG}|FBC`]: { specimen, rejection: null, results: [
      { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL' },
    ] },
  })

  it('finds the field by its path, not its id', () => {
    expect(orderRejectionFieldId(order())).toBe('rej')
    expect(orderRejectionFieldId(makeSchema({ id: 'x', name: 'X', fields: [] }))).toBeNull()
  })

  it('revokes the order, carries the reason in the warehouse extension, and writes an unsatisfactory Specimen', () => {
    const { sr } = run({ tests: [{ system: CATALOG, code: 'FBC' }], details: typed(null), rej: REASON })
    expect(sr).toHaveLength(2)
    const [request, specimen] = sr as any[]
    expect(request.status).toBe('revoked')
    expect(request.extension).toEqual([{ url: 'urn:openldr:ext:rejection', extension: [
      { url: 'code', valueCode: 'UNLABELLED' },
      { url: 'reason', valueString: 'Unlabelled specimen' },
    ] }])
    expect(specimen).toEqual({
      resourceType: 'Specimen',
      status: 'unsatisfactory',
      subject: { reference: 'Patient/p1' },
      condition: [{ coding: [REASON] }],
    })
  })

  it('gives the Specimen a type only when every test chose the same one', () => {
    const blood = { system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }
    const same = run({ tests: [{ system: CATALOG, code: 'FBC' }], details: typed(blood), rej: REASON }).sr as any[]
    expect(same[1].type).toEqual({ coding: [blood] })
    const mixed = run({
      tests: [{ system: CATALOG, code: 'FBC' }, { system: CATALOG, code: 'GLU' }],
      details: { ...typed(blood), [`${CATALOG}|GLU`]: { specimen: { system: 'urn:openldr:cs:local', code: 'UR' }, rejection: null, results: [] } },
      rej: REASON,
    }).sr as any[]
    expect(mixed[1].type).toBeUndefined()
  })

  it('falls back to the code when the reason has no display', () => {
    const { sr } = run({ tests: [{ system: CATALOG, code: 'FBC' }], rej: { system: REASON.system, code: 'DUPLICATE' } })
    expect((sr[0] as any).extension[0].extension[1]).toEqual({ url: 'reason', valueString: 'DUPLICATE' })
  })

  it('writes no Observation at all on a rejected order', () => {
    const { results } = run({ tests: [{ system: CATALOG, code: 'FBC' }], details: typed(null), rej: REASON })
    expect(results).toEqual([])
  })

  it('leaves an order with no rejection active, with no Specimen', () => {
    const { sr, results } = run({ tests: [{ system: CATALOG, code: 'FBC' }], details: typed(null) })
    expect(sr).toHaveLength(1)
    expect((sr[0] as any).status).toBe('active')
    expect((sr[0] as any).extension).toBeUndefined()
    expect(results).toHaveLength(1)
  })
})
```

Add to the file's imports: `import { orderRejectionFieldId } from './order-rejection-path'`.

- [ ] **Step 2: Run, expect FAIL.** `pnpm --filter @openldr/forms exec vitest run src/extraction.test.ts`
  Expected: fails to import `./order-rejection-path`.

- [ ] **Step 3: Create `packages/forms/src/order-rejection-path.ts`:**

```ts
// Order-level rejection on a Lab order (docs/superpowers/specs/2026-10-11-bench-order-link-and-rejection-design.md).

/**
 * CE's own path for the field that holds an order rejection. It names the field's job, not a FHIR
 * element, like `ServiceRequest.identifier.value` does for the requisition number. Every reader finds
 * the field by this path, never by its id, so an operator's copy of the form keeps working.
 */
export const ORDER_REJECTION_PATH = 'ServiceRequest.rejection'

/**
 * The ServiceRequest extension the warehouse reads into `lab_requests.rejection_code` and
 * `rejection_reason` (packages/db/src/relational/request-facts.ts). cdr writes the same shape for
 * DISA rejections.
 */
export const ORDER_REJECTION_EXTENSION = 'urn:openldr:ext:rejection'

/** The id of the enabled field bound to ORDER_REJECTION_PATH, or null when the form has none. */
export function orderRejectionFieldId(schema: {
  fields: ReadonlyArray<{ id: string; fhirPath?: string | null; enabled?: boolean }>
}): string | null {
  return schema.fields.find((f) => f.enabled !== false && f.fhirPath === ORDER_REJECTION_PATH)?.id ?? null
}
```

- [ ] **Step 4: Create `packages/forms/src/extract/order-rejection.ts`:**

```ts
import type { Coding, Questionnaire, QuestionnaireItem, QuestionnaireResponse, QuestionnaireResponseItem } from 'fhir/r4'
import { EXT_CORLIX_FHIR_PATH } from '../extensions'
import { ORDER_REJECTION_PATH } from '../order-rejection-path'

function findLinkId(items: QuestionnaireItem[] | undefined): string | null {
  for (const item of items ?? []) {
    if (item.extension?.some((e) => e.url === EXT_CORLIX_FHIR_PATH && e.valueString === ORDER_REJECTION_PATH)) return item.linkId
    const inner = findLinkId(item.item)
    if (inner) return inner
  }
  return null
}

function findAnswer(items: QuestionnaireResponseItem[] | undefined, linkId: string): Coding | null {
  for (const item of items ?? []) {
    if (item.linkId === linkId) return item.answer?.[0]?.valueCoding ?? null
    const inner = findAnswer(item.item, linkId)
    if (inner) return inner
  }
  return null
}

/** The reason the whole order was rejected, read from the field bound to ORDER_REJECTION_PATH. */
export function orderRejectionOf(response: QuestionnaireResponse, questionnaire: Questionnaire): Coding | null {
  const linkId = findLinkId(questionnaire.item)
  if (!linkId) return null
  const coding = findAnswer(response.item, linkId)
  return coding?.code ? coding : null
}
```

- [ ] **Step 5: Export `readTestDetails`** in `packages/forms/src/extract/test-results.ts`: change
  `function readTestDetails(` to `export function readTestDetails(`. Then make the extractor write
  nothing on a rejected order:

```ts
// at the top of test-results.ts
import { orderRejectionOf } from './order-rejection'

// TestResultsExtractor.extract
  extract(response: QuestionnaireResponse, questionnaire: Questionnaire, ctx: ExtractionContext): FhirResource[] {
    // Rejection wins (2026-10-11 spec, decision 2): a rejected order writes no result and no
    // per-test cancelled Observation. The typed values stay in the response only.
    if (orderRejectionOf(response, questionnaire)) return []
    const answer = parseTestDetails(readTestDetails(response))
    return Object.entries(answer).flatMap(([key, detail]) => observationsFor(key, detail, ctx))
  },
```

(The parameter was `_questionnaire`; rename it to `questionnaire`.)

- [ ] **Step 6: ServiceRequestExtractor.** In `packages/forms/src/extract/extract.ts` add imports:

```ts
import type { Specimen } from 'fhir/r4'
import { parseTestDetails } from '../test-details'
import { ORDER_REJECTION_EXTENSION, ORDER_REJECTION_PATH } from '../order-rejection-path'
import { orderRejectionOf } from './order-rejection'
import { readTestDetails } from './test-results'
```

(Merge `Specimen` into the existing `fhir/r4` type import.) In the walk, skip the rejection field
before the generic value read, so it never reaches the identifier or priority branches:

```ts
      if (path === ORDER_REJECTION_PATH) return
```

Place it directly after `if (path === undefined) return`. Replace the final `return [request]` with:

```ts
    if (codings.length) request.code = { coding: codings }

    const rejection = orderRejectionOf(response, questionnaire)
    if (!rejection) return [request]

    // Order-level rejection (2026-10-11 spec, part 2). The extension is the shape the warehouse reads
    // into lab_requests.rejection_code and rejection_reason; the Specimen is for FHIR readers.
    request.status = 'revoked'
    request.extension = [...(request.extension ?? []), {
      url: ORDER_REJECTION_EXTENSION,
      extension: [
        { url: 'code', valueCode: rejection.code },
        { url: 'reason', valueString: rejection.display ?? rejection.code },
      ],
    }]
    const specimen: Specimen = {
      resourceType: 'Specimen',
      status: 'unsatisfactory',
      subject: request.subject,
      condition: [{ coding: [rejection] }],
    }
    const type = sharedSpecimenType(response)
    if (type) specimen.type = { coding: [type] }
    return [request, specimen]
```

And add, above `ServiceRequestExtractor`:

```ts
/** The specimen type every test on the order chose, or null when none chose one or they differ. */
function sharedSpecimenType(response: QuestionnaireResponse): Coding | null {
  const chosen = Object.values(parseTestDetails(readTestDetails(response))).map((d) => d.specimen)
  if (chosen.length === 0 || chosen.some((s) => !s)) return null
  const first = chosen[0]!
  if (!chosen.every((s) => s!.system === first.system && s!.code === first.code)) return null
  return { system: first.system, code: first.code, ...(first.display ? { display: first.display } : {}) }
}
```

`test-results.ts` imports only *types* from `extract.ts`, so this import does not create a runtime
cycle. If typecheck reports the specimen coding type differs (`ResultCoding`), adapt the mapping to the
type in `packages/forms/src/test-details.ts`; keep the output shape the test pins.

- [ ] **Step 7: Exports.** `packages/forms/src/extract/index.ts` adds
  `export * from './order-rejection'`. `packages/forms/src/index.ts` and `packages/forms/src/pure.ts`
  each add `export * from './order-rejection-path'`.

- [ ] **Step 8: Run, expect PASS.** `pnpm --filter @openldr/forms exec vitest run src/extraction.test.ts`
  Then the whole package: `pnpm --filter @openldr/forms exec vitest run`, and
  `pnpm --filter @openldr/forms typecheck`. All green.

- [ ] **Step 9: Commit.**

```bash
git add packages/forms/src/order-rejection-path.ts packages/forms/src/extract/order-rejection.ts packages/forms/src/extract/extract.ts packages/forms/src/extract/test-results.ts packages/forms/src/extract/index.ts packages/forms/src/index.ts packages/forms/src/pure.ts packages/forms/src/extraction.test.ts
git commit -m "feat(forms): a rejected order revokes the request and writes no results"
```

---

### Task 2: Link every Observation to its order

**Files:**
- Create: `packages/forms/src/link-to-order.ts`, `packages/forms/src/link-to-order.test.ts`
- Modify: `packages/forms/src/index.ts` (export)
- Modify: `apps/server/src/forms-routes.ts` (about line 480, where `resources` is built)
- Test: `apps/server/src/forms-routes.test.ts`

**Interfaces:**
- Consumes: Task 1's `ORDER_REJECTION_PATH` (route test fixture only).
- Produces: `linkToOrder(resources: FhirResource[], newId: () => string): FhirResource[]` from `@openldr/forms`.

- [ ] **Step 1: Write the failing unit test** `packages/forms/src/link-to-order.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { FhirResource } from 'fhir/r4'
import { linkToOrder } from './link-to-order'

const counter = () => { let n = 0; return () => `id-${++n}` }
const obs = (code: string, extra: object = {}): FhirResource =>
  ({ resourceType: 'Observation', status: 'final', code: { coding: [{ code }] }, ...extra }) as FhirResource
const order = (extra: object = {}): FhirResource =>
  ({ resourceType: 'ServiceRequest', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' }, ...extra }) as FhirResource

describe('linkToOrder', () => {
  it('gives the order an id and points every Observation at it', () => {
    const out = linkToOrder([order(), obs('HGB'), obs('FBC', { status: 'cancelled' })], counter()) as any[]
    expect(out[0].id).toBe('id-1')
    expect(out[1].basedOn).toEqual([{ reference: 'ServiceRequest/id-1' }])
    expect(out[2].basedOn).toEqual([{ reference: 'ServiceRequest/id-1' }])
  })

  it('keeps an id the order already has', () => {
    const out = linkToOrder([order({ id: 'sr-9' }), obs('HGB')], counter()) as any[]
    expect(out[0].id).toBe('sr-9')
    expect(out[1].basedOn).toEqual([{ reference: 'ServiceRequest/sr-9' }])
  })

  it('leaves an Observation that already names its basis alone', () => {
    const own = { basedOn: [{ reference: 'ServiceRequest/other' }] }
    const out = linkToOrder([order(), obs('HGB', own)], counter()) as any[]
    expect(out[1].basedOn).toEqual(own.basedOn)
  })

  it('gives each Specimen an id and links it from the order', () => {
    const specimen = { resourceType: 'Specimen', status: 'unsatisfactory' } as FhirResource
    const out = linkToOrder([order(), specimen], counter()) as any[]
    expect(out[1].id).toBe('id-2')
    expect(out[0].specimen).toEqual([{ reference: 'Specimen/id-2' }])
  })

  it('changes nothing when there is no order, or more than one', () => {
    const none = [obs('HGB')]
    expect(linkToOrder(none, counter())).toEqual(none)
    const two = [order(), order(), obs('HGB')]
    expect(linkToOrder(two, counter())).toEqual(two)
  })

  it('does not change the resources it was given', () => {
    const input = [order(), obs('HGB')]
    const before = JSON.stringify(input)
    linkToOrder(input, counter())
    expect(JSON.stringify(input)).toBe(before)
  })
})
```

- [ ] **Step 2: Run, expect FAIL.** `pnpm --filter @openldr/forms exec vitest run src/link-to-order.test.ts`

- [ ] **Step 3: Create `packages/forms/src/link-to-order.ts`:**

```ts
import type { FhirResource, Reference, ServiceRequest, Specimen } from 'fhir/r4'

/**
 * Point what one form submit extracted at the order it belongs to (2026-10-11 spec, part 1).
 *
 * The warehouse fills lab_results.request_id from Observation.basedOn (packages/db/src/relational/
 * observation.ts), so an Observation with no basedOn is a result no report can join to its order.
 * The order gets its id here, before the bundle is built: the ingest bundle step keeps an id a
 * resource arrives with and resolves `Type/id` references to it (packages/workflows/src/engine/
 * node-handlers/unwrap-bundle.ts). With no order, or more than one, nothing is changed.
 */
export function linkToOrder(resources: FhirResource[], newId: () => string): FhirResource[] {
  const orders = resources.filter((r) => r.resourceType === 'ServiceRequest') as ServiceRequest[]
  if (orders.length !== 1) return resources
  const original = orders[0]!
  const order: ServiceRequest = { ...original, id: original.id ?? newId() }
  const orderRef: Reference = { reference: `ServiceRequest/${order.id}` }

  const specimenRefs: Reference[] = []
  const linked = resources.map((r): FhirResource => {
    if (r === original) return order
    if (r.resourceType === 'Specimen') {
      const specimen: Specimen = { ...r, id: r.id ?? newId() }
      specimenRefs.push({ reference: `Specimen/${specimen.id}` })
      return specimen
    }
    if (r.resourceType === 'Observation' && !r.basedOn?.length) return { ...r, basedOn: [orderRef] }
    return r
  })
  if (specimenRefs.length > 0) order.specimen = [...(order.specimen ?? []), ...specimenRefs]
  return linked
}
```

Note: `order` is a new object placed into `linked` by the `r === original` branch, and the
`order.specimen` assignment after the map mutates that same object, so the returned array carries it.

- [ ] **Step 4: Export** from `packages/forms/src/index.ts`: `export * from './link-to-order'`.
  (Not from `pure.ts`: only the server uses it.)

- [ ] **Step 5: Run, expect PASS.** `pnpm --filter @openldr/forms exec vitest run src/link-to-order.test.ts`

- [ ] **Step 6: Write the failing route tests.** In `apps/server/src/forms-routes.test.ts`, after the
  test `'hands the extractor the band each result was measured against'` (about line 1080), add two
  tests. Reuse its `ctx` set-up exactly (the `runs` recorder and the `testCatalog` stub). First add a
  fixture next to `resultOrderSchema` (about line 179):

```ts
// 2026-10-11 spec: the same order, plus the field that holds an order-level rejection.
const rejectableOrderSchema = {
  ...resultOrderSchema,
  id: 'rejectable-order',
  fields: [
    ...resultOrderSchema.fields,
    {
      id: 'rej',
      fhirPath: 'ServiceRequest.rejection',
      displayLabel: 'Order rejection',
      description: null,
      fieldType: 'reference' as const,
      required: false,
      enabled: true,
      order: 3,
      cardinality: { min: 0, max: '1' },
      section: 'main',
      valueSetUrl: 'urn:openldr:valueset:order-reject-reason',
    },
  ],
} satisfies FormInput['schema'];
```

Then the tests:

```ts
  it('points every Observation at the order it was submitted with', async () => {
    // same ctx, runs and testCatalog set-up as the band test above
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: resultOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        details: { 'urn:openldr:codesystem:test-catalog|FBC': { specimen: null, rejection: null, results: [
          { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
            band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } },
        ] } },
      } },
    });
    expect(res.statusCode).toBe(201);
    const resources = runs[0].body.entry.map((e: any) => e.resource);
    const request = resources.find((r: any) => r.resourceType === 'ServiceRequest');
    expect(typeof request.id).toBe('string');
    for (const observation of resources.filter((r: any) => r.resourceType === 'Observation')) {
      expect(observation.basedOn).toEqual([{ reference: `ServiceRequest/${request.id}` }]);
    }
  });

  it('a rejected order is revoked with the reason, carries a Specimen, and writes no Observation', async () => {
    // same ctx, runs and testCatalog set-up as the band test above
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: rejectableOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        rej: { system: 'urn:openldr:cs:reject-order', code: 'WRONGPT', display: 'Wrong patient' },
      } },
    });
    expect(res.statusCode).toBe(201);
    const resources = runs[0].body.entry.map((e: any) => e.resource);
    const request = resources.find((r: any) => r.resourceType === 'ServiceRequest');
    const specimen = resources.find((r: any) => r.resourceType === 'Specimen');
    expect(request.status).toBe('revoked');
    expect(request.extension).toEqual([{ url: 'urn:openldr:ext:rejection', extension: [
      { url: 'code', valueCode: 'WRONGPT' }, { url: 'reason', valueString: 'Wrong patient' },
    ] }]);
    expect(specimen.status).toBe('unsatisfactory');
    expect(request.specimen).toEqual([{ reference: `Specimen/${specimen.id}` }]);
    expect(resources.filter((r: any) => r.resourceType === 'Observation')).toEqual([]);
  });
```

If `fakeCtx()`'s `validateCode` stub refuses `WRONGPT` against the order reason value set, read how the
band test's stub answers and extend the stub to accept codes from
`urn:openldr:valueset:order-reject-reason`; do not weaken the route.

- [ ] **Step 7: Run, expect FAIL** (no `basedOn`; no `Specimen.id` link).
  `pnpm --filter @openldr/server exec vitest run src/forms-routes.test.ts`

- [ ] **Step 8: Wire the route.** In `apps/server/src/forms-routes.ts` import `linkToOrder` from
  `@openldr/forms` (beside the existing forms imports) and `randomUUID` from `node:crypto` (if not
  imported). Change the resources line (about line 480):

```ts
    // Point every Observation and Specimen at the order (2026-10-11 spec, part 1), so
    // lab_results.request_id fills and reports can join a result to its order.
    const resources = linkToOrder(
      extractorsForForm(f.schema as never).flatMap((ex) => ex.extract(response as never, questionnaire as never, extractionContext)),
      randomUUID,
    );
```

- [ ] **Step 9: Run, expect PASS.** The two new tests and the whole file:
  `pnpm --filter @openldr/server exec vitest run src/forms-routes.test.ts`. Then
  `pnpm --filter @openldr/server lint` (0 problems) and `pnpm --filter @openldr/server typecheck`.

- [ ] **Step 10: Commit.**

```bash
git add packages/forms/src/link-to-order.ts packages/forms/src/link-to-order.test.ts packages/forms/src/index.ts apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git commit -m "feat(server): link every result of a bench order to the order"
```

---

### Task 3: Migration 110 adds the field to the Lab order

**Files:**
- Create: `packages/db/src/migrations/internal/110_lab_order_rejection.ts`, `110_lab_order_rejection.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (register 110), `packages/db/src/index.ts` (export the snapshot)
- Modify: `packages/forms/src/samples/forms.ts` (orderForm field list), `packages/forms/src/samples/forms.test.ts` (pin, about line 300)
- Modify: `packages/forms/src/samples/starter-packs.ts` (rationale, `STARTER_PACK_VERSION` `'3'` to `'4'`)

**Interfaces:**
- Consumes: the field shape below (must match Task 1's tests: `fhirPath: 'ServiceRequest.rejection'`,
  `valueSetUrl: 'urn:openldr:valueset:order-reject-reason'`).
- Produces: `LAB_ORDER_REJECTION_FIELDS_SNAPSHOT` (exported from `@openldr/db` as
  `LAB_ORDER_FORM_MIGRATION_ORDER_REJECTION`).

The field, used verbatim in the migration and the sample:

```ts
{
  id: 'fld-ord-rejection',
  fhirPath: 'ServiceRequest.rejection',
  displayLabel: 'Order rejection',
  description: null,
  fieldType: 'reference',
  required: false,
  enabled: true,
  order: 9,
  cardinality: { min: 0, max: '1' },
  section: 'order',
  valueSetUrl: 'urn:openldr:valueset:order-reject-reason',
}
```

- [ ] **Step 1: Check the number is free.**

```bash
for b in $(git branch --format='%(refname:short)' --no-merged main); do git diff --name-only main...$b -- packages/db/src/migrations | grep -E "/11[0-9]_" && echo "  ^ on $b"; done; ls packages/db/src/migrations/internal | grep -E "^11[0-9]_"
```

Expected: no output. If 110 is taken, stop and report; do not renumber on your own.

- [ ] **Step 2: Write the failing migration test** `110_lab_order_rejection.test.ts`. Copy
  `107_lab_order_drop_specimen.test.ts` and change it as follows. Imports:
  `LAB_ORDER_REJECTION_FIELDS_SNAPSHOT, LAB_ORDER_PREV_FIELDS_SNAPSHOT, up, down` from
  `./110_lab_order_rejection`, and
  `import { LAB_ORDER_NO_ORDER_SPECIMEN_SNAPSHOT as SHIPPED_107 } from './107_lab_order_drop_specimen'`.
  Cases:
  1. `up` on a row carrying 107's shape gives `LAB_ORDER_REJECTION_FIELDS_SNAPSHOT`, which contains `fld-ord-rejection`.
  2. Every earlier field and its order is unchanged, and the new field is last with order 9:
     `expect(ids(LAB_ORDER_REJECTION_FIELDS_SNAPSHOT)).toEqual([...ids(LAB_ORDER_PREV_FIELDS_SNAPSHOT), 'fld-ord-rejection'])`
     and orders `[0,1,2,3,4,5,6,7,8,9]`.
  3. An operator's edit (Tests relabelled) is left alone.
  4. A second run changes nothing.
  5. Two forms named Lab order: neither is touched.
  6. `down` restores 107's shape exactly.
  7. The frozen copy matches what 107 shipped: `expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_107)`.

- [ ] **Step 3: Run, expect FAIL.**
  `pnpm --filter @openldr/db exec vitest run src/migrations/internal/110_lab_order_rejection.test.ts`

- [ ] **Step 4: Write `110_lab_order_rejection.ts`.** Copy `107_lab_order_drop_specimen.ts` and change:
  - The header comment: the 2026-10-11 spec adds the order-rejection field. Same exact-match, marker
    and down() discipline as 100 to 107. The field is appended, so no other field's order moves.
  - `LAB_ORDER_PREV_FIELDS_SNAPSHOT`: 107's shipped shape, copied VERBATIM as a literal (107's own
    `LAB_ORDER_PREV_FIELDS_SNAPSHOT` array without its last entry, `fld-ord-specimen-type`). Do not
    import it; test case 7 proves the copy.
  - `LAB_ORDER_REJECTION_FIELDS_SNAPSHOT = [...LAB_ORDER_PREV_FIELDS_SNAPSHOT, <the field above>]`.
  - `MARKER_KEY = '__migration110'`, the marker interface renamed, the functions renamed
    `addOrderRejection` and `removeOrderRejection`.
  - Keep `stableStringify` and `sortValue` as copied.

- [ ] **Step 5: Register and export.** `packages/db/src/migrations/internal/index.ts`:
  `import * as m110 from './110_lab_order_rejection';` and
  `'110_lab_order_rejection': { up: m110.up, down: m110.down },` after the 109 entry.
  `packages/db/src/index.ts`, beside the 107 export (line 118):
  `export { LAB_ORDER_REJECTION_FIELDS_SNAPSHOT as LAB_ORDER_FORM_MIGRATION_ORDER_REJECTION } from './migrations/internal/110_lab_order_rejection';`

- [ ] **Step 6: Run, expect PASS.** The 110 test, then the db package's migration tests:
  `pnpm --filter @openldr/db exec vitest run src/migrations`

- [ ] **Step 7: The sample form.** In `packages/forms/src/samples/forms.ts`, append the field above to
  `orderForm.fields` after `fld-ord-ref-facility`, with this comment:

```ts
      // Order-level rejection (2026-10-11 spec, part 2). Set from the capture page's ⋯ menu, never
      // typed: the runtime does not draw a field bound to ServiceRequest.rejection. Found by that
      // path, not by this id.
```

In `packages/forms/src/samples/forms.test.ts` change the pin (about line 300) from
`LAB_ORDER_FORM_MIGRATION_NO_ORDER_SPECIMEN` to `LAB_ORDER_FORM_MIGRATION_ORDER_REJECTION`, and the
import at line 22 to match.

- [ ] **Step 8: The starter pack.** In `packages/forms/src/samples/starter-packs.ts` add to `RATIONALE`:

```ts
  'fld-ord-rejection': 'Why the lab refused the whole order, from the seeded order rejection reasons. Set from the page menu.',
```

and bump `STARTER_PACK_VERSION` from `'3'` to `'4'`.

- [ ] **Step 9: Run, expect PASS.** `pnpm --filter @openldr/forms exec vitest run` (forms.test,
  starter-packs tests and the lint tests: the Lab order must still lint clean). Then
  `pnpm --filter @openldr/db typecheck` and `pnpm --filter @openldr/forms typecheck`.

- [ ] **Step 10: Commit.**

```bash
git add packages/db/src/migrations/internal/110_lab_order_rejection.ts packages/db/src/migrations/internal/110_lab_order_rejection.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/index.ts packages/forms/src/samples/forms.ts packages/forms/src/samples/forms.test.ts packages/forms/src/samples/starter-packs.ts
git commit -m "feat(db): the Lab order holds an order-level rejection (migration 110)"
```

---

### Task 4: The studio rejects an order from the page menu

**Files:**
- Create: `apps/studio/src/forms-runtime/order-rejection-context.ts`
- Modify: `apps/studio/src/forms-runtime/FormRuntime.tsx` (props, about 42-110; field filter, about 196-202; submit, about 284-304; render root)
- Modify: `apps/studio/src/forms-runtime/TestDetailsField.tsx`
- Modify: `apps/studio/src/pages/FormCapture.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (the `forms` block, about line 318)
- Test: `apps/studio/src/forms-runtime/TestDetailsField.test.tsx`, `apps/studio/src/forms-runtime/FormRuntime.test.tsx`, `apps/studio/src/pages/FormCapture.test.tsx`

**Interfaces:**
- Consumes: `ORDER_REJECTION_PATH`, `orderRejectionFieldId` from `@openldr/forms/pure` (Task 1).
- Produces: FormRuntime prop `orderRejection?: CodingAnswer | null`; `OrderRejectedContext`.

- [ ] **Step 1: Write the failing tests.** Follow each file's existing render helpers and mocks.

`TestDetailsField.test.tsx`: render the field inside `<OrderRejectedContext.Provider value>` with one
test. Expect:
- the row's state line reads `Order rejected` (or the `orderRejected` copy value passed);
- clicking the row opens no result sheet;
- the row's ⋯ menu shows the remove entry and neither Open nor the test-level reject.

With `value={false}` the existing behaviour holds (one existing test already covers it).

`FormRuntime.test.tsx`: with a schema that has a field bound to `ServiceRequest.rejection`:
- (a) the field is not rendered (no label "Order rejection" on screen);
- (b) submitting with `orderRejection={{ system: 's', code: 'C', display: 'D' }}` calls `onSubmit` with
  that field's id set to the coding;
- (c) submitting with `orderRejection={null}` calls `onSubmit` without that field's id.

`FormCapture.test.tsx`: mock `getForm` to return a published Lab-order-like schema with a
`ServiceRequest.rejection` field, and mock `catalogResultParams` to answer
`rejectReasons.order: [{ system: 's', code: 'WRONGPT', display: 'Wrong patient' }]`. Then:
- open the page ⋯ menu; expect a `Reject order` item;
- choose it, pick `Wrong patient` in the sheet, press its reject action;
- expect the banner text `Order rejected: Wrong patient`;
- open the ⋯ menu again; expect `Undo rejection`;
- choose it; expect the banner to be gone.

A schema WITHOUT the field shows neither menu item.

Radix menus in this repo open on `pointerDown`/`mouseDown`. Copy how existing FormCapture or
TestDetailsField tests open a `DropdownMenu`.

- [ ] **Step 2: Run, expect FAIL.**
  `pnpm --filter @openldr/studio exec vitest run src/forms-runtime/TestDetailsField.test.tsx src/forms-runtime/FormRuntime.test.tsx src/pages/FormCapture.test.tsx`

- [ ] **Step 3: Create `order-rejection-context.ts`:**

```ts
import { createContext } from 'react';

/**
 * True while the whole order is rejected (2026-10-11 spec, decision 2). The results field reads it to
 * close every row for entry. A context, so the flag does not thread through FieldRow and FieldControl.
 */
export const OrderRejectedContext = createContext(false);
```

- [ ] **Step 4: FormRuntime.**
  - Add the prop to the destructure and the type:
    `orderRejection?: CodingAnswer | null` with the doc comment "The order-level rejection the page
    holds (2026-10-11 spec). Undefined leaves the form as before."
  - Import `CodingAnswer` and `ORDER_REJECTION_PATH, orderRejectionFieldId` from
    `@openldr/forms/pure`, and `OrderRejectedContext` from `./order-rejection-context`.
  - In `topLevelFields`, also filter out `f.fhirPath === ORDER_REJECTION_PATH`.
  - In the submit handler, replace `void onSubmit(cleanAnswers(schema, answers));` with:

```tsx
        const rejectionId = orderRejectionFieldId(schema);
        const submitted = { ...answers };
        if (rejectionId && orderRejection !== undefined) {
          if (orderRejection) submitted[rejectionId] = orderRejection;
          else delete submitted[rejectionId];
        }
        void onSubmit(cleanAnswers(schema, submitted));
```

  - Wrap the returned `<form>` in
    `<OrderRejectedContext.Provider value={Boolean(orderRejection)}>`, inside `TooltipProvider`.

- [ ] **Step 5: TestDetailsField.**
  - Add `orderRejected?: string` to `TestDetailsCopy` and `orderRejected: 'Order rejected'` to `EN`.
  - Read the flag: `const orderRejected = useContext(OrderRejectedContext);` (import `useContext`).
  - `stateLine`: return `t.orderRejected` first when `orderRejected`.
  - The row button: `disabled={orderRejected}`, and its `onClick` does nothing when rejected.
  - The ⋯ menu: render the Open and Reject items only when `!orderRejected`.
  - Do not open a sheet while rejected: `const open = orderRejected ? undefined : tests.find(...)`,
    and the same for `reject`.

- [ ] **Step 6: FormCapture.**
  - State: `orderRejection: CodingAnswer | null` (initial null), `rejectingOrder: boolean`,
    `orderReasons: CatalogRejectReason[]`.
  - `const rejectionField = schema ? orderRejectionFieldId(schema) : null;`
  - In the header ⋯ menu, before Submit, when `rejectionField` is set:
    - when `orderRejection` is set: an item `t('forms.orderUndoReject')` that sets it to null;
    - otherwise: an item `t('forms.orderReject')` that calls
      `catalogResultParams([], null).then((a) => setOrderReasons(a.rejectReasons.order)).catch(() => setOrderReasons([]))`
      and sets `rejectingOrder` true.
  - Under the header (inside the scroll body, before `SubmissionReadiness`), when `orderRejection` is
    set, render a banner styled like the existing success and error lines:

```tsx
          {orderRejection ? (
            <div className="mx-6 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {t('forms.orderRejectedBanner', { reason: orderRejection.display ?? orderRejection.code })}
            </div>
          ) : null}
```

  - Render `RejectSheet` when `rejectingOrder`:

```tsx
      {rejectingOrder ? (
        <RejectSheet
          level="order"
          reasons={orderReasons}
          copy={{
            title: t('forms.orderRejectTitle'), hint: t('forms.orderRejectHint'), reject: t('forms.orderRejectAction'),
            none: t('forms.orderRejectNone'), choose: t('forms.orderRejectChoose'),
          }}
          onReject={(reason) => { setOrderRejection({ system: reason.system, code: reason.code, display: reason.display }); setRejectingOrder(false); }}
          onClose={() => setRejectingOrder(false)}
        />
      ) : null}
```

  - Pass `orderRejection={rejectionField ? orderRejection : undefined}` to `FormRuntime`.
  - Add `orderRejected: t('forms.testsOrderRejected')` to its `testDetailsCopy`.
  - After a successful submit, clear `orderRejection`.
  - Read `RejectCopy` in `RejectSheet.tsx` for the exact keys; pass only keys it declares.

- [ ] **Step 7: Copy, in all three files.** Add to the `forms` block of `en.ts`, `fr.ts` and `pt.ts`:

| key | en | fr | pt |
|---|---|---|---|
| `orderReject` | Reject order | Refuser la demande | Recusar o pedido |
| `orderUndoReject` | Undo rejection | Annuler le refus | Anular a recusa |
| `orderRejectedBanner` | Order rejected: {{reason}} | Demande refusée : {{reason}} | Pedido recusado: {{reason}} |
| `orderRejectTitle` | Reject this order | Refuser cette demande | Recusar este pedido |
| `orderRejectHint` | The reason is stored with the order and reaches the lab record. No result on this order is written. | Le motif est enregistré avec la demande et parvient au dossier du laboratoire. Aucun résultat de cette demande n'est écrit. | O motivo fica registado com o pedido e chega ao registo do laboratório. Nenhum resultado deste pedido é escrito. |
| `orderRejectAction` | Reject | Refuser | Recusar |
| `orderRejectNone` | No reasons are configured. | Aucun motif n'est configuré. | Nenhum motivo está configurado. |
| `orderRejectChoose` | Choose a reason first | Choisissez d'abord un motif | Escolha primeiro um motivo |
| `testsOrderRejected` | Order rejected | Demande refusée | Pedido recusado |

Match each file's existing terms for "order" and "reject". If `fr.ts` already says *commande* for the
Lab order, use *commande* in every fr string above; if `pt.ts` uses another word than *pedido*, follow
it. The i18n parity test (`i18n/parity.test.ts`) must pass.

- [ ] **Step 8: Run, expect PASS.** The three test files, then the parity test and the whole studio
  suite: `pnpm --filter @openldr/studio exec vitest run`. Then `pnpm --filter @openldr/studio typecheck`.
  Memory note: the studio suite has a known `vitest` dedupe flake. Re-run once before reading a
  failure as yours.

- [ ] **Step 9: Commit.**

```bash
git add apps/studio/src/forms-runtime/order-rejection-context.ts apps/studio/src/forms-runtime/FormRuntime.tsx apps/studio/src/forms-runtime/TestDetailsField.tsx apps/studio/src/pages/FormCapture.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/studio/src/forms-runtime/TestDetailsField.test.tsx apps/studio/src/forms-runtime/FormRuntime.test.tsx apps/studio/src/pages/FormCapture.test.tsx
git commit -m "feat(studio): reject a whole order from the capture page menu"
```

---

### Task 5: Docs in en, fr and pt

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/forms.md` (section "Results on the Lab order", about lines 231-241)
- Modify: `apps/studio/src/docs/0.1.8/fr/forms.md`, `apps/studio/src/docs/0.1.8/pt/forms.md` (the same section; pt line about 119)
- Modify: `apps/web/src/docs/0.1.8/forms.md` (about line 106)

- [ ] **Step 1: Rewrite the rejection paragraph** in the en studio doc. Replace the line beginning
  "A test can be rejected from its row menu" with:

```markdown
A test can be rejected from its row menu with a reason from a list. A rejected test is recorded with its reason.

The whole order can be rejected from the page menu, with **Reject order**. Pick a reason from the list. A line under the header then shows the reason, and every test row reads "Order rejected" and is closed for entry. Values already typed stay on the screen but are not written. **Undo rejection** in the same menu opens the rows again.

A rejected order is stored as revoked, with its reason. The reason reaches the lab record (the rejection code and reason on the order), so rejection reports count it. No result is written for a rejected order.

Each result written is linked to its order, so reports can join a result to the order it came from.
```

Keep the paragraph about one result record per value typed. Remove any sentence saying a rejection
does not appear in reports.

- [ ] **Step 2: The same change in fr and pt**, in each file's own words. Use the terms the i18n copy
  used in Task 4 Step 7. Keep the bold menu labels identical to the fr and pt menu strings.

- [ ] **Step 3: The web doc.** In `apps/web/src/docs/0.1.8/forms.md` line about 106, keep the sentence
  but add: "A rejected order is stored with its reason, which reaches the lab record. Each result is
  linked to its order."

- [ ] **Step 4: Check.** `pnpm --filter @openldr/studio exec vitest run src/docs` (docs validation and
  search tests) and `pnpm --filter @openldr/web exec vitest run` if the web app has docs tests. Grep the
  four files for the em dash character; expect none.

- [ ] **Step 5: Commit.**

```bash
git add apps/studio/src/docs/0.1.8/en/forms.md apps/studio/src/docs/0.1.8/fr/forms.md apps/studio/src/docs/0.1.8/pt/forms.md apps/web/src/docs/0.1.8/forms.md
git commit -m "docs: reject a whole order, and results linked to their order"
```

---

### Task 6 (controller): gate, live check, mobile, merge, changelog

- [ ] **Step 1: Full gate**, both halves forced, in this worktree:
  `pnpm turbo run test --force --concurrency=2 --continue` and
  `pnpm turbo run typecheck --force --concurrency=2`. Grep the output for `out of memory`,
  `VirtualAlloc` and `Test timed out` before reading a failure as a regression.
- [ ] **Step 2: Live check** on the dev API and studio (the main checkout serves them, so run this
  after merging to local `main`, or point a preview at this worktree's build). Scratch orders `ZZREJ-*`:
  - One order with results: every `lab_results` row has `request_id` = the order's `lab_requests.id`.
  - One rejected order: `lab_requests` has status `revoked`, with the code and the text. One
    `specimens` row has status `unsatisfactory`. There are no `lab_results` rows.
  - Undo rejection brings the typed values back.
  - Migration 110 ran on the dev DB: the stored Lab order holds `fld-ord-rejection`.
- [ ] **Step 3: 375px** with `resize_window`: the ⋯ menu, the reject sheet, the banner and the closed
  rows. Say that a real phone was not used.
- [ ] **Step 4: Merge** to local `main`. Push only when the operator asks. Then run `pnpm make:changelog`
  and commit `apps/web/src/landing/changelog.json`.

---

## Self-review

- Spec coverage:
  - Section 4 (`linkToOrder`, the route call) is Task 2.
  - Section 5 capture (the field, the menu, the banner, the closed rows) is Tasks 3 and 4.
  - Section 5 extraction (revoked, the extension, the Specimen type rule, no Observations) is Task 1.
  - Section 5 validation: the field passes through the existing `validateReferences`. Task 2's route
    test submits a real reason code; no extra code is needed.
  - Section 6, definition of done:
    - UI and i18n: Task 4.
    - Docs: Task 5.
    - Mobile, live check and changelog: Task 6.
    - No CLI (section 6 item 2).
  - Section 6 tests:
    - Extractors: Task 1.
    - `linkToOrder`: Task 2.
    - Route: Task 2.
    - Migration and pin: Task 3.
    - Studio: Task 4.
  - Spec section 6's "warehouse projection test" is already covered by
    `packages/db/src/relational/request-facts.test.ts:25-36`, which projects this exact extension
    shape. Task 2's route test pins that the submit emits that shape.
- Names used across tasks: `ORDER_REJECTION_PATH`, `ORDER_REJECTION_EXTENSION`,
  `orderRejectionFieldId`, `orderRejectionOf`, `readTestDetails`, `linkToOrder`,
  `LAB_ORDER_REJECTION_FIELDS_SNAPSHOT`, `LAB_ORDER_FORM_MIGRATION_ORDER_REJECTION`,
  `OrderRejectedContext`, the FormRuntime prop `orderRejection`, and the copy key `orderRejected`.
- Known judgment left to implementers:
  - the `ResultCoding` mapping in Task 1 Step 6;
  - the `validateCode` stub in Task 2 Step 6;
  - the fr and pt wording in Tasks 4 and 5.
  Each says what to do.
