# Import from OpenLDR v1

The OpenLDR v1 import plugin reads a v1 SQL Server database and saves mapped requests, patients, results and antimicrobial susceptibility results into CE. It runs on the server in pages of requests.

Use your own v1 database through a read-only Microsoft SQL connector. Diagnose it first. The plugin must be installed and an administrator must allow it to read that connector.

You need **Manage connectors** to grant source access. The plugin page is for the lab administrator role. Know the UTC offset used by the source lab.

The pictures use one fictional request, patient and text result on an isolated SQL Server. They establish an actual dry run and import of that small fixture. They do not establish compatibility with every historical v1 database. Optional practice data is at the end.

## Allow the plugin to read a connector

Install the plugin through Marketplace or its approved plugin file. Create a Microsoft SQL connector with SELECT access to the v1 tables. The account should not change source records.

### 1. Open Connectors

Open **Settings**, then **Connectors**. Use [Diagnose connections](/docs/connector-diagnose) to check the source connection first.

![Open Settings, then Connectors.](v1-import-guide-connectors.png)

### 2. Open Plugin access

On the v1 connector row, open the dots and choose **Plugin access**.

![Choose Plugin access for the v1 database connector.](v1-import-guide-access.png)

### 3. Allow the importer

Turn on the switch beside `openldr-v1-import`. Each switch saves immediately.

![Allow openldr-v1-import to read this connector.](v1-import-guide-allow.png)

### 4. Check the saved switch

The switch stays on. Turn it off later to revoke the plugin's access to that connector.

![The allowed switch stays on after saving.](v1-import-guide-allowed.png)

**Expected result:** The plugin can now offer this connector as a source. Grant and revoke actions appear in Audit.

## Choose and check the source

A successful connection check establishes network access and login. The later Checks step establishes the expected tables.

### 1. Open the importer

Select **OpenLDR v1 import** in the main menu.

![Open OpenLDR v1 import from the main menu.](v1-import-guide-plugin-nav.png)

### 2. Choose the source connector

On Source, select the connector that points to your v1 database.

![Select the allowed v1 connector.](v1-import-guide-source.png)

### 3. Check the connection

Select **Check connection**. Read each step and wait for **The connection works.** Correct any failure before proceeding.

![Check connection must pass before importing.](v1-import-guide-connection.png)

**Expected result:** The selected connection works from the CE server. No source data has been imported.

## Set the source time and import limits

v1 stores local date-times without a time zone. Choose the offset that describes those source timestamps.

### 1. Set Site time zone

Select Next to open Options. Enter the source lab's UTC offset, such as `+02:00`. Use `Z` only for a source stored in UTC. The fictional example uses Z.

![Set the actual source site UTC offset. This fictional source uses Z.](v1-import-guide-timezone.png)

### 2. Choose optional limits

Database overrides the connector database. From date and To date limit registered dates. Panel codes is a comma-separated list. Leave limits empty only when you intend to read everything.

![Leave optional limits empty only when you intend to import everything.](v1-import-guide-options.png)

### 3. Run the table checks

Select Next to open Checks. Read the table and row counts. **4 of 4** tables must be found: Requests, LabResults, Patients and ASTResults.

![Read table and row counts before moving on.](v1-import-guide-checks.png)

**Expected result:** Checks count source tables and rows without importing. If a table is missing, verify the database and source schema.

## Try a dry run

A dry run reads and maps a limited number of requests without saving their clinical records.

### 1. Set the request limit

Select Next to open Dry run. Enter a small request limit. The example uses `100` against a one-request fixture.

![Dry run limits how many requests are read without saving.](v1-import-guide-dry-limit.png)

### 2. Start the dry run

Choose **Start dry run**.

![Choose Start dry run.](v1-import-guide-dry-start.png)

### 3. Read the result

Wait for Finished. Check requests read, mapped or imported counts, and failures. Read the reasons before proceeding.

![Read the dry-run mapped and failed counts.](v1-import-guide-dry-result.png)

**Expected result:** The fictional fixture finishes with one successful request and no failures. A successful sample does not guarantee that every request in a large source will map.

## Import the checked source

An actual import saves records in CE. Keep your source database backup and agree the import scope before starting.

### 1. Review the import summary

Select Next to open Import. Check the connector and options.

![Check the connector and options before starting the real import.](v1-import-guide-import-summary.png)

### 2. Start the import

Choose **Start import**. The server reads requests page by page and saves mapped records.

![Start import saves the mapped records.](v1-import-guide-import-start.png)

### 3. Read the completed counts

Wait for Finished or inspect a stopped or failed result. The example saves one request with no failures. Counters update by page, so they can remain still while a page runs.

![The example completed with one request imported and no failures.](v1-import-guide-complete.png)

### 4. Check Activity

Open **Activity**. The import run appears with its status and request counts. A dry run is not listed as an import activity.

![The import run appears in Activity.](v1-import-guide-activity.png)

**Expected result:** The mapped data is stored in CE. Imported records retain plugin and run provenance. The source database remains unchanged.

## Read an import on a phone

Starting a long import is easier on a computer. The plugin page remains available on a phone.

### 1. Open the importer page

Read the current step and run status. Scroll inside the page for longer summaries.

![The import page adapts to phone width.](v1-import-guide-phone.png)

## Stop, resume and repeat

An active import continues on the server when you leave the page. Returning opens the current run. **Stop** ends it after its current page. **Resume** continues after the last completed request following a stop, failure or server restart.

A request already imported is replaced rather than duplicated. Repeating an import is a data update. Review your source scope and options first. The small screenshot fixture finished too quickly to demonstrate Stop and Resume. Those controls were checked in source, not captured during a long run.

Failed requests do not stop other requests. The page shows the first 100 reasons. It stores reason codes without source row content. An import does not emit data.persisted for each imported request, so workflows listening for that event do not run for those records.

## Run the import from the CLI

Follow [Start here](/docs/start-here) for CLI setup. From `openldr_ce`, allow only the intended connector. Use a dry run before the actual import. Replace the id and source offset.

```shell
pnpm openldr import allow openldr-v1-import <connector-id>
pnpm openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00 --dry-run --limit 100
pnpm openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00
pnpm openldr import status openldr-v1-import
pnpm openldr import allowed openldr-v1-import
```

## Optional practice with fictional source data

Normal use needs an existing v1 database. For a disposable SQL Server only, [example-source.sql](https://openldr.online/docs-samples/user-guide/v1-import/example-source.sql) creates a separate `guide_v1` database, the four expected tables, one fictional request, one patient and one text result. ASTResults is empty. This is a minimal source fixture, not a complete historical v1 schema.

The fixture creates a database. Read it before running and use a disposable server without a database named guide_v1. Ask your database operator to create a read-only account for it. No login credential is supplied in the file.

In a source checkout, `pnpm build:v1-import` stages the reference importer. It needs Rust and the wasm32-wasip1 target. Install its staged file with `pnpm openldr plugin install reference-plugins/openldr-v1-import/plugin.wasm`. The unsigned build is for a test installation. Use your organisation's approved signed package in normal use.

## Troubleshooting

**No importer in the main menu.** Check plugin installation, enabled state and administrator access.

**Plugin access is empty.** Check that the connector is Microsoft SQL and the importer is installed.

**No source choices.** Allow the plugin on the correct connector, then reopen its page.

**Connection fails.** Use connector Diagnose and correct the first failed step.

**Fewer than four tables.** Check the database override, table names and read permissions. A connection success alone does not prove the v1 schema.

**Start or Resume is refused.** Read its error and the API log. The import service requires an audit entry before starting.

**Counts stand still.** Wait for the current page. Each page can contain 500 requests. Check errors before deciding a large import has stalled.

## Related guides

[Diagnose connections](/docs/connector-diagnose), [Connectors](/docs/connectors), [Marketplace](/docs/marketplace), [Activity](/docs/activity) and [Audit](/docs/audit).
