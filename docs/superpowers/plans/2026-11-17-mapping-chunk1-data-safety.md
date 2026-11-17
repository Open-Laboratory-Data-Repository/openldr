# Mapping chunk 1: data safety

Spec: `docs/superpowers/specs/2026-11-17-mapping-review.md` (agreed by operator, Claude, Codex).
Branch: `fix/chunk1-data-safety`, from main `93f61dc8`. Codex reviews before chunk 2 starts.

## Goal

No lab data is lost or changed without a word, and copying a workflow never stops another one.

## What changes

1. **Exact long whole numbers at the webhook.** A JSON whole number outside the safe range
   (above 9007199254740991 or below its negative) is read as its exact digits, as text. Smaller
   integers and every decimal stay numbers. The run's webhook input gets `notes` naming each field,
   for example `specimen_no: a whole number too long to keep exactly was kept as text. Send it in
   quotes.` Done by quoting the long tokens in the JSON text before the normal parse, so it works on
   Node 20 as well as the Node 22 the images ship. Only the webhook's JSON uses it.
   - `packages/workflows/src/exact-json.ts`: `parseJsonKeepingLongIntegers(text) → { value, keptAsText: string[] }`.
   - `apps/server/src/workflows-routes.ts`: the webhook routes move into a scope with this JSON parser.
2. **Strict Number never rounds.** `packages/forms/src/map/write.ts` (number leaf) and the Number
   rule (`rules.ts`) refuse a whole-number text outside the safe range: "has more digits than a
   number can hold exactly". Text fields keep the digits as they are.
3. **A webhook path belongs to one enabled workflow.** `POST /api/workflows` and
   `PUT /api/workflows/:id` refuse, with 409, an enabled workflow whose webhook path another enabled
   workflow uses, naming that workflow. Covers duplicate, import and save. A disabled workflow may
   share the path.
   - `packages/workflows/src/shared-webhook-resolver.ts`: `findWebhookPathClaims(...)`.
4. **Duplicate on the server.** `POST /api/workflows/:id/duplicate` makes the copy disabled, with
   a fresh webhook secret, and seals every other secret again under the copy's own id, so deleting
   the original no longer breaks the copy (today the copy points at the original's sealed secrets).
   The Workflows list calls it. Audit `workflow.duplicate`.
   - `packages/bootstrap/src/workflow-duplicate.ts`: `duplicateWorkflow(...)`.
5. **The shared review file** moves from the repo root to
   `docs/superpowers/specs/2026-11-17-mapping-review.md` (chunk 0 finding C0-4).

## Not in this chunk

- Entry positions in list errors (chunk 2). The Number refusal names the field only for now.
- Long decimals.
- CLI: there is no CLI command that creates or duplicates workflows, so no parity work.

## Tests

- exact-json: long positive and negative integers become exact text; safe integers, decimals,
  exponents within range, numbers inside strings, escaped quotes, nested arrays all unchanged;
  `keptAsText` names the key; invalid JSON still fails as JSON.
- Webhook route: a long integer reaches `receipts.accept` as exact text with a note; a short body
  has no `notes`.
- write and Number rule: `"4471200000000000123"` to a number field fails with the reason; a safe
  integer and a decimal still pass; a text field keeps the digits.
- Path claims: create and update refuse 409 naming the other enabled workflow; a disabled one may
  share; updating a workflow does not clash with itself.
- Duplicate: the copy is disabled, its webhook secret differs, other secrets resolve to the same
  plaintext under new ids owned by the copy, deleting the original leaves the copy's secrets.

## Done means

Full gate (tests and typecheck, `--force --concurrency=2`), server lint, docs in en, fr and pt
(Workflows guide: duplicate and path rule; Map to FHIR guide: long numbers), a build on the 3991 demo,
and a screen retest of `claude-shared-path` and `claude-batch-numbers`. Then Codex reviews.
