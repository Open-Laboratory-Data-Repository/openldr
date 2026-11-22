# Profile packs: design

Status: DRAFT for operator review. No code written.
Date: 2026-11-22.

## 1. What this is and why

The operator wants the standalone app to be a base that other people build on. The same app
should serve a collection site, a laboratory and a data hub. Each sees only what it needs.
The server tier should do the same for countries that want central control.

A profile is what makes one install look like a collection site and another like a lab. It
brings a role, a sidebar, forms, and the plugins that job needs, in one install.

This is the first of three pieces the operator ordered on 2026-11-22:

1. Profile packs. This design.
2. A lab module, ported from Corlix. It needs new plugin permissions in the host.
3. Sample tracking between a collection site and a lab.

The user action that is broken today: an admin who wants a collection site has to create a
role, tick its capabilities, build a layout, install each form and set who may open each form,
all by hand, on every install. Nothing carries that setup from one install to the next.

## 2. Gap check

| Claim | Verdict | Proof |
|---|---|---|
| Nothing hides pages per role | REFUTED | `visibleNav` filters by capability, then by layout: `apps/studio/src/shell/AppShell.tsx:56` |
| A layout can lock a user out of a page | REFUTED | A layout only hides. The user can pick the full sidebar from their menu: `AppShell.tsx:281`. Capabilities are the lock. |
| A layout can hide a plugin page | REFUTED | Plugin pages are added after the layout filter: `AppShell.tsx:199`. A plugin's own `requiredRoles` hides it: `packages/marketplace/src/artifact-manifest.ts:44` |
| A content pack cannot carry a role | CONFIRMED | The step kinds are code system, value set, facility register, link matching, custom queries, test mappings, result mappings, datasets: `packages/marketplace/src/content-pack.ts:16` to `48` |
| A content pack cannot carry a layout | CONFIRMED | Same list. Layouts are saved only through `saveLayout`: `packages/bootstrap/src/layout-presets.ts:83` |
| A content pack cannot carry a form | CONFIRMED | Same list. A form installs only as its own bundle: `packages/bootstrap/src/form-artifact-install.ts:19` |
| A pack cannot say which plugin it needs | CONFIRMED | Same list. No step names another bundle. |
| An old CE breaks on a pack with new steps | REFUTED | An unknown step kind gives "this pack needs a newer CE" before anything is written: `content-pack.ts:79` |
| Removing a pack takes out what it installed | CONFIRMED gap | Remove deletes the install record only: `packages/bootstrap/src/content-pack-install.ts:286` |
| A pack can limit a form to a role | CONFIRMED gap | Form access is a per-form list of role ids, set outside any pack: `packages/bootstrap/src/form-access.ts:15` |

Not checked: whether an unmerged branch already claims migration 135.

Corrected from the conversation: I said reports ship as a marketplace bundle type. The
manifest declares `report-template`, but only `packages/cli/src/artifact.ts` mentions it. No
host installer exists. Reports reach an install through a content pack's queries and
datasets, as in `openldr-ce-content-pack-reports-zm`.

## 3. Goals, non-goals, anti-goals

Goals:

- One signed pack sets up a job: its role, its sidebar, its forms, and the plugins it needs.
- One install can hold several profiles. A lab can have a reception profile and a bench
  profile side by side.
- The same pack installs on standalone and on a server.
- Removing a profile takes its role and layout out and leaves the data.
- A real profile, the collection site, is built and installed from a repo.

Non-goals for this version:

- A first-run screen that asks what the computer is for. It needs packs that ship inside the
  app for sites with no internet. That is the second piece.
- "Save as profile" in the studio. Second piece, once the format has been used once.
- Dashboard and workflow steps. Neither has an export format today.
- A report step. A profile names the report pack it needs instead.
- A central server pushing profiles to sites.

Anti-goals:

- A profile must not be a second permission system. Capabilities stay the only lock.
- A profile must not put clinical vocabulary in the core (AGENTS.md section 8). Forms and
  their codes live in the pack repo.
- Installing a profile must not change a role or layout an admin made by hand.

## 4. Approaches

**A. More steps in the content pack.** One signed file holds the roles, the layout and the
forms, and names the plugins it needs. It reuses the installer, which checks every step
before it writes. One version number per profile. The cost is that a form inside a profile
cannot update on its own.

**B. A new profile bundle that points at other bundles.** Pieces update on their own and two
profiles can share a form. The cost is that one profile means publishing and fetching
several bundles, and one missing bundle breaks the install.

**C. Profiles coded into the app.** Fastest. Nobody outside can add one, which defeats the
reason for the work.

The operator picked A on 2026-11-22, with one piece from B: plugins and other packs are named
in a "needs" step, because a plugin is a signed program and cannot live inside a pack.

## 5. The design

### 5.1 New steps

Four step kinds join the content pack. `formatVersion` stays 1, because an older CE already
refuses an unknown kind with a clear message.

| Step | Carries | What install does |
|---|---|---|
| `needs` | A list of bundle ids, each with a version range | Stops the install, before any write, if one is missing or too old. The message names it. |
| `role` | Slug, name, description, capability keys | Creates the role, or updates it if this pack made it. |
| `layout` | Name, pages, start page, role slugs | Creates the layout, or updates it if this pack made it. |
| `form` | A FHIR Questionnaire, and the role slugs that may open and submit it | Installs the form and sets its access lists. |

Order in the file is the order of install. A layout or form may name only a role that an
earlier step of the same pack creates. The check phase refuses the pack otherwise. A pack
cannot attach its layout or its form access to a role an admin made, because `saveLayout`
moves that role's default layout (`packages/bootstrap/src/layout-presets.ts:113`), and that
would change something the pack does not own.

A capability key the running CE does not know fails the check phase. `CAPABILITY_KEYS` in
`@openldr/rbac` is the list, as `packages/cli/src/roles.ts:18` uses it. A layout page that is
not a studio path fails too. `studioPathSchema` already checks that.

Form access lists store role ids, and ids differ on each install
(`packages/bootstrap/src/form-access.ts:55`). The pack carries slugs. The installer turns
them into ids on the install it runs on.

### 5.1a Who may install a pack that makes a role

Installing a bundle needs `marketplace.manage` (`apps/server/src/marketplace-routes.ts:20`).
Making a role by hand needs `roles.manage` (`apps/server/src/roles-routes.ts:40`). A pack
with a role step needs both.

A pack cannot grant a capability the person installing it does not hold. The check phase
refuses and names the capability. This needs no banned list, and nobody can use a pack to
give out more than they have.

The install screen lists every capability each role step grants, by name, before the admin
confirms.

### 5.1b A failed or repeated install

Steps write one at a time, with no transaction around them
(`packages/bootstrap/src/content-pack-install.ts:253`). A form step can fail after a role
step has written. So every new step must be safe to run again. Ownership is by pack id, not
by version. A second run of the same pack finds the role it made and updates it.

### 5.2 Ownership

Every role, layout and form a pack creates records the pack id that made it. This is the
rule datasets already follow (`checkDatasets` refuses a name another pack owns).

- A pack never changes a role, layout or form it does not own. If the slug or name is taken
  by something an admin made, the check phase refuses and says which.
- Installing a newer version of the same pack updates what it owns.
- If the newer version leaves out a role or layout the older one made, the update removes
  it, by the removal rules in 5.3. A form it leaves out stays as it is.
- An admin may edit an owned role or layout. The next update of the pack overwrites the
  edit. The Roles and Layouts pages show which pack owns an item, so this is not a surprise.

This needs a place to store the owner. That is likely one migration. Check unmerged branches
for the next number before adding it. The latest on `main` is 134.

### 5.3 Removal

There is no separate "profile pack" kind. Any content pack may carry the new steps. Removing
a content pack:

1. Refuses if any user still holds a role the pack owns. It lists the users.
2. Deletes the pack's layouts and roles.
3. Leaves its forms exactly as they are, with every submitted response kept. The pack keeps
   its record of the forms, so installing it again updates the same forms and does not copy
   them. An admin can still archive them by hand. Removal does not unpublish them. On a
   server, archiving a form queues a delete for every lab that syncs from it
   (`packages/forms/src/store.ts:343`), and a pack removal must not do that on its own.
4. Leaves code systems, queries, datasets and mappings alone, as removal does today.
5. Leaves plugins and packs named in `needs` alone.
6. Deletes the install record.

On the CLI, removal refuses without `--force`, and audits through `cliActor()`. This is a
new CLI path. `openldr market remove` removes plugins only today
(`packages/cli/src/program.ts:1697`). The server route already accepts a pack id
(`apps/server/src/marketplace-routes.ts:412`).

### 5.3a The server tier

In this version a pack acts on the install it runs on, and nowhere else. On a server it
makes the role, the layout and the forms on that server. Forms then reach the labs the way
any form does today. Roles and layouts do not travel. Sending a whole profile from a central
server to its sites is a later piece.

### 5.4 What the admin sees

The install screen already lists a pack's steps with counts. It gains four lines:

```
Collection site 0.1.0
  Needs      nothing
  Role       Sample Clerk (3 capabilities)
  Layout     Collection site (Forms, Patients, Docs), default for Sample Clerk
  Forms      Lab request, Sample dispatch
```

The installed pack's detail page gets "Remove" in its dots menu. The confirm prompt is a
Dialog, because it is a destructive confirm (AGENTS.md section 5).

### 5.5 The first profile

Repo `openldr-ce-content-pack-collection-site`, built like the Zambia report pack: a
generator writes the pack, and the repo checks it.

- Role "Sample Clerk": `forms.view`, `forms.submit`, `patients.view`.
- Layout "Collection site": Forms, Patients, Docs. Start page Forms.
- Two forms, open to Sample Clerk only: a lab request, and a list of samples sent.
- No `needs` entries yet. Sample tracking adds one later.

### 5.6 Definition of done

- UI: install summary lines, owner shown on the Roles and Layouts pages, Remove in the
  pack's dots menu.
- CLI: `openldr market install` and `update` handle the new steps through the same
  installer. Removal of a pack works from the CLI.
- Docs in en, fr and pt: an in-app how-to for installing and removing a profile, and a web
  doc on what a profile is and how to write one.
- Mobile: the install summary and the remove prompt at 375 wide.
- Changelog regenerated after the merge to `main`.

## 6. Calls I made, for the operator to check

- Capabilities lock, layouts only tidy. The "full sidebar" menu item stays.
- Removal leaves data and leaves the pack's forms published. An admin archives them by hand.
- Removal refuses while a user holds one of the pack's roles.
- A pack never touches a role or layout it did not make. Its layout and forms may name only
  roles the same pack creates.
- Installing a pack with a role needs `roles.manage` as well as `marketplace.manage`, and a
  pack cannot grant a capability the installer does not hold.
- On a server, a pack acts on that server only.
- No report, dashboard or workflow step in this version.
- No first-run screen in this version.

## 7. Left to the builder

- Where the owner is stored: a column on each table, or one ownership table.
- Stable ids for layouts and forms, so a reinstall updates and does not duplicate.
- Whether `needs` checks plugins only, or content packs too. The first profile needs neither.
- The exact fields of the two forms in the collection site pack.
- Wording of each refusal message.

## 8. Verification

- Route tests pin the install and remove wire shapes. Typecheck does not.
- pg-mem tests cover the steps and the ownership rules. They do not prove the migration
  order. Only a real boot does.
- The collection site pack must install on a clean standalone run, with a Sample Clerk
  signing in and seeing three sidebar items and two forms.
