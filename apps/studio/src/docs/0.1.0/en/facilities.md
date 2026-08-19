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

You do not have to decide every header. Leave one untouched and it still claims its field on its
own, as long as it already spells a contract field's name exactly — the parser calls this a
**passthrough** column. An untouched header that spells nothing on the contract is refused, unless
you turn on **Allow unrecognized columns**, which carries it into `extras` the same way choosing
"keep as extra data" does.

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

## Registering a facility by hand

Most facilities arrive by import. You can also add one from the Facilities page, and a facility that
exists in your national list should be registered as such rather than as a purely local one.

### The two codes

A facility row has room for two codes, and they are not the same thing:

- **National code** — the code your national or master facility list carries. Optional, because a
  lab-only site has none.
- **Local code** — your own numbering, whatever your LIS calls the site. Also optional.

At least one of the two must be present. The Facilities table's CODE column shows the local code when
there is one and falls back to the national code otherwise, which is the same rule the rest of the
system uses to give a facility its public code.

### Why the register matters

A facility's permanent id is derived from its **facility register plus its national code**. Supply
both and the facility is filed under exactly the identity a CSV import of that register would give
it, so a later import of the same list updates your row instead of creating a second one.

Leave the national code empty and the facility keeps a private id. That is correct for a site that
genuinely is not in the national list.

The register must already exist on this install. An unknown or deactivated one is refused, with a
message naming which. Registers are the same list the import wizard offers.

### What you cannot change afterward

**The national code and the facility register are fixed once the facility is created.** They are part
of its identity, not ordinary fields — moving either one would leave the row filed under an id its
own code no longer produces, and the next import of that register would not find it.

So a facility created without a national code cannot acquire one later. If you need to add one,
delete the facility and register it again.

### Required fields

The form's required markers are enforced when you save, and the server enforces them too.

Two fields are deliberately **not** required, because no national register can be assumed to supply
them: the local code (an import never produces one) and the region (not every country has a tier
there — Zambia's list has nothing between Province and District). When you edit an existing facility,
only the fields you actually change are re-checked, so an imported facility with a gap in it stays
editable.

## Filtering, sorting, and search

The Facilities table uses the same toolbar as Audit: a search box, and Filter, Sort, Columns, and
Reset buttons.

- Search checks name, code, region, district, and council, on the server, in one request. It
  matches text in any of those five columns, even ones the table is not currently showing.
- Filter adds a rule: pick a column, an operator, and a value. You can add more than one rule.
- Sort orders the table by any sortable column, ascending or descending.
- Columns shows or hides columns.
- Reset clears every filter, sort, search term, and column choice, and returns the table to its
  defaults. It only appears once you have applied a filter or a sort. Each control also clears on
  its own, so you can undo one thing without undoing the rest.

Active filters show as removable chips under the toolbar.

Two controls sit on their own row below the toolbar, because they are not ordinary columns:

- **Mapping health.** Whether a facility can be a mapping target, and whether anything maps to it
  yet. Mapped means at least one observed code already resolves to it. Unmapped means the facility
  is ready to be a target but nothing points to it yet. Unprojected means the facility has not
  reached the report-facing table yet, so it cannot be a mapping target at all. This state comes
  from a join across two other tables, not a stored column, so it keeps its own dropdown instead of
  joining the Filter list.
- **National system.** A free-text box matching the register a facility was imported from. Free
  text, because a facility can carry a register code your install no longer lists as an active
  source.

A filtered, sorted view is shareable. Filters and sorts show up in the page's own URL, so copying
the link and sending it to someone reopens the same view. Older links that used a single query
parameter, such as `?zone=Central`, still work.

In the studio, Filter and Sort can use these columns: code, name, region, district, status, source,
zone, council, country, level, ownership, managed origin, and register state.

### Two things worth knowing

Search checks every row directly instead of using an index. On a large national register this can
take longer than filtering by an exact column value. If a search feels slow, narrow first with
Filter, then search within the smaller result.

The table's default order and an explicit sort by name can put names in a different order. They
compare case and accented letters by different rules. If a report depends on a specific order,
apply an explicit sort instead of relying on the default view.

## Command line: listing facilities

`openldr facilities list` supports the same filter and sort grammar as the toolbar, so a script can
reproduce any view built in the browser.

- `--where column:operator:value`. Repeatable. Only the first two colons are delimiters, so a value
  can itself contain a colon.
- `--sort column` sorts ascending. `--sort -column`, with a leading dash, sorts descending.
  Repeatable.
- `--limit <n>` caps how many rows come back. Without it, the command returns at most 200 rows. The
  table view's last line says how many of the total you are seeing. With `--json`, the total
  travels in the payload instead, and no such line prints.
- `--json` prints machine-readable output instead of a table.

```bash
openldr facilities list --sort -name --limit 10
```

This lists the last ten facilities by name, Z to A. It applies no filter, so it returns rows
wherever the register has any.

```bash
openldr facilities list --where level:eq:hospital --sort -name
```

This lists facilities whose level column matches "hospital" exactly, sorted by name from Z to A.
`eq` needs an exact match, and it is case sensitive, so check your own register's actual level
values first. Registers often store values like "Health Post", "Health Centre" or "1st Level
Hospital", and a value that does not match exactly returns nothing.

The CLI can also filter and sort by `id` and `facilitySystem` (the national system code), two
columns the studio toolbar leaves out because `facilitySystem` already has its own text box there.
`health` has no `--where` form: it is worked out, not stored, so filter by it in the studio's
Mapping health dropdown instead.

An unknown column, or an operator that column does not allow, is rejected with a message naming
what was wrong, the same validation the toolbar uses. A mistyped flag fails the same way a
mistyped filter would in the browser.

## Related guides

- [Terminology](/docs/terminology)
- [Audit](/docs/audit)
