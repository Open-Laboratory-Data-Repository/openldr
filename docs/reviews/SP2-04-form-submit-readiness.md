# SP2-04: form submission readiness

## Approved scope

The operator approved submission eligibility before data entry and readable validation labels.
Publishing remains available for export, sharing, and embedded editors. No generic response store was added.

Plan: check the extractor contract, add failing regressions, share eligibility with both UI pages,
replace field IDs in validation, then document a supported submission in English, French, and Portuguese.

## Source proof

The gap would be refuted if capture already checked extraction before rendering inputs.
Before this change, FormCapture checked only publication. The server separately rejects zero extracted
resources at `apps/server/src/forms-routes.ts:381`.

- `packages/forms/src/routing.ts:42` selects the extractors used by the server.
- `packages/forms/src/routing.ts:51` now exposes configuration eligibility through those extractors.
- `packages/forms/src/extract/extract.ts:63` shares the Observation flag/code check with extraction.
- `apps/studio/src/pages/FormCapture.tsx:57` gates entry and submission on eligibility.
- `apps/studio/src/forms-runtime/runtime.ts:56` uses the visible label in required-field errors.
- Server answer and reference validation remain at `apps/server/src/forms-routes.ts:351` and `:357`.

## Changes

The builder and capture page show translated submission guidance. Unsupported capture hides its inputs
and disables Submit. Supported forms retain the existing capture flow. Publication is not blocked.
Observation eligibility excludes disabled fields, disabled ancestor groups, and group containers.
The ServiceRequest extractor keeps its existing behavior.

Required, numeric, cardinality, and option errors use field labels. Error keys remain field IDs so each
message still attaches to the correct input. Reference-list validation is unchanged.

Studio has the submission guide in all three languages. The public Forms guide includes all three
languages and appears in documentation navigation. Its example creates a ServiceRequest form using
an existing patient and loaded LOINC terminology.

## Verification

Red tests first:

- Eligibility: 8 failures because the helper was absent.
- Runtime and capture: 4 failures, including opaque required-field labels and absent readiness guidance.
- Builder: absent readiness guidance failed before its implementation.
- Disabled ancestor group: expected false, received true; then corrected.

Commands and observed output:

| Command | Output | Layer |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | exit 0 | Locked dependencies |
| `pnpm --filter @openldr/forms test src/submission-readiness.test.ts src/routing.test.ts src/extraction.test.ts` | 28 passed | Pure eligibility, routing, extraction |
| `pnpm --filter @openldr/studio test src/forms-runtime/runtime.test.ts src/forms-runtime/FormRuntime.test.tsx src/pages/FormCapture.test.tsx src/forms-builder/FormBuilderPage.test.tsx src/i18n/parity.test.ts src/docs/registry.test.ts` | 89 passed | UI behavior in jsdom, translation keys, docs discovery |
| `pnpm --filter @openldr/server test src/forms-routes.test.ts` | 37 passed | HTTP route contract with test dependencies |
| `pnpm --filter @openldr/forms typecheck` | exit 0 | Forms TypeScript |
| `pnpm --filter @openldr/studio typecheck` | exit 0 | Studio TypeScript |
| `git diff --check` | exit 0 | Patch whitespace |
| `pnpm --filter @openldr/web test src/docs/DocsPage.test.tsx` | 15 passed | Public documentation shell |

Existing React Router warnings and jsdom's export-navigation warning appeared in UI tests.
The route suite reported Node's experimental WASI warning.

## Limits and excluded work

HONEST NON-PROOF: eligibility does not guarantee that particular answers extract a resource.
Conditional or empty observation answers may still yield none. Server validation remains authoritative.
The ingest workflow can be missing, disabled, or fail after partial persistence.

HONEST NON-PROOF: these tests do not submit to a running database or establish clinical validity.
The browser preview uses synthetic responses and refuses all writes. Mobile inspection is recorded
by the parent task. No bottom-anchored layout changed; a real phone remains necessary for browser-chrome behavior.

There is no new administrative operation, so no new CLI command is needed. Shared extraction behavior
remains in the forms package. No commits, merge, push, or live writes were performed.
The changelog generator is deferred until an authorized merge to main, as AGENTS.md requires.

Observed but excluded: `extractionContextFor` only reads `ServiceRequest.subject`
(`apps/server/src/forms-routes.ts:39`). Mapping `Observation.subject` does not populate that context.
The documented example therefore uses ServiceRequest.



## Independent review

The reviewer reran 28 forms tests and 14 capture/runtime tests. All passed.
The parent inspected the synthetic preview at 375 by 812 pixels. Unsupported forms showed
no entry fields and disabled Submit. A supported form showed its input and the readable
required-field message. Document width remained 375 pixels. No database write was attempted.
The temporary preview config was removed. Preview session 31287 was no longer addressable.
