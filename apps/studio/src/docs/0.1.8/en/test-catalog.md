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

## Importing a test list

Where this install owns the catalog, choose **Import** from the ⋯ menu. The sheet has four steps. Back, Next, Apply and Close are in its ⋯ menu. Nothing is written before **Apply**.

1. **File.** Drop a CSV or Excel (.xlsx) file, or click to choose one. CE reads the first worksheet of an Excel file. A file holds at most 5,000 tests and 5 MB.
2. **Columns.** CE matches the headers to the fields. Check each one. Name is required. A field set to **Not in the file** is left alone on tests already in the catalog. An empty cell in a chosen column clears that field.
3. **Values.** Category and specimen text match the lists by code or name, ignoring case and spacing. A specimen cell can hold several specimens, split with `;`. Choose what each unmatched text means. A category can be added: its code starts from the text, and you can change it. A row whose text is left unchosen is refused.
4. **Review.** CE shows how many tests are new, changed, unchanged and refused, each refusal with its row and reason, and the categories it will add. Choose **Apply** to write them all at once.

Tests match on their code, so importing the same file twice changes nothing. A test missing from the file is not retired. An import never changes a test's status or this lab's settings. When LOINC is not loaded here, LOINC codes are checked for their format only, and the review says so.

## Exporting the catalog

Choose **Export CSV** from the ⋯ menu. Any install can export, a lab that receives central's catalog included. The file holds the active tests in the columns an import reads: `code`, `name`, `short_name`, `loinc`, `category` and `specimen_types`. Edit it in a spreadsheet and import it back. A value that starts with `=` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.

From the command line: `openldr test-catalog import <file>` shows what would change, and `--apply` writes it. `openldr test-catalog export` writes the CSV.
