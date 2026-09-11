# F02: report publishing instructions

Implemented in `codex/report-publishing-docs`, based on `e7ae07f7`.
Worktree: `.worktrees/report-publishing-docs`. The operator authorized local commit and merge.

## Evidence and scope

The refutation check was whether the designer still used one Publish action for both outcomes. It does not.

- `apps/studio/src/docs/0.1.0/en/report-designer.md:30` previously combined publishing and creating a library report.
- `apps/studio/src/report-designer/CanvasHeader.tsx:165` and line 166 expose separate actions.
- `apps/studio/src/report-designer/ReportDesignerPage.tsx:476` publishes the template revision. Line 655 opens the report-creation sheet; line 659 confirms the created report's name.
- `apps/studio/src/reports/NewReportSheet.tsx:95` requires Name, Category, Template, and Primary query. Line 103 creates the report definition.
- `apps/server/src/report-defs-routes.ts:25` creates a report definition through the report store, separately from template publication.

The English guide now explains both actions and their outcomes. It includes the creation sheet's menu, required fields, selected query, confirmation names, and a saved-query-to-report example. French and Portuguese guides cover the same sequence. The public Getting started page includes the distinction in all three languages.

Only Markdown changed. No report, template, API, CLI, permission, or layout behavior changed. The existing designer screenshot was reused. No annotations or new captures were added.

## Verification

Commands ran from the worktree.

| Command | Output |
| --- | --- |
| `pnpm --filter @openldr/studio test -- src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers 1 --minWorkers 1` | 31 tests passed, 2 files passed, exit 0 |
| `pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1` | 14 tests passed, 1 file passed, exit 0 |
| `git diff --check` | exit 0 |

Baseline Studio documentation checks also passed all 31 tests. No new tests were added for prose changes.

The public guide rendered all three language sections. Its Report publishing link scrolled to the section while retaining the documentation route. At 375x812, document scroll width was 365 pixels and the heading settled about 80 pixels from the top. The English and French instructions wrapped within the viewport.

HONEST NON-PROOF: documentation checks do not prove report execution or export correctness. No live report or template was created or modified. No physical-phone test was run. Studio translations were checked against source labels and the documentation loader, but were not separately opened in the browser. No full application suite or typecheck was run for this Markdown-only change.

## Handoff

The preview server was stopped and its browser tab closed. The viewport override was reset. Test logs are retained in the main checkout's ignored `.worktrees/review-evidence/report-publishing-*.log` files.

The operator authorized committing and merging this slice locally. Do not add AI contribution trailers. After merging, run `pnpm make:changelog` and commit any generated changes. A docs-only commit is excluded from public changelog entries.
