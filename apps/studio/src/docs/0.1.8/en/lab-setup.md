# Lab setup

Lab setup covers what OpenLDR keeps for the lab itself. You set critical limits on a test's reference bands. An administrator can also rebuild the index of requisition numbers. Lab managers and administrators use this guide.

The **Lab order** form orders tests and enters their results. It can also record an **Order rejection**. Read [Forms](/docs/forms).

A lab plugin is planned for reception and result review. It is not part of this release.

Critical limits are part of a test's reference bands, so they need **Manage terminology**, like the rest of the test definition. Opening **Test catalog** needs **Browse terminology**. Rebuilding the index needs **Danger zone**.

## Add critical limits to a reference band

A critical limit is a value so far out of range that someone must act at once. Use the limits your lab has approved. Do not copy numbers from an example.

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

OpenLDR stores the limits. Nothing in this release flags a result against them yet.

## Rebuild the requisition index

OpenLDR keeps an index that finds an order by its requisition number. It keeps the index current by itself as orders arrive. Rebuild it only if an error kept an order out of the index, or after orders were deleted from the store.

Run the command through the running OpenLDR server, as a person who holds **Danger zone**. On Linux and macOS, sign in first with `./openldr login`, or set an access key in `OPENLDR_KEY`. On Windows, set an access key in `OPENLDR_KEY` first. There the CLI signs in with an access key only. Read [Users](/docs/users) to make an access key. Read [Start here](/docs/start-here) for the installed and development CLI.

Development checkout example:

```shell
pnpm openldr lab requisitions rebuild --force
```

For an installed Linux or macOS copy, use `./openldr` instead of `pnpm openldr`. On Windows, use `.\openldr.ps1` from your installation folder, with `OPENLDR_KEY` set. This command was not run on Windows.

**Expected result:** the command prints, for example, `Indexed 120 orders by requisition number.`

It refuses without `--force`, because it rewrites the whole index. Each rebuild is recorded in the audit log under your account.

## Limits

- Reception and result review are not in this release. A lab plugin is planned for them.
- Critical limits are stored, but no screen flags a result against them yet.
- Rebuilding the index is a command only. It has no button in the studio.

## Troubleshooting

- **Save refuses a critical limit.** Read the message. It names the band and the rule it broke.
- **The rebuild says the account lacks the capability.** The account does not hold **Danger zone**. Use an account whose role has it.

## Related guides

- [Test catalog](/docs/test-catalog)
- [Forms](/docs/forms)
- [Roles](/docs/roles)
- [Users](/docs/users)
