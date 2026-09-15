# Test catalog

The test catalog is the national list of tests. Each test has a code, a name, a category, the specimen types it accepts and, when it has one, a LOINC code. A test with no LOINC code shows **No LOINC**.

Open **Test catalog** in the sidebar. You need the Terminology view permission to see it, and Terminology manage to change anything.

## Who changes what

An install that did not receive its catalog from central owns it. There you can add tests, edit them, and retire or restore them. A standalone lab is its own central.

A lab that receives the catalog from central cannot change its tests. The page says so above the table. The lab can still switch tests on or off, narrow their specimens and set a local name. Sync never sends these settings back.

## Finding tests

Search matches the code, name, short name and local name. Use **Filter** for category, LOINC, **On at this lab** and status. Retired tests are hidden unless you filter for them.

## Adding and editing a test

1. Choose **Add test** from the ⋯ menu, or **Edit** from a row's ⋯ menu.
2. Enter the code. Leave it empty to use the LOINC code. A code cannot change once saved.
3. Enter the name, and a short name if you want one.
4. Pick a category, and tick the specimen types the test accepts.
5. Enter the LOINC code. When LOINC is loaded here you search it. Otherwise you type it, and only its format is checked.
6. Under **This lab**, switch the test on, untick any specimen this lab does not take, and set a local name.
7. Choose **Save** from the ⋯ menu at the top of the sheet.

Specimen types come from CE's specimen-type list. Categories come from **Test categories** on the Terminology page.

## Row actions

The ⋯ menu on each row switches the test on or off at this lab. Where this install owns the catalog, it also retires or restores the test. Retiring is reversible, so it asks no confirmation.

From the command line: `openldr test-catalog enable`, `disable`, `retire` or `restore`, followed by the code.
