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
