# Dashboards

A dashboard brings charts, tables and totals together on one page. Each item is a widget.
Create a dashboard for your lab's own data. You can configure widgets before records arrive.
The sample exercises below are optional.

## Create a dashboard

Create an empty dashboard for the information you want to follow. Add widgets to it afterward.
You need permission to create and edit dashboards.

### 1. Open Dashboard

Select **Dashboard** near the top of the main menu on the left.

![Dashboard near the top of the main menu.](dashboard-create-open.png)

### 2. Open the dashboard menu

Select the **dots menu** at the right end of the dashboard toolbar, beside Refresh.

![The dashboard dots menu beside Refresh.](dashboard-create-menu.png)

### 3. Choose New dashboard

Select **New dashboard** at the top of the open menu.

![New dashboard is the first item in the open menu.](dashboard-create-new.png)

**Expected result:** a blank dashboard opens in edit mode. Its name starts with **New dashboard**.
If that name is already used, OpenLDR adds a number. You can now add widgets.

![The new dashboard is selected and its editing grid is empty.](dashboard-create-result.png)

Select any screenshot to enlarge the same focused image.


## Add a widget

Add a widget to show a chart, table or total on your dashboard. Choose the lab records it reads, then choose a calculation and chart type.


### 1. Open the widget editor

A new dashboard is already in edit mode. For an existing dashboard, open its dots menu and select **Edit**.

![Edit in the dashboard menu.](dashboard-guide-bar-step-1-new-dashboard.png)
Open the dashboard's dots menu and select **Add widget**.

![Add widget in the dashboard edit menu.](dashboard-guide-bar-step-2-add-widget.png)




### 2. Give the widget a title

Enter a title that describes what the widget will show. For example, use `Orders by test` for a chart comparing test volumes.

![The title field at the top of the widget editor.](dashboard-guide-bar-step-3-title.png)


### 3. Choose the data and calculation

Under **Data**, choose the records to use. Under **Summarize**, choose the calculation. **Count** counts records. Other calculations depend on the data you selected.

![This example uses Test Orders and Count. Choose the data and calculation for your question.](dashboard-guide-bar-step-4-defaults.png)


### 4. Choose a grouping, if needed

To compare categories, select **Group by**, then choose a field. For one total, leave the widget without a grouping.

![Group by sits between Filter and Breakdown.](dashboard-guide-bar-step-5-group-button.png)



![The fields depend on Data. Test gives one group for each test name.](dashboard-guide-bar-step-5-group-menu.png)
For a date field, use **Grain** to choose an available time interval.

![A date grouping with Authored and Grain set to week.](dashboard-guide-widget-date-grain.png)




### 5. Choose how to display the result

Open the widget editor's dots menu and select **Charts**.

![Charts opens the visualization picker.](dashboard-guide-bar-step-6-chart-menu.png)
Choose **Number** for one total, **Bar** to compare categories, or **Line** for changes over time.

![The Visualization Type picker.](dashboard-guide-bar-step-6-bar-picker.png)




### 6. Save the widget

Open the editor's dots menu and select **Save**.

![The editor closes after you save.](dashboard-guide-bar-step-7-save.png)


### 7. Check the result on your dashboard

Find the widget by its title. New widgets appear at the bottom. Check that its labels and values describe the data you chose.

![Your selected records determine the labels and values.](dashboard-guide-bar-result.png)


### 8. Finish editing

Open the dashboard's dots menu and select **Done**.

![Done saves the dashboard and leaves edit mode.](dashboard-guide-dashboard-done.png)

**Expected result:** your widget appears with the title and display you chose. Its values come from your selected data. Repeat the task to add more widgets.


## Optional: practise with sample data

Use these optional exercises with fictional records and known results. Skip them when building dashboards from your own records.


### Load the sample data

The practice file contains **60 fictional orders** from September and October 2026. Use an empty test installation. Loading the file writes records into that installation.

For opening a terminal and running commands, see [Start here](/docs/start-here#use-the-command-line), or its [development walkthrough](/docs/start-here#example-1-use-the-cli-in-a-development-checkout). Replace the example folder with your actual installation folder.


#### 1. Download the sample file

Linux / macOS:

```sh
cd ~/Downloads/openldr_ce
curl -fL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/apps/web/public/docs-samples/openldr-sample-lab-data.json -o data/openldr-sample-lab-data.json
```

Windows PowerShell:

```powershell
cd C:\openldr_ce
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/apps/web/public/docs-samples/openldr-sample-lab-data.json" -OutFile data/openldr-sample-lab-data.json
```


#### 2. Import the records

Linux / macOS:

```sh
cd ~/Downloads/openldr_ce
./openldr ingest data/openldr-sample-lab-data.json
```

Windows PowerShell:

```powershell
cd C:\openldr_ce
.\openldr.ps1 ingest data/openldr-sample-lab-data.json
```

**Expected result:** `batch <id>: done (226 resources)`. Allow a few seconds for the records to appear.


#### From a source checkout

The sample file is already included. From your test checkout at `~/Downloads/openldr_ce` or `C:\openldr_ce`, run the command below. It goes through the running API, so start it and sign in first.

```sh
pnpm openldr ingest apps/web/public/docs-samples/openldr-sample-lab-data.json
```


### Example 1: make an orders-by-test widget

After loading the practice records, use a dashboard in edit mode. You will count orders by test using the same widget controls described above.


### 1. Add a widget

Open the dashboard's dots menu and select **Add widget**.

![Add a widget](dashboard-guide-bar-step-2-add-widget.png)


### 2. Name the widget

Enter `Orders by test` in the title field at the top left.

![Name the widget](dashboard-guide-bar-step-3-title.png)


### 3. Count test orders

Keep **Data** on **Test Orders** and **Summarize** on **Count**.

![Count test orders](dashboard-guide-bar-step-4-defaults.png)


### 4. Group the orders by test

Select **Group by**, then choose **Test** from its list.

![Group the orders by test](dashboard-guide-bar-step-5-group-button.png)



![Group the orders by test](dashboard-guide-bar-step-5-group-menu.png)


### 5. Choose a bar chart

Open the editor's dots menu and select **Charts**. In **Visualization Type**, select **Bar**.

![Choose a bar chart](dashboard-guide-bar-step-6-chart-menu.png)



![Choose a bar chart](dashboard-guide-bar-step-6-bar-picker.png)


### 6. Save the widget

Open the editor's dots menu and select **Save**.

![Save the widget](dashboard-guide-bar-step-7-save.png)


### 7. Check your chart

Find **Orders by test** at the bottom of the dashboard.

![Check your chart](dashboard-guide-bar-result.png)

**Expected result with the practice records:** five bars. **Full blood count** is tallest, with **18 orders**.

![Orders by test](dashboard-new-widget.mp4)


### Example 2: filter the sample dashboard

Use **Lab Overview (Sample)** to find how many urgent HIV viral load orders arrived in October 2026.

![Lab Overview (Sample)](dashboard-filters.mp4)


### 1. Open Dashboard

Select **Dashboard** in the main menu.

![Open Dashboard](dashboard-guide-filter-step-1-dashboard.png)


### 2. Choose the sample dashboard

Select **Lab Overview (Sample)** above the charts.

![Choose the sample dashboard](dashboard-guide-filter-step-2-selector.png)


### 3. Set the October date range

Open **Period**. Go to October 2026. Select **1**, then **31**, and click outside the calendar.

![Set the October date range](dashboard-guide-filter-step-3-calendar.png)



![Set the October date range](dashboard-guide-filter-step-3-selected.png)


### 4. Choose the test

Open **Test** and select **HIV viral load**.

![Choose the test](dashboard-guide-filter-step-4-test.png)


### 5. Choose urgent orders

Open **Priority** and select **urgent**.

![Choose urgent orders](dashboard-guide-filter-step-5-priority.png)


### 6. Read the answer

Read **Total Orders** and **Distinct Patients** below the filters.

![Read the answer](dashboard-guide-filter-result.png)

**Expected result with the practice records:** **Total Orders** and **Distinct Patients** each read **1**. **Results Recorded** reads **4**, because it does not use Priority. **Orders by Test** keeps all tests because it does not use Test.


## More dashboard tasks

The following reference covers additional editor controls, layout, filters, SQL and export.
### Who can do what

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

### Refresh

Select **Refresh** to run every widget again now.

A widget can also refresh by itself. The sample widgets refresh every 5 minutes. To set one, open the widget in the editor and type a number of seconds in **Refresh every (seconds)**, above the chart options. It shows before the query has run. On a phone it is on the **Style** tab.

How refresh behaves:

- The interval starts after a request finishes. A slow query delays the next refresh. It never stacks a second request on top of the first.
- An interval of 0 turns automatic refresh off.
- Changing a filter, or leaving the page, cancels the request in the browser. A late answer never replaces a newer one.
- Cancelling in the browser does not always stop the query in the database.

### Rename a dashboard

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

**Breakdown** adds a `series` column, such as one per priority. Bar, row, line and area charts draw one series per value, in their own colors, with a legend. A pie or funnel adds the values up, so it shows one total per label. **Table** shows the `series` column as it is.

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

> **A filter changes only the widgets bound to it.** A SQL widget is bound when its SQL uses the filter's tokens and its variables are set in **Filters**. A Builder widget is bound in the **Dashboard filters** block of the Builder: pick the field each filter narrows, such as **Authored** for **Period**. A bound filter replaces that widget's own condition on the same field. The next example shows how to connect a filter to SQL.

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

**Expected result:** Orders by requesting site changes to 12, 11 and 9. The Builder widgets do not change, because none is bound to **Period**.

A red variable chip above the SQL means that variable cannot resolve. Either its type no longer matches the bound filter, or a date range is written as `{{period}}` instead of `{{period_from}}` and `{{period_to}}`. Open **Filters** in the **Editor menu** to read the message.

## Export, import and copy

The **Dashboard menu** has **Export** and **Import** in view mode and in edit mode.

- **Export** downloads the dashboard as a JSON file named after it, for example `New_dashboard.json`.
- **Import** reads such a file and adds it as a new dashboard. It never replaces one. If the name is taken, it adds a number.

Use them to:

- **Copy a dashboard** to another install, or keep a backup.

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

**The widget shows No data or a zero total.** Check whether records have arrived for the selected data. You can save a widget before records arrive.

**I cannot find my new widget.** New widgets appear at the bottom of the dashboard. Scroll down.

**I cannot find the edit action.** Check that your role has permission to edit dashboards.

**My practice totals differ.** The quoted totals assume only the practice records are loaded. Other data changes the totals.

- **Every number is 0 and every chart says No data.** The warehouse is empty. [Load the sample data](#load-the-sample-data), or load your own.
- **No dashboard appears.** None exists yet. The empty page offers **New dashboard** and **Import dashboard**.
- **Edit is missing from the menu.** Your role lacks **Edit dashboards**.
- **The SQL cannot be edited, or saving says `raw SQL widgets are disabled`.** Turn on **Dashboard raw SQL**. See [Turn on SQL widgets](#turn-on-sql-widgets).
- **A widget ignores the filter bar.** It is not bound to that filter. For a Builder widget, pick a field in its **Dashboard filters** block. A SQL widget follows a filter only when its SQL uses the tokens and its variables are bound in **Filters**.
- **A Breakdown makes no difference to my pie.** A pie or funnel adds the Breakdown values up. Use a bar chart to see them side by side.
- **A widget shows an error about time or rows.** It hit the timeout or the row cap. See [Limits and settings](#limits-and-settings).
- **A new widget is not on screen.** New widgets go to the bottom of the grid. Scroll down.

## Related guides

- [Reports](/docs/reports)
- [Custom Queries](/docs/query)
- [Workflows](/docs/workflows), which can publish datasets for dashboards to read
- [Data exposure](/docs/data-exposure)
- [Settings](/docs/settings)
