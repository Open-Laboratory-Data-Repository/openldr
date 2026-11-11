# Laboratory

**Settings → Laboratory** sets who your laboratory is: the name, address, contact and logo printed as the letterhead on every report. It also sets the default facility register for new facilities and the laboratory time zone.

This guide takes about 10 minutes. Select any picture or clip to enlarge it.

## Who can do what

| Permission | What it allows |
| --- | --- |
| **View settings** | Open the Laboratory page |
| **Edit general settings** | Save changes to it |

Anyone who can view reports sees the letterhead on them.

## Example 1: set the letterhead

![Typing the laboratory name, address, contact and time zone, then saving from the dots menu.](laboratory-identity.mp4)

1. Open **Settings**, then **Laboratory**.
2. In **Laboratory name**, type `Sample Central Laboratory`.
3. In **Address**, type `1 Sample Road, Sample City`. Press Enter for a new line.
4. In **Contact**, type `lab@example.org`. A phone number or an accreditation line works too.
5. In **Time zone**, type `Africa/Dar_es_Salaam`. Use your own zone in a real install.
6. Open the page's **⋯** menu and select **Save**. A **Saved.** message appears.
7. Reload the page and check the values are still there.

Nothing saves until you select **Save**. That includes a new logo and a cleared one. If **Save** reports an error, keep the page open, correct the value, and save again.

### The logo

1. Select **Choose file…** and pick a PNG, JPEG or WebP image under 256 KB. A preview appears beside the button.
2. Select **Save** in the **⋯** menu.

**Clear** removes the logo. Save to keep that change. The logo must be an uploaded image file, not a web address, because a linked image does not print in the PDF. It is read on every report, which is why the size is capped.

## Example 2: see the letterhead on a report

This example needs the docs sample data. See [Dashboards, Load the sample data](/docs/dashboard#load-the-sample-data).

1. Open **Reports** and select **Test Volume Over Time**.
2. Open **Actions**, select **Parameters**, and set the date range to 1 September 2026 to 31 October 2026.
3. Select **Run**.

**Expected result:** the report opens with your letterhead at the top: the logo, **Sample Central Laboratory**, the address and the contact. Under it are the title, the reporting period and a table of 10 rows, one per test per month.

![The letterhead at the top of Test Volume Over Time: logo, name, address and contact.](laboratory-letterhead.png)

| Month | Test | Count |
| --- | --- | --- |
| 2026-09 | Full blood count | 10 |
| 2026-09 | Malaria rapid test | 8 |
| 2026-10 | HIV viral load | 8 |

Those are 3 of the 10 rows. Together the rows add up to 60, the number of orders in the sample.

**Download** saves a PDF with the same letterhead. CSV and XLSX outputs hold the data only. See [Reports, Example 1](/docs/reports#example-1-run-a-report) for the full steps.

### The letterhead in your own templates

A report template can place any part of the letterhead by name. The page lists the four names under its title:

| Name | Prints |
| --- | --- |
| `{{lab.name}}` | Laboratory name |
| `{{lab.address}}` | Address |
| `{{lab.contact}}` | Contact |
| `{{lab.logo}}` | Logo |

See [Report Designer](/docs/report-designer) to build a template.

## Choose a facility register

**Facility register** lists the active sources registered in [Facilities](/docs/facilities). The one you choose becomes the starting **System** when someone creates a facility by hand.

Choose the register that owns your facility codes. Its system address keeps those codes apart from another register's codes.

Saving this choice does not import facilities. It does not rename, move or change the codes of facilities you already have.

If the register you want is missing:

1. Open [Facilities](/docs/facilities), start **Import facilities**, and register the source there.
2. Come back to Laboratory and reload the page.
3. Select it in **Facility register** and save.

An empty list can also mean the sources failed to load. Check Facilities before you assume none exist.

## Time zone

The time zone decides which day a result falls on in a report. A result at 01:00 in Dar es Salaam is still the previous day in UTC.

- Type a named zone, such as `Africa/Dar_es_Salaam`. Fixed offsets are refused. `+03:00` is refused. `Etc/GMT+3` is refused too, because it means UTC−3, the opposite of how it reads.
- It sets the starting value of a report's own **Time zone** filter. You can still change it for one run.
- A scheduled run or a command-line run does not read it. Give the zone to the schedule or the command directly. See [Reports](/docs/reports).
- It does not set the hour schedules run at.
- **SQL Server warehouse:** leave it empty. SQL Server takes Windows zone names, which this field refuses. Type the Windows zone into the **Time zone** filter on each report run instead.

## From the command line

`openldr settings lab` reads and writes the same values as the page.

```bash
./openldr settings lab show
./openldr settings lab set --name "Sample Central Laboratory" --timezone Africa/Dar_es_Salaam
./openldr settings lab set --logo-file ./logo.png
```

- `--address` takes `\n` for a line break.
- An empty value clears a field, for example `--timezone ""`.
- `--logo-file` takes a PNG, JPEG or WebP file under the same 256 KB limit.

The facility register is set on the page only.

## On a phone

The page works on a phone. Labels stay to the left of their boxes, and the boxes narrow to fit. **Choose file…** opens the phone's own file picker, so a logo can come from photos or files.

## Troubleshooting

- **My changes are gone after a reload.** They were not saved. Use **Save** in the **⋯** menu and wait for **Saved.**
- **The time zone will not save.** Use a named zone such as `Africa/Dar_es_Salaam`, not an offset.
- **The logo is refused.** It must be PNG, JPEG or WebP and under 256 KB.
- **The report still shows the old name.** Run the report again. A result already shown or exported keeps the letterhead it was made with.
- **The facility register list is empty.** Register a source in Facilities, then reload this page.
- **Save says it could not save the laboratory identity.** Check the message under the field first. If there is none, your role may lack **Edit general settings**.

## Related guides

- [Settings](/docs/settings)
- [Reports](/docs/reports)
- [Report Designer](/docs/report-designer)
- [Facilities](/docs/facilities)
