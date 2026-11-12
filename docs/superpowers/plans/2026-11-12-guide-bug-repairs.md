# Guide review bug repairs

The operator approved B1-B7 in BUGS.md, live app checks, guide updates, main merge and push.
The operator also chose task headings and active-task following for the contents menu.
Reuse the isolated worktree on codex/fix-guide-review-bugs. Keep normal data untouched.

- [x] Recheck the seven findings against current source before changing code.
- [x] Repair report status updates at the shared schema boundary.
- [x] Bind flat report dates through shared query execution.
- [x] Derive Marketplace details from current package data.
- [x] Correct logo, exposure and form wording in all three languages.
- [x] Apply host theme changes to the optional reference plugin.
- [x] Verify task-only contents and active-task visibility in Studio.
- [x] Exercise all seven repairs against the isolated app and record native evidence.
- [x] Remove obsolete guide workarounds and replace the failed-status screenshot.
- [x] Run relevant tests, typechecks, builds and mobile layout checks.
- [x] Review the final diff, merge main, generate changelog, push and verify remote HEAD.

Root owns Marketplace, docs navigation, guides and integration.
Report-status and report-date agents own separate shared contracts and tests.
The copy/theme agent owns strings, capability description and sample CSS.
No new publishing controls, global exposure enforcement or image formats are in scope.
Keep unrelated findings separate. Do not reset or seed a normal installation.

Repair commit `30d9e025` was fast-forwarded to main.
The changelog and merged checks were committed as `a4220d3c`.
`git ls-remote origin refs/heads/main` returned `a4220d3c1c503b8f6bea28a16a8a30e2ca5a496b`.
The worktree stays available for the next task.
