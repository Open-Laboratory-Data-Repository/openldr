# Report Designer

**Report Designer** is a drag-and-drop page designer for printable reports. You place a letterhead, titles, tables, charts and panels on an A4 or Letter page, bind each table to a saved [Custom Query](/docs/query), and publish the result as a report in the [Reports](/docs/reports) library.

A fresh install ships ten designs, one for each built-in report. This guide reads how one of them is built, then builds a new design and publishes it as a report. It takes about 15 minutes. Select any picture or clip to enlarge it.

![Test Volume Over Time open in the designer, with its table selected and the Data tab showing the bound query.](report-designer-tour.png)

## Who can do what

| Permission | What it allows |
| --- | --- |
| **View reports** | See the Reports library |
| **Run reports** | Run and preview a report |
| **Edit report templates** | Open Report Designer, create and change designs, publish them, and create library reports |

The designer's menus and panel names are in English only.

## Before you start

Example 2 needs the docs sample data. See [Dashboards, Load the sample data](/docs/dashboard#load-the-sample-data).

## Example 1: read how a built-in report is made

![Opening Test Volume Over Time, selecting its table and the Data tab.](report-designer-explore.mp4)

1. Open **Report Designer**. The **Templates** list on the left shows the ten designs, with paper size and orientation.
2. Select **Test Volume Over Time**. The header shows **Saved** and **PUBLISHED**.
3. On the page, select the table, labelled **Data**, with columns Month, Test and Count.
4. Open the **Data** tab on the right.

**Expected result:** **Bind query** reads **Test volume by month**, a saved Custom Query. The **Columns** list has three ticked columns. Under **Parameters**, `dateRange` is labelled **Date range**: that is the filter the report asks for when it runs.

So a report is three parts: a design (this page), the query that fills its tables, and the filters that pass values into the query.

## Example 2: build a design and publish it as a report

Build a one-table report of patients by age band.

### Build the design

![New template, naming it, inserting a table, binding it to Patient demographics by age band, ticking the columns and showing the data.](report-designer-build.mp4)

1. Open the **⋯** menu at the top of the canvas and select **New template**.
2. Click the name box, **Untitled template**, and type `Patients by age band (sample)`.
3. Open **⋯**, select **Insert**, then **Table**. A table drops onto the page.
4. With the table selected, open the **Data** tab. Set **Bind query** to **Patient demographics by age band**.
5. Select **Load columns**. Five columns appear: band, total, male, female, other. Tick all five.
6. Select **Load pages** above the canvas, then **Show data** in the header.

**Expected result:** the table fills with real rows: 5-14 with 3 patients, 15-24 with 4, 25-49 with 14, 50+ with 4. That is 25 patients: the 24 in the docs sample, and **Sample Seed**, which every install creates.

![The table bound and filled with the sample's patients.](report-designer-bound.png)

**Show data** shows only the rows the first page holds, so the canvas never promises more than the PDF prints.

### Save, publish, and add it to Reports

![Saving the design and publishing a revision.](report-designer-publish.mp4)

1. Open **⋯** and select **Save**. The header reads **Saved**.
2. Open **⋯** and select **Publish revision**. The header reads **PUBLISHED**. This does not add anything to Reports.
3. Open **⋯** and select **Create report from this design**. The **New report** sheet opens.

![Naming the report, choosing Operational, and creating it.](report-designer-create-report.mp4)

4. In **Name**, type `Patients by age band (sample)`.
5. Open **Category** and select **Operational**. **Template** and **Primary query** are filled in already, from the design and its table.
6. Open the sheet's **Actions** menu and select **Create report**.

### Run it

![Running the new report from the Reports library.](report-designer-run.mp4)

1. Open **Reports**. **Patients by age band (sample)** is listed under **Operational**.
2. Select it, open **Actions**, select **Parameters**, then **Run**. It has no filters, so nothing needs filling.

**Expected result:** the document shows the five columns and four rows from step 6 of Build the design.

![The report's document.](report-designer-report.png)

To remove the example, delete the report from its menu in Reports, then the design with **⋯ → Delete** in the designer.

## What the designer can do

You can create a template, place and arrange Text, Table, Key/value panel, Image, Barcode, QR code, Line, Rectangle, Date, Cell grid, and Chart elements on A4 or Letter pages, bind elements to a Custom Query and choose their columns, control how blocks flow across pages, add filter parameters, preview the template with live data, export it to PDF or Excel, and publish it as a report.

### Before you build your own

- You need **Edit report templates**. The Lab Admin and Lab Manager roles have it.
- Write and save the query that will supply the report's data first. See [Custom Queries](/docs/query). You can also do this later and come back to bind it.
- Know the layout you want: single page or multi-page, and which columns the table should show.

## Step by step

1. Open **Report Designer** from the main navigation.
2. Choose **New template** from the **⋯** menu, or select an existing template in the left explorer to keep working on it.
3. Set the template's name in the field at the top of the canvas.
4. Use **⋯ → Insert** to drop an element onto the page: Text, Table, Key/value panel, Image, Barcode, QR code, Line, Rectangle, Date, Cell grid, or Chart. Drag to reposition and use the resize handles to size it. A selected element shows its name in a tag above its box.
5. Select the **Table** element and open its **Data** tab. Choose **Bind query** to pick a Custom Query, then **Load columns** and tick which columns appear on the report. Reorder and relabel them as needed. **Sort by column** orders the rows before drawing; turn on **First data row is the header** when the query emits its column labels as its first row (it needs Sort by set). **Transpose** in the Properties tab flips a wide table so its columns become rows.
6. For a **Cell grid**, bind the query in the **Data** tab and set the label column, cell columns, palette steps, and trailing columns in the **Properties** tab.
7. For a **Chart**, bind the query in the **Data** tab, then pick the chart type (bar, line, or donut), the label column, and the value columns in the **Properties** tab. Charts print as sharp vector shapes; a bound chart also exports its rows to Excel.
8. Still in the **Data** tab, use **Add parameter** to define the filters the report will expose (Text, Select, or Date range). Give each one a clear label. These become the filters shown when the report runs. Match a parameter's **Key** to a bound query's parameter **Variable ID** so the filter value flows into the query when the report runs.
9. Choose **Preview** to render the template to PDF using live data.
10. Select **Save**. The save status next to the template name shows Saved, Saving, or Unsaved changes; the designer also autosaves as you work.
11. Use **⋯ → Export → PDF** or **Excel** to download the current template's output directly.
12. Follow the publishing steps below to publish a revision and create a report in the library.

## Publish a revision and create a report

These are separate actions in the designer's **⋯** menu.

| Action | Result |
| --- | --- |
| **Publish revision** | Publishes a version of the saved template. It does not create a Reports library entry. |
| **Create report from this design** | Opens a sheet to create a library report linked to a template and primary query. It does not publish a template revision. |

1. Save the template and wait for **Saved**. Both actions require the template to have been saved at least once.
2. Choose **⋯ → Publish revision**. Check the confirmation naming the template and its published status. Open **⋯ → Versions** to inspect the published revision.
3. Choose **⋯ → Create report from this design**.
4. Enter the report's **Name** and choose its **Category**. Add an optional **Description**. Confirm the **Template** and **Primary query**. The query may be preselected from the first bound table; check it before creating the report.
5. Open the sheet's **⋯** menu and choose **Create report**. Name, Category, Template, and Primary query must all be set. The confirmation names the new report, which may differ from the template name.
6. Open [Reports](/docs/reports) and select the new report under its category. Open **⋯ → Parameters**, complete required filters, and choose **Run**. Check Document and Spreadsheet.

For example, start with a saved query that returns two columns. Bind a table to that query, save the template, and publish its revision. Create a report with a distinct name and that query as Primary query. Verify that the report appears under the chosen category and runs with the expected columns.

Publishing a later template revision does not require creating another library report for the same design. Use Create report from this design when you intend to add a new library entry.

### Expected result

The saved template appears in the left explorer. Publish revision records a template version. Create report from this design adds the named entry to the [Reports](/docs/reports) library. Its primary query supplies the Spreadsheet rows; the template provides the Document layout.

### Designer troubleshooting

- **A publishing action asks you to save first:** save the template and wait for Saved before retrying.
- **The template is published but absent from Reports:** publishing a revision does not create a library entry. Use Create report from this design.
- **Create report is disabled:** fill Name, Category, Template, and Primary query, then use the sheet's menu.
- **No columns to choose from:** pick a query in **Bind query**, then select **Load columns**.
- **Preview fails to render:** check that the bound query and its parameters are valid, then try again.
- **Nothing to export:** the template has no table elements yet.
- **A table's rows run onto extra pages:** this is expected. Tables paginate automatically across multiple pages when the data doesn't fit on one.

## More you can do

- The strip above the canvas shows how many physical pages the design prints as. Choose **Load pages** to run the bound queries and get a real count. The count is a snapshot, and the strip says when the design has been edited past it. An overflowing table also gets a dashed line on the canvas where its first page ends.
- **Show data** in the header fills bound tables, grids and charts with the rows the page strip already loaded, so you can size a box against real content. It shows only the rows the first page actually holds, which is the whole point: the canvas should never promise more than the PDF prints. Load pages first; the toggle is disabled until there is data.
- The **Flow** section in the Properties tab controls how blocks behave when a table or grid runs onto extra pages: **Place below** pins an element under another and moves it up when the block above finishes early, **Gap after** sets the space between them, **First page only** stops a summary band from repeating on continuation pages, **Show with** ties a heading to its table so the two appear and disappear together, and **Fill to bottom of box** lets a cell grid grow to its declared bottom edge.
- A bound table's Data tab can add a **Totals row** (type a label, tick the columns to sum) and a text element can show `{{sum(elementName.columnKey)}}`. A per-column **rule** ("When ≥ 10 → Critical") highlights values without touching SQL; a status column from the query always wins over a rule.
- Tick **Trend** on a bound column to draw its value as a miniature line inside the cell. The query supplies the numbers as one delimited string, for example `12,14,11,18`. Anything that is not two or more clean numbers prints as text instead, and Excel always exports the raw string rather than a picture.
- **⋯ → Versions** lists every published version of the design with who published it and when. **Restore** loads one back into the working copy as an ordinary edit: it lands as a single undo step, autosave persists it, and it does not publish. Preview it, undo it, or publish it deliberately.
- The **Print language** picker at the top of the Properties tab switches the content field between the design's own text and one language's translation. With a language picked, the box holds that language's text and shows the authored text as its placeholder, so an empty box means "prints as authored". Preview and Download render the language you are editing. A report printed from [Reports](/docs/reports) uses your current studio language, and `openldr report run <id> --format pdf --lang fr` does the same headless. Only text you typed is translated; query results, laboratory details and barcode values never are.
- The **built-in reports already ship with French and Portuguese**, so a French session prints them in French with nothing to author. Dates follow the print language too (`2 sept. 2026`, `2 set. 2026`); the day always comes before the month, in every language. Susceptibility codes (R, I, S) are never translated, because they are the same codes everywhere.
- A key/value panel that is **not** bound to a query (the scope panel on every built-in report) lists its pairs under **Pair translations** while a language is picked. Each half gets its own field with the authored text as the placeholder. A value holding `{{param.from}}` or `{{date}}` can be translated too, tokens and all, so French can read "du {{param.from}} au {{param.to}}". A bound panel has no pairs to translate here: its labels are column labels, translated in the Data tab.
- A **draft** design prints a diagonal DRAFT stamp on every page; publishing removes it.
- The **Letterhead** element is the shared identity band (logo, name, address, contact, rule). Its layout is defined once, so every design that uses it updates together; the values come from Settings, Laboratory.
- Turn on **Page numbers** in the page settings to add a footer to every page.
- A template can span several pages. Add and arrange elements independently on each one.
- In the **Layers** tab, the eye hides an element (it leaves the canvas and the PDF; the block below a hidden element moves up), the lock keeps it selectable but immovable, and rows reorder by drag or the raise and lower buttons.
- Select two or more elements and choose **⋯ → Group selection** to name them as one group. Clicking any member then selects the whole group; hold **Alt** to reach a single element inside it. The **Layers** tab shows each group as a header row with its own eye and lock, which apply on top of each element's own: locking a group never unlocks an element you locked by itself. **Ungroup** removes the group and leaves the elements alone.
- **Ctrl+D** duplicates the selected elements, **Ctrl+C** and **Ctrl+V** copy and paste them. Clones arrive slightly offset, selected, and never locked.
- Use **⋯ → Duplicate** to branch a new template from an existing layout, and **⋯ → Delete** to remove one you no longer need.
- From [Reports](/docs/reports), managers can jump straight back into a published report's template with **Edit template**.
- Use **Undo/Redo** and the zoom controls while arranging elements precisely.

## On a phone

The designer is built for a large screen. On a phone, use it to read a design, not to build one. Reports made from a design run and print on a phone like any other report.

## Troubleshooting

- **No columns to choose from.** Pick a query in **Bind query**, then select **Load columns**.
- **The canvas table is empty with Show data on.** Tick at least one column, then select **Load pages** again. A query with a required filter needs a default value in its parameter.
- **The design is published but not in Reports.** Publishing a revision does not create a library entry. Use **Create report from this design**.
- **Create report is greyed out.** Fill Name, Category, Template and Primary query.

## Related guides

- [Reports](/docs/reports)
- [Custom Queries](/docs/query)
- [Laboratory](/docs/laboratory)
- [Connectors](/docs/connectors)
