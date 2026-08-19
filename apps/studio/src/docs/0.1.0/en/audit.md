# Audit

Audit helps administrators and managers trace user-visible changes across workflows, forms, users, reports, connectors, and settings.

> **Sign-in history:** Successful logins and logouts are handled by Keycloak, not OpenLDR — the app never sees the password. Find them in the Keycloak admin console under **Realm → Events**. This log records failed authentications (`auth.failed`) and operator actions — including CLI actions, shown with the `cli` actor type.

## Outcome

You can open Audit, apply filters, inspect an event, interpret actor/action/entity/time fields, copy identifiers, and trace a change across related events.

![Audit table with filters and timestamp column](audit-filter.png)

## Before you begin

- Know the approximate time, actor, entity, or action you want to investigate.
- Use narrow filters first when the event volume is high.

## Steps

1. Open **Audit**.
2. Use the toolbar's **Filter** button to add a rule: pick a column, an operator, and a value.
3. Use **Sort** to order the table by any sortable column, ascending or descending.
4. Use **Columns** to show or hide columns; use **Reset** to return the table to its defaults.
5. Active filters appear as removable chips below the toolbar — remove one without opening the filter popover again.
6. Filtering, sorting, and paging all run on the server, so large audit logs stay fast.
7. Select an event row such as a workflow or form update.
8. Review actor, action, entity, and time.
9. Copy identifiers when you need to compare with another screen.
10. Inspect before/after details when they are available.
11. Follow related events by reusing the actor, entity, or identifier as another filter.

![Audit event detail with actor, entity, and before/after data](audit-event-detail.png)

## Expected result

You can explain who changed what, when it happened, which entity was affected, and what adjacent events may be part of the same activity.

## Troubleshooting

- **No events appear:** widen the time range or clear one filter at a time.
- **The actor is unexpected:** check whether a scheduled workflow or system action performed the change.
- **Before/after details are empty:** some events record the action without a full object snapshot.
- **Too many related events:** combine entity and actor filters to narrow the sequence.

## Advanced web usage

Combine filters to follow multi-step activity: start with the entity, add the actor, then compare timestamps across update, run, publish, or delete events.

## Command line

`openldr audit list` supports the same filter and sort grammar as the web toolbar, so a script can reproduce any view built in the browser.

- `--where column:operator:value` — repeatable. Only the first two colons are delimiters, so a value may itself contain a colon (an entity ID or a URL, for example).
- `--sort column` — ascending. `--sort -column` — descending (leading `-`). Repeatable.

```bash
openldr audit list --where action:like:form. --sort -occurredAt
```

This lists audit events whose `action` contains `form.`, newest first.

An unknown column or an operator that column does not allow is rejected with a message naming what was wrong — the same validation the web toolbar uses, so a mistyped flag fails the same way a mistyped filter would in the browser.

## Related guides

- [Users and Roles](/docs/users)
- [Workflows](/docs/workflows)
