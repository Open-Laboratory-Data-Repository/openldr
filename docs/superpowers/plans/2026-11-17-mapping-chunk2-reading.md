# Mapping chunk 2: reading values and naming list entries

Spec: `docs/superpowers/specs/2026-11-17-mapping-review.md`, findings 3, 4, 5b (list errors) and 8f.
Branch: `fix/chunk2-reading`, from main `6268570d`.

## What changes

1. **Unicode comparators.** `≤` and `≥` read as `<=` and `>=` before a number.
   The stored comparator is the FHIR code, never the character.
   Where: `packages/forms/src/map/apply.ts`, the `COMPARATOR` pattern.
2. **List entry in errors.** When a value comes from a list column, such as `results.value`,
   a failure on one entry says which: `(entry 2 of 4)`. A writer failure also names the column:
   `(results.value, entry 2 of 4)`. Never the value. Reasons for separate columns stay as they are,
   because the column name already says which.
   Where: `resolveRow` and `fill` in `apply.ts`.
3. **Repeated test reason.** Two results with one id name both entries, or both columns, and
   say which unmapped optional identity field would tell them apart, such as **Result date**.
   It reads the optional parts from the target's identity, so no field name is hard-coded.
   The whole row is still held.
4. **Number rule decimal mark from the sample.** Picking **Number** by hand takes the decimal
   mark the sample shows. A comma only in the examples gives a comma. No evidence, or both marks,
   keeps the point. The editor already shows the mark, so it stays visible and editable.
   The comma suggestion also reads past a leading comparator, so `≤0,5` counts as evidence.
   Where: `apps/studio/src/workflows/components/map/ruleSuggest.ts`, `MapToFhirSheet.tsx`.

## Tests first

- `apply.test.ts`: `≤ 0,5` and `≥12,5` give `<=` and `>=`; a list entry failing the Number rule
  says `entry 2 of 3` and not the value; a writer failure on a list entry names the column and entry;
  two list entries with one test name `entries 1 and 3 of 3` and suggest the date label;
  two columns with one test name both columns.
- `ruleSuggest.test.ts`: `decimalMarkOf` for comma, point, mixed, none, and comparators.
- `MapToFhirSheet.test.tsx`: picking Number on a comma sample selects the comma.

## Done means

- Full gate with `OPENLDR_SKIP_ENV_FILE=true`, server lint.
- In-app and web Map to FHIR docs in en, fr and pt.
- Retest on the 3991 demo with `claude-titres` and `claude-repeat-test`.
- Codex review on the relay. Changelog after merge.

Not in this chunk: Number or text (chunk 4), suggestions (chunk 5), run screens (chunk 3).
