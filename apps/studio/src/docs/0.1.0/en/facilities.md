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

## The three steps of the import wizard

The import wizard has three steps, numbered at the top: Source, Mapping, and Review. Click a
step in that strip to move between them. There is no separate Back button.

- **Source.** Pick the file and the register it belongs to. If this install has no register yet,
  the button here reads Register a source instead of Continue.
- **Mapping.** Build or check the column map, and set any fixed values. See below.
- **Review.** Shows the validated summary, the value map for level, status, or country values
  that did not match, and the Confirm import button.

Each step shows one button, for the action that moves you forward. Every other action, including
Preview, the three re-upload options, Cancel, and Close, stays in the page's `⋯` menu.

You cannot click a step you have not reached yet, and you cannot go back to an earlier step while
a background check is running. After you upload a file on Mapping, the wizard moves you to Review
on its own as soon as the upload starts, before the check itself finishes. If the check finds a
problem with the column map, the wizard
sends you back to Mapping and shows the errors there, so you can fix the map in place.

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

> **Your column map is the decision about every column.** If you map five columns of twenty, the
> other fifteen are kept as extra data and the import proceeds. You are not asked about them and
> nothing is discarded: each row carries them in its extra data, which is also where "keep as extra
> data" puts a column you choose explicitly.
>
> **With no column map at all, an unrecognised column still stops the file.** Nothing has told the
> importer whether you wanted that column, and it will not guess, because a column silently dropped
> is worse than a file refused. Take the offered re-upload that keeps unrecognised columns as extra
> data. It has to be set before the file is read, so it cannot be added at the confirm step.
>
> A JSONL release never stops for this: each line names its own fields.

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
| `duplicate_target` | Two headers claim the same contract field. A header claims a field by being mapped to it, **or just by spelling it** — a column called `Zone` claims `zone` even when the panel shows it as `Not mapped`. | Decide which header is correct for that field, and set the other one to `Not mapped`, which keeps its values as extra data. |
| `constant_collision` | A fixed value and a mapped (or untouched, already-matching) header both claim the same field. | Keep only one of the two — either the fixed value or the column mapping — for that field. |
| `unknown_target` | A header is mapped to a name that is not one of the contract fields. | Fix the typo, or map it to extra data instead if it does not belong to the contract at all. |
| `missing_required` | `national_code` or `name` has neither a mapped column nor a fixed value. | Map a column, or supply a fixed value, for whichever required field is missing. |

> **A column that spells a contract field claims it.** A file with both `Province` and `Zone` is
> refused if you map `Province` to `zone`, because `Zone` already claims it by name. Set `Zone` to
> `Not mapped` to release the claim. Its values are kept as extra data, not dropped. The same
> applies to `Ownership`, `Ward`, `District`, `Latitude` and `Longitude`.

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

One control sits on its own row below the toolbar, because it is not an ordinary column:

- **Mapping health.** Whether a facility can be a mapping target, and whether anything maps to it
  yet. Mapped means at least one observed code already resolves to it. Unmapped means the facility
  is ready to be a target but nothing points to it yet. Unprojected means the facility has not
  reached the report-facing table yet, so it cannot be a mapping target at all. This state comes
  from a join across two other tables, not a stored column, so it keeps its own dropdown instead of
  joining the Filter list.

National system used to sit beside it as a second box. It is a Filter column now, listed as
National system, because it always filtered a stored column like every other filter. Filter gives
it operators the box did not have: the box matched the whole register URI exactly, and Filter's
"contains" matches part of one, so you can type `hfr` instead of the full
`urn:openldr:cs:facility-register:hfr`. Values stay free text rather than a picklist, because a
facility can carry a register code your install no longer lists as an active source, and a picklist
would hide those rows.

A filtered, sorted view is shareable. Filters and sorts show up in the page's own URL, so copying
the link and sending it to someone reopens the same view. Older links that used a single query
parameter, such as `?zone=Central`, still work.

In the studio, Filter and Sort can use these columns: code, name, region, district, status, source,
zone, council, country, level, ownership, managed origin, register state, and national system.

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

The CLI can also filter and sort by `id`, the one column the studio toolbar leaves out. `health`
has no `--where` form: it is worked out, not stored, so filter by it in the studio's Mapping health
dropdown instead. Use `facilitySystem` for the national system, the same column name the studio's
National system filter uses.

An unknown column, or an operator that column does not allow, is rejected with a message naming
what was wrong, the same validation the toolbar uses. A mistyped flag fails the same way a
mistyped filter would in the browser.

## Related guides

- [Terminology](/docs/terminology)
- [Audit](/docs/audit)

## Deleting facilities in bulk

The row menu deletes one facility. A national register runs to thousands, so a mis-mapped import
needs a way out that is not one row at a time. **Delete these facilities…** in the page's `⋯` menu
removes everything the table's current filter selects.

Read the confirmation before accepting it. It names three things, and each answers a different
question:

- **The count.** This is what the deletion is authorised against. If the selection changes between
  the confirmation and your click, the import is refused and nothing is deleted.
- **How many are used by reports.** Deleting those changes what reports show. If the warehouse
  cannot be reached the dialog says so rather than reporting zero.
- **A few facilities by name.** These are the only guard against a filter that selects rows you did
  not mean. If you do not recognise them, cancel and check the filter.

Filtering by mapping health is the one filter a bulk delete cannot use, so the action is unavailable
while that filter is on. Clear it and select by register or admin area instead.

From a terminal:

```
openldr facilities delete --where facilitySystem:eq:urn:zmb:mfl --force
```

`--force` is required. So is either a `--where` or an explicit `--all`: forgetting the filter must
never quietly mean the whole registry.
