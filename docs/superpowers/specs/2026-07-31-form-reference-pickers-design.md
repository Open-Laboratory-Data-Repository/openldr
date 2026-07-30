# Form reference pickers — design

**Date:** 2026-07-31
**Status:** Agreed, not implemented
**Scope:** Generic `reference` field resolution for the forms engine. Patient and Tests on the seeded Lab order form are the first consumers and the acceptance proof.

## Problem

`fieldType: 'reference'` renders a plain text `<Input>`. In `apps/studio/src/forms-runtime/FormRuntime.tsx` the `reference`, `facility`, `organism` and `antibiogram` cases share a branch the code labels "Stub types". Whatever the user types is accepted verbatim.

Nothing downstream catches it:

- `validate()` (`apps/studio/src/forms-runtime/runtime.ts`) checks required-presence, `number` parseability, cardinality and `select` option-membership. It has no `reference` branch, so any non-empty string satisfies `required`.
- `POST /api/forms/:id/responses` (`apps/server/src/forms-routes.ts`) zod-parses only the `{ answers }` envelope, then calls `toQuestionnaireResponse`. It never validates answers against the schema. `apps/server/src/forms-routes.test.ts` asserts that `answers: {}` returns **201** — a required field that is entirely absent is accepted today.
- `validateAnswers` (`packages/forms/src/validate-answers.ts`) is stricter but has no `reference` branch either, and is only reachable from the ingest workflow's Form Validate node via `packages/bootstrap/src/form-validate-service.ts`. The HTTP submit path does not call it.

The schema already carries an unconsumed reference vocabulary — `referenceTarget`, `referenceDisplayField`, `referenceValueField`, `referenceMultiple`, `referenceDependsOn`, `referenceSearchable` (`packages/forms/src/schema/form-schema.ts`), plus `valueSetUrl`, `bindingStrength` and `allowCustomValue`. These were ported from Corlix and nothing reads them at runtime.

On the seeded Lab order form (`packages/forms/src/samples/forms.ts`), `patient` is `reference`/`referenceTarget: 'Patient'` and `tests` is `reference`/`referenceTarget: 'ActivityDefinition'`, both `required: true`.

## What exists to build on

**Patients.** A `patients` read-model table (`packages/db/src/schema/external.ts`) with `id, patient_guid, surname, firstname, date_of_birth, sex, national_id, phone, email, managing_organization, active, replaced_by_id`. It lives in the analytics target store (`selectTargetStore`, `packages/bootstrap/src/target-store.ts`), which is Postgres by default but may be MSSQL or MySQL. It is a projection of the canonical versioned `fhir` schema in the internal DB. There is no patient search API.

**Terminology.** `GET /api/terminology/systems/:systemId/terms?q=` backs the existing `TermPicker` (`apps/studio/src/terminology/TermPicker.tsx`), which debounces at 200ms and emits `{ system, code, display }`. `GET /api/terminology/ValueSet/$expand` exists but takes only `count`/`offset` — no text filter, so it cannot back a type-ahead as-is. `GET /api/terminology/ValueSet/$validate-code` exists.

**Column policy.** `columnPolicy: ColumnPolicyStore` is on `AppContext` (`packages/bootstrap/src/index.ts`) with an in-memory cache, so Settings→Data Exposure is reachable from a route.

**Browser boundary.** Studio imports forms helpers from `@openldr/forms/pure` (`packages/forms/src/pure.ts`), which re-exports only Node-free modules. Anything the picker needs must be added there.

## Non-goals

- Wiring submit → `extractorsForForm` → `toTransactionBundle` → ingest. That machinery exists (`packages/forms/src/routing.ts`, `packages/forms/src/to-transaction-bundle.ts`) and is reachable only from the CLI (`packages/cli/src/forms.ts`). Wiring it to the web submit is separate work; this spec makes the pickers emit references that will resolve when it lands.
- Inline patient registration. The picker finds existing patients or nothing.
- Free-text fallback for unresolved references.
- Resolvers for `facility`, `organism`, `antibiogram`. They route through the new component only when their source resolves; otherwise they keep today's text input.
- Searching the canonical `fhir` schema directly for patients. That means JSON extraction over versioned resource bodies, engine-specific and slow without purpose-built indexes.

## Design

### 1. Source resolution

New module `packages/forms/src/reference-source.ts`, exported from `pure.ts`. Pure, never throws.

```ts
type ReferenceSource =
  | { kind: 'coding'; mode: 'valueset';   url: string }
  | { kind: 'coding'; mode: 'codesystem'; system: string }
  | { kind: 'entity'; target: string }

type ReferenceSourceResult =
  | { ok: true;  source: ReferenceSource }
  | { ok: false; reason: 'no-source' | 'unknown-target' | 'ambiguous' }
```

`resolveReferenceSource(field, registries)` resolves against two registries rather than inferring from string shape:

| Field state | Result |
|---|---|
| `valueSetUrl` set | `{ kind: 'coding', mode: 'valueset', url }` |
| `referenceTarget` resolves as a coding system | `{ kind: 'coding', mode: 'codesystem', system }` |
| `referenceTarget` names a registered entity | `{ kind: 'entity', target }` |
| both `valueSetUrl` and a resolvable `referenceTarget` | `valueSetUrl` wins; lint warns `ambiguous` |
| neither resolves | `{ ok: false }` |

A coding system identifier may be a system id (`cs-url-LOINC`) or a canonical URL (`http://loinc.org`) — `searchTerms` already resolves both, and `referenceTarget` follows that convention. **No new schema property is added.**

The entity registry is a plain list of target names (`['Patient']` in v1). Both registries live server-side and are authoritative there.

**The client does not resolve source kind.** It renders a picker and reacts to the `kind` the server returns in the response envelope. Its only local decision is the fallback in §6 — whether a field declares *any* source (`valueSetUrl` or `referenceTarget` present) — which needs no registry. This keeps the terminology-system list, which changes as systems are installed, out of the browser entirely.

### 2. Lint

`packages/forms/src/lint.ts` gains:

- **error** — a `reference` field whose source does not resolve. This is what stops a form reaching capture in the state Lab order is in today, and it gates publish (publish is already blocked on lint errors).
- **warning** — `ambiguous` (both `valueSetUrl` and a resolvable `referenceTarget`).
- **warning** — a `facility`/`organism`/`antibiogram` field with no resolvable source, noting it falls back to free text.

The seeded Lab order sample is corrected as part of this work: `tests` gains a resolvable source and `cardinality.max` changes from `'1'` to `'*'` (a lab order carries several tests). `patient` keeps `referenceTarget: 'Patient'`, which resolves against the entity registry unchanged.

### 3. Search endpoint

```
GET  /api/forms/:formId/fields/:fieldId/reference-search?q=&limit=&offset=
POST /api/forms/reference-search/preview      // body: { field }, capability: forms manage
```

The client never names a data source — it asks for "whatever field X is bound to", and the server reads the stored schema and derives the source itself. A client therefore cannot enumerate patients unless a published form declares a patient-bound field. The `preview` variant exists because the builder's live preview runs against an unsaved schema; it takes a field descriptor and is gated on the forms-manage capability.

Response envelope, kind-tagged:

```jsonc
{ "kind": "coding", "rows": [{ "system": "...", "code": "...", "display": "..." }], "total": 0 }
{ "kind": "entity", "rows": [{ "reference": "Patient/123", "display": "Doe Jane", "secondary": "1992-01-01 · F" }], "total": 0 }
```

`limit` defaults to 20, capped at 50. `q` shorter than 2 characters returns an empty result without touching a store.

**Coding resolver.** `valueset` mode calls `$expand`, which gains a `filter` query param (FHIR-standard, currently missing). `codesystem` mode reuses the existing term search.

**Entity resolver.** A registry `Record<string, EntitySearchResolver>`; v1 registers `Patient` only. It reads the `patients` projection over `surname`, `firstname`, `national_id`, `patient_guid`, `phone` and:

- filters `active = true AND replaced_by_id IS NULL`, so duplicates retired by the `mergePatients` cascade (`packages/bootstrap/src/patient-merge.ts`) cannot be selected;
- matches with `lower(col) LIKE lower(?)` via Kysely's `sql` template, which holds across Postgres, MySQL and MSSQL (`ilike` is Postgres-only);
- passes searched and returned columns through `columnPolicy` — a column marked hidden is neither searched nor included in `secondary`;
- builds `display` from `surname firstname` and `secondary` from the surviving subset of `date_of_birth · sex · national_id`.

Search reads the projection; integrity is checked against canonical at validation time (§5). A patient missing from a lagging projection is a UX annoyance, not a correctness failure.

### 4. Answer shape and serialization

```ts
type CodingAnswer = { system: string; code: string; display: string | null }
type EntityAnswer = { reference: string; display: string | null }
```

Multi-valued fields hold an array. `CodingAnswer` is already the shape `TermPicker` emits.

`toAnswer` / `fromAnswer` (`packages/forms/src/answer-value.ts`) change **only for object-shaped answers**, which are newly possible and can only be produced by a picker. `select` and `multiselect` keep emitting `valueCoding: { code }` with no system — deliberately out of scope, and their round-trip tests are untouched.

`toAnswer` dispatches on the answer's shape rather than on a resolved source, so the serializer stays pure and needs no registry. Every existing mapping is preserved exactly:

| Answer value | Serializes to |
|---|---|
| `{ system, code, display }` | `valueCoding: { system, code, display }` — new |
| `{ reference, display }` | `valueReference: { reference, display }` — new |
| bare string, `reference`/`facility` | `valueReference: { reference }` — unchanged |
| bare string, `organism`/`antibiogram` | `valueString` — unchanged |

The last row matters: `organism` and `antibiogram` currently fall through to `valueString`, and they get no resolver in v1, so they keep producing bare strings. Routing them into the reference family wholesale would have silently changed their serialization for fields this work does not otherwise touch.

`fromAnswer` reconstructs the object forms, returning `{ system, code, display }` for `valueCoding` and `{ reference, display }` for `valueReference`. Because `fromAnswer` is shared with `select`, it must keep returning a bare code string when `valueCoding` carries no `system` — that is the discriminator between a select answer and a coding-kind reference answer.

Retaining the legacy bare-string case means existing stored responses still decode.

### 5. Validation

**Capture.** The picker can only emit a resolved `CodingAnswer` or `EntityAnswer`. Typed text that matches nothing never becomes an answer; clearing sets the field to `undefined`.

**Client submit.** `validate()` in `apps/studio/src/forms-runtime/runtime.ts` gains a reference branch: a value must be an object of the expected kind. A bare string fails with "select a value from the list". Required and cardinality are already handled and need no change.

**Server (authoritative).** Split across two functions rather than one, to protect `validateAnswers`' purity:

- `validateAnswers` stays **pure and synchronous**. It gains only the shape check — a bare string, or an object missing `code`/`reference`, in a reference field is an error. Its signature and its existing caller (`packages/bootstrap/src/form-validate-service.ts`, the workflow Form Validate node) are unchanged.
- A new `validateReferences(model, answers, deps)` in `packages/forms/src/validate-references.ts` is **async and takes injected dependencies**. It performs the I/O-bound checks: coding answers via `$validate-code` against the field's `valueSetUrl` or system; entity answers via an existence check against the canonical `fhir` schema in the internal DB, not the projection. It returns the same `AnswerError[]` type.

Splitting them keeps `validateAnswers` free of a terminology client and a store handle — it is documented as pure, `pure.ts` re-exports it to the browser, and both properties are worth keeping. `validate-references.ts` is **not** added to `pure.ts`.

`POST /api/forms/:id/responses` **must start calling both**, which it does not do today — it calls neither. It runs `validateAnswers` first and returns 400 with the `AnswerError[]` list on failure, then `validateReferences` and returns 400 likewise. This is confined to the existing route and does not touch the deferred Bundle wiring.

**This intentionally breaks an existing test.** `apps/server/src/forms-routes.test.ts` asserts `answers: {}` → 201. That assertion encodes the bug; it is rewritten to expect 400 with a `required` error for each required field.

### 6. Studio component

`ReferencePicker` in `apps/studio/src/forms-runtime/`, generalising `TermPicker` (which stays where it is, serving the builder's terminology binding).

Keeps from `TermPicker`: 200ms debounce, outside-click dismissal, selected-state chip with a clear button, `TruncatedText` on long displays.

Adds:

- **multi** — chips when `referenceMultiple`, `repeatable`, or `cardinality.max !== '1'`; the input stays open for the next selection.
- **keyboard** — arrow up/down through results, enter to select, escape to dismiss. `TermPicker` has none of this today; it is an a11y gap and the new component should not inherit it.
- **states** — `Spinner` while in flight, `StripedEmpty` for no results, an inline error row when the search request fails, per house convention.
- **secondary line** — entity rows render `display` over a muted `secondary`, which is what makes two patients named "J Doe" distinguishable.

In `FormRuntime`, the stub branch is replaced: `reference` routes to `ReferencePicker` unconditionally; `facility`, `organism` and `antibiogram` route to it when `resolveReferenceSource` succeeds and otherwise keep today's text input. The branch shrinks without requiring three more resolvers now.

## Error handling

| Condition | Behaviour |
|---|---|
| Search request fails | Inline error row in the dropdown; the field keeps any existing selection; submit is not blocked by a failed *search* |
| Field source unresolvable at capture | Text input plus a form-level lint warning; publish already blocked by the lint error |
| `q` under 2 chars | Empty result, no store round-trip |
| Unknown `formId`/`fieldId` | 404 |
| Field resolves to no source (server) | 400 — a client asking to search an unbound field is a bug, not an empty result |
| Terminology unreachable during validation | 400 with a message naming the field; a coding that cannot be checked is not accepted |
| Canonical lookup finds no such entity | 400 naming the field |

## Testing

- **`resolveReferenceSource`** — table-driven over field permutations: valueSetUrl only, referenceTarget as system id, as canonical URL, as entity, both set, neither set, unknown target.
- **Patient resolver** — Postgres plus one other engine, to hold the portability line. Covers: match on each searched column, case-insensitivity, exclusion of `active = false` and `replaced_by_id IS NOT NULL`, limit cap, and hidden-column suppression via `columnPolicy`.
- **`toAnswer`/`fromAnswer`** — round-trip for both answer kinds and the legacy bare string; an explicit assertion that `select`/`multiselect` output is unchanged.
- **`validateAnswers`** — shape check only: bare string and malformed object in a reference field rejected; existing cases unchanged.
- **`validateReferences`** — valid coding, coding outside the ValueSet, valid entity, non-existent entity, terminology unreachable.
- **`ReferencePicker`** (RTL) — debounce coalescing, select, clear, multi chips, keyboard navigation, empty state, search-failure row.
- **Routes** — unknown field → 404, unresolvable source → 400, limit cap honoured, merged/inactive patients absent, preview requires the capability.
- **Regression** — the rewritten `answers: {}` → 400 assertion; `form-validate-service` needs no change and its existing tests must stay green as proof.
- **Sample** — the corrected Lab order sample passes lint, which `packages/forms/src/samples/forms.test.ts` already exercises.

## Consequences

- Form submission starts rejecting payloads it previously accepted. Any client posting directly to `/api/forms/:id/responses` with unresolved references will begin failing — intended, and the reason the lint error gates publish.
- Patient search depends on the projection being populated. On a fresh install with no ingested data the picker correctly finds nothing; there is no seeded patient fixture, and adding one is out of scope.
- `$expand` gains a `filter` param, which is FHIR-standard and additive.
