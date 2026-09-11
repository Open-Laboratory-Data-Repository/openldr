# P12 dashboard refresh control

## Evidence and scope

The hypothesis would be false if pending widget requests blocked later timer ticks.
At base commit `2c7bc502`, `apps/studio/src/dashboard/DashboardWidget.tsx:48` starts requests without a pending guard. Line 51 uses `setInterval`. Cleanup at line 52 only prevents state updates. `apps/studio/src/api.ts:397` accepts no cancellation signal.

A deferred fetch reproduced four requests after 3.5 seconds with a one-second interval. The first request had not finished. The initial regression run also reproduced missing abort signals and a previous error hiding a later success.

The approved change covers browser refresh scheduling and obsolete response handling. It does not change SQL execution limits, saved dashboards, or query binding.

## Implementation

`DashboardWidget.tsx:47` creates an AbortController for the current query, filters, and refresh interval. Cleanup aborts the request and clears the timer. Both success and failure paths ignore obsolete requests. A successful request clears the previous error.

`DashboardWidget.tsx:60` schedules one timeout after the request settles. A slow request therefore delays the next refresh. Zero keeps automatic refresh disabled.

`api.ts:397` accepts an optional AbortSignal and passes it through authFetch to fetch. Existing callers can omit the signal. Query binding and request bodies retain their previous behavior.

Studio dashboard guides explain refresh timing in English, French, and Portuguese. The public dashboard refresh guide includes all three languages and has a navigation entry. The French and Portuguese sections must be combined with the SP2-05 dashboard guides during integration.

## Verification

Commands ran inside this worktree. No live service received test requests.

- Studio `pnpm exec vitest run src/dashboard/DashboardWidget.test.tsx` before implementation reported 5 failed and 9 passed. Failures covered overlap, missing signals, cleanup, and error recovery.
- Studio `pnpm exec vitest run src/dashboard/DashboardWidget.test.tsx src/api.dashboards.test.ts src/api.test.ts src/docs/registry.test.ts` reported 4 files passed and 43 tests passed.
- Studio `pnpm exec tsc --noEmit` exited 0 without output.
- Web `pnpm exec vitest run src/docs/DocsPage.test.tsx` reported 15 tests passed. Existing jsdom `window.scrollTo` and React Router warnings appeared.
- `git diff --check` exited 0. Git printed line-ending conversion warnings.

Component tests use real widget rendering and API helpers with deferred fetch responses. They cover completion-based timing, query and filter changes, late results and errors, unmount cleanup, retry recovery, and disabled polling. The docs fallback test now uses a guide that still lacks French content.

## Limits and integration

HONEST NON-PROOF: these tests prove the component and fetch boundary, not cancellation inside the database. Proving database cancellation requires server and driver evidence, outside P12.

HONEST NON-PROOF: no browser or real-phone check ran. The change adds no layout or bottom-anchored controls. A browser check with delayed mock responses could confirm network cancellation in a browser.

No CLI command applies to this browser lifecycle change. No commits, merges, pushes, or live writes ran. Changelog generation remains for the parent task after an authorized merge to main. P10 and P11 remain separate.
