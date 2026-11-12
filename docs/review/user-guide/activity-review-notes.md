# Activity review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| A1 | Status explanations omit active and stopped ingestion batches. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/activity.md:46` lists three statuses. `apps/studio/src/pages/Activity.tsx:198` also offers Running and Stopped. | Explain the two batch-only statuses. |
| A2 | Filter, sort and columns instructions lack individual evidence. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/activity.md:55` compresses all controls into one sentence. | Add separate numbered controls and native screenshots. |
| A3 | Activity can replay a failed payload. | REFUTED | `apps/server/src/activity-routes.ts:9` and line 16 register only GET views. The live actions menu contains Refresh. | Explain recovery through the relevant workflow. |
| A4 | Search covers all historical payloads. | REFUTED | `apps/studio/src/pages/Activity.tsx:158` fetches 200; line 221 searches that loaded array. | Keep the recent-window limit explicit. |

The preview has 25 numbered steps and 26 native screenshot placements.
Desktop sources are 5120 by 3200. Phone sources are 1500 by 3248.
All steps use the actual isolated UI. No browser response was mocked.
The original published guide and images remain unchanged.
New writing was checked with unslop.

## Live work

Only API 3007, Studio 5187 and PostgreSQL 15440 were used.
The row came from the actual webhook POST exercised in Workflows.
The browser matched its correlation identifier, opened its lifecycle, read Received and Persisted,
closed it, refreshed the list and applied a Complete status filter.
It selected Started as a sort column, changed Asc to Desc and applied the sort.
It opened the column checkboxes and the page-size control.
It did not change column visibility or navigate to another results page.
There was one loaded payload.
The phone capture opened the same lifecycle sheet at 375 by 812.
Responses are in `activity-evidence/live-checks.json`.

## Checks and limits

`python3 docs/review/user-guide/write-guide-article.py activity` printed `Activity 25 numbered steps`.
`python3 docs/review/user-guide/build-guide.py activity Activity` printed
`26 equal screenshot frames, 25 steps, 26 original captures`.

`node docs/review/user-guide/check-guide-preview.cjs activity` returned 25 steps, 26 frames,
zero missing screenshots, no broken anchors, 5120px enlarged source and HTTP 200.
Its 375 by 812 preview had height 812 and no horizontal page overflow.
These checks prove the preview layout and screenshot coverage, not all Activity statuses.

`pnpm --filter @openldr/studio test src/pages/Activity.test.tsx` passed 6 tests.
Those component tests use mocked API data and exercise table filtering and status rendering.
They do not prove production authentication or historical database coverage.

HONEST NON-PROOF: failed, running, stopped and stuck payloads were checked in source, not generated here.
The recent-window boundary, older CLI history and multi-page navigation were not exercised.
Physical phone browser chrome was not tested. Only a real phone can confirm bottom-edge reachability.
No production code, translations or landing changelog was changed for this preview.
The normal app database was not reset or seeded.

## Rebuild

Run `python3 docs/review/user-guide/write-guide-article.py activity`, then
`python3 docs/review/user-guide/build-guide.py activity Activity`.
The root task registers review navigation separately.
The capture script requires the fictional webhook proof from Workflows in this isolated installation.
