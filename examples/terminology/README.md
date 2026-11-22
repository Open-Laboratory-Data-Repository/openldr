# Terminology examples

Create or pick a code system first. Terms always import into a code system you choose.

- `terms.csv` lists three made-up test codes, `EXAMPLE-HGB`, `EXAMPLE-GLU` and `EXAMPLE-WBC`.
  It has the columns `code` and `display`.
- `value-set.json` is a FHIR ValueSet named `Example tests`. It lists the same three codes from
  the code system `urn:example:cs`.

## Import in studio

1. Open the Terminology page.
2. Create the code system. Open the actions menu, choose Code system, then New. Set System code
   to `EXAMPLE`, System name to `Example tests` and Canonical URL to `urn:example:cs`. You can
   pick an existing local code system instead, but the value set then points at a system that
   lacks these codes.
3. With that code system open, open the actions menu, choose Term, then Import terms. Choose
   `terms.csv`.
4. Open the actions menu, choose Value set, then Import. Choose `value-set.json`.

## Import from the command line

```
openldr terminology system create EXAMPLE "Example tests" --url urn:example:cs
```

That creates the code system only. The command line has no import for a terms CSV or for the
value set list. Import `terms.csv` and `value-set.json` in studio.

## What you see afterwards

The code system lists the three terms. The value set list shows `Example tests`.
