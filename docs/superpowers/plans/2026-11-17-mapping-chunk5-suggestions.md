# Mapping chunk 5: suggestions

Spec: `docs/superpowers/specs/2026-11-17-mapping-review.md`, findings 7a, 7b and 7c.
Branch: `fix/chunk5-suggestions`, from main `46f2ce06`.

## What was checked

Run against the real Lab result target and the English synonyms (`suggest`, `mapSynonyms`):

- 7a: `patient.dob` and `patient.mrn` both score 0.737 for Patient ID. The first in the list wins,
  so with `patient.dob` first, Patient ID is offered the birth date.
- 7b: `name` scores 0.857 for First name and for Last name; the order picks First name.
  `fullname` scores 0.727 for Last name alone, so a tie rule is not enough by itself.
- 7c: `results.analyte` gets no suggestion; bare `analyte` gets Test at 1.0. The same holds for
  `patient.surname`, `patient.given` and `patient.sex`.

## What changes (`packages/forms/src/map/suggest.ts`)

1. **Nested names.** A column with a dot is also read by its last part: `patient.dob` is matched
   as `patient.dob` and as `dob`, and keeps the better score.
2. **Abstain on a tie.** When a target field's best score is shared by two columns, that field gets
   no suggestion. When a column's best score is shared by two target fields, that column is not
   suggested. The rest still match.
3. **No full name as a name part.** The synonym files may list, under `!<target path>`, column names
   that must not be suggested for that field. A column that looks at least as much like one of them
   as like the field is skipped. The lists name full-name columns for First name and Last name in
   en, fr and pt. Content, not code: column names only.

## Tests first (`suggest.test.ts`)

- `patient.dob` and `patient.mrn` give Patient ID to `patient.mrn` and Date of birth to `patient.dob`,
  in either order.
- Two columns with the same best score for one field give that field nothing.
- `name`, `full_name` and `fullname` are never offered as First name or Last name; `first_name` still is.
- `results.analyte` is offered as Test.

## Done means

- Full gate with `OPENLDR_SKIP_ENV_FILE=true`, server lint.
- In-app and web Map to FHIR docs in en, fr and pt.
- Demo retest on 3991 with `claude-titres` and `claude-repeat-test` suggestions.
- Codex review on the relay. Changelog after merge.
