# Layouts guide review

Preview only. No app code or published documentation changed.

3 hypotheses: 2 confirmed, 1 refuted, 0 convention conflicts, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| L1 | Layouts grant access to selected pages. | REFUTED | `apps/studio/src/pages/settings/LayoutSheet.tsx:62` states that layouts only hide pages. AppShell applies capability checks to navigation. | None |
| L2 | Layout creation, editing, personal selection and deletion persist. | CONFIRMED | `layouts-evidence/workflow-result.json` records created and edited values, personal choice, full-sidebar restoration and deletion. | Documentation only |
| L3 | Removing the start page clears that layout choice. | CONFIRMED | `apps/studio/src/pages/settings/LayoutSheet.tsx:40` clears a startPage absent from pages. | Documentation only |

## Checks

- `capture-layouts.cjs create` exited 0. It captured actual user-menu, Settings and Layouts navigation, then created a layout with Reports as start page and System Auditor as role default.
- `capture-layouts.cjs edit` exited 0. It added Activity and checked the stored pages.
- `capture-layouts.cjs pick` exited 0. It selected the layout, checked that Users disappeared from navigation, checked the saved personal preference, cleared the choice through Role default, then selected Full sidebar and checked that Users returned.
- `capture-layouts.cjs phone` exited 0. It captured Settings navigation and the editor at 375 x 812.
- `capture-layouts.cjs delete` exited 0. The layout disappeared from both the list and the real API response.
- Desktop evidence is native 5120 x 3200. Phone evidence is native 1500 x 3248. Browser DPR is 4.
- New prose passed an unslop review. Tasks explain their purpose and use actual labels. Optional practice, limits, troubleshooting and related guides follow them.

## Isolation and limits

This section used API3008, Studio5188 and owned Postgres15441. It used no shared identity accounts or production data.

HONEST NON-PROOF: the browser actor was the development administrator. The run proved personal layout choices but did not sign in as a role-default user. A signed-in System Auditor with no personal override would prove that variant. Source precedence is `apps/studio/src/shell/layouts.ts:50`.

HONEST NON-PROOF: saved start-page values were verified in the API. A fresh sign-in without a personal start-page override would prove the landing page choice.

HONEST NON-PROOF: phone layout checks cannot prove retractable browser chrome or bottom-edge reachability. A real phone is required.

I skipped translations, publication, commits and pushes. Root handles section review and version control. No app defect was changed.

`write-guide-article.py layouts` printed `Layouts 20 numbered steps`. `build-guide.py layouts Layouts` printed `29 equal screenshot frames, 20 steps, 29 original captures`. `check-guide-preview.cjs layouts` exited 0 with no missing evidence, no broken anchors, no phone overflow and HTTP 200. I inspected the generated desktop preview.
