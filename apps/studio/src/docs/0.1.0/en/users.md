# Users and Roles

Administrators use **Users and Roles** to control account access, feature visibility, and role-based permissions.

## Outcome

You can search the user list, create a user, edit profile fields, assign roles, enable or disable access, use reset actions, and understand why a user can or cannot see a feature.

![Users list with search and account state](users-list.png)

## Before you begin

- You need the Lab Admin role.
- Know which role provides the capabilities the user needs for their work.
- Confirm whether identity details are managed locally or by an external identity provider.

## Steps

1. Open **Users**.
2. Search by username, display name, or email.
3. Select the create action to add a new user when needed.
4. Enter profile fields such as username, display name, and email.
5. On the row for the account you want to change, open its **Actions** menu (the **⋯** button, labelled *Actions for &lt;username&gt;*) and choose **Edit**.
6. Wait for **Role** to load, then select one role. Studio offers a single-choice selector, not role checkboxes. Choosing another role replaces the selection. See [Roles](/docs/roles) for role definitions and assignment permissions.
7. Enable or disable the account state.
8. Use reset actions only when the UI shows they are available for the account type.
9. Save and check for the success notification. Reopen the account to verify its Role selection. If the editor reports a role-assignment error, resolve it before treating the update as complete.

![User editor with profile and role selection](user-edit-roles.png)

## Expected result

The user record reflects the updated profile, selected role, and status. The selected role defines the capabilities assigned through Studio's user editor.

## Troubleshooting

- **Permission denied:** check whether the user has the role required by the page or action.
- **A page is hidden:** feature visibility follows assigned roles and enabled application areas.
- **Reset actions are missing:** the account may be controlled by an identity provider.
- **A disabled user can still see an old screen:** ask them to sign out and sign back in after the status change.

## Advanced web usage

Choose the role with the fewest capabilities that still lets the user complete their work. Local profile fields can usually be edited in the app. Identity-provider-controlled actions may be unavailable depending on the account source.

## Related guides

- [Roles](/docs/roles)
- [Audit](/docs/audit)
- [Settings](/docs/settings)

## Directory pages

Users starts with active accounts. Search matches provider usernames, names, and email addresses across the directory. Select All statuses to include disabled accounts. Changing search, status, or page size returns to the first page.

Use Next to reach accounts beyond the first 100. Each request returns at most 100 accounts. The footer shows the visible range without claiming a total. Columns remain configurable. Arbitrary column filters and sorting are unavailable because the provider does not support them. The provider controls order. Accounts added or removed between requests can shift pages.

For headless access, run:

```sh
openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

The JSON contains `rows`, `offset`, `limit`, `total: null`, and `hasMore`. Add `limit` to `offset` while `hasMore` is true. Omit `--enabled` to include both statuses. `openldr user list` still lists local accounts.

When provider administration is unconfigured, directory listing uses local accounts. Local search matches username, display name, and email as substrings. Local results use username and ID order. Provider search follows the identity provider's search rules.
