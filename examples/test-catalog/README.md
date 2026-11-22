# Test catalog examples

`test-catalog.csv` lists three made-up tests, with codes from `EXAMPLE-T01` to `EXAMPLE-T03`. It
has the columns `code`, `name` and `short_name`. Only `name` is required.

The file has no category or specimen columns. Those must match a category or specimen the install
already has, so they are left out to keep the file importing anywhere.

## Import in studio

1. Open the Test catalog page.
2. Open the actions menu and choose Import. The menu item shows only on the install that owns the
   catalog.
3. On the File step, choose `test-catalog.csv`.
4. On the Columns step, keep the suggested columns.
5. On the Review step, check what would change, then apply.

## Import from the command line

```
openldr test-catalog import examples/test-catalog/test-catalog.csv
```

That shows what would change. Add `--apply` to write it.

## What you see afterwards

The Test catalog lists the three tests by their `EXAMPLE-` codes.
