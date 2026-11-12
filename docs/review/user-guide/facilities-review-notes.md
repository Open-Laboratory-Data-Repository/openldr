# Facilities guide review

Six hypotheses checked: three confirmed, three refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| F1 | The main walkthrough depends on sample files. | CONFIRMED | Published English guide, `apps/studio/src/docs/0.1.8/en/facilities.md:9` and `:24`. | Reorder the preview around the user's own facilities and files. |
| F2 | Manual entry lacks a screenshot for each step. | CONFIRMED | The six instructions at `apps/studio/src/docs/0.1.8/en/facilities.md:175` have no individual screenshots. | Capture the actual form, fields and save action. |
| F3 | The guide omits per-facility History. | CONFIRMED | The only history mention is import history at `apps/studio/src/docs/0.1.8/en/facilities.md:243`. The row action exists at `apps/studio/src/pages/Facilities.tsx:690`. | Add a short History walkthrough. |
| F4 | Manual facility creation is undocumented. | REFUTED | `apps/studio/src/docs/0.1.8/en/facilities.md:173` already documents it. | Preserve the correct field and identity rules. |
| F5 | Registering a source requires the CLI or an uploaded file. | REFUTED | `apps/studio/src/facilities/ImportFacilitiesSheet.tsx:1952` exposes registration before file selection. Live captures show both source registration paths. | No app change. |
| F6 | Repeating a facility import creates duplicate rows. | REFUTED | The repeated import reported zero new and two unchanged rows. The isolated register retained three facilities. See `facilities-evidence/reimport-summary.png` and `workflow-checks.json`. | No app change. |

## Preview scope

The preview has 63 numbered steps and 88 screenshot placements. Every numbered step has evidence.
It covers source registration, manual entry, editing, History, importing, value decisions,
repeated imports, exact-code linking and mapping a different source code.

The guide starts with the user's own data. Two fictional practice files are optional at the end.
Facilities setup is optional and strongly recommended during use.
Start here remains the destination for CLI setup instructions.

Desktop source images are native 5120 by 3200 PNGs. Phone images are 1500 by 3248.
The page and enlarged view reuse the same source, crop, focus region and blur.
The original published Facilities images remain untouched.

All five active previews now link Facilities through the shared navigation builder.
The group remains Set up your system. Other published documentation has not changed.

## Live workflow evidence

All writes used an isolated installation on API port 3006 and Studio port 5186.
Its PostgreSQL container used temporary memory-backed storage on port 15439.
The populated installation on ports 3000 and 5173 was not reset, seeded or imported into.

The browser created one fictional facility and imported two more through CSV.
The import retained an extra Notes column and mapped Operating and Closed to configured statuses.
Repeating that CSV reported two unchanged rows and no new rows.
Exact-code linking proposed three matches and one unmatched code.
The unmatched code was mapped to an existing Registry facility through the row action.

The development command `pnpm openldr ingest data/example-observed-data.json` exited 0.
It reported `done (7 resources)`. See `facilities-evidence/cli-practice-check.txt`.
The temporary file in the repository's data folder was removed after that check.

Three error cases were exercised through the UI:

- Empty Create showed required-field errors and saved nothing.
- A repeated System and Facility code produced an already-exists error.
- Removing the required code mapping produced a missing-column warning.

The preview shows each error and the relevant correction.

## Verification and limits

Run `node docs/review/user-guide/check-facilities-preview.cjs` while port 4392 serves this folder.
The result is saved in `facilities-evidence/preview-checks.json`.
It checks every source image, screenshot coverage, enlargement, phone layout,
the navigation round trip and both practice downloads.

The normal installation's facility count and registered source identities matched the checkpoint.
See `facilities-evidence/workflow-checks.json`. The checkpoint was taken during this review,
not before it. This comparison does not prove every database row stayed unchanged.
All workflow write destinations were the isolated installation.

HONEST NON-PROOF: desktop Chromium at 375 by 812 cannot verify retracting phone browser chrome.
A physical phone must confirm that behavior. Native Windows and macOS CLI launchers were not run.
The browser workflow checked CSV. JSONL, XLSX and complete-release deletion were not exercised.
Bulk deletion and advanced import-reference behavior are outside this walkthrough.

No production app code, published guide, translation or website article was changed.
Production builds and documentation tests were skipped because this is a standalone preview.
No commit, push or changelog generation was performed.

## Rebuild

Run `python3 docs/review/user-guide/build-facilities.py`.
The page uses relative image paths, so serve `facilities-review.html` with its `facilities-evidence` folder.
The capture script requires a fresh isolated installation for a complete replay.
Its phases are source, manual, import, observed, mapping, checks and source-menu.
The optional observed-data fixture must be ingested before the observed phase.
Do not aim the capture script at the populated installation.
