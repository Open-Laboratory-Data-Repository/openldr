# Setup checks

## Outcome

You can see what this install still needs before it is ready, and open the page that fixes each item.

## Before you begin

- You need the `settings.view` capability (lab administrators have it).

## Open the checks

Open **Settings > Setup checks**. CE runs the checks when the page opens. To run them again, open the **⋯** menu and choose **Run again**.

Each check shows one status:

| Status | Meaning |
| --- | --- |
| Passed | Nothing to do. |
| Warning | CE works, but something is not set the way a real lab needs. |
| Failed | Something is broken or unsafe. Fix it before real use. |
| Skipped | The check does not apply to this install. |

A warning or a failure shows what to change. Where a settings page fixes it, a link opens that page.

## The checks

| Check | What it looks at | If it is not met |
| --- | --- | --- |
| Services | Sign-in, file storage, eventing and the warehouse answer. | CE cannot serve or store data. Run `openldr health` on the server to see which service is down. |
| Sign-in | Sign-in is switched on. | With `AUTH_DEV_BYPASS` on, anyone who reaches the server is an administrator. This fails on a production install and warns elsewhere. |
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

A check shows a name or a count, never an error message. Error messages can hold server names and user names. For the detail of a failed connector, open **Settings > Connectors** and choose **Diagnose** on it.

Each run is written to the audit log with the check names that failed or warned.

## From the command line

A headless server prints the same list:

```bash
openldr doctor
```

Add `--json` for machine-readable output. The command exits with code 1 when a check failed. Warnings do not change the exit code.
