# Facility examples

`facilities.csv` lists three made-up facilities. It has the two columns every facility import
needs, `national_code` and `name`. The codes run from `EXAMPLE-FAC-01` to `EXAMPLE-FAC-03`.

Every facility import belongs to a national register. Use a register named
`Example facility register` for this file, so its codes never mix with a real register's codes.

## Import in studio

1. Open the Facilities page.
2. Open the actions menu and choose Import facilities.
3. If the install has no register yet, choose Register a source. Enter the canonical URI
   `urn:example:facility-register` and the display name `Example facility register`.
4. Pick `Example facility register` as the national system.
5. Choose `facilities.csv`, check the preview, then import.

## Import from the command line

The register must exist first. Add it in studio as in step 3.

```
openldr facilities import examples/facilities/facilities.csv --national-system urn:example:facility-register
```

That is a dry run. It reads the file and reports what it would write. Add `--apply` to write it.

## What you see afterwards

The Facilities page lists the three facilities, each linked to `Example facility register`.
