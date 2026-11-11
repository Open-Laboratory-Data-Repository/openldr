# Activity

**Activity** follows each payload as it moves through OpenLDR: received, checked, stored, sent on. A payload is one batch of data, such as one HTTP post to a webhook. Use it to answer "did that data arrive, and was it stored?".

It is not [Audit](/docs/audit). Audit records what people changed. Activity records what happened to data.

This guide takes about 10 minutes. Select any picture or clip to enlarge it.

![Activity after three posts to the Ingest webhook. Each one reached Persisted and is Complete.](activity-list.png)

## Who can do what

One permission covers this page: **View activity**. It is read-only. Nothing here changes or re-runs data.

## Before you start

A new install shows **No recent payloads.** Activity lists payloads that went through a workflow. The sample data loaded with `openldr ingest` does not, so it is not listed here.

To see a payload, send one through the Ingest webhook. See [Workflows, Example 1 and 2](/docs/workflows#example-1-get-the-ingest-webhook-ready). It takes about five minutes and changes no counts.

## Example 1: follow one payload

![Selecting a payload to open its lifecycle.](activity-detail.mp4)

1. Open **Activity**. The newest payloads are at the top.
2. Find your payload. **Source** is **webhook**. **Stage** reads **Persisted**. **Status** reads **Complete**.
3. Select the row. **Payload lifecycle** opens on the right.

**Expected result:** two stages. **Received**, from the webhook, with the run id. Then **Persisted**, with **1 × Patient**: the one resource stored.

Keep the payload identifier, the long id at the top, if you ask an administrator to look into it.

To see the latest payloads, open the dots menu at the top right and select **Refresh**. Open a row again to fetch its latest details.

## Read stages and status

| Stage | What it means |
| --- | --- |
| Received | A batch or workflow run recorded that the data arrived. |
| Validated | A workflow step checked the data and it passed. |
| Persisted | The data was stored. The detail says how many of each resource. |
| Pushed | A workflow step sent the data on, for example to another system. |

The detail lists the stages that were recorded. Not every workflow records all four. The stage bar in the list is a summary, not proof of each earlier stage. A recorded push does not prove anyone checked the data at the other end.

| Status | What it means |
| --- | --- |
| Complete | The data was stored, and no workflow run for it failed. It does not need a Pushed stage. |
| Failed | A workflow run for it failed. Open the workflow's **History**. |
| Stuck | Neither of the above can be shown. Check the workflow's **History** before deciding that processing stopped. |

## Find a payload

- **Search payloads…** matches the payload id, source, status or stage.
- **Filter**, **Sort** and **Columns** work as on any table.
- The page loads the 200 newest payloads. Search, filters, sorting and paging work on those 200 only. They do not search older history.

## Troubleshooting

- **The list is empty.** That does not prove nothing arrived. Clear search and filters, select **Refresh**, and check the workflow's **History**. Data loaded with `openldr ingest` is not listed. A payload with no workflow history may be missing too.
- **A loading error appears.** Select **Refresh** again. If it stays, report the error to an administrator.
- **The lifecycle panel stays on Loading.** Close it, select **Refresh**, and open the row again. The page cannot always tell a failed request from a slow one.
- **A payload is Failed.** Open the workflow it went through, then **History**, and read the failed node's error. This page has no retry. Follow the workflow's own recovery steps.

## How queued events are handled

These notes are for administrators.

- Each event bus instance runs one event handler at a time. A slow handler delays later events. More queue notifications do not start more handlers while a batch runs. Pending events wait for a later batch. Separate server processes can still handle events at the same time.
- The worker renews leases for running events and for events waiting in its claimed batch. A replacement worker gets a new claim token. An older worker cannot then mark that claim complete, failed or retried.
- After a crash, an expired claim counts as a failed attempt and can be retried. Handlers must cope with being run twice: a database outage or a paused process can let another worker run the same event.
- Stop old workers before upgrading. Workers without claim-token checks cannot give this protection.

## Related guides

- [Workflows](/docs/workflows)
- [Audit](/docs/audit)
