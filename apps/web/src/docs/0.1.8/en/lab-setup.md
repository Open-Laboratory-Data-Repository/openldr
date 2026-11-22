# Set up a lab

The lab module will let a laboratory receive samples, work through worklists and review results inside OpenLDR. This release prepares for it. You set the lab's sections, which tests need review, whether a person may authorise their own results, and critical limits on reference bands. You also give people the new lab roles.

**Reception, worklists and result review are not in this release.** They come in later releases. The settings below are stored now. Saving them changes nothing in how the lab works today.

The in-app guide **Lab setup** shows each step on screen. This page gives the order and the commands, for an install run from the command line.

## What you need

- A running OpenLDR server of this version or later.
- An account with **Lab settings** for the sections, review and self-authorisation.
- **Manage terminology** for critical limits, because they are part of a test's reference bands.
- **Manage roles** to give people the lab roles.

## The order of the steps

1. Add the lab's sections, such as haematology. A test can only be filed under a section that exists. A lab with no sections can skip this step.
2. File each test under its section, and say whether it needs review. A test needs review until you turn that off.
3. Decide on self-authorisation. It is off by default, so the person who entered a result cannot authorise it.
4. Add critical limits to the reference bands of the tests that have them. Use the limits your lab has approved.
5. Give people the **Reception**, **Lab Technician** and **Lab Manager** roles.

Steps 1 to 3 are on the Laboratory settings page and in the test catalog. Step 4 is in the test catalog. Step 5 is in Users. Steps 1 to 3 are also `openldr` commands.

## The commands

Sign in first with `openldr login`, as a person who holds **Lab settings**. [CLI sign-in and access keys](/docs/cli-access) explains signing in. Each command is recorded in the audit log under your account.

```sh
openldr lab sections add haem Haematology
openldr lab sections list
openldr lab tests set HGB --section haem --needs-review true
openldr lab tests set HGB --no-section
openldr lab settings set allow-self-authorise false
openldr lab sections remove haem --force
```

- `lab sections add <code> <name>` adds a section. The code is lowercase letters, digits and dashes, starting with a letter. It cannot change later.
- `lab sections list` prints each section's code and name.
- `lab tests set <code>` sets a test's section with `--section <code>`, clears it with `--no-section`, and sets review with `--needs-review true` or `false`. A field you leave out keeps what is stored.
- `lab settings set allow-self-authorise true|false` turns self-authorisation on or off.
- `lab sections remove <code> --force` removes a section. It refuses without `--force`, because a removal cannot be undone. It also refuses while a test still uses the section, with `section <code> is used by <n> tests`.

In a source checkout, put `pnpm` in front, for example `pnpm openldr lab sections list`.

## The roles

- **Reception** can receive samples, return a request to its site, reject a sample, view worklists and open the masked patient index.
- **Lab Technician** can fill and submit forms, enter results and view worklists.
- **Lab Manager** has all seven lab capabilities.

On an install that ran an older version, Reception appears the first time the server starts on this version. Lab Technician and Lab Manager gain their new capabilities at that start, once. A capability you remove later stays removed.

## Troubleshooting

- **`lab sections remove` says the section is used by some tests.** Move those tests with `lab tests set <code> --section <other>` or `--no-section`, then remove it again.
- **`lab tests set` says `no section <code>`.** Add the section first with `lab sections add`.
- **A command says the account lacks the capability.** The account does not hold **Lab settings**. Give it the Lab Manager role, or a role with that capability.
