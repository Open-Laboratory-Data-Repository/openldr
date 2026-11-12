# Workflows

Build a workflow when you need OpenLDR to receive, check, transform, store or deliver data. A node is one step. Lines connect the output of one node to the input of another.

Use your own records and reporting queries. No documentation sample data is required. The pictures use a separate test installation. Optional fictional practice files are at the end.

**View workflows** opens definitions and runs. **Edit workflows** creates and changes them. **Run workflows** starts manual runs. **Manage workflow secrets** changes webhook credentials.

The shipped **Ingest** workflow also handles Forms submissions. Keep it enabled. Editing it affects every sender using its webhook. Replace a secret only when you are ready to update those senders.

## Find a workflow

Use this to open an existing definition before inspecting or changing it.

### 1. Open Workflows

Select **Workflows** in the main menu.

![Open Workflows from the main menu.](workflows-guide-open-page.png)

### 2. Find the workflow

Use **Search workflows** to filter names. Clear the search to restore the list.

![Search filters the workflow names.](workflows-guide-search.png)

### 3. Open its row

Select the workflow name. This example opens the shipped **Ingest** workflow.

![Open the shipped Ingest workflow.](workflows-guide-ingest-row.png)

### 4. Fit the canvas

Select **Fit View** at the bottom left. Use the plus and minus controls to zoom. Pan moves the canvas; Select draws a selection box.

![Fit view brings the nodes into the canvas.](workflows-guide-fit.png)

## Set the Ingest webhook secret

Use this when an authorised sender needs a credential you can copy. A saved secret cannot be revealed. Coordinate rotation with the senders first.

### 1. Select Ingest received

Select the first node, **Ingest received**.

![Select the webhook trigger Ingest received.](workflows-guide-trigger.png)

### 2. Open its settings

Select the gear labelled **Configure** above the selected node.

![Configure opens the selected node settings.](workflows-guide-configure.png)

### 3. Generate a new secret

Under **Secret**, select **Replace secret**. An unsaved value instead offers **Regenerate**.

![Replace secret generates a value you must copy before saving.](workflows-guide-replace-secret.png)

### 4. Copy the new value

Copy the new secret and keep it with your sender credentials. The URL and Header fields show where and how to send it.

![Copy the new secret before saving. The saved value cannot be revealed.](workflows-guide-copy-secret.png)

### 5. Save the workflow

Select **Save** in the toolbar.

![Save stores the workflow and its new secret.](workflows-guide-save.png)

### 6. Confirm the system change

Check the system-workflow warning, then select **Save anyway** when you intend the change.

![System workflows require an explicit Save anyway confirmation.](workflows-guide-confirm-save.png)

**Expected result:** The Workflow saved message confirms the write. Senders must use the newly saved secret.

![The workflow saved message confirms this write.](workflows-guide-saved.png)

## Read a run and its webhook receipt

Use this after a sender has posted data. You can also inspect existing runs without sending anything new. The example is a real webhook run containing one fictional patient.

### 1. Open History

On the workflow canvas, select **History**.

![History lists real workflow runs and accepted webhook receipts.](workflows-guide-history.png)

### 2. Choose the run

In **Runs**, select the row matching the source and time you need.

![Select the completed webhook run.](workflows-guide-run-row.png)

### 3. Read the outcome

Check Completed or Failed, then each node status. In this Bundle example, Form Validate is skipped because the FHIR branch handled the input.

![The completed run shows which branch handled this Bundle.](workflows-guide-run-result.png)

### 4. Choose a node

Select a node row to inspect the data it received and produced. The example selects **Persist store**.

![Select a node execution to inspect its data.](workflows-guide-run-node.png)

### 5. Inspect its output

Select **Output**. Use **Result** or **Logs** for the other recorded details. A successful storage node does not prove a downstream recipient read the data.

![Output contains the data passed on by the selected node.](workflows-guide-run-output.png)

### 6. Inspect the accepted request

Select **Webhook receipts**. Match the request identifier and status to the sender response. A queued or running receipt is not a completed run.

![Webhook receipts shows the accepted request and its final status.](workflows-guide-receipts.png)

**Expected result:** You can distinguish the accepted webhook request from the workflow execution and its node results.

## Build a warehouse-count workflow

Use this small read-only workflow to learn the canvas. It counts requests already in your warehouse. Zero is a valid result, so no sample data or database connector is needed.

### 1. Open Workflow actions

Return to the Workflows list and open the dots labelled **Workflow actions**.

![Open Workflow actions to create or import.](workflows-guide-list-actions.png)

### 2. Choose New

Select **New**.

![New opens an empty canvas.](workflows-guide-new.png)

### 3. Name the workflow

Set **Workflow name** to a useful name. This example uses `Warehouse row count`.

![Name the workflow before saving it.](workflows-guide-name.png)

### 4. Find Manual Trigger

In the Node library, search for `Manual Trigger`.

![Search the Node library for Manual Trigger.](workflows-guide-find-manual.png)

### 5. Add the trigger

Drag **Manual Trigger** onto an empty part of the canvas.

![Drag Manual Trigger onto the canvas.](workflows-guide-manual-card.png)

### 6. Add SQL Query

Search for `SQL Query` and drag it beside the trigger. Clear the library search when finished.

![Drag SQL Query to the right of the trigger.](workflows-guide-sql-card.png)

### 7. Connect the nodes

Drag the dot on the right of Manual Trigger to the dot on the left of SQL Query. Confirm a line joins them.

![Connect the trigger output on its right to SQL Query input on its left.](workflows-guide-connect.png)

## Configure and run the warehouse count

Continue with the two connected nodes. This read-only query counts requests already in your warehouse. Your count can differ from the example.

### 1. Enter the query

Select SQL Query, then its Configure gear. In **SQL (SELECT only)**, enter `SELECT COUNT(*) AS requests FROM lab_requests`. This query reads the reporting schema.

![Use a read-only query against the reporting schema.](workflows-guide-sql.png)

### 2. Save the definition

Select **Save**.

![Save creates the named workflow.](workflows-guide-save-new.png)

### 3. Arm the run

Select **Run**. The manual trigger waits for your next action.

![Run arms the manual trigger.](workflows-guide-run.png)

### 4. Start the trigger

Select the play badge labelled **Click to run** on Manual Trigger.

![Select the play badge on the manual trigger to start execution.](workflows-guide-fire-trigger.png)

### 5. Read the count

After Completed appears, open SQL Query and select **Output**. Read the `requests` value. Your count can differ from the picture.

![The output contains the live request count, which can be zero.](workflows-guide-sql-output.png)

**Expected result:** The run completes in two steps and outputs one item containing the current request count.

![A successful run ends with Completed.](workflows-guide-completed.png)

## Export a workflow definition

Use this to keep a portable copy of a definition. Exported definitions can contain configuration, so review them before sharing.

### 1. Open the row actions

Return to the list and open the dots on the workflow row.

![Each workflow row has its own actions menu.](workflows-guide-row-actions.png)

### 2. Choose Export

Select **Export**. The browser downloads a `.workflow.json` file. The list actions menu offers Import for this file format.

![Export downloads the workflow definition as JSON.](workflows-guide-export.png)

**Expected result:** You have a JSON copy of the definition. Export does not run the workflow.

## Make a separate copy

Use Duplicate before experimenting with a saved custom workflow. The copy has its own definition.

### 1. Open the row actions

Open the dots beside the workflow you want to copy.

![Each workflow row has its own actions menu.](workflows-guide-row-actions.png)

### 2. Choose Duplicate

Select **Duplicate**. A new row ends with **(copy)**. Open it before making changes.

![Duplicate creates a separate workflow copy.](workflows-guide-duplicate.png)

**Expected result:** The original and the copy appear separately.

![The separate copy has its own row.](workflows-guide-duplicate-result.png)

## Remove a custom workflow

Use this only when you no longer need the definition. Delete permanently removes the selected custom workflow. The example removes the disposable copy.

### 1. Choose Delete

Open the custom workflow row dots and select **Delete**.

![Delete is available for custom workflows.](workflows-guide-delete.png)

### 2. Confirm the named workflow

Read the name in the confirmation. Select **Delete** only for the definition you intend to remove.

![Confirm only the custom workflow copy you mean to remove.](workflows-guide-delete-confirm.png)

**Expected result:** The copy disappears and the original remains.

![The original workflow remains after deleting its copy.](workflows-guide-delete-result.png)

## Import an exported definition

Use this to add a workflow from an exported JSON file. Check the configuration before running an imported definition.

### 1. Open Workflow actions

Open the dots above the workflow list.

![Open Workflow actions to create or import.](workflows-guide-list-actions.png)

### 2. Choose Import and a file

Select **Import**, then choose the exported `.workflow.json` file in your file picker.

![Import reads a previously exported definition.](workflows-guide-import.png)

**Expected result:** The imported custom workflow appears in the list. Import does not run it.

![Import adds another custom definition. It does not run it.](workflows-guide-import-result.png)

## Find workflows on a phone

Use the workflow list on a phone. Build and configure canvas workflows on a larger screen.

### 1. Search the list

Use **Search workflows** to find the saved definition.

![Search workflows on a phone.](workflows-guide-phone-search.png)

### 2. Open the workflow

Select its name. Use History when you need its runs. A larger screen is better for canvas editing.

![Open an existing workflow from its row.](workflows-guide-phone-open.png)

## Send your own webhook payload

Use the URL shown in the webhook settings. Use HTTPS outside a local test installation. Send the saved secret only in `X-Webhook-Token`. Use an input your workflow accepts, such as a FHIR Bundle for Ingest.

From your installation folder, put your approved payload in `data/your-payload.json`. Replace the host and secret below. Read [Start here](/docs/start-here) for installed and development command locations.

```shell
curl -X POST https://your-host/api/workflows/hooks/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: YOUR_SECRET" \
  -H "Idempotency-Key: sender-request-123" \
  -d @data/your-payload.json
```

A completed response contains `ok`, `runId` and `correlationId`. A 202 response means accepted, with a request identifier and polling URL. Follow that URL with the current token. Respect Retry-After. Reuse the same idempotency key and identical input for a retry. Different input with the same key returns 409.

## Optional fictional practice files

Use these only in a test installation. [Download one fictional patient Bundle](https://openldr.online/docs-samples/user-guide/workflows/example-patient.json) to practise the webhook. Store it as `data/your-payload.json` in your installation folder, for example `~/Downloads/openldr_ce` or `C:\openldr_ce`. Use the command above with your test host and token.

[Download the two-node warehouse count workflow](https://openldr.online/docs-samples/user-guide/workflows/warehouse-row-count.workflow.json). Import it through Workflow actions if you want a reference after building your own. Neither file is required for normal use.

## Choose other nodes

The Node library groups triggers, databases, communication, files and transformations. Search by the node name. A grey Coming soon entry cannot run.

Use Postgres, MySQL or Microsoft SQL with a matching enabled connector. SQL Query reads the reporting schema directly. Load Dataset reads saved workflow rows; Materialize Dataset replaces the rows saved under a dataset name.

Use Edit Fields, Filter, Switch, Pivot or Merge to transform items. Most text settings can read the incoming item with `{{ $json.fieldName }}`. Match the field names to the actual input you inspected.

File and delivery steps need their own setup. [Scheduled reports](/docs/report-pipeline) covers datasets and Excel templates. Configure an approved email connector before adding delivery.

## Handle interrupted webhook requests

History shows receipts separately from runs. Queued work can resume after a restart. Disabling, deleting or changing a workflow can cancel queued work. Interrupted means the result is unknown.

OpenLDR does not replay started work automatically. Check that the first worker stopped and reconcile outside effects before using a new request key. A failed connection does not prove nothing ran. Receipts remain after workflow deletion.

Use `./openldr` in your installed Linux or macOS folder, `.\openldr.ps1` on Windows, or `pnpm openldr` in a development checkout. Run it from your actual `openldr_ce` folder. [Start here](/docs/start-here) explains the launcher and file paths.

```shell
./openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
./openldr workflows receipts show REQUEST_ID --json
```

## Restore a shipped workflow

System workflows offer **Reset to default** instead of Delete. Reset discards the customised graph and requires confirmation. Export the current definition first if you need to keep it.

Reset normally keeps the existing webhook secret. If the reset warning says it could not keep one, set a new secret and update every sender. This guide did not reset an operational workflow.

## Troubleshooting

**Run waits without starting.** Select the play badge on the trigger after Run.

**A secret is rejected.** Check the saved value and current path. Replacing a secret requires Save and, for Ingest, Save anyway. A saved secret cannot be revealed.

**A node fails.** Inspect its input, configuration and logs in History. Check required connector settings and the field names entering it.

**Form capture says the pipeline is unavailable.** Check that the shipped Ingest workflow is enabled. Do not clear or delete its nodes to troubleshoot a sender.

**A delivery reports success.** Check the recipient system separately. Node completion does not prove a person received or read the result.

## Related guides

[Activity](/docs/activity) follows the payload lifecycle. [Scheduled reports](/docs/report-pipeline) builds stored data and workbook output. [Connectors](/docs/connectors) configures external systems.
