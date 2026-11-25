# The lab profile pack

Date: 2026-11-25. Batch 4, item D1 (C9, the missing Reception role, folds in). Small change.
Approved by the operator on 2026-11-25. Content only: no CE code.

## Why

An install becomes a lab today only by hand: an administrator makes each role, grants each lab
permission and sets a sidebar. The profile packs design (2026-11-22) made that a pack. The
collection-site pack exists; the lab one does not.

## Facts checked first

- CE already has every step kind the pack needs: `needs`, `role` (plugin permission keys allowed),
  `layout` (`packages/bootstrap/src/content-pack-profile.ts:86-113`).
- A layout may list a plugin page, `/x/lab` (`apps/studio/src/shell/AppShell.layouts.test.tsx:177`).
- The lab plugin's bundle id is `lab` (`openldr-ce-plugin-lab/manifest.template.json:4`).
- A role step refuses a slug another role already has; the plugin's live check uses `lab-desk`,
  `lab-site`, `lab-bench`, `lab-review`, `lab-senior`, `lab-desk-view`, `lab-desk-names` and
  `lab-site-reject`, so the pack uses other slugs.

## How Corlix does it

Corlix seeds Receptionist, Laboratory Technician, Laboratory Manager and Laboratory Administrator.
The manager verifies and amends. Ported: the names and the split. Not ported: the administrator,
which is CE's own Administrator role.

## Approaches

- Chosen: one pack with the four job roles the plugin guide describes and one layout.
- Not chosen: a role per permission. Too many roles for a small lab to assign.
- Not chosen: put the roles in the plugin. A plugin cannot make CE roles; packs exist for that.

## Design

New repo `~/Projects/Repositories/openldr-ce-content-pack-lab` (no remote), copied from the
collection-site pack: `build.mjs`, `check.mjs`, `PACK.md`, `README.md`, `.gitignore`.

| Step | Key | What it makes |
|---|---|---|
| `needs` | | `lab` 0.1.0 or later. |
| `role` | `lab-receptionist` | Lab receptionist: `lab.receive`, `lab.reject`, `lab.worklist.view`, `patients.find`, `patients.view_identifiers`. |
| `role` | `lab-technician` | Lab technician: `lab.results.enter`, `lab.worklist.view`, `patients.find`. |
| `role` | `lab-reviewer` | Lab reviewer: `lab.results.authorise`, `lab.worklist.view`, `patients.find`. |
| `role` | `lab-manager` | Lab manager: every `lab.*` permission (receive, reject, orders.enter, worklist.view, results.enter, results.authorise, results.amend, settings), `patients.find`, `patients.view_identifiers`. |
| `layout` | `laboratory` | Laboratory: `/x/lab`, `/patients`, `/docs`. Start page `/x/lab`. Default for the four roles. |

- The pack carries no clinical codes.
- Role names are English only: CE roles have one name.
- No site role. A site uses the collection-site pack, or an administrator makes one.

## Proof

- `node check.mjs`: CE parses the pack and its summaries match CE's.
- Live check on the dev stack: install (dry run, then real), the four roles hold exactly the listed
  permissions, the layout lists the three pages and is default for the four roles; remove puts it
  all back.

## Left to the builder

- The role descriptions and `PACK.md` wording.
