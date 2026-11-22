# Query examples

`queries.json` holds two saved queries in the `openldr.custom-queries` format, version 1. Both
count results by test from the `lab_results` table.

- `Example: results by test` has no parameters.
- `Example: results in a period` has one date range parameter, `Period`. The SQL reads it as
  `{{param.from}}` and `{{param.to}}`.

Both queries sit in a group named `Examples`.

## Import in studio

1. Open the Query page.
2. Open the transfer actions menu and choose Import queries.
3. Choose `queries.json`. Pick the connector the queries should run on.
4. Choose Import.

The sheet lists each query as created or skipped. A query whose name already exists is skipped
unless you choose to replace it.

## Import from the command line

```
openldr query import examples/queries/queries.json
```

Add `--connector <name>` to pick a connector other than the default one. Add `--force` to replace
queries that already exist.

## What you see afterwards

The Query page shows an `Examples` group with the two queries. They return rows once the install
has results.
