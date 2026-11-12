# Setup checks guide review

Preview only. No app code or published documentation changed.

3 hypotheses: 2 confirmed, 1 refuted, 0 convention conflicts, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| S1 | The page only displays a static checklist. | REFUTED | `apps/studio/src/pages/settings/SetupChecks.tsx:40` calls runSetupChecks. A real rerun changed laboratory-name and time-zone statuses. | None |
| S2 | Linked laboratory corrections change check results. | CONFIRMED | `setup-checks-evidence/workflow-result.json` records labName and timeZone changing from warn to pass. | Documentation only |
| S3 | Skipped sync can appear alongside a failing service. | CONFIRMED | The live before/after reports show sync skip and adapters fail. The capture records both. | Documentation only |

## Checks

`capture-setup-checks.cjs check` exited 0. It captured actual account-menu, Settings and Setup checks navigation, read the report, followed Open Laboratory, changed the owned laboratory name and time zone, saved them, returned and reran the checks. The real API reports changed both corrected checks to pass.

`capture-setup-checks.cjs phone` exited 0. It captured summary and service guidance at 375 x 812. Desktop evidence is native 5120 x 3200; phone evidence is native 1500 x 3248. Browser DPR is 4.

The development installation still reports its blob adapter failure and authentication-bypass warning. The guide says these remain to be addressed. It does not present the installation as ready.

New prose passed an unslop review. It places optional practice, limits, troubleshooting and related guides after the tasks.

## Isolation and limits

All setting writes used owned Postgres15441 via API3008/Studio5188. No service or server configuration was changed. The test laboratory name is fictional. No sample data import was needed.

HONEST NON-PROOF: this run did not repair the blob service or turn off the development bypass. Their displayed advice was checked against the actual result. A new report after those real repairs would prove recovery.

HONEST NON-PROOF: this run uses PostgreSQL. The SQL Server time-zone exception is source-backed, not exercised here. The text shown on Laboratory explains the exception.

HONEST NON-PROOF: a phone browser with retractable chrome is required to confirm bottom-edge reachability. The headless check covers layout only.

I skipped translations, publication, commits and pushes. Root handles section review and version control. No app defect was changed.

`write-guide-article.py setup-checks` printed `Setup checks 14 numbered steps`. `build-guide.py setup-checks 'Setup checks'` printed `18 equal screenshot frames, 14 steps, 18 original captures`. `check-guide-preview.cjs setup-checks` exited 0 with no missing evidence, no broken anchors, no phone overflow and HTTP 200. I inspected the generated desktop preview.
