# Part 4: the check run and the held-back view: design

Date: 2026-11-16. Parent: `2026-11-13-disa-and-v1-migration-design.md`, sections 7 and 8.
The plugin side is `cdr-source`, in its own repository.

## 1. What this is and why

Parts 1 to 3 are built. CE can copy a source database to its own disk. The plugin can
decode a page of copied requests, apply its audit rules and check each request against its
v1 twin. Nothing joins the two. CE never calls the plugin's decode, nothing is saved from a
copy, and nobody can see what would be held back.

Part 4 adds that join: a check run in CE, and the screens for it on the plugin's page.

The operator asked on 2026-11-16 for the screen first, to test it, and for the rest after.

## 2. What exists today

Read from the code on 2026-11-16.

- **The copy.** One table, `import_copy_rows`, holds every copied row as JSON, by copy, set,
  detail and key (`packages/db/src/migrations/internal/118_import_copy_rows.ts`). The store
  can read rows for keys it is given (`packages/db/src/import-copy-store.ts:50`). Nothing
  lists a set's keys in order.
- **The one-pass import** pages a source, calls the plugin's map, checks each group and
  saves its resources (`packages/bootstrap/src/import-run.ts:495-544`). That save is the
  normal save path.
- **Long runs** are driven by one loop that turns every 5 seconds
  (`packages/bootstrap/src/import-driver.ts`). A run is a document, written every 30
  seconds, and another server may take it over after 2 minutes of silence.
- **A plugin page** calls CE through named operations
  (`packages/bootstrap/src/plugin-broker.ts:396-465`). The copy has five. The check has none.
- **The manifest** lets a plugin name four import entrypoints: queries, checks, map and copy
  (`packages/marketplace/src/artifact-manifest.ts:57-76`). It has no name for a decode.
- **The plugin** exports `source_decode` and `source_twin_keys`, and its page has one panel,
  the copy controls.
- **Workflows.** A save from an import publishes no event, so no workflow runs on it today
  (`packages/workflows/src/persist-store-service.ts:40-44` is the only publisher).
- **Nothing** exists yet for a check run, a held record or a v1-only list.

## 3. Goals, non-goals, anti-goals

Goals:

1. A lab administrator starts a check on a finished copy from the plugin's page and watches
   it count: read, saved, held back, failed.
2. A request that passes is saved through the normal save path. A request that is held is
   not saved, and is kept with its reasons and values.
3. The held-back view lists what was held and shows, for one request, each finding and each
   field of the check with both sides' values.
4. After a decoder or rule fix, the check runs again on the same copy. The source is not
   read again.
5. A run needs no person after a restart or a failed page.
6. CE core knows nothing about one source. It calls entrypoints the manifest names and
   stores what they return.

Non-goals, for now:

- Un-saving. A request saved by an earlier run stays saved if a later run holds it.
- A review process for held records. CE shows them.
- Top-up passes of the copy. Part 1 deferred them.
- Tuning how fast CE saves.

Anti-goals:

- A record saved without its check because the check was slow, missing or failed to run.
- A source row value in a log line, an audit row or an error message. Only the copy and the
  held-back store may hold values.
- The name of a source system, or its tables, in CE core.
- A run that needs a person after a cut link or a restart.

## 4. Approaches

**Where the v1 rows come from.**

| Option | Trade |
|---|---|
| A. The plugin copies the v1 tables it needs, as a second copy through a second connector | One plugin holds its whole feature. Reads only the 57 columns the check uses. Works on any v1 layout that has `Requests` and `LabResults` |
| B. Read the v1 import plugin's copy | No second copy to make. But it ties two plugins together, and that plugin cannot copy Tanzania's v1 today, which has no patient table |

Recommended: A. The operator's rule from 2026-11-13: "Each plugin should handle its full
features itself."

**Where held records live.**

| Option | Trade |
|---|---|
| A. A table of their own, one row per held request | Paged and filtered in SQL. One migration |
| B. Documents in the plugin's data store, as import failures are | No migration. But that store caps a list at 1,000, and Tanzania's sample holds 7% |

Recommended: A.

**Who drives the run.** The loop that already drives copies. No second mechanism.

## 5. The design

### 5.1 One page of a check

For a page of 500 requests (the default, as for a copy):

1. Read the next keys of the set `requests` from the source copy, after the run's cursor.
2. Read those keys' rows, grouped by detail.
3. If the plugin names a twin-keys entrypoint: call it with the page's keys, read the rows
   for the keys it returns from the reference copy's set `twins`, and pass them as `twins`.
4. Call the decode entrypoint with `{ options, now, dictionaries, keys, rows, twins }`.
5. For each group it returns:
   - an `error`: count it as failed, and keep it in the held-back store with the code;
   - `held`: keep it in the held-back store with its findings and its check;
   - else: check the resources as the one-pass import does, save them, and remove any held
     row for that key.
6. Move the cursor and write the run.

`dictionaries` is every other set of the source copy, read whole once per turn. A copy whose
dictionaries pass 64 MB of JSON is refused, with a message that names the size.

A page whose plugin call times out is halved and tried again, as the one-pass import does.
A page that still fails at one request holds that request with the code `DECODE_FAILED`.

### 5.2 What a plugin declares

The manifest's `importSource.entrypoints` gains two optional names: `decode` and `twinKeys`.
A plugin with `copy` and `decode` can be checked. `twinKeys` without `decode` is refused.

The contract with CE:

- The set `requests` is the one that is paged. Every other set is a dictionary.
- A reference copy offers a set `twins`.
- A group is `{ key, held, findings, check, resources, error, label }`. CE reads `key`,
  `held`, `resources`, `error` and `label`. It stores `findings` and `check` as they are and
  hands them back to the page. It never reads inside them.
- `label` is optional: a short code such as `passed` or `unchecked`. CE counts groups by
  label, 12 labels at most, so the page can show counts CE knows nothing about.

### 5.3 The reference copy

The plugin's `import_copy` takes one more option, `role`. With `role` set to `reference` it
returns one set, `twins`, keyed by the request id, with two details: the request rows and
the result rows, only the columns the check reads. With no `role` it returns the source sets
as today.

So a site makes two copies from the plugin's page: the source, and the reference. A copy is
already keyed by plugin and connector, so the two do not collide.

A check needs a reference copy when the plugin names `twinKeys`. The page offers one other
choice, "This site has no reference". Then every request is decoded with empty twins and
leaves marked as not checked, as the operator decided on 2026-11-16.

### 5.4 The check run

A run is a document, as a copy run is, in the collection `__import-checks`:
the source copy, the reference copy or none, the options, the status, the cursor, the page
size, the counts (read, saved, held, failed, and by label), the last error, who started it.

Statuses: `queued`, `running`, `waiting`, `stopping`, `stopped`, `completed`, `failed`.

- **Start** is refused unless the source copy is `completed`, and the reference copy too
  when one is named. That is the operator's rule: the check starts only when both copies
  have finished a full pass.
- **Start again** on a finished run begins at the first key. Saving a request twice updates
  it, since the ids are stable.
- One run per source copy at a time.
- The loop that drives copies drives checks, after them. Heartbeat and takeover are the
  same as for a copy.
- Each start, stop, takeover and finish is audited, and a run shows in Activity.

### 5.5 The held-back store

A new table, `import_check_held`, migration 119:

| Column | Holds |
|---|---|
| `copy_id`, `key` | The primary key. One row per held request of a copy |
| `run_id` | The run that held it last |
| `reason` | `held` or `error` |
| `label` | The group's label, if any |
| `error` | The error code, if any |
| `findings`, `check` | JSON, as the plugin returned them |
| `held_at` | When |

Held rows hold real values. The operator ruled on 2026-11-13 that the copy and the held-back
view may. Deleting a copy deletes its held rows.

### 5.6 Operations

For a plugin page, through the broker, with the same permission checks as the copy
operations (the `host:import` capability and the `lab_admin` role):

| Operation | Input | Output |
|---|---|---|
| `import.check.start` | source copy, reference copy or none, options, page size | the run |
| `import.check.list`, `import.check.status` | | runs, a run |
| `import.check.stop` | run | the run |
| `import.check.held` | copy, reason or label filter, page, page size | rows without their JSON, and a total |
| `import.check.heldItem` | copy, key | one row with its findings and check |

The CLI gets the same: `openldr import check start`, `status`, `stop`, and `held`. They call
the same code in `@openldr/bootstrap`.

### 5.7 The plugin's page

The page gains tabs: Copy, Check, Held back.

**Check.** Pick the source copy and the reference copy, or "no reference". Fill the decode
options: site, laboratory code, time zone, request id prefix. A dots menu holds Start, Start
again and Stop. While it runs: status, and the counts.

```
Check                                              ⋯
Source copy     Tanzania source     completed
Reference copy  Tanzania v1         completed
Status          running   page 37 of about 4,650

Read 18,500   Saved 17,204   Held back 1,271   Failed 25
  passed 12,410 · not checked 4,794 · held by rules 842 · held by check 429
```

**Held back.** A table with pagination: request, why (rules, check, error), the worst
finding, how many findings, when. A filter by why. A row opens a sheet:

```
Request 2018-00123456                      held by check
Findings
  error   specimen_missing     No specimen is recorded for an ordered test.
  warn    dates_out_of_order   registered 03/04/2019 08:15 · analysed 2019-03-03T10:00
Check against the reference
  Field          Source            Reference         Status
  collected_at   2019-03-04        2019-03-04 00:00  match
  panel_code     FBC               FBCD              mismatch
  ...
Results
  FBC / HGB      12.1              12.1              match
  FBC / WBC      (none)            6.4               only in reference
```

The page follows the v1 plugin's page, as the copy panel does: actions in a dots menu,
the same tab and table styles, a phone layout at 375 by 812.

### 5.8 Order of work

First, what the operator can test:

1. CE: the manifest names, the key listing, the check run, the held-back store, the
   operations, the page SDK.
2. Plugin: the manifest, the reference copy, the group label, the Check and Held back tabs.
3. A run on real copied rows in a scratch CE on this machine, with screenshots.

Then, before part 4 is called done (AGENTS.md section 6):

4. The CLI commands.
5. The v1-only list: reference requests that no source request asked for.
6. The workflows switch.
7. Docs in en, fr and pt, in-app and web. The phone check. The changelog.

## 6. What is not known

- **Speed in the sandbox.** A page of 500 decodes in half a second natively. Inside CE the
  plugin is built anew on every call. The first real run measures it.
- **How fast CE saves.** A request is about 8 resources. The first real run measures it.
- **pg-mem.** CE's tests run on pg-mem, which is not Postgres. The key listing pages by
  `key` with an `ORDER BY`, so the real run on a scratch Postgres is the proof.

## 7. Calls of mine, for the operator to check

1. The plugin makes its own reference copy of v1 (approach A).
2. Held records get their own table.
3. A group may carry a `label`, so the page can show "not checked" beside "saved".
4. A check may start only on finished copies.
5. A saved request is not un-saved when a later run holds it.
6. The first cut leaves out the CLI, the v1-only list, the workflows switch and the docs.
   They follow before part 4 is called done.

## 8. Sources and one reference (decided 2026-11-16, after the operator tested the page)

The first cut spoke of "copies" and let each check pick its own reference. The operator
tested it and said the page did not match the picture in their mind. Their model, in their
words:

> "Select a connector, in the sheet there should be a select to choose between its a
> reference or a source. From now on that is what we call them source or reference, not
> copy etc. Another select to choose what the source reference is, source can be 'lab
> system' or openldr v1 (so it can work from just the v1, there is no compare but some
> checks still apply). reference can only be openldrv1 and obviously you can't have a source
> and reference as openldrv1. you can have multiple sources like in a distributed system,
> all compare to one reference."

### 8.1 The model

- A **source** is a connector whose records are imported. A **reference** is a connector
  whose records the sources are compared with. Those are the only two words the page, the
  guide and the exports use. The word "copy" is gone.
- Each has a **kind**. A source is a lab system or OpenLDR v1. A reference is OpenLDR v1.
- A site has any number of sources and at most one reference. Every lab-system source is
  compared with that one reference. With no reference, requests are saved as not compared.
- An OpenLDR v1 source is never compared. A site cannot have an OpenLDR v1 source and a
  reference at once.

What stays as built: a connector still holds one set of rows, read to this server's disk,
and a check still runs per source. So this is a change of names, of what the page asks, and
of rules, not of how rows are read or checked.

### 8.2 What changes

**Plugin.** The read options gain `kind`: `lab-system` or `openldr-v1`. A reference takes
only `openldr-v1`. A source of kind `openldr-v1` is refused with a plain message until the
next piece of work builds it (operator: "Model first, v1 source next"). The role and kind
are part of what a source or reference is, so changing either means reading it again.

**Page.**

- The first tab lists sources and the reference in one table: Connector, Role (Source or
  Reference), Kind, Status, Requests, Rows, Size, Last update.
- The tab line's menu holds one item there, **Add source or reference**. Its sheet asks, in
  order: the connector (searchable), the role, the kind, then that kind's settings. The
  kind's choices follow the role. A choice the rules forbid is not offered, and a line says
  why: a second reference; a reference when a source is OpenLDR v1; an OpenLDR v1 source
  when a reference exists.
- The second tab runs a check for one source. The source is always choosable, also while a
  check runs, so a person can look at another source's check. The reference is not chosen
  per check any more: the tab shows the site's one reference, or says that this site has
  none.
- Every string, the guide in three languages, the marketplace readme and the exports' text
  use source and reference. Actions on a row are Open, Read again, Stop and Remove.

**CE core.** Nothing. The one-reference rule belongs to this plugin's page. A check's start
already takes a reference or none.

### 8.3 Reference records that no source has

The operator chose "List them, decide later". The list of a reference's requests that no
source holds stays in the later plan, with the CLI. Nothing imports them.

## 9. Laboratories (decided 2026-11-16)

The layout pass added a laboratory picker to the second tab. It expects counts for each
laboratory on a check, which CE does not send. The operator: "yes, make the laboratory
picker work".

Counted on the restored databases, counts only:

- The source's own testing-laboratory column is empty on all 3,778,852 test rows.
- The first three characters of the lab number equal v1's receiving laboratory code on
  3,437,966 of 3,437,966 order rows. There are 14 laboratories.
- v1's testing laboratory is per order row. It equals the receiving laboratory on 2,880,009
  rows, is empty on 548,335 with no result yet, and is another laboratory on 9,622.

### 9.1 What is built

- **Plugin.** Each decoded request names its laboratory: the leading characters of the lab
  number, as many as the site profile says (3 for the one site). It travels on the group as
  `laboratory: { code }`. No name is sent: the source's dictionaries have none that has been
  checked.
- **CE core.** A group may carry `laboratory`. CE counts read, saved, held, failed and the
  labels for each laboratory, as it does for the whole source, and returns them with the
  run as `laboratories`. At most 500 laboratories a run; past that the rest are counted
  under one unnamed entry. A held request keeps its laboratory code, so the held list can
  be filtered by it, and an export can be made for one laboratory.
- **Page.** The picker the layout pass built, now fed. The held list gains a laboratory
  filter, and the exports follow it.

### 9.2 What is not built here

Today the plugin files every saved request under the one laboratory code typed for the
check. The source holds 14 laboratories, so CE would record all of them as one. Filing each
request under its own laboratory is a change to the decoder's output. It follows the
decoder's own process (stated moves, the real-data compare) and waits for the four-faults
branch, which changes the same files. It is the next decoder change after that branch.

## 10. OpenLDR v1 as a source kind (decided 2026-11-16)

Section 8 left this as the next piece. The operator chose where the mapping comes from:
"Port into cdr-source". CE's own plugin, `wasm/openldr-v1-import`, already maps v1 rows to
FHIR (`src/mapping.rs:780`, `map_page`), but on the old import path, which has no held-back
list and no Processing or Feedback tab.

### 10.1 Counted first, on the restored Tanzania v1 database (counts only)

- Order rows: 3,602,986. Requests: 1,739,522 from the lab system and 154,245 from three
  other systems. So 8 in 100 requests exist only in v1.
- Tables: `Requests`, `LabResults`, `Monitoring`, `VersionControl`. There is no `Patients`
  and no `ASTResults` table, which CE's plugin reads.
- The receiving laboratory code is filled on every lab-system row and missing on 22,464 of
  the 165,020 other rows. It is at most 8 characters, all letters and digits.
- Date faults, in order rows: taken after received 44,260; received after authorised 3,773;
  registered after authorised 45,353; analysed after authorised 5,726; no taken date
  103,253; no received date 152,675; no age in years or days 56,542. No row lacks an order
  number.

### 10.2 Approaches

1. **Port the mapping into cdr-source.** One plugin, one page, Kind as a select in one
   sheet. The mapping lives in two places until CE's own plugin is retired. Chosen.
2. Give CE's plugin the check entry point and the three tabs. No copy, but two pages.
3. Build nothing and point to CE's plugin. No held-back list or laboratories for v1.

### 10.3 What is built

- **Read.** A source of kind OpenLDR v1 reads one set keyed by request id, with whole rows
  of `Requests` and `LabResults`. `Patients` and `ASTResults` are read only when the sheet
  says the database has them (my call: two switches, on by default; a missing table stops
  the read with a sentence naming the table and the switch). One setting, the database
  name. No lab code, no prefix.
- **Decode.** The plugin's decode step, for this kind, runs the ported `map_page` with its
  ten golden fixtures. A request that cannot be mapped comes back with its reason code and
  is counted as failed. Every other request is saved with the label `unchecked`. Nothing is
  compared, and the reference is not read.
- **Laboratory.** The first order row's receiving laboratory code, when it is 1 to 32
  letters, digits, `.`, `_` or `-`. Otherwise none.
- **Page.** The sheet offers OpenLDR v1 as a source kind when the site has no reference.
  The Processing tab, for such a source, asks for the time zone only and says that an
  OpenLDR v1 source is not compared.
- **CE core.** Nothing. A check already starts with no reference.

### 10.4 Checks on an OpenLDR v1 source

The operator: "there is no compare but some checks still apply". One fact limits this: CE
keeps a request's findings only in the held-back store (`import-check.ts:28`). A warning on
a saved request is shown nowhere today, for a lab-system source too. So a check on a v1
source can today only fail or hold a request.

The operator chose "Hold date-order faults". So, beside the mapping's own faults, one rule
runs on a v1 source: for each order row, the steps taken, received, registered, analysed and
authorised are compared in that order, every pair that is set, with the same comparison the
lab-system dates rule uses (`src/audit.rs`, `out_of_order`). A request with a pair out of
order is held, with one finding that lists the pairs. The form and information panels that
the lab-system rule skips come from a site profile, which a v1 source does not have, so no
panel is skipped here. The count of held requests on real rows decides whether that needs
a setting.

### 10.5 What is not built here

- The `Monitoring` table. The ported mapping does not read it.
- The old plugin's filters (panels, from, to).
- A lab-system source and an OpenLDR v1 source for the other systems at one site. The rule
  of section 8 forbids it, so those 154,245 requests are not imported at such a site. This
  joins section 8.3.
- Retiring `wasm/openldr-v1-import`.
