# Continue the user guide review

These files preserve the documentation review if the desktop loses power.
The operator authorized merging this checkpoint to main on 2026-11-12.
The remaining guide sections still need review before they replace existing app content.

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
The remaining Dashboard tasks are drafts. Review them one task at a time.
Do not claim those remaining instructions have been verified by this session.

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
FocusedScreenshot.tsx applies the approved crop and blur to the four new Create captures.
The browser lightbox retains the page crop, blur and markers when enlarging the image. PDF and Word exports show the original full images.
CLI exports use the default Linux walkthrough. Platform buttons affect the browser view.
The rest of the app Dashboard guide keeps its earlier content pending review.
The full Dashboard preview applies the new treatment to all 32 screenshot placements.
Its widget and sample instructions still need task-by-task review.
Do not confuse the reviewed Create task with those remaining drafts.
The operator authorized merging and pushing this review on 2026-11-12. No deployment was requested.


## Checks for this checkpoint

See verification/checks.md for commands, outputs, and limits.
The browser checked all three guide languages and all three CLI platform choices.
This review is being merged to main at the operator's request. Regenerate the release changelog after merging. No deployment was requested.
