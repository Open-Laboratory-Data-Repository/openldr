# Users

Use Users to find accounts, update their profiles, assign a role and control access. Roles define the permissions an account receives. The Users sheet selects one role per person.

Use your own staff accounts and approved access decisions. The pictures use a fictional account in an isolated test installation. No sample data is required.

View users allows the directory. Manage users allows account creation, profile changes and enabling or disabling access. Manage roles allows role assignment. Reset passwords and Force logout allow their respective security actions.

Creating accounts, editing provider profiles, resetting passwords and ending provider sessions require a configured identity administrator. When it is unavailable, the page tells you to contact your identity provider administrator. OpenLDR role and account-access controls remain available. Under OpenLDR's own sign-in, these actions are always available. See [Sign-in and passwords](/docs/sign-in).

For installation and command-line setup, read [Start here](/docs/start-here). To define role permissions, read [Roles](/docs/roles).

## Create an operator account

Use this when a person needs their own sign-in. Check the required role before creating the account.

### 1. Open Users

Select **Users** in the main menu.

![Select Users in the main menu.](users-guide-open-users.png)

### 2. Choose New user

Open the page dots above the directory and select **New user**. If it is unavailable, contact your identity provider administrator.

![Open the Users page dots menu.](users-guide-page-actions.png)

![Choose New user.](users-guide-new-user.png)

### 3. Enter the username

Enter the person's sign-in username. The example uses `documentation.operator`.

![Enter the account username.](users-guide-username.png)

### 4. Choose an initial password

Enter an initial **Password**, or leave it blank and arrange activation through your identity provider. An initial password requires a change at the next sign-in. Share account credentials through your approved process. Under OpenLDR's own sign-in there is no provider. An account created without a password cannot sign in until you reset its password.

![Enter an initial password, or leave it blank and arrange activation through your provider.](users-guide-password.png)

### 5. Confirm the password

If you entered a password, enter it again in **Confirm password**.

![Enter the same initial password again.](users-guide-confirm-password.png)

### 6. Choose the role

Select the role that grants the actions this person needs. New accounts default to **Lab Technician**.

![Choose the role that matches this person. The example uses Lab Technician.](users-guide-choose-role.png)

### 7. Complete the profile

Fill the fields in your published Users form. The pictured form asks for first name, last name and email. Your form may contain different fields. A published form is optional for account creation.

![Complete the published Users form. This test form asks for name and email.](users-guide-profile.png)

### 8. Create the account

Open the sheet dots and select **Create**. If role assignment fails after saving the account, choose a valid role and retry in the same sheet.

![Open the New user sheet dots.](users-guide-sheet-actions.png)

![Choose Create to save the account and role.](users-guide-create-user.png)

**Expected result:** The sheet closes and the new account appears Active in the directory.

![The account appears Active with its name and email.](users-guide-created-result.png)

## Edit a profile or assign another role

Use this when staff details or responsibilities change. Changing the role changes the permissions the person receives.

### 1. Find the account

Search by username, name or email. Search applies to the whole directory.

![Search across the whole directory by username, name or email.](users-guide-search-user.png)

### 2. Open its actions

Select the dots for the correct account.

![Open the dots for the correct user.](users-guide-row-actions.png)

### 3. Choose Edit

Select **Edit**. Selecting the row opens the same sheet. With identity administration unavailable, this menu reads **Edit role**.

![Choose Edit to open the profile and role.](users-guide-edit-user.png)

### 4. Update the profile

Edit the fields provided by your Users form. Username cannot be changed here.

![Update the profile fields your Users form provides.](users-guide-edit-profile.png)

### 5. Choose the role

Open **Role** and select the required role. The example chooses **System Auditor**.

![Choose another role. The example changes to System Auditor.](users-guide-change-role.png)

### 6. Save the account

Open the sheet dots and select **Save**.

![Choose Save in the sheet dots menu.](users-guide-save-user.png)

**Expected result:** The sheet closes and the directory shows the saved profile. Reopen the account to inspect its saved role.

![The saved profile appears in the Users table.](users-guide-edited-result.png)

## Disable account access

Use this when someone should no longer sign in. You cannot disable your own account through its row menu.

### 1. Choose Disable

Find the account. Open its row dots and select **Disable**.

![Choose Disable for the correct user.](users-guide-disable-menu.png)

### 2. Confirm the account

Check the username in the confirmation. Select **Disable** to continue.

![Confirm the account name before selecting Disable.](users-guide-disable-confirm.png)

### 3. Open Status

Disabled accounts disappear from the default Active list. Open **Status**.

![Use Status to find a disabled account.](users-guide-status-filter.png)

### 4. Choose Disabled

Select **Disabled**.

![Choose Disabled.](users-guide-disabled-option.png)

**Expected result:** The account appears with Disabled status. Disabling access keeps the account and profile.

![The account appears with Disabled status.](users-guide-disabled-result.png)

## Restore account access

Use this when a disabled person should be able to sign in again.

### 1. Choose Enable

Find the account using Status set to Disabled or All statuses. Open its row dots and select **Enable**.

![Choose Enable to restore account access.](users-guide-enable-menu.png)

### 2. Confirm the account

Check the username, then select **Enable**.

![Check the account, then confirm Enable.](users-guide-enable-confirm.png)

### 3. Return to Active

Open **Status** and choose **Active**.

![Choose Active to find the enabled account.](users-guide-active-option.png)

**Expected result:** The account returns to the Active list.

![The account returns to the Active list.](users-guide-enabled-result.png)

## Reset a password

Use this when an account needs a replacement password. This requires identity administration and Reset passwords.

### 1. Open Reset password

Find the account. Open its row dots and select **Reset password**.

![Choose Reset password for the correct account.](users-guide-reset-menu.png)

### 2. Enter a new password

Enter **New password**. **Generate** creates a password and fills both fields. The eye reveals it and Copy copies it.

![Enter a new password. Generate can fill both password fields.](users-guide-reset-new-password.png)

### 3. Confirm the new password

Enter the same password in **Confirm password**. Generate has already filled this for you.

![Enter the same new password again.](users-guide-reset-confirm-password.png)

### 4. Choose whether it is temporary

Keep **Require password change at next sign-in** selected for a temporary password. Clear it only when the person should use this password directly.

![Keep Require password change on for a temporary password, or turn it off when appropriate.](users-guide-reset-change.png)

### 5. Reset the password

Select **Reset password**. Share the password securely using your approved process.

![Select Reset password after checking the password-change choice.](users-guide-reset-submit.png)

**Expected result:** The page confirms the password reset. With the default temporary option, the person must change it at their next sign-in.

![The page confirms that the password was reset.](users-guide-reset-result.png)

## End a user's provider sessions

Use this when existing provider sessions should end. This requires identity administration and Force logout. Under OpenLDR's own sign-in, it ends the person's OpenLDR sessions.

### 1. Choose Force sign-out

Find the account. Open its row dots and select **Force sign-out**. You cannot use this action on yourself here.

![Choose Force sign-out to end this user's provider sessions.](users-guide-logout-menu.png)

### 2. Confirm the account

Check the username and select **Force sign-out**.

![Confirm Force sign-out for the correct account.](users-guide-logout-confirm.png)

**Expected result:** The page confirms that all sessions were signed out. This action does not disable the account.

![The page confirms that all sessions were signed out.](users-guide-logout-result.png)

## Use Users on a phone

Use the same directory and account sheet on a phone. Wide columns can require horizontal scrolling.

### 1. Find the account

Search by username, name or email.

![Search for an account on a phone.](users-guide-phone-search.png)

### 2. Open the account

Select its row. Scroll the User sheet to read its profile and role. Select **Close** at the top right to return.

![The User sheet uses the phone width. Scroll to read profile fields.](users-guide-phone-profile.png)

## Send a reset email when mail is configured

The account row dots also offer **Send reset email**. It asks the identity provider to send the account a reset link. Check the email address and your provider's outgoing mail configuration first. The documented test did not send email. OpenLDR's own sign-in has no reset email, so Studio hides this item there.

## Optional practice

Use a test installation and a fictional operator. Follow the account tasks using your own test username and example.invalid email address. Do not test disable, password reset or force sign-out on another person's account without approval.

## Limits

Users has no delete-account action. Disable access when an account should stop signing in. The fields below Role depend on your published Users form. OpenLDR cannot configure outgoing provider email here.

## Troubleshooting

**New user or password actions are missing.** Read the notice above the directory. Ask your identity provider administrator to configure account administration.

**The account disappears after a status change.** Change Status to Active, Disabled or All statuses to find it again.

**The account saved but role assignment failed.** Keep the sheet open, choose a valid role, then save again. Do not remove the last person able to manage roles.

## Related guides

Read [Roles](/docs/roles) to define permissions. Read [Start here](/docs/start-here) for installation and command-line setup.
