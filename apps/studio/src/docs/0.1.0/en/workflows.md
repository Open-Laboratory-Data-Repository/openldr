# Workflows

Workflows let Lab Admins and Lab Managers design repeatable web-based data processes in a visual builder. Use them to pull data from a database, reshape it, publish datasets, fill spreadsheet templates, and email results — **without writing a standalone program**.

## Outcome

You can find a workflow, create one, add and connect nodes, configure them, save, run, inspect node states, and review run history — and you know what each node in the palette does.

![Workflow list with search and row actions](workflows-list.png)

## Before you begin

- You need the Lab Admin or Lab Manager role.
- Know the source, the transformation goal, and the output destination before building.
- Create or confirm any connector you plan to use from [Connectors](/docs/connectors) — database and email nodes reference a connector, so make it first.

## Core concepts

- **Nodes and edges.** A workflow is a graph. Each **node** does one step; you connect nodes by dragging from one node's handle to the next. Data flows along the edges as a list of **items** (each item is a record with a `json` object and optional attached files).
- **Triggers.** Every workflow starts with a trigger node (manual, schedule, webhook, ingest, or a listener). The trigger emits the first item.
- **The side panel.** Select a node to configure it. Required fields must be filled before the node can run.
- **Datasets.** A workflow can *materialize* its result as a named dataset that other workflows (and dashboards/reports) can read later. This is how a heavy “build the data” workflow hands off to a lighter “deliver the data” workflow.

## Steps

1. Open **Workflows** and choose the action for a new workflow (or open an existing one).
2. Name the workflow and open the builder. Use [Navigate the canvas](#navigate-the-canvas) below if nodes are outside the visible area.
3. Add a **trigger** node that matches the job: manual, schedule, webhook, or ingest.
4. Add nodes from the palette and **connect** them in execution order.
5. Select each node and complete its configuration in the side panel.
6. Select **Save**.
7. **Run** manually for an immediate test, and watch node states.

![Workflow builder with nodes, canvas, configuration, and run controls](workflow-builder.png)

8. Open **run history** to compare status, duration, and node-level results.

![Workflow run history with node results](workflow-run-history.png)

## Navigate the canvas

Use the controls at the bottom left of the canvas:

- Select **+** to zoom in or **−** to zoom out.
- Select **Fit View**, below the zoom buttons, to bring all nodes into view.

Select the hand icon at the top left for **Pan** mode. Drag an empty area
of the canvas to move the view. In **Select** mode, the pointer icon,
left-drag selects nodes in a box. Use the middle or right mouse button
to drag the view in that mode.

The minimap at the bottom right also supports panning and zooming.
If you lose sight of your nodes, use **Fit View** before moving any nodes.
These controls change the view, not the saved node positions.

## Templating values

Most text fields (SQL, email To/Subject/Body, file names) accept **templates** that pull from the current item:

- `{{ $json.fieldName }}` — a field on the incoming item.
- Example in a SQL node: `... where registered >= '{{ $json.periodStart }}'`, where an upstream **Edit Fields** node set `periodStart`.

## Node reference

The palette is grouped by purpose. The most useful nodes for lab data work:

### Triggers

- **Manual / Schedule / Webhook / Ingest** — start a run on demand, on a cron schedule, from an HTTP call, or from an ingest event.
- **Postgres Trigger / Email Trigger** — start a run when a Postgres `NOTIFY` fires or when new email arrives (IMAP connector).

### Sources (bring data in)

- **Postgres / MySQL / Microsoft SQL** — run a SQL query against a **database connector** and emit one item per row. The connector sets the dialect. Enter the query in the built-in SQL editor (syntax highlighting), and use `{{ $json.x }}` to inject values. *Keep queries as plain, portable `SELECT`s and do the reshaping in nodes (below) so the same workflow works across databases.*
- **Load Dataset** — read a previously materialized dataset by name (the other half of a two-workflow report).
- **HTTP Request / FHIR Query** — fetch from an API or the FHIR store.

### Transforms (reshape data)

- **Edit Fields (Set)** — add or compute fields on each item (e.g. `periodStart` / `periodEnd` date bounds). Values support templates.
- **Pivot** — turn *long* rows into *wide* columns. Choose the **group‑by** keys, the **pivot column** (whose values become column names), the **value column**, and a **fixed list of output columns**. Example: antibiotic-per-row → one column per antibiotic. Collisions combine by `max`/`min`/`first`/`last`.
- **Merge** — combine multiple incoming branches. Modes: *Append* (stack), *Combine* (shallow-merge one object), *Choose Branch*, and **Combine by key (join)** — a SQL-style join of two branches on shared key fields (left/inner). The **first** branch wired into the node is the left side.
- **Filter / If / Switch** — branch by condition.
- **Aggregate / Summarize / Sort / Limit / Remove Duplicates / Rename Keys / Split Out / Date/Time** — common table operations.

### Files and output

- **Excel Template** — fill a branded `.xlsx` **template** with the incoming rows and return it as a file. **Upload the template** with the node's *Upload template* button (the artifact key fills in automatically), set the **Start cell** (e.g. `A2`), the **ordered Columns** (which item field goes in each column), an optional **Auto-filter header cell** (e.g. `A1`), and an optional **password** (resolved from a connector/secret) to protect the output. Values are written by position, exactly like a hand-built report.
- **Spreadsheet File / Convert to File / Export File** — generate plain CSV/XLSX/PDF from items (no template).
- **Materialize Dataset** — save the current items as a named dataset for later reuse.
- **Read/Write File** — sandboxed host-disk file operations (when enabled).

### Communication

- **Send Email (SMTP) / Gmail / Outlook** — send a message through an **email connector**. Set the connector, **To** (and optional **Cc**), **Subject**, **Body**, **Body format** (plain/HTML), and the **Attachment field** — set to the binary field produced upstream (e.g. the Excel Template output, field `file`) to attach the report.

### Control flow

- **Wait / Execute Workflow / Loop / Stop and Error** — pause, call another workflow, iterate, or fail deliberately.

## Building scheduled reports

The most common lab use — “query a database on a schedule, fill a template, email it” — has its own step-by-step walkthrough (including the AMR example): see **[Scheduled reports with workflows](/docs/report-pipeline)**.

## Expected result

The workflow saves, a manual run completes or reports a clear failure, and run history shows inputs, duration, status, and node outcomes for review.

## Troubleshooting

- **A node cannot run:** select it and complete every required field (a database/email node needs a **connector** selected).
- **A connector option is missing:** confirm the connector exists, is enabled, and matches the node's type (see [Connectors](/docs/connectors)).
- **A materialized dataset is empty:** run the workflow that *builds* it before the one that *reads* it, and check the source and transform nodes.
- **The email sent but has no attachment:** set the Send Email node's **Attachment field** to the binary field produced upstream (usually `file`).
- **A run fails after a branch:** inspect the branch condition and the node immediately before the failure.

## Advanced web usage

- Split heavy work into two workflows joined by a dataset: one **materializes** the optimized data on a schedule; a lighter one **loads** it, formats, and delivers. This keeps the source query fast and portable.
- Keep database queries as plain `SELECT`s and move pivots/joins into the **Pivot** and **Merge (combine by key)** nodes, so a workflow built for one database runs on another by swapping the connector.
- Investigate failures from run history before editing, so you know whether the issue is data, configuration, or destination availability.

## Related guides

- [Scheduled reports with workflows](/docs/report-pipeline)
- [Connectors](/docs/connectors)
- [Reports](/docs/reports)
- [Audit](/docs/audit)


## Webhooks across API instances

Save a webhook path or secret change before sending requests with the new value. Every upgraded API instance reads the current path and secret from the shared database. No restart is needed after a workflow save. Requests authenticated before the save may finish.

Send the secret only in the `x-webhook-token` header. The old path returns 404 after a path change. An old or unreadable secret returns 401. Disabled or deleted workflows return 404. Each enabled trigger needs a unique path, including triggers within the same workflow. Conflicting paths return 503 and execute nothing. Database lookup failures also return 503; instances never use cached credentials as a fallback.

Stop every old API instance and any old workflow writers before running migration 096 with `openldr db migrate`. Then start the upgraded instances. Old writers cannot maintain the new path index. This deployment requires downtime; do not mix versions while accepting writes. All instances must use the same database and encryption key.

## Durable webhook requests

OpenLDR stores a receipt and dispatch event in one database transaction before accepting a webhook. If acceptance cannot reach the database, the request fails without an accepted receipt. An error or lost connection does not prove nothing ran. Retry with the same idempotency key and input.

Send an optional `Idempotency-Key` header for each logical request. Within one workflow, the same key and execution input reuse the original receipt. Different input with the same key returns 409. Input includes body, query, forwarded headers and binary content. Authentication and transport headers do not define identity. Without a key, each POST creates a new request and retries can duplicate effects.

OpenLDR waits up to 10 seconds after acceptance. Completed work preserves existing 200 response fields. A duplicate completed request returns 200 even with `Prefer: respond-async`. Recorded execution failure returns generic 500 with `requestId`, without raw error details. Interrupted and cancelled receipts return 409. Queued or running work returns 202 with `accepted: true`, `requestId`, `status` and `statusUrl`. `Location` and `Retry-After` supply the polling address and interval. A 202 means accepted, not completed. `Prefer: respond-async` skips waiting. Disconnecting does not cancel accepted work.

### Sender example

A completed 200 response can be `{"ok":true,"runId":"run-id","correlationId":"correlation-id"}`. Keys must contain 1 to 200 printable ASCII characters without spaces.

Send `POST /api/workflows/hooks/example` with headers `x-webhook-token: CURRENT_SECRET`, `Idempotency-Key: sender-request-123` and `Prefer: respond-async`. Send the same key and input if retrying that request.

An example pending 202 body is:

```json
{"accepted":true,"requestId":"request-id","status":"queued","statusUrl":"/api/workflows/hooks/example?requestId=request-id"}
```

Poll the returned URL using `GET /api/workflows/hooks/example?requestId=request-id` and the current `x-webhook-token`. Respect `Retry-After`. Polling returns only `requestId`, `status` and `runId`. Polling omits payloads and raw errors. The request ID alone grants no access. Rotated tokens stop authorizing old secrets. Renamed or deleted paths may remove sender access; operators can still inspect receipts by workflow and request ID.

### Operator inspection and recovery

The Webhook receipts tab in workflow history shows queued, running, completed, failed, interrupted and cancelled requests. Operator routes are `GET /api/workflows/:id/receipts?limit=25&offset=0` and `GET /api/workflows/:id/receipts/:requestId`.

```sh
openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
openldr workflows receipts show REQUEST_ID --json
```

Limits range from 1 to 100; offsets start at zero. CLI and API use the same receipt service. Neither offers replay.

Queued work can resume after restart. A workflow disabled, deleted or changed before execution cancels queued work. An `interrupted` receipt means the outcome is uncertain. OpenLDR never automatically replays started work. Confirm the original worker stopped and reconcile external effects before submitting a new identity. External effects have no automatic rollback. Receipt and idempotency records survive workflow deletion. No automatic expiry or retention cleanup exists, so storage grows.

Migration 097 adds receipt storage. Deployment still follows P14: stop old API instances and workflow writers, run `openldr db migrate`, then start upgraded instances. Do not mix writers across versions. Actual CDR client compatibility remains unproven because its source was not verified.
