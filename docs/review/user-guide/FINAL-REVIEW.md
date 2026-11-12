Publication update: all 27 remaining guides are approved for main. See [PUBLICATION.md](PUBLICATION.md) for the publication record. The review status below is historical.

8 suspected content gaps: 2 confirmed, 6 refuted. One confirmed gap is corrected; one is the approved Dashboard baseline.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| G1 | Every fresh installation has a Postgres-named connector. | CONFIRMED, corrected | `packages/bootstrap/src/seed.ts:533` and `:564` select SQL Server or MySQL. Connectors and Query introductions now identify Postgres as the pictured example. | Two introductions and regenerated previews. |
| G2 | New numbered steps lack native screenshots. | REFUTED | All 775 steps in the 27 structured guides reference existing native evidence. PNG headers match their manifests. | None. |
| G3 | Validation instructions require Danger zone permission. | REFUTED | `apps/studio/src/pages/settings/General.tsx:352` uses `settings.edit_general`. The guide names that permission. | None. |
| G4 | Factory-reset instructions hide the external-data boundary. | REFUTED | The Settings result names internal-only scope, matching `packages/bootstrap/src/danger.ts:29`. | None. |
| G5 | Scheduled-report instructions claim untested mail delivery or clock firing. | REFUTED | The guides separate actual Run now execution from automatic firing and email delivery. | None. |
| G6 | Completed guides or optional downloads have missing destinations. | REFUTED | Final static review found every local link and fragment present across all 32 active pages. | None. |
| G7 | Shared navigation destinations differ. | REFUTED | All 32 pages contain the same 32 destinations. | None. |
| G8 | Approved Dashboard practice steps lack screenshots. | CONFIRMED | `dashboard-review.html:1658` and `:1666` have commands without figures. | Existing approved baseline, preserved. |

# Publication and preview status

Facilities is published in English, French and Portuguese. Publication commit `4e9981a0` and its changelog checkpoint `ef2273df` were pushed to main.
It has 63 numbered steps and 88 native screenshot placements per locale.

All 27 remaining sections are saved as separate preview checkpoints on main.
They contain 775 numbered steps and 913 screenshot placements.
Their published application guides and translations remain unchanged pending review.
Practice data stays optional. Facilities, Test catalog and Patients remain optional setup.
All menus use Set up your system and Personal settings.

Open the previews at http://100.107.125.94:4392/test-catalog-review.html.
The shared menu reaches all 32 reviewed or previously approved pages.
The server serves this directory on port 4392, bound to all interfaces.

# Verification

`node docs/review/user-guide/check-all-previews.cjs` printed `ALL PREVIEWS PASS 32`.
Its output is `final-preview-checks.json`.
It checks HTTP responses, identical menu text, section anchors, native source width,
page-to-lightbox frame identity, theme switching where available, and 375 by 812 layout.
The approved Dashboard preview has no theme toggle. The other 31 do.

Every new section also passed `node docs/review/user-guide/check-guide-preview.cjs <slug>`.
Each section's `preview-checks.json` records no missing step pictures, no broken section anchors,
a 5120px enlarged source, HTTP 200 and no horizontal phone-page overflow.
The builders check that the focused controls stay within each crop.

A separate read-only source review covered all 32 pages.
It counted 932 numbered-step elements, 1,121 frames and 1,092 referenced image sources.
All images decoded: 1,005 at 5120 by 3200, 70 at 1500 by 3248,
and 17 approved terminal illustrations at 2944 by 1664.
It found no unresolved local links or fragments. All 32 navigation destinations match.

Facilities publication checks passed 94 Studio documentation tests and 29 web documentation tests.
Studio and web typechecks passed. The Studio build completed in 9.72 seconds.
The all-locale browser check is `facilities-evidence/publication-checks.json`.
Those checks cover docs registration, links and rendering, not unrelated application behavior.

Live section checks include form publication and restoration, a single submitted order,
provider sign-in and local access, report exports and a successful immediate scheduled output.
Reports route tests passed 44 tests. Their injected stores did not reproduce the nullable-field issue below.
Individual review notes record the exact commands, outputs, source lines and limits.

# Existing application failures retained

No application behavior was changed to hide a failed walkthrough.

- A workbench date-range parameter cannot bind directly to Reports' flat date values.
  The real request returned 400 with required parameter: period.
  The reviewed reporting example uses the existing Text parameters from and to instead.
  See `report-designer-evidence/date-range-mismatch.json` and the Query troubleshooting note.
- Unpublish returned 400 for a newly created custom report with nullable optional fields.
  The UI showed Action failed and retained Published status.
  See `reports-evidence/unpublish-failure.json`. The guide reports that result.

Other source or UI-copy observations remain in their section notes. They were not expanded into app changes.

# Recovery and limits

Each section was committed and pushed before the next checkpoint.
`HANDOFF.md` records the sequence. The plan has no unchecked section entries.
`pnpm make:changelog` ran after each main commit. Preview docs commits did not change its generated content.
The final correction checkpoint also saves this report and the aggregate browser checker.
Use `git log -1` and `git ls-remote origin refs/heads/main` to compare the local and remote commit.

The power cut did not cause a repeated form submission.
The original success image survived; the missing transport JSON did not.
The recorded warehouse count increased from one request to two.
Later pictures stopped before submission or used an unsaved prototype.
See `forms-review-notes.md` for the retained proof and its limits.

Owned review databases use durable volumes. Normal databases were not reset or seeded for this work.
Temporary runtime configs, credentials and raw backups remain outside the committed previews.
Exported PDFs and workbooks have scoped Git binary attributes to preserve their original bytes.
The actual terminal pictures used for setup are labelled illustrations; their appearance is not command-output proof.

HONEST NON-PROOF: headless phone layout cannot prove access beneath retractable browser chrome.
Only a physical phone can confirm that. Automatic schedule firing, email delivery,
a historical release upgrade and successful lab-to-central sync were not exercised.
An empty reporting warehouse cannot prove date selectivity or large-result pagination.

The previously approved Dashboard optional-practice steps Download the sample file and Import the records
contain commands without screenshots. They were preserved as the approved baseline.
Every numbered step in the 27 newly reviewed guides has screenshot evidence.
