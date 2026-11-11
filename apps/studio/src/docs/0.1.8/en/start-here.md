# Start here

OpenLDR Studio is where a laboratory's results come together. You read them on dashboards and in reports, query them, and set up how data arrives. This page shows you around and gives you a first hour on a new install, with the sample data loaded.

Select any picture or clip to enlarge it.

![Studio after sign-in. 1 Main menu. 2 Notifications. 3 Light or dark. 4 Your user menu. 5 Fold the menu.](start-here-tour.png)

1. **Main menu.** One entry per area. You only see the areas your role allows.
2. **Notifications.** The bell opens your latest notifications.
3. **Light or dark.** Switches the colour theme.
4. **User menu.** Your name, at the bottom left. It holds **Language**, **Settings** and **Sign out**.
5. **Fold the menu.** Shrinks the main menu to icons, to give pages more room.

The yellow shield beside the bell appears only on a test install where sign-in is turned off. A real install does not show it.

## The main menu

| Menu entry | What it is for | Guide |
| --- | --- | --- |
| Dashboard | Charts and numbers that update by themselves | [Dashboards](/docs/dashboard) |
| Reports | Printable reports you run, export and schedule | [Reports](/docs/reports) |
| Report Designer | Templates for those reports | [Report Designer](/docs/report-designer) |
| Query | Browse the warehouse and write SQL | [Custom Queries](/docs/query) |
| Workflows | How data arrives, is checked and is stored | [Workflows](/docs/workflows) |
| Terminology | Code systems, such as LOINC, and your mappings | [Terminology](/docs/terminology) |
| Facilities | The register of health facilities | [Facilities](/docs/facilities) |
| Test catalog | The national list of tests, and which ones this lab runs | [Test catalog](/docs/test-catalog) |
| Patients | Find a patient and where they were tested | [Patients](/docs/patients) |
| Forms | Capture data by hand, and build the forms | [Forms](/docs/forms) |
| Users | Who can sign in, and their roles | [Users and Roles](/docs/users) |
| Audit | Who changed what, and when | [Audit](/docs/audit) |
| Activity | Each payload as it moves through the system | [Activity](/docs/activity) |
| Docs | This manual | This page |

**Settings** is in the user menu, not the main menu. See [Settings](/docs/settings).

A missing entry means your role does not include it. Ask an administrator.

## Your first hour

Follow these on a test install. Each step links to the full guide.

1. **Load the sample data.** A new install has almost no lab data, so every number reads 0. Load the sample file. See [Load the sample data](/docs/dashboard#load-the-sample-data).
2. **Read the sample dashboard.** Open **Dashboard**. Total Orders reads 60. Filter it to October 2026. See [Dashboards](/docs/dashboard).
3. **Run a report.** Open **Reports** and run **Test Volume Over Time** for September and October 2026. See [Reports](/docs/reports).
4. **Look at the raw data.** Open **Query** and browse `lab_requests`. See [Custom Queries](/docs/query).
5. **Build something.** Make your own dashboard with a bar chart. See [Dashboards](/docs/dashboard#example-2-make-a-dashboard-and-a-bar-chart).

## Example 1: change the language

Studio speaks English, French and Portuguese.

![Opening the user menu, then Language, then Français.](start-here-language.mp4)

1. Select your name at the bottom left.
2. Select **Language**.
3. Choose **English**, **Français** or **Português**.

**Expected result:** the menu and most screens switch at once. Some labels are not translated yet and stay in English. The guides write each label as the screen shows it. Docs also switch to that language. A page not yet translated shows in English, with a note at the top.

Your choice is kept in this browser.

## Example 2: find an answer in the docs

![Searching the docs for sample data, opening Dashboards and jumping to a section.](start-here-docs.mp4)

1. Open **Docs**.
2. Type in **Search documentation**, for example `sample data`. The list on the left narrows to matching guides.
3. Select a guide. Long guides list their sections on the right, under **On this page**. Select one to jump to it.

On a narrow screen, the section list is a button with a list icon at the top right of the page.

### Download the docs

![The docs download menu: this page or all docs.](start-here-docs-download.png)

The download button at the top right saves **This page** or **All docs** as **Markdown**, **PDF** or **Word**. Clips print as a still picture in PDF and Word.

**Version** beside it shows the docs for an older release.

## Filter any table

Most lists have the same toolbar.

- **Search** matches as you type.
- **Filter** lets you pick a column, an operator and a value, then **Apply**.
- **Sort** changes the order.
- **Columns** hides and shows columns.
- Remove a filter chip to clear one rule, or use **Clear all**.

Every table has paging at the bottom, with **Rows per page**.

## Actions live in the dots menu

Studio puts actions in a menu marked with three dots, not in loose buttons. Look for it at the top right of a page, on each row of a table, and at the top of a side panel. **Save** in a side panel is usually in its dots menu too.

## On a phone

People use Studio on phones. The main menu is folded away behind the menu button at the top left.

![The main menu opened on a phone.](start-here-phone-menu.png)

1. Select the menu button at the top left.
2. Choose a page. The menu closes.

Pages with a side list, such as **Reports** and **Query**, start with that list folded. Each guide's **On a phone** section says how to open it.

## Troubleshooting

- **A page is missing from the menu.** Your role does not include it. Ask an administrator to check your permissions.
- **Every number reads 0.** The install has no lab data yet. See [Load the sample data](/docs/dashboard#load-the-sample-data).
- **A button is greyed out.** Something it needs is missing, often a required filter or a choice in a list.
- **Some labels are in English after I chose French or Portuguese.** Those labels are not translated yet.
- **A picture is too small.** Select it to enlarge it.
- **Search finds too much.** Search for the task, or for the exact error text.

## Deploying and running OpenLDR

Installing, configuring, upgrading and the command line are covered on the OpenLDR website. See [Deployment and developer docs](/docs/advanced-docs).

## Related guides

- [Dashboards](/docs/dashboard)
- [Reports](/docs/reports)
- [Deployment and developer docs](/docs/advanced-docs)
