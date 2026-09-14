# Remaining UI tasks proof

Approved scope: clarify the connector column and convert registry and report-schedule editors to sheets. Worktree `.worktrees/ui-sheets`, branch `codex/ui-sheets`, base `3ba69508`.

## Changes

- Renamed Host to Allowed plugin host. Page guidance distinguishes the plugin network restriction from a saved connection address. Host connector addresses remain available through Edit.
- Converted registry creation and editing to a sheet. Save is in the header's action menu. Empty required fields and busy state disable Save.
- Converted schedule creation and editing to a sheet. Save is in the header's action menu. Existing payloads, date-window handling, callbacks, and errors remain unchanged.
- Both sheets place labels beside inputs and use dynamic viewport height with a scrollable body.
- Updated English, French, and Portuguese UI copy and current Studio and web docs. Historical 0.1.0 docs remain unchanged.

No backend or CLI behavior changed. Registry deletion retains its confirmation dialog because it is a destructive confirmation, not an editor. The schedule-list drawer's existing New, Edit, Run, and Delete controls were outside the approved editor conversion and remain unchanged.

## Tests

Baseline command:

`pnpm --filter @openldr/studio exec vitest run src/pages/settings/Connectors.test.tsx src/pages/settings/marketplace/RegistriesTab.test.tsx src/reports/ScheduleDialog.test.tsx src/pages/settings/Marketplace.test.tsx --maxWorkers 1 --minWorkers 1 --silent --testTimeout 30000`

Result: 48 passed across four files. After changing the registry and schedule tests to require menu saves, both failed on the old standalone Save buttons. The implementation made both pass.

Final Studio command:

`pnpm --filter @openldr/studio exec vitest run src/pages/settings/Connectors.test.tsx src/pages/settings/marketplace/RegistriesTab.test.tsx src/reports/ScheduleDialog.test.tsx src/pages/settings/Marketplace.test.tsx src/i18n/parity.test.ts src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers 1 --minWorkers 1 --silent --testTimeout 30000`

Result: 96 passed across seven files, 26.17 seconds. Coverage includes registry create and edit payloads, closing without saving, schedule update payloads, fixed date-window exclusion, save failure, and translation parity.

`pnpm --filter @openldr/web exec vitest run src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1 --silent --testTimeout 30000`

Result: 18 passed, 4.80 seconds.

`pnpm --filter @openldr/studio typecheck`: exit 0. An earlier run rejected an unsupported id prop on the shared Switch. The editor now uses its supported aria-label prop.

`pnpm --filter @openldr/studio build`: exit 0, 4,635 modules transformed, 19.38 seconds. Dependency annotation and large-chunk warnings remain.

`git diff --check`: exit 0, with Git's CRLF conversion warnings.

These are focused component and documentation tests, not the complete repository suite.

## Browser checks

Used a separate headed Chromium session with real Keycloak sign-in. AUTH_DEV_BYPASS stayed disabled. Browser-only request forwarding loaded the worktree frontend on port 5174 under the existing localhost origin. Main Studio on port 5173 was not replaced.

- Registry sheet opened from the existing page menu. Save was disabled with empty fields and enabled after entering name and location. Closing discarded the unsaved draft.
- Registry sheet visually inspected on desktop and at 375 by 812. Its bounding box stayed inside the mobile viewport.
- New schedule sheet opened through the real report and schedule-list UI. Desktop and mobile screenshots were inspected. Day 28 could be selected in the monthly dropdown. The Save menu item was reachable on mobile.
- Connector page showed the renamed column and explanatory text on desktop.

No registry, schedule, or connector was created, saved, or removed during browser checks. Save payloads were verified at the component/API boundary using test doubles, not live persistence. A later attempt to inspect an existing schedule stopped after the development page reloaded and its editor was no longer open. Existing-schedule payload handling passed the component test.

Screenshots are ignored files under `output/playwright`: registry-desktop.png, registry-mobile.png, schedule-desktop.png, schedule-mobile.png, and connectors-desktop.png. Development browser logs include hot-reload connection errors and React Router warnings.

HONEST NON-PROOF: Chromium viewport checks cannot verify retractable browser chrome on a real phone. No physical-phone test was performed. French and Portuguese were checked by translation parity and source review, not browser screenshots.

## Review and handoff

Independent read-only review reported zero actionable findings in the approved scope.

## Approved merge

The operator approved merging. Main fast-forwarded to `d841622b`.

`pnpm test` passed before and after the merge. Each run reported 35 successful tasks, with 33 cached tasks for unchanged packages. Studio ran 2,130 tests across 232 files. Web ran 103 tests across 15 files. The post-merge command exited 0 in 3 minutes 59.617 seconds.

`pnpm make:changelog` ran after merging and generated 2,714 entries across 71 days. Its new entry names this editor change. Nothing was pushed. The operator's review reports and older stale worktree directories were not changed.

Screenshots were preserved in the main checkout under `output/playwright/ui-sheets/` before worktree cleanup.
