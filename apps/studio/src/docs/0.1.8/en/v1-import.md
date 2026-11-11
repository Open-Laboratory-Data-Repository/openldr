# Import from OpenLDR v1

The **OpenLDR v1 import** plugin copies requests, patients, results and AST results from an OpenLDR v1 SQL Server database into CE. The import runs on the CE server, page by page. You can stop it and carry on later, and running it again replaces records instead of duplicating them.

The plugin never opens a database connection itself. It supplies read-only queries. CE runs them on a connector you allow, and saves what the plugin maps.

This guide takes about 10 minutes to read. An import of a large v1 database takes much longer. This guide has no pictures yet: the plugin's marketplace bundle is not published, and a v1 database is needed to show it working.

## Who can do what

| Permission | What it allows |
| --- | --- |
| **Manage connectors** | Allow or revoke the plugin's access to a connector |
| Lab Admin role | Open the plugin's page, run checks, dry runs and imports |

## Before you start

- The **OpenLDR v1 import** plugin is installed. Install it from **Settings**, **Marketplace**, or with `openldr plugin install` for a plugin file. See [Marketplace](/docs/marketplace).
- A Microsoft SQL connector points at the v1 database. See [Connect to SQL Server and diagnose a connection](/docs/connector-diagnose). Run **Diagnose** on it first: every step should pass.
- Know the UTC offset of the lab that wrote the v1 data, for example `+02:00`.

## Example 1: allow the plugin to read the v1 connector

1. Open **Settings**, then **Connectors**.
2. On the v1 SQL Server connector, open **⋯** and choose **Plugin access**.
3. Turn on the switch for `openldr-v1-import`.

**Expected result:** the switch stays on. Both allowing and revoking are written to the audit log, with who did it. Turn the switch off to stop the plugin reading that connector.

If the sheet says no installed plugin imports from this type of connector, the plugin is not installed, or the connector is not Microsoft SQL.

## Example 2: check, try, then import

Open **OpenLDR v1 import** in the sidebar. The page has five steps.

| Step | What you do |
| --- | --- |
| 1. Source | Pick the connector. **Check connection** tests it step by step. |
| 2. Options | Set the site time zone. The other options are optional. |
| 3. Checks | CE counts the v1 tables and rows. Nothing is imported. |
| 4. Dry run | CE reads and maps a few requests and saves nothing. |
| 5. Import | Start the import, watch it, stop it, or resume it. |

1. **Source.** Pick the v1 connector and select **Check connection**. Every step should pass.
2. **Options.** Set **Site time zone**, for example `+02:00`. Leave the rest empty to import everything.
3. **Checks.** **4 of 4** tables must be found: `Requests`, `LabResults`, `Patients` and `ASTResults`. If fewer are found, check the database name on the Options step.
4. **Dry run.** Enter `100` and choose **Start dry run**. The page shows how many requests would be saved and how many failed, each failure with a reason. You can go on once the dry run has finished.
5. **Import.** Choose **Start import**.

**Expected result:** the page shows requests read, saved and failed, the number of records, and the speed. The counts move one page at a time. A page is 500 requests, so the numbers can stand still for a while.

- You can leave the page. The import keeps running on the server. The page opens on the running import when you come back.
- **Stop** ends the import after the page it is working on.
- **Resume** carries on from the last request done. Use it after a stop, a failure, or a server restart.
- A request imported before is replaced, not duplicated. Running the import again is safe.

### Options

| Option | Meaning |
| --- | --- |
| Site time zone | Required. v1 dates have no time zone, so this decides the stored time. Use `+02:00` style, or `Z`. |
| Database | Leave empty to use the database set on the connector. |
| From date, To date | Limit the import by registered date. Leave both empty to import everything. |
| Panel codes | Comma-separated v1 panel codes. Leave empty for all panels. |

## Failed requests

A failed request does not stop the import. The page lists the first 100 with a reason. CE stores a reason code only, never the row's content.

| Code | Meaning |
| --- | --- |
| `NO_REQUEST_ROWS` | The request has no rows in the Requests table. |
| `NO_OBR_SET_ID` | A request row has no OBRSetID. |
| `NO_OBX_ID` | A result row has no OBXSetID or OBXSubID. |
| `BAD_REQUEST_ID` | The RequestID cannot be used as a record id. |
| `SAVE_FAILED` | CE could not save the request. |
| `INVALID_RESOURCE` | The plugin returned a record CE does not accept. |

## Audit and Activity

- Every import run shows on the **Activity** page as one entry. It has the plugin, who started it, and how many requests were imported and failed. Its status is Running, Stopped, Complete or Failed. A dry run saves nothing and is not listed.
- The **Audit** page records each allow, revoke, start, stop, resume and finish, with who did it.
- CE writes the audit entry first. If it cannot be written, CE refuses to allow a connector, or to start or resume an import.
- Every imported record keeps the run's id, the plugin and its version, and the source system.

An import does not start a workflow run for each request. Workflows that react to the `data.persisted` event do not run for imported records.

## From the command line

A headless server runs the same import:

```bash
openldr import allow openldr-v1-import <connector-id>
```

```bash
openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00 --dry-run --limit 100
```

```bash
openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00
```

`Ctrl+C` stops the import at the next page. Other commands: `openldr import status`, `stop`, `resume`, `failures`, `allowed` and `revoke`. Add `--json` for machine-readable output.

## On a phone

The plugin's page was built to fit a phone. Starting a long import is easier from a computer.

## Troubleshooting

- **The plugin is not in the sidebar.** Install it from the Marketplace.
- **Plugin access lists nothing.** The connector is not Microsoft SQL, or the plugin is not installed.
- **Check connection fails.** Run **Diagnose** on the connector and fix the step it names.
- **Checks find fewer than 4 of 4 tables.** The database name is wrong. Set it on the Options step, or on the connector.
- **The counts stand still.** A page is 500 requests. Wait for the next page before deciding it has stalled.
- **The import refuses to start.** CE could not write its audit entry, and it refuses to allow, start or resume without one. Check the server log.
- **Workflows did not run for imported records.** Expected. An import does not emit `data.persisted`.

## Related guides

- [Connect to SQL Server and diagnose a connection](/docs/connector-diagnose)
- [Connectors](/docs/connectors)
- [Marketplace](/docs/marketplace)
- [Activity](/docs/activity)
- [Audit](/docs/audit)
