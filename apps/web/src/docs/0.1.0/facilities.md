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
field names. A header you choose to map ends up in one of three places:

- **Mapped** to one contract field. Two headers can never map to the same field: the importer
  refuses rather than guess which one should win.
- **A fixed value (`constants`)**, for a contract field no column in the file carries at all. A
  national file usually has no `country` column, so `country` is normally supplied this way —
  the ISO alpha-3 code (`ZMB`, `TZA`, …), never a free-text label.
- **`extras`**, kept on the record but not treated as a contract field.

Not every header needs a decision. One left out of the map still claims its field on its own if
it already spells a contract field's name exactly (a **passthrough** column) — and one that
spells nothing on the contract is refused, unless `allowUnknownColumns` is set, which routes it
to `extras` the same way listing it there explicitly would.

For a CSV that refusal stops the whole file: an unknown header can shift every column after it, so
nothing is parsed and the run reports `blocked` with `blockedReason: "unknown-columns"`. The flag is
read by the parser, so it belongs to the upload, and a confirm carrying it is refused. A JSONL
release never blocks on this: each line names its own fields, and the flag is a documented no-op.

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
- **CLI:** put the CSV in the install directory's `data/` folder first, so the wrapper can
  see it.

  ```bash
  ./openldr facilities suggest-map data/national-facilities.csv
  ```

  This prints the suggested map as a table, flags any collision the suggestion itself would
  cause, and tells you how to feed the result back in:

  ```bash
  ./openldr facilities import data/national-facilities.csv \
    --national-system urn:zm:mfl --column-map data/mapped.json
  ```

`import` without `--apply` is always a dry run: it parses, validates, and reports — it writes
nothing. Add `--apply` once the preview looks right.

## Refusals, and how to repair them

An import whose column map has a problem writes nothing, and reports every problem at once so
one fix pass repairs the file:

| Reason | Meaning | Repair |
| --- | --- | --- |
| `duplicate_target` | Two headers claim the same contract field — by being mapped to it, **or just by spelling it** (a `Zone` column claims `zone` even when shown as `Not mapped`). | Keep one; set the other to `Not mapped`, which moves its values to `extras`. |
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

## Registering a facility by hand

Most facilities arrive by import. One can also be added from the Facilities page, and a facility that
exists in the national list should be registered as such rather than as a purely local one.

**Two codes, and they differ.** The **national code** is what the master facility list carries; the
**local code** is the site's own numbering. Both are optional, but at least one must be present. The
Facilities table shows the local code when there is one and falls back to the national code —
the same rule the rest of the system uses to give a facility its public code.

**The register decides the identity.** A facility's permanent id is derived from its facility
register plus its national code. Supply both and the facility is filed under exactly the identity a
CSV import of that register would give it, so a later import updates that row instead of creating a
second one. Leave the national code empty and the facility keeps a private id — correct for a site
that genuinely is not in the national list. The register must already exist on the install; an
unknown or deactivated one is refused.

**Neither is editable afterward.** The national code and the register are part of a facility's
identity, so they are fixed once it is created. Moving either would leave the row filed under an id
its own code no longer produces, and the next import would not find it. A facility created without a
national code cannot acquire one — delete it and register it again.

**Two fields are deliberately not required**, because no national register can be assumed to supply
them: the local code (an import never produces one) and the region (not every country has a tier
there). Editing an existing facility re-checks only the fields actually changed, so an imported
facility with a gap stays editable.

## Related

- [Load & push data](/docs/load-data)
- [CLI](/docs/cli)

## Deleting in bulk

`POST /api/facilities/bulk-delete` removes every facility a selection matches. The selection is the
same shape `GET /api/facilities` accepts, minus paging and sorting.

`expectedCount` is required and is the contract: the route re-resolves the selection and answers
409 unless it still matches exactly that many, so a set that moved between review and confirmation
deletes nothing. `POST /api/facilities/bulk-delete/preview` returns `total`, `inUse` (how many the
`facility_map` dimension points at, or `null` when the warehouse could not be reached) and a small
`sample` for the operator to recognise.

Two selections are refused outright rather than narrowed or widened: a `filters` string that does
not parse, and any selection carrying `health`, which is a join predicate the delete cannot express.
