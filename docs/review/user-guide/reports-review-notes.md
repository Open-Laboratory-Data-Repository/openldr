# Reports review

Six hypotheses checked: four confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| R1 | The guide requires documentation sample data. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/reports.md:28` requires it. | Start with an appropriate library report and received data. |
| R2 | The guide implies design publication creates the library entry. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/reports.md:24` says publication makes it appear. `apps/studio/src/reports/NewReportSheet.tsx:101` creates the separate record. | Name the separate Create report action. |
| R3 | Unpublish fails for a newly created custom entry. | CONFIRMED | The real UI PUT returned 400. `apps/studio/src/reports/reportDefsApi.ts:53` spreads null optional fields into the full body; `packages/reporting/src/report-def.ts:26` accepts an optional array, not null. See unpublish-failure.json. | Document Action failed and the retained entry. No app fix. |
| R4 | A workbench daterange query fails when bound directly to Reports. | CONFIRMED | `apps/studio/src/reports/ReportParametersBar.tsx:40` passes flat from/to. `packages/dashboards/src/custom-query-run.ts:28` reads a nested range. The earlier real request returned 400, required parameter: period. | Use the existing reporting pattern of two Text parameters named from and to. |
| R5 | CSV applies the visible spreadsheet filters and sort. | REFUTED | `apps/studio/src/reports/ReportSpreadsheetTab.tsx:68` re-runs CSV with report parameters. XLSX instead applies local filters at line 85. | Explain each export's actual row behavior. |
| R6 | A queued message proves a successful scheduled output. | REFUTED | `apps/server/src/reports-routes.ts:174` starts Run now and returns 202. The separate schedule-proof.json records success and the saved object. | Check Scheduled Runs and download its actual output. |

The preview has 53 numbered steps, 59 screenshot placements and 58 original captures.
Every numbered step has real UI evidence. Each task has eight steps or fewer.
Desktop PNGs are 5120 by 3200. Phone PNGs are 1500 by 3248.
The approved fixed frame, focus, blur and lightbox remain.
New writing was checked with unslop.
The original published guide and its images were not changed.

## Live work

Only isolated API 3007, Studio 5187 and PostgreSQL 15440 were used.
The report was created through the corrected Report Designer workflow.
Its query declares Text parameters from and to and includes the full end day.
No normal app database was reset or seeded.
All scheduled output used the separate bucket `openldr-docs-data-review`.
No email or external delivery service was used.

The browser searched the library, selected Request summary report, chose a real calendar preset,
ran it and read its PDF and Spreadsheet output.
It downloaded PDF, CSV and XLSX, refreshed the run and inspected Activity history.
Selecting a history row restored parameters without re-running the old output.
The browser applied a zero-value filter, configured a descending sort, inspected column controls,
reset the table and inspected pagination.
The count query returned one actual row, requests equal to zero.
The CSV contains requests followed by zero.
An XLSX read confirmed its requests column and numeric zero.
Both interactive and scheduled files have PDF signatures.
See run-proof.json, workbook-check.json and the downloaded files.

The browser created a Weekly Monday PDF schedule and used Run now.
The asynchronous run succeeded with rowCount 1 and a 1566-byte saved PDF.
Its period covered 2026-11-05 through 2026-11-11 in UTC.
The browser read OK in Scheduled Runs and downloaded the actual saved PDF.
It disabled the schedule, edited its output to XLSX and deleted it after confirmation.
The final schedule list is empty. See schedule-proof.json and schedule-cleanup.json.
The first switch assertion ran before the asynchronous update rendered.
A subsequent browser check confirmed it was off before editing and deletion.
No extra schedule was created during capture recovery.

The browser pinned and unpinned the main report and followed Edit template to its design.
Two disposable report definitions were prepared through the isolated API for management checks.
Their optional metadata matched the empty fields of a newly created UI report.
Unpublish returned 400 and the UI showed Action failed.
The entry remained published. No payload normalization or fixture edit hid the error.
The browser separately deleted the disposable deletion entry through its confirmation.
The main report and linked design remain. See unpublish-failure.json and manage-proof.json.
No app bug was repaired or worked around by changing production code.

The CLI used the same isolated database and ran the report with explicit from/to values.
Its command exited 0 and printed requests equal to zero. See cli-proof.json.
Identity administration was disabled and the issuer used an unused loopback port.
No active credentials, bearer tokens or webhook values are present in these artifacts.
The phone capture opened the library, chose dates, ran the report and read its zero-count spreadsheet.

## Checks and limits

`python3 docs/review/user-guide/write-guide-article.py reports` printed `Reports 53 numbered steps`.
`python3 docs/review/user-guide/build-guide.py reports Reports` printed
`59 equal screenshot frames, 53 steps, 58 original captures`.

`node docs/review/user-guide/check-guide-preview.cjs reports` returned 53 steps, 59 frames,
zero missing screenshots, no broken anchors, 5120px enlarged source and HTTP 200.
Its mobile preview had height 812 and no horizontal page overflow.
These checks prove screenshot coverage and preview layout.
The actual browser runs prove the isolated report, downloads and immediate schedule execution.
They do not prove every report or an automatic clock-triggered run.

`pnpm --filter @openldr/server test src/reports-routes.test.ts src/report-defs-routes.test.ts`
passed 44 tests across two files.
These route tests use injected stores and cover permission gates, validation and response behavior.
They do not prove the nullable fields returned by a real PostgreSQL record.
The live Unpublish failure demonstrates that limit despite their green results.

HONEST NON-PROOF: the empty warehouse cannot prove date-filter selectivity or large-result paging.
CSV versus filtered XLSX behavior was checked in source; the live exported result had one unfiltered row.
Failed scheduled output, disabled Run now, monthly and quarterly firing, browser remembered values
across a restart, print languages and physical printing were not exercised.
Physical phone browser chrome was not tested. Only a real phone confirms bottom-edge reachability.
The CLI PDF example was checked in source; the actual CLI exercise used JSON.
No production code, translations, public docs or landing changelog was changed.

## Rebuild

Run `python3 docs/review/user-guide/write-guide-article.py reports`, then
`python3 docs/review/user-guide/build-guide.py reports Reports`.
Capture phases are run, table, schedule, schedule-cleanup, manage, manage-failure and phone.
Run them sequentially and inspect persisted state before replaying schedule or management mutations.
Manage records the real Unpublish failure rather than manufacturing a successful result.
The root task registers preview navigation separately.
