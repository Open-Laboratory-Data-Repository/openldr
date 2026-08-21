# CDR export-batch: choose the lab selection order

Date: 2026-08-21
Repo the code lands in: `D:\Projects\Repositories\cdr-toolchain`
Status: design, not built

## The problem

`export-batch` always selects labs oldest first. The order is hardcoded and there is no flag
to change it.

That matters because DISA lab numbers are chronological. Measured against the v1 mirror's
`RegisteredDateTime`, per 10,000-lab block:

| block | registered |
|---|---|
| TDS001 | 2013-03 to 2014-02 |
| TDS002 to TDS004 | 2014-02 to 2015-10 |
| TDS005 to TDS011 | 2015-10 to 2018-06 |
| TDS012 | 2018-06 to 2018-08 |
| TDS013 | 2018-08 to 2019-01 |

So `--limit 5000` on a fresh dev install fills it with 2013 data. Every report filtered to a
recent window comes back empty. To get recent data today you have to know the block
boundaries and hand-write a `--where` clause.

## What is hardcoded, and where

`apps/cli/src/commands/export-batch.ts:208`, inside `fetchLabNumbers`:

```
const composedWhere = `${userClause} ORDER BY [LabNo] OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
```

`--explain` builds the same clause a second time from a separate literal, at line 908. The two
are already duplicates. Adding an order flag to one and forgetting the other would make
`--explain` lie about what the run will do.

## Design

### 1. Extract the composition into one function

New export in `apps/cli/src/where.ts`, next to the existing `composeWhereWithPagination`:

```ts
export type SelectionOrder = "asc" | "desc";

export function composeBatchSelection(
  userWhere: string | undefined,
  column: string,
  limit: number,
  offset: number,
  order: SelectionOrder,
): string
```

It returns the full clause: the normalised user `WHERE`, then `ORDER BY [column]`, then `DESC`
when the order is descending, then `OFFSET` and `FETCH NEXT`.

`fetchLabNumbers` and the `--explain` branch both call it. `--explain` then prints the clause
the query will actually run, because it is the same string from the same function.

### 2. Add the flag

`--order <asc|desc>` on `export-batch`, default `asc`.

The default keeps every existing run byte-identical. Nothing about the v2 path or a production
CE push changes unless someone asks for it.

An invalid value throws `CliError("USAGE", ...)`, following `--quarantine-severity` at line 887.

`scripts/push-to-ce.sh` and `scripts/push-to-ce.ps1` gain an `ORDER` tunable beside `LIMIT`,
`CONCURRENCY`, and `WHERE`:

```
ORDER="${ORDER:-asc}"
```

passed through to the CLI as `--order`.

### 3. What descending changes for the other flags

`--offset` skips from the newest end under `desc`. That is the plain reading of "skip N labs
before starting", so the flag needs one sentence of help text, not special handling.

`--resume-from` filters by a set of lab numbers, so the order they were selected in does not
affect it.

## Testing

`where.ts` has no test file today. Add `apps/cli/src/where.test.ts` covering
`composeBatchSelection` directly:

- empty user clause
- a user clause that already begins with `WHERE`
- ascending, which must not emit the word `DESC`
- descending
- a non-zero offset

Then one test in the existing export-batch suite: `--explain` with `--order desc` puts
`ORDER BY [LabNo] DESC` in its output.

Both are unit level. Neither proves SQL Server accepts the clause. A live `--explain` plus one
small real run against the dev CE proves that, and the plan must include it.

## Out of scope

Three other call sites hardcode the same ascending order:

- `apps/cli/src/commands/audit.ts:116`
- `apps/cli/src/commands/compare-batch.ts:223`
- `buildRequestIdsSql` in `apps/cli/src/openldr.ts`, which orders by `[RequestID]`

Extracting the helper makes adding the flag to each a small change later. They are not part of
this work.

## What this does not fix

Newest first is not automatically better on this laptop. The v1 mirror decides how many labs
survive the fidelity gate, and its coverage is uneven:

| block | DISA labs | present in v1 | coverage |
|---|---|---|---|
| TDS001 | 9,989 | 7,165 | 72% |
| TDS002 | 9,980 | 5,586 | 56% |
| TDS003 | 10,000 | 4,911 | 49% |
| TDS004 | 9,999 | 5,452 | 55% |
| TDS005 | 9,999 | 9,582 | 96% |
| TDS006 | 9,993 | 8,493 | 85% |
| TDS007 | 9,994 | 9,315 | 93% |
| TDS008 | 9,989 | 9,224 | 92% |
| TDS009 | 9,986 | 9,201 | 92% |
| TDS010 | 9,987 | 8,437 | 84% |
| TDS011 | 9,978 | 9,200 | 92% |
| TDS012 | 9,998 | 9,947 | 99.5% |
| TDS013 | 9,516 | 1,746 | 18% |

A strict `--order desc` run starts on TDS013, the worst block, and the gate drops 82% of it
before anything is sent. The flag gives you the choice. It does not make the newest labs
usable. Picking a block with `--where` is still the way to get a high yield, and TDS012 is the
one that is both recent and nearly complete.

Measured 2026-08-21 on the work laptop against `DisalabData.dbo.REGDAT4` and
`OpenLDRData.dbo.Requests`.

## Task 4: proved against a real database

Run 2026-08-21, work laptop, SQL Server at `127.0.0.1,1433`, dev CE at `http://localhost:5173`.

`ORDER=desc ./scripts/push-to-ce.sh verify` printed `lab_selection.order":"desc"` and
`"where":" ORDER BY [LabNo] DESC OFFSET 0 ROWS FETCH NEXT 5000000 ROWS ONLY"`. SQL Server was
not queried for this step, so it only confirms the flag reaches the composed clause.

`ORDER=desc LIMIT=20 CONCURRENCY=2 OUTDIR=./temp/ce-push-desc ./scripts/push-to-ce.sh run`
exited non-zero (`API_REJECTED`), as expected under `set -e`. `summary.log`:

```
{"labs_attempted":20,"posted":8,"deduplicated":0,"quarantined":10,"check_failed":2,
"not_found":0,"errored":0,"forms_posted":0,"split":7}
```

The 20 lab numbers selected were `TDS0139501` through `TDS0139520`, sorted. That is the top 20
of the DISA range, ending exactly at `TDS0139520`, the number this same spec's traps section
above names as the top of the range. An ascending run would have started at `TDS0010001`. This
is the proof the flag changes what SQL Server returns, not just what the CLI prints.

Of the 12 labs not posted, 2 failed the fidelity gate with reason `OpenLDR v1 has no Requests
row for this lab`, matching this spec's own coverage table (TDS013 sits at 18% v1 coverage).
The other 10 were quarantined by the existing DISA data-quality gate (`record_has_no_observations`,
error severity). That gate predates this work and is unrelated to the order flag. It is checked
here so the count is not misread. At this 20-lab sample size, quarantine outnumbered the
fidelity gate. A larger sample would be needed to reproduce the roughly-80%-fidelity-gate split
seen at full volume.

`pnpm test` in `apps/cli` after the live run: 368 tests, 367 pass, 0 fail, 1 skipped, exit 0.
No regression from the live push.
