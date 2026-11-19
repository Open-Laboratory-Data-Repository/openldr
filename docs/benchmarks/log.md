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

## Import: processing (the check)

| Date | Commit | Dataset | Change | Requests a second |
|---|---|---|---|---|
| 2026-11-19 | before item 16 | Bench 5k | start of the session | 50 |
| 2026-11-19 | decode-ahead | Bench 5k | decode the next page off the main thread | 165 to 177 |
| 2026-11-19 | hash skip | Bench 5k | skip a save whose content is unchanged | 272 to 279 |
| 2026-11-19 | set-based save | Bench 5k | one statement per page, three pages decoded ahead | 544 to 548 |
| 2026-11-19 | 770f37f2 | Bench 5k | one copy of each document | 525 to 537 |
| 2026-11-19 | 770f37f2 | Tanzania full | whole run, projection running beside it | 625 to 680 |

Tanzania full, whole run at 770f37f2: 60 minutes. 2,130,022 saved, 163,451 held, 32,602 failed.

## Import: copy

| Date | Commit | Dataset | Time | Requests a minute |
|---|---|---|---|---|
| 2026-11-19 | 770f37f2 | Tanzania full | 58.6 min | 39,720 average, 27,575 slowest minute, 53,500 fastest |

19.9 GiB copied. Page size 500. No interruption.

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

