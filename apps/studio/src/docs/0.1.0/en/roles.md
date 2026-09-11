# Roles

Administrators use **Settings → Roles** to control exactly what each account can see and do, capability by capability.

> **Authentication vs. authorization:** Keycloak still handles sign-in — it verifies who a user is. OpenLDR owns *what a signed-in user can do*: every role, every capability, and every user-to-role assignment lives in the OpenLDR database, not in Keycloak. This means access control keeps working the same way regardless of which identity provider is connected.

## Outcome

You can see the built-in system roles, inspect the capabilities each one grants, create a custom role from the capability grid, and understand how roles reach a user's account.

## Before you begin

- You need the **Manage roles** capability (granted to Administrator by default).
- Know which capabilities the person's job actually requires — grant the smallest set that lets them work.

## What a capability is

A **capability** is a single, narrow permission such as *Run reports*, *Edit workflows*, or *Manage users*. Capabilities are grouped by area (Dashboards, Reports, Forms, Workflows, Query, Users, Roles, Terminology, Marketplace, Connectors, Sync, Settings, Observability, Audit) and are the only thing the server checks before it lets a request through — every page and every action is gated behind one or more capabilities.

A **role** is a named, reusable bundle of capabilities. Studio's user editor assigns one role per user. Choose a role containing the capabilities needed for that person's work.

## Built-in system roles

OpenLDR ships five system roles, each a starting point you can assign as-is or copy the idea from when building a custom role:

- **Administrator** — every capability in the catalog. This role is **locked**: its capability set cannot be edited or removed, so there is always at least one account that can recover access.
- **Lab Manager** — manage dashboards, reports, forms, and workflows, plus terminology and the query workbench. No user administration or settings access.
- **Data Analyst** — view dashboards, run and export reports, use the query workbench. Read-oriented, no editing capabilities.
- **System Auditor** — read-only oversight across the main workspaces, plus the audit log.
- **Lab Technician** — data entry only: open and submit forms, nothing else.

System roles other than Administrator can be edited (their capability set adjusted) but not deleted while users remain assigned, and Administrator can never be edited or deleted — it is permanently locked.

## Steps: create a custom role

1. Open **Settings → Roles**.
2. Select **Create Role**.
3. Enter a **Name**; a URL-safe **Slug** is derived automatically (you can adjust it before saving — it becomes fixed once the role is created).
4. Add an optional **Description** so other administrators know when to use this role.
5. In the capability grid, tick each capability the role should grant. Capabilities are grouped by area to make related permissions easy to find.
6. Select **Create** to save the role.

To change an existing non-locked role, open its row (or its **⋯ → Edit** action), adjust capabilities, and save. Roles that still have members can be edited but not deleted; remove all members first if you need to delete a role.

## Assign roles to users

Role assignment happens on the user's own record, not on the role:

1. Open **Users**.
2. Open the **Actions** menu for the account and choose **Edit**.
3. Wait for the role list to load, then open **Role** and select one role. This is a single-choice selector. Selecting another role replaces the selection; it does not add a second role.
4. Save and check for the success notification. Reopen the user's record to verify the saved Role selection.

Editing the user requires **Manage users**. Saving the role assignment also requires **Manage roles**. If role assignment fails, the editor stays open and shows an error. Resolve it before treating the update as complete.

If no available role has the required capabilities, create or adjust a role in **Settings → Roles**, then return to Users to assign it. Changing a shared role's capabilities affects everyone assigned that role.

## Expected result

The Roles list shows each role's name, description, and member count. Reopening a user in Studio shows the selected role. That role defines the capabilities assigned through this editor.

## Troubleshooting

- **Can't edit a role's capabilities:** the role is locked (Administrator) or you lack the **Manage roles** capability — you can still open it to inspect its capabilities.
- **Can't delete a role:** it is a locked system role, or it still has members; reassign or remove those members first.
- **A user still has old access after a role change:** ask them to sign out and back in, or wait for their session to refresh.
- **A newly created user seems to have no access:** confirm at least one role was assigned — an account with zero roles has zero capabilities.

## Advanced web usage

Create roles for distinct jobs and assign the appropriate one to each user. The audit log records role changes and user assignments. The `openldr roles` CLI commands support scripted or headless administration.

## How capabilities reach an existing install

New OpenLDR versions add capabilities. Roles live in the database, so a role created by an earlier
version does not automatically know about a capability introduced later. OpenLDR reconciles this on
every start:

- **Administrator** is always brought up to the full capability list. The role is locked and is
  defined as "every capability", so there is no customisation to preserve — if a release adds a
  capability, the Administrator role has it after the next restart.
- **The other built-in roles** receive a capability **only the first time that capability exists**.
  After that, OpenLDR never re-grants it. If you remove a capability from Lab Manager, it stays
  removed across restarts and upgrades.
- **Custom roles you create are never modified.** If a new capability is relevant to one of your own
  roles, grant it yourself in Settings → Roles.

A capability granted this way is recorded in the audit log as `role.capability.backfill`, so an
upgrade that widens a role leaves a trace.

To see how your install compares with the built-in definitions, run `openldr roles doctor`. It
reports, per built-in role, which capabilities are held, which you have deliberately removed, and
which are still pending — plus any capability keys left behind by a retired feature.

## Related guides

- [Users and Roles](/docs/users)
- [Audit](/docs/audit)
- [Settings](/docs/settings)
