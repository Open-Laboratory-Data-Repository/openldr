# Workflows

A workflow is a chain of steps that runs by itself. It can take data in over HTTP, check it, store it, query a database, reshape rows, build a spreadsheet and email it. You build it on a canvas by dragging steps, called **nodes**, and joining them with lines. No program to write.

This guide takes about 40 minutes. You get the built-in **Ingest** workflow ready to take data over HTTP, send it one record, read the run, then build a small workflow of your own. Select any picture or clip to enlarge it.

![The workflow list on a new install: Ingest and On Ingest Persisted → Log.](workflows-tour.png)

## Who can do what

| Permission | What it lets you do |
| --- | --- |
| View workflows | Open **Workflows**, see the definitions and their runs. |
| Edit workflows | Make, change, import and delete workflows. |
| Run workflows | Start a run by hand. |
| Manage workflow secrets | Set encrypted secrets, such as a webhook secret. |

Lab Admin and Lab Manager have these by default.

## What a new install has

| Workflow | What it does |
| --- | --- |
| **Ingest** | Takes data posted to `/api/workflows/hooks/ingest`. A **Switch** checks its shape. A FHIR Bundle, or a list of FHIR resources, is unwrapped into one item per resource. A plain object of form answers is checked against the **Lab order** form. Both branches end in **Persist store**, which saves the data. **Forms** hand capture also goes through this workflow, so keep it enabled. |
| **On Ingest Persisted → Log** | Runs each time Ingest stores something, and writes a log line. A starting point for your own reactions to new data. |

Both are **system workflows**. Saving a change to one asks you to confirm first, because a broken Ingest stops data being stored. **Reset to default** in its row menu restores the shipped version.

## Core ideas

- **Nodes and lines.** Each node does one step. Data flows along the lines as a list of **items**. Each item is a record with a `json` object and, sometimes, attached files.
- **Triggers.** Every workflow starts with a trigger node: manual, schedule, webhook, data ingest, an event, or a listener.
- **Configure Node.** Select a node, then its gear, to set it up in the panel on the right. The panel has **Config**, **Input** and **Output** tabs.
- **Datasets.** A workflow can save its result as a named dataset. Other workflows, dashboards and reports can read it later. This is how a heavy "build the data" workflow hands off to a light "deliver it" workflow.

## Example 1: get the Ingest webhook ready

A new install generates a secret for the Ingest webhook, but nobody can read a saved secret. To send data, you replace it and copy the new one before saving.

![Opening Ingest, opening its trigger, replacing the secret and saving.](workflows-ingest-secret.mp4)

1. Open **Workflows** and select **Ingest**. The canvas opens.
2. Select **Fit View**, the square at the bottom left of the canvas, to see all six nodes.
3. Select the first node, **Ingest received**, then the gear above it. **Configure Node** opens on the right.
4. Under **Secret**, select **Replace secret**. A new secret appears in the box.
5. Copy it now. You cannot see it again after saving.
6. Select **Save** at the top. Ingest is a system workflow, so a prompt asks **Save changes to a system workflow?** Select **Save anyway**.

![Configure Node for the webhook trigger: path, URL, the new secret and the header to send.](workflows-ingest-panel.png)

**Expected result:** a **Workflow saved** message. The panel shows the full **URL** and the **Header** to send: `X-Webhook-Token: <your secret>`. Every API instance picks up the new secret at once. No restart is needed.

## Example 2: send one record

Send one patient from the docs sample. It is already in the sample data, with the same id, so it updates that patient and no count changes.

1. Download the sample file if you have not already. See [Load the sample data](/docs/dashboard#load-the-sample-data).
2. Take the first patient out of it into its own Bundle:

```bash
jq '{resourceType:"Bundle",type:"transaction",entry:[.entry[]|select(.resource.id=="sample-pat-0001")]}' \
  data/openldr-sample-lab-data.json > one-patient.json
```

3. Post it, with the secret you copied:

```bash
curl -X POST https://your-host/api/workflows/hooks/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: <your secret>" \
  -d @one-patient.json
```

**Expected result:** a reply like `{"ok":true,"runId":"...","correlationId":"..."}`. A wrong or missing secret returns `401`. A wrong path returns `404`.

Always post over HTTPS, so the secret is not sent in clear. Treat it like a password.

## Example 3: read the run

![Opening History and selecting the run.](workflows-history.mp4)

1. On the Ingest canvas, select **History**.
2. The **Runs** tab lists each run. Select the newest.

![One run: each node's type, status and time, and the data it passed on.](workflows-run-detail.png)

**Expected result:** **Completed**, started by **webhook**. Each node shows **success**, except **form-validate-1**, which shows **skipped**: a Bundle takes the FHIR branch, not the form branch. Select a node to see its **Output**, **Result** and **Logs** below.

The **Webhook receipts** tab lists every request the webhook accepted, with its status. See [Durable webhook requests](#durable-webhook-requests).

The same record now appears in [Activity](/docs/activity).

## Example 4: build a workflow

Build a workflow that counts the orders for each test in the warehouse.

![Making a new workflow: a Manual Trigger and a Postgres node, joined, configured, saved and run.](workflows-build.mp4)

1. In the workflow list, open the actions menu at the top right and select **New**.
2. Replace **Untitled Workflow** with `Orders by test`.
3. In the **Node library** on the left, open **Core** and drag **Manual Trigger** onto the canvas.
4. Open **Databases** and drag **Postgres** to the right of it.
5. Drag from the dot on the right of **Manual Trigger** to the dot on the left of **Postgres**. A line joins them.
6. Select **Postgres**, then its gear. Choose the connector **Target Warehouse (Postgres)**. In the SQL box, type:

```sql
SELECT panel_desc AS test, COUNT(*) AS orders
FROM lab_requests
GROUP BY panel_desc
ORDER BY orders DESC
```

7. Select **Save**.
8. Select **Run**. The bar at the bottom says **Waiting for trigger**. Select the play badge on **Manual Trigger** to start.

**Expected result:** the bottom bar shows **Completed** and **2 steps**. Open **Postgres**, then **Output**: five items, Full blood count 18 first.

![The Postgres node's output: one item per row.](workflows-build-output.png)

From Postgres, counts and averages arrive as numbers, for example `18`. From MySQL, a decimal such as an average still arrives as text, for example `"18.5"`. Convert it before a node does sums with it.

To finish this guide, delete the workflow: in the list, open its row menu and select **Delete**.

## The workflow list

- **New** and **Import** sit in the actions menu at the top right. **Import** reads a file made by **Export**.
- Each row has **Open**, **Duplicate**, **Export**, and either **Delete** or, for a system workflow, **Reset to default**.
- **Search workflows** filters by name.

## Move around the canvas

Use the controls at the bottom left of the canvas:

- **+** zooms in and **−** zooms out.
- **Fit View**, below them, brings every node into view.

The hand icon at the top left is **Pan** mode: drag an empty area to move the view. The pointer icon is **Select** mode: drag to select nodes in a box. In **Select** mode, the middle or right mouse button moves the view.

The minimap at the bottom right also pans and zooms. If you lose your nodes, use **Fit View** before moving any. These controls change the view, not the saved node positions.

The buttons at the top: **Clear** empties the canvas, **Datasets** lists saved datasets, **History** opens the runs, **Save** saves, **Run** arms a run.

## Values from the incoming item

Most text fields accept templates that read the current item: SQL, email To, Subject and Body, file names.

- `{{ $json.fieldName }}` is a field on the incoming item.
- In a SQL node: `... where registered >= '{{ $json.periodStart }}'`, where an earlier **Edit Fields** node set `periodStart`.

## Node reference

The **Node library** groups nodes by purpose: **Core**, **Communication**, **Developer Tools**, **Databases**, **Files & Storage** and **Data Transformation**. Type in **Search nodes** to find one.

### Triggers

- **Manual Trigger**, **Schedule**, **Webhook**, **On Data Ingest**. Start on demand, on a cron schedule, from an HTTP call, or when a batch is loaded.
- **Event Trigger**. Starts when a domain event fires, for example data persisted.
- **Postgres Trigger** and **Email Trigger**. Start on a Postgres `NOTIFY`, or when new email arrives through an IMAP connector.

### Bring data in

- **Postgres**, **MySQL**, **Microsoft SQL**. Run SQL through a database connector and emit one item per row. The connector sets the dialect. Use `{{ $json.x }}` to put values in. Keep queries as plain `SELECT`s and do the reshaping in nodes, so the same workflow works on another database.
- **SQL Query**. Runs one `SELECT` over the reporting schema, read-only, with the same timeout and row limit as dashboard SQL. It does not need **Dashboard raw SQL**.
- **Load Dataset**. Reads a dataset saved earlier.
- **HTTP Request** and **FHIR Query**. Fetch from an API or from the FHIR store.

### Reshape data

- **Edit Fields**. Adds or computes fields on each item, such as `periodStart` and `periodEnd`.
- **Pivot**. Turns long rows into wide columns. Choose the **group-by** keys, the **pivot column** whose values become column names, the **value column**, and a fixed list of output columns. Example: one antibiotic per row becomes one column per antibiotic. Clashes combine by `max`, `min`, `first` or `last`.
- **Merge**. Combines incoming branches. *Append* stacks them, *Combine* merges one object, *Choose Branch* picks one, and **Combine by key** joins two branches on shared fields, left or inner. The first branch wired in is the left side.
- **If**, **Switch**, **Filter**. Branch or drop items by a condition.
- **Aggregate**, **Summarize**, **Sort**, **Limit**, **Remove Duplicates**, **Rename Keys**, **Split Out**, **Date & Time**. Common table steps.
- **Unwrap FHIR Bundle**. One item per resource in a Bundle.

### Files and output

- **Excel Template**. Fills a branded `.xlsx` template with the rows and returns it as a file. Upload the template with the node's upload button, set the **Start cell** such as `A2`, the ordered **Columns**, an optional **Auto-filter header cell** such as `A1`, and an optional password. Values go in by position, like a hand-built report.
- **Export File**, **Spreadsheet File**, **Convert to File**. Plain CSV, XLSX or PDF from items, no template.
- **Materialize Dataset**. Saves the items as a named dataset.
- **Read/Write File**. File access on the server, inside a sandbox, when enabled.

### Communication

- **Send Email (SMTP)**, **Gmail**, **Outlook**. Send through an email connector. Set **To**, optional **Cc**, **Subject**, **Body**, **Body format**, and the **Attachment field**, for example the `file` field from an Excel Template node.

### Control flow

- **Wait**, **Execute Workflow**, **Loop Over Items**, **Stop and Error**, **No Operation**. Pause, call another workflow, repeat, or fail on purpose.

### Data capture

- **Form Validate**. Checks items against a form and turns them into FHIR resources.
- **Persist Store**. Saves FHIR resources and fires `data.persisted`.

## Scheduled reports

The most common lab use is "query a database on a schedule, fill a template, email it". It has its own guide: [Scheduled reports with workflows](/docs/report-pipeline).

## Webhooks across API instances

Save a path or secret change before sending requests with the new value. Every API instance reads the current path and secret from the shared database. No restart is needed. Requests authenticated before the save may finish.

Send the secret only in the `x-webhook-token` header.

| Reply | Meaning |
| --- | --- |
| 404 | Old path after a path change, or the workflow is disabled or deleted |
| 401 | Old or unreadable secret |
| 503 | Two enabled triggers share a path, so nothing runs. Also a database lookup failure. Instances never fall back to cached credentials. |

Each enabled trigger needs its own path, including triggers in the same workflow.

Stop every old API instance and old workflow writer before running migration 096 with `openldr db migrate`. Then start the upgraded instances. Old writers cannot keep the new path index. This upgrade needs downtime. Do not mix versions while accepting writes. All instances must use the same database and encryption key.

## Durable webhook requests

OpenLDR stores a receipt and a dispatch event in one database transaction before it accepts a webhook. If that cannot reach the database, the request fails without a receipt. An error or a lost connection does not prove nothing ran. Retry with the same idempotency key and input.

Send an optional `Idempotency-Key` header for each logical request. In one workflow, the same key and input reuse the first receipt. Different input with the same key returns 409. Input means body, query, forwarded headers and binary content. Authentication and transport headers do not count. Without a key, each POST is a new request, and retries can repeat their effects.

OpenLDR waits up to 10 seconds after accepting:

- Finished work returns 200 with the usual fields. A repeat of a finished request also returns 200, even with `Prefer: respond-async`.
- A recorded failure returns a plain 500 with `requestId`, without the raw error.
- Interrupted and cancelled receipts return 409.
- Queued or running work returns 202 with `accepted: true`, `requestId`, `status` and `statusUrl`. `Location` and `Retry-After` give the polling address and interval. 202 means accepted, not finished.
- `Prefer: respond-async` skips the wait. Disconnecting does not cancel accepted work.

### Sender example

A finished 200 reply can be `{"ok":true,"runId":"run-id","correlationId":"correlation-id"}`. Keys hold 1 to 200 printable ASCII characters, without spaces.

Send `POST /api/workflows/hooks/example` with the headers `x-webhook-token: CURRENT_SECRET`, `Idempotency-Key: sender-request-123` and `Prefer: respond-async`. Retry with the same key and input.

A pending 202 body:

```json
{"accepted":true,"requestId":"request-id","status":"queued","statusUrl":"/api/workflows/hooks/example?requestId=request-id"}
```

Poll it with `GET /api/workflows/hooks/example?requestId=request-id` and the current `x-webhook-token`. Respect `Retry-After`. Polling returns only `requestId`, `status` and `runId`, never payloads or raw errors. The request id alone grants no access. A replaced secret stops working at once. A renamed or deleted path can cut off the sender, but operators can still look up receipts by workflow and request id.

### Inspect and recover

The **Webhook receipts** tab in **History** shows queued, running, completed, failed, interrupted and cancelled requests. The API routes are `GET /api/workflows/:id/receipts?limit=25&offset=0` and `GET /api/workflows/:id/receipts/:requestId`.

```bash
openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
openldr workflows receipts show REQUEST_ID --json
```

Limits run from 1 to 100. Offsets start at zero. The CLI and API use the same receipt service. Neither replays a request.

Queued work can resume after a restart. A workflow disabled, deleted or changed before it runs cancels queued work. `interrupted` means the outcome is unknown. OpenLDR never replays started work by itself. Check that the first worker stopped, and put right any outside effects, before sending a request with a new key. Outside effects are not rolled back.

Receipts and idempotency records survive a workflow's deletion. Nothing expires or cleans them up, so storage grows. Migration 097 adds receipt storage. Upgrade the same way: stop old API instances and workflow writers, run `openldr db migrate`, then start the new ones. Whether the CDR client handles these replies has not been checked against its source.

## On a phone

The workflow list works on a phone. The canvas needs a computer: build and change workflows on a larger screen.

![The workflow list on a phone.](workflows-phone.png)

## Troubleshooting

- **The webhook replies 401.** The secret is wrong or old. A saved secret cannot be read, so replace it, copy the new one, and save. See [Example 1](#example-1-get-the-ingest-webhook-ready).
- **Save on Ingest seems to do nothing.** Look for the **Save changes to a system workflow?** prompt and select **Save anyway**.
- **A node cannot run.** Open it and fill every required field. A database or email node needs a connector.
- **A connector is missing from a node.** Check the connector exists, is enabled, and matches the node's type. See [Connectors](/docs/connectors).
- **Run does nothing.** **Run** only arms the workflow. Select the play badge on the trigger.
- **A dataset is empty.** Run the workflow that builds it before the one that reads it.
- **An email arrived without the attachment.** Set the Send Email node's **Attachment field** to the file field made earlier, usually `file`.
- **A run fails after a branch.** Check the branch condition, and the node just before the failure.
- **Form capture fails with "capture pipeline unavailable".** Ingest is disabled. The server turns it back on at start-up. If you disabled it on purpose, form capture cannot work.

## Tips

- Split heavy work into two workflows joined by a dataset. One saves the prepared data on a schedule. A lighter one loads it, formats it and sends it. The source query stays fast.
- Keep database queries as plain `SELECT`s. Do pivots and joins in the **Pivot** and **Merge** nodes, so a workflow built for one database runs on another by changing the connector.
- Read **History** before editing a failing workflow, so you know whether the problem is the data, the setup or the destination.

## Related guides

- [Activity](/docs/activity)
- [Scheduled reports with workflows](/docs/report-pipeline)
- [Connectors](/docs/connectors)
- [Reports](/docs/reports)
- [Audit](/docs/audit)
