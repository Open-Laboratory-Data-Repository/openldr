# Chunk 8: two faults from the real-environment test of 2026-11-18

Branch `fix/chunk8-patient-ref-and-order-text`, from main `8b768f22`. Findings and diagnosis are in
the test log `real-test-2026-11-18.md` (shared notes folder). Operator decisions, 2026-11-18:
"Fix F1 now" and, for F2, "Carry the result text".

## F1: workflow-stored patients will not open

- Cause: `apps/server/src/app.ts` set no `maxParamLength`, so Fastify's default of 100 applied. A Map to
  FHIR patient id is a 64-character hash (`map-to-fhir-service.ts:87`); its sealed ref is 123 characters
  (`patient-mask.ts`), so `/api/patients/:ref` never matched and the server answered its generic 404.
- Fix: `maxParamLength: 256` in the Fastify options. A FHIR id is at most 64 characters, so a ref is at
  most 123.
- Test: `app.test.ts` builds the real app and asks for `/api/patients/<123 characters>`. Before, the
  answer was the generic `{"error":"not found"}`; after, it matches a 60-character ref's answer.

## F2: Orders by Test leaves out workflow orders

- Cause: an order's code derived from its results (`target.derived`) copied codings without text or
  display (`codingsAt` in `packages/forms/src/map/apply.ts`). The warehouse's `panel_desc` reads text or
  the first display (`relational/extract.ts:29`), so it stayed null, and the chart counts only orders with
  a `panel_desc`.
- Fix: `codingsAt` keeps a coding's own display, or else the result code's text. A lab's own code is
  written `{ text, coding: [{ code }] }`, so each derived coding now has `display` = the name sent.
  Code-list codings without text are unchanged.
- Test: `targets.test.ts`, two results with the lab's own codes give the order
  `{ coding: [{ code: 'TA', display: 'TA' }, { code: 'TB', display: 'TB' }] }`.
- Not changed: an order with no ordered date mapped still has no `authored_at`, so date-filtered charts
  and the patient list's Last request skip it. No date is invented.

## Done means

Full gate, server lint, docs en/fr/pt (map-to-fhir: derived codes keep the lab's test name), recheck on
the running dev stack after merge (open the workflow patient; Orders by Test), Codex review, changelog.
