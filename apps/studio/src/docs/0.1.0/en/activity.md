# Activity

Activity groups workflow records by payload identifier so you can inspect the recorded processing stages. It is separate from [Audit](/docs/audit), which records user and configuration changes.

## Inspect a payload

1. Open **Activity** from the main navigation. Your account needs permission to view Activity.
2. Search using the payload identifier, source, status, or current stage. Use the table filters to narrow the loaded rows.
3. Select a row to open its lifecycle details. Read each recorded stage, timestamp, and available detail. Keep the payload identifier when asking an administrator to investigate.
4. Close the details, then choose **⋯ → Refresh** to reload the list. Reopen the row to fetch updated details.
5. If the payload failed or seems incomplete, inspect the associated workflow's run history in [Workflows](/docs/workflows).

## Read stages and status

| Stage | What the recorded stage means |
| --- | --- |
| Received | An ingestion batch or workflow run records receipt. |
| Validated | A workflow result contains a successful validation step. |
| Persisted | A persistence event records stored resources. |
| Pushed | A workflow result contains a successful sink or push step. |

The detail list shows recorded stages; do not assume all four are required for every workflow. The row's stage indicator is a summary, not proof of each earlier stage. A recorded push step does not prove that someone reviewed the data at its destination.

**Complete** means a persistence event exists and no associated workflow run is marked failed. It does not require a Pushed stage. **Failed** means an associated workflow run failed. **Stuck** means no persistence event or failed run establishes either of those states; inspect workflow history before concluding that processing stopped.

## Empty results and limits

The page loads the 200 most recent payload groups. Search, filters, sorting, and table pagination operate on that loaded set. They do not search all historical payloads.

An empty list is not proof that no data was received. Clear search and filters, refresh, and inspect Workflows for relevant runs. A payload with no corresponding workflow history may be absent from this list. If a loading error appears, retry Refresh and report the error to an administrator if it persists.

If lifecycle details remain on Loading, close them, refresh the list, and reopen the row. The page may not distinguish a failed detail request from a pending one. This page has no retry-processing action; use the workflow's documented recovery procedure.

## Waiting for queued events

Each event bus instance processes one event handler at a time. A slow handler can delay later events. Repeated queue notifications do not start additional handlers while its current batch runs. Pending events remain queued for a later batch. Separate server processes can still handle events concurrently.

## Related guides

- [Workflows](/docs/workflows)
- [Audit](/docs/audit)
