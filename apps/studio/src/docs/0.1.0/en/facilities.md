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

## The four steps of the import wizard

The import wizard has four steps, numbered at the top: Source, Data, Mapping, and Review. Click a
step in that strip to move between them. There is no separate Back button.

- **Source.** Pick the file and the register it belongs to. If this install has no register yet,
  the button here reads Register a source instead of Continue. Leaving Source uploads the file.
  The file is stored, not checked, because no column map exists yet.
- **Data.** Shows the stored file as a table, read only. Nothing on this step can be edited. The
  table is paged from the server, one page at a time, and it works the same way for a CSV file and
  a JSONL release. Continue moves on to Mapping. It sends nothing: the file is already stored.
- **Mapping.** Every decision lives here: the column map, fixed values, what to do with conflicts,
  absences and deletions, and which of the register's own words map onto the vocabulary. Each row
  also carries its own status icon, described below, for a quick check of one column. Its main
  action, Validate all, runs the first full check against the file already stored at Source. It
  does not send the file a second time.
- **Review.** Reports what the check found and offers one action, Apply. Nothing on it is editable.

### Mapping decides, Review reports

If the check turns up something you want to change, go back to Mapping, change it, and come
forward again. That round trip is deliberate. A national facility list is tied to too much for it
to be worth trading correctness for speed.

The first time through, Mapping shows no list of unrecognised values, because nothing has read the
file yet. Click Validate all, let the check run, and the list is waiting for you when you come
back. The same is true of the options that wave a problem through: you are not offered a way past
unrecognised columns until something has told you there are any.

**Changing anything on Mapping discards the last Review.** That is on purpose. A summary that no
longer matches what you are about to import is worse than no summary, so the wizard takes it away
rather than leave a number on screen that is no longer true. Review is either current or absent.

Two things deliberately do **not** discard it, because they cannot change what a check found: the
conflict, absent and deleted choices, which are applied when you import rather than when the file
is read, and the option to import past rows that could not be read at all, which only decides
whether the import may proceed.

A field's unrecognised values appear under its own mapping row, each with a pick list, instead of
in one box lower down. The list is kept while you work through it: saving a mapping does not make
the remaining rows vanish, and it no longer re-runs the check by itself. Ask for the next check
when you are ready.

**A level value that belongs to no type can be ignored.** Pick **Ignore this value** from the top of
the list. The value is imported exactly as written, which is what already happens to a value nobody
mapped, and the row stops counting it. The decision is stored against the register, so the next
import of the same file does not ask again. It is offered for Level only: Status and Country have
small, closed vocabularies with nothing in them worth ignoring.

**A level value the list does not have can be added to it.** Pick **Add "…" as a new type** from the
top of the list. A confirm opens showing the name, which you can correct, and the code it will get,
which you cannot. The type is added to that register only: every other register keeps the list it
has. If the name you typed already matches something in the list, the add is refused and names what
it matched, because two entries that read alike would stop both of them resolving. Adding a type
needs the `terminology.manage` capability as well as `facilities.manage`; without it the option is
disabled and you can still map or ignore.

### The status icon on each row

Every mapping row carries a small icon next to its field picker. It has four states:

- An amber information circle means the row has not been checked yet.
- A green tick in a circle means it has been checked, and nothing is wrong.
- A red circle means something is wrong. The row says what, in a line under it.
- A gray circular arrow means the mapping changed since its last check.
- A muted circle with a dash means the column is kept as extra data. It claims no contract field, so
  there is nothing to check it against and the icon does nothing. Most of a real export's columns
  look like this, which is what keeps the icons that need attention easy to pick out.

Each state draws its own shape, not just its own colour, so they still read apart on a phone, where
a tooltip cannot be opened at all.

The icon is always clickable, in every state. A re-check is never refused.

No row turns green on its own, however good the suggested field looks. The suggestion scores the
column's NAME. It cannot know what is inside the column, and the names it matches most confidently
tend to be the controlled fields whose values need the most checking. Green means a check has read
the column.

Clicking the icon checks that one column only. It reads that column's values from the file you
already uploaded at Source, and does not re-check the whole file. Use Validate all when you want
a full check of every column at once.

### Spelling is not your problem

A value that differs from the vocabulary only by capitals, or by writing Centre where the vocabulary
writes Center, resolves on its own and never reaches that list. Your register's `Health Centre` is
imported as `health-center`, and the words your file actually used are kept alongside the row.

A genuinely different name still reaches you. `1st Level Hospital` is not a spelling of anything in
the vocabulary, so it waits for your decision, which is the point.

**A mapping you made by hand always wins.** Nothing decided automatically overrules a decision you
made, so a register that deliberately maps a word somewhere unusual keeps that.

Every step shows one button, for the action that moves you forward. Every other action, including
the three check-again options and Close, stays in the page's `⋯` menu.

**There is no Save button. The status icon is the save.** Pick values from the lists under a row,
then press that row's icon: it writes your picks, re-reads the column, and turns the row green if
nothing is left. Validate all does the same for every row before it checks the whole file. Until you
press one of them the row's line says what is waiting, for example "4 value(s) are not recognised.
2 chosen, not saved yet".

You cannot click a step you have not reached yet, and you cannot go back to an earlier step
while a background check is running. Clicking Validate all on Mapping moves you to Review on its
own as soon as the check starts, before the check itself finishes. If the check finds a problem
with the column map, the wizard sends you back to Mapping and shows the errors there, so you can
fix the map in place.

### Repairing a cell on the Data step

The Data step shows your file as a table. Click a cell to change what it says.

Your changes are not written back to the file you uploaded. They are recorded against
the file itself, so uploading the same file again keeps every repair you made. Change the
file and the repairs stop applying, because the line numbers they name no longer mean
anything.

A repaired cell gets an amber rule down its left edge and an undo button. Undo puts the
file's own value back. Undoing a sweep puts back every row the sweep changed, not just
the one cell you clicked.

Repairing a cell in a column you mapped to `level`, `status` or `country` asks one question,
unless the cell is blank: change this row, or change every row that reads the same thing.
A blank is not a category, so filling one in changes only that row. Categories usually
repeat, so a value you correct once is usually wrong everywhere it appears.

Two things a repair cannot do. It cannot rescue a row whose column count does not match the
header: that row is set aside before any cell exists, so fix it in the CSV. And it cannot add
or remove a row. A row that should not be imported is a row to remove from the CSV.

Repairing a cell makes your last check stale. Check the column again, then validate, before
you go on to Review.

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
  all. A national file rarely carries its own country, for example, so `country` is usually a fixed
  value rather than a mapped column.

  `level`, `status` and `country` are bound to value sets, so their fixed value is picked from a
  list rather than typed. Picking writes the code, which is the same string the importer produces
  for a value you map at Review, so a picked value needs no mapping at all. You can still type a
  value the list does not offer. The panel says so when you do, and that value is imported exactly
  as typed and turns up at Review to be mapped. If an install has no value list for a field, the
  panel says that too, and nothing is checked.
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
> is worse than a file refused. Take the offered option that checks the file again keeping
> unrecognised columns as extra data. It has to be set before the file is read, so it cannot be
> added at the confirm step. **The file you already uploaded is reused**, so a national register is
> never sent twice to change one setting.
>
> A JSONL release never stops for this: each line names its own fields.

## How to get a suggested map

You rarely have to build a column map by hand. Both the wizard and the CLI can look at a file's
headers and propose a map offline, with no server round trip:

- **In the wizard:** open **Facilities**, choose **Import**, select the file, and pick the register.
  Leave Source to upload and store the file. The Data step shows the file as a read only table. The
  Mapping step opens next with a suggested map already filled in. Every row starts with an amber
  status icon, described above, because nothing has read the file yet. Click one to check that
  column, or Validate all to check them all.
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
