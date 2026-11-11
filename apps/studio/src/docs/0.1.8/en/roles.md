# Roles

A **role** is a named set of **capabilities**. A capability is one narrow permission, such as **Run reports** or **Edit workflows**. Each person gets one role, and the server checks the role's capabilities before every page and every action.

Sign-in is handled by the identity provider, usually Keycloak. Roles are not. Every role, capability and assignment lives in the OpenLDR database, so access control works the same whatever identity provider is connected.

This guide takes about 10 minutes. Select any picture or clip to enlarge it.

![Settings, Roles: the five built-in roles.](roles-tour.png)

## Who can do what

You need **Manage roles** to create, change or delete roles. **View roles** lets you open them and read their capabilities. Administrator has both.

## The built-in roles

| Role | What it is for |
| --- | --- |
| Administrator | Every capability. **Locked**: it cannot be changed or deleted, so someone can always recover access. |
| Lab Manager | Dashboards, reports, forms, workflows, terminology and the query workbench. No users or settings. |
| Data Analyst | View dashboards, run and export reports, use the query workbench. Nothing to change. |
| System Auditor | Read-only across the main areas, plus the audit log. |
| Lab Technician | Bench data entry: open and submit forms only. |

Built-in roles other than Administrator can have their capabilities changed. A role cannot be deleted while people still have it.

Capabilities are grouped by area: Dashboards, Reports, Forms, Workflows, Query, Users, Facilities, Patients, Roles, Terminology, Marketplace, Connectors, Sync, Settings, Observability and Audit.

## Example 1: make a read-only role

Make a role for someone who only reads dashboards and runs reports.

![Creating Dashboard viewer with three capabilities.](roles-create.mp4)

1. Open **Settings**, then **Roles**.
2. Open the dots menu at the top right and select **Create role**.
3. In **Name**, type `Dashboard viewer`. **Slug** fills itself. You can change it before saving, and it is fixed after.
4. In **Description**, type what the role is for, such as `Reads dashboards and runs reports. Changes nothing.`
5. Under **Capabilities**, turn on **View dashboards**, **View reports** and **Run reports**. The counter above the list shows how many are on.
6. Open the sheet's dots menu and select **Create**.

**Expected result:** a **Saved Dashboard viewer** message, and the role in the list with **0 members**.

To give the role to someone, see [Users and Roles, Example 1](/docs/users#example-1-give-someone-a-role).

To change a role later, open its row menu and select **Edit**. **Delete** removes a role with no members. Changing a shared role changes it for everyone who has it.

## How capabilities reach an existing install

New versions add capabilities. Roles live in the database, so a role made by an older version does not know a newer capability on its own. OpenLDR sorts this out at every start:

- **Administrator** always gets the full list after the next restart. It is locked and means "every capability", so there is nothing to preserve.
- **The other built-in roles** get a new capability only the first time it exists. After that, OpenLDR never grants it again. If you remove a capability from Lab Manager, it stays removed across restarts and upgrades.
- **Roles you made are never changed.** Grant a new capability to them yourself.

A capability granted this way is recorded in the audit log as `role.capability.backfill`.

To compare your install with the built-in definitions:

```bash
./openldr roles doctor
```

It lists, per built-in role, the capabilities held, those you removed on purpose, and those still pending, plus capability keys left by a retired feature.

## From the command line

```bash
./openldr roles list
./openldr roles show <slug>
./openldr roles create <name>
./openldr roles grant <slug> <capability>
./openldr roles revoke <slug> <capability>
./openldr roles delete <slug>
./openldr user assign-role <subject> <slug>
```

`roles create` also takes `--slug`, `--desc`, and `--caps` with capabilities separated by commas. For example, the role from Example 1:

```bash
./openldr roles create "Dashboard viewer" --slug dashboard_viewer \
  --desc "Reads dashboards and runs reports. Changes nothing." \
  --caps dashboards.view,reports.view,reports.run
```

## Troubleshooting

- **A role's capabilities cannot be changed.** It is Administrator, which is locked, or you lack **Manage roles**. You can still open it to read its capabilities.
- **A role cannot be deleted.** It is a locked built-in role, or people still have it. Give them another role first.
- **Someone still has old access after a role change.** Ask them to sign out and in again, or wait for their session to refresh.
- **A new account can do nothing.** It has no role yet. An account with no role has no capabilities.

## Related guides

- [Users and Roles](/docs/users)
- [Audit](/docs/audit)
- [Settings](/docs/settings)
