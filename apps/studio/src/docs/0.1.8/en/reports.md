# Reports

Use Reports to run a library entry with filters, read its Document or Spreadsheet, export output and inspect its history. A schedule saves an output file for a reporting period. It does not email that file.

Start with a report suited to your own received data. No documentation sample data is required. The pictures use the Request summary report created in Report Designer. Its test warehouse has zero requests, so the query returns one row containing zero.

You need **View reports** to open the library, **Run reports** to execute entries and **Export reports** to download outputs. **Edit report templates** permits schedule management, Edit template and report-management actions.

To add a library report, save a design and use Create report from this design in [Report Designer](/docs/report-designer). Publish revision alone does not add a library entry.

## Find and open a report

Use the report name and category to choose the intended entry before setting filters.

### 1. Open Reports

Select Reports in the main menu.

![Open Reports from the main menu.](reports-guide-open-page.png)

### 2. Search the library

Enter part of the report name in Search reports. Clear it to restore the full library.

![Search the library by report name.](reports-guide-search.png)

### 3. Select the report

Select its name under the category. The example is Request summary report under Operational.

![Select the report under its category.](reports-guide-select-report.png)

### 4. Open its actions

Select Actions beside the selected report heading.

![The selected report has its own Actions menu.](reports-guide-report-actions.png)

## Choose filters and run the report

Choose dates and other filters that answer your reporting question. The query behind the example includes both selected calendar endpoints.

### 1. Open Parameters

Choose Parameters from the selected report Actions menu.

![Parameters opens the report filters.](reports-guide-first-parameters.png)

### 2. Open the date range

Select the Period control. Other reports may call this Date range or use different filters.

![Open the date-range control for the report period.](reports-guide-first-period.png)

### 3. Choose the reporting dates

Choose a preset, such as This year, or use the month and year selectors and calendar to pick dates. Complete other required filters.

![Choose a preset or select your own calendar dates.](reports-guide-first-preset.png)

### 4. Run the report

Select Run in the parameter sheet. Wait for the completed result.

![Run executes the report with the selected filters.](reports-guide-first-run.png)

**Expected result:** Document renders the report with the selected values. The zero in this example is a valid query result.

![Document renders the selected run as a PDF.](reports-guide-document.png)

## Download the document and spreadsheet

Use Document for the printable layout and Spreadsheet for exact query rows. Their column labels can differ because a design can relabel printed columns.

### 1. Download the PDF

In Document, use Download to save the PDF. Page arrows and zoom change your view.

![Download saves the PDF for this run.](reports-guide-pdf-download.png)

### 2. Open Spreadsheet

Select Spreadsheet above the result.

![Spreadsheet shows query rows in a table.](reports-guide-spreadsheet-tab.png)

### 3. Check the row values

Read the column labels and actual cells before exporting. The example shows requests equal to zero.

![Read the actual count in the spreadsheet row.](reports-guide-spreadsheet-result.png)

### 4. Export CSV when you need the query output

Select Export CSV. It re-runs the report query with the parameters that produced the displayed run. Spreadsheet filters and sorting do not apply to CSV. Source changes since the run can affect the file.

![Export CSV runs the report query with its current run parameters.](reports-guide-export-csv.png)

### 5. Export the filtered rows as XLSX

Select Export XLSX. It uses the loaded result with Spreadsheet filters and sorting across all pages. It includes all result columns, including fields hidden on screen.

![Export XLSX downloads the current spreadsheet filtering and sort.](reports-guide-export-xlsx.png)

**Expected result:** The browser downloads the chosen format. Choose the export whose row behavior matches your task.

## Filter and arrange Spreadsheet rows

These controls change the loaded Spreadsheet view. They do not change the report definition or the Document layout.

### 1. Add a filter

Select Filter, then Add filter.

![Add filter creates a spreadsheet rule.](reports-guide-filter-add.png)

### 2. Choose the column

Select the result column to filter. The example has one requests column.

![Choose the result column to filter.](reports-guide-filter-column.png)

### 3. Set the rule value

Choose an operator and enter its value. The example uses Equals and 0.

![Enter a value appropriate to your result column.](reports-guide-filter-value.png)

### 4. Apply the rule

Select Apply to update the shown rows.

![Apply changes the rows shown in Spreadsheet.](reports-guide-filter-apply.png)

### 5. Add a sort

Select Sort, then Add sort and choose a result column.

![Choose Add sort to order the loaded spreadsheet rows.](reports-guide-sort-add.png)

### 6. Choose the direction

Use Asc or Desc and select Apply. This example has one row, so its order does not visibly change.

![Asc sorts from smaller values upward; select it to switch direction.](reports-guide-sort-order.png)

### 7. Choose visible columns

Open Columns and use its checkboxes. The last visible column cannot be hidden. Close the menu when finished.

![Columns changes which fields are visible on the page.](reports-guide-columns.png)

![Use the checkboxes for the fields you need. The last visible column cannot be hidden.](reports-guide-column-options.png)

### 8. Reset or use the pages

Reset clears the table rules and column changes. Use Rows per page and the arrows when the result spans more than one page.

![Reset clears spreadsheet filters, sorting and column changes.](reports-guide-reset-table.png)

![Use the table page size and arrows when there are more rows.](reports-guide-pagination.png)

## Refresh a displayed result

Use this after data changes when you want the same reporting question run again.

### 1. Choose Refresh

Open the selected report Actions menu and choose Refresh. It uses the values that produced the displayed result, even if you have an unfinished parameter edit.

![Refresh re-runs using the values that produced the displayed result.](reports-guide-refresh.png)

**Expected result:** The query runs again. The new count may match the earlier count.

## Inspect interactive run history

Use history to identify when a report was run or downloaded and which parameter values belonged to that run.

### 1. Open Run History

Open report Actions and choose Run History.

![Run History lists the interactive runs and saved schedule attempts.](reports-guide-history.png)

### 2. Read Activity

Check each format, row count, user and time. Preview is an interactive run; pdf, csv and xlsx identify downloads.

![Read format, row count, user and time for each interactive run.](reports-guide-history-rows.png)

### 3. Restore a previous parameter choice

Select an Activity row to put its parameters back into the report controls. Open Parameters and Run when you want a new result. Selecting history does not replay its stored output.

![Selecting an activity row restores its parameters. It does not replay the old output.](reports-guide-history-apply.png)

## Create a report schedule

Use a schedule to save output for a reporting period. The schedule has no recipient field. Check its generated file before relying on automatic runs.

### 1. Open Schedules

Open report Actions and choose Schedules.

![Schedules manages automatic output for this report.](reports-guide-schedules.png)

### 2. Choose New Schedule

Select New Schedule in the schedule sheet.

![New Schedule opens the schedule settings.](reports-guide-new-schedule.png)

### 3. Choose the frequency

Set Frequency. The example chooses Weekly.

![Choose the schedule frequency.](reports-guide-weekly.png)

### 4. Choose its day

For Weekly, choose Day of week. The example uses Mon. Monthly instead offers days 1 to 28.

![Choose the weekday for the weekly schedule.](reports-guide-weekday.png)

### 5. Choose the output format

Set Output format to CSV, XLSX or PDF. The example uses PDF.

![Choose the saved output format.](reports-guide-schedule-format.png)

### 6. Save the schedule

Open the schedule editor Actions dots and choose Save. The date window is calculated at run time rather than saved as fixed dates.

![The schedule editor has its own Actions menu.](reports-guide-schedule-actions.png)

![Save records the schedule.](reports-guide-schedule-save-step-6.png)

**Expected result:** The list shows the frequency, format, enabled switch and next due time.

![The saved schedule shows its cadence, format and next due time.](reports-guide-schedule-saved.png)

## Run a schedule now and download its saved output

Run now is useful for checking a new schedule. A queued message does not prove success. Inspect Scheduled Runs for the outcome.

### 1. Queue the run

Keep the schedule enabled and select Run now. A disabled schedule does not execute even if it shows a queued message.

![Run now queues an immediate run. Check Scheduled Runs for the result.](reports-guide-schedule-run.png)

### 2. Open Scheduled Runs

Close Schedules. Open report Actions, Run History and the Scheduled Runs tab. Reopen the sheet if the result has not arrived yet.

![Scheduled Runs separates saved schedule outputs from interactive activity.](reports-guide-scheduled-tab.png)

### 3. Read the status and period

Check OK or Failed and the recorded reporting period. A failed attempt has no output file.

![Check OK and the recorded date window before downloading.](reports-guide-scheduled-result.png)

### 4. Download the successful output

Select Download on a successful saved run.

![Download fetches the successful saved output.](reports-guide-scheduled-download.png)

**Expected result:** The downloaded PDF is the saved schedule output. It does not replace the result currently displayed on the report page.

## Disable, change or remove a schedule

Use the controls on the correct schedule row. The review turns its disposable schedule off and removes it after checking the saved output.

### 1. Disable automatic runs

Open Schedules and turn off the row switch. A displayed Next date does not override the disabled switch.

![Turn the switch off to stop future automatic runs.](reports-guide-schedule-toggle.png)

### 2. Edit the saved schedule

Select Edit on the row.

![Edit changes the saved cadence, filters or format.](reports-guide-schedule-edit.png)

### 3. Save the intended changes

Change the required settings, then use that editor's Actions and Save. The example changes its disabled schedule format to XLSX.

![This disabled example changes the future format to XLSX.](reports-guide-schedule-edit-format.png)

![Save records the schedule.](reports-guide-schedule-save-step-3.png)

### 4. Remove an unneeded schedule

Select Delete on the correct schedule row.

![Delete removes only the selected schedule.](reports-guide-schedule-delete.png)

### 5. Confirm its removal

Read the confirmation and select Delete when you intend to remove that schedule.

![Confirm the schedule removal when it is no longer needed.](reports-guide-schedule-delete-confirm.png)

**Expected result:** The selected schedule disappears. The review leaves no enabled or saved schedule for its report.

## Keep a report easy to find

Pins arrange the library in this browser. They do not change report data.

### 1. Pin the report

Point at the report row and select its star. It also appears under Pinned.

![Pin the report to keep it near the top of this browser library.](reports-guide-pin.png)

### 2. Remove the pin

Select the filled star again when you no longer need it pinned.

![Select the filled star again to remove the pin.](reports-guide-unpin.png)

## Open the linked design

Use this when an authorised manager needs to change layout or template filters.

### 1. Choose Edit template

Open report Actions and select Edit template.

![Edit template opens the linked Report Designer layout.](reports-guide-edit-template.png)

### 2. Check the design name

Confirm that Report Designer opened the intended linked design before editing it.

![The linked template opens for an authorised manager.](reports-guide-edit-template-result.png)

## Check an Unpublish attempt

Unpublish is intended to hide an entry while keeping its design. In this review, a newly created custom entry returned Action failed and stayed published. This current failure is documented here; it was not repaired.

### 1. Choose Unpublish only for the intended entry

Open that report's Actions and select Unpublish when you intend to hide it. The pictured entry is disposable test content.

![Unpublish attempts to remove the report from the library.](reports-guide-unpublish.png)

### 2. Check the actual outcome

If Action failed appears, the entry has not been unpublished. Keep its name or identifier and report the problem. Do not treat this as a successful removal.

![New custom reports currently can show Action failed instead of unpublishing.](reports-guide-unpublish-failed.png)

**Expected result:** The reviewed new-entry case failed with HTTP 400 and remained published. Other report-management actions do not establish that Unpublish succeeded.

## Delete an unneeded library report

Delete permanently removes the selected library definition. Check that the team no longer needs it. The example removes a disposable entry and keeps the main report and its design.

### 1. Choose Delete report

Open the unneeded report's Actions and select Delete report.

![Delete report permanently removes the selected library entry.](reports-guide-delete-report.png)

### 2. Confirm the named action

Read the confirmation, then choose Delete report only when you intend that removal.

![Confirm only the report entry you intend to remove.](reports-guide-delete-report-confirm.png)

**Expected result:** The entry disappears from the library. Its linked design remains available in Report Designer.

## Run an existing report on a phone

The library starts folded into a rail. Use it to choose the report, then give the result more screen space.

### 1. Expand the library

Select Expand library on the narrow rail.

![Expand the library rail on a phone.](reports-guide-phone-library.png)

### 2. Find and choose the report

Search its name and select it. Collapse the library afterward.

![Search for and open the report.](reports-guide-phone-select.png)

### 3. Choose dates

Open report Actions and Parameters. Open the date-range control and choose a preset or calendar dates. Presets wrap above a single month on a phone.

![Presets wrap above the single-month phone calendar.](reports-guide-phone-dates.png)

### 4. Run with the selected values

Select Run in the parameter sheet.

![Run remains available in the report parameter sheet.](reports-guide-phone-run.png)

### 5. Read Spreadsheet

After the run completes, select Spreadsheet and inspect the values. Wide tables can scroll horizontally.

![Spreadsheet shows the same completed query result on a phone.](reports-guide-phone-result.png)

## Understand schedule time and date windows

Report schedules run at 06:00 UTC. This editor has no separate time or timezone setting. Next and Last display in the browser's timezone. A report's own timezone filter controls data grouping, not the schedule clock.

A newly saved Daily schedule starts tomorrow. Weekly uses the next chosen weekday, never today. Monthly uses the chosen day next month. Quarterly uses the first day of the next calendar quarter.

| Frequency | Date window at run time |
| --- | --- |
| Daily | The previous UTC day. |
| Weekly | The previous seven UTC days, ending yesterday. |
| Monthly | The previous calendar month in UTC. |
| Quarterly | The previous calendar quarter in UTC. |

Run now uses that same computed window. It does not reuse the report page's chosen date range. The reporting query should include the complete end day. The review's weekly run covered 5 to 11 November 2026.

## Understand filters and report data

Filters come from the design's template parameters. Change them in Report Designer. The primary query supplies Spreadsheet rows; the design's element bindings supply Document content. A report can therefore contain several bound tables while Spreadsheet shows its primary query.

The current Reports page supplies date filters as flat from and to values. A workbench Custom Query declaring one nested daterange parameter fails when bound directly here. The existing reporting pattern uses two Text query parameters named from and to, with one Date range control on the template. See Report Designer.

Different reports require different received data. A report needing specimens, organisms or susceptibility results cannot invent them from an unrelated order count. An empty result can be correct for the chosen filters or available source data.

For built-in reports, Facility generally means the testing laboratory. Read that report's filter help and query before assuming it groups the clinic that sent a request.

## Run a report from the CLI

Use `./openldr` in your installed Linux or macOS folder, `.\openldr.ps1` on Windows, or `pnpm openldr` in a development checkout. Run it from your actual `openldr_ce` folder. [Start here](/docs/start-here) explains the launcher and file paths.

```shell
./openldr report list
./openldr report run REPORT_ID --param from=2026-01-01 --param to=2026-11-12 --json
./openldr report run REPORT_ID --param from=2026-01-01 --param to=2026-11-12 --format pdf --out data/report.pdf
```

Replace REPORT_ID with the entry listed by the first command. Replace dates and output paths with the values you intend. The reviewed CLI JSON run returned one row with requests equal to zero.

## Optional review output

Normal use needs your reports and received data. No documentation bundle is required. To build the same small practice report, use the optional reporting query in [Report Designer](/docs/report-designer#optional-practice-reference).

The real review downloads are [the interactive PDF](https://openldr.online/docs-samples/user-guide/reports/request-summary.pdf), [CSV](https://openldr.online/docs-samples/user-guide/reports/request-summary.csv), [XLSX](https://openldr.online/docs-samples/user-guide/reports/request-summary.xlsx) and [the saved scheduled PDF](https://openldr.online/docs-samples/user-guide/reports/scheduled-request-summary.pdf). They contain only a zero request count.

## Troubleshooting

**The library is empty.** Clear its search and check View reports. A design publication alone does not create a library entry.

**Run is unavailable.** Complete required filters and check Run reports. A custom query can still require values that the template did not mark required.

**A report returns no rows.** Check the date window, facility choice and the source records that report needs. A sample file is not a prerequisite for real reporting.

**A custom report says required parameter: period.** Check the date-parameter shape described above. A successful designer preview does not prove a Reports run.

**A scheduled run is missing.** Check the enabled switch, then close and reopen Scheduled Runs. A queued message alone is not proof of execution.

**A scheduled run is Failed.** On a computer, point at its status to read the recorded error. Correct the actual settings and try Run now again.

**Unpublish says Action failed.** The reviewed newly created report failed this action and stayed published. Report its identifier. This guide does not claim that operation succeeded.

## Related guides

[Report Designer](/docs/report-designer) defines page layout and creates library entries. [Query](/docs/query) defines data. [Scheduled reports with workflows](/docs/report-pipeline) covers custom workbook and email workflows.
