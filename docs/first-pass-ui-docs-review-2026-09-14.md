10 findings: 9 refuted, 1 confirmed, 0 convention-conflict, 0 deferred.

# First pass: navigating Studio through its docs

Twenty inspected areas scored at least 8/10. General settings scored 7 because query descriptions are outdated. The arithmetic mean is **8.10/10**, or 170 / 21. The prior table averaged 7.10/10. All nine prior findings were refuted; one new copy mismatch was confirmed.

Reviewed 14 September 2026 against `main` at `a1533cd83445325b9f25003ea83bc201aa6e0333`. Entry point was `http://localhost:5173/studio`. The session was dev-admin with authentication bypass active. The visible documentation version remained 0.1.0.

Scores measure navigation using the visible English manual. An 8 means the inspected journey was understandable without an unresolved mismatch. They do not measure authorization, transaction correctness, or production capacity. The separate second pass exercises saved-data actions.

## Scores and coverage

| Area | Previous | New | Inspected journey |
|---|---:|---:|---|
| Docs / Start Here | 7 | 8 | Navigation, guide search, opening the annotated navigation image |
| Dashboard | 8 | 8 | Dashboard selection, available menus and widget orientation |
| Reports | 8 | 8 | Library, report selection and parameter guidance |
| Report Designer | 6 | 9 | Design actions and separate revision/report publishing instructions |
| Query | 8 | 8 | Explorer, query workspace and visible naming guidance |
| Workflows | 7 | 8 | Existing Ingest graph, six nodes, Fit View and canvas guidance |
| Terminology | 8 | 8 | Publisher and code-system navigation with visible content |
| Facilities | 5 | 8 | Manual-entry guide, System, Facility code and source relationship |
| Forms | 8 | 8 | Form navigation, builder/capture orientation and prerequisite guidance |
| Users | 7 | 8 | User editing orientation and single-choice Role guidance |
| Audit | 9 | 9 | Event list and detail orientation |
| Activity | 4 | 8 | Discoverable guide, lifecycle stages, empty results and limits |
| Settings / General | 8 | 7 | Navigation is clear, but query-limit and database descriptions are outdated |
| Settings / Laboratory | 7 | 9 | Identity, Facility register, defaults, source registration and saving |
| Settings / Notifications | 8 | 8 | Event preferences and minimum priority |
| Settings / Sites | 8 | 8 | Site list and enrollment orientation |
| Settings / Distributed sync | 8 | 8 | Settings, Activity and corresponding guidance |
| Settings / Connectors | 6 | 8 | Add connector, Category, Host and service-specific fields |
| Settings / Marketplace | 8 | 8 | Browse, package details and registry navigation |
| Settings / Roles | 6 | 8 | Role list, descriptions and assignment guidance |
| Settings / Data Exposure | 5 | 8 | Policy scope, PII guidance, Save, Discard and verification paths |

## Prior findings

| ID | Finding | Verdict | Current UI proof | Cost |
|---|---|---|---|---|
| F01 | Start Here promises callouts absent from its opening image. | REFUTED | The opened image shows numbered Dashboard, Reports and Docs callouts. Facilities is visible. | None |
| F02 | Publishing instructions do not distinguish the available actions. | REFUTED | Report Designer guidance separately explains Publish revision and Create report from this design. | None |
| F03 | Workflow orientation lacks the Fit View recovery step. | REFUTED | Ingest showed six nodes. The guide explains Fit View, zoom, pan and selection. | None |
| F04 | Facility-entry instructions name fields absent from the current form. | REFUTED | The guide uses System and Facility code and explains their relationship. | None |
| F05 | Role-assignment instructions describe checkboxes instead of the current selector. | REFUTED | Users and Roles guides describe the single-choice Role selector. | None |
| F06 | Activity lacks a discoverable task guide. | REFUTED | Searching for activity returns its guide, including stages, statuses, empty results and limits. | None |
| F07 | Laboratory settings lack facility-register guidance. | REFUTED | Laboratory guidance explains the register choice, defaults, source registration and Save. | None |
| F08 | Connector guidance omits the Category choice. | REFUTED | The procedure explicitly says Add connector, choose Category Host, then select the service. | None |
| F09 | Data Exposure lacks documentation of its scope. | REFUTED | Its guide explains covered and excluded paths, PII, Save, Discard and verification. | None |

## New finding

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| F10 | General settings understate which queries and databases its controls affect. | CONFIRMED | Browser snapshot `.playwright-cli/page-2026-09-14T06-20-32-004Z.yml:97` says Postgres only. Lines 116 and 121 describe raw SQL only. Current execution at `packages/bootstrap/src/index.ts:788` applies limits to builders; line 811 also supports MySQL and SQL Server. | Low |

The page still describes Dashboard raw SQL as Postgres-only. Its timeout and row-cap descriptions mention only raw SQL. Current source also applies those limits to builder queries and selects among three database adapters. This source cross-check establishes a copy mismatch, not failed enforcement. Updating the descriptions should include all supported translations. No copy was changed during the review.

The final browser session was `fp09_final_headed_20260914`. The CLI session listing confirmed `headed: true`. The first-pass reviewer did not save, run, publish, create, import, delete, change switches, enter credentials, or upload files. Synthetic objects created concurrently by the second pass appeared in lists but were not modified by this reviewer.

## Browser and mobile observations

Desktop route checks generally reported zero console errors and two React Router future-flag warnings. Terminology logged six 404 responses for publisher distribution-job lookups while publisher and code-system content remained visible. Those responses alone do not establish a user-facing defect. A separate coordinator source check found that `apps/server/src/terminology-admin-routes.ts:472` deliberately returns 404 when no import job exists. The resume lookup tolerates that state at `apps/studio/src/pages/Terminology.tsx:508`. This is counterevidence to treating every such response as a broken endpoint. The navigation reviewer did not inspect individual response bodies.

At 375 by 812, Dashboard reported `innerWidth: 375`, `scrollWidth: 375`, and `bodyWidth: 375`. This proves the measured document did not overflow horizontally. It does not establish every menu's tap targets or bottom-edge behavior.

The coordinating reviewer also inspected Activity at 375 by 812. The document width was 375. Its table scrolled horizontally within the page, and pagination remained visible at the bottom. The [Activity screenshot](../output/playwright/review-2026-09-14-activity-mobile.png) records that view.

## Supporting checks and limits

Fresh Studio checks covered documentation registration, validation, search, and representative UI components. The command was `pnpm --filter @openldr/studio exec vitest run src/docs/registry.test.ts src/docs/validation.test.ts src/docs/search.test.ts src/dashboard/DashboardPage.test.tsx src/pages/settings/marketplace/PackageDetail.test.tsx src/pages/settings/Marketplace.test.tsx src/facilities/FacilityDialog.test.tsx src/forms-runtime/runtime.test.ts src/forms-runtime/FormRuntime.test.tsx src/pages/FormCapture.test.tsx src/pages/settings/Connectors.test.tsx --testTimeout 30000 --hookTimeout 30000`. It passed 176 tests across 11 files.

`pnpm --filter @openldr/web exec vitest run src/docs/DocsPage.test.tsx --testTimeout 30000 --hookTimeout 30000` passed 17 tests. `pnpm --filter @openldr/studio typecheck` exited 0. The public-doc tests cover selected translated rendering and navigation. They do not constitute a manual review of every French or Portuguese guide.

Test output included Marketplace markup and missing-description warnings, React Router warnings, and jsdom's unsupported `window.scrollTo`. These were not scored as navigation failures without a reproduced symptom.

HONEST NON-PROOF: The navigation reviewer inspected English UI and English in-app documentation. This pass does not prove saved transactions, restricted-account access, report results, imports, or every translated guide. No backend or database inspection informed its navigation scores. Supporting automated checks are recorded separately above.

HONEST NON-PROOF: Desktop Chromium at a narrow viewport cannot prove behavior under a phone's retractable browser chrome. A real phone is still needed for bottom-anchored controls.

This report records review evidence. It does not implement findings or authorize a new feature. No application source changes, commits, or pushes were made for this pass.
