6 findings: 4 confirmed, 2 refuted.

These findings describe the published guide at commit 2d37d825, before this rewrite.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| T1 | The guide calls the new-term action Save. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/terminology.md:45` says save. The live new-term menu says Create. `apps/studio/src/terminology/TermDialog.tsx:396` renders the creation action. | Use Create for new terms and Save for existing terms. |
| T2 | Creating code systems and value sets has no walkthrough. | CONFIRMED | The published guide covers browsing, adding a rejection reason and reading value sets. `apps/studio/src/pages/Terminology.tsx:730` and `Terminology.tsx:779` expose creation menus. Both creations were exercised in the live app. | Add illustrated tasks using the actual fields and actions. |
| T3 | Standard distributions are described only through the CLI. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/terminology.md:88` directs readers to commands. `apps/studio/src/pages/Terminology.tsx:721` exposes Import distribution. The live panel accepts a ZIP, version and license confirmation. | Show how to open the browser importer. |
| T4 | Individual clicks have no individual screenshot evidence. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/terminology.md:41` places one clip before three steps. Other tasks use the same arrangement. | Add a focused screenshot to every numbered step. |
| T5 | The downloaded template uses a different format from the guide. | REFUTED | The live download is `terminology-import-template.jsonl`, with one JSON object per line. `apps/server/src/terminology-admin-routes.ts:212` serves the template's own content type and filename despite the legacy `.csv` route suffix. The downloaded file is retained in terminology-evidence. | Keep JSON Lines guidance and add a tested example. |
| T6 | The documented built-in term and value-set counts are already wrong. | REFUTED | The live REJECT-TEST list contained four terms. System contained 17 value sets before the temporary review value set was created. Reading its rejection-reason value set produced four expanded codes. | Describe expected behavior without making fixed counts a prerequisite. |

## What the preview covers

The preview starts with browsing existing codes. It then covers creating a code system, adding and editing a term, importing terms, reading and creating a value set, opening the distribution importer, and choosing publishers on a phone.

Each task explains its purpose before its numbered steps. Each numbered step has a screenshot. Frames retain the approved fixed shape, closer crop, sharp control and blurred surroundings. The enlarged view uses the same image and framing.

The example code system is named DOCS-GUIDE-REVIEW. The guide tells readers to use their own names, codes and URLs. Documentation sample data is not required. Installed and development CLI setup links to Start here and its existing openldr_ce examples.

The import task includes the actual JSON Lines format and the reproduced error `import terms failed: line 2: displayName required`. A corrected one-term file imported EXAMPLE-2. The new-term path created EXAMPLE-1, and the edit path changed its display name. The temporary value set expanded to both codes.

Code-system creation currently uses a Create button at the sheet's bottom. Term creation uses Create in the editor dots menu. The guide follows these existing controls. It does not change their implementation.

## Data protection and cleanup

The live review created one temporary code system and one temporary value set. The code system contained two synthetic example terms. Existing rejection reasons were opened and closed without saving.

The temporary value set was removed first. The temporary code system and its two terms were then removed. Cleanup required exact matching review URLs, the expected system code and IDs absent from the baseline. Original code-system and value-set ID sets were compared afterward.

The cleanup command reported:

```text
Removed only the review value set and code system, including its two example terms.
PASS: original 514 code-system IDs and 690 value-set IDs are unchanged.
```

See terminology-evidence/fixture-baseline.json and cleanup-verification.json for the checks. ID equality proves that those existing records remain. It is not a full database comparison. No database was reset or restored.

## Limits of verification

HONEST NON-PROOF: development authentication bypass was active. This review does not prove every role's permission boundaries.

HONEST NON-PROOF: the distribution importer was opened, but no licensed distribution was uploaded and no license confirmation was selected. A valid provider ZIP and an authorized import would be needed to verify that whole path.

HONEST NON-PROOF: the phone check used a fresh 375 by 812 browser visit. A physical phone is needed to confirm bottom controls with browser chrome present.

HONEST NON-PROOF: native file-chooser windows are not captured. The import screenshot shows the resulting row after selecting the file. The capture notes retain the selected test-file paths and their contents.

Publisher creation, mapping authoring and binding a value set to a form were not exercised here. The guide links to Forms for field setup. It does not claim that creating a value set binds it automatically.

The operator approved the preview for publication on 2026-11-12. The guide is now prepared for main in English, French and Portuguese. The application behavior is unchanged. Native 4x screenshots and per-placement markers preserve the approved framing.

Rebuild it with:

```sh
python3 docs/review/user-guide/build-terminology.py
```

## Preview verification

`python3 docs/review/user-guide/build-terminology.py` reports:

```text
Terminology: 56 equal screenshot frames, 47 steps, 53 original captures.
```

Every numbered step contains a screenshot. The browser loaded every image. With the import-error disclosure open, all 56 desktop frames measured 498 by 311.25 pixels. At 375px, they measured 305 by 190.625 pixels, with no horizontal page overflow. The enlarged view retained the same source image, crop and background blur. The later high-resolution revision scales that blur with the frame width. Light and dark preview themes switched correctly.

All 48 numbered image markers stayed inside their frames at both 1280px and 375px. Markers move inside the highlighted area on narrow previews. A static check also confirmed that every used crop and highlighted target fits its original screenshot.

These checks cover the draft's layout and interactions. They do not remove the device, permission and distribution-import limits above. The initial preview changed no application files. The publication pass ran all Studio and web documentation tests, typechecks and the Studio production build.
