# The lab profile pack: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed content pack that turns a CE install with the lab plugin into a lab: four roles and the Laboratory sidebar.

**Architecture:** A new repo copied from `openldr-ce-content-pack-collection-site`. `build.mjs` writes
`dist/pack.json` and `dist/manifest.json`; `check.mjs` parses them with CE's own code. No CE change.

**Tech Stack:** Node (`build.mjs`, `check.mjs` read CE's TypeScript), the `openldr` CLI to sign and install.

**Spec:** `docs/superpowers/specs/2026-11-25-lab-profile-pack-design.md`

## Global Constraints

- Pack id `lab-profile`, version `0.1.0`, CE range `>=0.1.12`, publisher `local-dev` by default.
- Steps in this order: `needs` (`lab` `>=0.1.0`), roles `lab-receptionist`, `lab-technician`,
  `lab-reviewer`, `lab-manager` with exactly the spec's permissions, layout `laboratory`.
- No clinical codes. No em dashes.

## Review Focus

1. Installing without the lab plugin: refused with "this pack needs lab".
2. A dev install that already has a role with one of the four slugs: refused, nothing written.
3. Removing the pack while a user holds a pack role: CE refuses unless forced, as for collection-site.
4. The manager's permissions are every `lab.*` key the plugin declares, no more: a later plugin key is not silently missing.
5. The layout is default for exactly the four roles.

---

### Task 1: the pack repo

**Files:** Create `~/Projects/Repositories/openldr-ce-content-pack-lab/{build.mjs,check.mjs,PACK.md,README.md,.gitignore}`.

- [ ] **Step 1:** Copy `check.mjs` from the collection-site pack and add two checks: every `lab.*` key in
  the lab plugin's `manifest.template.json` permissions is on `lab-manager`, and the layout's roles are
  the four slugs. Run `node check.mjs` with no `dist/`. Expected: fails (no `dist/pack.json`).
- [ ] **Step 2:** Write `build.mjs` with the steps above, `PACK.md` and `README.md`.
- [ ] **Step 3:** Run `node build.mjs && OPENLDR_CE=/home/fredrick/Projects/Repositories/openldr_ce node check.mjs`. Expected: exit 0.
- [ ] **Step 4:** `git init`, commit `feat: the lab profile pack: four lab roles and the Laboratory layout`.

### Task 2: live check on the dev stack

- [ ] **Step 1:** Sign with the dev throwaway key (`openldr artifact pack dist --key <key> --out dist/signed`).
- [ ] **Step 2:** `openldr market install dist/signed --dry-run`, then install. Read the roles and the layout
  through CE (`openldr roles show`, `/api/layouts`): exact permissions, three pages, default for the four roles.
- [ ] **Step 3:** `openldr market remove lab-profile --force`; the four roles and the layout are gone.
- [ ] **Step 4:** Record the commands and output in the README's "Try it" section; commit.
