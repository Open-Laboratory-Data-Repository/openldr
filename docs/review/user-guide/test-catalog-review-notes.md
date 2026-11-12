# Test catalog review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| TC1 | The main guide requires documentation sample data. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/test-catalog.md:9` starts with a sample import; the prerequisites at line 23 require sample files. | Put manual setup first and practice files last. |
| TC2 | Manual entry lacks screenshots for its individual actions. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/test-catalog.md:119` starts seven text steps without individual screenshots. | Capture the actual fields, menus and save action. |
| TC3 | Manual test entry is missing from the guide. | REFUTED | `apps/studio/src/docs/0.1.8/en/test-catalog.md:119` already covers it. | Preserve the correct field rules. |
| TC4 | Local settings cannot be changed at a central-managed lab. | REFUTED | `apps/studio/src/test-catalog/TestSheet.tsx:478` handles local availability outside the ownedHere definition fields. The published guide already explains the distinction. | Explain shared definitions and local settings separately. |

The preview has 59 numbered steps and 82 image placements. Every numbered step has evidence.
All desktop captures are native 5120 by 3200 PNGs; phone captures are 1500 by 3248.
The layout, focus crop, blur and lightbox follow the approved Facilities sibling.
Practice files are optional. Test catalog setup remains optional and strongly recommended during use.
The current published Test catalog guide remains unchanged.

## Exercised paths

All writes used the isolated installation on ports 3006 and 5186.
The browser created a fictional test, enabled it at this lab, changed its local name,
searched by that name and downloaded the catalog CSV.
The browser imported two more fictional tests and added an unknown category through Values.
Repeating the file reported unchanged rows. No duplicate tests were created.

The optional result dictionary was loaded with the development CLI.
Its transcript reports one result parameter loaded.
The optional lab-data bundle was ingested with the development CLI.
Its transcript reports `done (4 resources)`.
The browser selected the result field, added a numeric band and saved it.
The numbers and LOINC entry shown in these fictional examples are not clinical recommendations.

A received test code was mapped manually to the catalog.
A received result code was matched to the installed dictionary using Map matching codes.
The result-field LOINC editor and export action were captured.
Phone captures show the tabs, page actions and received-result selector.

## Verification

`node docs/review/user-guide/check-guide-preview.cjs test-catalog` passed.
The recorded output has 59 steps, 82 frames, zero missing screenshots and no broken section anchors.
The enlarged source is 5120px wide and retains surrounding blur.
At 375 by 812, the preview fills the viewport without horizontal page overflow.
All six active previews have the same menu. The preview returned HTTP 200.
See `test-catalog-evidence/preview-checks.json`.

The exported catalog and CLI transcripts are retained with the native captures.
The original published images and recordings are untouched.

HONEST NON-PROOF: central-managed ownership restrictions were checked in source, not through a paired sync deployment.
XLSX, bulk mapping import, retiring and restoring, coded-result value sets and permission variants were not exercised.
The preview does not claim those paths were tested.
A physical phone is needed to verify retracting browser chrome.
Production builds and translation publication were skipped for this preview-only section.

## Rebuild

Run `python3 docs/review/user-guide/write-guide-article.py test-catalog`,
then `python3 docs/review/user-guide/build-guide.py test-catalog 'Test catalog'`,
then `python3 docs/review/user-guide/refresh-navigation.py`.
The source is test-catalog-guide.json. Images stay beside the HTML in test-catalog-evidence.
The capture script uses phases manual, finish, import, parameters, observed, loinc and phone.
A complete replay needs a fresh isolated catalog and the optional dictionary and lab-data fixtures.
