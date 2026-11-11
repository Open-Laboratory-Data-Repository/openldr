# Audit

**Audit** records who changed what, and when: workflows, forms, users, roles, reports, connectors, settings, patients viewed, and more. Each event has an actor, an action, the thing it touched, and often a copy of that thing before and after.

Sign-ins and sign-outs are handled by Keycloak, not OpenLDR, which never sees the password. Find them in the Keycloak admin console under **Realm**, **Events**. This log records failed authentications (`auth.failed`) and every operator action, including command-line actions, shown with the actor type `cli`.

This guide takes about 10 minutes. Select any picture or clip to enlarge it.

![Audit: the newest events first, with when, actor, action, entity type and entity ID.](audit-tour.png)

## Who can do what

One permission covers this page: **View audit log**. It is read-only. Nothing here can change or delete an event.

## Before you start

The example finds the changes made to the **Ingest** workflow. If you followed [Workflows, Example 1](/docs/workflows#example-1-get-the-ingest-webhook-ready), there is at least one. Otherwise, pick any event you see.

## Example 1: who changed the Ingest workflow?

![Filtering on Entity ID wf-ingest and opening the newest event.](audit-filter-workflow.mp4)

1. Open **Audit**. The newest events are at the top.
2. Select **Filter**, then **Add filter**.
3. Set the column to **Entity ID**, the operator to **Contains**, and the value to `wf-ingest`.
4. Select **Apply**. A chip under the toolbar shows the filter.
5. Select the newest row.

**Expected result:** one `workflow.update` event for each time Ingest was saved, by the person who saved it. The event sheet shows the event id, time, actor, action, entity type `workflow` and entity id `wf-ingest`, then **Before**: the workflow as it was.

![One event: who, what, when, and the workflow before the change.](audit-event.png)

Each value has a copy button, so you can paste an id into another filter or another screen.

## Filter, sort and columns

- **Filter** adds rules: a column, an operator and a value. Text columns offer **Equals**, **Not equals**, **Contains** and more. **When** offers dates and ranges.
- Each rule shows as a chip under the toolbar. Remove a chip to drop one rule, or use **Clear all**.
- **Sort** orders by any column, up or down.
- **Columns** hides and shows columns. **Reset** puts the table back to its defaults.
- Filtering, sorting and paging run on the server, so a large log stays fast.

To follow a chain of changes, start with the entity, add the actor, then compare times across create, update, run, publish and delete events.

## Actions worth knowing

| Action | What happened |
| --- | --- |
| `workflow.create`, `workflow.update`, `workflow.delete` | A workflow was made, saved or deleted |
| `dashboard.create`, `dashboard.update`, `dashboard.delete` | A dashboard was made, saved or deleted |
| `customQuery.create`, `customQuery.delete` | A saved query was made or deleted |
| `role.create`, `role.delete`, `role.capability.backfill` | A role was made or deleted, or gained a new capability on upgrade |
| `settings.flag.update` | A setting such as **Dashboard raw SQL** was switched |
| `patients.list`, `patients.view` | Someone listed or opened patients |
| `user.status`, `user.status.failed` | An account was enabled or disabled, or the attempt failed |
| `auth.failed` | A sign-in token was refused |

## From the command line

`openldr audit list` takes the same filters and sorting as the page, so a script can repeat any view.

- `--where column:operator:value` can be repeated. Only the first two colons split the value, so a value can hold a colon, such as an id or a URL.
- `--sort column` sorts up, `--sort -column` sorts down. It can be repeated.
- On the time column, `eq` with a bare date such as `2026-08-06` matches the whole day. `between` with two bare dates includes all of the end day.

The same search as Example 1:

```bash
./openldr audit list --where entityId:like:wf-ingest --sort -occurredAt
```

All form events, newest first:

```bash
./openldr audit list --where action:like:form. --sort -occurredAt
```

An unknown column, or an operator that column does not allow, is refused with a message naming the problem. It is the same check the page uses.

## Troubleshooting

- **No events appear.** Widen the time range, or clear one filter at a time.
- **The actor is unexpected.** A scheduled workflow or a system action may have made the change.
- **Before and after are empty.** Some events record the action without a full copy.
- **Too many events.** Combine an entity filter with an actor filter.
- **I cannot find a sign-in.** Successful sign-ins are in Keycloak's events, not here.

## Related guides

- [Users and Roles](/docs/users)
- [Workflows](/docs/workflows)
- [Activity](/docs/activity)
