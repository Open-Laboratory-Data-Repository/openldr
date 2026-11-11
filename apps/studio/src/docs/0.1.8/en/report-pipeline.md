# Scheduled reports with workflows

This guide builds a classic scheduled report with workflows alone: query a database, fill a branded Excel template, and email it. Nobody writes or runs a separate program.

The pattern uses **two workflows joined by a dataset**:

1. **Materialize**: the heavy half. On a schedule it pulls data from the source database, reshapes it, and saves a named **dataset**, a stored table of results. Run it as often as the data needs refreshing.
2. **Report and email**: the delivery half. It **loads** that dataset, fills an Excel template, and emails the file. Run it when the report is due.

Splitting the work keeps the delivery fast, because it reads the stored dataset, not the live tables. The two halves can also run on different schedules.

This guide takes about 20 minutes. Select any picture or clip to enlarge it.

## Who can do what

You need **Edit workflows** to build the workflows, and **Manage connectors** to create the database and email connectors they use. See [Workflows](/docs/workflows) and [Connectors](/docs/connectors).

## Before you start

- **The docs sample data**, for the example. See [Dashboards, Load the sample data](/docs/dashboard#load-the-sample-data).
- **A database connector** to your source. A fresh install has **Target Warehouse (Postgres)**, which the example uses.
- **An email connector** for Part B. SMTP is easiest, including Gmail with an App Password. See [Connectors, Email connectors](/docs/connectors#email-connectors).
- **Your branded `.xlsx` template** for Part B, with a header row and data starting on the row below it.

## Example 1: materialize a dataset from the sample

Build the Materialize half on the sample data: count the orders per test for September and October 2026, and store the result as the dataset `orders_by_test_sample`.

![Naming the workflow, dropping Manual Trigger, Postgres and Materialize Dataset, joining them, and writing the SQL.](report-pipeline-build.mp4)

1. Open **Workflows**. Open **Workflow actions** and select **New**.
2. In **Workflow name**, type `Materialize orders by test (sample)`.
3. From the node library, drag **Manual Trigger** (under **Core**), **Postgres** (under **Databases**) and **Materialize Dataset** (under **Core**) onto the canvas.
4. Join them: Manual Trigger to Postgres, then Postgres to Materialize Dataset. Drag from a node's right-hand dot to the next node's left-hand dot.
5. Select **Postgres**, then its gear. Choose the connector **Target Warehouse (Postgres)** and type:

```sql
SELECT panel_desc AS test, COUNT(*) AS orders
FROM lab_requests
WHERE authored_at >= '2026-09-01' AND authored_at < '2026-11-01'
GROUP BY panel_desc
ORDER BY orders DESC
```

6. Select **Materialize Dataset**, then its gear. In **Dataset name**, type `orders_by_test_sample`. A dataset name is upserted: the latest run replaces the earlier rows.

![The Materialize Dataset node's settings.](report-pipeline-materialize-config.png)

![Saving, running, and the run completing.](report-pipeline-run.mp4)

7. Select **Save**, then **Run**. Select the play badge on Manual Trigger.

**Expected result:** **Completed, 3 steps**. Materialize Dataset's **Output** tab lists five items: Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6.

![The run's output: five rows.](report-pipeline-output.png)

The date window keeps the example to the sample's two months. In a real report, the window comes from an **Edit Fields** node, as in Part A below.

### See the dataset

1. In the workflow editor, select **Datasets** in the toolbar. **orders_by_test_sample** is listed with **5** rows, when it was updated, and a **CSV** download.

![The Datasets list in the workflow editor.](report-pipeline-datasets.png)

2. Open **Query**. In the Explorer, expand **Datasets** and select **orders_by_test_sample**. The five rows open in a tab.

![The dataset opened in Query.](report-pipeline-query.mp4)

![The dataset's five rows in Query.](report-pipeline-query-result.png)

A dataset lives in the internal database. To let SQL nodes and dashboards query it as a real table in the Postgres warehouse, switch on **Publish workflow datasets** in [Settings](/docs/settings).

## Part A: the Materialize workflow, in full

Build this graph (trigger → set → two SQL extracts → reshape → materialize):

![The Materialize workflow: schedule, date bounds, two database extracts, a pivot, a join, and materialize](report-materialize-builder.png)

1. **Schedule trigger**: set the cron for how often the data should rebuild.
2. **Edit Fields**: compute the reporting window, e.g. `periodStart` = first of last month, `periodEnd` = first of this month. These feed the queries.
3. **Database node(s)**: one or more **Postgres / Microsoft SQL** nodes, each with your source **connector** and a plain `SELECT`. Inject the window with templates:

   ```sql
   select ...
   from requests r
   where r.registered >= '{{ $json.periodStart }}'
     and r.registered <  '{{ $json.periodEnd }}'
   ```

   Keep each query a portable `SELECT`. Do the reshaping in the next nodes, not in database-specific SQL.
4. **Pivot** (if needed): turn long rows into wide columns (e.g. one column per antibiotic): set the group-by keys, the pivot column, the value column, and the fixed list of output columns.
5. **Merge → Combine by key** (if you have two extracts): join them on shared keys (e.g. `requestid`, `organism`). Wire the "left" branch into the node **first**.
6. **Materialize Dataset**: give it a stable name, e.g. `amr_ndola_monthly`.

**Save and run it.** Confirm the run is green and the dataset has rows (an empty dataset means the source or the date window returned nothing).

## Part B: the Report and email workflow

Build this graph (trigger → load → template → email):

1. **Schedule trigger**: set it to fire after Part A has refreshed the dataset.
2. **Load Dataset**: the same name you materialized (`amr_ndola_monthly`).

![The Excel Template node's configuration, including the Upload template button](report-excel-template.png)

3. **Excel Template**:
   - Click **Upload template** and choose your `.xlsx`. The *Template artifact key* fills in automatically. *(The workflow must be saved first, because the upload is stored against it.)*
   - **Start cell**: where data begins, e.g. `A2`.
   - **Columns (ordered)**: the item fields in template-column order; values are written left to right from the start cell.
   - **Auto-filter header cell**: e.g. `A1`, to add a filter over the header row (optional).
   - **Password**: to protect the file, point at a connector/secret holding the password; leave blank for an unprotected file.
4. **Send Email**:
   - **Connector**: your SMTP/email connector.
   - **To** (and **Cc**): the recipients.
   - **Subject** / **Body** / **Body format**.
   - **Attachment field**: set to `file` so the Excel Template output is attached.

**Run it** and check the recipient's inbox (and spam on first send).

## A larger example: the AMR monthly report

The Antimicrobial Sensitivity report is the pattern at full stretch:

- **Materialize:** two portable `SELECT`s, one for the culture isolates and one for the long-form AST results. Then a **Pivot** spreads ~50 antibiotics into columns, a **Merge → Combine by key** joins isolates to their pivoted results on `requestid` + `organism`, and **Materialize Dataset** writes `amr_ndola_monthly`.
- **Report:** **Load Dataset** → **Excel Template** fills the branded `AMR_temp.xlsx` (start `A2`, auto-filter `A1`, optional password) → **Send Email** attaches the file to the recipients.

Every antimicrobial-specific and date-specific piece lives in nodes, so the same two workflows run against Postgres or SQL Server just by choosing the matching connector.

## Order of operations

Always run **Materialize before Report**: the Report reads what Materialize wrote. On a schedule, set the Report to fire a little after the Materialize run.

## Troubleshooting

- **Report attachment is empty / headers only:** the dataset was empty. Run Materialize first and check the date window and source query.
- **"Save the workflow first" when uploading a template:** save the workflow, then upload (the file is stored against the saved workflow).
- **Email sends but no file is attached:** set the Send Email **Attachment field** to `file`.
- **Gmail rejects the login:** use an App Password, not your normal password. See [Connectors, Send from Gmail](/docs/connectors#send-from-gmail-with-an-app-password).
- **A database node has nothing to run against:** create and attach a database connector. See [Connectors](/docs/connectors).
- **Join produced no rows:** confirm both branches use the **same key field names**, and that the left branch is wired into the Merge node first.

## On a phone

Workflows can be read on a phone, but building one needs a large screen. A scheduled report runs on the server, so it does not need anyone's screen at all.

## Related guides

- [Workflows](/docs/workflows)
- [Connectors](/docs/connectors)
- [Custom Queries](/docs/query)
- [Reports](/docs/reports)
- [Settings](/docs/settings)
