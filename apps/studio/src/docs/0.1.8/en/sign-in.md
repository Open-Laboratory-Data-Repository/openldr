# Sign-in and passwords

Your OpenLDR account has a username and a password. This guide covers signing in, changing your password, and what to do after a lock or a forgotten password. The later tasks are for administrators, who add people and reset their passwords.

This guide applies when your lab uses OpenLDR's own sign-in. You can tell because the sign-in page is titled **Sign in to OpenLDR**, and your user menu has **Change password**. If your lab signs in through Keycloak or another provider, your password is kept there. Ask your administrator how to change it.

## Sign in

1. Open the address you use for Studio.
2. In **Username or email**, type your username or your email address.
3. In **Password**, type your password.
4. Select **Sign in**.

**Expected result:** Studio opens. If an administrator gave you a temporary password, the **Choose a new password** page opens instead.

Capital letters do not matter in the username or the email. Your email works only when no other account has the same one. The password must match exactly.

You stay signed in while you use Studio. A session ends after 12 hours with no use, or 7 days after you signed in, whichever comes first. Then you sign in again.

Closing the browser signs you out of that browser, unless the browser is set to restore its last session. The 12-hour and 7-day limits still apply.

## Choose a new password at first sign-in

An administrator who adds you or resets your password gives you a temporary password. Studio asks you to replace it the first time you use it.

1. Sign in with the temporary password.
2. In **Current password**, type the temporary password.
3. In **New password**, type the password you want.
4. In **Repeat password**, type it again.
5. Select **Change password**.

**Expected result:** Studio opens. Until you finish this page, Studio shows nothing else. To leave without changing it, select **Sign out**.

A password must be 10 to 128 characters long, and it cannot be your username. There is no rule about digits or symbols, and a password never expires. A long phrase you can remember works well.

The new password cannot be the temporary one. If you type the temporary password again, Studio shows **Choose a password different from the temporary one.**

## Change your password

1. Select your name at the bottom left of the main menu. On a phone, open the main menu at the top left first.
2. Select **Change password**. A sheet opens.
3. In **Current password**, type the password you use now.
4. In **New password**, type the new one.
5. In **Repeat password**, type it again.
6. Open the dots menu at the top right of the sheet and select **Save**.

**Expected result:** the message **Password changed.** appears and the sheet closes. You stay signed in here. Every other browser or device where you were signed in is signed out.

A wrong current password counts as a wrong try, the same as at sign-in.

## Sign out

1. Select your name at the bottom left of the main menu.
2. Select **Sign out**.

**Expected result:** the **Sign in to OpenLDR** page opens.

Sometimes Studio cannot reach the server as you sign out. The sign-in page then says **Sign-out did not reach the server. Your session may still be open in this browser.** When the connection is back, select **Try signing out again**. On a shared computer, wait until that message is gone before you leave.

## If your account is locked

Five wrong passwords in a row lock the account for five minutes. During the lock, even the right password is refused.

The sign-in page shows one message for a wrong password and for a locked account: **Those details are wrong, or the account is locked for a few minutes.** It does not say which, so a stranger cannot learn whether an account exists.

1. Wait five minutes.
2. Sign in again, and type the password with care.

**Expected result:** Studio opens.

A lock always ends by itself. Nobody can lock an account for good by guessing. A correct sign-in sets the count back to zero, and so does a password reset by an administrator.

**Too many attempts. Wait a minute and try again.** is a different limit. It allows 30 sign-in attempts a minute from one address, whatever the account. Wait a minute, then try again.

## If you forget your password

Ask an administrator to reset it. OpenLDR's own sign-in cannot email you a reset link.

The administrator gives you a temporary password. Sign in with it and choose a new one, as in [Choose a new password at first sign-in](#choose-a-new-password-at-first-sign-in).

## Create the first administrator

This task and the ones after it are for administrators.

A new install has no accounts. Until someone creates the first administrator, Studio shows the **Create the administrator** page to whoever opens it. The setup code proves that this person can also reach the server.

1. On the server, run `openldr auth setup-code`. It prints a code that works for 30 minutes.
2. Open Studio. The **Create the administrator** page opens.
3. In **Setup code**, type the code.
4. In **Username**, type the administrator's username. Use 3 to 64 letters, digits, dots, dashes or underscores.
5. In **Password** and **Repeat password**, type the password.
6. Select **Create the administrator**.

**Expected result:** Studio opens, signed in as the new administrator, with the **Administrator** role. The page does not appear again on this install.

Running the command again replaces the earlier code. Until the first administrator exists, `openldr doctor` warns on its Sign-in line. See [Setup checks](/docs/setup-checks).

## Add a person with a temporary password

You need the **Manage users** permission. Administrator has it.

1. Open **Users** in the main menu.
2. Open the dots menu at the top right and select **New user**.
3. In **Username**, type the person's username.
4. In **Password**, type a temporary password of 10 characters or more.
5. In **Confirm password**, type it again.
6. In **Role**, choose a role.
7. Open the sheet's dots menu and select **Create**.

**Expected result:** a message such as **Saved amina** appears, and the person is in the list. At first sign-in they must choose their own password.

Give the temporary password to the person directly, face to face or by phone. If you leave **Password** empty, the account cannot sign in until you reset its password.

## Reset someone's password

Do this when a person forgets their password, or when you think someone else knows it. You need the **Reset passwords** permission.

1. Open **Users** in the main menu.
2. On the person's row, open the dots menu and select **Reset password**.
3. Select **Generate**. A new 16-character password fills both fields.
4. Select the copy button beside the password, or read it from the field.
5. Leave **Require password change at next sign-in** ticked.
6. Select **Reset password**.

**Expected result:** a message such as **Password reset for amina** appears. The person is signed out everywhere at once. At the next sign-in they must choose a new password. The reset also ends a lock.

A password you type yourself instead of **Generate** follows the same rules: 10 to 128 characters, and not the username.

## End someone's sessions

Do this when a person loses a phone or a laptop, or leaves a shared computer signed in. You need the **Force logout** permission.

1. Open **Users** in the main menu.
2. On the person's row, open the dots menu and select **Force sign-out**.
3. Select **Force sign-out** again to confirm.

**Expected result:** a message such as **Signed out all sessions for amina** appears. Each of their browsers and devices loses access at its next request. Their password does not change.

You cannot do this on your own row. Use **Sign out** instead.

## From the command line

A lab server with no browser has the same actions as `openldr` commands. Run them on the server.

```bash
openldr auth setup-code
openldr user create --username amina --name "Amina Hassan" --role lab_technician
openldr users list
openldr user assign-role <user-id> data_analyst
openldr user reset-password <username> --force
openldr user end-sessions <username>
```

- `auth setup-code` prints a setup code for the first administrator, valid for 30 minutes. It refuses once an administrator exists.
- `user create` prints the new user's ID and a temporary password, once. Copy the password then, because nothing shows it again. The command refuses a role that does not exist. It also refuses until the first administrator exists.
- `users list` prints each user's ID at the start of the line.
- `user assign-role` adds a role. It takes the user ID, not the username. Given a username, it reports success and grants nothing.
- `user reset-password` prints a new temporary password once and ends the person's sessions. Without `--force` it changes nothing.
- `user end-sessions` signs the person out everywhere.

`reset-password` and `end-sessions` match the username exactly, including capital letters.

## Limits

- Over plain HTTP, a password crosses the network unencrypted. Anyone who can watch the network between your computer and the server can read it. HTTPS, or a private network such as Tailscale, closes that. Ask your administrator which one your lab uses.
- There is no second factor, such as a code from a phone app.
- There is no password reset by email. An administrator resets passwords.
- People cannot create their own accounts. An administrator adds them.
- Five tries, the five-minute lock and the session times are fixed. They are not settings.

## Troubleshooting

- **The page says the details are wrong, but I am sure of them.** The account may be locked. Wait five minutes. A disabled account gets the same message, so if it still fails, ask an administrator.
- **Studio sent me back to the sign-in page.** The session ended. That happens after 12 hours with no use, after 7 days, when an administrator ends it, or when you change your password on another device. Sign in again.
- **Could not reach the server. Try again.** Studio cannot reach the server. Check your connection, then try again.
- **The setup page says the code is wrong or has expired.** A code lasts 30 minutes, and each new code replaces the one before. Run `openldr auth setup-code` again and type the newest code.
- **The setup page says the username is already in use.** Choose another username.
- **The setup page says an administrator already exists.** Someone finished setup first. Select **Sign in**.
- **The last administrator forgot their password.** Someone with access to the server runs `openldr user reset-password <username> --force`. It prints a temporary password.

## Related guides

- [Your preferences](/docs/user-preferences)
- [Users and roles](/docs/users)
- [Setup checks](/docs/setup-checks)
