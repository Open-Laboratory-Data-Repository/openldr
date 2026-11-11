# Dashboards

A dashboard is one page of charts, numbers and tables. Each tile is a **widget**. A widget runs one query against the lab warehouse and draws the answer. Filters at the top of the page change what the widgets count.

This guide takes about 45 minutes. You load a small set of made-up lab data, explore the sample dashboard, then build a dashboard of your own with four widgets. Every step has a picture or a short clip. Select a picture or clip to enlarge it.

![The sample dashboard. 1 Dashboard selector. 2 Refresh. 3 Dashboard menu. 4 Filters. 5 A widget.](dashboard-tour.png)

1. **Dashboard selector.** Switches between the dashboards you can see.
2. **Refresh.** Runs every widget again now.
3. **Dashboard menu.** The dots menu. It holds every action: new, edit, add widget, filters, export, import, delete.
4. **Filters.** Narrow the dashboard to a period, a test or a priority.
5. **A widget.** One query and one picture of its answer.

## Who can do what

What you see depends on the permissions in your role. An administrator sets them in **Roles**.

| Permission | What it lets you do |
| --- | --- |
| View dashboards | Open **Dashboard**, read widgets, use filters, refresh, export. |
| Create dashboards | Use **New dashboard** and **Import**. |
| Edit dashboards | Use **Edit**, add and change widgets and filters, move and resize. |
| Delete dashboards | Use **Delete** in edit mode. |

Without **View dashboards**, Studio shows an access-denied page and loads no dashboard data. Navigation, Docs and sign-out still work.

Two settings also matter. Both are for administrators, and both are covered in [Limits and settings](#limits-and-settings):

- **Dashboard raw SQL** decides whether anyone can write SQL widgets. It is off on a new install.
- **Data exposure** decides which extra columns the Builder can offer.

## Load the sample data

A new install has the sample dashboard, **Lab Overview (Sample)**, but almost no lab data. Every number reads 0 and every chart says **No data**. The examples in this guide need data, so load the sample file first.

The file is a FHIR transaction Bundle of made-up activity. It holds 24 patients, 60 test orders across five tests from three facilities, and their specimens, results and reports. All dates fall in September and October 2026. The same file always gives the same numbers, so your screen should match this guide.

> **Use a test install.** The sample rows become real rows in your warehouse. No command removes only them. To start clean again, run `./openldr db reset`, which drops and recreates the whole database. Never load the sample on a live lab install.

**On an install made with the one-line installer**, run these from the install folder. The `openldr` command runs inside the `api` container, which can only see the `data` folder, so the file goes there.

```bash
curl -L -o data/openldr-sample-lab-data.json https://openldr.online/docs-samples/openldr-sample-lab-data.json
./openldr ingest data/openldr-sample-lab-data.json
```

On Windows, download the same file into `data`, then run `.\openldr.ps1 ingest data/openldr-sample-lab-data.json`.

**From a source checkout**, the file is already in the repository:

```bash
pnpm openldr ingest apps/web/public/docs-samples/openldr-sample-lab-data.json
```

A good run ends with `batch <id>: done (226 resources)`. Open **Dashboard**. Within a few seconds you should see:

| Widget | Value with the sample loaded |
| --- | --- |
| Total Orders | 60 |
| Distinct Patients | 21 |
| Results Recorded | 51 |
| Orders by Test | Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6 |

If the numbers are higher, the warehouse already held other data. The examples still work, but your numbers will differ.

## What the sample dashboard shows

**Lab Overview (Sample)** ships with every install. Each widget is written in SQL. They run even while **Dashboard raw SQL** is off, because the server knows these queries. Not every widget listens to every filter.

| Widget | Shows | Follows filters |
| --- | --- | --- |
| Total Orders | Number of test orders | Period, Test, Priority |
| Distinct Patients | Patients with at least one order | Period, Test, Priority |
| Results Recorded | Results that were not cancelled | Period, Test |
| Result Finalisation % | Share of reports that are final or amended | None |
| Orders by Test | Orders per test, top 15 | Period, Priority |
| Orders Trend | Orders per day | Period, Test, Priority |
| Orders by Status | Orders per status | Period, Test, Priority |
| Orders by Priority | Orders per priority | Period, Test |
| Order → Report Pipeline | Ordered, specimen received, result recorded, report issued | None |
| Abnormal Results | Results flagged high, low or abnormal | Period |
| Results Trend | Results per day | Period, Test |
| Analyte Volume vs Avg Value | Result count against average value, per analyte | None |
| Recent Orders | The 50 newest orders | Period, Test, Priority |

**Test** lists order names, such as Full blood count. **Results Recorded** and **Results Trend** count the results of the orders for that test. A Full blood count order has two results, Haemoglobin and White cell count, so both are counted.

## Example 1: filter the sample dashboard

Find out how many urgent HIV viral load orders came in during October 2026.

![Filtering the sample dashboard to October 2026, HIV viral load, urgent.](dashboard-filters.mp4)

1. Open **Dashboard**. The selector shows **Lab Overview (Sample)**.
2. Select **Period**. Go back to October 2026. Select 1 October, then 31 October.
3. Open **Test** and choose **HIV viral load**.
4. Open **Priority** and choose **urgent**.

**Expected result:** Total Orders reads 1 and Distinct Patients reads 1. Results Recorded reads 4, because it ignores **Priority**. Orders by Test still shows every test, because it ignores **Test**.

![The dashboard after the three filters.](dashboard-filters-result.png)

To clear a filter, open it and choose **All**. To clear **Period**, open it and select **Clear**. Filters are not saved. Reloading the page puts every filter back to its default.

## Refresh

Select **Refresh** to run every widget again now.

A widget can also refresh by itself. The sample widgets refresh every 5 minutes. Widgets you build in the editor do not refresh by themselves, because the editor has no refresh setting yet. To give one an interval, export the dashboard, set `refreshIntervalSec` on that widget in the file, and import it. See [Export, import and copy](#export-import-and-copy).

How refresh behaves:

- The interval starts after a request finishes. A slow query delays the next refresh. It never stacks a second request on top of the first.
- An interval of 0 turns automatic refresh off.
- Changing a filter, or leaving the page, cancels the request in the browser. A late answer never replaces a newer one.
- Cancelling in the browser does not always stop the query in the database.

## Example 2: make a dashboard and a bar chart

Build a bar chart of orders per test with the **Builder**. No SQL needed.

![Making a new dashboard and a bar chart with the Builder.](dashboard-new-widget.mp4)

1. Open the **Dashboard menu** and select **New dashboard**. A blank dashboard named **New dashboard** opens in edit mode. Edit mode shows a dotted grid.
2. Open the **Dashboard menu** again and select **Add widget**. The widget editor opens.
3. Select the title at the top left and type `Orders by test`.
4. **Data** already says **Test Orders**, and **Summarize** already says **Count**. Leave both.
5. Select the **Group by** button, the second icon in the row under **Summarize**. In the new **Group by** box, choose **Test**.
6. The preview on the right now shows five numbers. Open the editor's own dots menu, the **Editor menu**, and select **Charts**. Choose **Bar**.
7. Open the **Editor menu** again and select **Save**.

**Expected result:** the bar chart sits on the grid. Full blood count is the tallest bar, at 18.

Every new dashboard is called **New dashboard**, then **New dashboard (2)**, and so on. To give it a name, open the **Dashboard menu**, select **Rename**, type the name, then select **Save** in the sheet's **⋯** menu. **Rename** waits while unsaved edits are pending. The sample dashboard keeps its own name: OpenLDR restores it when the server restarts.

### The widget editor

![The widget editor. 1 Title. 2 Data. 3 Summarize. 4 Group by. 5 Builder or SQL. 6 Editor menu.](dashboard-builder.png)

1. **Title.** Shown on the widget's card.
2. **Data.** What to count: **Test Orders**, **Results**, **Reports**, **Specimens**, **Patients** or **Facilities**.
3. **Summarize.** The measure. **Count** by default. **Add measure** adds another, such as **Distinct Patients** or **Avg Value**. **Formula** divides one measure by another, for example to show a percentage.
4. **Group by.** Splits the measure by a field. A date field also asks for a **Grain**: day, week, month, quarter or year.
5. **Builder** or **SQL.** Switching to SQL shows the query the Builder wrote. You can only edit it when **Dashboard raw SQL** is on.
6. **Editor menu.** **Tables** lists the fields. **Charts** picks the picture. **Filters** sets SQL variables. **Save** saves. **Delete** removes a saved widget.

The row of icon buttons under **Summarize** adds more parts: **Filter**, **Group by**, **Breakdown**, **Sort**, **Join data** and **Custom column**, in that order. Each part has an **×** to remove it.

The lower left shows the raw rows. The lower right is **Style**: which column is the category, which is the value, and the colour. Phones show four tabs instead: **Build**, **Preview**, **Data** and **Style**.

To change a saved widget, enter edit mode, open the widget's own dots menu, and select **Edit**.

### Chart types

![The chart picker, opened from Editor menu, Charts.](dashboard-chart-types.png)

| Type | Use it for | Style options |
| --- | --- | --- |
| Number | One total | Value column, suffix such as `%` |
| Line | A change over time | Category, value, colour |
| Bar | Comparing groups | Category, value, colour |
| Area | Volume over time | Category, value, colour |
| Row | Bars on their side, for long names | Category, value, colour |
| Pie | Parts of a whole | Category, value, inner radius. 0 draws a pie, more draws a donut |
| Scatter | Two measures against each other | X column, Y column, colour |
| Funnel | Steps that shrink | Category, value |
| Progress | Progress to a goal | Value column, goal, colour, suffix |
| Gauge | A value on a dial | Value column, min, max, green from, amber from, suffix |
| Table | The rows themselves | None |
| Traffic Light | Good, warning or bad | Value column, green from, amber from, suffix |

**Breakdown** adds a `series` column, such as one per priority. Today only **Table** shows it. Line, bar and area charts draw a single series and ignore it.

## Example 3: orders per week

Show how many orders arrive each week.

![A line chart of orders per week.](dashboard-trend.mp4)

1. Stay in edit mode. Open the **Dashboard menu** and select **Add widget**.
2. Type the title `Orders per week`.
3. Select **Group by** and choose **Authored**. Authored is the date the order was made.
4. In **Grain**, choose **week**.
5. Open the **Editor menu**, select **Charts**, and choose **Line**.
6. Open the **Editor menu** and select **Save**.

**Expected result:** a line with one point per week, from the week of 30 August to the week of 25 October 2026. The busiest week is the week of 4 October.

The editor puts each new widget at the bottom of the grid. Scroll down to find it.

## Example 4: one number with a condition

Count the results flagged high.

![A number widget that counts high results.](dashboard-number.mp4)

1. Open the **Dashboard menu** and select **Add widget**.
2. Type the title `High results`.
3. Open **Data** and choose **Results**.
4. Select **Filter**, then **Add condition**.
5. Set the field to **Interpretation**. Leave the operator at **eq**, which means equals. Type `H` as the value.
6. **Number** is already the chart type. Open the **Editor menu** and select **Save**.

**Expected result:** the widget reads 22.

The sample uses the standard flags: `H` high, `L` low, `N` normal, `A` abnormal. To count high or low together, set the operator to **in** and the value to `H, L`. That gives 27.

Filter operators: **eq** equals, **in** any of a list, **contains** text inside, **gte** greater than or equal, **lte** less than or equal, **between** two values. **Add group** nests conditions. **Match type** chooses whether all or any of the conditions must hold.

## Move and resize widgets

![Dragging a widget and widening another.](dashboard-layout.mp4)

In edit mode, every card shows a grip next to its title.

- **Move.** Drag a card by its title. The others shift to make room.
- **Resize.** Drag the corner at the lower right of a card.

Changes save by themselves about a second and a half after you stop. **Done** in the **Dashboard menu** also saves, and leaves edit mode.

![The Dashboard menu in edit mode.](dashboard-menu-edit.png)

Phones show the same cards in one column and do not allow moving or resizing. Use a computer to arrange a dashboard.

## Dashboard filters

The sample dashboard has three filters. Your new dashboard has none. Add a **Period** filter.

![Adding a Period filter.](dashboard-filter-add.mp4)

1. In edit mode, open the **Dashboard menu** and select **Edit filters**.
2. Open the filter actions menu, the dots at the top of the panel, and select **Add filter**.
3. In **Variable ID**, type `period`.
4. In **Label**, type `Period`.
5. In **Type**, choose **Date range**.
6. Open the filter actions menu and select **Save**. Then select **Done** in the **Dashboard menu**.

![The filter panel. The tokens to use in SQL appear beside each filter.](dashboard-filter-editor.png)

Filter types:

| Type | Picks | SQL tokens |
| --- | --- | --- |
| Text | A word from a list, or typed | `{{id}}` |
| Number | A number | `{{id}}` |
| Date | One day | `{{id}}` |
| Date range | A first and last day | `{{id_from}}` and `{{id_to}}` |

A text filter can fill its list from **Options SQL**. The sample's **Test** filter uses `SELECT DISTINCT panel_desc FROM lab_requests WHERE panel_desc IS NOT NULL ORDER BY panel_desc`. Any filter can have a **Default value**.

> **Filters reach SQL widgets only.** A dashboard filter changes a widget only when that widget's SQL uses the filter's tokens. Builder widgets keep their own conditions and ignore the filter bar. The next example shows how to connect a filter.

## Example 5: a widget written in SQL

Show orders per requesting facility. The Builder cannot do this one, because **Test Orders** has no facility field, so write SQL.

### Turn on SQL widgets

An administrator does this once.

![Settings, General, with the Dashboard raw SQL switch.](dashboard-raw-sql-setting.png)

1. Open **Settings**, then **General**.
2. Turn on **Dashboard raw SQL**.

From the command line, run `./openldr settings flags set dashboard.raw_sql true`. SQL widgets only read data. They query the warehouse this install uses: PostgreSQL, MySQL or SQL Server.

### Write the widget

![Writing the SQL widget, running it and choosing a Row chart.](dashboard-sql.mp4)

1. Select **New dashboard** in the selector. Open the **Dashboard menu** and select **Edit**, then **Add widget**.
2. Type the title `Orders by requesting site`.
3. Select **SQL**. Replace the text in the editor with:

```sql
SELECT requester_display AS label, COUNT(*) AS value
FROM lab_requests
WHERE 1=1
[[AND substring(authored_at,1,10) >= {{period_from}}]]
[[AND substring(authored_at,1,10) <= {{period_to}}]]
GROUP BY requester_display
ORDER BY value DESC
```

4. Select **Run query**, the play button. The rows show 23, 22 and 15.
5. Open the **Editor menu**, select **Charts**, and choose **Row**.

Name the category column `label` and the number column `value`. Charts look for those names first. The **Style** panel can point them at other columns.

`{{period_from}}` is a variable. `[[ ... ]]` makes a line optional. If the variable has no value, the whole line drops out. Without the brackets, an empty variable becomes `NULL` and the query returns nothing.

### Connect the variables to the Period filter

![Opening Filters, setting the type to Date Range and binding it to Period.](dashboard-sql-variables.mp4)

1. Open the **Editor menu** and select **Filters**. The **Variables** panel lists `{{period_from}}` and `{{period_to}}`.
2. Set **Type** to **Date Range**. The two variables join into one, named `period`.
3. Set **Dashboard Filter** to **Period (period)**.
4. Close the panel. Open the **Editor menu** and select **Save**. Then select **Done** in the **Dashboard menu**.

Only filters of the same type appear in **Dashboard Filter**. **Test Value** lets you try a value in the editor without touching the dashboard.

### Use the filter

![Choosing October 2026 in Period. Only the SQL widget changes.](dashboard-filter-apply.mp4)

Select **Period** and choose 1 to 31 October 2026.

**Expected result:** Orders by requesting site changes to 12, 11 and 9. The Builder widgets do not change.

A red variable chip above the SQL means that variable cannot resolve. Either its type no longer matches the bound filter, or a date range is written as `{{period}}` instead of `{{period_from}}` and `{{period_to}}`. Open **Filters** in the **Editor menu** to read the message.

## Export, import and copy

The **Dashboard menu** has **Export** and **Import** in view mode and in edit mode.

- **Export** downloads the dashboard as a JSON file named after it, for example `New_dashboard.json`.
- **Import** reads such a file and adds it as a new dashboard. It never replaces one. If the name is taken, it adds a number.

Use them to:

- **Copy a dashboard** to another install, or keep a backup.
- **Set a refresh interval.** Change `refreshIntervalSec` on a widget in the file, then import.

Importing a dashboard that holds SQL widgets fails while **Dashboard raw SQL** is off, with the message `raw SQL widgets are disabled`. That includes a copy of the sample dashboard. Turn the setting on first.

## Delete a dashboard

1. Select the dashboard and enter edit mode.
2. Open the **Dashboard menu** and select **Delete**.
3. Confirm.

![The delete prompt.](dashboard-delete-confirm.png)

Deleting cannot be undone. Export first if you may want it back. To finish this guide, delete **New dashboard**.

## On a phone

People use Studio on phones. Dashboards work there in one column.

![The sample dashboard on a phone.](dashboard-phone.png)

You can read widgets, use filters, refresh and export on a phone. Moving and resizing need a computer. The widget editor works on a phone, with its four tabs.

## Limits and settings

These are for administrators. They live in **Settings**, **General**.

| Setting | Default | What it does |
| --- | --- | --- |
| Dashboard raw SQL | Off | Allows writing and running SQL widgets. The sample's SQL still runs when it is off. |
| Dashboard SQL timeout (ms) | 5000 | Stops any Builder or SQL widget query that runs longer. |
| Dashboard SQL row cap | 10000 | SQL widgets return at most this many rows. Builder widgets fail if the query makes more groups than this. |

The row cap counts database groups before the dashboard buckets dates, adds up breakdowns or picks a top N. A small top N does not get around it. If a widget hits the cap, it shows an error, never a partial total. Narrow the filters or group by less.

PostgreSQL, MySQL, MariaDB and SQL Server all stop the database work at the timeout. SQL Server also resets each pooled connection after a query, so row and lock limits never leak into the next one.

**Data exposure**, also in Settings, decides which extra warehouse columns the Builder may offer, for example under **Join data**. See [Data exposure](/docs/data-exposure).

## Troubleshooting

- **Every number is 0 and every chart says No data.** The warehouse is empty. [Load the sample data](#load-the-sample-data), or load your own.
- **No dashboard appears.** None exists yet. The empty page offers **New dashboard** and **Import dashboard**.
- **Edit is missing from the menu.** Your role lacks **Edit dashboards**.
- **The SQL cannot be edited, or saving says `raw SQL widgets are disabled`.** Turn on **Dashboard raw SQL**. See [Turn on SQL widgets](#turn-on-sql-widgets).
- **A widget ignores the filter bar.** Builder widgets always do. A SQL widget follows a filter only when its SQL uses the tokens and its variables are bound in **Filters**.
- **A Breakdown makes no difference to my chart.** Only **Table** shows a breakdown today.
- **A widget shows an error about time or rows.** It hit the timeout or the row cap. See [Limits and settings](#limits-and-settings).
- **A new widget is not on screen.** New widgets go to the bottom of the grid. Scroll down.

## Related guides

- [Reports](/docs/reports)
- [Custom Queries](/docs/query)
- [Workflows](/docs/workflows), which can publish datasets for dashboards to read
- [Data exposure](/docs/data-exposure)
- [Settings](/docs/settings)
