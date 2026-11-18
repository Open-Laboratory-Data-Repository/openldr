# Roles for forms and dashboards, and data limited to a facility or area

Date: 2026-11-18. Operator's choices: forms per role; dashboards both shared by role and limited to the
person's facility or area (option C); docs that show only what a person can do, dropped if too much work.

## Why

On the 2026-11-18 call the team described a lab that uses CE only for sample tracking, through forms. Its
staff should open and submit only the forms they work with, and see dashboards for their own facility or
area. A district or national user sees more. Today every permission is all or nothing:

- `forms.view` and `forms.submit` cover every form (`packages/rbac/src/catalog.ts:28-31`).
- `dashboards.view` shows every dashboard (`apps/server/src/dashboards-routes.ts:96`), with everyone's data.
- A user has no facility or area.

## Goals

1. Each form can name the roles that may open it and the roles that may submit it.
2. Each dashboard can be shared with chosen roles.
3. A user can be limited to one or more facilities, districts or regions. Every dashboard widget that user
   runs counts only rows from those facilities.
4. Optional: the in-app docs list only the pages a person can use.

Non-goals: limiting reports, patient pages, lab request pages, exports or the CLI by facility (see
Constraints); limiting by anything other than facility and area; per-field form permissions.

Anti-goals: a limited user who can still see another facility's numbers through any dashboard widget; an
existing install where someone loses access on upgrade.

## Approaches

The operator chose C (shared dashboards and data limited by facility or area) over A (sharing only) and B
(data limit only). Forms per role had one sensible way.

## Design

### 1. Forms per role (my calls)

A form gets two role lists: who may open it, and who may submit it. Both start empty, and empty means what
happens today: every role with `forms.view` may open it and every role with `forms.submit` may submit it.
A list, once set, narrows that further: the role needs the capability and must be on the list. Admins
(the role that holds `roles.manage`) always pass. The form list, the form page and the submit route all
apply the same check, in one shared function. Set in the form builder's sheet, ⋯ menu, **Access**.

### 2. Dashboards shared with roles (my calls)

A dashboard gets a role list. Empty means today: everyone with `dashboards.view`. A list narrows it. The
owner and admins always see it. Set from the dashboard's ⋯ menu, **Share**, in a sheet.

### 3. Data limited to a facility or area (my calls)

- A user gets a **data scope**: everything (the default, today's behaviour), or a list of facilities,
  districts and regions from the facility register (`facility_registry.region`, `district`). Set in the
  Users sheet. Stored in a new table, `user_data_scopes` (user id, kind `facility|district|region`, value).
- At query time the scope turns into a set of facility codes through the register and `facility_map`.
- Each dashboard model names the column that ties its rows to a facility (for lab requests, the request's
  facility code; for results and reports, through their request). The compiler adds that limit to every
  query a limited user runs, the way it already applies the column policy (`effectiveModel`,
  `packages/dashboards/src/compile.ts:211`).
- A model with no facility link (patients today) is not offered to a limited user. Raw SQL widgets and
  custom queries cannot be limited safely, so they do not run for a limited user: the widget says
  "Not available with your data limit."
- An unlimited user sees no change.

### 4. Docs that show what a person can do (optional, my call to keep it small)

Each in-app doc page may name the capability it needs. The docs list hides a page whose capability the
person lacks. Pages that name none stay visible. If this grows beyond that, it is dropped, as the operator
said.

### CLI

`openldr forms access <formId> --open role,role --submit role,role`, `openldr dashboards share <id> --roles
role,role`, and `openldr users scope <userId> --facility X --district Y --region Z | --all`. Shared logic
in `@openldr/bootstrap`, audited as `cli`.

## Constraints

- The data limit covers dashboards only, as asked. Reports, the patient and lab request pages, exports and
  the CLI still show every facility. A limited user must therefore get a role without `reports.*`,
  `patients.*` and export capabilities. The Users sheet warns when a limited user has a role that can see
  unlimited data, and the docs say so plainly.
- Upgrades keep today's access: empty lists and no scope mean what they mean now.
- AGENTS.md section 5 (sheets, ⋯ menus, label-left forms, pagination), section 6 (CLI, docs en/fr/pt,
  mobile, changelog), section 8 (no hard-coded facilities).
- Migration numbers: check open branches before each one (124 is claimed by the held-corrections design).

## Order of work

1, then 2, then 3, then 4. Each lands on its own. 3 is the largest and the riskiest.

## Left to the builder

The exact facility link of each model, the wording in three languages, the role picker component (reuse
the Users sheet's), test fixtures.
