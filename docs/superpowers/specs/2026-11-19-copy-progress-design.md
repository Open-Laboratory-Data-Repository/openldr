# Copy progress: total, percentage and time left

Date: 2026-11-19. Short design. Design calls are the maintainer's (the operator's standing word
of 2026-11-19); each call below is marked as mine.

## Why

A source copy of the full Tanzania source takes about an hour, and a slower link can take days.
The copy record had no total (`packages/bootstrap/src/import-copy.ts`, `CopySetProgress` held
`keys`, `rows`, `bytes`, `skipped` and `done`). So no screen could say how far a copy was or when
it would end. The operator asked for the total, a percentage and the time left wherever a running
copy shows.

## Goals and non-goals

- Goal: total, percentage and time left on the CDR source copy page, on Activity, in
  `openldr import copy status` and its `--json`, and in the page API (`import.copy.status`).
- Non-goal: a plugin change. The plugin's SQL stays as it is.
- Non-goal: a migration. The copy record is JSON in `plugin_data`.
- Anti-goal: a copy that waits on, or fails because of, its count.

## Approaches

1. **Count with the plugin's own key query** (chosen, my call). CE wraps each set's key query:
   `SELECT COUNT_BIG(*) FROM (<key query from the start, TOP 2147483647>) AS [k]`. It counts
   exactly the keys the copy pages through, with any filter the plugin put in the key query.
   It works for every plugin with no change. Cost: one statement a set at each drive start.
2. Ask SQL Server for its own row counts (`sys.partitions`). Cheap, but it counts table rows,
   not keys, and ignores the key query's filter. A reference copy filtered by a prefix would be
   wrong. Rejected.
3. A count query named by the plugin. Exact, but every plugin must change and be republished.
   Rejected: approach 1 gives the same number with no plugin work.

## Design

- `fillCountQuery` (`import-sql.ts`) builds the count statement. CE's SQL check passes it.
- When a drive starts, after it drops sets the plugin no longer names, the driver counts each set
  not yet done, one after another, each on a connection of its own with a 30-second limit. A count
  that fails or times out gives `total: null`, and the copy goes on. The count runs before the
  first page, so the order of page reads is unchanged.
- Each set stores `total`. The run stores `pace: { since, done }`: when this drive began reading,
  and the keys done then.
- `copyEstimate(run)` works out `{ done, total, percent, secondsLeft }` on every read. It is never
  stored. A done set counts what it read. A set not done counts its total, or what it has read if
  that is more. One set not done with no count leaves the total unknown.
- Time left (my call): keys left times the average time a key took since the drive began, measured
  to the record's last save. Shown only while running and after a minute of driving.

## When the estimate is wrong

- The speed changes: the source gets busier, or older and newer requests carry different numbers of
  rows. On the Tanzania source a request carries from 11.7 to 29.0 rows, depending on its age.
- A restart starts the average again, so the first minute after a restart shows no time left.
- Rows added to the source during the copy: the total is the count at the drive's start.
- The page size shrinks after timeouts: the time left rises once the average catches up.

## Where it shows

- CLI: `formatCopyRun` adds `45.2% of 2342719 keys, about 31 min left`, and `total=` per set.
- Activity: the copy's Persisted line adds `45% of 2342719 keys, about 31 min left`.
- Plugin page (cdr-source repo): a bar and the same words under the status, in the table row and
  in the copy sheet, and `n of total` keys for a set still being read. en, fr and pt.
- Page SDK types (`packages/plugin-ui-sdk`): `total`, `pace` and `estimate`, all optional, so a
  page built against them still works on an older CE.

## Left out

- The v1 import plugin's own page (`wasm/openldr-v1-import/ui`) still says "of an unknown number
  of requests". Its guide now says where the count shows. A follow-up.
