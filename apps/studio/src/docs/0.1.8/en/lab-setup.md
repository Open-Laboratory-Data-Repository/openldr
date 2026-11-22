# Lab setup

Lab setup prepares this laboratory for the lab module. You add the lab's sections, choose which tests need review, decide whether a person may authorise their own results, and set critical limits on reference bands. Lab managers and administrators do this once, before the lab starts work.

**Reception, worklists and result review are not in this release.** They come in later releases. This release stores the settings they will use. Saving them changes nothing in how this lab works today.

You need **Lab settings** to change the sections, the review switch and self-authorisation. Critical limits are part of a test's reference bands, so they need **Manage terminology**, like the rest of the test definition. Opening **Test catalog** needs **Browse terminology**.

Do the tasks in the order below. A test can only be filed under a section that exists.

## Add the lab's sections

A section is a part of the lab, such as haematology or microbiology. Worklists will filter by section. A lab with no sections can skip this task.

1. Open your user menu at the bottom left and select **Settings**.
2. Select **Laboratory**.
3. Open the dots menu at the top right and select **Add section**.
4. Type the code in **Code**, for example `haem`. Use lowercase letters, digits and dashes, starting with a letter.
5. Type the name in **Name**, for example `Haematology`.
6. Open the sheet's dots menu and select **Save**.

**Expected result:** a message says **Section haem added.** The section is listed in the **Sections** table. It appears in the test catalog straight away.

The code cannot change after you save it. To rename a code, remove the section and add it again.

## Remove a section

1. Open **Settings**, then **Laboratory**.
2. Find the section in the **Sections** table.
3. Open the dots menu on its row and select **Remove**.
4. Read the prompt and select **Remove**.

**Expected result:** a message says the section was removed, and it leaves the table. This cannot be undone.

OpenLDR refuses to remove a section that a test still uses. Move those tests to another section, or to **No section**, first.

## Choose which tests need review and their section

Each test has its own section and review setting at this lab. A new test needs review until you turn it off.

1. Open **Test catalog** and select the **Tests** tab.
2. Open the dots menu on the test's row and select **Edit**.
3. Under **This lab**, choose the section in **Section**, or choose **No section**.
4. Turn **Needs review** on or off.
5. Open the sheet's dots menu and select **Save**.

**Expected result:** a message says the test was saved. The section and the switch keep your choice when you open the test again.

Result review comes in a later release. With it, when **Needs review** is on, a second step will authorise each result before it is released. When it is off, a result with no critical value will be released without that step. A critical value will always go to review.

**Section** is hidden while the lab has no sections. Without **Lab settings** you can read both fields, but you cannot change them.

## Decide on self-authorisation

By default, the person who entered a result cannot authorise it. Turn this on only when your lab allows one person to do both, for example a lab with one technician on a night shift.

1. Open **Settings**, then **Laboratory**.
2. Find **Allow a person to authorise results they entered**.
3. Turn the switch on or off.

**Expected result:** a message says **Saved.** The switch saves as soon as you change it. There is no separate save step.

## Add critical limits to a reference band

A critical limit is a value so far out of range that someone must act at once. Result entry will flag a value beyond it. Use the limits your lab has approved. Do not copy numbers from an example.

1. Open **Test catalog** and open the test with **Edit**.
2. Find the result field and its reference band.
3. Type the lower limit in **Critical low**.
4. Type the upper limit in **Critical high**.
5. Open the sheet's dots menu and select **Save**.

**Expected result:** a message says the test was saved. The limits are kept with the band.

You can fill one limit, both or neither. OpenLDR checks three rules when you save:

- **Critical low** must be at or below **Low**.
- **Critical high** must be at or above **High**.
- **Critical low** must be below **Critical high**.

A rule is checked only when the band has both of its values. A refusal names the result field and the band, for example `HGB range 1: the critical low limit must be at or below the low limit.`

## Give people the lab roles

Three built-in roles cover the lab's work.

- **Reception** can receive samples, return a request to its site, reject a sample, view worklists and open the masked patient index.
- **Lab Technician** can fill and submit forms, enter results and view worklists.
- **Lab Manager** holds every lab capability, **Lab settings** included.

The **Roles** page lists the seven lab capabilities in the **Lab** group: **Receive samples**, **Return and reject**, **Enter results**, **Authorise results**, **Amend results**, **View worklists** and **Lab settings**.

You need **Manage roles** to give a person a role.

1. Open **Users**.
2. Find the account, open its row dots and select **Edit**. With identity administration unavailable, this menu reads **Edit role**.
3. Open **Role** and select **Reception**, **Lab Technician** or **Lab Manager**.
4. Open the sheet's dots menu and select **Save**.

**Expected result:** the sheet closes. Reopen the account to check its saved role.

On an install that ran an older version, **Reception** appears the first time the server starts on this version. **Lab Technician** and **Lab Manager** gain their new capabilities at the same start, once. If you later take a capability away from one of them, it stays away.

Most of these capabilities open screens that come in later releases. Today only **Lab settings** changes what a person can do.

## Set up the lab from the command line

Every task above, except critical limits and roles, is also an `openldr` command. Each command goes through the running OpenLDR server, as a person who holds **Lab settings**. On Linux and macOS, sign in first with `./openldr login`, or set an access key in `OPENLDR_KEY`. On Windows, set an access key in `OPENLDR_KEY` first. There the CLI signs in with an access key only. Read [Users](/docs/users) to make an access key. Read [Start here](/docs/start-here) for the installed and development CLI.

Development checkout example:

```shell
pnpm openldr lab sections add haem Haematology
pnpm openldr lab sections list
pnpm openldr lab tests set HGB --section haem --needs-review true
pnpm openldr lab tests set HGB --no-section
pnpm openldr lab settings set allow-self-authorise false
pnpm openldr lab sections remove haem --force
```

For an installed Linux or macOS copy, use `./openldr` instead of `pnpm openldr`. On Windows, use `.\openldr.ps1` from your installation folder, with `OPENLDR_KEY` set. These commands were not run on Windows.

`lab sections remove` refuses without `--force`, because a removal cannot be undone. Each command is recorded in the audit log under your account.

## Limits

- Reception, worklists and result review are not in this release. These settings take effect when they arrive.
- A section has one code and one name. The code cannot change.
- The section and review setting belong to this lab. A catalog shared from central does not set them.

## Troubleshooting

- **Add section is missing from the dots menu.** Your account does not have **Lab settings**.
- **Section is missing from the test sheet.** The lab has no sections yet. Add one on **Laboratory**.
- **A section is not removed.** A test still uses it. The message says how many. Move those tests first.
- **Save refuses a critical limit.** Read the message. It names the band and the rule it broke.

## Related guides

- [Laboratory](/docs/laboratory)
- [Test catalog](/docs/test-catalog)
- [Roles](/docs/roles)
- [Users](/docs/users)
