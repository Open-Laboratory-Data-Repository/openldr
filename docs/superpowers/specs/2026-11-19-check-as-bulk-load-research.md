# Item 16: the migration check as a bulk load of history

Status: research only, 2026-11-19. No code changed. The operator's decisions are at the end.
Companion to `2026-11-19-check-speed-options.md` on branch `feat/check-speed`.

Line numbers are from `main` at bb6f0160. Branch `feat/check-speed` changes `persist.ts` and
`fhir-store.ts`, so they shift there. Plugin lines are from `openldr-ce-plugin-cdr-source` at d674edd.

## The question

If the migration were designed as a bulk load of history, not as live saves, what should change?

## Verdicts

5 ideas: 3 confirmed (one in a changed shape), 1 confirmed but mostly built already, 1 deferred.
One part of idea 1 is refuted: the plugin sends no ValueSet.

| # | Idea | Verdict | Proof | Expected gain | Cost and risk |
|---|---|---|---|---|---|
| 1 | Send shared records once | Confirmed for Organization and Questionnaire. Refuted for ValueSet. | The plugin adds both Organizations to every request (`fhir.rs:627-636`, `:650`). The Questionnaire id comes from the form name alone (`fhir.rs:702-705`). `grep ValueSet src/*.rs` gives 0 hits. Every save makes a version (`fhir-store.ts:237`). Sync pushes every version to central, one by one (`push-worker.ts:96-100`). | 1 to 2 of about 14 records per request. That is 2.3 to 4.6 million rows less over the full source. Estimate. | The plugin cannot do it alone. Each decode call gets only that page (`import-check.ts:769-771`). Idea 2 does it in CE with no plugin change. |
| 2 | Skip a save when the hash is the same | Confirmed, with conditions | CE computes the hash before stamping (`fhir-store.ts:241`) and stores it (`:275`). It never compares. The warehouse reads the current record, not the change row (`cycle.ts:45`). Sync already skips equal content on the receiving side (`fhir-store.ts:399-401`). | Covers idea 1. A re-run after a cut adds no versions, which is the stated reason for slice 2b. No speed gain on a clean first run beyond idea 1. | (a) The arrival ledger counts every version of a clinical record (`cycle.ts:85-88`, `ledger.ts:18-24`), so a skipped re-send is not an arrival. (b) A save overwrites plugin version and batch id (`fhir-store.ts:259`). A skip keeps the first run's. (c) `fhir-store-versioning.test.ts:90-96` saves twice and expects two rows. |
| 3 | Staging table, then COPY | Defer | After slice 2a, saves take 14.5 s and decode 15 s. COPY only cuts the 14.5 s. The projection and the sync push both wait for the oldest open transaction (`plan.ts:66`, `:82`, `push-worker.ts:93-100`). One long load transaction stalls both for every save in CE. | Small until decode is faster. Decode caps the run near 330 a second. | The order check must see stored orders in request order (`bootstrap/src/index.ts:841`). No COPY library in the repo. pg-mem cannot run it. |
| 4 | Parallel decode by key ranges | Confirmed as decode-ahead. Key ranges deferred. | Decode reads only keys, rows, twins, dictionaries, options and corrections (`import-check.ts:769-771`). The runner can use a worker thread (`extism-runner.ts:60`). Key ranges break two things. The cursor is one key (`import-check.ts:85`, `:874`). Two writers on one id fail on the history key (`fhir-store.ts:225-229`), and Patient and Organization are shared between requests. | Decode and saves overlap. About 165 to about 300 a second. Estimate. | Decode pages ahead, save in key order, keep one cursor. Memory grows with pages held. Page-halving on a decode fault must still work. Rechecks stay as they are. |
| 5 | Build the warehouse in bulk | Confirmed, mostly built | `reprojectAll` writes 1,000 records per call with `writeMany` (`cycle.ts:130-154`, `relational-writer.ts:61`). The CLI has it (`cli/src/db.ts:113`). The live worker writes one record at a time (`cycle.ts:104-106`), 500 change rows a cycle (`:98`). | Unmeasured. Demo 4 saw the warehouse an hour behind. | `reprojectAll` pages by OFFSET (`cycle.ts:146-147`), which slows badly at about 32 million records. It skips the facility capture hook (`cycle.ts:130`). The smaller fix is to make the live cycle call `writeMany`. |

## What others do

- Postgres docs, "Populating a Database": COPY is fastest into a table created or truncated in the
  same transaction, with indexes built after. CE has neither case. The FHIR tables are live and indexed.
- Aidbox `$import` is fast because it skips history and validation. Azure's initial mode blocks all
  writes and keeps one version. CE's sync and ledger need the history, so those do not fit.
- Azure's incremental mode keeps versions and does not block writes. It warns that two parallel
  records with one id load "at random". Key ranges would hit the same fault here.
- Blaze skips an update whose content is unchanged. The Touchstone test suite expects a new version.
  The FHIR spec allows both, so idea 2 is a choice, not a breach.

Sources:
- https://postgresql.org/docs/18/populate.html
- https://learn.microsoft.com/en-us/azure/healthcare-apis/fhir/import-data
- https://www.health-samurai.io/docs/aidbox/api/bulk-api/import-and-fhir-import.md
- https://samply.github.io/blaze/api/interaction/update.html
- https://chat-archive.fhir.org/stream/179166-implementers/topic/History.20of.20Resource.20Update.20with.20Identical.20Content.html

## Recommended order

1. Idea 2, after slice 2a merges (same file). It gives idea 1 for free and may remove the need for
   slice 2b.
2. Idea 4 as decode-ahead.
3. Idea 5: measure the lag on the 5,000 sample, then switch the live cycle to `writeMany`.
4. Idea 3 only if saves are still the limit after 1 and 2.

## Measured on 2026-11-19, after slice 2a and the demo.4 fixes merged

`main` at 6c496749. Same 5,000 DISA requests, real check driver, cdr-source 0.1.4, the throwaway
Postgres 16 on port 54399. The sample database stops at migration 127, so each run cloned it and
ran migration 128 on the clone. The shared sample was not changed. Every run gave 4,850 saved,
119 held, 31 failed and 69,667 records.

**A re-run gives the same hashes.** Two runs from scratch, with different clocks, wrote 69,671
change rows each. The two lists of type, id, version and hash are byte-identical (`cmp` exit 0).

**How many saved records are repeats.** 11,141 of 69,667, or 16 percent.

| Type | Records saved | Distinct records | Repeats |
|---|---|---|---|
| Organization | 9,700 | 42 | 9,658 |
| Questionnaire | 1,485 | 2 | 1,483 |
| Every other type | 58,482 | 58,482 | 0 |

**Speed and size.** The skip was simulated in the bench script, not in CE. The script wrapped
`saveMany` and dropped a record whose hash equals the last one stored for that id. It used CE's own
hash input (`fhir-store.ts:274`). Each row is two runs.

| Run | Requests/s | Whole run | Saves | Decode | New history rows | WAL |
|---|---|---|---|---|---|---|
| First run, today | 177 and 174 | 28.2 and 28.7 s | 13.2 and 13.8 s | 13.8 and 13.9 s | 69,667 | 155 MiB |
| First run, with skip | 181 and 178 | 27.7 and 28.1 s | 12.9 and 12.8 s | 13.7 and 14.2 s | 58,526 | 142 and 140 MiB |
| Full re-run, today | 175 | 28.5 s | 13.4 s | 13.9 s | 69,667 more | 155 MiB |
| Full re-run, with skip | 296 and 306 | 16.9 and 16.3 s | 1.7 and 1.6 s | 13.8 and 13.6 s | 0 | 0 MiB |

What this tells us:
- On a first run the skip does not make the check faster. 2 percent is inside the spread between
  runs. It saves space: 16 percent fewer history and change rows, 5 MB less history and 13 to
  15 MiB less WAL per 5,000 requests. Over 2.3 million requests that is about 5.2 million rows,
  2.4 GB of history and 6 to 7 GB of WAL. Sync would push 5.2 million fewer records to central.
- On a re-run the skip matters a lot. Today a full re-run doubles the history (69,671 to 139,338
  rows) and takes as long as the first run. With the skip it writes nothing and runs 1.7 times faster.
- Decode is now the limit. It is 13.8 s of every run: half of a first run and 83 percent of a
  skipped re-run. Decode-ahead is where the next speed gain is.

Limits of this measurement:
- The simulated skip kept hashes in memory, loaded with one query at the start. A real skip reads
  the stored hash from the database for each request, so its re-run will be a little slower than
  296 to 306 a second.
- One sample of 5,000 requests from one laboratory prefix. The share of repeats may differ elsewhere.
- No projection or sync worker ran. The warehouse lag was not measured.

## Decode-ahead spike (throwaway, 2026-11-19)

The operator chose to build decode-ahead first, and to measure it with a spike before the design.
The spike lived in the bench script only. No repo code changed.

How it worked: one pass recorded the decode input of each of the 10 pages. The timed runs then
decoded on plain Node worker threads. Each thread ran the plugin the way the foreground runner
does. While the check saved page N, the threads decoded the next pages from the recorded inputs.
The check asked for the same 10 pages every time (0 mismatches). Counts were the same in every run.

| Run | Requests/s | Whole run | Waiting on decode | Saves |
|---|---|---|---|---|
| Today, decode on the main thread | 177 and 174 | 28.2 and 28.7 s | 13.8 and 13.9 s | 13.2 and 13.8 s |
| Worker thread, 0 pages ahead | 180 | 27.8 s | 13.1 s | 13.6 s |
| Worker thread, 1 page ahead | 278 and 277 | 18.0 and 18.0 s | 2.5 and 2.6 s | 14.4 and 14.3 s |
| Worker thread, 2 pages ahead | 279 and 246 | 17.9 and 20.3 s | 2.5 and 2.6 s | 14.4 and 16.5 s |
| Worker thread, 3 pages ahead | 280 and 280 | 17.9 and 17.9 s | 2.4 s | 14.5 and 14.3 s |

What this tells us:
- One page ahead gives 1.6 times: 175 to 278 requests a second. A full source check drops from
  about 3.7 hours to about 2.3 hours on this disk, with nothing else running.
- More pages ahead add nothing. A page takes about 1.3 s to decode and about 1.4 s to save, so one
  page ahead is always ready in time. Saves are the limit again, at 14.4 s.
- The 2.5 s still spent waiting is mostly the first page, which nothing can decode ahead of.
- A worker thread alone, with no page ahead, does not speed the check up. It does free the server's
  main thread, which a decode call holds for about 1.3 s today (`extism-runner.ts:54`).

The plugin SDK's own worker mode (`runInWorker`), measured the same way:

| Run | Requests/s | Whole run | Longest main-thread stall |
|---|---|---|---|
| SDK worker mode, 0 pages ahead | 181 | 27.7 s | 127 ms |
| SDK worker mode, 1 page ahead | 275 and 277 | 18.2 and 18.1 s | 253 and 243 ms |

It is as fast as the plain worker threads, and it is already in the runner (`extism-runner.ts:60`).
It starts a new worker for each call. That costs about 20 ms, which is nothing against a 1.3 s
decode, but it makes a small call 14 times slower (21.7 ms against 1.6 ms). So only the decode call
should use it.

Found on the way:
- The SDK's worker mode crashes a process started with the `tsx` command, with `ERR_INVALID_URL`
  from Node's source-map code. The repo already knows this: `apps/server/dev.mjs` and
  `packages/cli/dev.mjs` register `tsx` in-process so workers start clean. My first bench runs used
  the `tsx` command and crashed. Started the way `dev.mjs` starts, the SDK worker mode works.
- A page's decode input is about 20 MB of JSON, because every call carries all dictionaries
  (`import-check.ts:769-771`). The 10 recorded pages were 199 MB.

Limits of the spike:
- The pages ahead came from recorded inputs. The real build must read the next page's keys and rows
  ahead, and throw a decoded page away when the page size changes, a decode fails, the run is
  stopped, or a correction arrives.
- Memory was not measured. The spike held all 10 recorded inputs, so its 1.6 GB peak means nothing.
- No projection or sync worker ran.

## What moving every plugin call to a worker would add (measured 2026-11-19)

The operator asked what "all plugin calls on worker threads" gains over "check decode only".

How long the server's main thread could not run a 20 ms timer during a full check. This is what a
studio page or an API call would wait:

| | Longest stall | Stalls over 500 ms | Time lost in stalls over 100 ms |
|---|---|---|---|
| Decode on the main thread (today) | 1,456 ms | 10 (one per page) | 13.4 s of 28.6 s |
| Decode on a worker thread | 133 ms | 0 | 1.2 s of 27.4 s |

A small plugin call (`import_copy`, a few KB in and out), 40 calls:

| | One call | 40 calls at once |
|---|---|---|
| Main thread (today) | 1.6 ms | 35 ms, 1,134 calls a second |
| Pool of 1 worker thread | 1.5 ms | 56 ms, 717 calls a second |
| Pool of 4 worker threads | 1.6 ms | 53 ms, 749 calls a second |
| Pool of 8 worker threads | 1.6 ms | 71 ms, 567 calls a second |

What this tells us:
- The gain of worker threads is for long calls only. The check's decode is the long call we know
  of, and "check decode only" already takes its stall from 1,456 ms to 133 ms.
- For small calls a worker is slower, not faster: 1,134 calls a second falls to about 750. Handing
  the call to a thread costs more than the call itself.
- So "all plugin calls" adds something only where another plugin call runs long, for example a
  converter fed a large file. No such call was measured here.

## Built result: decode-ahead on branch `feat/check-decode-ahead` (2026-11-19)

Design: `2026-11-19-check-decode-ahead-design.md`. Same 5,000 requests, real check driver, real
save path, cdr-source 0.1.4. Started the way the server starts (`tsx` registered in-process). "Before"
is `main` at 6c496749. "After" is the branch with `decodeOffThread` on. Two runs each. Every run
read 5,000, saved 4,850, held 119, failed 31, with 69,667 records.

| | Before | After |
|---|---|---|
| Requests a second | 176.8 and 177.0 | 279.1 and 274.8 |
| Whole run | 28.3 and 28.3 s | 17.9 and 18.2 s |
| Time in decode calls | 13.6 and 13.8 s | 13.6 and 13.5 s, now beside the saves |
| Time in saves | 13.5 and 13.4 s | 14.3 and 14.6 s |
| Longest main-thread stall | 1,357 and 1,371 ms | 132 and 136 ms |
| Stalls over 500 ms | 10 and 10 | 0 and 0 |

- The check is 1.57 times faster. A full source check (2.3 million) would take about 2.3 hours on
  this disk with nothing else running, against about 3.6 hours before.
- Saved records are the same. The list of type, id, version, op and content hash in
  `fhir.change_log` after a "before" run and an "after" run is byte-identical (`cmp` exit 0,
  69,671 rows each).
- Stop and start again: an "after" run was stopped once 2,000 requests were read. It stopped at
  2,500 read, cursor `TBG0102499`, and was started again. Final counts equal a clean run. Its hash
  list is byte-identical to a clean run, so no request was saved twice.
- The real page ahead reads its rows from the database while the current page saves. The built
  speed matches the spike (275 to 278), so that overlap costs nothing measurable here.
- The test runner's workers start with no loader flag, so integration tests can take the worker path.

Bench scripts kept outside the repo, in `/home/fredrick/.cache/openldr-speed-bench/`:
`run-check.mts`, `launch.mjs`, `dump-hashes.mjs`.

HONEST NON-PROOF:
- The built standalone app and the Docker image were not run. Proof would be
  `pnpm --filter @openldr/server build:check`, then one check in the built app.
- No projection or sync worker ran beside the check. The live install will be slower.
- One sample of 5,000 requests, one page size (500), no reference copy, so the twin-keys path was
  not in the bench. The unit tests cover it with a fake plugin only.
- A stop was tested once, at one point. A power cut mid-page was not.

## Built result: the hash skip on branch `feat/check-skip-unchanged` (2026-11-19)

Design: `2026-11-19-check-skip-unchanged-design.md`. Same 5,000 requests, real check driver and
save path, decode-ahead on in every run. "Main" is `main` at 3418631e. Every run read 5,000,
saved 4,850, held 119, failed 31.

| Run | Requests/s | Whole run | Saves | New history rows | WAL |
|---|---|---|---|---|---|
| Main, first run | 271.7 | 18.4 s | 14.7 s | 69,667 | 158 MiB |
| Main, run again over the loaded database | 267.6 | 18.7 s | 15.0 s | 69,667 more | 155 MiB |
| Skip, first run | 242.7 and 279.4 | 20.6 and 17.9 s | 16.9 and 14.4 s | 58,526 | 145 and 142 MiB |
| Skip, run again over the loaded database | 325.4 and 331.5 | 15.4 and 15.1 s | 8.0 and 7.9 s | 0 | 0 MiB |

- First run: 16 percent fewer history and change rows (58,526 against 69,667) and about 9 percent
  less WAL. No speed gain is shown. One skip run was slower than main (242.7) and one faster
  (279.4), with one main run between them. Two runs do not settle a difference that small.
- Run again: nothing is written, where main doubles the history (69,671 to 139,338 rows). It is
  1.2 times faster than main's run again. Decode now sets the time: 13.6 s of a 15 s run.
- A run again still spends 8 s in saves that write nothing. That is the checks and two small
  reads for each of 4,850 requests, each in its own transaction.
- Same stored content: for each of the 58,530 records, the latest content hash after a skip run
  equals the one after a main run (`cmp` exit 0). After a skip run no record has a version above 1.

HONEST NON-PROOF:
- The built standalone app and the Docker image were not run.
- No projection or sync worker ran. The fall in rows that sync would push was not measured.
- An install upgraded from before migration 129 has no stored hashes. Its first check after the
  upgrade writes every record once more. That path has a unit test, not a bench run.

## Spike: one transaction per page (slice 2b), throwaway, 2026-11-19

In the bench script only. Each request was still checked on its own, in order, and saw the orders
of earlier requests on its page. Its records were kept back, and the whole page was saved with one
`saveMany` call, in one transaction, just before the check wrote its page end. Real save code, hash
skip on, decode-ahead on. `main` at 73e6950c. Every run: 5,000 read, 4,850 saved, 119 held, 31 failed.

| Run | Requests/s | Whole run | Decode | Checks | Page saves |
|---|---|---|---|---|---|
| Main today, a transaction per request | 275.1 | 18.2 s | 13.5 s | saves and checks 14.6 s | |
| Spike, page of 500, two runs | 309.1 and 324.6 | 16.2 and 15.4 s | 13.6 and 13.4 s | 1.4 and 1.3 s | 9.7 and 8.2 s in 10 transactions |
| Spike, page of 2,000 | 325.4 | 15.4 s | 11.0 s in 3 calls | 1.3 s | 8.7 s in 3 transactions |
| Spike, run again over the loaded database | 234.1 | 21.4 s | 13.5 s | 1.3 s | 16.6 s, writing nothing |

- The stored result is the same as main's, versions included (`cmp` exit 0 on the full hash list).
- First run: 12 to 18 percent faster, not more. Saving got cheaper (about 14.6 s to about 10 s), but
  decode is now the limit: 13.5 s of a 15.4 s run, on one worker. One page ahead is no longer
  enough. With two pages ahead the run would be bound by saves at about 11 to 12 s, or about 415 to
  450 requests a second. That is an estimate, not a measurement.
- Risk met: a run again got slower, 234 against 325 to 331 today. The skip lookup asks for a page's
  7,000 records with one long OR per 1,000 keys, and Postgres plans that badly. A first run does not
  show it, because few records have a stored version then. The fix is a lookup that joins against
  arrays. pg-mem cannot run that form, so it would be tested on real Postgres only.
- A page save still takes about 0.85 s for about 7,000 records. That is Postgres writing two full
  copies of each document, with one commit. It sets a ceiling near 500 to 590 requests a second
  for one saver.
- Not met in the spike, because it did not try them: a cursor write that loses its compare-and-set
  after the page was saved, one bad request in a page, a stop or a cut mid-page, memory for a page of
  2,000 requests, and the projection receiving 7,000 change rows at once.

## Floor bench: how fast can a page of real records be saved at all (2026-11-19)

The operator asked whether a Postgres extension would help, and why the document is stored twice.
This measures both without writing an extension. Script: `/home/fredrick/.cache/openldr-speed-bench/floor.mts`.

It replays the 58,526 real records of a loaded bench database into the real three tables, with their
real indexes: 10 pages, one transaction per page, a checkpoint before each variant, two rounds.
No checks, no hash skip, every record new. Only the save itself.

| Variant | Time | Records/s | WAL | Current table |
|---|---|---|---|---|
| E. Today's `saveMany`, one call per page | 9.4 to 10.4 s | 5,600 to 6,200 | 145 MiB | 60 MiB |
| A. Node sends the page as arrays, 4 statements | 4.1 to 4.3 s | 13,600 to 14,300 | 145 MiB | 60 MiB |
| F. One statement, the page sent once as arrays, the server stamps and hashes | 2.7 s | 21,700 to 21,900 | 146 MiB | 60 MiB |
| B. The page is already in the server, one statement | 2.1 to 2.2 s | 26,800 to 27,600 | 146 MiB | 61 MiB |
| F1. As F, the document stored once | 2.5 s | 23,600 | 97 MiB | 10 MiB |
| B1. As B, the document stored once | 1.9 to 2.0 s | 29,200 to 30,300 | 97 MiB | 11 MiB |

What this tells us:
- Today's save code is the slow part, not Postgres. One plain SQL statement per page (F) is 3.6
  times faster than `saveMany` (E), with no extension. `saveMany` sends each value as its own
  parameter, in several statements per 1,000 rows, and sends every document twice.
- B is the most an extension can reach while it writes through Postgres's SQL interface. It is 20
  percent faster than F. That 20 percent is the cost of sending the page to the server, and an
  extension pays that too, because the records come from the plugin in Node. So an extension has
  little left to win over a plain statement. An extension that writes below the SQL layer was not
  measured.
- Storing the document once cuts WAL by 33 percent (146 to 97 MiB) and the current table from 60 to
  10 MiB. It makes the save about 9 percent faster. Earlier in this document's history I said
  "nearly half the writing". The measured figure is a third.
- F is not finished code. It has no hash skip, and it fails on a record that comes twice in a page.
  The real statement needs both. pg-mem cannot run its form (a data-changing `WITH`, a
  multi-argument `unnest`, a correlated subquery), so it can only be tested on real Postgres.

What it means for the check: saving a page would fall from about 0.85 s to about 0.3 s. With enough
decode workers one saver could then reach about 900 requests a second. That is an estimate.

## The check beside the projection worker (2026-11-19)

Script: `/home/fredrick/.cache/openldr-speed-bench/run-proj.mts`. The real projection worker
(`createProjectionWorker` with its LISTEN client and 2 s interval, `createProjectionRunner`, the
real warehouse writer) ran in the same process as the check, into a throwaway warehouse database
on the same server. No facility capture hook. `main` at 73e6950c, quiet machine.

| | Result |
|---|---|
| Check alone | 269.5 requests a second, 18.5 s |
| Check with the projection worker | 254.6 requests a second, 19.6 s |
| Warehouse when the check ended | 50,812 of 58,530 change rows still to do |
| Time to catch up after the check | 205 s |
| Live projection while working | 543 records a second, 10,204 commits a second |
| The existing bulk rebuild (`reprojectAll`) on the same records | 58,543 records in 4.7 s, 12,400 a second |

- The check makes about 3,000 records a second. The live projection does about 260 a second over
  the whole run. A full source would leave about 29 hours of warehouse work behind a 2.3 hour check.
- Cause 1: the worker runs one batch of 500 change rows per tick (`cycle.ts:98`) and then waits for
  the next notify or the 2 s interval (`projection-worker.ts:17`, `:31`), however far behind it is.
  After the check ends there are no more notifies, so it drains at 500 rows per 2 s.
- Cause 2: it writes one record at a time (`cycle.ts:104-106`), each in its own transactions.
- The bulk path that already exists is 48 times faster on the same records. The live cycle should
  use `writeMany` and run again at once while a batch comes back full.

## The Rust extension, tried (pgrx 0.20.0, 2026-11-19)

The operator asked for a real try. Project: `/home/fredrick/.cache/openldr-speed-bench/fhirsave`.
`cargo-pgrx` builds Postgres with debug assertions, which made every variant two to three times
slower, so a release Postgres 16.16 was built from the same source for the timings
(`~/.pgrx/16.16-release`, same settings as the bench server). Same floor bench as above, same
58,526 real records, 10 pages, one transaction per page, two rounds.

| Variant | Time | Records/s |
|---|---|---|
| E. Today's `saveMany`, one call per page | 8.8 to 9.4 s | 6,200 to 6,600 |
| A. Node sends arrays, 4 statements | 3.5 to 3.7 s | 16,000 to 16,900 |
| F. One plain SQL statement, no extension | 2.29 to 2.30 s | 25,500 |
| X. Rust extension, rows go in through SPI | 2.24 to 2.29 s | 25,500 to 26,100 |
| D. Rust extension, rows written straight into the tables and indexes | 1.99 to 2.04 s | 28,700 to 29,400 |
| B. The page already in the server, one statement | 1.84 to 1.90 s | 30,800 to 31,700 |

- An extension that saves through SPI is no faster than the plain statement: the same executor
  does the same work.
- An extension that writes below the SQL layer is 11 to 13 percent faster than the plain statement.
  That is the whole prize for a Rust extension on this job.
- Every variant stored the same documents (one digest over all stored documents, by key).
- Risk met: the first build of D changed numbers. The Rust JSON library read them as floats, so
  `4.20` was stored as `4.2`. 399 of the first 3,000 records hold such a number. The digest caught
  it. Turning on exact numbers (`arbitrary_precision`) fixed it. A stored lab value must never
  change this way, so any Rust code that touches the documents needs that setting and that check.
- D is not finished: it takes every record as new, with no upsert of the current row and no hash
  skip. Both would add work and narrow its lead.
- What an extension costs: it must be compiled for each Postgres major version and platform, shipped
  inside the standalone app's Postgres, and it cannot be installed on managed Postgres at all.

Verdict: for saving, build the plain SQL statement. It takes 3.8 times off today's save with no
install problem. Keep the extension as a known 11 to 13 percent, to revisit if saving is ever the
limit again after that.

## HONEST NON-PROOF

- Proven for this sample since the first draft: a re-run gives the same hashes (see "Measured").
  Not proven for a different plugin version or other options.
- The gains of ideas 3, 4 and 5 are still estimates. Only ideas 1 and 2 were measured.
- `change_log` has no index by record id in migration 046. Later migrations were not checked. The
  skip lookup may need one.
- Whether each plugin call builds a new wasm instance and re-sends all dictionaries. That sets the
  real gain of idea 4.
- Whether the live projection worker can be paused during a load.
- HAPI's bulk behaviour. The searches found forum posts only.

## Decisions (operator, 2026-11-19)

1. The skip applies to check saves only. Live saves keep a version per save.
2. Parallel decode is decode-ahead with one cursor. No key ranges.
3. Warehouse: measure the projection lag first. No build yet.
4. This file is saved in the main checkout, uncommitted.
