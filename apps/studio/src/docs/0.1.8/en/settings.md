# Settings

**Settings** holds the install-wide choices an administrator makes once and then rarely touches: the version and update check, feature flags, limits, the laboratory letterhead, sync, connectors, the marketplace, roles and which extra columns the dashboard Builder may offer.

This guide covers the **General** page and points you to the guide for every other page. It takes about 5 minutes.


## Who can do what

Each page in Settings has its own permission. A page you lack the permission for is not listed in the side menu.

| Permission | What it unlocks on General |
| --- | --- |
| **View settings** | Opens Settings, General and Laboratory. Shows the **About** card |
| **Edit general settings** | The **Auto update check** switch, **Limits & tuning**, **Data validation**, and saving the Laboratory page |
| **Manage feature flags** | The **Feature Flags** card |
| **Danger zone** | The three reset actions. Give it to as few people as you can |

A card you lack the permission for is not shown at all.

## The pages in Settings

| Page | What it is for | Guide |
| --- | --- | --- |
| General | Version, update check, feature flags, limits, danger zone | This page |
| Laboratory | Letterhead on every report, default facility register, time zone | [Laboratory](/docs/laboratory) |
| Notifications | Which notifications you receive | Not documented yet |
| Sites | The sites this install reports for | Not documented yet |
| Distributed sync | Link a lab to a central server. Its **Settings** tab sets the connection and direction. Its **Activity** tab shows live status and recent events | [Distributed Sync](/docs/sync) |
| Connectors | External databases and plugin-backed integrations | [Connectors](/docs/connectors) |
| Marketplace | Browse installable artifacts, manage registries, review installed packages | [Marketplace](/docs/marketplace) |
| Roles | Capability-based roles and the built-in system roles | [Roles](/docs/roles) |
| Data Exposure | Which extra table columns the dashboard Builder may offer | [Data exposure](/docs/data-exposure) |

Settings read when the server starts, such as the public address, TLS, the database, storage and secrets, are not here. See [Environment Variables](/docs/environment).

This manual covers the pages above. A settings page not covered here is outside the current in-app documentation.

## Version and update check

1. Open **Settings**. It opens on **General**.
2. Read the **About** card. **Version** is what this install runs. The line under it, **Latest**, says where that version stands.
3. Read **Last checked** under the **Auto update check** switch to see how old that answer is.

**Expected result on a fresh install:** your version number followed by *up to date*, or *not checked yet* if the install started less than a day ago with no network.

The **Latest** line reads one of six ways:

| It reads | Meaning |
| --- | --- |
| a version and *up to date* | You run the newest release |
| a newer version, its release date and **Release notes** | An update exists. A link to the [planned upgrade procedure](/docs/upgrading) follows |
| *no update found* | The last check saw an older release than yours. See below |
| *update check is off* | **Auto update check** is switched off |
| *cannot confirm* | The last check failed, or the running version could not be read |
| *not checked yet* | No check has run since the install started |

*No update found* means the last successful check saw an **older** release than the one you are running, so it has nothing to tell you. **No version number is shown in this case, on purpose.** A number lower than yours is not something to act on, and reading it as an instruction to downgrade would be wrong.

This happens when you upgrade shortly after a release, because the check runs once a day and the answer it cached predates your own version. It corrects itself at the next check, or at once if you restart the api container.

### What the update check does

The check is **on by default**. Once a day it fetches a small file from GitHub, with a 10-second timeout on that one request, and compares version numbers. It never downloads an image and never restarts anything. Upgrading is always something you do yourself.

**What it sends:** an ordinary web request for a public file. No site name, no version, no identifier. As with any web request, the server that answers can see your network's IP address and the time you asked.

**To turn it off,** switch off **Auto update check**. The install then makes no outbound request at all, and the version line shows only what you are running. An air-gapped lab can leave it on. A failed check is silent, and the last known answer is kept. There is no command-line switch for this. It is a Studio-only setting.

**From the command line,** `openldr update check` prints the same information:

```bash
./openldr update check
```

It exits **1** when an update is available and **0** for every other outcome, including a failed or unconfirmed check. Exit 1 means "an update exists", not an error, so a script can act on it directly. Exit **2** comes only from the check failing to run at all, for example an unreachable database, so a broken check never looks like a new release.

## Switch on SQL widgets

Dashboard widgets written in SQL are off on a fresh install. Switch them on when someone needs one, as in [Dashboards, Example 5](/docs/dashboard#example-5-a-widget-written-in-sql).

1. On **General**, find **Feature Flags**.
2. Switch on **Dashboard raw SQL**. A **Saved** message appears. Changes take effect at once, with no restart.

**Expected result:** the widget editor in Dashboards now offers SQL. Switch it off again and SQL widgets stop running. Approved stored queries still run when it is off.

The same from the command line:

```bash
./openldr settings flags list
./openldr settings flags set dashboard.raw_sql true
```

## Feature flags

| Flag | Command-line key | Default | What it does |
| --- | --- | --- | --- |
| Dashboard raw SQL | `dashboard.raw_sql` | Off | Lets dashboard widgets run read-only SQL against the PostgreSQL, MySQL or SQL Server warehouse. The workflow **SQL Query** node also needs it |
| Workflow listener triggers | `workflow.listeners_enabled` | On | Runs listener triggers (Postgres LISTEN, IMAP email polling). Off stops every listener at the next check |
| Publish workflow datasets | `workflow.dataset_publish_enabled` | Off | Publishes workflow datasets as real tables in the Postgres warehouse, so the SQL node and dashboards can query them |

## Limits & tuning

These change at once, with no restart. A value outside the allowed range is moved to the nearest end of it.

| Limit | Command-line key | Default | Allowed range |
| --- | --- | --- | --- |
| Dashboard SQL timeout (ms) | `dashboard.sql_timeout_ms` | 5000 | 100 to 600000 |
| Dashboard SQL row cap | `dashboard.sql_row_cap` | 10000 | 1 to 1000000 |
| Marketplace max payload (bytes) | `marketplace.max_payload_bytes` | 67108864 (64 MB) | 1024 to 536870912 |

The row cap works two ways. Raw SQL returns at most that many rows. A Builder query counts its groups in the database first and returns an error if there are more than the cap.

```bash
./openldr settings numbers list
./openldr settings numbers set dashboard.sql_timeout_ms 10000
```

## Danger Zone

The bottom of **General** holds actions that cannot be undone. They touch the internal database only. Data in the warehouse and accounts in Keycloak are never touched.

| Action | What it does | Command line |
| --- | --- | --- |
| Data validation | Sets how strict the check on incoming lab data is: Low, Medium or High. Lower stores incomplete data. Higher may refuse data that was accepted before | `./openldr settings validation set medium` |
| Reset dashboards | Deletes every dashboard and recreates the sample | `./openldr settings danger reset-dashboards --force` |
| Clear audit log | Deletes every audit event and the workflow run history | `./openldr settings danger clear-audit --force` |
| Factory reset | Wipes the internal database (forms, connectors, dashboards, workflows, terminology, users, audit) and reseeds the defaults | `./openldr settings danger factory-reset --force` |

In the studio, each reset asks you to type a phrase before it runs. On the command line, each refuses to run without `--force`.

## On a phone

On a narrow screen the list of Settings pages moves to a row across the top. Swipe it sideways to reach the pages at the end, such as **Data Exposure**.

## Troubleshooting

- **A page is missing from the side menu.** Your role lacks its permission. Ask an administrator to check your role in [Roles](/docs/roles).
- **A card is missing from General.** Your role lacks its permission. See the table under Who can do what.
- **The Latest line says *cannot confirm*.** The install could not reach GitHub, or the running version was unreadable. Nothing else is affected.
- **A limit saved as a different number.** It was outside the allowed range and was moved to the nearest end.
- **SQL widgets still refuse to run.** Check **Dashboard raw SQL** is on. Then check the widget's query is read-only.

## Related guides

- [Laboratory](/docs/laboratory)
- [Data exposure](/docs/data-exposure)
- [Roles](/docs/roles)
- [Distributed Sync](/docs/sync)
- [Connectors](/docs/connectors)
- [Marketplace](/docs/marketplace)
- [Environment Variables](/docs/environment)
- [Planned upgrades](/docs/upgrading)
