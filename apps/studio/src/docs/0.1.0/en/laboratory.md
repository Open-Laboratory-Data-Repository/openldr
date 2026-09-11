# Laboratory

Use **Settings → Laboratory** to set the identity used by report letterheads and the default register for new facilities.

## Set up laboratory identity

1. Open **Settings → Laboratory**.
2. Enter Laboratory name, Address, and Contact as you want them printed.
3. For Logo, choose an image file accepted by the field. A preview appears before saving. Clear removes the selected logo; save to persist that change.
4. Select **Facility register** from the registered sources. This supplies the initial System selection when creating a facility. It does not import facilities or change existing facility identifiers.
5. Enter a named **Time zone**, such as `Africa/Dar_es_Salaam`, when appropriate for your warehouse. This field accepts IANA names, not fixed offsets. For a SQL Server warehouse, leave it empty and enter the Windows zone name in the report's own Time zone filter.
6. Open the page's **⋯** menu and choose **Save**. Check the saved notification, then reopen the page to verify the values.
7. Preview a report that uses the shared letterhead to check the printed identity and logo.

## Choose a facility register

The selector lists active sources registered in Facilities. If the source is missing, open [Facilities](/docs/facilities), start Import facilities, and register the source there. Return to Laboratory and reload the page before selecting it.

Choose the register that owns your facility codes. Its system URI distinguishes those codes from another register's codes. Saving this choice sets a default for new facility entry; it does not rename or migrate existing facilities.

An empty selector can also mean that loading sources failed. Check Facilities before assuming no sources exist.

## Time zone and saved values

The Laboratory time zone can supply a report filter's initial value. It does not set every schedule's execution time. Check [Reports](/docs/reports) for each report's filters and schedule behavior.

Changing a text field or selecting a logo does not save it automatically. If Save reports an error, keep the page open, correct the value, and retry. A logo must be an uploaded image, not a pasted web address. Follow the file-type and size limits shown by the page.

## Related guides

- [Settings](/docs/settings)
- [Facilities](/docs/facilities)
- [Reports](/docs/reports)
