# Test catalog: an internal id and a Test code

Status: built from the operator's ruling of 2026-11-24. The calls in section 3 are mine, made to
show on a working screen.

## 1. Why

The operator, on the Test sheet's code hint ("Leave it empty to use the LOINC code"):

> National list without a code is pointless, so it should be required. In facility we just called
> it Facility code, so just call it Test Code. Secondly, the code can change so you must have your
> own internal id for this test (same thing we did for facilities). Thirdly loinc is also saved so
> its mapped to an international standard. The search by loinc is to help people create the test
> with specimen types etc.

They chose to build this before plan B of the Corlix parity work.

What CE does today:
- A test is one concept in `urn:openldr:codesystem:test-catalog`. Its concept code is its identity
  (`packages/bootstrap/src/test-catalog.ts:751-757`).
- An empty code takes the LOINC code (`test-catalog.ts:786`). A code cannot change (`:802`).
- The code is the key of `test_catalog_lab_settings` (`104_test_catalog.ts:46-47`), the LOINC link
  (`test-catalog.ts:407-411`), lab-code mappings (`test-mapping.ts:29`), saved order answers and
  their ServiceRequest ids (`packages/forms/src/extract/order-ids.ts:21-23`), and every lab plugin
  lookup and stored order (`openldr-ce-plugin-lab` `src/orders.rs:442-446`, `src/results.rs:180-188`).

Changing that key would break all of them. Facilities solved the same problem with an id that never
changes beside a code that can (`docs/superpowers/specs/2026-08-13-facility-one-code-design.md`).

## 2. The rule

- The concept code is the test's **internal id**. It never changes. Every key above keeps using it.
- The **Test code** is the national code. It is a concept property, `testCode`. It is required,
  unique in the catalog, and can be edited.
- LOINC stays a mapping to the international standard. Search by LOINC helps fill in a new test.
  It is never the test's code.

## 3. Calls

1. **Saved tests need no migration.** A test without `testCode` reads its concept code as its Test
   code. So every saved test keeps the code it shows today, and its id is that same code.
2. **A new test's id** is `tst-` and 16 hex characters of a random UUID. It is made once, at create.
   A CSV row gets the same kind of id when it creates a test.
3. **Required and unique.** Create, edit, CSV import and the CLI refuse a test with no Test code, or
   with one another test already holds (active or retired). The LOINC fallback goes.
4. **Edit.** A Test code can be changed in the sheet, the CSV and the CLI. The audit entry names
   the old and new code. The id does not change, so nothing else moves.
5. **Lookups by people.** Search, the CLI and CSV import find a test by its Test code. The CLI
   also takes the id. Routes keep `:code` meaning the id, as today.
6. **CSV.** Export gains an `id` column beside `code` (the Test code). Import matches a row on `id`
   when given, else on the Test code. A row with a new Test code and no `id` makes a new test, as
   facilities do. An `id` that names no test here (a file from another install) falls back to the
   Test code, else makes a new test, with a note on that row. (Changed after the final review.)
10. **Earlier codes.** A renamed test keeps its earlier Test codes in `previousTestCodes`. They stay
    reserved for it, and the warehouse test map keeps a row for each, so orders saved under an
    earlier code still join. (Added after the task 2 review.)
7. **What leaves CE carries the Test code.**
   - A ServiceRequest's codings become: LOINC when linked, then the Test code in
     `urn:openldr:codesystem:test-catalog:test-code`, then the id in the catalog system. So the
     warehouse's `panel_code` holds LOINC, or the Test code, never a `tst-` id.
   - `test_map.catalog_code` publishes the Test code.
   - The plugin host's `testCatalog.get` and `list` answer `testCode` beside `code`.
8. **Screens show the Test code.** The Test sheet's first basic field is "Test code", always
   editable here, with the id shown read-only under it. The catalog table, order screens and the
   lab plugin show the Test code. The lab plugin adds the Test code coding to what it sends.
9. **Sync.** The concept key is the id, so sync works as today. `testCode` travels with the concept.

## 4. Not in this change

- A data migration that re-keys saved tests. Call 1 makes it unneeded.
- A separate code system per country. One Test code system serves every install, as the catalog
  system does today.

## 5. Five places

- **UI:** Test sheet, catalog table, test mapping screens and order screens; mobile at 375 px.
- **CLI:** `test-catalog set` takes `--test-code`; every command that takes a test finds it by Test
  code or id.
- **Docs:** the Test catalog guide, in-app and web, en, fr and pt. The hint that said "Leave it empty
  to use the LOINC code" goes.
- **Lab plugin:** shows the Test code, and sends its coding.
- **Changelog:** after the merge.

## 6. Proof

pg-mem tests for create, edit, uniqueness, CSV matching and the ServiceRequest codings. A live run
on the throwaway install: make a test with a Test code, change the code, see the order screen and
the warehouse `panel_code` follow it.
