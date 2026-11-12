# Data Exposure guide review

Preview only. No app code or published documentation changed.

3 hypotheses: 2 confirmed, 1 refuted, 0 convention conflicts, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| E1 | This policy hides data everywhere, including raw SQL and reports. | REFUTED | `apps/studio/src/i18n/en.ts:855` explicitly excludes built-in dimensions, raw SQL and connector-backed reports. The guide states that limit. | None |
| E2 | Saving a hidden column removes it from additional builder metadata. | CONFIRMED | The real `/api/dashboards/joinable-tables` response omitted patients.managing_organization after the UI save and restored it after showing and saving. `data-exposure-evidence/workflow-result.json` records checks. | Documentation only |
| E3 | Showing a PII column requires confirmation and Save. | CONFIRMED | `apps/studio/src/pages/settings/DataExposure.tsx:64` opens confirmation before applying the draft. Live saved surname appeared in builder metadata and was hidden again afterward. | Documentation only |

## Checks

The actual account-menu, Settings and Data Exposure navigation is pictured. The capture hid and saved a non-PII column, reopened it, discarded an unsaved change, confirmed and saved a PII column, checked real builder metadata, then restored both columns to their original policy. The PII switch opens a confirmation before changing its state, so the resumed capture used click rather than a check assertion. No action was bypassed.

`capture-data-exposure.cjs pii` exited 0. The earlier policy phase completed hide, persistence and discard checks before opening the PII confirmation. Final API checks proved surname hidden and managing_organization shown. A separate read-only capture pictured the restored normal column.

`write-guide-article.py data-exposure` printed `Data Exposure 18 numbered steps`. `build-guide.py data-exposure 'Data Exposure'` printed `24 equal screenshot frames, 18 steps, 24 original captures`. `check-guide-preview.cjs data-exposure` exited 0 with no missing evidence, no broken anchors, no phone overflow and HTTP 200.

Desktop evidence is native 5120 x 3200. Phone evidence is native 1500 x 3248. Browser DPR is 4. New prose passed an unslop review. Optional practice, limits, troubleshooting and related guides follow the tasks.

## Isolation and limits

All policy writes used API3008/Studio5188 and owned Postgres15441. The fictional test installation contains no real patient records. The demonstrated PII column was restored to Hidden before capture finished.

HONEST NON-PROOF: the API metadata checks prove builder column availability. This run did not execute a dashboard query selecting the column. Such a query would prove execution-layer behaviour.

HONEST NON-PROOF: the phone check proves layout at 375 x 812. Real browser chrome and bottom-edge reachability require a phone.

I skipped translations, publication, commits and pushes. Root handles section review and version control. No app defect was changed.

I inspected the generated desktop preview and expanded the focus regions to include column names with switch states. The original PNG captures were preserved. The preview check passed again afterward.
