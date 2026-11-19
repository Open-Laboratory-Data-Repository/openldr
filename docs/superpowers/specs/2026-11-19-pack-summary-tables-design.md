# Datasets that a report pack defines, stored as warehouse tables: design

Date: 2026-11-19. Status: approved and built. Merged to `main` at `6f2999cd`.

## The problem

On the full Tanzania source (2,326,075 requests, an 18 GB warehouse) 13 of the 77 pack reports take
over 10 seconds and 4 are stopped by the 30 second limit. Numbers are in `docs/benchmarks/log.md`.

The slow reports all start with the same step, written out inside each report's SQL: join
`lab_requests`, `diagnostic_reports` and `specimens`, parse each date from text, and reduce to one
row per request. Every run of every report redoes it over 4.2 million rows.

Measured on that warehouse, with the step's result stored once as a table and the rest of each
report run from the table. The output was identical.

| Report | As written | From the table |
|---|---|---|
| Turnaround times by lab | 37.0 s | 4.5 s |
| Date completeness by lab area | 31.2 s | 2.9 s |
| Requests received by week | 48.1 s | 25.2 s |

The third still scans `diagnostic_reports` a second time for lab names. With the name in the table
it loses that scan too. Building the table took 25 to 30 seconds.

Ruled out by measurement: more database memory. `work_mem` of 512 MB made the slowest report take
85 seconds against 48.

## What we build

A report pack can ship **summary tables** next to its reports. A summary table is a name and one
SELECT. CE stores the SELECT's result as a real table in the warehouse and rebuilds it after the
warehouse changes. Reports read the table by name.

The country logic (which panels, which dates, which name wins) stays in the pack. CE only knows how
to build and refresh a table from a SELECT. This follows AGENTS.md section 8: queries written for
one system are content.

## How this relates to the Datasets on the Query page

The operator asked on 2026-11-19 whether this should use the Datasets already on the Query page.
Checked in the code:

- A Dataset today is the output of a workflow's Materialize node
  (`packages/workflows/src/engine/node-handlers/materialize.ts`). Its rows are kept as one JSON value
  in the internal database (`workflow_datasets.rows`, `packages/db/src/schema/internal.ts:841`).
- The Query page lists Datasets and shows that stored copy (`apps/server/src/query-routes.ts:347`).
- A report can read one only when the feature flag `workflow.dataset_publish_enabled` is on, which
  it is not by default. Then the workflow also writes the rows to a warehouse table
  (`packages/bootstrap/src/index.ts:1390`). That table has one column, `data`, holding each row as
  JSON. It has no typed columns and no indexes, so a report would unpack JSON on every row.
- Every row passes through the server's memory, and the whole set is sent to the database as one
  JSON value. 4.2 million rows will not fit that way.

So Datasets are the right idea and the right place on screen, and the wrong storage for this job.
The design below adds a second way to make a Dataset: from a SELECT, stored as a real warehouse
table. Both kinds show under Datasets on the Query page. To the user there is one thing, a Dataset.
The text below says "summary table" for the new kind where it matters which one is meant.

## Approaches considered

1. **Pack-defined summary tables that CE keeps fresh.** Chosen by the operator on 2026-11-19.
   Largest gain, and it works for any pack and any future slow step. Costs a new pack step kind and
   a regenerated reports pack.
2. **CE caches each report's result until the warehouse changes.** No pack change. A repeat view is
   instant. The first run of each date range is still 30 to 50 seconds and the 4 reports still hit
   the limit. Not chosen. It can be added later on top.
3. **Typed date columns and indexes in the shared warehouse model.** Removes the text parsing but
   not the three-table join and the grouping, and each report would still need rewriting. Not chosen.
4. **A CE-owned "request facts" table.** Fast, but it puts one country's report rules into CE's
   schema, against section 8. Not chosen.

## Design

### Pack format

A new step kind in `packages/marketplace/src/content-pack.ts`:

```
{ kind: 'datasets', tables: [ { name: 'zm_request_times', sql: 'select ...', indexes: [['collected_on']] } ] }
```

- `name`: lower case letters, digits and underscores, 3 to 48 characters. CE creates it as
  `dataset.<name>` in the warehouse. The `dataset` schema holds nothing else, so a pack can never
  replace a warehouse table.
- `sql`: one SELECT. It passes `validateSelectSql` (`packages/dashboards/src/sql-runner.ts:20`), the
  same check that guards a report run. It may read warehouse tables and other summary tables listed
  before it in the same step.
- `indexes`: optional. Each entry is a list of column names for one plain index.
- A CE without this kind refuses the pack as needing a newer CE. That is how the existing kinds
  already behave (`content-pack.ts:49`).
- The step must come before the `custom-queries` step whose reports read the tables.

### Where the definitions live

A new internal table, `warehouse_datasets`: name, the pack that owns it, the SELECT, the indexes, the
change number it was last built at, when, how long it took, the row count, and the last error.
Installing a pack writes the rows. Detaching a pack leaves its datasets in place, as it leaves
everything else a pack loaded (`content-pack-install.ts`, `detach`). A dataset is removed by its own
Delete action. A second
pack that names a table another pack owns is refused.

### Building and refreshing

- A build runs the SELECT into `dataset.<name>__new`, adds the indexes, then swaps the names in one
  transaction. A reader sees the old table or the new one, never an empty one.
- A build runs on install, and again when the warehouse has changed since the last build **and** is
  up to date (the projection's gap is 0, read with `readWarehouseReading`). During an import the
  warehouse is never up to date, so nothing rebuilds until it ends. That is on purpose: a rebuild
  every few seconds of a 30 second job would never finish.
- Tables build one at a time, in the order the pack lists them.
- A failed build keeps the old table, records the error, and tries again after the next change.
- The first version rebuilds the whole table. An incremental refresh is not built until a real
  install needs it.

### What a report sees before the first build

The table does not exist yet, so the report fails. CE turns a "relation dataset.x does not exist"
error into a plain message: "This report's dataset is still being built." Install builds the
table before it reports success, so this shows only if the first build failed.

### Engines

PostgreSQL warehouses only in the first version. On a SQL Server or MySQL warehouse the step is
refused at install with a plain message. The current report packs are PostgreSQL-only already (they
use `~` regular expressions).

### The five places (AGENTS.md section 6)

1. **UI.** The new kind shows under **Datasets** on the Query page, beside the workflow-made ones.
   Each shows its owner pack, rows, when it was last built and how long that took, and any error.
   Opening one browses the table like any warehouse table. A dots menu has Rebuild. The Warehouse
   line on the Activity page says "rebuilding datasets" while a rebuild runs.
2. **CLI.** `openldr db datasets list` and `openldr db datasets rebuild [name]`. The
   shared logic lives in `@openldr/bootstrap`.
3. **Docs.** In-app and web, in en, fr and pt: what a summary table is, and why a report can be
   behind the warehouse by one rebuild.
4. **Mobile.** The sheet at 375 pixels wide.
5. **Changelog.** `pnpm make:changelog` after the merge.

### The reports pack

The reports pack is generated by `cdr-toolchain/packs/reports-zm/`, and the toolchain is frozen
(decision of 2026-11-13). The generator moves into its own content-pack repo,
`openldr-ce-content-pack-reports-zm`, and there the shared first step becomes a summary table. Each
report's output is compared with the current pack's output on the full Tanzania warehouse before
the pack is published. `vl-reports-mz` follows the same way.

## Not in this design

- A dataset made automatically when a report is published: CE would find the step several reports
  share and store it by itself. The operator raised this on 2026-11-19 and set it aside for its own
  session.
- Result caching for repeat views.
- Incremental refresh.
- Typed date columns in the shared warehouse model.
- SQL Server and MySQL warehouses.

## How we will know it worked

On the full Tanzania warehouse, with the new pack installed:

- No report is stopped by the 30 second limit.
- The 7 reports that share the first step each take under 5 seconds.
- Every report's output equals the current pack's output, row for row.
- A rebuild of all summary tables is timed and added to the benchmark log.

## Open risks

- A rebuild reads the whole warehouse. On a small lab machine it competes with reports for 30
  seconds or more. It runs one table at a time to limit that.
- A report can be one rebuild behind the warehouse. The Warehouse line says so.
- The pack's SELECT runs with CE's warehouse login. An earlier version of this line said its guards
  were "the same two that guard a report today". That was wrong, and the whole-branch review caught
  it: a report also runs read-only, with a time limit, and cannot carry a second statement. The
  build now has those guards too (`packages/db/src/warehouse-dataset-build.ts`): the rows are read
  inside a read-only transaction into a working table, the SELECT is wrapped so text after a `;` is
  an error, each statement has a time limit, and the session is reset before the connection is
  reused. The cost is a second copy of the rows.
