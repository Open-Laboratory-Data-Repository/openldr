# Report Designer

Report Designer is a free-form, drag-and-drop page designer for printable report templates. Build a layout, bind its tables to a saved [Custom Query](/docs/query), and publish the result as a report on the [Reports](/docs/reports) library.

## Outcome

You can create a template, place and arrange Text, Table, Key/value panel, Image, Barcode, QR code, Line, Rectangle, Date, Cell grid, and Chart elements on A4 or Letter pages, bind elements to a Custom Query and choose their columns, control how blocks flow across pages, add filter parameters, preview the template with live data, export it to PDF or Excel, and publish it as a report.

![Report Designer canvas with a bound template open](report-designer-canvas.png)

## Before you begin

- You need the Lab Admin or Lab Manager role.
- Write and save the query that will supply the report's data first — see [Custom Queries](/docs/query). You can also do this later and come back to bind it.
- Know the layout you want: single page or multi-page, and which columns the table should show.

## Steps

1. Open **Report Designer** from the main navigation.
2. Choose **New template** from the **⋯** menu, or select an existing template in the left explorer to keep working on it.
3. Set the template's name in the field at the top of the canvas.
4. Use **⋯ → Insert** to drop an element onto the page: Text, Table, Key/value panel, Image, Barcode, QR code, Line, Rectangle, Date, Cell grid, or Chart. Drag to reposition and use the resize handles to size it. A selected element shows its name in a tag above its box.
5. Select the **Table** element and open its **Data** tab. Choose **Bind query** to pick a Custom Query, then **Load columns** and check off which columns appear on the report — reorder and relabel them as needed. **Sort by column** orders the rows before drawing; turn on **First data row is the header** when the query emits its column labels as its first row (it needs Sort by set). **Transpose** in the Properties tab flips a wide table so its columns become rows.
6. For a **Cell grid**, bind the query in the **Data** tab and set the label column, cell columns, palette steps, and trailing columns in the **Properties** tab.
7. For a **Chart**, bind the query in the **Data** tab, then pick the chart type (bar, line, or donut), the label column, and the value columns in the **Properties** tab. Charts print as sharp vector shapes; a bound chart also exports its rows to Excel.
8. Still in the **Data** tab, use **Add parameter** to define the filters the report will expose (Text, Select, or Date range). Give each one a clear label — these become the filters shown when the report runs. Match a parameter's **Key** to a bound query's parameter **Variable ID** so the filter value flows into the query when the report runs.
9. Choose **Preview** to render the template to PDF using live data.
10. Select **Save**. The save status next to the template name shows Saved, Saving, or Unsaved changes; the designer also autosaves as you work.
11. Use **⋯ → Export → PDF** or **Excel** to download the current template's output directly.
12. When the template is ready, choose **⋯ → Publish**. Give the report a **Name**, **Category** (add, rename, or reorder categories from the same picker), an optional **Description**, and confirm the **Template** and **Primary query** — the primary query's rows feed the published report's Spreadsheet tab and summary. Select **Create report**.

## Expected result

The template saves and appears in the left explorer. Preview renders a PDF using the template's live data. Publishing adds a new entry to the [Reports](/docs/reports) library under the chosen category, with filters that match the template's parameters.

## Troubleshooting

- **Publish is unavailable or prompts you to save first:** a template must be saved at least once before it can be published.
- **No columns to choose from:** pick a query in **Bind query**, then select **Load columns**.
- **Preview fails to render:** check that the bound query and its parameters are valid, then try again.
- **Nothing to export:** the template has no table elements yet.
- **A table's rows run onto extra pages:** this is expected — tables paginate automatically across multiple pages when the data doesn't fit on one.

## Advanced web usage

- The strip above the canvas shows how many physical pages the design prints as. Choose **Load pages** to run the bound queries and get a real count — the count is a snapshot, and the strip says when the design has been edited past it. An overflowing table also gets a dashed line on the canvas where its first page ends.
- **Show data** in the header fills bound tables, grids and charts with the rows the page strip already loaded, so you can size a box against real content. It shows only the rows the first page actually holds, which is the whole point: the canvas should never promise more than the PDF prints. Load pages first; the toggle is disabled until there is data.
- The **Flow** section in the Properties tab controls how blocks behave when a table or grid runs onto extra pages: **Place below** pins an element under another and moves it up when the block above finishes early, **Gap after** sets the space between them, **First page only** stops a summary band from repeating on continuation pages, **Show with** ties a heading to its table so the two appear and disappear together, and **Fill to bottom of box** lets a cell grid grow to its declared bottom edge.
- A bound table's Data tab can add a **Totals row** (type a label, tick the columns to sum) and a text element can show `{{sum(elementName.columnKey)}}`. A per-column **rule** ("When ≥ 10 → Critical") highlights values without touching SQL; a status column from the query always wins over a rule.
- Tick **Trend** on a bound column to draw its value as a miniature line inside the cell. The query supplies the numbers as one delimited string, for example `12,14,11,18`. Anything that is not two or more clean numbers prints as text instead, and Excel always exports the raw string rather than a picture.
- **⋯ → Versions** lists every published version of the design with who published it and when. **Restore** loads one back into the working copy as an ordinary edit: it lands as a single undo step, autosave persists it, and it does not publish. Preview it, undo it, or publish it deliberately.
- The **Print language** picker at the top of the Properties tab switches the content field between the design's own text and one language's translation. With a language picked, the box holds that language's text and shows the authored text as its placeholder, so an empty box means "prints as authored". Preview and Download render the language you are editing. A report printed from [Reports](/docs/reports) uses your current studio language, and `openldr report run <id> --format pdf --lang fr` does the same headless. Only text you typed is translated; query results, laboratory details and barcode values never are.
- A **draft** design prints a diagonal DRAFT stamp on every page; publishing removes it.
- The **Letterhead** element is the shared identity band (logo, name, address, contact, rule). Its layout is defined once, so every design that uses it updates together; the values come from Settings, Laboratory.
- Turn on **Page numbers** in the page settings to add a footer to every page.
- A template can span several pages — add and arrange elements independently on each one.
- In the **Layers** tab, the eye hides an element (it leaves the canvas and the PDF; the block below a hidden element moves up), the lock keeps it selectable but immovable, and rows reorder by drag or the raise and lower buttons.
- Select two or more elements and choose **⋯ → Group selection** to name them as one group. Clicking any member then selects the whole group; hold **Alt** to reach a single element inside it. The **Layers** tab shows each group as a header row with its own eye and lock, which apply on top of each element's own: locking a group never unlocks an element you locked by itself. **Ungroup** removes the group and leaves the elements alone.
- **Ctrl+D** duplicates the selected elements, **Ctrl+C** and **Ctrl+V** copy and paste them. Clones arrive slightly offset, selected, and never locked.
- Use **⋯ → Duplicate** to branch a new template from an existing layout, and **⋯ → Delete** to remove one you no longer need.
- From [Reports](/docs/reports), managers can jump straight back into a published report's template with **Edit template**.
- Use **Undo/Redo** and the zoom controls while arranging elements precisely.

## Related guides

- [Reports](/docs/reports)
- [Custom Queries](/docs/query)
- [Connectors](/docs/connectors)
