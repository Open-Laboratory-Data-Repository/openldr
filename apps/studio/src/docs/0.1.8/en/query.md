# Query

Use Query to browse enabled database connectors, inspect workflow datasets and save SELECT statements as Custom Queries. Report Designer can bind tables to those saved queries.

Start with your own connector and received data. No documentation sample data is required. The count example below also returns a useful result when the warehouse is empty. The pictures use a separate test installation.

You need **Use query workbench**. Queries read data. Statements that change data or tables are refused. A new installation creates a target-warehouse connector for its configured database engine. These pictures use **Target Warehouse (Postgres)**. Other sources need a matching enabled database connector.

Saved built-in queries can supply reports. Inspect them freely, but understand those report dependencies before changing SQL or parameter identifiers.

## Browse a source table

Use this to inspect a connector schema before writing SQL. A schema is the database namespace containing its tables.

### 1. Open Query

Select Query in the main menu.

![Open Query from the main menu.](query-guide-open-page.png)

### 2. Expand Connectors

Select Connectors in the Explorer.

![Expand Connectors in the Explorer.](query-guide-connectors.png)

### 3. Expand your connector

Select the enabled database connector. The example uses Target Warehouse (Postgres).

![Expand your enabled database connector.](query-guide-warehouse.png)

### 4. Expand its schema

Select the schema, such as public for the PostgreSQL warehouse.

![Expand the schema that contains your data.](query-guide-schema.png)

### 5. Open the table

Select the table you want to inspect. The example uses lab_requests. Empty tables can return no rows without an error.

![Select a table to browse its current rows.](query-guide-table.png)

### 6. Inspect the browse SQL

Select the SQL button above the results to show the generated SELECT. Plain table browsing has no guaranteed row order.

![SQL shows the SELECT used for this table browse.](query-guide-browse-sql.png)

### 7. Use the result pages

Use the page size and arrows for larger results. Add a deliberate ORDER BY ending in a unique key before relying on stable pages.

![Use the result page size and arrows for larger tables.](query-guide-browse-paging.png)

**Expected result:** The tab reads current rows from the selected connector. The screenshot warehouse has no requests.

![An empty warehouse can return no rows without being an error.](query-guide-browse-result.png)

## Run a warehouse count

Use a small read-only query to confirm the connector and the result. Your request count can differ from the picture.

### 1. Open a new query

Select the plus labelled new query in the tab bar.

![The plus opens a new query tab.](query-guide-new-query.png)

### 2. Choose the connector

Open Connector and select the database you intend to query.

![Choose the enabled database you intend to query.](query-guide-choose-connector.png)

### 3. Enter the SELECT

Enter `SELECT COUNT(*) AS requests FROM lab_requests` in the editor.

![Enter a read-only SELECT. This count also works with no data.](query-guide-sql.png)

### 4. Run the query

Select Run. The result has one requests column and one row, including when the count is zero.

![Run executes the selected connector and SQL.](query-guide-run-step-4.png)

**Expected result:** The result shows the current warehouse request count.

![One output row contains the actual request count.](query-guide-count-result.png)

## Add a required date-range parameter

Use parameters when the same query should ask for values each time it runs. This example counts requests from an included start date up to an excluded end date.

### 1. Use the date-bound SQL

Replace the SQL with `SELECT COUNT(*) AS requests FROM lab_requests WHERE authored_at >= {{ param.from }} AND authored_at < {{ param.to }}`.

![Date-range SQL reads the bound from and to values.](query-guide-parameter-sql.png)

### 2. Open Parameters

Select Parameters above the SQL editor.

![Parameters defines the values the query asks for.](query-guide-parameters.png)

### 3. Add a parameter

Open the Parameter actions dots in the sheet and choose Add.

![The Parameters sheet has its own actions menu.](query-guide-parameter-actions.png)

![Add creates a parameter definition.](query-guide-parameter-add.png)

### 4. Set Variable ID

Enter `period` as Variable ID. Date-range parameters supply the special from and to values used by the SQL.

![Use a stable variable identifier.](query-guide-parameter-id.png)

### 5. Set its visible label

Enter a clear Label, such as Period.

![The label is what users see when running the query.](query-guide-parameter-label.png)

### 6. Choose daterange

Set Type to **daterange**.

![daterange asks for two dates and supplies from and to.](query-guide-parameter-type.png)

### 7. Require the date bounds

Turn on Required because this SQL needs both dates.

![Require a value when the SQL needs both date bounds.](query-guide-parameter-required.png)

### 8. Save the parameter definition

Open Parameter actions and select Save. This updates the current query tab. Save the query itself when you want to keep it.

![Save applies the parameter definition to this tab.](query-guide-parameter-save.png)

## Run with chosen dates

Use dates matching your reporting question. The example includes 2026-01-01 and excludes 2027-01-01. That is the whole 2026 calendar year.

### 1. Run the parameterized query

Select Run. A Run parameters sheet asks for the configured values.

![Run executes the selected connector and SQL.](query-guide-run-step-1.png)

### 2. Enter the date bounds

Set the first date to the included start. Set the second to the excluded end used by this SQL. Different SQL can use a different boundary rule.

![Enter the first included date.](query-guide-from-date.png)

![Enter the exclusive end date used by this example SQL.](query-guide-to-date.png)

### 3. Open Run actions

Select the dots in the Run parameters sheet.

![Open the run-parameter actions after checking the dates.](query-guide-run-values-actions.png)

### 4. Run with these values

Select Run with these values.

![Run with these values executes the parameterized query.](query-guide-run-values.png)

**Expected result:** The result counts only requests inside the SQL date bounds. Zero is a valid count.

![The filtered count is a real result, including zero.](query-guide-parameter-result.png)

## Save the custom query

Save the SQL, connector and parameter definition when other work needs to reuse them.

### 1. Choose Save

Open Query actions above the editor and select Save.

![Use Query actions to save this SQL and its parameter definition.](query-guide-query-actions.png)

![Save asks for a name on the first save.](query-guide-save-query.png)

### 2. Name the query

Enter a unique name. The example uses Requests in a date range.

![Choose a unique saved-query name.](query-guide-query-name.png)

### 3. Save the named definition

Open Name actions in the naming sheet and choose Save.

![Save in the naming sheet persists the query.](query-guide-name-save.png)

**Expected result:** The query appears under Custom Queries in the Explorer. Later saves update the same definition.

![The saved query is available in the Explorer.](query-guide-saved-query.png)

## Rename a saved query

Use Rename to keep the existing query identifier and its report links. Renaming does not save unsaved editor changes.

### 1. Open the saved row actions

Expand Custom Queries and use the dots beside the saved query.

![Saved queries have their own row actions.](query-guide-saved-actions.png)

### 2. Choose Rename

Select Rename in that row menu.

![Rename changes the saved name while preserving its query identifier.](query-guide-rename.png)

### 3. Save the new name

Enter the new unique name, then open Name actions and choose Save. The example becomes Request count by period.

![Enter the new unique name.](query-guide-rename-value.png)

![Save in the naming sheet persists the query.](query-guide-name-save.png)

**Expected result:** The Explorer shows the new name and the query retains its identifier.

![The Explorer shows the new query name.](query-guide-renamed.png)

## Organise a query in a group

Groups arrange this installation's Explorer. They do not change a query's SQL or report bindings.

### 1. Open Custom query actions

Select the dots beside Custom Queries.

![Custom query actions contains New group.](query-guide-custom-actions.png)

### 2. Create a group

Select New group.

![New group creates an Explorer folder for saved queries.](query-guide-new-group.png)

### 3. Name and save the group

Enter a useful name, then use Name actions and Save. The example uses Documentation examples.

![Choose a useful group name.](query-guide-group-name.png)

![Save in the naming sheet persists the query.](query-guide-name-save.png)

### 4. Move the query

Open the query row dots, point at Move to group and select the destination group. Expand that group to see the query.

![Move to group changes organisation without changing SQL.](query-guide-move-group.png)

![Choose the destination group.](query-guide-group-option.png)

**Expected result:** The saved query appears inside its group.

![The query is listed inside the selected group.](query-guide-grouped.png)

## Export selected queries

Use an export to move names, SQL, parameters and group names between installations. Review the file before sharing source-specific content.

### 1. Open Export queries

Open Transfer actions in the Explorer header and select Export queries.

![The Explorer has separate transfer actions.](query-guide-transfer-actions.png)

![Export queries opens a selection sheet.](query-guide-export-open.png)

### 2. Select the definitions

Tick only the queries you intend to export.

![Select only the queries you intend to export.](query-guide-export-select.png)

### 3. Download the file

Open the export sheet dots and choose Download. Close the sheet when finished.

![Download exports names, SQL, parameters and group names.](query-guide-export-download.png)

**Expected result:** The JSON file contains the selected definitions. It omits query identifiers and connector bindings.

## Review and import a query file

Use this for an exported query file or an approved content pack. Check same-name behavior before applying it.

### 1. Open Import queries

Open Transfer actions and select Import queries.

![Import queries opens the file review.](query-guide-import-open.png)

### 2. Choose the JSON file

Open the import sheet dots, choose Choose file and pick the query export.

![Choose file opens your file picker.](query-guide-import-choose.png)

### 3. Read the preview

Check whether each name is new, skipped or replaced. The example already exists, so it will be skipped with replacement off.

![Review whether each name will be created, skipped or replaced.](query-guide-import-preview.png)

### 4. Check the connector and replacement choice

Choose the connector for newly imported names. Leave Replace existing queries off when you want to preserve existing definitions. Turn it on only when you intend replacement.

![Choose the connector for newly imported names.](query-guide-import-connector.png)

![Leave Replace existing queries off to preserve same-name definitions.](query-guide-import-replace.png)

### 5. Apply the reviewed import

Open the sheet dots and select Import. One invalid definition prevents the file from being imported.

![Import applies the reviewed plan. This same-name example is skipped.](query-guide-import-apply.png)

**Expected result:** The reviewed operation creates, skips or replaces the names as shown. Replacement keeps an existing query identifier and connector.

## Open a workflow dataset

Use this when a workflow has already prepared the rows you need. No workflow dataset is required for the other tasks in this guide.

### 1. Expand Datasets

Select Datasets in the Explorer.

![Datasets lists saved workflow data.](query-guide-datasets.png)

### 2. Open a saved dataset

Select its name. The example opens request_summary, created in Scheduled reports with workflows. It contains one requests value of zero.

![The saved workflow summary opens without a new source query.](query-guide-dataset-result.png)

**Expected result:** The tab displays the saved workflow rows.

## Run a saved query on a phone

The Explorer starts collapsed so the workspace has more room. A large screen is easier for writing SQL.

### 1. Expand the Explorer

Select Expand explorer at the top of its narrow rail.

![The Explorer starts collapsed on a phone.](query-guide-phone-expand.png)

### 2. Open the saved query

Expand Custom Queries and its group, then select the query name.

![Open a saved query inside its group.](query-guide-phone-query.png)

### 3. Collapse the Explorer

Select Collapse explorer to give the editor more width.

![Collapse the Explorer to make more room for the editor.](query-guide-phone-collapse.png)

### 4. Enter run values

Select Run and fill the parameter sheet. Use Run actions and Run with these values as on desktop.

![Run opens parameter entry for the saved query.](query-guide-phone-run.png)

![Enter the date bounds in the phone parameter sheet.](query-guide-phone-values.png)

## Remove a group and keep its queries

Use this when the folder is no longer useful. Removing a group keeps every query it contains.

### 1. Open the group actions

Use the dots beside the group name.

![Open the group actions without changing the query.](query-guide-group-actions.png)

### 2. Choose Delete group

Select Delete group.

![Delete group removes the folder and keeps its queries.](query-guide-group-delete.png)

### 3. Confirm the folder removal

Read the confirmation explaining that queries remain, then select Delete group.

![The confirmation explicitly keeps the queries.](query-guide-group-delete-confirm.png)

**Expected result:** The folder disappears and its queries appear outside it.

![The query remains outside the removed group.](query-guide-ungrouped.png)

## Remove an unneeded saved query

Check report dependencies before deleting a query. This example removes a disposable definition and keeps the reviewed query.

### 1. Open the query actions

Use the dots beside the unneeded saved query.

![Open the actions for an unneeded custom query.](query-guide-delete-query-actions.png)

### 2. Choose Delete query

Select Delete query. This removes the saved definition, not warehouse rows.

![Delete query permanently removes this saved definition.](query-guide-delete-query.png)

### 3. Confirm the removal

Read the confirmation, then choose Delete query only for the definition you intend to remove.

![Confirm only the saved query you intend to remove.](query-guide-delete-query-confirm.png)

**Expected result:** The saved definition disappears from the Explorer.

## Choose parameter types

Text accepts a value read as `{{ param.variableId }}`. Select asks for one value from Options SQL. Its first returned column supplies the choices. Date range supplies `{{ param.from }}` and `{{ param.to }}`.

Choose a unique nonempty Variable ID for each parameter. The parameter row dots can move it up or down or remove it. Removing a parameter still referenced by SQL causes an unbound-parameter error.

A blank optional value becomes an empty string. SQL must explicitly handle that empty value when it means no filter. Required does not invent a default. A report uses template parameters, so match its parameter key to the saved query definition.

A saved query with a Date range parameter, such as `period`, can also run in Reports. Add a Date range template parameter in Report Designer. Reports supplies the selected dates to the query. Existing queries with Text parameters named `from` and `to` remain supported.

## Remove or regroup definitions

A saved query row offers Rename, Move to group and Delete query. No group moves a query back to the top-level list. Deleting a saved query requires confirmation and can break reports that reference it.

Each group has Rename group and Delete group. Deleting a group keeps its queries and moves them out. Dragging a query onto a group is another way to move it. On a phone, use Move to group for a direct menu action.

Refresh under Transfer actions reloads Explorer entries changed elsewhere, including by CLI or content pack imports. Group organisation belongs to this installation and is not sent through central-to-lab sync.

## Keep paged results consistent

PostgreSQL and MySQL show a counted total. SQL Server can show total unknown and enables Next only when another row was found. Changing Rows per page returns to the first page.

For stable paging, finish ORDER BY with a unique key. For example, `ORDER BY authored_at, id` breaks equal-time ties when id is unique. Rows can still change while you page because the workbench does not hold a database snapshot.

A SQL Server connector without a Database can show accessible databases before schemas. Use full database, schema and table names for cross-database SQL on the same server. PostgreSQL connectors read one database each.

## Export or import from the CLI

Use `./openldr` in your installed Linux or macOS folder, `.\openldr.ps1` on Windows, or `pnpm openldr` in a development checkout. Run it from your actual `openldr_ce` folder. [Start here](/docs/start-here) explains the launcher and file paths.

```shell
./openldr query export --out data/queries.json --name "Request count by period"
./openldr query import data/queries.json
```

Export overwrites an existing output file. Import skips existing names by default. Add `--force` only when you intend to replace them. Content for one lab system belongs in operator-managed pack files.

## Optional practice query file

[Download the single reviewed query export](https://openldr.online/docs-samples/user-guide/query/request-count-queries.json). It asks for dates and counts warehouse requests. It contains no patient rows and needs no sample bundle. Import it only if you want a reference after writing your own query.

For a practice dataset, follow the optional count workflow in [Scheduled reports with workflows](/docs/report-pipeline). Datasets can be absent on a new installation.

## Troubleshooting

**No sources are available.** Ask a manager to configure an enabled database connector or create the workflow dataset you need.

**A query fails.** Read the error replacing the result. Correct SQL or values and run again. Old results are not a successful new answer.

**An unbound parameter is reported.** Match every SQL parameter to a configured definition. Date ranges use the from and to values.

**A Select list is empty.** Run its Options SQL in a separate tab. It may legitimately return no rows.

**A name already exists.** Choose another name. The naming sheet preserves the draft after a rejected duplicate name.

**An imported change disappears after restart.** Built-in definitions can be seeded again. Create a separate custom name when you need a durable variation.

## Related guides

[Report Designer](/docs/report-designer) binds saved query output to a page. [Reports](/docs/reports) runs library entries. [Connectors](/docs/connectors) configures data sources.
