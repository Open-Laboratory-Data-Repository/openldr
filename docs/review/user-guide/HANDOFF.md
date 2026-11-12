# Continue the user guide review

These files preserve the documentation review if the desktop loses power.
The operator authorized merging this checkpoint to main on 2026-11-12.
On 2026-11-12, the operator also approved the full Dashboard preview as the starting point for the app guide.

## Open the previews

Run from the repository root:

```sh
python3 -m http.server 4392 --bind 0.0.0.0 --directory docs/review/user-guide
```

Open http://localhost:4392/dashboard-review.html or http://localhost:4392/start-here-review.html.
Use the laptop's Tailscale address to open it from another device.
The desktop's Tailscale address cannot serve pages while the desktop is off.
These pages include their media. They need no database, Docker, or app server.

## Decisions to preserve

- Keep the existing documentation page layout.
- Explain each task before its numbered steps.
- Show a screenshot for each instruction to click something.
- Use equal screenshot frames with a closer crop, sharp target, and blurred surroundings.
- Remove blur comparison buttons from the active Dashboard guide.
- Preserve the original screenshots and earlier comparisons.
- Teach creating dashboards and widgets with the reader's own data first.
- Put sample data in optional practice after the general instructions.
- Use `C:\openldr_ce` on Windows and `~/Downloads/openldr_ce` on Linux and macOS as explicit example folders.
- Link Dashboard to Start here for installed and development CLI instructions.
- Keep terminal illustrations realistic and clearly identified as illustrations.
- Give the installer concrete recovery steps instead of generic administrator referrals.

## Review status

Start here has been reviewed through the installed CLI, development CLI, and reproduced Linux errors.
The Create a dashboard task has been checked against the live app and approved.
The full Dashboard walkthrough is approved as a starting point and promoted to the app guide.
Its screenshots come from earlier app recordings. Only Create received a new live behavior check during this review.

The accepted image treatment is in create-dashboard-zoom-review.html.
The earlier full-screen comparison is create-dashboard-focus-review.html.
The earlier narrow images remain in the saved sources and Git history.

## Evidence

create-dashboard-focus/capture-manifest.json records the live creation check.
It received HTTP 200, created an empty dashboard, verified edit mode, and deleted only its temporary dashboard.
It records that the existing dashboards and sidebar preference were unchanged afterward.
The empty-install creation button was not reviewed.

Linux CLI checks used isolated PostgreSQL and storage containers.
Installed and source commands imported one Organization fixture and reached batch done.
The checked failures were a wrong folder, stale DOCKER_HOST, stopped api container, and an inaccessible file path.
The illustrations repeat those transcripts. Windows and macOS execution were not tested natively.
No populated database was reset or replaced.

A verified database backup exists on the desktop under:
`~/Backups/openldr-ce/docs-baseline-2026-11-11-192837`.
It is about 3.25 GiB. It includes secrets, so it is excluded from Git.
It has not been copied to the laptop. Full app testing there requires a separate installation or secure restore.
The preview itself does not require that backup.

## Continue on the laptop

```sh
git fetch origin
git switch main
git pull --ff-only
```

Use main for the next documentation edits. The earlier review branch remains available as history.
Start a new Codex session in that checkout and ask it to read this file.
Git carries the preview and source files. It does not carry the current chat or running processes.

## Editing

The article and step HTML files are the editable content.
Original full screenshots are under create-dashboard-focus/raw and evidence.
Terminal scenes and their manifest are under terminal-illustrations.
The existing standalone HTML pages can be opened immediately.
Rebuild both active pages from any directory with Python 3:

```sh
python3 docs/review/user-guide/build.py
```

The builder needs only the Python standard library and this checkout.
The earlier build scripts are retained as reference. Use build.py for portable rebuilds.
Browser capture scripts need the repository dependencies and a Playwright browser.
Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH only if Playwright must use a custom browser binary.
The old capture image comparisons remain archived. Their original files are also in Git history.

## Source integration

Approved Start here and Create a dashboard are now in apps/studio/src/docs/0.1.8 in English, French, and Portuguese.
The website CLI reference in apps/web/src/docs/0.1.8 has matching installed and source examples.
FocusedScreenshot.tsx applies the approved crop and blur to all 32 screenshot placements in the promoted walkthrough.
dashboard-focus.json contains the additional framing taken from the preview.
The browser lightbox retains the page crop, blur and markers when enlarging the image. PDF and Word exports show the original full images.
CLI exports use the default Linux walkthrough. Platform buttons affect the browser view.
The app guide now contains Create, Add a widget, optional practice, and the existing advanced reference.
The full Dashboard preview applies the new treatment to all 32 screenshot placements.
The user can continue improving individual tasks after this starting point.
No new widget behavior check is implied by moving the approved draft into the app.
The operator authorized merging and pushing this review on 2026-11-12. No deployment was requested.


## Checks for this checkpoint

See verification/checks.md for commands, outputs, and limits.
The browser checked all three guide languages and all three CLI platform choices.
This review was merged to main at the operator's request in 13511e2b. The release changelog was regenerated after merging. No deployment was requested.


## Start here illustration review

neutral-terminal-files.html is the editable neutral window illustration.
neutral-terminal-files-review.html is its standalone preview.
It shows a source checkout and the cross-platform development command pnpm openldr --help.
It does not change Start here. The current OS-specific illustrations remain available until the user selects a replacement.


## Approved Start here images and themes

The user approved the native terminal and matching file browser with a narrow dotted surround.
All 43 approved images are promoted under distinct start-terminal-* and start-proof-* filenames.
The earlier bundled images remain unchanged for historical docs.

DottedIllustration.tsx draws the dots using the active Studio theme.
The new PNGs have transparent margins, so the page background shows through.
The terminal and file-browser windows retain the approved dark finish.
The same component is used in the page and image lightbox.
PDF and Word exports use the transparent PNGs on the document background.

terminal-dotted/build.cjs reproduces the approved dark preview frames.
terminal-dotted/promote.cjs generates the transparent app images and checks every image corner.
The operating-system selection still controls commands, paths and images.
start-here-theme-review.html includes Light and Dark buttons for testing the two illustrations.
The full Start here preview has a theme switch in its header.

The dots are larger and clearest near the window, then fade outward with intersected edge gradients.
The foreground PNG is not masked.
The theme render and the full Start here preview share DottedIllustration.css with the app.

The latest refinement gives every illustration a 24px margin with two dot rows per side.
Dark mode uses 35% opacity. Light mode keeps 95%. Both fade outward.
Original PNGs and older previews remain available.
Run terminal-dotted/check-surround.cjs for the browser checks and saved screenshots.

## Your preferences preview

The next section has been checked against the live app and drafted in preview only.
Open preferences-review.html. Read preferences-review-notes.md for the findings and limits.
Rebuild with `python3 docs/review/user-guide/build-preferences.py`.
The source article and template are preferences-article.html and preferences-template.html.
Original captures and framing are under preferences-evidence.
Each of the 12 actions has a screenshot. The preview uses 15 equal frames.
The sidebar demonstrates moving preferences into Personal settings after lab setup.
The operator approved publication on 2026-11-12. The guide is promoted in English, French and Portuguese.
Personal settings now contains Your preferences. Other published guide groups are unchanged.
preferences-focus.json preserves the approved crop, markers and phone screenshot dimensions.
The earlier screenshots and clips remain available. The review files remain editable.

## Terminology preview

Your preferences was published and pushed in f37702ef, followed by changelog commit ede2a676.
The operator asked to review Terminology next, with changes kept in preview.
Open terminology-review.html and read terminology-review-notes.md for the findings and proof limits.
Rebuild with `python3 docs/review/user-guide/build-terminology.py`.
The source article and template are terminology-article.html and terminology-template.html.
Original screenshots, fixture files, framing and cleanup evidence are under terminology-evidence.
The draft has 47 numbered steps and 56 equal screenshot frames.
The live review created and removed one temporary code system and one temporary value set.
Their two synthetic terms were removed with the code system. Original code-system and value-set ID sets matched afterward.
The draft and its proposed setup navigation remain uncommitted. Published Terminology content remains unchanged.

## High-resolution images after the power cut

The preview height cap was removed. Standalone pages use the current viewport height.
All four active guide previews now use native 4x captures or native illustration renders.
Desktop sources are 5120 by 3200 pixels. Phone sources are 1500 by 3248 pixels.
The seven older Dashboard reference images were also recaptured. Their crops retain native pixels.
The Dashboard phone reference uses 1560 by 3376 pixels.
The 43 terminal and file-browser illustrations are 2944 by 1664 pixels.
Original app images are preserved in high-resolution/original-app.
The previous terminal renders are preserved in terminal-dotted/original-2x.
Original review screenshots remain in their original evidence folders.

Start here, Dashboard and Your preferences use the new assets in app source.
Terminology remains a preview. Its published article has not changed.
The same framing is used in each page and its lightbox.
Blur scales with the frame width, so large images retain the intended distinction.
Videos and their original posters were not re-recorded.
No commit or push was requested for this image batch. These edits remain uncommitted.

The capture script is capture-high-resolution.cjs. It has preferences, terminology,
dashboard and dashboard-reference phases. Dashboard phases require a separate sample installation
at ports 3006 and 5186. Never point those phases at the populated warehouse.
The temporary PostgreSQL container used for this run was removed after capturing.
The normal database was not reset or seeded. Preferences were restored to their original values.
Terminology cleanup compared the original ID sets and retained 514 code systems and 690 value sets.
Dashboard cleanup compared the entire original dashboard list and removed only owned examples.

Rebuild the previews with build.py, build-preferences.py and build-terminology.py.
Then run promote-high-resolution.py to update approved app assets and framing.
That promotion script also needs Pillow. It does not promote the Terminology article.
terminal-dotted/promote.cjs renders all terminal and file-browser images at 4x.
check-high-resolution.cjs verifies the active previews against the server at port 4392.

Checks for this batch:

- `node docs/review/user-guide/check-high-resolution.cjs` passed for all four previews.
  It checked native image widths, 2560 by 1440 enlargement and 375 by 812 layout.
  All previews used the full 812px mobile viewport without horizontal overflow.
- `pnpm --filter @openldr/studio typecheck` exited 0.
- `pnpm --filter @openldr/studio test src/docs/Lightbox.test.tsx src/docs/validation.test.ts`
  reported 2 test files and 25 tests passed. Existing dialog-description warnings remain.
- `pnpm --filter @openldr/studio build` exited 0, built in 10.86 seconds.
  Existing dependency annotation and chunk-size warnings remain.
- Live app checks confirmed Dashboard and Preferences load 5120px sources in their lightboxes.
  Start here loads 2944px illustrations. Details are in high-resolution/app-checks.json.
- `git diff --check` exited 0.

These checks cover capture rendering, documentation components and desktop compilation.
They do not prove physical phone behavior, native Windows or macOS CLI execution,
or higher-resolution video playback. Existing recordings remain unchanged.

The preview server now serves this repository folder directly at port 4392.
The previous copies under the Codex visualization folder were refreshed too.


## Approved Terminology publication and menu order

On 2026-11-12, the operator approved the high-resolution updates and Terminology for main.
Terminology is published in English, French and Portuguese with 47 steps and 56 image placements.
The three reused screenshots have separate placement names so their step numbers remain correct.
The earlier guide captures remain available.

Set up your system is the new documentation group after Start here.
Its order is Terminology, Facilities, Test catalog, Patients, Forms, Workflows.
Facilities, Test catalog and patient settings are optional. The guide introductions and web
getting-started pages strongly recommend configuring them during use. They are not presented
as prerequisites for receiving and processing data. Lab order test choices use the configured catalog.

All four active previews use navigation.json through build.py. Their menu order matches the app registry.
Start here includes a live Terminology preview link, so the round trip keeps it available.
Historical image comparison pages remain unchanged.

Facilities is the next guide to review. Its full walkthrough has not been rewritten in this slice.
Only the optional setup note was added to Facilities, Test catalog and Patients.

Publication checks: 94 Studio documentation tests and 29 web documentation tests passed.
Studio and web typechecks passed. The Studio production build completed in 9.38 seconds.
Browser publication results are recorded in high-resolution/publication-checks.json.
The browser checks cover all three Terminology locales, 47 numbered steps, 56 screenshot placements,
5120px native image sources, mobile layout and the preview navigation round trip.
A physical phone is still needed to verify controls against retracting browser chrome.

## Facilities preview awaiting review

The Facilities walkthrough is at facilities-review.html on the preview server at port 4392.
It has 63 numbered steps and 88 screenshot placements. Every step has a screenshot.
Desktop sources are native 5120 by 3200 PNGs. Phone sources are 1500 by 3248.
The enlarged view keeps the page's crop, sharp focus and surrounding blur.

The walkthrough starts with the user's own facility details and files.
Optional practice downloads appear at the end. CLI setup links to Start here.
All five active preview pages now keep the Facilities link in the same menu position.

Review findings, commands and limits are in facilities-review-notes.md.
The actual browser workflows used a separate temporary installation.
Its database container, API, Studio server and temporary Vite config were removed afterward.
The normal application and the static preview server remain available.
See facilities-evidence/cleanup-checks.json for the owned resources removed.

Rebuild with `python3 docs/review/user-guide/build-facilities.py`.
Check with `node docs/review/user-guide/check-facilities-preview.cjs`.
The check reported 63 steps, 88 frames, no missing screenshots, a 5120px lightbox source,
an 812px mobile viewport without horizontal overflow and successful navigation and downloads.

This is preview work only. Published Facilities content and original images are unchanged.
No commit or push was made. Await the operator's review before publication.

## Facilities approved for main, remaining sections authorized

The operator approved Facilities publication and requested the remaining guides as previews.
Commit and push after every section. Do not wait for routine review questions.
Practice data remains optional. Contact the operator only for urgent or destructive choices.
The resumable checklist is docs/superpowers/plans/2026-11-12-user-guide-review.md.

Facilities now has English, French and Portuguese publication files, 88 native screenshot
placements and two optional public practice downloads. All 94 Studio documentation tests
and 29 web documentation tests passed. Studio typecheck and the production build passed.
The build completed in 9.72 seconds with existing dependency annotation and chunk-size warnings.
The web typecheck is also part of the publication checks.
Browser checks on the isolated installation confirmed all three locales have 63 numbered
steps and 88 images, with 5120px lightbox sources. The 375 by 812 layout had no horizontal
page overflow. Physical phone browser chrome remains untested.
The publication evidence is facilities-evidence/publication-checks.json.

The active capture installation is separate from the normal app:
- Container openldr-guides-review-pg, PostgreSQL port 15439, durable owned volume openldr-guides-review-pg-data.
- Databases guide_internal and guide_target. Test credentials guide and guide.
- API 3006, Studio 5186. Logs /tmp/openldr-guides-review-api.log and /tmp/openldr-guides-review-studio.log.
- apps/studio/vite.guides-preview.config.ts is temporary and locally excluded from git.
- API uses AUTH_DEV_BYPASS=true, MIGRATE_ON_START=true and SEED_ON_START=true.
- Keep INTERNAL_DATABASE_URL and TARGET_DATABASE_URL pointed to the review databases on port 15439.
Never run the general sample reset commands against the populated installation.

Next section is Test catalog. Remaining sections stay in preview until the operator approves publication.

Facilities publication commit: 4e9981a0. Changelog generation and push follow this commit.

## Test catalog preview checkpoint

Facilities publication and its changelog were pushed through ef2273df.
The remote main SHA was verified as ef2273df4425452ab431ac587ca5048685df8cea.

Test catalog is now available at test-catalog-review.html on port 4392.
It has 59 numbered steps and 82 image placements, with native desktop and phone captures.
Practice files remain optional. The published Test catalog article is unchanged.
See test-catalog-review-notes.md and test-catalog-evidence/preview-checks.json.
The preview checks passed every source, step coverage, enlargement, anchors, mobile layout and menu consistency.
The check returned 59 steps, 82 frames and HTTP 200.

Active preview routes now come from preview-pages.json.
Build new sections with write-guide-article.py and build-guide.py, then refresh-navigation.py.
The capture-kit.cjs module constrains workflow writes to the isolated API on port 3006.
The temporary capture installation remains available with its owned durable PostgreSQL volume.
Next section is Patients. Use fictional patients in the isolated installation only.

## Patients preview checkpoint

The Test catalog preview and its exact Add range label were pushed through 521ef7ac.
Remote main was verified as 521ef7acbc30c290ce33ebfb0c18697a60382f5d.
Changelog generation after those docs commits produced no tracked change.

Patients is available at patients-review.html on port 4392.
It has 42 numbered steps and 57 screenshot placements, using native 4x captures.
The guide covers patient search, identifier labels, source-reported replacement navigation,
duplicate review, dismiss/restore and export. Practice is optional.
The published Patients guide remains unchanged.
See patients-review-notes.md, workflow-checks.json and preview-checks.json under its evidence folder.
All seven active previews share the same navigation.
Patient route tests passed 19 tests. These prove permission/audit routes with mocked stores,
not live browser masking. The screenshots use full identifier-view permission.

Capture phases must run in sequence. capture-kit.cjs now reloads the on-disk manifest per image.
The builder rejects focus targets clipped by a crop.
The owned isolated installation and durable database volume remain available.
Next section is Forms. Submissions must remain inside the isolated installation.
An unrelated untracked local-sign-in spec appeared in the shared worktree during this task.
It belongs to other work and was not edited or staged.

## Power-cut recovery and Roles preview

The operator confirmed a power cut and asked to continue.
Facilities, Test catalog and Patients were already pushed through cf30972b.
The owned review PostgreSQL volume survived. API3006, Studio5186 and preview4392 were restarted.
Several interrupted Forms PNGs and the submission-response JSON were empty.
The original native successful-state screenshot survived. The warehouse has two requests for
Case One, including the one request present before the form task. The form was not submitted again.
The one-submission recovery proof is forms-evidence/order-submitted.json.
Interrupted field/preview images were re-recorded. Forms is still in progress.

The capture helper now validates isolated server ports, flushes PNGs to disk and atomically
replaces them. Its manifest and operation-proof writer also flushes before replacing files.
The parallel execution ruling and port allocations are in the resumable plan.
Root owns Forms. Separate agents own data, administration and system guide groups.
They do not edit shared helpers/navigation or commit. Root verifies and pushes each ready section.

Roles is now at roles-review.html. It has 21 numbered steps and 26 native screenshot placements.
It covers navigation through Settings, inspecting roles, creating a custom role, editing it,
deleting the owned practice role and phone use. Practice is optional.
The published Roles guide remains unchanged.
The integrated browser check passed 21 steps, 26 frames, zero missing screenshots,
no broken anchors, a 5120px enlarged source and no horizontal overflow at 375 by 812.
Its permission-effect limitations are recorded in roles-review-notes.md.
