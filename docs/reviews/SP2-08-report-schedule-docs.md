# SP2-08 report schedule guidance

Documentation changes are ready for review on `codex/report-schedule-docs`, based on `65c5f46d`.
The operator approved this documentation-only slice. The operator authorized local commit and merge.

## Evidence and scope

The refutation check was whether the existing Reports guide already explained schedule timing, date windows, and downloads. It only directed readers to Schedules at `apps/studio/src/docs/0.1.0/en/reports.md:29`. The guide now explains the schedule journey. French and Portuguese Reports guides cover that journey too. All Studio guides reference the existing report screenshots.

The separate claim that Run now lacked feedback was refuted. `apps/studio/src/reports/ReportSchedulesDrawer.tsx:61` already shows the queued notification. No notification behavior changed.

The public guide has its own `report-schedules` slug, title, and navigation entry. It contains English, French, and Portuguese sections. Getting started was not changed.

| Documented behavior | Source proof |
| --- | --- |
| Frequencies use 06:00 UTC; daily starts tomorrow, monthly starts next month | `packages/reporting/src/schedule-period.ts:14` |
| Weekly excludes today; quarterly starts at the next quarter | `packages/reporting/src/schedule-period.ts:21`, `packages/reporting/src/schedule-period.ts:32` |
| Automatic previous-day, seven-day, month, and quarter windows use UTC | `packages/reporting/src/schedule-period.ts:39` |
| The scheduler replaces date-range parameters at execution time | `packages/bootstrap/src/report-scheduler.ts:50`, `packages/bootstrap/src/report-scheduler.ts:56` |
| Run now uses the same execution function | `packages/bootstrap/src/report-scheduler.ts:96` |
| New schedules copy current filters but remove from/to | `apps/studio/src/reports/ScheduleDialog.tsx:41` |
| Next and Last display browser-local timestamps | `apps/studio/src/reports/ReportSchedulesDrawer.tsx:98` |
| History reloads on entry or pagination, without polling | `apps/studio/src/reports/ReportHistoryDrawer.tsx:56` |
| Scheduled history exposes failed errors through a hover title and successful downloads | `apps/studio/src/reports/ReportHistoryDrawer.tsx:140`, `apps/studio/src/reports/ReportHistoryDrawer.tsx:144` |
| Successful and failed attempts update Last | `packages/bootstrap/src/report-scheduler.ts:77`, `packages/bootstrap/src/report-scheduler.ts:84`, `packages/bootstrap/src/report-scheduler.ts:91` |
| Output download reads the stored file | `apps/server/src/reports-routes.ts:186` |

## Existing behavior left unchanged

- Run now accepts a disabled schedule and displays a queued notification, but execution returns without recording a run. Proof: `apps/server/src/reports-routes.ts:171`, `packages/bootstrap/src/report-scheduler.ts:47`, `apps/studio/src/reports/ReportSchedulesDrawer.tsx:61`. The guide tells readers to enable it first.
- A disabled schedule still displays its stored Next timestamp. Proof: `apps/studio/src/reports/ReportSchedulesDrawer.tsx:98`. The guide tells readers to check the switch.
- Failed-run details rely on a hover title. Proof: `apps/studio/src/reports/ReportHistoryDrawer.tsx:140`. The guide limits that instruction to desktop. No mobile error-detail control was added.

No scheduler, API, permission, CLI, or report layout changed. No new screenshots were captured. The two existing Studio screenshots were reused. No generated landing content changed. Changelog generation belongs after an authorized merge to main.

## Verification

Commands ran from `.worktrees/report-schedule-docs`.

| Command | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Exit 0 |
| `pnpm --filter @openldr/studio test -- src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers 1 --minWorkers 1` | 31 tests passed, 2 files passed, exit 0 |
| `pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1` | 15 tests passed, 1 file passed, exit 0 |
| `git diff --check` | Exit 0; only CRLF conversion warnings |

The new web test checks the guide route, active navigation entry, and three language headings. Studio tests check document registration, links, and declared screenshots. Logs are in the main checkout's `.worktrees/review-evidence/report-schedule-install.log`, `report-schedule-studio-tests.log`, and `report-schedule-web-tests.log`.

HONEST NON-PROOF: these tests do not exercise live schedule execution, stored output retrieval, or a physical phone. No application typecheck or full suite was run for the documentation change. The browser pass is assigned to the parent task and must be recorded separately. Existing web tests print jsdom navigation warnings while passing.

## Combined browser verification

The parent task opened this public guide in the temporary combined checkout. All three language sections rendered. At 375x812, document scroll width was 365 pixels. All five batch guides appeared in public navigation. No physical-phone or live business-operation test was performed.

The combined checkout passed 46 Studio tests, including 15 temporary authored-locale and link checks, and 15 public-doc tests. Studio typecheck exited 0. Preserve all five public guide entries and both new Studio guide entries during the later merge.
