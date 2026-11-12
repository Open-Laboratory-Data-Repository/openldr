# Guide review repairs

The operator approved B1-B7 and the contents-menu change on 2026-11-12.
The original findings and failure evidence remain in [BUGS.md](BUGS.md).
The repairs were checked against an isolated app using real PostgreSQL.

| Finding | Change | Live proof |
| --- | --- | --- |
| B1 | Report updates accept saved null metadata. Unpublish changes the report to Draft. | [Report requests](bugfix-evidence/report-live-proof.json), [phone requests](bugfix-evidence/report-mobile-proof.json) |
| B2 | Shared report execution binds flat dates to declared query ranges. | [Report requests](bugfix-evidence/report-live-proof.json), [CLI exports](bugfix-evidence/report-cli-isolation-proof.json), [range IDs from and to](bugfix-evidence/edge-api-proof.json) |
| B3 | Marketplace details derive current flags while retaining the selected package version. | [Desktop and phone toggles](bugfix-evidence/marketplace-theme-proof.json) |
| B4 | Logo errors name PNG and JPEG in all three languages. WebP remains unsupported. | [Translated errors](bugfix-evidence/copy-live-proof.json), [actual WebP rejection](bugfix-evidence/edge-api-proof.json) |
| B5 | The role permission describes the existing dashboard-builder column policy. | [Translated descriptions](bugfix-evidence/copy-live-proof.json) |
| B6 | Form help separates View/Run from submission. Restore copy describes the conditional Draft change. | [Rendered form help and controls](bugfix-evidence/copy-live-proof.json) |
| B7 | The optional Reference Plugin follows host theme messages without reloading. | [Page, widget and panel contrast](bugfix-evidence/marketplace-theme-proof.json) |

The contents menu now lists H2 task headings. Numbered H3 steps stay in the article.
The menu scrolls its own list to keep the active task visible.
The title stays visible. The article does not scroll when that list follows a task.
Test catalog has 17 task links and retains all 59 numbered steps.
[Desktop and phone checks](bugfix-evidence/docs-toc-proof.json) record the result.
Subpages were not added.

## Guides and images

Query, Report Designer, Reports, Marketplace and Plugin sites were updated in English, French and Portuguese.
The obsolete report-date, Unpublish, stale-menu and dark-theme workarounds were removed.
The web CLI reference explains report dates in all three languages.
The successful Unpublish screenshot has a native 5120 by 3200 source.
The original failure screenshot remains available as review evidence.
No documentation sample data is required by these repairs.
[Browser checks](bugfix-evidence/updated-guides-browser-proof.json) passed all 15 updated guide pages.
They checked image counts, native sources, anchors and matching page/lightbox framing.

## Commands and results

[Automated checks](bugfix-evidence/automated-checks.json) records commands, output summaries and exit codes.
The selected tests passed 194 Studio, 46 server, 76 bootstrap, 8 reporting, 19 query-runner,
20 permission, 22 logo and 29 web-doc checks. Two browser theme tests passed.
Studio, bootstrap, server, reporting, permission and browser-test typechecks returned zero.
Studio and web production builds returned zero. Existing dependency and bundle-size warnings remain.
These checks cover the changed behavior. They are not a full repository test run.

Run these scripts from the repository root against the isolated app on ports 3010 and 5190.
They must run sequentially because several change the same test account's preferences.

```sh
node docs/review/user-guide/bugfix-evidence/check-report-bugs.cjs
node docs/review/user-guide/bugfix-evidence/check-report-mobile.cjs
node docs/review/user-guide/bugfix-evidence/check-edge-api.cjs
node docs/review/user-guide/bugfix-evidence/check-marketplace-theme.cjs
node docs/review/user-guide/bugfix-evidence/copy-check-live.cjs
node docs/review/user-guide/bugfix-evidence/check-docs-toc.cjs
node docs/review/user-guide/bugfix-evidence/check-updated-guides.cjs
```

The report script returned creation 201, Unpublish 200, report runs 200 and JSON/CSV/PDF 200.
The CLI script returned zero for JSON, CSV and PDF using the private isolated environment.
Its credentials are not committed. Its database and bucket guards reject other installations.
Marketplace desktop and phone toggles returned 200 without reopening details.
The theme check passed light/dark changes for the page, widget and panel.
All checked textarea contrast ratios exceeded 4.5. Iframe documents stayed unchanged.
The copy check passed three languages without saving roles or lab settings.
The contents check returned `DOCS TASK TOC PASS 17 tasks, 59 article steps; active visible; mobile task menu`.

## Isolation and limits

Only `guide_bugfix_internal`, `guide_bugfix_target` and `openldr-docs-bugfix-review` received test content.
Sync and update checks were disabled before startup. Identity administration was disabled.
No normal database was reset, migrated or seeded. No normal bucket was changed.
The test copy of the form remains Draft. Source form, roles and lab settings stayed unchanged.
Only the owned Reference Plugin was installed and toggled.

HONEST NON-PROOF: headless checks at 375 by 812 do not prove retractable phone browser chrome.
A real phone must confirm bottom-edge access. Physical phone testing was not performed.
The form check inspected restore confirmation without restoring or submitting responses.
Archived-form capture was not repeated. Existing form-store behavior was left unchanged.
The existing status helper can republish through the API, but no Draft republish control exists in the library.
The guide does not claim that control exists.

Three existing environment-doc formatting tests also fail on unchanged main at `8a04b7b5`.
[The baseline check](bugfix-evidence/baseline-envdocs-proof.json) records this separately.
The command below returned three failed and five skipped tests.
Both variable names already appear in each document, but lack the backticks required by the test.
No environment instructions were added or removed in this repair.

```sh
pnpm --filter @openldr/config exec vitest run src/env-docs.test.ts -t 'apps/studio/src/docs/0\.1\.8/(en|fr|pt)/environment\.md lists every env var'
```

Unrelated observations were left unchanged. FormCapture has English action and status text in other languages.
Marketplace's existing installed-card keys warn when multiple versions share an ID.
The new selected-version regression test passes despite that existing warning.
The existing lightbox can require vertical scrolling on wide windows at 100% zoom.
That behavior was not changed by this repair.
These observations did not expand the seven approved repairs.
