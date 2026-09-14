# Access-denied page and settings copy proof

Scope: approved tasks 1 and 2 only. Branch `codex/access-copy`, base `896eed9c`.

## Changes

Signed-in users without a route's capability go to `/access-denied`. The dashboard root requires `dashboards.view`. The denial page retains available navigation, Docs, and the user menu. Anonymous routing remains unchanged.

General settings now describe the configured PostgreSQL, MySQL, or SQL Server warehouse. Timeout wording covers builder and raw SQL. Raw SQL returns up to the row cap. Builder queries error when database groups exceed the cap, before further aggregation. English, French, Portuguese, and current Studio and web docs were updated. Historical 0.1.0 docs were not changed.

Backend permissions and execution logic were not changed. No new CLI capability was introduced. Host column and editor conversions remain outside this slice.

## Automated checks

All commands ran from this worktree.

- `pnpm --filter @openldr/studio typecheck`: exit 0, no TypeScript errors.
- `pnpm --filter @openldr/studio build`: exit 0, 4635 modules transformed, built in 13.49 seconds. Dependency annotation and large-chunk warnings remain.
- `git diff --check`: exit 0, no whitespace errors. Git reported CRLF conversion warnings.
- `pnpm --filter @openldr/studio exec vitest run src/auth/AccessDeniedPage.test.tsx src/auth/RequireCapability.test.tsx src/pages/settings/General.test.tsx src/dashboard/DashboardPage.test.tsx src/i18n/parity.test.ts src/docs/registry.test.ts src/docs/validation.test.ts src/docs/search.test.ts src/auth/AuthProvider.test.tsx src/pages/settings/SettingsShell.test.tsx --maxWorkers 1 --minWorkers 1 --silent --testTimeout 30000`: 110 tests passed across 10 files, 28.74 seconds.

The denied-route regression failed before implementation, receiving home instead of access denied. The final guard tests pass. Component tests cover all three denial translations, Docs navigation, and the sign-out callback. Existing settings tests now expect the approved denial destination. The docs fallback test compares unknown versions with the current version, not historical content.

## Browser checks

Used a separate browser with real Keycloak sign-in and AUTH_DEV_BYPASS disabled. Browser request forwarding served this worktree from port 5174 under the existing localhost origin. The main server on port 5173 was not replaced.

Browser capability responses were fixtures, not changes to account permissions.

- Empty capabilities at `/studio/` reached access denied. A request listener observed zero dashboard API requests. Users navigation was absent.
- Docs navigation opened `/studio/docs`.
- Direct `/studio/users` reached access denied.
- A settings.view-only fixture at `/studio/settings/connectors` reached access denied with exactly one banner.
- Removing the fixture restored the admin General page and displayed the corrected row-limit description. The admin dashboard rendered before fixtures were applied.
- The denial page was visually inspected at 375 by 812 after reload. No document-level horizontal overflow was detected during the mobile check. An immediate resize screenshot caught a sidebar transition; a later close-menu attempt timed out because that button had moved outside the viewport. Reloading at the mobile size showed the settled layout.

Screenshots are ignored artifacts in `output/playwright/access-denied-desktop.png` and `output/playwright/access-denied-mobile.png`.

The browser logged blocked development hot-reload WebSocket connections during forwarded checks. Page reloads loaded the worktree files. These errors were not API authorization failures.

## Limits and review

HONEST NON-PROOF: capability fixtures prove client routing, not backend enforcement for a restricted account. No temporary user was created. Backend authorization was not retested in this slice.

HONEST NON-PROOF: desktop Chromium viewport checks cannot prove physical-phone browser chrome behavior. A real phone remains necessary for that check.

A full-App Vitest experiment stalled during collection and was removed. Browser checks exercised the actual App routes instead. This was a focused test run, not the complete repository suite.

Independent review found one incorrect row-cap claim. Source inspection confirmed that raw SQL truncates while builder overflow errors. All three translations and Studio documents were corrected. Recheck found no remaining blocker.

No commit, push, or merge was performed. Run `pnpm make:changelog` after an approved merge, following repository rules.
