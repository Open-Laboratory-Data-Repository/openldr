# Set up a lab

This page says what OpenLDR offers a laboratory in this release, and what to check after an upgrade. The in-app guide **Lab setup** shows the steps on screen.

A lab plugin is planned for reception and result review. It is not part of this release.

## What a lab has in this release

- The **Lab order** form orders tests and enters their results. It can also record an **Order rejection**. The in-app guide **Forms** shows each step.
- A test's reference bands can hold critical limits, in **Critical low** and **Critical high**. OpenLDR stores them. Nothing in this release flags a result against them yet. Setting them needs **Manage terminology**.
- An index finds an order by its requisition number. OpenLDR keeps it current by itself. The `openldr lab requisitions rebuild` command repairs it.

## Rebuild the requisition index

The command goes through the running OpenLDR server, as a person who holds **Danger zone**. On Linux and macOS, sign in first with `./openldr login`, or set an access key in `OPENLDR_KEY`. On Windows, `.\openldr.ps1` signs in with an access key only, so set `OPENLDR_KEY` first. The command was not run on Windows. [CLI sign-in and access keys](/docs/cli-access) explains signing in.

```sh
openldr lab requisitions rebuild --force
```

Rebuild it only if an error kept an order out of the index, or after orders were deleted from the store. It prints `Indexed <n> orders by requisition number.` It refuses without `--force`, because it rewrites the whole index. Each rebuild is recorded in the audit log under your account. In a source checkout, put `pnpm` in front: `pnpm openldr lab requisitions rebuild --force`.

## After an upgrade from an earlier lab release

An earlier release had a Reception page, lab sections, a self-authorisation switch and seven lab permissions. This release does not.

- A **Reception** role made by that release stays. It is now an ordinary role. An administrator can delete it on the **Roles** page once nobody needs it.
- A role keeps any old lab permission it holds. CE does not list it and cannot grant or revoke it. `openldr roles doctor` lists such permissions under `kept` and exits 0.
- A **Lab order** form nobody edited gets its **Results** and **Order rejection** fields back at the first start. A form your lab edited stays as it is.

## Troubleshooting

- **The rebuild says the account lacks the capability.** The account does not hold **Danger zone**. Use an account whose role has it.
- **The Lab order form has no Results field.** Your lab edited the form, so the upgrade left it alone. Add the field again in the form builder.
