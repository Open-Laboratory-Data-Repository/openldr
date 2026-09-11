# Data exposure

Settings → Data Exposure controls additional table columns available through joins in the internal dashboard builder. Access requires the `data_exposure.manage` capability.

## Understand the scope

The policy checks additional table columns selected through builder joins. Built-in model dimensions remain available. This is not a blanket filter over every returned field.

For these additional columns, the policy applies during selection, query execution, and conversion to SQL. It does not filter raw SQL widget results. Converting a builder query to SQL does not make later SQL executions follow future policy changes.

Custom Queries run through database connectors. Reports bound to those queries, Report Designer query data, and workflow Database nodes use connector SQL. They do not apply this policy, even when a connector points at the OpenLDR database.

Configure the database account used by each connector to read only approved tables, columns, or restricted views. Review database grants and query access before sharing a report. SELECT validation and row limits do not hide sensitive columns. Restrict the database account used for raw SQL widgets too.

## Change column visibility

1. Open Settings → Data Exposure and find the table and column.
2. Switch off a column to mark it Hidden. Switch on to mark it Shown.
3. PII means personally identifiable information. Showing a column with this badge requires confirmation. Confirm only when its use in the internal builder is intended.
4. Changes remain local until you open the page's ⋯ menu and choose Save. Check the saved notification. On an error, do not assume every change persisted.
5. Choose Discard in the same menu to reload saved values and abandon local edits.
6. Reopen the page after saving and check the column states. Then reload the internal dashboard builder and check its column choices. Run a safe test query to verify the intended result or rejection.

## Verify the correct query path

Use non-sensitive test data when checking exposure. A saved Hidden state proves the stored choice only. Verify the internal builder separately from raw SQL and connector-backed reports. For a connector, test the configured database account against approved views and prohibited columns. Check the resulting report before distributing it.

Changing this policy does not remove data from stored records or files already exported.

## Related guides

- [Settings](/docs/settings)
- [Dashboard](/docs/dashboard)
- [Custom Queries](/docs/query)
- [Connectors](/docs/connectors)
- [Reports](/docs/reports)
