# SP2-05 dashboard creation menu

Approved scope is dashboard creation from the existing dots menu. No commits or live mutations.

## Evidence and design

The refuting fact would be an existing New dashboard item in the populated dashboard menu.
At baseline, DashboardPage.tsx:84 defines handleNewDashboard, but its only caller is the empty state at line 191.
The menu starts at line 247 and contains edit, export, and import actions without creation.

Reuse handleNewDashboard in both view and edit modes. Keep the generated unique name.
Select the saved blank dashboard and enter edit mode. Announce its name after success.
Keep the selected dashboard on failure and provide a retryable error.
Disable creation while dirty edits await auto-save or while creation is pending.
The handler also guards both conditions, so rapid activation cannot duplicate requests.
Use an inline status and alert. No new sheet or dialog is needed.

## Plan

1. Add interaction tests for both modes, unique names, failure, pending edits, and duplicate clicks.
2. Observe failures before changing production code.
3. Add the menu action and guarded feedback to the existing handler.
4. Document the workflow in Studio and public docs in English, French, and Portuguese.
5. Run focused tests, typecheck, and available mobile checks.

## Limits

This UI discovery change adds no backend operation and requires no CLI command.
Changelog generation is deferred until the approved change merges to main.
No commits, merges, pushes, or live dashboard writes were requested.

## Verification results

- `git check-ignore .worktrees` printed `.worktrees` before worktree creation.
- `pnpm install --frozen-lockfile` exited 0 and installed the locked workspace dependencies.
- Initial `pnpm --filter @openldr/studio test src/dashboard/DashboardPage.test.tsx` failed as intended. Five new interaction cases could not find the New dashboard menu item; five existing cases passed.
- The additional pending-request edit test failed before its guard. It selected the new dashboard instead of retaining the edited dashboard.
- Final `pnpm --filter @openldr/studio test src/dashboard/DashboardPage.test.tsx src/docs/registry.test.ts src/docs/validation.test.ts` exited 0. Three files passed, 43 tests passed.
- Final `pnpm --filter @openldr/studio typecheck` exited 0 with no diagnostics.
- `git diff --check` exited 0. Git printed a line-ending conversion warning for the test file.

The interaction tests run the real page, menu, and store in jsdom. They replace network responses with fixtures.
They cover view/edit creation, generated names, feedback, retry, duplicate requests, and dirty edits before and during creation.
They do not prove server persistence, authorization, or real browser layout.
The run retains existing React Router future-flag and existing act warnings in the delete test.

Root verified the worktree preview on port 5179 at 375x812.
The New dashboard item appeared in view and edit menus.
The view menu bounds were x189 to349 and y98 to253. The edit menu also fit without horizontal overflow.
Only navigation and edit-mode toggling were used. No creation or saves were performed.
HONEST NON-PROOF: physical phone behavior and browser creation persistence remain untested.
Only a physical phone can confirm behavior beneath retractable browser chrome.
No bottom-anchored UI changed in this slice.

## Review notes

A completed create request checks the latest dirty state before selecting its result.
If edits appeared while waiting, the new dashboard remains available in the selector and the edits stay open.
Existing dashboard switching, import behavior, and auto-save sequencing were not refactored.
The French and Portuguese dashboard guides now resolve locally; the fallback test uses the untranslated start guide.
Public docs follow the existing single-page English, French, and Portuguese convention.


## Review follow-up

The reviewer reproduced a local editor draft race during pending creation.
A new interaction test failed because Add widget remained enabled.
Creation now blocks editor entry through menu handlers and grid editing.
The creation action also refuses while either editor is already open.
Final focused verification passed 43 tests across three files after this guard.

`pnpm --filter @openldr/web test src/docs/DocsPage.test.tsx` exited 0, with 15 tests passed.
That existing test emits jsdom scroll warnings. It checks the public docs component, not browser layout.
