# Patients review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| P1 | The guide requires documentation sample data. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/patients.md:7` says to load it first. Line 32 repeats that prerequisite. | Start with received records and make practice optional. |
| P2 | Identifier settings lack a screenshot for each action. | CONFIRMED | The six text instructions under `apps/studio/src/docs/0.1.8/en/patients.md:51` share one recording. | Capture the tab, row menu, fields and Save action. |
| P3 | Replacement-patient navigation is undocumented. | REFUTED | `apps/studio/src/docs/0.1.8/en/patients.md:47` already describes the row and replacement actions. | Keep the feature and add step evidence. |
| P4 | Marking a group as different people deletes patient records. | REFUTED | `apps/server/src/patient-routes.ts:62` calls the duplicate-decision store. Restore uses the same decision set. The live example retained four patients and restored its open group. | Explain the decision and its undo without adding app behavior. |

The preview has 42 numbered steps and 57 screenshot placements.
Every numbered step has native screenshot evidence.
Desktop captures are 5120 by 3200. Phone captures are 1500 by 3248.
The approved focused crop and blurred context are retained in the lightbox.
Patient settings and practice data remain optional.
The published Patients guide and its original pictures are unchanged.

## Live workflows

All writes and screenshots used the isolated installation on ports 3006 and 5186.
The optional fixture contains three fictional patients, one request, one report and one result.
Its CLI transcript reports `done (6 resources)`.
It includes a shared identifier for duplicate review and an inactive record with a source-reported replacement.
It does not require the optional Test catalog practice files.

The browser searched by name, opened a patient, read identifiers and requests, and closed the sheet.
It labelled an identifier system, enabled display in the list and searched the identifier value.
It filtered Status to Merged and followed the source replacement to the active record.
It opened a duplicate group and a member patient.
It recorded a reason, marked the group as not duplicates, found it under Not duplicates,
restored it with Show again and exported the open group.
The final workflow check retained four patients and one open group.

The capture helper reloads the manifest before each write.
That prevents a completed phase from replacing newer phase metadata cached earlier.
The affected Patients phases were replayed in sequence. Original capture files were retained.
The preview builder now refuses a crop that clips its focus target.
The phone detail capture focuses the patient name within the fixed frame.

## Checks and limits

`node docs/review/user-guide/check-guide-preview.cjs patients` checks source resolution,
step coverage, section links, enlargement, mobile layout and all seven preview menus.
The recorded result has 42 steps, 57 frames, zero missing screenshots, no broken anchors,
a 5120px enlarged source and HTTP 200.
The 375 by 812 preview fills the viewport without horizontal page overflow.
See patients-evidence/preview-checks.json.

`pnpm --filter @openldr/server test src/patient-routes.test.ts` passed 19 tests.
Those tests exercise route permission gates and audit behavior with mocked stores.
They do not prove actual browser masking or full database projection behavior.
The live captures used permission to view patient identifiers.
Masking and central-managed identifier settings were checked in source, not captured as live permission variants.

HONEST NON-PROOF: physical phone browser chrome is untested.
The large-group limit, pre-upgrade reproject command and source-side duplicate correction were not exercised.
No production build or translation publication was needed for this preview-only section.
The normal database was not reset or seeded. No real patient data was captured.

## Rebuild

Run `python3 docs/review/user-guide/write-guide-article.py patients`,
`python3 docs/review/user-guide/build-guide.py patients Patients`,
and `python3 docs/review/user-guide/refresh-navigation.py`.
The source is patients-guide.json. The image folder must accompany the generated preview.
Capture phases are browse, duplicates, merged, member, phone and status.
Run phases in sequence against the isolated installation only.
