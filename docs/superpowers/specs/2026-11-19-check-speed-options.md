# Item 16: why the migration check is slow, and three ways to fix it

Status: the operator chose option 1, then option 2, on 2026-11-19. Option 3 is not chosen.
Codex reviewed the options. Its points are in "Review and decision" below.

## The problem

The demo.4 check of the Tanzania DISA source handled 9 to 50 requests a second.
The source has 2,326,075 requests, so a full check takes one to three days.

## What we measured

The test ran on a throwaway Postgres 16 on the same disk as the real install. It used the same
binary the standalone uses, not Docker, because Docker here runs in a VM with different disk
timing. Each made-up request has 20 FHIR records, the same mix as a DISA request. We used 1,000
requests per run and ran each variant twice. Both runs agreed within 5 percent.

| How the 20 records of a request are saved | Requests/s | Disk flushes/s |
|---|---|---|
| A. Today's code: one transaction per record | 43 | 860 |
| B. Same as A, raw statements without the site lookup | 51 to 53 | 980 to 1,030 |
| C. Same as B, without the wake-up notify after each save | 55 to 57 | 1,060 to 1,130 |
| D. Same, but commit does not wait for the disk (`synchronous_commit off`) | 89 | 7 |
| E. One transaction per request | 122 | 120 |
| F. One transaction per page of 50 requests, same statements | 133 | 10 |
| G. One transaction per page of 50, a few multi-row statements | 765 | 16 |

What this tells us:
1. Today's rate (43/s) matches what demo.4 saw. The cause is a disk flush on every record commit.
   The demo.4 sample agrees: every busy backend waited on `WALSync` or `WALWrite`.
2. The notify after each save costs little: about 7 percent (B against C, two runs each).
   C to G use raw statements without the site lookup or checks, so their gains are illustrative.
3. Once the disk waits are gone (D, E, F), the next limit is the number of statements: 80 per request.
   G cuts both and runs 17 times faster.

### Real data: the real check driver on 5,000 DISA requests

We copied 5,000 requests (keys `TBG0100000` to `TBG0104999`, 106,000 copy rows) plus every
dictionary set from the 3010 copy, reading 3010 only. We ran today's check code over them on the
throwaway Postgres, with the installed cdr-source 0.1.4 wasm and the real save path. Scripts:
`/home/fredrick/.cache/openldr-speed-bench/setup.mts` and `run.mts`.

| | Today's code |
|---|---|
| Outcome | 4,850 saved, 119 held, 31 failed |
| Records saved | 69,667 (about 14 per saved request) |
| Rate | 50 requests/s (100 s in all) |
| Commits / disk flushes | 2,147/s / 700/s |
| Time in saves | 83.5 s (84 percent) |
| Time in plugin decode | 15.0 s (15 percent), 3 ms a request |
| Everything else | 1.3 s |
| Wait events | WALSync 29%, running 28%, waiting on the client 22% |

What this tells us:
- **Saving is the cost, not decode.** Decode alone would allow about 330 requests a second.
- Option 1 cuts saves to about 28 s, so the total is about 45 s, or **about 110 requests a second**.
  That is an estimate from the made-up test (3 times faster saves), not a measurement.
  Superseded: slice 1 measured 81 a second (see "Slice 1 result").
- Option 2 cuts saves to about 6 s, so the total is about 22 s, or **about 220 requests a second**.
  Decode then becomes the limit. Also an estimate.
- A full DISA check (2.3 million) would take about 13 hours today on this disk, about 6 hours
  with option 1, and about 3 hours with option 2. Demo.4 ran slower (27 a second) because the
  3010 install was also running the projection and other work.

A second run on the same 5,000 gave 52.2 requests a second (95.8 s), with the same counts.
Saves took 80.5 s and decode 14.1 s. The two runs agree within 5 percent. The run does not
include the projection or sync workers, so the live install will be slower.

## Code today

- `packages/db/src/persist.ts:41` saves records one at a time.
- `packages/db/src/fhir-store.ts:218` opens one transaction per record. It then sends a
  `pg_notify` as a separate statement.
- `packages/bootstrap/src/import-check.ts`, the page loop: for each request it calls
  `persist`, which is all of that request's records. It then removes saved keys from the held list. Then,
  at the page end, it saves the cursor and counts in the run record.
- The run record (`pluginData`), the held list and the FHIR records are all in the same
  internal database (`packages/bootstrap/src/index.ts:1818`, `:1932`, `:834`). So one
  transaction can cover all three.

A fault found on the way: today a database error on record 7 of 20 leaves records 1 to 6 saved,
and the request is marked failed. Options 1 and 2 both fix this, because a request is saved
whole or not at all.

## Option 1: one transaction per request

**What it changes.** `persistResources` saves its list inside one transaction, with one notify
at the end. `fhirStore` gets a save that takes an open transaction. The check loop does not change.
About 50 lines.

**What it risks.** Little. A request is saved whole or not at all, which is better than today.
Webhook and workflow saves go through the same function, so they get faster too, and they need
their tests run. The projection rule "change_log is never the first write" still holds, because
each record still writes history before change_log.

**Expected gain.** About 3 times (43 to 122 a second on made-up data). A full DISA check would take
about 5 to 6 hours of saving, plus decode time.

## Option 2: one transaction per page, with multi-row statements

**What it changes.** The check loop collects the records of every request that passed on a
page. It saves them in one transaction with a few multi-row statements: one versions lookup and
one insert each into `fhir_resources`, `resource_history` and `change_log`. The same transaction
also removes the saved keys from the held list and writes the page-end cursor and counts. About
200 to 300 lines, most of them in `fhir-store.ts` and `import-check.ts`.

**What it risks.**
- One bad request would fail the whole page. It needs a fallback: on a database error, save the
  page again one request at a time, so only the bad request is marked failed. The loop already
  halves the page on decode faults, so this follows an existing pattern.
- The same record id twice in one page. Postgres refuses a multi-row upsert that touches one row
  twice, so the code must merge duplicates and number their versions in order.
- Resume after a cut gets stricter, not looser. Today a cut between the saves and the cursor
  write makes the page run again, and every record gets a second version. With one
  transaction, either the page and its cursor are both stored, or neither is. That needs its own
  test on a real Postgres, killing the process mid-page.
- Larger transactions: about 1,000 records and roughly 1.6 MB of WAL per page. That is fine for
  Postgres. The projection worker sees the whole page at once rather than as a trickle.
- More code touches the interrupted-jobs rules, so it is a bigger review.

**Expected gain.** Up to 17 times on saving alone (765 a second on made-up data, without the site
lookup, meta merge or checks). That is an illustration, not a forecast. Decode, measured at about
3 ms a request, caps the whole check near 330 to 350 a second.

## Option 3: commit without waiting for the disk, for check saves only

**What it changes.** One line: `set local synchronous_commit = off` inside the save
transaction when the save comes from a check.

**What it risks.** A power cut can lose the last fraction of a second of commits. Postgres keeps
commit order, and the page-end cursor write is a normal commit that flushes everything before
it, so a lost save comes with a lost cursor and the page runs again. But it does not make a
request whole: each record still commits on its own. The projection and sync readers can also
see a commit before it reaches the disk, and nothing proves they recover if it is then lost
(`packages/db/src/projection/fetch.ts:19`). Not chosen.

**Expected gain.** About 2 times alone. It adds a little on top of option 1 and almost nothing
on top of option 2.

## Dropped

- **Run several pages at once.** That means more connections committing together. The
  cursor is a single number today, so parallel pages need a new resume design. Too much risk
  for what option 2 already gives.
- **Change Postgres settings for the whole install** (`commit_delay`, `wal_sync_method`). That
  affects every save in CE, not only checks, and it gives less than batching.

## Recommendation

Decode is fast (3 ms a request), so saving is worth batching hard. Do option 1 as the first
slice. It is small, safe, and fixes the half-saved request. Measure it on the same 5,000. Then
do option 2 as a second slice and measure again.

Option 3 is not chosen (see "Review and decision").

## Slice 1 result (measured)

Option 1 is built on `feat/check-speed`. Same 5,000 requests, real check driver, two runs.

| | Before | Slice 1 |
|---|---|---|
| Rate | 50 and 52.2 requests/s | 81.1 and 80.6 requests/s |
| Time in saves | 83.5 and 80.5 s | 43.3 and 43.3 s |
| Time in decode | 15.0 and 14.1 s | 17.1 and 17.3 s |
| Commits / disk flushes a second | 2,240 / 730 | 320 / 84 |
| Waiting on the disk (`WALSync`) | 29 to 33 percent | 3 to 5 percent |
| Outcome | 4,850 saved, 119 held, 31 failed | the same |

The gain is 1.6 times, below the 110 a second estimate. The disk wait is gone. What is left in
saves is the number of statements: four for each record. Slice 2 targets that.

## Slice 2a result (measured)

On 2026-11-19 the operator chose to split option 2: first write each request with a few
multi-row statements (2a), measure, then decide on the page transaction (2b). Plan:
`docs/superpowers/plans/2026-11-19-check-speed-slice-2a.md`.

| | Before | Slice 1 | Slice 2a |
|---|---|---|---|
| Rate, requests/s | 50 and 52.2 | 81.1 and 80.6 | 162.0 and 167.1 |
| Time in saves | 83.5 and 80.5 s | 43.3 and 43.3 s | 14.5 and 14.4 s |
| Time in decode | 15.0 and 14.1 s | 17.1 and 17.3 s | 15.3 and 14.3 s |
| Whole run | 100 and 96 s | 62 s | 31 and 30 s |
| Outcome | 4,850 saved, 119 held, 31 failed | the same | the same |

The check is 3.2 times faster than at the start. Saves and decode now cost the same, about 15 s
each. A full DISA check (2.3 million requests) would take about 4 hours on this disk with nothing
else running, against about 13 hours before. The live install also runs the projection and sync
workers, so it will be slower than this.

What 2b could still add: saves are 14.5 s of 30 s. If the page transaction cut them to 3 s, the
run would take about 19 s, or about 260 requests a second. Decode then sets the limit. 2b also
gives what 2a does not: no request saved twice after a cut mid-page.

Found on the way, not fixed: the check saves the same Organization again with every request.
After 5,000 requests one Organization had 4,850 versions. That costs rows, WAL and projection work.

## Review and decision

Codex reviewed this page: 6 findings, 2 confirmed, 4 refuted. All are taken.
- A request is not saved whole today (`persist.ts:41`, `fhir-store.ts:222`). Confirmed.
- One multi-row statement per table does not fit a page. Pages are 500 requests by default
  (`import-check.ts:40`) and up to 2,000 (`import-sql.ts:10`). 500 requests of 20 records in a
  nine-column insert need 90,000 parameters. Postgres allows 65,535. Option 2 inserts with
  `unnest` over column arrays instead, one parameter per column.
- Option 1 cannot meet "no extra versions after a cut". Saves still commit before the cursor
  (`import-check.ts:848`, `:874`, `:893`), and a replay adds a version (`fhir-store.ts:237`).
  The correctness checks below now differ per slice.
- Option 3 does not make a request whole. Reworded above.
- Bench G skips the meta merge, provenance on conflict and the site lookup. It shows what is
  possible. Option 2 is measured with `run.mts` on the real save path.
- Option 2 must keep each request's checks separate. Today each request is checked alone, and it
  sees orders already stored, including those of earlier requests on the page
  (`bootstrap/src/index.ts:839`, `fhir/src/rules/result-requires-request.ts:49`). One check over
  the whole page would let a result pass because a later request brings its order. So option 2
  checks requests one at a time, in page order. Each sees stored orders plus orders staged by
  earlier requests on the page.
- Option 2 must roll back the page when the cursor write loses its compare-and-set
  (`import-check.ts:526`). Its one-request-at-a-time fallback must keep the same rule, so no
  request commits without its cursor.

## How to measure, before and after

A repeatable benchmark, kept in the repo:
1. Take a fixed sample of 5,000 copied DISA requests from the 3010 copy (read-only), into a
   throwaway Postgres on the same disk.
2. Run the real check driver over it from scratch.
3. Report requests a second, commits a second, disk flushes a second (`pg_stat_wal`), the top wait
   events, and the time split between decode, copy reads and saves.
4. Run before and after each slice on the same sample.

Correctness checks for each slice:
- A held request stays held.
- A saved request keeps its findings, anomaly flags and provenance (plugin version, batch id).
- Slice 1: a database error part way through a request saves none of its records. A cut mid-page
  may still save some requests of that page twice, as today.
- Slice 2: kill the process mid-page and resume. Then check that the counts match a clean run,
  that no request is lost, and that no record has an extra version.
- Slice 2: a result whose order only comes in a later request on the page is still refused.

## Item 15 (later)

The warehouse ran about an hour behind the saved records. It may shrink once saves are batched,
because the projection then gets whole pages. We measure it after item 16, on the same benchmark.
