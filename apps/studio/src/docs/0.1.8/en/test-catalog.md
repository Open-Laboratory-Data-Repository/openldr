# Test catalog

The **test catalog** is the national list of tests. Each test has a code, a name, a category, the specimen types it accepts and, when it has one, a LOINC code. A test with no LOINC code shows **No LOINC**.

Setting up the Test catalog is optional. OpenLDR can receive and process lab data before you configure it. We strongly recommend setting it up as you use the system, so tests can be matched across sources. Choosing tests in the Lab order form uses the configured catalog.

The catalog does three jobs. It decides which tests the **Lab order** form offers. It lets reports count a test the same way whatever each lab system calls it. And it holds each test's result parameters and reference ranges.

A fresh install ships no tests. This guide loads a small sample list, switches some tests on, and maps the docs sample data to it. It takes about 15 minutes. Select any picture or clip to enlarge it.

![Test catalog after the sample import: eight tests with their code, category, specimen types, LOINC code and whether this lab runs them.](test-catalog-list.png)

## Who can do what

| Permission | What it allows |
| --- | --- |
| **Browse terminology** | Open **Test catalog** in the sidebar and read it |
| **Manage terminology** | Add, edit, import, switch on and off, retire, and map codes |

## Before you start

The examples use two sample files. Both are made-up data for a test install.

1. **The docs sample data**, for Example 3 and Example 4. See [Dashboards, Load the sample data](/docs/dashboard#load-the-sample-data). It holds 60 orders across five tests.
2. **The sample test list**, a CSV of eight tests. Download it from `https://openldr.online/docs-samples/openldr-sample-test-catalog.csv`. In a source checkout it is `apps/web/public/docs-samples/openldr-sample-test-catalog.csv`.

```csv
code,name,short_name,loinc,category,specimen_types
FBC,Full blood count,FBC,58410-2,Haematology,Blood
MAL-RDT,Malaria rapid test,Malaria RDT,70569-9,Parasitology,Blood
HIV-VL,HIV viral load,Viral load,20447-9,Molecular,Blood
GLU,Blood glucose,Glucose,2345-7,Chemistry,Blood
CREAT,Creatinine,,2160-0,Chemistry,Blood
UA,Urinalysis,Urine dipstick,24356-8,Chemistry,Urine
TB-XPERT,TB GeneXpert MTB/RIF,GeneXpert,,Molecular,Sputum
CSF-CULT,CSF culture,,,Microbiology,CSF
```

> **Use a test install.** A test can be retired but never deleted. Imported tests stay in the catalog.

## Example 1: import a test list

![Choosing the file, checking the columns, adding Parasitology as a new category, and reaching the review.](test-catalog-import.mp4)

1. Open **Test catalog**. The **Tests** tab is empty.
2. Open the page's **⋯** menu and select **Import**.
3. Drop the sample CSV on the sheet, or click to choose it. The sheet moves to **Step 2 of 4: Columns**.
4. Check each field's column. Every header in the sample matches a field, so nothing needs changing. Open the sheet's **⋯** menu and select **Next**.
5. **Step 3 of 4: Values** lists text that matched nothing. Here it is the category **"Parasitology" (1 row)**. Set it to **Add as a new category**. Select **Next**.
6. **Step 4 of 4: Review** shows the counts.

**Expected result:** **New 8**, **Changed 0**, **Unchanged 0**, **Refused 0**, and **Categories to add: PARASITOLOGY (Parasitology)**. A note says LOINC is not loaded here, so LOINC codes were checked for their format only.

![The review: 8 new tests, and one category to add.](test-catalog-review.png)

7. Open the sheet's **⋯** menu and select **Apply**. **8 added, 0 changed.** appears, and so do the eight tests. Each reads **Off** under **On at this lab**.

Had you left Parasitology on **Not chosen**, the review would show 7 new and 1 refused, with row 3, `MAL-RDT`, and the reason. Nothing is written before **Apply**, so you can go **Back** and fix it.

Import the same file again and the review shows **Unchanged 8**. Tests match on their code.

## Example 2: switch tests on at this lab

The Lab order form offers only tests switched on here. Switch on the five tests the sample data uses.

![Opening the Full blood count row menu and selecting Switch on at this lab.](test-catalog-switch-on.mp4)

1. On the **Full blood count** row, open **⋯** and select **Switch on at this lab**. **FBC is on at this lab.** appears, and the row reads **On**.
2. Do the same for **Malaria rapid test**, **HIV viral load**, **Blood glucose** and **Creatinine**.

**Expected result:** five tests read **On**. Urinalysis, TB GeneXpert MTB/RIF and CSF culture stay **Off**. The **Tests** field on the Lab order now lists the five. See [Forms](/docs/forms).

From the command line, the same is `./openldr test-catalog enable FBC`.

## Example 3: map the lab's order codes

Every lab system names its tests its own way. The docs sample data orders tests by LOINC code, for example `58410-2` for a full blood count. Map each code to the catalog test it means.

![The Observed tab: five codes from the sample data, with how many requests each has, all unmapped.](test-catalog-observed.png)

1. Open the **Observed** tab. It lists the five codes in the warehouse, with their description and request count: `58410-2` 18, `70569-9` 16, `20447-9` 11, `2345-7` 9, `2160-0` 6.
2. On the `58410-2` row, open **⋯** and select **Map to catalog test**.
3. Select **Choose a catalog test**, type `Full blood count`, and pick **Full blood count (FBC, 58410-2)**.
4. Open the sheet's **⋯** menu and select **Save**. **58410-2 now maps to Full blood count** appears.
5. Map the other four codes the same way.

![Mapping 58410-2 to Full blood count.](test-catalog-map.mp4)

**Expected result:** every row shows its catalog test under **Catalog test**, with the test's code and LOINC code underneath.

![All five codes mapped.](test-catalog-mapped.png)

## Example 4: count orders by catalog test

Mappings are copied to the warehouse table `test_map`. A report joins it to count orders by catalog test, whatever each lab called the test. Open **Query**, pick **Target Warehouse (Postgres)**, and run:

```sql
select tm.catalog_name, count(*)
from lab_requests lr
join test_map tm on tm.level = 'test'
  and tm.source_system = lr.panel_system
  and tm.source_code = lr.panel_code
group by tm.catalog_name
order by 2 desc
```

**Expected result:** Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6. That is 60 orders. See [Custom Queries](/docs/query) to save it for a report.

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

On the command line, text that matched nothing is answered with `--value-map`, a JSON file. For the sample list:

```json
{"categories":[{"text":"Parasitology","kind":"new","code":"PARASITOLOGY","display":"Parasitology"}],"specimens":[]}
```

```bash
./openldr test-catalog import data/openldr-sample-test-catalog.csv --value-map data/values.json --apply
```

An answer can also name an existing category: `{"text":"Parasitology","kind":"existing","code":"MICRO"}`. `--column-map` names the column for each field when the headers differ.

## The Lab order

The Lab order's **Tests** field lists this lab's tests: the catalog tests switched on here, under the local name when one is set. A retired test drops off the list. Switch tests on before anyone takes an order: the field is required, so an empty list lets no order through.

Each test carries its own specimen. Open a test's row and choose from the specimens that test accepts, by this lab's narrower list where it set one. The order has no separate specimen field.

A submitted order lists each test's LOINC code first, when the test has one, and then its catalog code. Reports that read an order's first code keep matching LOINC. A test with no LOINC code is sent under its catalog code.

An install whose Lab order was edited in the form builder keeps its own Tests field. To use this list, set the field's value set to `urn:openldr:valueset:lab-tests` in the builder. From the command line, `openldr terminology expand urn:openldr:valueset:lab-tests` prints the list the Tests field offers.


## Result parameters

A test can name the result parameters it yields: haemoglobin, a CD4 count, a malaria RDT reading. The parameters come from this install's result dictionary, so nothing is typed by hand. Tick one in the test's sheet, then say whether its result is a number, a code from a list, or free text.

A numeric parameter can carry reference ranges. Each range has a low, a high, a unit, and an optional name such as Highland women. It may also name a sex and an age window. A range row's ⋯ menu moves it up, moves it down or removes it, and the parameter's ⋯ menu adds one. Order decides which range starts selected at the bench. Two ranges on one parameter cannot share a name. A test that names no parameters still works: its sheet asks only for a specimen.

From the command line, `openldr test-catalog params <code>` prints a test's parameters, and `--set <file>` replaces them from a JSON file.

## Mapping lab test codes

Each lab system names its tests its own way. DISA calls viral load `HIVVL`, `POCVR` or `POHVL`. Map each of those codes to the catalog test it means, and reports can count the catalog test whatever the lab called it.

Open the **Observed** tab. It lists every test code in the warehouse, with its description, the number of requests and the date last seen. A code you mapped before any data arrived shows with 0 requests. Filter by **Unmapped**, **Mapped** or **Ambiguous**.

To map a code, open its row's ⋯ menu and choose **Map to catalog test**. Pick the test, then choose **Save** from the sheet's ⋯ menu. **Clear mapping** in the same menu removes it.

Codes match the way the warehouse database compares text. On Postgres that is exact, so `HIVVL` and `HIVVL ` (with a trailing space) are two codes. On MSSQL and MySQL with their default settings, upper and lower case count as the same, and MSSQL also ignores trailing spaces. On MSSQL and MySQL, two mappings whose codes differ only by case (`HIVVL` and `hivvl`) collide in `test_map`, and every rebuild fails until one is cleared. Map only one of them.

A code is **Ambiguous** when it has two catalog mappings, for example one made on the Terminology page and one here. Reports leave it out until you map it again. When central has mapped a code, central's mapping is the one reports use, and a lab's own mapping for that code is ignored.

A lab cannot change a mapping central sent down. Its row says **From central**.

### Mapping many codes at once

**Export CSV** from the tab's ⋯ menu writes every observed code. Fill in `catalog_code`, or `loinc` when you know only the LOINC code, then **Import CSV**. The import shows new, changed, unchanged and refused rows before it writes anything. A row with both columns blank is left as it is. A row is refused when the warehouse holds that code only with surrounding spaces, because the file reader trims cells. Map such a code on the Observed tab or with `openldr test-catalog map set`. On a lab, a row whose code central has mapped is refused unless it asks for the mapping central already has.

### Reports

Mappings are copied to the warehouse table `test_map`. A report joins it like this:

```sql
select tm.catalog_name, count(*)
from lab_requests lr
join test_map tm on tm.level = 'test'
  and tm.source_system = lr.panel_system
  and tm.source_code = lr.panel_code
where tm.loinc = '25836-8'
group by tm.catalog_name
```

The copy updates when a mapping or a catalog test changes, and at start-up. If an update fails, the tab says so. Choose **Rebuild warehouse copy** from its ⋯ menu.

## Mapping lab result codes

A test yields several results, and each lab system names those its own way too. DISA's viral load results come as `HIVVL`, `HIVVC`, `POCVR` and more. Map each result code to the result field it means, and a report can pick the result by what it is.

Result fields come from the site's result dictionary. Import one with `openldr terminology import parameters <file>`. The **Result fields** tab lists every field with its role, units and LOINC code. To link a field to LOINC, open its row's ⋯ menu, choose **Link LOINC**, pick or type the code, then choose **Save** from the sheet's ⋯ menu. **Export CSV** and **Import CSV** in the tab's ⋯ menu link many fields at once, with `code` and `loinc` columns. A blank `loinc` leaves a link as it is. A lab that receives its dictionary from central cannot change the links.

On the **Observed** tab, choose **Results** to list the result codes in the warehouse, with their result count. Map a code from its row's ⋯ menu with **Map to result field**. On a DISA site most result codes are the same as the dictionary's codes. **Map matching codes** in the tab's ⋯ menu maps them all at once. Pick the lab system, check the list, then choose **Map these codes**. It maps only unmapped codes. A code central has mapped, or one that is **Ambiguous**, is left alone.

The result CSV has the columns `system, code, description, results, parameter_code, loinc`. Fill in `parameter_code`, or `loinc` when you know only that.

Results entered in CE need no mapping. They already carry the dictionary's codes, and the warehouse copy maps each field to itself. The same goes for orders taken in CE: each catalog test maps to itself.

A report that counts viral load copies across labs joins `test_map` like this:

```sql
select count(*)
from lab_results l
join test_map tm on tm.level = 'result'
  and tm.source_system = l.observation_system
  and tm.source_code = l.observation_code
where tm.loinc = '20447-9'
```

A content pack can ship result mappings with a `result-mappings` step. Each entry names a lab code and a LOINC code, and the install maps the code to the one result field linked to that LOINC code. A code already mapped here is kept.

## On a phone

The catalog works on a phone. The table is wider than the screen, so scroll it sideways to reach each row's **⋯** menu, at the end of the row. The page's own **⋯** menu sits beside the search box. The import sheet fills the screen.

## Troubleshooting

- **Import refuses a row.** The review gives the row and the reason. Usually a category or specimen was left on **Not chosen**. Go **Back** to **Values** and choose.
- **A test is missing from the Lab order.** It is **Off** at this lab, or retired. Switch it on.
- **The Tests field on the Lab order is empty.** No test is switched on. A Lab order cannot be submitted without one.
- **A code reads Ambiguous.** It has two catalog mappings. Reports leave it out until you map it again.
- **A report counts 0 for a test.** Its lab code is not mapped. Check the **Observed** tab with the **Unmapped** filter.
- **I cannot edit a test.** This install receives its catalog from central. You can still switch tests on or off, narrow specimens and set a local name.
- **The Observed tab says the warehouse copy is stale.** Choose **Rebuild warehouse copy** from the tab's **⋯** menu.

## Related guides

- [Forms](/docs/forms)
- [Terminology](/docs/terminology)
- [Custom Queries](/docs/query)
- [Reports](/docs/reports)
