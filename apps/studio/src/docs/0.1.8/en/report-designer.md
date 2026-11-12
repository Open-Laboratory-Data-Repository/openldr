# Report Designer

Use Report Designer to arrange printable elements, bind them to saved Custom Queries and create reports for the library. A design controls the page. A query supplies rows. Template parameters define the filters people enter when running a report.

Start with your own saved query and intended page layout. No documentation sample data is required. The pictures use a zero-request reporting query in a separate test installation. Optional practice is at the end.

You need **Edit report templates** to create, edit and publish designs. **View reports** opens the library, and **Run reports** executes its entries.

Publishing a design revision and creating a library report are separate actions. Save the new design before either action.

## Inspect an existing report design

Use this to understand the connection between an existing table, its query and the filters the report exposes.

### 1. Open Report Designer

Select Report Designer in the main menu.

![Open Report Designer to inspect and build report layouts.](report-designer-guide-open-page.png)

### 2. Choose a template

Select an existing entry in Templates. The example opens Test Volume Over Time.

![Select an existing design from Templates.](report-designer-guide-existing-template.png)

### 3. Select its table

Select the table element on the printable page.

![Select the table element on the page.](report-designer-guide-existing-table.png)

### 4. Read its Data settings

Select Data in the right inspector. Check Bind query and the template Parameters below it.

![Data shows the query binding and template parameters.](report-designer-guide-existing-data-tab.png)

![The bound query supplies table rows; template parameters define run filters.](report-designer-guide-existing-binding.png)

## Create a separate table design

Use a new design for your report rather than changing a shared built-in definition.

### 1. Choose New template

Open More actions above the canvas and select New template. The empty designer also offers New template.

![More actions contains template operations.](report-designer-guide-actions.png)

![New template starts a separate design.](report-designer-guide-new-template.png)

### 2. Name the design

Enter a clear Report name, such as Request summary design.

![Set Report name to the value your report needs.](report-designer-guide-design-name.png)

### 3. Insert a table

Open More actions, point at Insert and select Table.

![Insert lists printable element types.](report-designer-guide-insert.png)

![Table adds a data table to this design.](report-designer-guide-insert-table.png)

### 4. Select the table

The inserted Table is selected. Drag it to the intended position and use its resize handles when you need another size. The example keeps its initial position.

![The new table is selected for configuration.](report-designer-guide-new-table.png)

## Choose the table query

Use a saved query that returns the intended columns. When that query has parameters, define matching template defaults before loading columns.

### 1. Open Data

With the table selected, select Data in the inspector.

![Open Data for the selected custom table.](report-designer-guide-new-data-tab.png)

### 2. Bind the saved query

Open Bind query and choose your Custom Query. The example uses Request count for reporting, with two required Text query parameters named from and to.

![Choose your saved Custom Query.](report-designer-guide-bind-query.png)

## Define the report filter and preview defaults

For Reports, the current date-range filter passes flat from and to values. The example query declares those as two required Text parameters. The template provides one Date range control. A workbench query declaring one daterange parameter currently fails when bound directly to Reports.

### 1. Add a template parameter

Select Add parameter below the binding settings.

![Add parameter defines a filter exposed by this template.](report-designer-guide-add-parameter.png)

### 2. Match the query key

Set a unique template Key, such as period. This date-range control supplies the from and to values used by the reporting query.

![Set Key param1 to the value your report needs.](report-designer-guide-parameter-key.png)

### 3. Choose the visible label

Set Label to what people should see, such as Period.

![Set Label period to the value your report needs.](report-designer-guide-parameter-label.png)

### 4. Match the parameter type

Set Type to Date range. The reporting query itself uses two Text parameters named from and to.

![Choose Date range to match the query parameter.](report-designer-guide-parameter-type.png)

### 5. Set the default start

Enter the default first included date. The example uses 2026-01-01.

![Set From period to the value your report needs.](report-designer-guide-parameter-from.png)

### 6. Set the default end

Enter the default last included date. The example uses 2027-01-01. The reporting query includes the full end day, matching the report calendar and scheduler. These are preview defaults; report users can choose other values.

![Set To period to the value your report needs.](report-designer-guide-parameter-to.png)

## Choose and preview the printed column

Load columns uses the template defaults to run the bound query. The count query returns a requests column even when the warehouse contains no requests.

### 1. Load the query columns

Select Load columns. Read an error if the query or parameter defaults are invalid.

![Load columns runs the query using the template defaults.](report-designer-guide-load-columns.png)

### 2. Include the column

Tick requests to include it in the table. Choose the actual output columns needed by your own report.

![Include the requests column in the printed table.](report-designer-guide-include-column.png)

### 3. Set its printed label

Enter a readable column label, such as Requests. This changes the printed label, not the query field.

![Set Label for column requests to the value your report needs.](report-designer-guide-column-label.png)

### 4. Load the page data

Select Load pages above the canvas. It runs the bound data and calculates a physical page count.

![Load pages fetches rows and calculates the printed page count.](report-designer-guide-load-pages.png)

### 5. Show loaded data

Select Show data. Reload pages after edits when the count is stale.

![Show data fills the canvas using the loaded rows.](report-designer-guide-show-data.png)

**Expected result:** The table shows the real count. This installation prints one Requests column containing zero.

![The printed column contains the live count, including zero.](report-designer-guide-bound-result.png)

## Save and inspect the PDF

Save a new design explicitly. Then check the actual rendered page before publishing it.

### 1. Save the design

Open More actions and select Save. Wait for Saved. After the first save, later edits also autosave.

![Save persists the new design before publication.](report-designer-guide-save.png)

### 2. Open Preview

Open More actions and select Preview.

![Preview renders the current working design as a PDF.](report-designer-guide-preview.png)

### 3. Check and download the rendered page

Read the PDF preview and use Download when you need a local copy. Close the preview to return to editing.

![The preview shows actual query output in the printable design.](report-designer-guide-preview-result.png)

![Download saves the rendered PDF.](report-designer-guide-preview-download.png)

**Expected result:** The preview renders the current working design with query data. A draft design carries a DRAFT stamp.

## Publish a saved revision

Publish after checking the saved design. A revision records the published state; it does not add a Reports library entry.

### 1. Publish the revision

Open More actions and select Publish revision. Save first if the designer asks.

![Publish revision snapshots the saved design. It does not create a library report.](report-designer-guide-publish.png)

### 2. Check the published status

Check the Published status beside the design name.

![Published confirms the design revision.](report-designer-guide-published.png)

**Expected result:** The saved design has a published revision.

## Inspect published versions

Use this to identify the saved revision before considering a restore.

### 1. Open Versions

Open More actions and select Versions.

![Versions lists published snapshots.](report-designer-guide-versions.png)

### 2. Read the revision row

Check its version, publication time and publisher. Restore loads that snapshot into the working copy as an edit. It does not publish another revision. Close the sheet if no restore is needed.

![Read the revision, publication time and publisher before restoring.](report-designer-guide-version-row.png)

## Create the report library entry

Use this after the design and query are ready. The library report can have a different name from its design.

### 1. Choose Create report from this design

Open More actions and select Create report from this design.

![Create report from this design creates a separate library entry.](report-designer-guide-create-report.png)

### 2. Name the report

Enter the library Name. The example uses Request summary report.

![Choose the library report name.](report-designer-guide-report-name.png)

### 3. Choose its category

Open Category and choose the category where people should find it, such as Operational.

![Choose the category where people should find the report.](report-designer-guide-report-category.png)

### 4. Check the linked definitions

Confirm Template and Primary query. The template controls Document layout; the primary query supplies Spreadsheet rows.

![Check the template selected for this report.](report-designer-guide-report-template.png)

![Check the primary query that will supply spreadsheet rows.](report-designer-guide-report-query.png)

### 5. Create the library entry

Open the sheet's Actions dots and select Create report.

![The New report sheet has its own Actions dots.](report-designer-guide-report-actions.png)

![Create report adds the named library entry.](report-designer-guide-report-create.png)

**Expected result:** The named entry is available under its category in Reports. Open its Parameters and run it there. [Reports](/docs/reports) covers that workflow.

## Export directly from the designer

Use these exports when you need output from the current design without opening its library report.

### 1. Export PDF

Open More actions, point at Export and select PDF.

![Export PDF downloads the current design output.](report-designer-guide-export-pdf.png)

### 2. Export Excel

Open More actions, point at Export and select Excel. Bound table rows become workbook data.

![Export Excel downloads the bound table rows.](report-designer-guide-export-excel.png)

**Expected result:** The browser downloads the rendered PDF or workbook.

## Control element visibility and locking

Layers provides direct controls for selected elements. Hiding affects output. Locking prevents movement.

### 1. Open Layers

Select Layers in the inspector.

![Layers selects elements and controls visibility, locking and order.](report-designer-guide-layers.png)

### 2. Hide an element when intended

Use Hide Table, the eye control, for the selected table. Hidden elements do not appear in the canvas or PDF.

![Use the eye to hide an element deliberately.](report-designer-guide-hide-layer.png)

### 3. Show it again

Use Show Table to restore it.

![Use Show Table to restore the hidden element.](report-designer-guide-show-layer.png)

### 4. Lock its position

Use Lock Table to prevent movement while keeping it selectable.

![Lock keeps the element selectable while preventing movement.](report-designer-guide-lock-layer.png)

### 5. Unlock it again

Use Unlock Table when you intend to move it. The example leaves the table visible and unlocked.

![Unlock Table allows movement again.](report-designer-guide-unlock-layer.png)

## Inspect an existing design on a phone

Use a large screen for building page layouts. On a phone, find and inspect an existing template, or run its report in Reports.

### 1. Expand the Explorer

Select Expand explorer on its narrow rail.

![Use the Explorer rail to find an existing template on a phone.](report-designer-guide-phone-explorer.png)

### 2. Choose the existing template

Select its name, then collapse the Explorer when you need canvas space.

![Choose the existing design. Use a larger screen to edit it.](report-designer-guide-phone-template.png)

### 3. Open its actions

Use More actions to inspect the available operations. Make layout edits on a larger screen.

![Use More actions to inspect an existing design.](report-designer-guide-phone-actions.png)

## Choose page elements and layout tools

Insert also offers Text, Letterhead, Key/value panel, Image, Barcode, QR code, Line, Rectangle, Date, Cell grid and Chart. Select an element to edit its Properties. The one-table task above does not require those extra elements.

Properties controls paper size, orientation and page numbers when no element is selected. It also controls element position, dimensions and appearance. Undo and Redo step through edits; zoom changes only your view.

For a Chart or Cell grid, bind a query in Data and choose the corresponding label, value or cell columns in Properties. Check the rendered output with your own rows.

Flow settings can place one element below another or control repeated content on continuation pages. Load pages after changing layout to check the physical page count. Show data displays only rows that fit the canvas page.

## Keep report text and query fields separate

A printed column label can differ from the query field name. Use the Data tab label fields for the visible wording. Keep binding keys matched to actual query output.

The Print language selector in Properties edits one language's report text. Empty translations fall back to authored text. Query output itself is not translated by changing the design language.

A Letterhead uses laboratory identity configured in Settings. It can give several designs the same logo, name and contact band.

## Manage designs carefully

More actions includes Duplicate and Delete. Duplicate starts a separate design for a variation. Delete permanently removes a design after confirmation; check linked reports first.

Versions Restore changes the working copy and can be undone. Preview the restored design before publishing deliberately. Publishing another revision does not require another library report for the same design.

Create report from this design adds a separate library entry. It does not replace Publish revision. A published design absent from Reports still needs the library-creation step.

## Optional practice reference

[Download the optional reporting count query](https://openldr.online/docs-samples/user-guide/report-designer/report-count-query.json). Import it through Query if you want a reference. It uses required Text parameters named from and to, which match Reports' current date-range input. It needs no patient sample data. Use your own approved query for normal reporting.

[Download the published example PDF](https://openldr.online/docs-samples/user-guide/report-designer/published-summary.pdf) or [its exported workbook](https://openldr.online/docs-samples/user-guide/report-designer/summary-design.xlsx) to compare the one-column result. These files contain only a zero count.

## Troubleshooting

**No columns appear.** Choose Bind query, configure needed template defaults and select Load columns.

**The canvas remains empty.** Include at least one bound column, then Load pages and Show data. Read query errors before changing the layout.

**The save status shows an error.** Resolve it before publishing. A new template needs an explicit first Save.

**Create report is unavailable.** Save the design, then fill Name, Category, Template and Primary query in the New report sheet.

**Preview and output differ from expected rows.** Match template keys to query parameter identifiers and check the defaults and SQL date boundaries. The reporting example includes both calendar endpoints.

**A table prints across several pages.** Data can continue beyond the first page. Load pages and inspect the PDF to check the actual count.

**Reports says required parameter: period.** A Custom Query declaring one daterange parameter works in Query but currently receives no nested range from Reports. Use the reporting pattern of two Text query parameters named from and to, referenced by the SQL. Do not assume a successful designer preview proves a library run.

## Related guides

[Query](/docs/query) creates saved data queries. [Reports](/docs/reports) runs library entries and schedules output. [Laboratory](/docs/laboratory) configures shared identity values.
