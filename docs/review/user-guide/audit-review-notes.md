# Audit guide review

Preview only. No app code or published documentation changed.

3 hypotheses: 2 confirmed, 1 refuted, 0 convention conflicts, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| A1 | Audit has a free-text search box. | REFUTED | `apps/studio/src/pages/Audit.tsx:199` supplies filter and sort controls without a search value or callback. Live toolbar has Filter. | None |
| A2 | Audit can filter actual user changes and show recorded snapshots. | CONFIRMED | `audit-evidence/workflow-result.json` records the matching event. Live user.update Before and After snapshots captured. | Documentation only |
| A3 | Audit pagination requests different event rows. | CONFIRMED | `capture-audit.cjs` checks that first rows differ after Next page. Run exited 0. | Documentation only |

## Checks

`GUIDE_API_URL=http://localhost:3008 GUIDE_STUDIO_URL=http://localhost:5188 node docs/review/user-guide/capture-audit.cjs` exited 0. It filtered user.update events, opened real recorded data, clicked Copy Event ID, inspected Before, After and Metadata, cleared the filter, changed page size, paged forward and back, refreshed, and opened an event on a phone.

Desktop captures are native 5120 x 3200. Phone captures are native 1500 x 3248. Browser DPR is 4. New prose passed an unslop review and uses actual labels. The filter popover uses Clear; the chips row outside it uses Clear all.

## Isolation and limits

This section read the events from owned Postgres15441 through API3008 and Studio5188. It did not inject audit events. The screenshots show real changes made during the Users and Layouts reviews.

HONEST NON-PROOF: Copy Event ID was clicked, but this headless run did not inspect the operating-system clipboard. Pasting the identifier into an approved note would prove the copied value.

HONEST NON-PROOF: the phone check proves layout at 375 x 812. Real phone browser chrome and bottom-edge reachability require a phone.

The separate Users review verified that a real signed-in System Auditor token can read the audit endpoint. This section's screenshots use the development administrator.

I skipped translations, publication, commits and pushes. Root handles section review and version control. No app defect was changed.

`write-guide-article.py audit` printed `Audit 20 numbered steps`. `build-guide.py audit Audit` printed `23 equal screenshot frames, 20 steps, 23 original captures`. `check-guide-preview.cjs audit` exited 0 with no missing evidence, no broken anchors, no phone overflow and HTTP 200. I inspected the generated desktop preview.
