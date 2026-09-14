14 findings: 4 confirmed, 10 refuted, 0 convention-conflict, 0 deferred.

# Second pass: UI actions with data

Thirty of 33 action areas scored at least 8/10. Three scored below 8. The fresh mean is **8.15/10**, or 269 / 33, compared with 6.88 previously.

Reviewed 14 September 2026 against `main` at `a1533cd83445325b9f25003ea83bc201aa6e0333`. Studio ran at `http://localhost:5173/studio`, with development authentication bypass active. Documentation version was 0.1.0. Scores describe the observed English-language actions, not production security or availability. An 8 means the tested action is understandable and its expected result was observed. Repeating a successful action does not automatically raise an existing 8 to 9.

The review repeated all 33 original action areas. Unsupported form submission was tested as a refusal, not successful clinical extraction. Installation, destructive maintenance, remote enrollment, and real external transfers remain outside this review. No application code was changed.

## Scores

| Page | Action tested | Previous | New | Observed result |
|---|---|---:|---:|---|
| Dashboard | Create another dashboard | 3 | 8 | New dashboard action created a separate dashboard with named confirmation. |
| Dashboard | Save two widgets | 8 | 8 | Order and patient counts persisted after Save, Done, reload, and dashboard reselection. |
| Query | Run a synthetic query | 9 | 9 | One row, duration, and synthetic values appeared. |
| Query | Save, update, and name a reusable query | 6 | 6 | Query #1 collided with an existing name. Query #2 saved and updated, but naming remains unavailable. |
| Report Designer | Create a template and bind a table | 8 | 8 | A saved template used Query #2 with label and value columns. |
| Report Designer | Publish a revision | 8 | 8 | Published state appeared on the saved template. |
| Report Designer | Create a library report | 7 | 9 | Confirmation named the new report, which appeared in the library. |
| Reports | Run the published report | 9 | 9 | Document and Spreadsheet displayed the synthetic row and value 14. |
| Reports | Request PDF/CSV and inspect history | 8 | 8 | PDF downloaded, CSV contained the expected row, and history recorded exports and preview. |
| Reports | Create, edit, run, and disable a schedule | 7 | 8 | Run queued feedback appeared; Scheduled Runs showed XLSX and OK. Final schedule was disabled, CSV. |
| Workflows | Create, save, rename, and reopen | 8 | 8 | Updated workflow name and Manual Trigger node survived reload. |
| Workflows | Run a manual trigger and inspect history | 9 | 9 | The trigger click completed one step, reported as 0 ms. |
| Terminology | Create a draft term | 8 | 8 | Synthetic nonclinical term appeared as DRAFT. |
| Terminology | Edit and disable the term | 8 | 8 | Updated display name and DISABLED state persisted. |
| Facilities | Register an import source | 8 | 8 | Synthetic source became available for manual entry. |
| Facilities | Create using offered values | 2 | 7 | Selected District Hospital was accepted. The list then exceeded its 50-row page size. |
| Forms | Build and publish a custom form | 8 | 8 | A synthetic form with no resource mapping published. |
| Forms | Validate submission readiness | 3 | 8 | Unsupported mapping displayed setup instructions and disabled Submit. No clinical submission was proved. |
| Forms | Archive and check restrictions | 8 | 8 | Named archive confirmation and Archived state appeared; submission remained unavailable. |
| Settings / General | Change and restore update checks | 9 | 9 | False and restored true states survived reload. |
| Settings / Laboratory | Edit, reload, and restore Contact | 8 | 8 | Temporary contact persisted, then blank contact was restored and rechecked. |
| Settings / Notifications | Change and restore Update available | 9 | 9 | Disabled and restored enabled states survived reload. |
| Settings / Distributed sync | Change and restore interval | 8 | 8 | Interval changed from 15 to 16 and back to 15. Sync stayed disabled. |
| Settings / Distributed sync | Select Sync now while disabled | 5 | 9 | The UI explained that disabled sync could not trigger. |
| Settings / Roles | Create and edit a no-access role | 9 | 9 | Named confirmation, edited description, zero capabilities, and zero members persisted. |
| Settings / Connectors | Create a host connector | 6 | 8 | Current guide explains Category Host and initial enabled state; creation confirmed by name. |
| Settings / Connectors | Reopen and rename configuration | 6 | 7 | Ordinary editor fields reloaded correctly. The list Host column remained blank. |
| Settings / Connectors | Disable and test an unreachable host | 9 | 9 | Disabled persisted. Test identified refused address 127.0.0.1:1. |
| Settings / Marketplace | Inspect installation permissions | 0 | 8 | Details disclosed read-input and emit-fhir for Patient, Specimen, and Observation. No install approved. |
| Settings / Marketplace | Create, rename, and disable a registry | 7 | 8 | Named creation feedback and renamed disabled state persisted. |
| Settings / Data Exposure | Save and check the stated query protection | 0 | 8 | Unchanged policy saved with confirmation. Scope explicitly excludes raw SQL and connector queries. Authorization remains unproved. |
| Audit | Filter test events and inspect a change | 8 | 8 | Exact registry ID filter returned three events and saved-change metadata. |
| Activity | Search, inspect lifecycle, and refresh | 8 | 8 | Search isolated one payload with Received and Persisted events; refresh retained the result. |

## Verdicts on the original findings

Ten prior findings were refuted. Query naming and connector list readback remain confirmed. The Facilities page update and editing conventions are separate new findings.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| SP2-01 | Data Exposure promises to protect every query path. | REFUTED | Current UI and guide explicitly exclude raw SQL and external connector queries. This corrects the promise, not proof of authorization. | None for the original claim |
| SP2-02 | Package Details omit permissions disclosed during approval. | REFUTED | tabular Details now shows read-input and emit-fhir with all three resource types before installation. | None |
| SP2-03 | Facility creation rejects its offered Level value. | REFUTED | District Hospital selection saved facility REVIEW-2026-09-14-002; its row showed Active and Manual entry. | None for Level handling |
| SP2-04 | Unsupported custom forms reach an unexplained extraction failure. | REFUTED | The None-mapped form displayed setup instructions and disabled Submit before execution. | None for the reproduced failure path |
| SP2-05 | Another dashboard cannot be created through a discoverable action. | REFUTED | Dashboard menu offered New dashboard and created a separate persisted dashboard. | None |
| SP2-06 | Reusable queries lack a reliable naming step. | CONFIRMED | A fresh Query #1 failed Save because the name existed. No naming field was available. `apps/studio/src/query/store.ts:59` counts open tabs; `apps/studio/src/query/workspace/QueryTab.tsx:46` saves that title; `apps/server/src/query-routes.ts:44` rejects duplicates. | Low to medium |
| SP2-07 | Report creation confirmation names the template instead. | REFUTED | Confirmation named Review 2026-09-14 report, matching its library entry. | None |
| SP2-08 | Scheduled execution lacks timing guidance and immediate feedback. | REFUTED | Current guidance describes scheduling; Run now displayed queued feedback, then Scheduled Runs showed OK. | None for observed feedback |
| SP2-09 | Disabled Sync now gives no explanatory response. | REFUTED | Activity showed a message that sync was disabled and nothing could trigger. Expected refusal returned HTTP 409. | None |
| SP2-10 | Connector instructions omit Category and misstate initial enabled choice. | REFUTED | Rendered guide explains Category Host and disabling after creation. | None |
| SP2-11 | Saved connector details cannot be read back accurately. | CONFIRMED | Editor now restores ordinary fields, but the list Host column still shows no address. `apps/studio/src/pages/settings/Connectors.tsx:299` reads allowedHost instead of stored host. | Low, clarify column intent before changing |
| SP2-12 | Registry creation confirmation only says Refresh. | REFUTED | Creation said Saved registry Review 2026-09-14 registry. Rename and disabled state persisted. | None for creation; toggle feedback still says Refresh |

## New findings

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| SP2-N01 | Creating a facility appends it beyond the current page size. | CONFIRMED | Snapshot `.playwright-cli/page-2026-09-14T06-34-14-269Z.yml:538` shows 1 through 51 of 3776. `apps/studio/src/pages/Facilities.tsx:936` appends an off-page saved row without reloading the bounded page. | Low to medium |
| SP2-N02 | Registry and schedule editors contradict the required sheet and menu conventions. | CONFIRMED | Both multi-field editors used centered dialogs and standalone Cancel/Save. Source confirms `apps/studio/src/pages/settings/marketplace/RegistriesTab.tsx:235` and `apps/studio/src/reports/ScheduleDialog.tsx:80`. Their action buttons are at lines 267 and 161 respectively. AGENTS section 5 requires sheets and action menus. | Low to medium |

The query collision has a workaround: opening another query tab produced Query #2. That query saved, ran, and updated. A workaround does not make naming reliable. The existing Query #1 was not overwritten.

The Facilities finding concerns the visible page after a successful save. It does not show that the server downloads all facilities. The original production pagination hypothesis therefore remains refuted.

The editing-convention finding is confirmed because the UI violates an existing operator requirement. It is not a request to add functionality. The successful registry and schedule transactions still score 8 for usability.

## Evidence and retained test content

Browser actions used headed Playwright sessions through the visible UI. Root dashboard verification completed Save, Done, full reload, and reselection. The rendered result contained both review widget names, order count 9104, and patient count 5189. The [dashboard screenshot](../output/playwright/review-2026-09-14-dashboard-persistence.png) records that persisted state.

The final saved Query #2 contains `SELECT 'Review 2026-09-14 saved query' AS label, 15 AS value`. Run returned one row in 26 ms. Saving and reopening after full reload retained value 15. Earlier report and export checks used value 14. Those historical outputs are not evidence of stale execution after the later update.

PDF download produced 1,630 bytes. CSV inspection found the expected synthetic marker and value 14. Run History recorded PDF, CSV, and preview. Scheduled Runs showed an XLSX result with OK status. These are separate observations, not proof that every export format renders correctly.

| Retained item | Final state |
|---|---|
| New dashboard | Separate dashboard with Review 2026-09-14 order count and patient count widgets. Existing sample unchanged. |
| Query #2 | Synthetic saved query, ID cq_365142f4, final value 15. Existing Query #1 unchanged. |
| Review 2026-09-14 report template | Published template, ID rt-1789367218126. |
| Review 2026-09-14 report | Library report, ID r-b42b1d93-a815-4af0-a865-2e389c44dd25. |
| Review report schedule | ID 6868ce3c-0174-4017-9ca8-53a317670be2. Disabled, monthly day 1, CSV. Earlier scheduled XLSX execution showed OK. |
| Review 2026-09-14 workflow updated | ID wf_mu0v6ngr_rgu6iu. Enabled, one Manual Trigger, one completed test run. |
| REVIEW-2026-09-14-TERM | Disabled nonclinical term with edited review display name. |
| Review 2026-09-14 facility register | URI urn:review:2026-09-14:facilities, code review-2026-09-14. |
| Review 2026-09-14 facility two | Code REVIEW-2026-09-14-002, manually created with offered Level and Status values. |
| Review synthetic forms | Archived IDs form-cc859fee-f916-4ceb-95d6-d60bb0995301 and form-833a7a5f-8a9e-47cc-ac5f-2c5013e08687. No successful clinical response submitted. |
| Review 2026-09-14 no access | Role ID 74ae75ad-265c-4d7c-b831-8d57684ee2ca. Zero capabilities and members. |
| Review 2026-09-14 disabled test host | Connector ID d286858f-93fc-487d-847d-805cf4cb6c45. Disabled, 127.0.0.1:1, no password or workflow attached. |
| Review 2026-09-14 disabled registry | Registry ID 63d05c46-1df3-43a4-82ca-d44308c835f6. Disabled copy of the existing local bundle location. |

General update checks, Update available notifications, laboratory Contact, and sync interval were restored. Sync remained disabled. Data Exposure was saved without changing switches. Its menu contained Save, and the final confirmation read Column policy saved. Snapshot `.playwright-cli/page-2026-09-14T06-45-44-370Z.yml` records that action. The original registry remained unchanged. Audit records and named synthetic objects remain for inspection. Browser logs are under `.playwright-cli/`; screenshots are under `output/playwright/`. No permanent deletion occurred.

## Verification limits

Supporting Studio component and documentation checks passed 176 tests across 11 files. Public-document checks passed 17 tests. Studio typecheck exited 0. Full commands appear in the first-pass report. These checks do not replace the browser observations above.

At 375 by 812, Activity had document width 375. Its table scrolled internally and pagination remained visible. The [mobile screenshot](../output/playwright/review-2026-09-14-activity-mobile.png) records that view. Dashboard also reported document width 375 in the first pass.

HONEST NON-PROOF: Authentication bypass prevents conclusions about unauthenticated access, restricted roles, or policy enforcement. The corrected security descriptions do not establish protection across every query path.

HONEST NON-PROOF: No successful clinical form extraction, facility file import, remote sync, email delivery, live external database connection, account provisioning, site enrollment, package installation, or destructive maintenance was tested. The unreachable connector was an intentional refusal test.

HONEST NON-PROOF: PDF byte count and history status do not prove page rendering or complete file contents. No physical phone, retractable browser chrome, or full French/Portuguese action review was tested.

The review used the unslop skill to keep findings and limits explicit. It produced review documents and test evidence only. It did not implement fixes, commit, or push.
