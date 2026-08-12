# Facilities

The Facilities page holds your master facility list — every site a result can be attributed to —
and the tools to import one from a national register whose file does not already match OpenLDR's
own column names.

## Outcome

You can import a national facility list whose column headers and vocabulary do not match OpenLDR's
own, using a column map and a value map, from either the import wizard or the `openldr` CLI.

## Before you begin

- Know which national register the file belongs to (its canonical URI, e.g. `urn:zm:mfl`) — every
  imported row's permanent id is derived from this plus the file's own code column, so the same
  register must always be named the same way.
- Have the source file open somewhere so you can compare its header row to the contract fields below.

## What a column map is

OpenLDR's import contract has a fixed set of fields: `national_code` and `name` (required), plus
`level`, `ownership`, `status`, `country`, `zone`, `region`, `district`, `council`, `ward`, `village`,
`address`, `phone`, `latitude`, and `longitude` (optional). A national file almost never spells its
columns this way — it might call the code column `MFL Code`, or the region column `Province`.

A **column map** is the translation between the two. Its keys are **the file's own headers, exactly
as they appear in the file** — not the contract's names. For every header you have three choices:

- **Map it** to one contract field. Two headers can never map to the same field — the parser cannot
  guess which one should win, so it refuses instead of guessing.
- **Give it a fixed value.** Use this when the contract needs a field the file has no column for at
  all — a national file rarely carries its own country, for example, so `country` is usually a fixed
  value (`ZMB`, `TZA`, …) rather than a mapped column. Fixed values are the ISO code, never a label
  someone typed by hand.
- **Keep it as extra data.** The column still gets imported — carried into the record's `extras` —
  but it is not treated as one of the contract fields.

Every header in the file has to land in one of those three places before an import can run.

## How to get a suggested map

You rarely have to build a column map by hand. Both the wizard and the CLI can look at a file's
headers and propose a map offline, with no server round trip:

- **In the wizard:** open **Facilities**, choose **Import**, and select the file. The column-mapping
  step opens with a suggested map already filled in — a checkmark next to a row means the suggestion
  is confident, and a **Check this** badge means it should be reviewed before you continue.
- **From the CLI:** run `openldr facilities suggest-map <path>`. It prints the same suggested map as
  a table, flags any collision the suggestion itself would cause, and tells you how to feed the
  result back in: `openldr facilities import <path> --column-map <file.json>`.

Either way, review the suggestion — it is a starting point, not an answer you can skip checking.

## Refusals, and how to repair them

An import with column-map problems writes nothing. Every problem is reported at once, so one fix
pass repairs the file, rather than discovering issues one at a time. Four things can go wrong:

| Reason | What it means | How to repair it |
|---|---|---|
| `duplicate_target` | Two headers map to the same contract field. | Decide which header is correct for that field and move the other one to a fixed value or extra data. |
| `constant_collision` | A fixed value and a mapped (or untouched, already-matching) header both claim the same field. | Keep only one of the two — either the fixed value or the column mapping — for that field. |
| `unknown_target` | A header is mapped to a name that is not one of the contract fields. | Fix the typo, or map it to extra data instead if it does not belong to the contract at all. |
| `missing_required` | `national_code` or `name` has neither a mapped column nor a fixed value. | Map a column, or supply a fixed value, for whichever required field is missing. |

## The distinction that trips people up

A column map decides where each **column** goes. A value map decides what each **value** in a
controlled field (`level`, `status`, `country`) means. The two behave very differently when they are
incomplete:

- **An unmapped value imports anyway.** If a file spells a facility level as `"Health Centre"` and
  your value set does not recognize that exact spelling, the row still imports — the raw text is
  kept — and the value is reported so you can map it later. Nothing blocks on this.
- **An unmapped required column blocks the whole import.** If `national_code` or `name` has nowhere
  to come from, the parser refuses to guess, and no records are written until you fix the map.

In short: a column problem stops the import before it starts; a value problem is recorded and can be
cleaned up afterward.

## Related guides

- [Terminology](/docs/terminology)
- [Audit](/docs/audit)
