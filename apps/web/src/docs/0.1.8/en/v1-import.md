# Import from OpenLDR v1

<!-- operator-platform -->

Run maintenance on the OpenLDR host, from your installed Compose folder. The examples use `~/Downloads/openldr_ce` on Linux/macOS and `C:\openldr_ce` in PowerShell. Replace these paths with your installation. The blue prompt is already shown by the terminal. Type the command only. File illustrations show text to edit in the named file. Pictures are examples, not proof that maintenance succeeded. Sample data is optional.

The OpenLDR v1 import plugin reads a v1 SQL Server database and saves mapped requests, patients, results and antimicrobial susceptibility results into CE. It runs on the server in pages of requests.

Use your own v1 database through a read-only Microsoft SQL connector. Diagnose it first. The plugin must be installed and an administrator must allow it to read that connector.

You need **Manage connectors** to grant source access. The plugin page is for the lab administrator role. Know the UTC offset used by the source lab.

The plugin page has two tabs. **Import** reads the source and saves records in CE. **Copy** keeps a copy of the source rows on the CE server. The copy holds patient data in full. In this release you can make a copy and keep it, and nothing reads it yet. The import still reads the source itself.

The pictures use one fictional request, patient and text result on an isolated SQL Server. They establish an actual dry run and import of that small fixture. They do not establish compatibility with every historical v1 database. Optional practice data is at the end.

## Allow the plugin to read a connector

Install the plugin through Marketplace or its approved plugin file. Create a Microsoft SQL connector whose login has SELECT on the v1 tables and nothing more, so it can read the source and never change it.

### 1. Open Connectors

Open **Settings**, then **Connectors**. Use [Diagnose connections](/docs/connector-diagnose) to check the source connection first.

![Open Settings, then Connectors.](/docs-images/operator/v1-import-guide-connectors.png)

### 2. Open Plugin access

On the v1 connector row, open the dots and choose **Plugin access**.

![Choose Plugin access for the v1 database connector.](/docs-images/operator/v1-import-guide-access.png)

### 3. Allow the importer

Turn on the switch beside `openldr-v1-import`. Each switch saves immediately.

![Allow openldr-v1-import to read this connector.](/docs-images/operator/v1-import-guide-allow.png)

### 4. Check the saved switch

The switch stays on. Turn it off later to revoke the plugin's access to that connector.

![The allowed switch stays on after saving.](/docs-images/operator/v1-import-guide-allowed.png)

**Expected result:** The plugin can now offer this connector as a source. Grant and revoke actions appear in Audit.

## Choose and check the source

A successful connection check establishes network access and login. The later Checks step establishes the expected tables.

### 1. Open the importer

Select **OpenLDR v1 import** in the main menu.

![Open OpenLDR v1 import from the main menu.](/docs-images/operator/v1-import-guide-plugin-nav.png)

### 2. Choose the source connector

On Source, select the connector that points to your v1 database.

![Select the allowed v1 connector.](/docs-images/operator/v1-import-guide-source.png)

### 3. Check the connection

Select **Check connection**. Read each step and wait for **The connection works.** Correct any failure before proceeding.

![Check connection must pass before importing.](/docs-images/operator/v1-import-guide-connection.png)

**Expected result:** The selected connection works from the CE server. No source data has been imported.

## Set the source time and import limits

v1 stores local date-times without a time zone. Choose the offset that describes those source timestamps.

### 1. Set Site time zone

Select Next to open Options. Enter the source lab's UTC offset, such as `+02:00`. Use `Z` only for a source stored in UTC. The fictional example uses Z.

![Set the actual source site UTC offset. This fictional source uses Z.](/docs-images/operator/v1-import-guide-timezone.png)

### 2. Choose optional limits

Database overrides the connector database. From date and To date limit registered dates. Panel codes is a comma-separated list. Leave limits empty only when you intend to read everything.

![Leave optional limits empty only when you intend to import everything.](/docs-images/operator/v1-import-guide-options.png)

### 3. Run the table checks

Select Next to open Checks. Read the table and row counts. **4 of 4** tables must be found: Requests, LabResults, Patients and ASTResults.

![Read table and row counts before moving on.](/docs-images/operator/v1-import-guide-checks.png)

**Expected result:** Checks count source tables and rows without importing. If a table is missing, verify the database and source schema.

## Try a dry run

A dry run reads and maps a limited number of requests without saving their clinical records.

### 1. Set the request limit

Select Next to open Dry run. Enter a small request limit. The example uses `100` against a one-request fixture.

![Dry run limits how many requests are read without saving.](/docs-images/operator/v1-import-guide-dry-limit.png)

### 2. Start the dry run

Choose **Start dry run**.

![Choose Start dry run.](/docs-images/operator/v1-import-guide-dry-start.png)

### 3. Read the result

Wait for Finished. Check requests read, mapped or imported counts, and failures. Read the reasons before proceeding.

![Read the dry-run mapped and failed counts.](/docs-images/operator/v1-import-guide-dry-result.png)

**Expected result:** The fictional fixture finishes with one successful request and no failures. A successful sample does not guarantee that every request in a large source will map.

## Import the checked source

An actual import saves records in CE. Keep your source database backup and agree the import scope before starting.

### 1. Review the import summary

Select Next to open Import. Check the connector and options.

![Check the connector and options before starting the real import.](/docs-images/operator/v1-import-guide-import-summary.png)

### 2. Start the import

Choose **Start import**. The server reads requests page by page and saves mapped records.

![Start import saves the mapped records.](/docs-images/operator/v1-import-guide-import-start.png)

### 3. Read the completed counts

Wait for Finished or inspect a stopped or failed result. The example saves one request with no failures. Counters update by page, so they can remain still while a page runs.

![The example completed with one request imported and no failures.](/docs-images/operator/v1-import-guide-complete.png)

### 4. Check Activity

Open **Activity**. The import run appears with its status and request counts. A dry run is not listed as an import activity.

![The import run appears in Activity.](/docs-images/operator/v1-import-guide-activity.png)

**Expected result:** The mapped data is stored in CE. Imported records retain plugin and run provenance. The source database remains unchanged.

## Read an import on a phone

Starting a long import is easier on a computer. The plugin page remains available on a phone.

### 1. Open the importer page

Read the current step and run status. Scroll inside the page for longer summaries.

![The import page adapts to phone width.](/docs-images/operator/v1-import-guide-phone.png)

## Stop, resume and repeat

An active import continues on the server when you leave the page. Returning opens the current run. **Stop** ends it after its current page. **Resume** continues after the last completed request following a stop, failure or server restart.

A request already imported is replaced rather than duplicated. Repeating an import is a data update. Review your source scope and options first. The small screenshot fixture finished too quickly to demonstrate Stop and Resume. Those controls were checked in source, not captured during a long run.

Failed requests do not stop other requests. The page shows the first 100 reasons. It stores reason codes without source row content. An import does not emit data.persisted for each imported request, so workflows listening for that event do not run for those records.

## Copy the source first

A copy reads the rows of the v1 database and keeps them on the CE server's own disk. Use it when the link to the source is slow or drops. The server reads page by page, tries again after a lost link, and carries on after a restart. Nobody needs to watch the page.

Nothing reads the copy yet. The import in the sections above still reads the source itself, so a copy does not change what an import saves.

The copy holds patient data in full. It keeps every column of the Requests, LabResults, Patients and ASTResults rows of each request it reads. Protect the CE server and its backups as you protect the source. There is one copy for each connector. The plugin must be allowed to read the connector first.

### 1. Open the Copy tab

Open **OpenLDR v1 import** in the main menu, then select the **Copy** tab at the top of the page.

![The Copy tab sits beside the Import tab.](/docs-images/operator/v1-import-guide-copy-tab.png)

### 2. Choose the source and options

Select the connector. Under **Copy options**, fill in the same values as for an import. **Database**, **From date**, **To date** and **Panel codes** decide which requests the copy reads. The copy does not need **Site time zone**, because it keeps the dates as the source wrote them. The page still asks for a value such as `+02:00` or `Z`. Any valid value gives the same copy.

![Choose the connector and the copy options.](/docs-images/operator/v1-import-guide-copy-options.png)

### 3. Start the copy

Open the dots menu at the top right of the Copy tab and select **Start copy**. The status reads **Queued. The server starts it within a few seconds.** Then it reads **Copying**. You can leave the page. While a copy runs, its options are locked. You can still pick another connector to see or start its copy.

![Start copy is in the dots menu at the top right of the tab.](/docs-images/operator/v1-import-guide-copy-start.png)

### 4. Read the set table

Each row of the table is one set. The v1 plugin copies one set, `requests`, which holds the rows of all four tables for each request. **State** reads Not started, Copying, Waiting, Partly copied, Done, To be read again or Deleting. **Requests read** is the number of requests stored so far. **Rows** is the number of source rows stored, from all four tables. **Size** is the size of those rows as CE stores them.

The line under the status counts requests "of an unknown number of requests", because the copy does not count the source first. A finished copy reads **Finished** and gives **Requests copied:** with the count.

![The set table gives the state, requests, rows and size.](/docs-images/operator/v1-import-guide-copy-sets.png)

When CE could not copy some requests, an amber line gives **Requests left out:** and the count, and the status reads **Finished, with requests left out**. Troubleshooting says why.

![A copy with requests left out is not complete.](/docs-images/operator/v1-import-guide-copy-skipped.png)

### 5. Leave a waiting copy alone

When the source or the link to it is down, the status reads **Waiting for the source. It will try again by itself.** The page shows **Tries so far:**, when the wait began, and the last error. You do nothing. The first wait is 5 seconds. Each wait doubles, up to 5 minutes, until the source answers or someone stops the copy. If the source answers but the same page is lost twice in a row, the copy reads that page again at half the size. The waits then start again at 5 seconds. The page grows back after 5 good pages in a row.

The last error of a lost link usually starts with plain words, then gives the driver's own words. When the source itself restarts, it can refuse the login or say its database is missing for a while. A copy that has read from this source before waits on that for up to about an hour. The same goes for a wrong password typed into the connector before you continue a copy. That copy waits up to about an hour, then fails. A new copy with a wrong password fails at once.

After you change the connector's settings, stop the copy and continue it. A waiting copy keeps trying the old settings.

A copy also carries on by itself after the CE server restarts. Nobody presses anything. The counts can stand still for up to about two minutes after the restart before they move again.

![A waiting copy tries again by itself.](/docs-images/operator/v1-import-guide-copy-waiting.png)

### 6. Stop and continue

Open the dots menu beside the status and select **Stop**. The status reads **Stopping after this page**, then **Stopped**. A queued copy stops at once. The rows copied so far stay. To carry on, open the dots menu at the top right of the tab and select **Continue copy**. Each set carries on from where it stopped. On a finished copy, **Continue copy** only tries the left-out requests again. It reads no new requests from the source. If the copy was started from the CLI without a time zone, **Site time zone** is empty apart from a grey hint. The page then asks for any valid offset, such as `Z`, before **Continue copy** works. That offset changes nothing in the copy.

![Stop is in the dots menu beside the status.](/docs-images/operator/v1-import-guide-copy-stop.png)

If you changed **Database**, **From date**, **To date** or **Panel codes**, Continue copy asks **Read again from the start?** and names the sets. **Read again** deletes the rows copied so far for those sets, then reads them again from the start. On a slow link that can take days. To keep the copy, select **Cancel** and put the options back. Then open the dots menu at the top right of the tab and select **Continue copy**.

![Read again deletes what was copied for the named sets.](/docs-images/operator/v1-import-guide-copy-reread.png)

### 7. Delete a copy

Stop the copy first. Open the dots menu and select **Delete copy**. The step names the connector and gives the rows and the size. Type `openldr-v1-import`, then select **Delete copy**.

The status reads **Deleting the copied rows**. The server deletes the rows in batches, in the background. It carries on when you leave the page, and after a server restart. When it ends, the page reads **The copy was deleted.**

![Type the plugin id to delete the copy.](/docs-images/operator/v1-import-guide-copy-delete.png)

**Expected result:** The copy holds the source rows on the CE server, and the source database is unchanged. Nothing in CE reads the copy yet.

## Run the import from the CLI

Follow [Start here](/docs/cli) for CLI setup. From `openldr_ce`, allow only the intended connector. Use a dry run before the actual import. Replace the id and source offset.

### 1. Allow only the intended source connector

```sh
{{operator:v1-allow}}
```

![Allow only the intended source connector.](guide:operator-v1-allow)

### 2. Read a limited dry run before writing

```sh
{{operator:v1-dry}}
```

![Read a limited dry run before writing.](guide:operator-v1-dry)

### 3. Start the real import only after reviewing the dry run

```sh
{{operator:v1-start}}
```

![Start the real import only after reviewing the dry run.](guide:operator-v1-start)

### 4. Read the current run status

```sh
{{operator:v1-status}}
```

![Read the current run status.](guide:operator-v1-status)

### 5. Stop a long run after its current page

```sh
{{operator:v1-stop}}
```

![Stop a long run after its current page.](guide:operator-v1-stop)

### 6. Resume the same stopped run

```sh
{{operator:v1-resume}}
```

![Resume the same stopped run.](guide:operator-v1-resume)

### 7. Read failure codes before another attempt

```sh
{{operator:v1-failures}}
```

![Read failure codes before another attempt.](guide:operator-v1-failures)

### 8. Start a copy and return at once

```sh
{{operator:v1-copy-start}}
```

`start` records the request and returns at once. The server does the copying. On a copy that is already queued, copying or waiting with the same options, it returns that copy unchanged. On a stopped or failed copy, it carries on from where each set stopped. On a finished copy, it only tries the left-out requests again and reads no new requests. When an option changed what a set reads, it names the sets and changes nothing. Run it again with `--reread` to read those sets again from the start. A copy that is copying or waiting must be stopped first. A copy does not need the `tz` option. If you leave it out, the page asks for a zone such as `Z` before **Continue copy** works. Any valid zone gives the same copy. The example shows where an option goes.

![Start a copy and return at once.](guide:operator-v1-copy-start)

### 9. Read the copy status

```sh
{{operator:v1-copy-status}}
```

It prints one line per copy: the copy id, the status, then `keys`, `rows`, `bytes` and `skipped` for each set. A finished copy with requests left out shows `completed with skipped keys`. A waiting or failed copy ends its line with the error. The copy id is the first value on the line.

![Read the copy status.](guide:operator-v1-copy-status)

### 10. Stop a copy after its current page

```sh
{{operator:v1-copy-stop}}
```

The rows copied so far stay. Run `start` again to carry on.

![Stop a copy after its current page.](guide:operator-v1-copy-stop)

### 11. Delete a stopped, failed or finished copy

```sh
{{operator:v1-copy-delete}}
```

`delete` refuses without `--force`. It returns before the rows are gone. The server carries on deleting in the background.

![Delete a stopped, failed or finished copy.](guide:operator-v1-copy-delete)



## Optional practice with fictional source data

Normal use needs an existing v1 database. For a disposable SQL Server only, [example-source.sql](https://openldr.online/docs-samples/user-guide/v1-import/example-source.sql) creates a separate `guide_v1` database, the four expected tables, one fictional request, one patient and one text result. ASTResults is empty. This is a minimal source fixture, not a complete historical v1 schema.

The fixture creates a database. Read it before running and use a disposable server without a database named guide_v1. Ask your database operator to create a read-only account for it. No login credential is supplied in the file.

In a source checkout, `pnpm build:v1-import` stages the reference importer. It needs Rust and the wasm32-wasip1 target. Install its staged file with `pnpm openldr plugin install reference-plugins/openldr-v1-import/plugin.wasm`. That command goes through the running API, so start it and sign in first. The unsigned build is for a test installation. Use your organisation's approved signed package in normal use.

## Troubleshooting

**No importer in the main menu.** Check plugin installation, enabled state and administrator access.

**Plugin access is empty.** Check that the connector is Microsoft SQL and the importer is installed.

**No source choices.** Allow the plugin on the correct connector, then reopen its page.

**Connection fails.** Use connector Diagnose and correct the first failed step.

**Fewer than four tables.** Check the database override, table names and read permissions. A connection success alone does not prove the v1 schema.

**Start or Resume is refused.** Read its error and the API log. The import service requires an audit entry before starting.

**Counts stand still.** Wait for the current page. Each page can contain 500 requests. Check errors before deciding a large import has stalled.

**The copy says Waiting for the source.** CE cannot reach the source, or the link to it is down. The copy tries again by itself, with up to 5 minutes between tries. Read the last error. If the wait goes on, run connector Diagnose. After you fix the connector, stop the copy and continue it, so it uses the new settings. Stop the copy only if you want it to stop trying.

**Some requests were skipped.** The amber line **Requests left out:** gives how many. CE leaves a request out for one of two reasons. Reading it on its own timed out three times. CE lists this as `SOURCE_TIMEOUT`. Or one of its rows holds text that CE's database cannot store, such as a NUL character. CE lists this as `ROW_NOT_STORABLE`. The copy tries them again at the end of each pass and at the next start. The page and the CLI show the count only. In the CLI the status reads `completed with skipped keys`. A copy with requests left out is not complete.

**Continue copy asks to read a set again.** In the CLI, `start` names the sets instead. An option that decides which requests are read has changed, or the plugin was upgraded. Read again deletes the rows copied for the named sets. Select **Cancel** and put the options back to keep them.

**The copy failed.** Read the last error. A refused login, a missing database or table, a fault in the plugin, or a write that CE's own database refused, such as on a full disk, ends the copy. Trying again cannot fix those. There is one exception. A copy that has read this source before waits up to about an hour on a refused login or a missing database, in case the source is restarting. Fix the cause, then open the dots menu at the top right of the Copy tab and select **Continue copy**. The rows copied so far stay.

**Delete copy is greyed.** A copy can be deleted only when it is stopped, failed or finished. Stop it first.

## Related guides

[Diagnose connections](/docs/connector-diagnose), [Connectors](/docs/connectors), [Marketplace](/docs/marketplace), [Activity](/docs/activity) and [Audit](/docs/audit).
