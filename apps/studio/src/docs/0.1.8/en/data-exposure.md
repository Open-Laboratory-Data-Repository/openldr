# Data exposure

**Settings → Data Exposure** decides which extra table columns the dashboard **Builder** may offer when someone joins another table, for example the patient's sex or the specimen's collection site. Hide a column here and it disappears from the Builder for everyone.

It does not cover everything. Read [What it does not cover](#what-it-does-not-cover) before you rely on it to keep a column private.

This guide takes about 10 minutes. Select any picture or clip to enlarge it.

![Data Exposure: the Patient table, each column with its PII badge and a Shown or Hidden switch.](data-exposure-tour.png)

## Who can do what

One permission covers this page: **Manage data exposure**. Without it, the page is not listed in Settings.

## What the page shows

The page lists seven tables. Each row is one column, with a switch: on is **Shown**, off is **Hidden**.

| Table | Columns | Hidden on a fresh install | Marked PII |
| --- | --- | --- | --- |
| Patient | 18 | 13 | 8: names, date of birth, national id, phone, email, patient GUID, match key |
| Specimen | 13 | 7 | none |
| Request | 30 | 8 | `clinical_info` |
| Facility | 12 | 3 | none |
| Report | 20 | 5 | none |
| Facility Map | 16 | 2 | none |
| Test Map | 9 | 1 | none |

**PII** means personally identifiable information. A red **PII** badge marks those columns. They start hidden.

## Example 1: hide a column

Hide the patient's `sex` column, then put it back.

![Switching off sex on the Patient table and saving from the Data Exposure menu.](data-exposure-hide.mp4)

1. Open **Settings**, then **Data Exposure**.
2. Under **Patient**, find `sex`. It reads **Shown**.
3. Switch it off. It now reads **Hidden**. **Unsaved changes** appears.
4. Open the page's **⋯** menu and select **Save**. **Column policy saved** appears.

**Expected result:** `sex` stays **Hidden** after you reload the page.

Changes stay on your screen only until you select **Save**. **Discard** in the same menu throws away unsaved changes and reloads the saved ones. If **Save** reports an error, do not assume any change was kept. Reload and check.

To put it back, switch `sex` on and select **Save** again.

## Example 2: see the column vanish from the Builder

Do this while `sex` is still hidden from Example 1.

1. Open **Dashboards** and edit any widget, or add one. See [Dashboards, Example 1](/docs/dashboard#example-1-make-an-orders-by-test-widget).
2. In the Builder, select **Join data**. Set the table to **Patient**.
3. Look at the Patient columns it offers.

**Expected result:** the list offers `managing_organization`, `active`, `source_system` and `created_at`. `sex` is gone. Show it again, save, and reopen the widget editor: `sex` is offered again.

A widget saved earlier with `sex` stops running once you hide it. The server refuses its query, because the column is no longer allowed.

## Showing a PII column

Switching on a column with a **PII** badge asks first: **Un-hide** *name*? Select **Un-hide** only when that column is really needed in the Builder. Then select **Save**.

## What it does not cover

This page checks the extra columns the Builder offers through **Join data**. It checks them when the column is picked, when the query runs, and when the query is turned into SQL. It is not a filter on every field OpenLDR returns.

It does **not** apply to:

- **Built-in Builder fields.** Fields each data model offers by default stay available.
- **SQL widgets.** Raw SQL reads whatever the database account can read.
- **A Builder query turned into SQL.** Once converted, it no longer follows later changes on this page.
- **Custom Queries, the reports bound to them, Report Designer data and the workflow database nodes.** They all run SQL through [Connectors](/docs/connectors). They ignore this page, even when the connector points at the OpenLDR database.

To keep a column private on those paths, limit the database account instead. Give each connector's account, and the account behind SQL widgets, access only to approved tables, columns or views. Read-only checks and row limits do not hide a column.

Hiding a column does not remove data already stored, or files already exported.

## Check the right path

- Test with data that is not sensitive.
- A saved **Hidden** proves only that the choice was saved. Check the Builder separately, as in Example 2.
- Check SQL widgets and connector-backed reports separately. For a connector, run a query as its account against an approved view and against a forbidden column.
- Check the finished report before you share it.

## From the command line

```bash
./openldr data-exposure list
./openldr data-exposure hide patients sex
./openldr data-exposure show patients sex
```

`hide` and `show` take a table name and one or more column names. A running server picks up a command-line change only after its next save on this page, or a restart. Restart the api container to apply it at once.

## On a phone

The page works on a phone. Each row keeps its column name on the left and its switch on the right. Open **Data Exposure** from the row of Settings pages across the top. It is the last one, so swipe the row sideways.

## Troubleshooting

- **A column I hid still shows in the Builder.** Close and reopen the widget editor. If you changed it from the command line, restart the api container.
- **A dashboard widget now fails.** It uses a column you hid. Show the column again or change the widget.
- **A report still shows a hidden column.** The report runs through a connector, which this page does not cover. Limit the connector's database account.
- **Save fails.** Reload the page to see what was kept, then try again.
- **The page is missing from Settings.** You need **Manage data exposure**.

## Related guides

- [Settings](/docs/settings)
- [Dashboards](/docs/dashboard)
- [Custom Queries](/docs/query)
- [Connectors](/docs/connectors)
- [Reports](/docs/reports)
