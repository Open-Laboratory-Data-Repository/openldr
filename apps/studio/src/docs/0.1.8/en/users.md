# Users and Roles

**Users** lists who can sign in, their status, and their role. Administrators use it to add people, give each one a role, and turn access on and off.

Sign-in itself is handled by the identity provider, usually Keycloak. OpenLDR decides what a signed-in person can do, through their role. Roles are covered in [Roles](/docs/roles).

This guide takes about 15 minutes. Select any picture to enlarge it.

![Users: the accounts from the identity provider, with search, status and columns.](users-tour.png)

## Who can do what

| Permission | What it lets you do |
| --- | --- |
| View users | Open **Users** and see accounts. |
| Manage users | Create, edit, enable and disable accounts. |
| Reset passwords | Reset a password or send a reset email. |
| Force logout | End all of a person's active sessions. |
| Manage roles | Needed as well to save a role on a user. |

Administrator has all of these.

## The list

1. Open **Users**. It starts with active accounts.
2. Type in **Search username, name or email**. Search covers the whole directory, not just the page you see.
3. **Status** switches between **Active**, disabled, and all accounts.
4. **Columns** chooses what the list shows.

The list is in the identity provider's order. Each page holds at most 100 accounts. The footer shows the range on screen without a total, such as **1–2 (total unknown)**, because the provider does not give one. Use **Next** for more. Column filters and sorting are not available, because the provider does not support them. Accounts added or removed while you page can shift the pages.

The dots menu at the top right has **New user** and **Refresh**.

## Example 1: give someone a role

![A user's row menu: Edit, Disable, Reset password, Send reset email, Force sign-out.](users-row-menu.png)

1. On the person's row, open the dots menu, **Actions for** their username.
2. Select **Edit**. The **Edit user** sheet opens.

![The Edit user sheet: role, first name, last name and email.](users-edit-sheet.png)

3. Wait for **Role** to load, then choose one role. Each person has one role. Choosing another replaces it.
4. Change **First name**, **Last name** or **Email** if needed.
5. Open the sheet's dots menu and save.
6. Check for the success message. Open the person again to see the saved role.

If the sheet shows a role-assignment error, it stays open. Fix the error before you treat the change as done.

Pick the role with the fewest capabilities that still lets the person do their work. If no role fits, make one first. See [Roles, Example 1](/docs/roles#example-1-make-a-read-only-role).

## Example 2: add a person

1. Open the dots menu at the top right and select **New user**.
2. Fill in the username, name and email.
3. Choose a role.
4. Save, and check for the success message.

A new account with no role can do nothing. Always give it a role.

## Disable or enable access

Open the person's row menu and select **Disable**, or **Enable** on a disabled account.

- Disabling writes a local block in OpenLDR first, then updates the identity provider.
- The person's next request returns `403 account disabled`, even with a token issued before. A screen already open in their browser can stay visible.
- Accounts that never signed in get the local block too.
- Enabling updates the provider first, then lifts the local block.
- If either step fails, the action reports an error. A failed disable can leave the provider enabled while OpenLDR still blocks access. A failed enable can leave the provider enabled while the local block stays. Fix the connection and repeat the same action.
- If another status change for that account is still running, the reply is `409`. Wait and retry. This also applies when Studio and the CLI change the same account at once.

The audit log records `user.status` for success and `user.status.failed` for failures.

## Passwords and sessions

- **Reset password** sets a new password for the person.
- **Send reset email** emails them a reset link.
- **Force sign-out** ends all their sessions at once.

These depend on the identity provider. They can be missing for accounts it does not let OpenLDR manage.

## On a phone

The user list works on a phone.

![Users on a phone.](users-phone.png)

## From the command line

```bash
./openldr users list
./openldr user deactivate <local-id>
./openldr user activate <local-id>
./openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

- `users list` lists local accounts and their local ids.
- `deactivate` and `activate` update both systems for a linked account, using its provider subject. An account made only in OpenLDR changes locally. The audit log names the actor `cli`.
- `directory-list` reads the provider directory. Its JSON has `rows`, `offset`, `limit`, `total: null` and `hasMore`. Add `limit` to `offset` while `hasMore` is true. Leave out `--enabled` for both statuses.

When provider administration is not set up, the list shows local accounts. Local search matches username, display name and email anywhere in the text, and results are in username and id order.

## Troubleshooting

- **Permission denied.** The person's role lacks the capability the page or action needs.
- **A page is missing from someone's menu.** Their role does not include it.
- **Reset actions are missing.** The account may be controlled by the identity provider.
- **A disabled person can still see an old screen.** Already-loaded content stays. Their next request is blocked.
- **Someone still has old access after a role change.** Ask them to sign out and in again, or wait for their session to refresh.
- **A new account can do nothing.** It has no role yet.

## Related guides

- [Roles](/docs/roles)
- [Audit](/docs/audit)
- [Settings](/docs/settings)
