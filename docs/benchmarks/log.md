# Benchmark log

Every speed measurement, kept so progress can be read over time.

Rules:

- Add rows. Never rewrite an old row. If a number was wrong, add a row that says so.
- One row is one measurement: date, commit, dataset, what was measured, the number.
- Timings and counts only. Never a value from patient data.
- Say where the evidence is, and what the number does not prove.

Datasets:

- **Bench 5k.** 5,000 real requests from the restored Tanzania DISA database, about 58,500 FHIR
  records. Scratch Postgres on the Linux box. Scripts in `~/.cache/openldr-speed-bench/`.
- **Tanzania full.** The whole restored DISA database: 2,326,075 requests, 48.2 million source rows.
  Standalone desktop install on the Linux box (32 cores, 90 GB), embedded Postgres at its default
  settings. Evidence in `~/.local/share/demo5-evidence/`.
- **Copy 250k.** The copy of 250,000 Tanzania requests, ranked 1,000,000 to 1,250,000 by lab number:
  4,876,338 request rows, 1.91 GiB, 18.9 rows a request against 20.7 for the whole source. The real
  copy service and the installed cdr-source plugin read the demo4 SQL Server and write to the
  scratch Postgres. The dictionaries are copied whole. A second range, ranks 1,500,000 to
  1,750,000, is **Copy 250k B**. Scripts and output in `~/.cache/openldr-speed-bench/copy/`.

## Import: processing (the check)

| Date | Commit | Dataset | Change | Requests a second |
|---|---|---|---|---|
| 2026-11-19 | before item 16 | Bench 5k | start of the session | 50 |
| 2026-11-19 | decode-ahead | Bench 5k | decode the next page off the main thread | 165 to 177 |
| 2026-11-19 | hash skip | Bench 5k | skip a save whose content is unchanged | 272 to 279 |
| 2026-11-19 | set-based save | Bench 5k | one statement per page, three pages decoded ahead | 544 to 548 |
| 2026-11-19 | 770f37f2 | Bench 5k | one copy of each document | 525 to 537 |
| 2026-11-19 | 770f37f2 | Tanzania full | whole run, projection running beside it | 625 to 680 |

| 2026-11-19 | 4d748753 (demo.10) | Tanzania full, fresh standalone | whole run, no v1 reference prefix, 69.2 min net | 560 |
| 2026-11-19 | 4d748753 (demo.10) | Tanzania full, fresh standalone | whole run, compared with the v1 reference (TZDISA), 80.5 min | 481 |
| 2026-11-20 | 4dcf8e4c (0.1.12-rc.1) | Tanzania full, Docker install on Docker Desktop | whole run, compared with the v1 reference (TZDISA), 99.0 min | 392 |
| 2026-11-20 | 4dcf8e4c (0.1.12-rc.1) | Tanzania full, Docker install on Docker Engine (no VM) | whole run, compared with the v1 reference (TZDISA), 94.7 min | 409 |

Tanzania full, whole run at 770f37f2: 60 minutes. 2,130,022 saved, 163,451 held, 32,602 failed.

demo.10 runs (2026-11-19, evidence in `~/.local/share/demo10-evidence/`). Both read 2,326,075.

- Without the prefix: 18:00:17 to 19:14:18, 74.0 min wall. The disk filled and the server was down
  4 min 50 s, so 69.2 min net. 2,130,022 saved, 196,052 held, 1 failed. Every saved request was
  "unchecked", because without `requestIdPrefix=TZDISA` no key matches the v1 reference.
- With the prefix: 19:16:07 to 20:36:38, 80.5 min. 2,129,331 saved, 196,743 held, 1 failed.
  Labels: 1,612,554 passed, 516,778 unchecked, 691 held by the check, 195,988 held by the rules,
  64 held by both. The comparison costs about 14% against the run without it.
- The 32,602 that failed at 770f37f2 are now held. The disk used about 60 GB in the second run.

Not proved: why 516,778 requests found no v1 record. The v1 reference holds 1,739,522 keys.

## Import: copy

| Date | Commit | Dataset | Time | Requests a minute |
|---|---|---|---|---|
| 2026-11-19 | 770f37f2 | Tanzania full | 58.6 min | 39,720 average, 27,575 slowest minute, 53,500 fastest |
| 2026-11-19 | 6daedb65 | Tanzania full, bench Postgres | 24.3 min | 95,912 average |
| 2026-11-19 | demo.9, before migration 134 | Tanzania full, fresh standalone | stopped at 70.3%, 34.7 min | about 117,000 to 51%, then under 22,000 |
| 2026-11-19 | 4d748753 (demo.10) | Tanzania full, fresh standalone | 17.0 min | 136,560 average |
| 2026-11-19 | 4d748753 (demo.10) | v1 reference (OpenLDRData_TZ), fresh standalone | 6.8 min | 1,739,522 keys, 13,955,346 rows |
| 2026-11-20 | 4dcf8e4c (0.1.12-rc.1) | Tanzania full, Docker install on Docker Desktop | 22.3 min | 104,300 average |
| 2026-11-20 | 4dcf8e4c (0.1.12-rc.1) | v1 reference (OpenLDRData_TZ), Docker install on Docker Desktop | 7.6 min | 1,739,522 keys, 13,955,346 rows |
| 2026-11-20 | 4dcf8e4c (0.1.12-rc.1) | Tanzania full, Docker install on Docker Engine (no VM) | 20.8 min | 112,000 average |
| 2026-11-20 | 4dcf8e4c (0.1.12-rc.1) | v1 reference (OpenLDRData_TZ), Docker install on Docker Engine (no VM) | 9.6 min | 1,739,522 keys, 13,955,346 rows |

0.1.12-rc.1 runs (2026-11-20, evidence in `~/.local/share/rc1-evidence/`): installed by `install/install.sh
--version 0.1.12-rc.1 --seedless --auth local` on Docker Desktop, whose VM has 16 GB and a disk
image. DISA read 01:53:48 to 02:16:06, 48,198,955 rows, 19.90 GiB, 0 skipped. Check 02:24:50 to
04:03:50, every count equal to the demo.10 recheck: 2,129,331 saved, 196,743 held, 1 failed,
1,612,554 passed, 516,778 unchecked. Not proved: that the gap against the standalone is Docker
Desktop's VM and not Docker itself. A run on Docker Engine with no VM would show it.

Docker Engine run (2026-11-20, evidence in `~/.local/share/native-evidence/`): the same rc.1 images
on Docker Engine 29.5.2 with no VM (96 GB, 32 CPUs), plugin cdr-source 0.1.6 against 0.1.4 in the
Docker Desktop run. DISA read 08:51:21 to 09:12:07, reference read 09:13:01 to 09:22:34, check
09:23:21 to 10:58:04. Every count equal to the Docker Desktop run. Against Docker Desktop: the DISA
read 7% faster, the check 4% faster, the reference read 26% slower. Still 18% slower than the
standalone on the check. Not proved: the source SQL Server stayed in the Docker Desktop VM in both
runs, so the reads cross that VM either way, and one run each says nothing about spread.

demo.9: past 51% the delete before each page scanned the whole table (see migration 134). demo.10:
17:35:38 to 17:52:40, 48,198,955 rows, 19.90 GiB, 0 skipped. Same machine and settings as demo.9.

19.9 GiB copied. Page size 500. No interruption.

6daedb65 run: page 2,000, 6 detail queries at once, the next page read ahead. Same totals as the
770f37f2 run: 2,326,075 requests, 48,182,311 rows, 19.90 GiB. Written to the scratch Postgres on
port 54399, not the standalone's, so the Postgres side differs from the 770f37f2 row. Peak memory
861 MiB. SQL Server averaged 1.26 cores, the copy process 0.70. The seven counts took 2.0 s. The
time left it showed: 19 min at minute 2 (22 real), 15 at minute 8 (16 real), 12 at minute 12 (12
real), within a minute from then on. Output: `~/.cache/openldr-speed-bench/copy/full-a.txt`.

Copy 250k, before and after each item of the copy work (2026-11-19, base commit 0ef2a49b). Runs
on one range share SQL Server's cache, and two runs of one setting differ by up to 15%.

| Date | Code | Dataset | Page | Requests a minute | Peak memory |
|---|---|---|---|---|---|
| 2026-11-19 | 0ef2a49b, before | Copy 250k | 500 | 34,965 (tests running beside it) | 586 MiB |
| 2026-11-19 | item 1, counts the total | Copy 250k | 500 | 38,173 and 40,672 | 577 and 591 MiB |
| 2026-11-19 | item 1 | Copy 250k | 1,000 | 43,732 and 43,980 | 591 and 568 MiB |
| 2026-11-19 | item 1 | Copy 250k | 2,000 | 53,159, 49,247, 45,571, 49,623, 45,737 | 656 to 671 MiB |
| 2026-11-19 | spike, throwaway | Copy 250k | 4,000 | 41,444 | 781 MiB |
| 2026-11-19 | spike: details at once | Copy 250k | 2,000 | 61,530 | 654 MiB |
| 2026-11-19 | spike: read the next page ahead | Copy 250k | 2,000 | 64,872 | 842 MiB |
| 2026-11-19 | spike: both | Copy 250k | 2,000 | 116,768, then 88,993 and 90,869 | 759 to 806 MiB |
| 2026-11-19 | spike: both | Copy 250k | 4,000 | 77,719 | 905 MiB |
| 2026-11-19 | spike: both, cold cache, run first | Copy 250k B | 2,000 | 89,184 | 723 MiB |
| 2026-11-19 | item 1, run after the spike | Copy 250k B | 2,000 | 48,007 | 640 MiB |
| 2026-11-19 | item 3 built: 6 details at once, read-ahead | Copy 250k | 2,000 | 85,783 (plugin build beside it), 103,251 | 772 and 773 MiB |
| 2026-11-19 | item 3 built | Copy 250k B | 2,000 | 102,911 | 753 MiB |

Where the time goes at page 500 (38,173 run): detail queries 279 s of 393 s, writes to
`import_copy_rows` 86 s, key queries 3 s, the seven counts of item 1 0.6 s. At page 2,000: detail
queries 183 to 212 s of 282 to 329 s, writes 75 to 88 s.

CPU while copying, page 2,000 (100 = one core, 32 cores in the machine): today's code, SQL Server
55 to 60 and the copy process 35 to 39. Both spikes: SQL Server 111 to 152, the copy process 57 to
69. Neither side is near its limit. The copy waits on one query at a time.

The 116,768 run came after five runs on the same range and was not repeated. Read the spike gain as
about 1.85 times, from the repeated runs and the cold run.

With item 3 built, SQL Server used 136 to 173 and the copy process 59 to 72. The stored rows
matched the code before item 3: the same 4,876,338 rows and the same content digest.

Not proved by these rows: a full-source run with page 2,000 (the change was not run on the whole
source), a source over a slow network, and SQL Server with more than its 2 GB memory cap.

## Projection (the warehouse step)

Change rows moved a second.

| Date | Commit | Dataset | Condition | Change rows a second |
|---|---|---|---|---|
| 2026-11-19 | 770f37f2 | Tanzania full | during the check, which wrote 9,434 a second | 2,667 |
| 2026-11-19 | 770f37f2 | Tanzania full | alone, four runs | 6,122 to 7,482 |
| 2026-11-19 | e3edbf8b | Tanzania full | alone: batch of 2,000, one commit, one facility lookup per batch | 15,383 |
| 2026-11-19 | 770f37f2 | Bench 5k | alone, whole set | 9,055 |
| 2026-11-19 | e3edbf8b | Bench 5k | alone, whole set | 13,587 |

Not proved: the rate of e3edbf8b during a check.

## Dashboard and reports

Tanzania full at 770f37f2, measured while the check ran. "Dashboard" is the 13 widgets of the sample
dashboard, asked through the API. "77 reports" is every report query of the two installed packs,
one after another. The warehouse was about half behind at every row.

| Date | Requests read | Dashboard | 77 reports | Reports over 10 s | Slowest report |
|---|---|---|---|---|---|
| 2026-11-19 | 0 | 38 ms | 1.9 s | 0 | |
| 2026-11-19 | 617,000 | 0.64 s | 70 s | 1 | 11.3 s |
| 2026-11-19 | 1,179,000 | 0.88 s | 205 s | 7 | 29.5 s |
| 2026-11-19 | 1,778,000 | 1.38 s | 296 s | | |
| 2026-11-19 | 2,326,075 | 1.77 s | 363 s | 9 | 49.8 s |

At the last row one report was stopped by the 30 s statement limit. Server health call: 2 to 5 ms
throughout, worst 0.33 s.

Tanzania full at 770f37f2, the check finished and the warehouse complete (2026-11-19):

| Date | Warehouse | Dashboard | 77 reports | Reports over 10 s | Stopped by the 30 s limit |
|---|---|---|---|---|---|
| 2026-11-19 | complete, 18 GB | 4.0 s | 369 s | 13 | 4 |

72 of the 77 reports parse dates from text columns. Those 72 take 339 of the 369 seconds.

## Warehouse catch-up after an import

| Date | Commit | Dataset | Backlog when the check ended | Time to catch up |
|---|---|---|---|---|
| 2026-11-19 | 770f37f2 | Tanzania full | 14,030,722 change rows | 35 min, with two test runs of faster variants in the middle |

## Pack datasets

Tanzania full, warehouse complete (18 GB). A test pack with 11 datasets, made by lifting each slow
report's leading steps that take no parameter. Installed through `market install`.

| Date | Commit | What | Time |
|---|---|---|---|
| 2026-11-19 | feat/pack-datasets before the review fixes | install: build all 11 datasets (four were built twice by a fault since fixed) | 205 s |
| 2026-11-19 | same | automatic rebuild of all 11 after one record was saved | about 95 s |
| 2026-11-19 | 6f2999cd | rebuild all 11 with the guarded build (rows read read-only into a working table, then copied) | 151 s |
| 2026-11-19 | 6f2999cd | largest dataset, 4,239,703 rows, guarded build | 32 s and 60 s (two datasets of that size) |

Reports, original against the one rewritten to read a dataset, same parameters. Every output was
equal row for row.

| Date | Report | Before | After |
|---|---|---|---|
| 2026-11-19 | Date completeness by lab area | 31.4 s | 2.9 s |
| 2026-11-19 | VL turnaround by month | 5.7 s | 0.7 s |
| 2026-11-19 | Date completeness by lab | 5.8 s | 0.6 s |
| 2026-11-19 | Requests received by week | 47.9 s | 20.8 s |
| 2026-11-19 | Requests received by week (VLEID copy) | 20.7 s | 13.7 s |
| 2026-11-19 | VL results | 12.6 s | 7.7 s |
| 2026-11-19 | Client by ART number | 13.6 s | 8.2 s |
| 2026-11-19 | Days since last transmission | 8.8 s | 8.1 s |
| 2026-11-19 | All eight | 147 s | 63 s |

Not proved: 9 of the 18 slow reports have a first step that takes a parameter and could not be
lifted this way. They need the report rewritten. One rewritten report was not compared, because the
script gave it a blank for a required date. The report times are from before the guarded build and
were not taken again, since the built tables hold the same rows.

## Reports pack with datasets (reports-zm 0.2.0, not published)

Tanzania full, warehouse complete. The 7 queries that changed, the published 0.1.2 SQL against the
SQL of the pack built with two datasets, same parameter values, on the standalone at CE 0.1.12-demo.8.
Pack repo commit: see `openldr-ce-content-pack-reports-zm`. 29 cases compared, 29 with identical
rows. The other 67 queries are unchanged.

| Date | Query | Parameters | Before | After |
|---|---|---|---|---|
| 2026-11-19 | Date completeness by lab | four date ranges | 6.2 to 7.0 s | 1.6 to 2.0 s |
| 2026-11-19 | Date completeness by lab facility | EID, 2017 | 1.4 s | 1.1 s |
| 2026-11-19 | Date completeness by lab facility | VL, 2018 | 6.0 s | 1.8 s |
| 2026-11-19 | Date completeness by lab area | all dates | 37.7 s | 9.8 s |
| 2026-11-19 | Date completeness by lab area | three date ranges | 34.6 to 35.4 s | 3.5 to 4.1 s |
| 2026-11-19 | Turnaround times by lab | all, all dates | 43.7 s | 14.4 s |
| 2026-11-19 | Turnaround times by lab | all, from 2018-05-31 | 38.5 s | 6.0 s |
| 2026-11-19 | Turnaround times by lab | EID, 2017 | 141.8 s | 0.5 s |
| 2026-11-19 | Turnaround times by lab | VL, 2018 | 6.7 s | 1.7 s |
| 2026-11-19 | VL turnaround by month | four date ranges | 6.0 to 6.7 s | 1.2 to 1.9 s |
| 2026-11-19 | Requests received by week | three date ranges | 48.2 to 50.5 s | 14.1 to 16.4 s |
| 2026-11-19 | Requests received by week (VLEID copy) | four date ranges | 21.4 to 100.3 s | 11.3 to 12.1 s |
| 2026-11-19 | All 29 cases | | 866 s | 165 s |

The two datasets built in about 70 s together when the pack was installed (4,239,703 rows and 1 row).

A fault found on the way and fixed before this table: one case (lab facility, EID) took 171 s on the
first build of the new pack against 1.4 s before, because PostgreSQL redid the lab-name step for each
of 36,010 rows. Not proved: many labs. The Tanzania data has one lab code, so each lab query
returns one lab. The generator's own 13,049 check cases cover several labs.


## Reports pack with five datasets (reports-zm 0.2.0, commit c7f6ce4, not published)

Tanzania full, warehouse complete, standalone at CE 0.1.12-demo.8. Three more datasets
(`zm_request_ids`, `zm_vl_tested_by_month`, `zm_lab_dist`), so 20 of 74 queries read a dataset. The
published 0.1.2 SQL against the new SQL, same parameter values. 60 cases compared, 60 with identical
rows; 21 refused by both with the same message. The 7 lab queries are measured again here with the
rest. Evidence: `~/.local/share/demo5-evidence/zm-pack/compare-run3.txt` (all 20),
`compare-run4-materialized.txt` and `time-small-run3.txt`, `time-small-run4.txt` (after the fix
below).

| Date | Query | Parameters | Before | After |
|---|---|---|---|---|
| 2026-11-19 | Client by ART number | blank (1,550,756 rows) | 15.9 s | 11.6 s |
| 2026-11-19 | Client by ART number | one ART number, two values | 5.9 to 6.0 s | 1.9 s |
| 2026-11-19 | VL results for a facility's clients | 2017, 2018 | 5.2 to 7.4 s | 4.3 to 7.0 s |
| 2026-11-19 | VL requests and tests by lab and month | four date ranges | 5.1 to 5.4 s | 1.8 to 2.2 s |
| 2026-11-19 | VL throughput by lab and month | 2017, 2018, 2019 | 3.9 to 4.8 s | 0.6 to 1.4 s |
| 2026-11-19 | Days since last transmission | three dates | 9.7 to 11.1 s | 9.2 to 10.5 s |
| 2026-11-19 | VL and EID weekly stats | 2017, 2018 | 7.4 to 11.3 s | 6.4 to 10.6 s |
| 2026-11-19 | Seven facility-level queries | 2017, 2018, median of 5 | 7.5 to 28.3 ms | 7.2 to 25.6 ms |
| 2026-11-19 | All 60 cases | | 1081 s | 272 s |

A fault found on the way and fixed before commit: "Unique VL clients by facility (12 months)" took
about 1 s against 11 ms in 0.1.2, and "Unique VL clients" and "DBS monitoring" were 4 to 7 ms
slower. PostgreSQL scanned the ids table in parallel and joined every request before finding that
no facility is mapped. Those three now read the ids as a materialized step: 11 to 26 ms, within 1 ms
of 0.1.2. Materialized in every query was worse: "Client by ART number" went from 2.0 s to 5.3 s.

Not proved: the seven facility-level queries return nothing here (no facility code is mapped in the
Tanzania data), so their speed on real Zambia data is not measured. The lab queries return one lab.

## Requisition lookup fill (migration 139, `openldr lab requisitions rebuild`)

Dataset **Synthetic 1M**: 1,000,000 per-test ServiceRequests (500,000 requisition numbers, 300
facilities) written straight into the FHIR tables of a clean standalone install on the Linux box
(32 cores, 90 GB), embedded Postgres at its default settings. No change log rows, so nothing else ran.

| Date | Commit | Dataset | What | Time |
|---|---|---|---|---|
| 2026-11-23 | 37d58cd | Synthetic 1M | `openldr lab requisitions rebuild --force` (the fill 139 runs, then the sweep) | 1 min 38 s for 1,000,005 rows |

At that rate the Tanzania full store (2,326,075 requests, one request per test there) would take
about 4 minutes, once, on the boot that runs 139. Not proved: 139 itself inside the migrator's single
transaction, and real DISA request shapes. Evidence: the session scratchpad `lab-proof/r2/rebuild-time.txt`.
