# Mapping chunk 4: Number or text

Spec: `docs/superpowers/specs/2026-11-17-mapping-review.md`, findings 5b and 7d, and the agreed
rules for Result types and long whole numbers.
Branch: `fix/chunk4-number-or-text`, from main `e1996058`.

## What changes

1. **A Number or text rule.** A new rule kind, `numberOrText`, with a decimal mark, picked on
   **Result (number)**. A value the Number rule reads, with or without a comparator, is stored as a
   number with its comparator. Anything else is stored as text, exactly as sent, comparator included,
   in the record's text result (`Observation.valueString`). Nothing is changed or dropped and the row
   is not held. A whole number too long to hold exactly is stored as text with every digit.
   A unit goes with a number only: a text result drops the unit and notes it, as today.
   Number alone stays strict and still holds the row.
   The text field is found from FHIR, not hard-coded: the sibling `valueString` of a `valueQuantity.value`
   key (`textKeyOf` in `packages/forms/src/map/apply.ts`). A rule on a field with no text form is refused.
   If the same row also maps **Result (text)**, a record that gets both is held, as today.
2. **Studio.** The rule list shows **Number or text** only on a field that has a text form. It starts
   with the sample's decimal mark, like Number. Labels in en, fr and pt.
3. **No suggestion that gives a record two result values (7d).** A result field (`value[x]`, or a
   Quantity's `value`) shows no suggestion while another result field of the same record has a column.

## Tests first

- `apply.test.ts`: titres `1:320`, `≥1:1280`, `<0,01`, `≥ 200` with Number or text and a comma give
  text, text, `<` 0.01, `>=` 200; a 19-digit whole number is text with every digit; a unit beside
  a text result is dropped and noted; a field with no text form is refused; Number alone still holds.
- `rules.test.ts`: the schema accepts `numberOrText`.
- `rows.test.ts` / sheet test: the rule round-trips; the kind shows on Result (number) and not on
  Patient ID; it starts with the sample's decimal mark; a Result (text) column hides the
  Result (number) suggestion.

## Done means

- Full gate with `OPENLDR_SKIP_ENV_FILE=true`, server lint.
- In-app and web Map to FHIR docs in en, fr and pt.
- Phone width check of the rule select. Demo retest on 3991 with `claude-titres`.
- Codex review on the relay. Changelog after merge.

Not in this chunk: suggestions on nested names, ties and full names (chunk 5).
