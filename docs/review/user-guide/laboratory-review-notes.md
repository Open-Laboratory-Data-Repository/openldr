# Laboratory guide review

Preview only. No app code or published documentation changed.

4 hypotheses: 2 confirmed, 2 refuted, 0 convention conflicts, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| B1 | Laboratory accepts a typed facility-register label. | REFUTED | `apps/studio/src/pages/settings/Laboratory.tsx:157` renders a Select backed by registered sources. Live selected an actual owned register. | None |
| B2 | Name, address, contact, register and time zone survive saving. | CONFIRMED | `laboratory-evidence/workflow-result.json` records the saved values. Capture reopened the page and checked the address. | Documentation only |
| B3 | WebP is an accepted letterhead logo format. | REFUTED | `packages/config/src/lab-identity.ts:68` allows PNG and JPEG only. API metadata matches. The existing error translation still mentions WebP. | Documentation only |
| B4 | A logo can be cleared, saved, uploaded and reopened. | CONFIRMED | `laboratory-evidence/workflow-result.json` records clear and upload persistence. Live API checked a saved image/png data URI. | Documentation only |

## Checks

- `capture-laboratory.cjs identity` exited 0. It captured actual account-menu, Settings and Laboratory navigation and saved all identity fields. The practice facility source was registered through the real API in this owned installation.
- `capture-laboratory.cjs logo` exited 0 after correcting the check for cleared settings. Empty saved logo fields are omitted from the API map rather than returned as empty strings. It verified that the logo was absent, uploaded the copied shipped PNG, saved, reopened and checked persistence.
- `capture-laboratory.cjs phone` exited 0. It captured fields and the logo control at 375 x 812.
- Desktop evidence is native 5120 x 3200. Phone evidence is native 1500 x 3248. Browser DPR is 4.
- New prose passed an unslop review. It distinguishes the issuing laboratory from sending facilities and puts practice after core tasks.

## Isolation and limits

All settings and the fictional register were written only through API3008/Studio5188 to owned Postgres15441. The practice PNG is an unchanged copy of this test installation's shipped logo. Existing assets were preserved.

HONEST NON-PROOF: this run checked saved settings and logo persistence, not a rendered report PDF. Rendering a template containing all four laboratory tokens would prove output substitution.

HONEST NON-PROOF: PostgreSQL was exercised. The SQL Server time-zone exception is source-backed in `packages/config/src/lab-identity.ts:90`, not live-tested here.

HONEST NON-PROOF: headless phone layout does not prove browser-chrome or bottom-edge behaviour. A real phone is required.

## Separate app issue

The existing logo-type error text mentions WebP even though the real API and input allow only PNG and JPEG. Source is `apps/studio/src/i18n/en.ts:416` and `packages/config/src/lab-identity.ts:68`. The guide names the actual accepted formats. I did not change the app.

I skipped translations, publication, commits and pushes. Root handles section review and version control.

`write-guide-article.py laboratory` printed `Laboratory 14 numbered steps`. `build-guide.py laboratory Laboratory` printed `19 equal screenshot frames, 14 steps, 19 original captures`. `check-guide-preview.cjs laboratory` exited 0 with no missing evidence, no broken anchors, no phone overflow and HTTP 200. I inspected the generated desktop preview.
