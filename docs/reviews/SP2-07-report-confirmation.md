# SP2-07: report creation confirmation

Status: implemented and verified; local merge authorized by the operator. Branch: `codex/report-create-feedback`.
Base: `c363bdb2`. Worktree: `.worktrees/report-create-feedback`.

## Change

The creation sheet returns the saved report record to its caller. Report Designer uses that report's name in the success notification. It previously used the template name.

The existing English, French, and Portuguese message translations remain in use. No API, CLI, schema, layout, or permission changes were needed. This slice changes feedback only. The earlier documentation workflow findings remain separate.

## Verification

- Baseline: 37 tests passed.
- Regression check before implementation: 1 failed, 7 passed. The callback lacked the saved report record.
- Final command: `pnpm --filter @openldr/studio test -- src/reports/NewReportSheet.test.tsx src/report-designer/ReportDesignerPage.test.tsx --maxWorkers 1 --minWorkers 1`.
- Output: 2 files passed, 37 tests passed, exit 0.
- `pnpm --filter @openldr/studio typecheck`: exit 0.
- Live browser: created `Review Fix - Report confirmation` from `Review P2 - Synthetic report`. Notification read `Published “Review Fix - Report confirmation” as a report`. Template retained its original name.
- Translation check: English, French, and Portuguese messages interpolate the supplied report name.
- Independent diff review found no introduced defects.

Existing React Router and React act warnings occurred in the baseline and final tests. They are not new failures.

HONEST NON-PROOF: the browser creation check used English. No physical-phone test was run. The notification layout is unchanged.

## Handoff and merge

A synthetic library report named `Review Fix - Report confirmation` remains in the development API for inspection. No clinical data was entered.

The operator authorized committing and merging this fix locally. Do not add Claude, Codex, or other AI contribution trailers. At authorized merge, generate the landing changelog after the fix enters main, as AGENTS.md requires.

Temporary preview server stopped. Test logs are retained under the main checkout's ignored `.worktrees/review-evidence/report-create-feedback/` directory.
