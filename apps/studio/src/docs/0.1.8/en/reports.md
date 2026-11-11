# Reports

A report is a printable page of lab figures that you can run again whenever you need it. Each one joins two parts. A **Report Designer** template sets the layout. A **Custom Query** fetches the data. You run a report with a date range and other filters, read it as a document or a spreadsheet, download it, and schedule it to run by itself.

This guide takes about 30 minutes. It uses the docs sample data, so load that first. Select any picture or clip to enlarge it.

![A report after a run. 1 Search the library. 2 Report actions menu. 3 Document view. 4 Spreadsheet view. 5 Download.](reports-tour.png)

1. **Library search.** Filters the report list by name. Reports are grouped by category.
2. **Actions.** The dots menu for the selected report: **Refresh**, **Parameters**, **Run History**, **Schedules**, and, for managers, **Edit template**, **Unpublish** and **Delete report**.
3. **Document.** The printable PDF.
4. **Spreadsheet.** The same rows as a table you can filter, sort and export.
5. **Download.** Saves the PDF.

## Who can do what

| Permission | What it lets you do |
| --- | --- |
| View reports | Open **Reports** and see the library. |
| Run reports | Run a report and see its result. |
| Export reports | Download the PDF, CSV or XLSX, and download saved schedule outputs. |
| Edit report templates | Make, change and delete schedules. Use **Edit template**, **Unpublish** and **Delete report**. |

New reports are not made on this page. A lab manager builds a template in [Report Designer](/docs/report-designer) and publishes it. It then appears in the library.

## Before you start

The examples need the docs sample data. If **Total Orders** on the sample dashboard reads 0, load it first. See [Load the sample data](/docs/dashboard#load-the-sample-data).

A new install ships ten reports in four categories:

| Category | Reports | Works with the sample data |
| --- | --- | --- |
| AMR / Surveillance | AMR Cumulative Antibiogram, AMR First-Isolate Resistance Summary, AMR Resistance Rate, AMR Resistance by Facility | No. They need microbiology results. |
| Operational | Clinical Microbiology Report, LIS Stakeholders Update, Specimen Turnaround Time, Test Volume Over Time | Turnaround and Test Volume, yes |
| Quality | Patient Demographics | Yes |
| Regulatory | AMR GLASS RIS (stratified) | No. It needs microbiology results. |

The AMR and microbiology reports read organisms and susceptibility results. The sample has none, so they come back empty. They fill once your lab system sends microbiology, for example through a WHONET export. See [Load and push data](https://openldr.online/#/docs/load-data) on the website.

## Example 1: run a report

Count the tests ordered each month in September and October 2026.

![Selecting Test Volume Over Time, setting the date range and running it.](reports-run.mp4)

1. Open **Reports**.
2. In the library, under **Operational**, select **Test Volume Over Time**. The page says **Run the report to see results.**
3. Open **Actions** and select **Parameters**. A side panel lists the report's filters. A star marks a required one.
4. Select **Date range**. Go back to September 2026. Select 1 September, then 31 October.
5. Leave **Facility** on **All**.
6. Select **Run**. The panel closes and the report runs.

**Expected result:** **Total tests** reads 60. The document has ten rows, one per test per month. In October: Blood glucose 3, Creatinine 5, Full blood count 8, HIV viral load 8, Malaria rapid test 8.

The filters come from the template's parameters. To add, remove or rename one, change the template in [Report Designer](/docs/report-designer), not this page. A report remembers the last values you ran it with, in this browser.

## Read the result

The document view has page arrows, zoom and **Download**. **Download** saves the PDF and records a `pdf` run in the history.

Select **Spreadsheet** to see the same rows as a table.

![The Spreadsheet view, with Filter, Sort, Columns and the two exports.](reports-spreadsheet.png)

- **Filter.** Choose a column, an operator and a value, then **Apply**. Remove a filter chip to clear one rule, or use **Clear all**.
- **Sort.** Changes the order.
- **Columns.** Hides and shows columns.
- **Export CSV** and **Export XLSX.** Download the rows for other tools.

Use the spreadsheet when you need exact values, or to feed the rows into another tool.

### What "Facility" means in the built-in reports

The **Facility** filter and the facility columns in the built-in reports mean the **testing laboratory**, the lab that ran the test. They do not group by the clinic that sent the sample. On a new install the Facility list is empty until a facility register is loaded. See [Facilities](/docs/facilities).

## Run history

Open **Actions** and select **Run History**.

![Run History. Activity lists each interactive run, with its format, rows, user and time.](reports-history.png)

- **Activity** lists interactive runs. `preview` is a run on this page. `pdf`, `csv` and `xlsx` are downloads.
- **Scheduled Runs** lists schedule attempts, their status, and the saved file. **Download** beside a good run fetches its CSV, XLSX or PDF.

Use the history to compare repeated runs, and to check whether a result changed after new data arrived. For who changed report settings or schedules, see [Audit](/docs/audit).

## Example 2: specimen turnaround time

See how long each test takes from specimen received to report issued.

![Specimen Turnaround Time for September and October 2026.](reports-turnaround.png)

1. In the library, select **Specimen Turnaround Time**.
2. Open **Actions**, then **Parameters**. Set **Date range** to 1 September to 31 October 2026.
3. Select **Run**.

**Expected result:** **Reports** reads 39 and **Avg hours** reads 358.6. Blood glucose averages 137.7 hours, HIV viral load 288.0, Malaria rapid test 349.8, Full blood count 392.5 and Creatinine 615.0.

Those hours are far longer than the hours each sample really took. This report measures from the patient's **earliest** received specimen to each report. The sample has patients with several orders over two months, so a later report is timed from the first specimen. Keep this in mind for patients with repeat tests, such as HIV viral load monitoring.

## Example 3: schedule a report

Make Test Volume run every Monday and save a PDF.

![Opening Schedules, making a weekly PDF schedule and saving it.](reports-schedule.mp4)

1. Select **Test Volume Over Time**. Open **Actions** and select **Schedules**. Your role needs **Edit report templates**.
2. Select **New Schedule**.
3. Set **Frequency** to **Weekly**. Set **Day of week** to **Mon**.
4. Set **Output format** to **PDF**. Leave **Facility** on **All**.
5. Open the schedule's own **Actions** menu and select **Save**. A **Schedule saved.** message appears.

**Expected result:** the list shows **Weekly · Mon**, a **PDF** badge, an enabled switch, and the **Next** run.

![The saved schedule, with its switch, Run now, edit and delete.](reports-schedules.png)

Each schedule row has a switch to turn it on and off, a play button, **Run now**, a pencil to edit, and a bin to delete.

### Frequency, time and date window

- **Daily**, **Weekly**, **Monthly** or **Quarterly**. Weekly needs a day of the week. Monthly offers days 1 to 28.
- Every schedule runs at 06:00 UTC. You cannot pick another hour or time zone.
- **Next** and **Last** show in your browser's time zone.
- A report's **Time zone** filter sets how its data is counted, not when the schedule runs.
- A new schedule starts with the report page's current filters, except the date range.

The date range is not saved. The scheduler works out the window when the run starts, including **Run now**:

| Frequency | Next date when saved | Date window |
| --- | --- | --- |
| Daily | Tomorrow | The previous UTC day |
| Weekly | The next chosen weekday, never today | The previous seven UTC days, ending yesterday |
| Monthly | The chosen day next month | The previous calendar month in UTC |
| Quarterly | The first day of the next calendar quarter | The previous calendar quarter in UTC |

A disabled schedule can still show **Next**. That date does not mean it will run. Check the switch. **Last** can be a failed attempt. Check its status in the history.

### Run now and download the output

1. Turn the schedule on, then select **Run now**.
2. A message says the run was queued. That does not mean it worked. A disabled schedule shows the same message and runs nothing.
3. Open **Actions**, **Run History**, **Scheduled Runs**. Automatic runs and **Run now** results appear here when they finish.
4. Select **Download** beside a successful run. You need **Export reports**.
5. If the run is missing, close and reopen **Scheduled Runs**. The list does not refresh by itself.

A failed run has no file. On a computer, point at its failed status to read the error. Fix the schedule's filters and try **Run now** again. A scheduled run never replaces what the report page shows.

## Manage a report

With **Edit report templates**, the report's **Actions** menu also has:

- **Edit template.** Opens the template in [Report Designer](/docs/report-designer).
- **Unpublish.** Removes the report from the library and keeps the template.
- **Delete report.** Removes it, after you confirm.

## On a phone

On a phone, the library starts folded into a thin strip on the left. Select the panel button at the top of the strip to open it. Long names are cut short in the list. The full name shows once you select the report. Fold the library again to give the report the whole screen.

![The report library opened on a phone.](reports-phone.png)

## Limits

Each stored report query returns at most 1,000 rows. Exactly 1,000 is accepted. If any query behind a PDF goes over, the whole PDF is refused. CSV and XLSX exports refuse too. Narrow the date range or other filters and run again. A `LIMIT` written in the saved SQL is kept on purpose.

A scheduled run over the limit records a failure and saves no file. The CLI reports the error before writing the export. Earlier saved outputs are not made again.

## The LIS Stakeholders Update

This report shows, per testing laboratory, whether any data reached OpenLDR on each working day of a month.

- Dates sit in the column header, day number over month, and repeat on every page.
- A filled cell means data arrived that day. An empty cell means none did.
- Weekends are left off. No public-holiday calendar applies, so a holiday still counts as a working day.
- Days are counted in the time zone set at **Settings**, **Laboratory**, **Time zone**. The run's own **Time zone** filter starts from that setting, and you can change it. A scheduled or CLI run does not read the setting, so give it the zone directly.
- **HVL/EID panel codes** takes the codes your programme counts as HVL or EID, on each run. Everything else falls into the Other grid.
- A laboratory that sent nothing that month is not on the grid.
- The **Spreadsheet** view and the CSV are the raw query result. Their first row carries the column dates, not a laboratory, and they include the sort column the page hides. Skip that first row when you feed the file to another tool.

## The Clinical Microbiology Report

This report takes the **lab number** as its Request ID: the number on the request form and the specimen label, as the lab system sends it, for example `TZDISATDS0013538`.

A lab system often splits one microbiology result into several orders under one lab number. The culture that grew the organism is one order, the susceptibility panel another. The report reads every order under the lab number and prints one isolate with its susceptibilities on one page. A specimen that grew more than one organism is refused, not merged, because two antibiograms under one organism name would read as one isolate. A single order id also works.

## Troubleshooting

- **Run is greyed out.** A required filter is empty. Open **Actions**, **Parameters**, and fill every filter marked with a star. Most reports need a date range.
- **"date range not selected", or a message naming a parameter.** The report ran without a value it needs. Set it in **Parameters** and run again. The message names the parameter.
- **The result is empty.** Widen the date range, clear optional filters, or check that the data is loaded. The AMR reports stay empty without microbiology data.
- **"no data for this report request" on the Clinical Microbiology Report.** That lab number has no microbiology. A chemistry or serology request has no organism. The report refuses rather than printing an empty page, because a microbiology report with no organism reads like a negative culture. Check the request's panels in **Query** first.
- **A microbiology report shows an organism but no susceptibilities.** Usually a real result. The culture grew something and no sensitivity testing was done.
- **Every microbiology report has an empty susceptibility table.** Check **Terminology** for the AST interpretation value set first. The report picks susceptibilities from that value set. If it never loaded on this install, every table is empty, which looks like cultures with no sensitivity testing. One empty table is a result. All of them is a setup problem.
- **An antibiogram shows an `(unmapped)` column.** These are susceptibility results the report could not tie to one antibiotic, often a panel summary row, one result reporting two drugs, or a microscopy finding recorded as S, I or R. They are shown so the count is visible. A large number is a data-quality problem to raise with whoever sets up the analyser.
- **Turnaround hours look far too long.** See [Example 2](#example-2-specimen-turnaround-time). The report times each report from the patient's first specimen.
- **Permission denied.** Your role can view reports but not manage schedules, edit templates, or unpublish and delete.
- **A previous run failed.** Open **Run History**, read the error, change the filters, and run again.
- **A report you expect is missing.** It may be unpublished, or not made yet. See [Report Designer](/docs/report-designer).
- **The LIS Stakeholders Update has no data on a day you know a lab sent some.** Check **Settings**, **Laboratory**, **Time zone** first, or the run's **Time zone** filter. Days are counted in that zone, so a zone set to UTC on an install ahead of UTC can push a late-evening arrival to the previous day.
- **On a SQL Server warehouse, the Time zone setting cannot be used.** That setting takes IANA zone names only, and SQL Server takes Windows zone names. On SQL Server, leave the setting empty and type the Windows zone name into each run's **Time zone** filter. The setting works on PostgreSQL and on MySQL or MariaDB.
- **The run is refused with a message naming the Time zone filter.** The filter got a signed offset such as `+3`, `+03:00` or `Etc/GMT+3`. These are refused on purpose. The database reads the sign the other way round, so `+3` means three hours behind UTC, and the grid would shift by twice the offset with nothing on the page to show it. Type a named zone such as `Africa/Nairobi`, or the Windows zone name on SQL Server. A zone name the warehouse does not know is not refused here. The warehouse reports it clearly itself.
- **A laboratory is missing from the LIS Stakeholders Update.** It sent nothing that month. If every laboratory is missing, see the next item first.
- **Every laboratory is missing on a MySQL or MariaDB warehouse.** The server's time-zone tables are probably not loaded. Until someone runs `mysql_tzinfo_to_sql` on that server, every day comes out empty. The grid draws its date header with no rows, which looks like a month where nothing arrived. Ask the warehouse administrator to load the zone tables. PostgreSQL and SQL Server are not affected.
- **The HVL/EID grid is empty but the Other grid is not.** The codes in **HVL/EID panel codes** do not match what this lab sends. The filter is required, so it was not blank. Open **Query**, find a request you know is an HVL or EID test, and read its panel code. That exact spelling, punctuation and case included, is what the filter needs.

## Related guides

- [Report Designer](/docs/report-designer)
- [Custom Queries](/docs/query)
- [Dashboards](/docs/dashboard)
- [Audit](/docs/audit)
