The seven confirmed findings below were repaired on 2026-11-12. See [repair validation](BUGFIX-VALIDATION.md).
This document preserves the original review and its failure evidence. Its workarounds describe the earlier version.

10 findings: 7 confirmed, 3 refuted. No app bug repair is included in the guide publication.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| B1 | Unpublish rejects reports with null optional metadata. | CONFIRMED | Real UI PUT returned 400; report stayed Published. `reports-evidence/unpublish-failure.json`; `apps/studio/src/reports/reportDefsApi.ts:48`; `packages/reporting/src/report-def.ts:26`. | Align saved nullable fields and update validation. |
| B2 | A workbench date-range query fails when used in Reports. | CONFIRMED | Real GET returned 400, required parameter: period. `report-designer-evidence/date-range-mismatch.json`; `apps/studio/src/reports/ReportParametersBar.tsx:40`; `packages/dashboards/src/custom-query-run.ts:28`. | Align the report and query parameter shapes. |
| B3 | Marketplace details retain the old Enable or Disable action. | CONFIRMED | Live toggle required leaving details and reopening. `apps/studio/src/pages/settings/marketplace/MarketplaceTabs.tsx:113`; `PackageDetail.tsx:191`. | Refresh or derive the selected entry after mutation. |
| B4 | The logo error advertises unsupported WebP images. | CONFIRMED | Error at `apps/studio/src/i18n/en.ts:417` names WebP. `packages/config/src/lab-identity.ts:67` permits PNG and JPEG. | Correct the error text in three languages. |
| B5 | The permission description overstates Data Exposure scope. | CONFIRMED | `packages/rbac/src/catalog.ts:71` claims dashboards, queries and reports. `apps/studio/src/i18n/en.ts:855` excludes raw SQL and connector reports. | Match capability wording to the existing policy. |
| B6 | Form copy says View/Run requires publication. | CONFIRMED | `apps/studio/src/i18n/en.ts:353` conflicts with the always-available action at `pages/Forms.tsx:321`. `pages/FormCapture.tsx:123` disables only submission. | Correct the explanatory text. |
| B7 | The sample Reference Plugin is unreadable in dark theme. | CONFIRMED | Native light/dark inspection and `reference-plugins/ui-reference/ui.html:2`, fixed text color #111. | Use the plugin theme variables. |
| B8 | CSV must apply the spreadsheet's local filters and sort. | REFUTED | `apps/studio/src/reports/ReportSpreadsheetTab.tsx:68` runs parameterised CSV again. XLSX applies local filters at line 85. The guide distinguishes them. | None. |
| B9 | Every version restore must unpublish a form. | REFUTED | `packages/forms/src/store.ts:310` changes Published to Draft only when content changes. Restore uses that path at line 416. | None. |
| B10 | Data Exposure is missing global SQL access enforcement. | REFUTED | Its documented scope is additional dashboard-builder columns. The broader capability description is B5, not evidence of a missing global policy. | None. |

# Report status failure

The disposable report prepared through the isolated API had null values for summaryMetrics, chart and paramOptions.
Those values matched the optional metadata of a newly created UI report. The failure was exercised through the actual Unpublish UI.
Unpublish fetches that database record, spreads all its fields into a full PUT and changes status.
The input schema accepts omitted optional fields, but rejects null values for these fields.
The server returns 400 and the UI displays Action failed. The report remains Published.

The route tests passed 44 tests with injected stores. They did not exercise these actual PostgreSQL values.
The guide preserves the failed request and current state. Deleting the report is not a substitute for unpublishing it.
Publishing through the same helper may share this defect, but only Unpublish was reproduced.

# Reporting date parameters

The workbench represents a Date range parameter named period as a nested period object with from and to.
Reports supplies flat from and to values. The saved query runner cannot find period and rejects the run.
The workbench query itself remains valid. Binding that parameter definition directly to Reports fails.

The published worked example uses two Text parameters, from and to, matching existing report definitions.
Its real report run returned 200 with one row. This is a documented workaround, not a repair of the parameter mismatch.

# Marketplace detail state

The selected package is stored as an object. Refreshing the installed list does not replace that selected object.
Its details can therefore offer the old Enable or Disable action after a successful change.
The actual plugin state can already have changed. Select Back and reopen the package before choosing another action.
The guide documents that workaround. No plugin-state loss was observed.

# Smaller inconsistencies

The logo issue is an error-message mismatch. The real PNG upload, clear and save workflows passed.
The review did not upload a WebP file; the mismatch is confirmed by the error string, input metadata and allowed MIME list.
It does not justify adding WebP support without checking report rendering.

Data Exposure already explains its scope on its own settings page. The capability description shown with roles is too broad.
It should not suggest that hiding a builder column prevents raw SQL or connector-backed reports from reading it.
This is wording that can lead to a mistaken access-control assumption. No authorization bypass was established.

Draft and Archived forms can open through View/Run, while Submit is disabled.
The form copy confuses opening a form with submitting it. The native duplicate-form captures show both controls.

The dark-theme contrast problem belongs to the optional Reference Plugin sample.
It uses a fixed dark text color. Light theme makes the sample readable; this does not establish a general plugin-host defect.

# Verification limits

The first three findings were observed in live isolated workflows. The Reference Plugin contrast was also inspected in the browser.
The three wording findings were checked against current strings and implementation; no new failure was manufactured for this report.
No normal database was reset, no email was sent, and no app bug repair was included.
A source-only observation about Activity's indefinite Loading state remains in its review notes and is not counted as a reproduced bug here.
