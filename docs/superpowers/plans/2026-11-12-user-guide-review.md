# Remaining user guides implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task. Track each section below.

**Goal:** Publish the approved Facilities guide and review every remaining guide against the app.

**Architecture:** Preserve the approved guide layout and focused image treatment. Capture real app states in an isolated installation. Save each remaining section as a standalone preview with its source, evidence and reproducible checks.

**Tech stack:** Studio markdown, React screenshot frames, Python preview builders and Playwright capture scripts.

**Spec:** The operator's instructions in this chat and `apps/studio/src/docs/HOW-TO-TEMPLATE.md`.

## Global constraints

- Every numbered step has a native high-resolution screenshot of the actual app.
- Page and lightbox use the same crop and focus. Preserve old images.
- Own data first. Fictional practice data is optional.
- Facilities, Test catalog and patient setup remain optional and strongly recommended.
- Shared navigation uses Set up your system and includes Patients.
- Apply `.agents/skills/unslop/SKILL.md` to new prose.
- No writes to the populated installation. No destructive experiments on user resources.
- Commit and push after every section. Update this checklist and HANDOFF.md first.
- Publish approved Facilities in English, French and Portuguese. Remaining guides stay in preview until reviewed.
- The operator explicitly requested autonomous execution. Do not add a plan approval pause.

## Review focus

Check labels, permission boundaries, save locations, required fields and data prerequisites against code and live UI.
Record unsupported or untested actions rather than guessing. A physical phone is needed for retracting browser chrome.

## Task 1: Publish Facilities

- [x] Convert the approved article into three locale files under `apps/studio/src/docs/0.1.8/`.
- [x] Copy the native images, add Facilities focus metadata and declare captured image names.
- [x] Keep optional download files available through the public docs samples folder.
- [x] Run documentation integrity tests, Studio typecheck, build and browser publication checks.
- [ ] Commit on main. Run `pnpm make:changelog`, commit any resulting change, push and verify the remote SHA.

## Remaining sections

For each section, read its app implementation and current guide. Name and check any suspected gap before rewriting.
Create `<slug>-article.html`, `<slug>-review.html`, native evidence, capture script and review notes under `docs/review/user-guide/`.
Reuse the named Facilities sibling for layout. Add its link to all active previews through shared navigation.
Check every screenshot loads at native resolution, every numbered step has evidence, and desktop/mobile navigation and enlargement agree.
Save command output and limits. Commit and push the section before moving on.

- [ ] Test catalog
- [ ] Patients
- [ ] Forms
- [ ] Workflows
- [ ] Reports
- [ ] Activity
- [ ] Scheduled reports with workflows
- [ ] Custom Queries
- [ ] Report Designer
- [ ] Layouts
- [ ] Users and Roles
- [ ] Roles
- [ ] Audit
- [ ] Settings
- [ ] Setup checks
- [ ] Laboratory
- [ ] Data exposure
- [ ] Distributed Sync
- [ ] Connectors
- [ ] Connect to SQL Server and diagnose a connection
- [ ] Import from OpenLDR v1
- [ ] Marketplace
- [ ] Plugin cards and side panels
- [ ] Authentication providers
- [ ] Environment Variables
- [ ] Planned upgrades
- [ ] Deployment & Developer Docs

## Recovery

The static preview server serves `docs/review/user-guide` on port 4392, bound to all interfaces.
Reopen the last section from HANDOFF.md. Check git status and the remote SHA before resuming.
Do not reset, seed or restore the normal databases. Recreate only the owned isolated capture installation.
