# Import from OpenLDR v1

## Outcome

You can copy requests, patients, results and AST results from an OpenLDR v1 SQL Server database into CE. The import runs on the CE server. You can stop it and carry on later.

## Before you begin

- You need the `lab_admin` role, and the `connectors.manage` capability to allow the connector.
- The **OpenLDR v1 import** plugin is installed. Install it from **Settings > Marketplace**, or with `openldr plugin install` for a plugin file.
- A Microsoft SQL connector points at the v1 database. See [Connect to SQL Server and diagnose a connection](/docs/connector-diagnose).
- Know the UTC offset of the lab that wrote the v1 data, for example `+02:00`.

The plugin never opens a database connection itself. It supplies read-only queries. CE runs them on a connector you allow, and saves what the plugin maps.

## Allow the connector

1. Open **Settings > Connectors**.
2. Open the **⋯** menu of the v1 SQL Server connector and choose **Plugin access**.
3. Turn on the switch for `openldr-v1-import`.

Turn the switch off to stop the plugin reading that connector. Both changes are written to the audit log.

## Run the import

Open **OpenLDR v1 import** in the sidebar. The page has five steps.

| Step | What you do |
| --- | --- |
| 1. Source | Pick the connector. **Check connection** tests it step by step. |
| 2. Options | Set the site time zone. The other options are optional. |
| 3. Checks | CE counts the v1 tables and rows. Nothing is imported. |
| 4. Dry run | CE reads and maps a few requests and saves nothing. |
| 5. Import | Start the import, watch it, stop it, or resume it. |

### Options

| Option | Meaning |
| --- | --- |
| Site time zone | Required. v1 dates have no time zone, so this decides the stored time. Use `+02:00` style, or `Z`. |
| Database | Leave empty to use the database set on the connector. |
| From date, To date | Limit the import by registered date. Leave both empty to import everything. |
| Panel codes | Comma-separated v1 panel codes. Leave empty for all panels. |

### Checks

The import needs four tables: `Requests`, `LabResults`, `Patients` and `ASTResults`. If the page shows fewer than 4 of 4, check the database name on the Options step.

### Dry run

Enter how many requests to try, from 1 to 5000, and choose **Start dry run**. The page shows how many requests would be saved and how many failed. Each failed request is listed with a reason. You can go on once the dry run has finished.

### Import

Choose **Start import**. The page shows requests read, saved and failed, the number of records, and the speed.

- The counts move one page at a time. A page is 500 requests, so the numbers can stand still for a while.
- You can leave the page. The import keeps running on the server. The page opens on the running import when you come back.
- **Stop** ends the import after the page it is working on.
- **Resume** carries on from the last request done. Use it after a stop, a failure, or a server restart.
- A request imported before is replaced, not duplicated. Running the import again is safe.

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
