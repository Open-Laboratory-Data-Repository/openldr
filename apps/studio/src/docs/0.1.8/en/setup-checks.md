# Setup checks

**Setup checks** shows what this install still needs before it is ready for real use, and opens the page that fixes each item. It is the first place to look after installing, and after any change to the server.

This guide takes about 5 minutes. Select any picture or clip to enlarge it.

![Setup checks on a fresh test install: three warnings, for sign-in, the laboratory name and the time zone.](setup-checks-tour.png)

## Who can do what

You need **View settings**. Lab administrators have it. Fixing an item needs the permission of the page that fixes it, for example **Edit general settings** for the Laboratory page.

## Open the checks

Open **Settings**, then **Setup checks**, second in the list. CE runs the checks when the page opens. To run them again, open the **⋯** menu and choose **Run again**.

Each check shows one status:

| Status | Meaning |
| --- | --- |
| Passed | Nothing to do. |
| Warning | CE works, but something is not set the way a real lab needs. |
| Failed | Something is broken or unsafe. Fix it before real use. |
| Skipped | The check does not apply to this install. |

A warning or a failure says what to change. Where a settings page fixes it, a link such as **Open Laboratory** opens that page. The top of the page counts the warnings and failures, or says **All checks passed.**

## Example 1: read the checks on a fresh install

1. Open **Settings**, then **Setup checks**.

**Expected result** on a fresh test install with `AUTH_DEV_BYPASS` on: **3 warnings**.

| Check | Status | Why |
| --- | --- | --- |
| Services | Passed | |
| Sign-in | Warning | Sign-in is switched off (`AUTH_DEV_BYPASS`). Anyone who can reach this server is treated as an administrator. |
| Secrets key | Passed | |
| Laboratory name | Warning | The name is empty or still the shipped default. |
| Time zone | Warning | No time zone is set. |
| Connectors | Passed, 1 of 1 | The seeded warehouse connector answers. |
| Sync with central | Skipped | Sync is off. |

On a production install, the Sign-in item is **Failed**, not a warning.

## Example 2: fix two warnings

![Opening Laboratory from the check, setting the name and time zone, saving, and running the checks again.](setup-checks-fix.mp4)

1. Under **Laboratory name**, select **Open Laboratory**.
2. In **Laboratory name**, type your lab's name, for example `Sample Central Laboratory`.
3. In **Time zone**, type your zone, for example `Africa/Dar_es_Salaam`.
4. Open the page's **Actions** menu and select **Save**.
5. Go back to **Setup checks**, open **⋯** and select **Run again**.

**Expected result:** **1 warning**. Laboratory name and Time zone now read **Passed** and show what is set. Only Sign-in is left, which stays a warning on a test install.

![The checks after the fix: one warning left.](setup-checks-after.png)

See [Laboratory](/docs/laboratory) for the name, logo and time zone.

## The checks

| Check | What it looks at | If it is not met |
| --- | --- | --- |
| Services | Sign-in, file storage, eventing and the warehouse answer. | CE cannot serve or store data. Run `openldr health` on the server to see which service is down. |
| Sign-in | Sign-in is switched on. Under OpenLDR's own sign-in, an administrator exists. | With `AUTH_DEV_BYPASS` on, anyone who reaches the server is an administrator. This fails on a production install and warns elsewhere. Under OpenLDR's own sign-in, the check also warns while no administrator exists yet. |
| Secrets key | `SECRETS_ENCRYPTION_KEY` is set. | A connector that holds a password cannot be saved or read. |
| Laboratory name | The name is set, and is not the shipped default. | Reports print the product name as the issuing laboratory. |
| Time zone | A time zone is set. | The monthly transmission report counts days in UTC, so evening arrivals land on the wrong day. |
| Connectors | Every enabled host connector answers. | Imports and queries on that connector fail. The check names the connector. |
| Sync with central | Sync has a central URL and a site id, and its last cycle worked. | Results do not reach central. |

Three checks can show Skipped:

- **Time zone** on a SQL Server warehouse. The setting takes IANA zone names, which SQL Server cannot use. Leave it empty and type the Windows zone name into each report run.
- **Connectors** when no host connector is enabled.
- **Sync with central** when sync is off.

## What the checks do not show

A check shows a name or a count, never an error message. Error messages can hold server names and user names. For the detail of a failed connector, open **Settings**, **Connectors** and choose **Diagnose** on it. See [SQL Server connections and diagnosis](/docs/connector-diagnose).

Each run is written to the audit log with the names of the checks that failed or warned.

## From the command line

A headless server prints the same list:

```bash
openldr doctor
```

On the fresh test install of Example 1 it prints:

```text
PASS  Services
WARN  Sign-in
      Sign-in is switched off (AUTH_DEV_BYPASS). Anyone who can reach this server is treated as an administrator. Turn it off before real use.
PASS  Secrets key
WARN  Laboratory name
      The laboratory name is empty or still the shipped default. Reports print it as the issuing laboratory. Set it in Settings, Laboratory.
WARN  Time zone
      No time zone is set. The monthly transmission report then counts days in UTC, which moves evening arrivals to the wrong day. Set it in Settings, Laboratory.
PASS  Connectors: 1 of 1
SKIP  Sync with central

3 warnings.
```

Add `--json` for machine-readable output. The command exits with code 1 when a check failed. Warnings do not change the exit code, so this example exits with 0.

## On a phone

The page works on a phone. Each check's message wraps under its name, and the status sits beside the name.

## Troubleshooting

- **Services failed.** Run `openldr health` on the server to see which service is down.
- **Connectors failed.** The check names the connector. Run **Diagnose** on it.
- **Sync with central failed.** The last cycle failed. **Settings**, **Distributed sync**, **Activity** shows why. See [Distributed Sync](/docs/sync).
- **Sign-in warns that no administrator exists yet.** The install uses OpenLDR's own sign-in, and nobody has finished setup. `openldr doctor` prints `No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.` Studio shows its **Create the administrator** page until then, not this page. See [Sign-in and passwords](/docs/sign-in).
- **A check says it could not run.** The server log has the reason.

## Related guides

- [Settings](/docs/settings)
- [Laboratory](/docs/laboratory)
- [Connectors](/docs/connectors)
- [SQL Server connections and diagnosis](/docs/connector-diagnose)
