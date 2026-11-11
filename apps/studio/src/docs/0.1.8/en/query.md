# Custom Queries

**Query** is where you look at the lab data directly and write SQL against it. You browse tables, write a `SELECT`, add parameters, and save it as a **Custom Query**. Saved queries are what [Report Designer](/docs/report-designer) tables bind to, and what published [reports](/docs/reports) run.

This guide takes about 25 minutes. It uses the docs sample data, so load that first. Select any picture or clip to enlarge it.

![Query with a table open. 1 Connectors. 2 Datasets. 3 Custom Queries. 4 New query tab. 5 Run.](query-tour.png)

1. **Connectors.** Each database connector, its schemas and its tables.
2. **Datasets.** Tables that workflows have built for reuse.
3. **Custom Queries.** Saved queries, in groups if you made any.
4. **New query.** The **+** in the tab bar opens an empty query tab.
5. **Run.** Runs the open tab.

## Who can do what

One permission covers this page: **Use query workbench**. Lab Admin, Lab Manager and Data Analyst have it by default.

Queries only read. A query that changes data or tables is refused.

## Before you start

The examples need the docs sample data. If **Total Orders** on the sample dashboard reads 0, load it first. See [Load the sample data](/docs/dashboard#load-the-sample-data).

A new install already has one connector, **Target Warehouse (Postgres)**, pointing at the lab warehouse. It also ships the queries behind the built-in reports, under **Custom Queries**. You can open and read them, but change them with care: reports use them.

## Example 1: browse a table

Look at the raw test orders.

![Opening Connectors, Target Warehouse, public and lab_requests.](query-browse.mp4)

1. Open **Query**.
2. In the **Explorer**, expand **Connectors**, then **Target Warehouse (Postgres)**, then **public**.
3. Select **lab_requests**. A tab opens with its rows.

**Expected result:** the footer reads **1–50 of 60**. Each row is one order, with columns such as `request_id`, `patient_id`, `panel_desc`, `status`, `priority` and `authored_at`.

The tables you will use most:

| Table | One row per |
| --- | --- |
| `lab_requests` | Test order |
| `lab_results` | Result, such as one haemoglobin value |
| `specimens` | Specimen |
| `diagnostic_reports` | Issued report |
| `patients` | Patient |
| `facility_registry` | Facility in the register. See [Facilities](/docs/facilities). |

A plain table browse has no fixed order. To see the SQL behind it, select the code button at the top right of the tab.

## Example 2: write a query

Count the orders for each test.

![Opening a new query tab, choosing the connector, writing SQL and running it.](query-write.mp4)

1. Select **+** in the tab bar. A tab named **Query #1** opens.
2. Open **Connector** and choose **Target Warehouse (Postgres)**.
3. Type this in the editor:

```sql
SELECT panel_desc AS test, COUNT(*) AS orders
FROM lab_requests
GROUP BY panel_desc
ORDER BY orders DESC
```

4. Select **Run**, the play button.

**Expected result:** five rows. Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6.

**Run** is greyed out until the tab has a connector and some SQL.

## Example 3: add a parameter

Turn the query into one that asks which test to count, and splits the orders by priority.

![Changing the SQL, adding a Select parameter with Options SQL, and saving the parameter.](query-params.mp4)

1. Replace the SQL with:

```sql
SELECT priority, COUNT(*) AS orders
FROM lab_requests
WHERE panel_desc = {{ param.test }}
GROUP BY priority
ORDER BY orders DESC
```

2. Select the **Parameters** button, the sliders icon at the right of the tab's toolbar. The **Parameters** window opens.
3. Select **Add**.
4. In **Variable ID**, enter `test`. It must match the name inside `{{ param.test }}`.
5. In **Label**, type `Test`. That is what people see when they run it.
6. Set **Type** to **select**. An **Options SQL** box appears. Type `SELECT DISTINCT panel_desc FROM lab_requests ORDER BY 1`. Its first column fills the list.
7. Tick **Required**.
8. Select **Save**.

![The Parameters window with one select parameter.](query-params-sheet.png)

Parameter types:

| Type | Asks for | SQL |
| --- | --- | --- |
| text | Any text | `{{ param.<id> }}` |
| select | One value from a list. **Options SQL** fills the list. | `{{ param.<id> }}` |
| daterange | A first and last day | `{{ param.from }}` and `{{ param.to }}` |

The arrows on a parameter change its order. The bin removes it.

### Run it with a value

![Running the query, choosing HIV viral load and running with that value.](query-run-values.mp4)

1. Select **Run**. Because the query has parameters, a side panel asks for values first.
2. Set **Test** to **HIV viral load**.
3. Open the panel's actions menu and select **Run with these values**.

**Expected result:** three rows. routine 7, urgent 2, stat 2. That is all 11 HIV viral load orders.

A blank optional parameter runs as an empty string. That means no filter when the SQL tests for `''`.

## Example 4: save the query

![Saving the query under a name. It appears under Custom Queries.](query-save.mp4)

1. Open the tab's **Query actions** menu, the dots beside the parameters button, and select **Save**.
2. The first save asks for a name. Type `Orders by priority for one test`.
3. Open the panel's actions menu and select **Save**.

**Expected result:** a **Saved custom query** message, the tab takes the new name, and the query appears under **Custom Queries** in the Explorer. Later saves update the same query.

A name must be unique. A duplicate name leaves the panel open with your draft. Choose another name.

To use this query in a report, see [Report Designer](/docs/report-designer). A report's filters come from its template's parameters, not from the query. Give the query parameter the same **Variable ID** as the template parameter's key, and the report's filter value flows through when the report runs.

To finish this guide, delete the query: open its actions menu in the Explorer and select **Delete query**.

## Rename, group and delete

Each saved query in the Explorer has its own actions menu.

![A saved query's actions menu: Rename, Move to group, Delete query.](query-row-actions.png)

- **Rename.** Changes only the name. The query keeps its id, so reports still find it. You do not need to open it in a tab. Do not delete a query to rename it.
- **Move to group.** Puts it in a group, or takes it out with **No group**.
- **Delete query.** Removes it, after you confirm.

**Rename** in a tab's **Query actions** menu does the same for the open query. It changes only the saved name. Unsaved SQL, connector and parameter changes stay in the tab until you select **Save**.

### Groups

A content pack can add many queries at once. Groups keep the list readable.

- To make a group, open the actions menu on **Custom Queries** and choose **New group**. Enter a name and choose **Save** from the panel's actions menu.
- To put a query in a group, drag it onto the group. On a phone, press and hold the query first, or use **Move to group**.
- To take a query out of its group, drag it onto **Custom Queries**, or choose **Move to group**, then **No group**.
- Each group has an actions menu with **Rename group** and **Delete group**. Deleting a group keeps its queries. They move out of the group.

Groups only arrange the list. Moving a query does not change its name, SQL or id, so reports keep working. Groups belong to this install. Central-to-lab sync does not send or change them.

## Export and import queries

The Explorer header has its own actions menu.

![The Explorer menu: Refresh, Export queries, Import queries.](query-transfer-menu.png)

- **Refresh** reloads the Explorer after queries change elsewhere, for example from the CLI or a content pack.
- **Export queries** downloads a file with each query's name, SQL, parameters and group name. It does not hold the id or the connector.
- **Import queries** reads such a file.

Import follows these rules:

- A new name is created.
- A name that already exists is skipped, unless you choose to replace it.
- Replace keeps the query's id and connector, so reports that use it keep working.
- Replacing a built-in query that ships with CE is undone the next time CE seeds its built-in queries.
- If a replaced query changes a parameter's id, reports that set the old parameter lose it.
- One bad query stops the whole file. Nothing is written.
- New queries use **Target Warehouse (Postgres)** unless you pick another connector.
- A query with a group name goes into that group, which is created if needed. A new query always joins its group. A replaced query joins its group only if it has none yet, so a query you moved stays where you put it.

From the command line:

```bash
openldr query export --out queries.json [--name <name>...]
openldr query import queries.json [--connector <name>] [--force]
```

`--out` overwrites an existing file. `--force` replaces queries that already exist.

Content written for one lab system is shared as these files. They live in the operator's `packs/` folder, not in CE itself.

## Datasets

Expand **Datasets** to query tables a workflow has built. Use them for slow or complex data, so a report reads a ready table instead of the live source. See [Workflows](/docs/workflows).

## Paging and SQL Server

Table browsing and query results work on PostgreSQL, MySQL or MariaDB, and SQL Server connectors.

- PostgreSQL and MySQL or MariaDB show a counted total, such as **1–50 of 60**.
- SQL Server shows a row range and "total unknown". The workbench did not count the full result. **Next** is available only when the server found one more row after this page. An exactly full last page still disables **Next**. **Previous** goes back a page.
- Changing **Rows per page** goes back to the first page.
- SQL Server reads up to the requested offset, so later pages can be slower. Paging does not take a database snapshot.

For repeatable paging, add an `ORDER BY` that ends with a unique key. For example, if `id` is unique, `ORDER BY created_at, id` breaks ties between equal times. The workbench cannot guess a unique key for your SQL. Without one, rows can repeat or go missing between pages, and so can rows that change while you page.

## On a phone

On a phone, the Explorer starts folded into a thin strip on the left. Select the panel button at the top of the strip to open it. Fold it again to give the query the whole screen.

![The Explorer opened on a phone, with Custom Queries expanded.](query-phone.png)

## Troubleshooting

- **Run is greyed out.** Choose a connector and write some SQL first.
- **"unbound parameter".** Every `{{ param.x }}` in the SQL needs a parameter with that **Variable ID**.
- **"required parameter" when running.** Fill every parameter marked **Required**.
- **The query is refused.** Only `SELECT` statements run. Anything that changes data or tables is refused.
- **No connectors in the Explorer.** Make or turn on a database connector. See [Connectors](/docs/connectors).
- **A select parameter's list is empty.** Its **Options SQL** returned no rows. Run that SQL in its own tab to check it.
- **Pages repeat or skip rows.** Add an `ORDER BY` that ends with a unique key. See [Paging and SQL Server](#paging-and-sql-server).
- **You need the facility register.** Read the warehouse table `facility_registry`. See [Facilities](/docs/facilities).

## Related guides

- [Reports](/docs/reports)
- [Report Designer](/docs/report-designer)
- [Connectors](/docs/connectors)
- [Dashboards](/docs/dashboard)
