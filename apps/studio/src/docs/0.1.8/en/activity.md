# Activity

Use Activity to check whether a recent payload arrived and what OpenLDR recorded afterward. A payload is one batch of data, such as one webhook request or one CLI ingestion batch.

Use your own recent payloads. No sample data is required. The pictures follow the fictional patient sent in the Workflows test installation. An empty installation can have no recent payloads.

You need **View activity**. This page reads recorded events. It does not change, retry or delete the underlying data. [Audit](/docs/audit) records user and administrative changes.

## Follow one payload

Use this when a sender asks whether its data arrived. Keep its response identifier or sending time nearby.

### 1. Open Activity

Select **Activity** in the main menu.

![Open Activity to follow recent payloads.](activity-guide-open-page.png)

### 2. Find the payload

Enter its identifier in **Search payloads...**. Search also matches source, status or stage within the loaded list.

![Search the payload identifier to find this request.](activity-guide-search.png)

### 3. Check the matching row

Match the source and start time. Read the current stage and status. This example reached Persisted and Complete.

![Match the source, start time, current stage and status.](activity-guide-matching-row.png)

### 4. Open the lifecycle

Select the row to open **Payload lifecycle**.

![Select the payload row to inspect its recorded lifecycle.](activity-guide-open-row.png)

### 5. Keep the identifier

Copy the payload identifier shown below the sheet title when reporting a problem.

![Keep the payload identifier when asking an administrator for help.](activity-guide-payload-id.png)

### 6. Read Received

Read the arrival timestamp, source detail and associated run identifier. Use the run identifier when checking Workflows history.

![Received records arrival and its workflow run identifier.](activity-guide-received.png)

### 7. Read Persisted

Read the recorded storage event and resource counts. The example stored one Patient. Other workflows can record different stages.

![Persisted records the stored resource count.](activity-guide-persisted.png)

### 8. Return to the list

Select **Close** at the top right.

![Close the lifecycle sheet to return to the list.](activity-guide-close.png)

**Expected result:** You can identify the payload and the stages actually recorded for it.

## Fetch the latest recorded state

Use Refresh after new data arrives. Close and reopen a lifecycle sheet to fetch its current details.

### 1. Open Activity actions

Select the dots labelled **Activity actions**.

![Activity actions contains Refresh.](activity-guide-actions.png)

### 2. Choose Refresh

Select **Refresh**. Reopen the payload row when you need refreshed lifecycle details.

![Refresh fetches the recent list again.](activity-guide-refresh.png)

**Expected result:** The recent payload list reloads.

## Show complete payloads

Use Status filters when reviewing one outcome. Filters apply to the loaded recent payloads.

### 1. Open Filter

Select **Filter**.

![Filter narrows the loaded recent payloads.](activity-guide-filter.png)

### 2. Add a rule

Select **Add filter**.

![Add filter creates a rule.](activity-guide-add-filter.png)

### 3. Choose Status

Open the column selector and choose **Status**. Keep **Equals**.

![Choose Status as the column and keep Equals.](activity-guide-status-rule.png)

### 4. Choose Complete

Open the value selector and choose **Complete**. Choose a different status when investigating that outcome.

![Choose Complete to inspect stored payloads without a failed workflow run.](activity-guide-complete-value.png)

### 5. Apply the rule

Select **Apply**. The rule appears above the table.

![Apply updates the visible rows.](activity-guide-apply-filter.png)

**Expected result:** The visible rows match the Status rule.

![The applied Status filter appears above the matching rows.](activity-guide-filtered.png)

## Put latest start times first

Use a time sort when arrival order matters. It changes the loaded list only.

### 1. Add a sort

Select **Sort**, then **Add sort**.

![Add sort creates a sort rule.](activity-guide-add-sort.png)

### 2. Choose Started

Select **Started** from the available columns.

![Choose Started to sort by arrival time.](activity-guide-sort-started.png)

### 3. Choose descending order

Select **Asc** once to change it to **Desc**.

![Toggle Asc to Desc to show the latest start times first.](activity-guide-sort-direction.png)

### 4. Apply the sort

Select **Apply**. Latest start times appear first.

![Apply stores the chosen sort for the loaded rows.](activity-guide-apply-sort.png)

## Choose visible columns

Use this when the table is wider than the information you need.

### 1. Open Columns

Select **Columns**.

![Columns controls the visible table columns.](activity-guide-columns.png)

### 2. Choose the fields

Use the column checkboxes to show or hide fields. Keep Payload visible so you can identify rows. Close the menu when finished.

![Keep the fields you need for the review.](activity-guide-column-options.png)

### 3. Use the table pages

Use the page size and navigation arrows below the table when the loaded list spans several pages.

![Use the page size and arrows when there are several pages.](activity-guide-pagination.png)

## Read a payload on a phone

Search first to reduce a wide table. Scroll the table horizontally when you need columns farther right.

### 1. Search recent payloads

Use the search field at the top of Activity.

![Search recent payloads on a phone.](activity-guide-phone-search.png)

### 2. Open the payload

Select its identifier in the row.

![Select the identifier to open the payload lifecycle.](activity-guide-phone-open.png)

### 3. Read the lifecycle

Scroll the sheet to read the recorded stages and resource counts.

![Read each recorded stage in the phone sheet.](activity-guide-phone-detail.png)

## Read stages and statuses

The stage bar highlights stages up to the latest recorded stage. Read the lifecycle itself to see which events actually exist. A missing Validated stage does not prove that every earlier check failed.

A recorded push does not prove the recipient accepted or read the data. Stuck is not proof that processing stopped. Check the workflow History and its node results.

| Stage | Meaning |
| --- | --- |
| Received | An ingestion batch or workflow recorded arrival. |
| Validated | A workflow recorded a successful check. |
| Persisted | A storage event recorded saved resources. |
| Pushed | A step recorded delivery to another system. |

| Status | Meaning |
| --- | --- |
| Complete | Data reached storage without a recorded failed workflow run. |
| Failed | A related workflow run or ingestion batch failed. |
| Stuck | The recorded events do not establish completion or failure. |
| Running | An import run or CLI batch is still active. |
| Stopped | An import run or CLI batch was stopped. |

## Understand the history window

Activity loads up to 200 recent payloads. Search, filters, sorting and paging act on those loaded rows. They do not search the full database.

CLI batch history also has its own limit. For older ingestion batches, use `openldr pipeline status`. Read [Start here](/docs/start-here) for the installed launcher or the development form `pnpm openldr pipeline status`. Use your real installation folder, such as `~/Downloads/openldr_ce` or `C:\openldr_ce`.

## Optional fictional practice

You can follow any received payload without creating more data. For test practice, use the optional fictional Bundle in [Workflows](/docs/workflows#optional-fictional-practice-files). Complete its webhook steps, then match the returned correlation identifier here. No sample is required in normal use.

## Troubleshooting

**The list is empty.** Clear search and filters, then Refresh. Check sender responses and Workflows History before deciding nothing arrived. Older events can be outside the recent window.

**A row is Failed.** Open the workflow History and inspect the failing node. Activity has no retry action. Reconcile effects before following the workflow recovery procedure.

**The sheet stays on Loading.** Close it, Refresh, and reopen the row. If it persists, ask an administrator to check the API request and server logs. This sheet cannot distinguish every failed request from a slow one.

**Refresh shows an error.** Try once again. Report the exact error if it persists.

## Related guides

[Workflows](/docs/workflows) explains runs and webhook receipts. [Audit](/docs/audit) explains administrative change records.
