# P06 complete report exports

The approved bound remains 1,000 rows per stored query. A 1,001st row refuses the export.

## Falsification

The disproof would have been an existing completeness check after the connector's cap. Before this change, `packages/dashboards/src/custom-query-run.ts:65` returned the capped result directly. There was no completeness check. `packages/report-designer/src/render/resolve.ts:42` converts query failures into per-element placeholders, so throwing alone would still produce a normal PDF.

## Changes

- `packages/dashboards/src/custom-query-run.ts:46` defines a typed refusal with HTTP status 422 and a filter/date-range instruction.
- `packages/dashboards/src/custom-query-run.ts:74` requests 1,001 rows. It returns at most 1,000 complete rows or throws. The saved SQL remains unchanged, including intentional LIMIT clauses.
- `packages/bootstrap/src/index.ts:306` retains an overflow caught by the design resolver and refuses before rendering. Other query errors keep their existing behavior. Designer previews keep their per-element error display.
- `apps/studio/src/api.ts:221` preserves the CSV error response. `apps/studio/src/reports/ReportSpreadsheetTab.tsx:68` displays the refusal and records export success only after downloading.
- Studio reports documentation and public schedule documentation explain the bound in English, French, and Portuguese.

## Execution paths

| Entry | Shared path and refusal behavior |
| --- | --- |
| Report Run and spreadsheet data | `packages/bootstrap/src/index.ts:284` calls the stored-query runner. The API returns an error without rows. |
| CSV download and GLASS CSV | `apps/server/src/reports-routes.ts:57` and `:67` call reporting.run before serializing CSV. |
| Published PDF | `packages/bootstrap/src/index.ts:306` checks every bound query. A secondary query overflow refuses even if the primary query fits. |
| Studio XLSX save | `apps/studio/src/reports/ReportSpreadsheetTab.tsx:84` exports the already accepted result. Local spreadsheet filters remain intentional. |
| Scheduled CSV, XLSX, and PDF | `packages/bootstrap/src/report-scheduler.ts:60` and `:65` call shared reporting. Refusal precedes blob storage at `:76`. Failure has a null object key at `:87`. |
| CLI report run and GLASS export | `packages/cli/src/report.ts:44`, `:50`, and `:70` call shared reporting before writing. An existing PDF file remains untouched on refusal. |
| Designer preview | `apps/server/src/report-designs-routes.ts:171` keeps the existing diagnostic placeholder behavior. This is not published report generation. |
| Download an existing scheduled artifact | `apps/server/src/reports-routes.ts:186` reads an existing object. Previously saved outputs are not regenerated. |

## Checks

- `pnpm --filter @openldr/dashboards exec vitest run src/custom-query-run.test.ts src/sql-runner.test.ts`: 31 tests passed. Includes zero, 999, 1,000, overflow, and an intentional SQL LIMIT using pg-mem.
- `pnpm --filter @openldr/bootstrap exec vitest run src/reporting-row-limit.test.ts src/reporting-data-driven.test.ts src/reporting-param-format.test.ts src/report-scheduler.test.ts src/index.test.ts`: 61 tests passed before the additional secondary-query scheduling case.
- `pnpm --filter @openldr/server exec vitest run src/reports-routes.test.ts`: 34 tests passed. JSON, CSV, and PDF refusal is HTTP 422 with JSON errors and no attachment headers.
- `pnpm --filter @openldr/cli exec vitest run src/report.test.ts`: 7 tests passed. Refused CSV writes nothing to stdout. Refused PDF preserves the existing file.
- `pnpm --filter @openldr/bootstrap typecheck`: exit 0.
- `pnpm --filter @openldr/server typecheck`: exit 0.
- `pnpm --filter @openldr/studio typecheck`: exit 0.
- `pnpm --filter @openldr/bootstrap exec vitest run src/reporting-row-limit.test.ts`: 5 tests passed, including a scheduled PDF whose primary query fits and secondary query exceeds the bound.
- `pnpm --filter @openldr/studio exec vitest run src/api.reports.test.ts src/reports/ReportSpreadsheetTab.test.tsx src/reports/ReportDocumentTab.test.tsx --testTimeout 30000`: 12 tests passed. Covers the visible CSV reason, no success beacon on refusal, and existing PDF error rendering.
- `git diff --check`: exit 0.

The original stored-query regression failed by resolving 1,000 rows instead of rejecting. Shared report regressions also failed by returning partial data and a PDF. The CSV API regression failed with generic `failed: 422`, proving it discarded the reason.

## Limits

HONEST NON-PROOF: connector responses are injected in refusal tests. pg-mem proves the nested LIMIT case only. No live PostgreSQL, MySQL, or SQL Server query was run. Real connector tests would prove the server-side probe against each engine.

HONEST NON-PROOF: no browser or real-phone layout pass was run. This change uses the existing toast and PDF error display. No bottom-anchored layout changed. API refusal messages remain English, matching existing server error handling. The documentation is translated.

An earlier successful result or stored artifact remains available after a later refusal. This change does not regenerate historical exports. It does not stream unbounded results or raise the report row bound.

No commits, merges, pushes, live data writes, or changelog generation were performed. The integrating agent must generate the landing changelog after merging to main. P10 also edits bootstrap index.ts, so integration must preserve both changes.
