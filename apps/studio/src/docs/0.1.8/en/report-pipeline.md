# Scheduled reports with workflows

Use two workflows when a report needs prepared data and a workbook template. The first reads your source and saves a named dataset. The second loads those saved rows and fills your workbook.

Start with your own reporting query and workbook. No documentation sample data is required. The small warehouse count below also runs with an empty warehouse. The optional practice workbook is at the end.

You need **Edit workflows** and **Run workflows**. Configuring database or email connectors also needs **Manage connectors**. Read [Workflows](/docs/workflows) for the canvas controls.

Build and check workbook output before adding a delivery node. The pictures use a separate test installation. Email settings are shown for explanation only. No email was sent during this review.

## Create the summary query

Use a read-only query that returns the columns your workbook needs. This introductory count returns one row even when there are no requests.

### 1. Create a workflow

Open Workflows, open Workflow actions and select **New**.

![New opens an empty workflow.](report-pipeline-guide-build-new.png)

### 2. Name it

Set Workflow name to a useful name. This example uses `Build request summary`.

![Name this workflow for its task.](report-pipeline-guide-build-name.png)

### 3. Add Manual Trigger

Search the Node library for Manual Trigger and drag it onto the canvas.

![Drag Manual Trigger from the Node library onto the canvas.](report-pipeline-guide-build-manual.png)

### 4. Add SQL Query

Search for SQL Query and drag it beside the trigger. This node reads the reporting schema directly. Use a database node and a connector for another source.

![Drag SQL Query from the Node library onto the canvas.](report-pipeline-guide-build-sql-node.png)

### 5. Connect the nodes

Drag the trigger output dot on the right to the SQL Query input dot on the left.

![Connect Manual Trigger output to SQL Query input.](report-pipeline-guide-build-connect.png)

### 6. Enter the SELECT

Select SQL Query, then its Configure gear. Enter `SELECT COUNT(*) AS requests FROM lab_requests`. Close the configuration panel to add the next node.

![Count the current warehouse requests. The count can be zero.](report-pipeline-guide-build-sql.png)

## Save the result as a dataset

A dataset keeps the most recently materialized rows under one name. Choose a stable name before another workflow reads it.

### 1. Add Materialize Dataset

Search for Materialize Dataset and drag it after SQL Query.

![Drag Materialize Dataset from the Node library onto the canvas.](report-pipeline-guide-build-materialize.png)

### 2. Connect it to SQL Query

Drag SQL Query output to Materialize Dataset input.

![Connect SQL Query output to Materialize Dataset input.](report-pipeline-guide-build-materialize-connect.png)

### 3. Name the dataset

Open Materialize Dataset configuration. Set **Dataset name** to your chosen name. The example uses `request_summary`.

![Choose a stable dataset name. A later run replaces the saved rows.](report-pipeline-guide-dataset-name.png)

### 4. Save the definition

Select **Save**.

![Save the definition before running it.](report-pipeline-guide-build-save.png)

### 5. Arm the workflow

Select **Run**.

![Run arms the manual trigger.](report-pipeline-guide-build-run.png)

### 6. Start the manual trigger

Select the play badge on Manual Trigger. Wait for Completed.

![Select the trigger play badge to start the run.](report-pipeline-guide-build-fire.png)

**Expected result:** The three-step run saves the current query rows under the dataset name.

![Completed confirms the workflow reached its end.](report-pipeline-guide-build-completed.png)

## Inspect and download the saved rows

Check the dataset before making workbook output. A count query has one row whose value can be zero.

### 1. Open Datasets

Select **Datasets** in the workflow toolbar.

![Datasets opens the stored workflow datasets.](report-pipeline-guide-datasets-button.png)

### 2. Check the saved dataset

Read its name, row count and update time. Match the name to the Materialize Dataset setting.

![Read the stored dataset name, row count and update time.](report-pipeline-guide-dataset-row.png)

### 3. Download CSV

Select **CSV** on that row to inspect the saved values in another tool.

![CSV downloads the saved rows.](report-pipeline-guide-dataset-csv.png)

**Expected result:** The downloaded CSV contains the rows the second workflow will load.

## Build the workbook workflow

Use a second workflow to read the prepared rows. It can run after the first workflow has refreshed the dataset.

### 1. Create and name the workflow

Return to Workflows and choose New. Set a name such as `Create summary workbook`.

![New opens an empty workflow.](report-pipeline-guide-deliver-new.png)

![Name this workflow for its task.](report-pipeline-guide-deliver-name.png)

### 2. Add Manual Trigger

Drag Manual Trigger from the library onto the canvas.

![Drag Manual Trigger from the Node library onto the canvas.](report-pipeline-guide-deliver-manual.png)

### 3. Add Load Dataset

Drag Load Dataset beside it.

![Drag Load Dataset from the Node library onto the canvas.](report-pipeline-guide-deliver-load.png)

### 4. Connect the trigger

Connect Manual Trigger output to Load Dataset input.

![Connect Manual Trigger output to Load Dataset input.](report-pipeline-guide-deliver-load-connect.png)

### 5. Choose the saved dataset

Open Load Dataset configuration. Set Dataset name to the exact name written by the first workflow, such as `request_summary`. Close the panel.

![Load the exact dataset name produced by the first workflow.](report-pipeline-guide-load-name.png)

### 6. Add Excel Template

Drag Excel Template onto the canvas after Load Dataset.

![Drag Excel Template from the Node library onto the canvas.](report-pipeline-guide-deliver-excel.png)

### 7. Connect Excel Template

Connect Load Dataset output to Excel Template input.

![Connect Load Dataset output to Excel Template input.](report-pipeline-guide-deliver-excel-connect.png)

## Configure your workbook template

Use your own .xlsx workbook. Put column headers above the cells that will receive data. Match the incoming field names to the workbook columns.

### 1. Save before uploading

Select Save. A template upload needs a saved workflow identifier.

![Save first so the template upload has a workflow identifier.](report-pipeline-guide-template-save.png)

### 2. Upload the template

Open Excel Template configuration, select **Upload template**, then choose your .xlsx file. The artifact key fills after upload.

![Upload your own .xlsx workbook with a header row.](report-pipeline-guide-template-upload.png)

![The upload fills the template artifact key.](report-pipeline-guide-template-uploaded.png)

### 3. Set the first data cell

Set **Start cell** to the top-left data cell. Use A2 when row one contains the headers.

![A2 writes data below a header in row one.](report-pipeline-guide-start-cell.png)

### 4. Map the columns in order

In **Columns (ordered)**, enter incoming field names separated by commas. The count example uses `requests` as its only field.

![List incoming field names in workbook-column order.](report-pipeline-guide-template-columns.png)

### 5. Choose an optional filter header

Set **Auto-filter header cell** to A1 for a row-one filter, or leave it blank.

![A1 enables a filter on the header row.](report-pipeline-guide-auto-filter.png)

### 6. Name the output file

Set **File name**, such as `request-summary.xlsx`.

![Set the generated download file name.](report-pipeline-guide-file-name.png)

## Run and check the workbook

Confirm the generated file before scheduling or emailing it. Check real values, headers and formatting in your spreadsheet application.

### 1. Save the template settings

Select Save.

![Save the definition before running it.](report-pipeline-guide-deliver-save.png)

### 2. Arm the run

Select Run.

![Run arms the manual trigger.](report-pipeline-guide-deliver-run.png)

### 3. Start Manual Trigger

Select its play badge and wait for Completed.

![Select the trigger play badge to start the run.](report-pipeline-guide-deliver-fire.png)

### 4. Download the generated file

Open Excel Template, select Output, then select the named workbook download.

![Download the generated workbook from Excel Template Output.](report-pipeline-guide-workbook-download.png)

**Expected result:** The workbook contains the saved dataset rows. The example has Requests in A1 and numeric zero in A2.

![Completed confirms the workflow reached its end.](report-pipeline-guide-deliver-completed.png)

## Set a rebuild schedule

Add scheduling after a manual run produces the intended rows. A five-part cron expression sets minute, hour, day of month, month and weekday.

### 1. Add Schedule

Open the first workflow and drag Schedule from the Node library onto the canvas.

![Drag Schedule from the Node library onto the canvas.](report-pipeline-guide-schedule-node.png)

### 2. Set the cron expression

Open Schedule configuration. Set **Cron Expression** to your intended time. `0 6 * * *` means 06:00 each day in the chosen timezone.

![Set a five-part cron expression for the rebuild time.](report-pipeline-guide-schedule-cron.png)

### 3. Set the timezone

Enter an IANA timezone such as `Africa/Dar_es_Salaam`. A blank Timezone uses UTC.

![Use the timezone that should interpret the schedule.](report-pipeline-guide-schedule-timezone.png)

### 4. Connect the schedule

Close configuration and connect Schedule output to SQL Query input. The manual trigger can remain for an intentional manual run.

![Connect Schedule output to SQL Query input.](report-pipeline-guide-schedule-connect.png)

### 5. Save the scheduled definition

Select Save when you intend to activate the connected schedule. Check History after its first due time.

![Save activates the connected schedule.](report-pipeline-guide-schedule-save.png)

**Expected result:** The saved schedule determines when the dataset rebuilds. This review saved its settings and then disabled the test workflow. Clock-driven firing was not exercised.

## Configure optional email delivery

Only add delivery after you have an approved email connector and recipients. The review shows an unused loopback connector and an example.invalid address. It did not save or run this email node.

### 1. Add and connect Send Email

Open the workbook workflow, add Send Email (SMTP), then connect Excel Template output to its input.

![Drag Send Email (SMTP) from the Node library onto the canvas.](report-pipeline-guide-email-node.png)

![Connect Excel Template output to Send Email (SMTP) input.](report-pipeline-guide-email-connect.png)

### 2. Choose the email connector

Open the node configuration. Choose your approved SMTP connector. Gmail and Outlook have their own node types and matching connectors.

![Choose your approved SMTP connector.](report-pipeline-guide-email-connector.png)

### 3. Set the recipients

Enter approved recipients in To. Add Cc only when needed. Replace the example address with your real authorised destination.

![Enter the approved recipient. This example address cannot receive mail.](report-pipeline-guide-email-to.png)

### 4. Set the subject

Enter a clear Subject.

![Give the message a clear subject.](report-pipeline-guide-email-subject.png)

### 5. Write the body

Enter the message Body.

![Write the message body.](report-pipeline-guide-email-body.png)

### 6. Match the body format

Choose Plain text or HTML to match the text you wrote.

![Choose Plain text or HTML to match the body.](report-pipeline-guide-email-format.png)

### 7. Attach the workbook field

Set **Attachment field** to `file`, the Excel Template output field. A blank value sends no attachment.

![Use file to attach the Excel Template output.](report-pipeline-guide-email-attachment.png)

**Expected result:** The settings identify the transport, recipients, content and attachment. Saving and running a connected email node sends real mail. Check the destination inbox only when your team has authorised that delivery test.

## Inspect reporting workflows on a phone

Build the canvas on a larger screen. On a phone, use the list and History to inspect an existing definition.

### 1. Find the workflows

Search their names in Workflows.

![Find the saved reporting workflows on a phone.](report-pipeline-guide-phone-find.png)

### 2. Open the workbook workflow

Select its name in the list.

![Open the saved workbook workflow to inspect its history.](report-pipeline-guide-phone-open.png)

### 3. Read History

Select History and check the run status and time.

![Read the completed manual run in History.](report-pipeline-guide-phone-history.png)

## Optional practice workbook

[Download the one-column practice workbook](https://openldr.online/docs-samples/user-guide/report-pipeline/example-summary-template.xlsx). It contains a Requests header in A1. It is for the read-only count example above and contains no patient data. Your own workbook can use different columns and formatting.

[Download the generated review workbook](https://openldr.online/docs-samples/user-guide/report-pipeline/generated-request-summary.xlsx) to compare the expected output. This file came from the actual isolated workflow run, with zero requests in its warehouse.

## Adapt the summary to your own report

Replace the count query with your approved SELECT and map its output fields to the workbook. For another database, use a matching Postgres, MySQL or Microsoft SQL connector node.

For reporting windows, set fields such as periodStart and periodEnd before the query, then read them with `{{ $json.periodStart }}`. Keep the query, parameter types and date boundaries consistent with your source.

Use Pivot when one incoming value must become several columns. Use Merge with Combine by key when joining two branches. Configure the actual keys and collision rules your data needs. These larger transformations were not exercised in this review.

Datasets can also be opened under Datasets in [Query](/docs/query). Publishing workflow datasets to warehouse SQL is an optional Settings choice. Keep the dataset name consistent across both workflows.

## Choose a delivery time

Schedule the workbook workflow after the dataset refresh should have finished. Allow time for the source query. A schedule offset alone does not guarantee that an unusually slow first workflow finished. Check the saved dataset update time and History.

Manual Run also uses the currently stored dataset. It does not rebuild the first workflow automatically. Re-run the first workflow when you need fresh data.

## Troubleshooting

**The dataset is missing.** Run the first workflow and check Materialize Dataset for errors. Match the exact dataset name in Load Dataset.

**The workbook is empty.** Inspect the CSV and the incoming field names. A filtered query may legitimately return no rows.

**Upload asks you to save first.** Save the workflow, then upload again. The upload belongs to that saved workflow.

**Values land in the wrong columns.** Check Start cell and Columns (ordered). The mapping writes fields left to right in the stated order.

**A schedule did not produce the expected file.** Check that the workflow is enabled, the cron expression and timezone, then its History. A stored schedule is not proof that it fired.

**An email lacks the workbook.** Check the upstream Excel Template output and Attachment field. Confirm the real transport and recipient independently.

## Related guides

[Workflows](/docs/workflows) explains the canvas and run history. [Query](/docs/query) browses stored datasets. [Connectors](/docs/connectors) configures source and delivery transports.
