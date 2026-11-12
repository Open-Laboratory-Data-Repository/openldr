# Continue the user guide review

This branch preserves the documentation review if the desktop loses power.
The review is in progress. Do not merge it without the operator's review.

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
git switch --track origin/codex/docs-guide-review
```

If the branch already exists locally, switch to it and run `git pull --ff-only`.
Start a new Codex session in that checkout and ask it to read this file.
The Git branch carries the preview and source files. It does not carry the current chat or running processes.

## Editing

The article and step HTML files are the editable content.
Original full screenshots are under create-dashboard-focus/raw and evidence.
Terminal scenes and their manifest are under terminal-illustrations.
The existing standalone HTML pages can be opened immediately.
Some earlier build scripts reference the optional Codex visualization renderer.
A portable rebuild script will replace that dependency in the next checkpoint.

## Source integration

Approved Start here and Create a dashboard will be moved into the latest in-app docs in English, French, and Portuguese.
The rest of Dashboard remains pending review. Do not discard its existing source content.
No merge, deployment, or release changelog update is part of this review branch.
