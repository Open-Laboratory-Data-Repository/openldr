# Facilities

The Facilities register is OpenLDR's master facility list — every site a result can be
attributed to. Most national registers do not already spell their columns and vocabulary the
way OpenLDR expects, so importing one means mapping the file's own headers and values onto
OpenLDR's import contract first.

## The import contract

Every import — from the Studio wizard or the CLI — targets the same fixed set of fields:
`national_code` and `name` (required), plus `level`, `ownership`, `status`, `country`, `zone`,
`region`, `district`, `council`, `ward`, `village`, `address`, `phone`, `latitude`, and
`longitude` (optional). A national file's headers rarely match these names exactly — a Zambian
export might call the code column `MFL Code` and the region column `Province`.

## What a column map is

A **column map** is the translation from a file's own headers to the contract above. Its keys
are **the file's own header text, exactly as it appears in the file** — never the contract's
field names. Every header ends up in one of three places:

- **Mapped** to one contract field. Two headers can never map to the same field: the importer
  refuses rather than guess which one should win.
- **A fixed value (`constants`)**, for a contract field no column in the file carries at all. A
  national file usually has no `country` column, so `country` is normally supplied this way —
  the ISO alpha-3 code (`ZMB`, `TZA`, …), never a free-text label.
- **`extras`**, kept on the record but not treated as a contract field.

```json
{
  "columns": { "MFL Code": "national_code", "Name": "name", "Province": "region" },
  "constants": { "country": "ZMB" },
  "extras": ["DHIS2 UID", "Hims code"]
}
```

## Getting a suggested map

Both surfaces can propose a map from a file's headers offline, with no server round trip:

- **Studio wizard:** open **Facilities → Import**, choose the file, and the column-mapping step
  opens with a suggestion already filled in. A **Check this** badge marks a row worth reviewing
  before you continue.
- **CLI:**

  ```bash
  pnpm openldr facilities suggest-map national-facilities.csv
  ```

  This prints the suggested map as a table, flags any collision the suggestion itself would
  cause, and tells you how to feed the result back in:

  ```bash
  pnpm openldr facilities import national-facilities.csv \
    --national-system urn:zm:mfl --column-map mapped.json
  ```

`import` without `--apply` is always a dry run: it parses, validates, and reports — it writes
nothing. Add `--apply` once the preview looks right.

## Refusals, and how to repair them

An import whose column map has a problem writes nothing, and reports every problem at once so
one fix pass repairs the file:

| Reason | Meaning | Repair |
| --- | --- | --- |
| `duplicate_target` | Two headers map to the same contract field. | Keep one mapping; move the other header to a fixed value or `extras`. |
| `constant_collision` | A fixed value and a mapped (or already-matching) header both claim the same field. | Keep only the fixed value or the column mapping for that field, not both. |
| `unknown_target` | A header maps to a name outside the contract. | Fix the target name, or route it to `extras` if it truly does not belong. |
| `missing_required` | `national_code` or `name` has neither a column nor a fixed value. | Map a column, or add a `constants` entry, for the missing required field. |

> **The real-file trap.** A national export commonly carries near-duplicate headers — both
> `Province` and `Zone`, both `Ownership` and `Ownership type`. Map each pair onto **different**
> contract fields (or send the extra one to `extras`); mapping both to the same field is exactly
> what `duplicate_target` exists to catch.

## Columns vs. values

A column map and a value map solve different problems, and behave differently when incomplete:

- **An unmapped required column blocks the whole import.** `national_code` and `name` must
  resolve from somewhere before any record is written.
- **An unmapped value imports anyway.** If a controlled field (`level`, `status`, `country`)
  contains a raw value your value set does not recognize, the row still imports with that raw
  text, and the value is reported so it can be mapped afterward — nothing blocks on it.

## Related

- [Load & push data](/docs/load-data)
- [CLI](/docs/cli)
