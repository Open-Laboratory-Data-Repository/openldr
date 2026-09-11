# Dashboard

Dashboards turn warehouse data into shared operational views. Use them to monitor key metrics, compare trends, and publish workflow-created datasets to users who do not need to build queries themselves.

## Outcome

You can open a dashboard, read existing widgets, enter edit mode, add a widget, choose between Builder and SQL mode, and save the layout for other users.

![Dashboard overview with shared widgets](dashboard-overview.png)

## Before you begin

- You can view dashboards with a normal signed-in account.
- You need dashboard editing permission to see **Edit**, **Add widget**, and **Save**.
- SQL mode may be hidden if the administrator has limited dashboards to Builder mode.

## Steps

1. Open **Dashboard** from the main navigation.
2. Use the dashboard selector, if present, to choose the dashboard you want to read.
3. Review each widget title, filter state, chart, table, or KPI card.
4. Open **Dashboard menu**.
5. Select **Edit**.
6. Open **Dashboard menu** again and select **Add widget**.
7. In the widget editor, enter a clear title and choose **Builder** for guided configuration or **SQL** for an advanced read-only query.
8. Use **Editor menu** to review widget actions, preview data, or adjust editor options.
9. Select **Save** to keep the widget.
10. Select **Done** to leave edit mode.

![Widget editor opened from dashboard edit mode](dashboard-edit-widget.png)

## Expected result

The dashboard reloads with the saved widget in place. Other users who can view the dashboard see the updated layout and widget output.

## Automatic refresh

Each widget loads immediately. With automatic refresh enabled, the interval starts after its request finishes. A slow request delays the next refresh instead of starting another request for that widget. An interval of zero disables automatic refresh.

Changing the query or dashboard filters cancels the obsolete browser request. Leaving the dashboard also cancels its pending requests. Late results and errors cannot replace newer results. A successful refresh clears the previous error.

Cancelling a browser request does not guarantee that the database query stops.

## Troubleshooting

- **No dashboard appears:** you may not have access to a shared dashboard yet, or no dashboard has been created.
- **A widget is empty:** check its filters and date range first; then open edit mode and confirm the source query returns rows.
- **SQL mode is missing:** SQL widgets are an advanced option and may be disabled for this deployment or unavailable for the connected warehouse.
- **The query shows an error:** switch back to Builder mode if possible, or simplify the SQL query to a read-only `SELECT` that returns a small result.
- **A widget ignores a dashboard filter:** open the widget editor and look at the variable chips above the query. A red chip means that variable cannot resolve, either because its type no longer matches the filter it is bound to, or because a date range is written as a single `{{name}}` instead of `{{name_from}}` and `{{name_to}}`. Open **Variables** for the full message.

## Advanced web usage

- **Dashboard variables:** create text, number, date, or date-range variables so users can change filters without editing widgets.
- **Naming a variable in SQL:** a filter whose Variable ID is `ward` is written `{{ward}}`. A date-range filter splits in two, so `period` is written `{{period_from}}` and `{{period_to}}`, and `{{period}}` on its own never resolves. The filter editor shows the exact tokens next to each filter, and the widget SQL editor lists the ones the query has not used yet.
- **Leaving a variable blank:** an unset variable becomes `NULL`. To drop the whole condition instead, wrap it in double square brackets: `[[AND ward = {{ward}}]]` disappears when no ward is chosen.
- **Binding a widget variable to a dashboard filter:** open **Variables** in the widget editor and pick a filter under **Dashboard Filter**. Only filters of the same type are listed, because a date range and a single value never line up. A saved binding whose type no longer matches stays in the list and is marked, so you can see it and correct it rather than lose it.
- **Builder versus SQL mode:** use Builder for portable dashboards and SQL only when the exact warehouse shape matters.
- **Workflow-published datasets:** workflows can publish curated datasets that appear as dashboard sources, making complex transformations available through normal dashboard widgets.

## Related guides

- [Reports](/docs/reports)
- [Workflows](/docs/workflows)

## Create another dashboard

Open the dots menu beside the dashboard selector and choose **New dashboard**.
This action is available in view and edit modes. Wait for unsaved edits to finish saving first.
The action is disabled while creation is pending, so repeated clicks cannot create duplicates.

The new blank dashboard opens in edit mode. A confirmation names the created dashboard.
Open the dots menu and select **Add widget** to start adding content.
If creation fails, the current dashboard remains selected. Read the error and retry from the menu.

If you edit while creation is pending, those edits stay open. Save them, then select the new dashboard.

Widget and filter editing is unavailable while creation is pending.

## Builder query limits

Builder widgets use the dashboard SQL timeout and row cap settings. Defaults are 5,000 milliseconds and 10,000 groups. Administrators can change these existing settings.

The cap counts database groups before date bucketing, breakdown totals, and top-N selection. If the query exceeds it, the widget returns an error instead of partial totals. Narrow the filters or reduce grouping. A small top-N does not bypass this cap.

PostgreSQL cancels statements at the configured timeout. MySQL and MariaDB use their statement timeout controls. On SQL Server, this setting limits lock waits only. It does not enforce an execution deadline.
