# Test catalog

Keep a shared list of tests, decide which ones this lab offers, and link the codes received from your data sources. A catalog test and a result field are different things. One test can produce several result fields.

**This setup is optional.** OpenLDR can receive and process lab data before you configure it. We strongly recommend setting it up during use. The Lab order form offers the tests enabled at this lab.

Use your own test codes, names, specimens and files. The screenshots use fictional examples. No documentation sample data is required. [Optional practice files](#optional-practice-with-fictional-data) are at the end.

Reading needs **Browse terminology**. Changes need **Manage terminology**. When the catalog comes from central, this lab can change local availability, specimens and names. It cannot change the shared test definitions.

The screenshots use an installation that owns its catalog. Result-field examples also use a small fictional result dictionary. Reference-band numbers are for documentation only. Use the ranges and code meanings approved for your actual tests.

## Add a test to your catalog

Use this for one new test when this installation owns its catalog. Search for an existing test before adding another code.

### 1. Open Test catalog

Select **Test catalog** in the main menu on the left.

![Test catalog is in the main menu on the left.](test-catalog-guide-open-page.png)

### 2. Open the Tests actions

Select **Tests**, then open the dots beside its search and table controls.

![Tests contains the catalog available to this installation.](test-catalog-guide-tests-tab.png)

![Open the Tests page dots menu.](test-catalog-guide-page-actions-step-2.png)

### 3. Choose Add test

Select **Add test**. The test sheet opens.

![Choose Add test to enter one test by hand.](test-catalog-guide-add-menu.png)

### 4. Enter the code

Enter the stable code from your own catalog. The fictional example uses `EXAMPLE-ALPHA`. Leave it empty only if the LOINC code should become the code. A saved code cannot be changed.

![Use the stable code from your catalog. This example uses EXAMPLE-ALPHA.](test-catalog-guide-test-code.png)

### 5. Enter the name

Enter the name people should see. A short name is optional. The example uses `Example panel Alpha` and `Example Alpha`.

![Enter the test name people should see.](test-catalog-guide-test-name.png)

![A short name is optional.](test-catalog-guide-test-short-name.png)

### 6. Choose the category

Select the category that fits this test from the configured list. Categories come from Terminology.

![Choose a category from the configured list.](test-catalog-guide-category-option.png)

### 7. Choose accepted specimens

Tick the specimen types this test accepts. Use the configured choices for your actual test.

![Tick the specimen types this test accepts.](test-catalog-guide-specimen.png)

## Finish and save the test

Continue in the open test sheet. You can configure this lab and result fields after saving the shared definition.

### 1. Check the LOINC field

Enter a confirmed LOINC code if you have one, or leave it blank. When LOINC is loaded, search and select a term. Here it is not loaded, so typed codes are checked for format only.

![LOINC is optional. If the dictionary is absent, this installation checks typed code format only.](test-catalog-guide-loinc.png)

### 2. Open the sheet actions

Select the dots in the test sheet, below its heading.

![The test sheet has its own dots menu.](test-catalog-guide-sheet-actions.png)

### 3. Choose Save

Select **Save**. New tests use Save too.

![Save creates the test. This lab can be configured afterward.](test-catalog-guide-save-menu.png)

**Expected result:** The sheet closes and the new test appears in Tests. It starts Off at this lab unless you enabled it in the sheet.

![The test appears in Tests. It starts Off at this lab.](test-catalog-guide-created.png)

## Make a test available at this lab

Enable the tests this lab actually performs. This changes local availability, which the Lab order form uses.

### 1. Open the test row actions

Select the dots at the right end of the test row.

![Use the test row dots menu for local availability.](test-catalog-guide-row-actions.png)

### 2. Choose Switch on at this lab

Select **Switch on at this lab**. The same action becomes Switch off at this lab for an enabled test.

![Switch on at this lab makes this test available here.](test-catalog-guide-enable-menu.png)

**Expected result:** On at this lab reads On. Imported tests do not become enabled automatically.

![The local availability column now reads On.](test-catalog-guide-enabled.png)

## Set this lab's name and specimen choices

Use local settings when this lab uses a different display name or accepts fewer specimens. A lab receiving the catalog from central can still change these settings.

### 1. Choose Edit

Open the row dots menu and select **Edit**. The saved code is shown without an editable input.

![Edit opens the catalog and local settings.](test-catalog-guide-edit-menu.png)

![An existing test keeps its code. Use its name and other editable fields for corrections.](test-catalog-guide-fixed-code.png)

### 2. Check local availability

Under **This lab**, use **On at this lab** to choose whether this lab offers the test.

![This lab settings control whether this installation offers the test.](test-catalog-guide-local-enabled.png)

### 3. Check local specimens

Keep the specimen types this lab accepts. The local choices can narrow the catalog list. Keeping every specimen follows the catalog list.

![This lab can narrow the catalog specimen choices.](test-catalog-guide-local-specimen.png)

### 4. Enter a local name if needed

Enter the local display name in the local-name field, or leave it blank to use the catalog name. The example uses `Alpha at this lab`.

![A local name changes how this lab presents the test.](test-catalog-guide-local-name.png)

### 5. Save the local settings

Open the sheet dots menu and select **Save**.

![Save stores the local settings alongside the existing test.](test-catalog-guide-local-save.png)

**Expected result:** The lab settings are saved without changing the test code.

## Find and export tests

Search before creating another test. You can also export active catalog tests for review or later import.

### 1. Search by code or name

Use **Search code or name**. Search also matches short and local names. The example finds the test using its local name.

![Search can find a test by its catalog or local name.](test-catalog-guide-search.png)

### 2. Read the matching row

Check the code and catalog name before editing. The test keeps its catalog name even when a local name matched your search.

![The matching test remains visible under its catalog name.](test-catalog-guide-search-result.png)

### 3. Choose Export CSV when you need a file

Clear the search if you no longer need it. Open the Tests dots menu and select **Export CSV** to download active catalog tests. A central-managed lab can export too.

![Export CSV downloads active catalog tests in an importable format.](test-catalog-guide-export.png)

**Expected result:** The browser downloads a CSV in the columns the import wizard understands. Export contains active catalog tests, not just a visible row.

## Choose and map your test-list file

Use an import when you have a list in CSV or Excel .xlsx format. Tests match by code. An import does not retire tests absent from the file or change local lab settings.

### 1. Choose Import

On Tests, open the page dots menu and select **Import**.

![Open the Tests page dots menu.](test-catalog-guide-page-actions-step-1.png)

![Import opens the file review wizard.](test-catalog-guide-import-menu.png)

### 2. Choose your file

Select the file area and choose your own CSV or XLSX file. The wizard reads it and opens **Step 2 of 4: Columns**.

![Choose your own CSV or XLSX file. Nothing is written before Apply.](test-catalog-guide-import-file.png)

### 3. Check the Name column

Check every suggested column. Name is required. Correct a field using its selector beside the label.

![Check the suggested column assignments. Name is required.](test-catalog-guide-import-columns.png)

### 4. Check absent and empty columns

**Not in the file** leaves an existing field unchanged. An empty cell in a selected column clears that field. Do not map an empty column unless that is intended.

![Not in the file leaves an existing field unchanged. An empty cell in a mapped column clears it.](test-catalog-guide-import-missing-column.png)

### 5. Continue to Values

Open the import sheet dots menu and select **Next**.

![Next is in the import sheet dots menu.](test-catalog-guide-import-next-actions.png)

![Next checks category and specimen values.](test-catalog-guide-import-next.png)

## Resolve values and review the import

The Values step lists category or specimen text that matched no configured choice. Decide what each text means before applying the file.

### 1. Find unrecognised values

Read the text and affected row count. A value left **Not chosen** causes its row to be refused. This example has an unrecognised category.

![Unrecognised category text needs a decision before its row can be imported.](test-catalog-guide-import-unknown.png)

### 2. Choose the correct category

Select an existing category with the same meaning. Choose **Add as a new category** only when a new category is intended.

![Choose an existing category, or Add as a new category when the meaning is new.](test-catalog-guide-import-new-category.png)

### 3. Check a new category code

When adding a category, check or change its generated code. This example adds a fictional category. Resolve unmatched specimens through their choices too.

![Check the suggested code before adding the category.](test-catalog-guide-import-category-code.png)

### 4. Continue to Review

Open the sheet dots menu and select **Next**.

![Next builds the reviewed counts with your value decisions.](test-catalog-guide-import-values-next.png)

### 5. Read the counts and warnings

Check New, Changed, Unchanged and Refused, any refusal reasons, and Categories to add. Use Back in the dots menu if you need to correct the file decisions.

![Read the new, changed, unchanged and refused counts, plus any categories to add.](test-catalog-guide-import-review.png)

### 6. Choose Apply

When the review matches your intention, open the sheet dots menu and select **Apply**. Nothing is written before this action.

![Apply writes only after you have reviewed the import.](test-catalog-guide-import-apply.png)

**Expected result:** The sheet closes and imported tests appear. They start Off at this lab. Importing the identical file again reports unchanged rows, without duplicates.

![Imported tests appear in Tests and start Off at this lab.](test-catalog-guide-import-result.png)

![The identical file is recognised as unchanged rather than creating duplicate tests.](test-catalog-guide-repeat-review.png)

## Choose the result fields for a test

Do this when people will enter results through this test. Choices come from the installed result dictionary. If none are available, import your system's dictionary first. [Terminology](/docs/terminology) explains code lists and [Start here](/docs/start-here) explains the CLI. Optional practice includes a fictional dictionary.

### 1. Open the test and choose its result fields

Choose Edit from the test row menu. Tick the fields this test produces under its result parameters.

![Edit opens the catalog and local settings.](test-catalog-guide-edit-menu.png)

![Tick the result fields that this test produces. Choices come from your result dictionary.](test-catalog-guide-parameter-choice.png)

### 2. Choose each result type

Choose **Numeric**, **Coded** or **Text** for each selected result field. A coded field also needs its configured value set. The example uses Numeric.

![Choose Numeric, Coded or Text for the result field.](test-catalog-guide-parameter-type.png)

### 3. Open the numeric field actions

For a numeric field needing a reference band, select the dots beside its result-type selector.

![Numeric fields have their own range actions.](test-catalog-guide-parameter-actions.png)

### 4. Choose Add range

Select **Add range**. A reference-band form appears below the result field.

![Add a range creates one reference band for this result field.](test-catalog-guide-add-range.png)

## Set the reference band and save

Use the bounds approved for your test, method and population. The example band and numbers are fictional and must not be used as clinical ranges.

### 1. Name the band

Enter a name that identifies this reference band. The example uses `Example band only`.

![Name the reference band. This fictional band is for documentation only.](test-catalog-guide-range-name.png)

### 2. Enter the approved bounds

Enter the lower and upper bounds for your actual test. Blank bounds are open. The screenshot's 1 and 10 are documentation values only.

![Use the lower and upper bounds approved for your actual method. The numbers here are fictional.](test-catalog-guide-range-bounds.png)

### 3. Enter the unit

Set the unit used by this band. Use the same meaning and scale as the actual result.

![Set the unit used by this reference band.](test-catalog-guide-range-unit.png)

### 4. Check sex and age restrictions

Set any sex or age limits that apply. An unrestricted band should have no such restriction.

![Sex and age limits restrict who this band applies to. Leave them open only for an unrestricted band.](test-catalog-guide-range-context.png)

### 5. Save the test

Open the test sheet dots menu and select **Save**.

![Save stores the selected result fields and reference bands.](test-catalog-guide-parameter-save.png)

**Expected result:** The selected fields, result types and reference bands are saved with the test.

## Link a received test code to the catalog

Do this after your normal lab data has arrived. If Observed is empty, you can build the catalog now and return later. Enabling a test at this lab and mapping a received code are separate actions.

### 1. Open Observed

Select **Observed** at the top. Tests lists the codes received with orders.

![Observed lists test and result codes received from your data sources.](test-catalog-guide-observed-tab.png)

![Each source code shows its current catalog mapping.](test-catalog-guide-observed-test-row.png)

### 2. Choose Map to catalog test

Open the received-code row dots menu and select **Map to catalog test**.

![Open the dots on the source-code row.](test-catalog-guide-observed-row-actions.png)

![Map to catalog test opens the destination picker.](test-catalog-guide-map-test-menu.png)

### 3. Open the destination selector

Select **Choose a catalog test**.

![Choose a catalog test is the destination selector.](test-catalog-guide-map-picker.png)

### 4. Search the catalog

In **Search catalog tests**, search for the test this source code actually represents.

![Search for the catalog test that this source code actually means.](test-catalog-guide-map-search.png)

### 5. Select the correct test

Choose the matching catalog test. Check its code as well as its name.

![Select the matching catalog test.](test-catalog-guide-map-target.png)

### 6. Save the mapping

Open the mapping sheet dots menu and select **Save**.

![The mapping sheet has its own dots menu.](test-catalog-guide-map-actions.png)

![Save writes the mapping used by reports.](test-catalog-guide-map-save.png)

**Expected result:** The received code shows its Catalog test. Reports can count the source code through this catalog identity.

![The source code now shows its catalog test.](test-catalog-guide-mapped-test.png)

## Match received result codes to the dictionary

Result codes identify individual results. They are different from test codes. Exact-code matching is useful when the source and your result dictionary use the same codes. Existing mappings and ambiguous codes are left alone.

### 1. Choose Results in Observed

Select **Results** to see received result codes.

![Results switches Observed from test codes to result codes.](test-catalog-guide-results-toggle.png)

![Result codes are separate from test codes.](test-catalog-guide-result-code-row.png)

### 2. Choose Map matching codes

Open the Observed dots menu and select **Map matching codes**.

![Open the Observed dots menu to match result codes.](test-catalog-guide-observed-actions.png)

![Map matching codes checks exact matches against your result dictionary.](test-catalog-guide-match-menu.png)

### 3. Choose the lab system

Choose the source system whose result codes you want to match. If only one exists, it is selected automatically.

![Choose the lab system whose result codes you want to match.](test-catalog-guide-match-system.png)

### 4. Read the proposed matches

Check each code, destination name and result count. Matching names do not replace checking the actual code meanings.

![Read the proposed exact-code matches before applying them.](test-catalog-guide-match-preview.png)

### 5. Open Matching actions

Select the dots in the matching sheet.

![Open Matching actions after checking the list.](test-catalog-guide-match-actions.png)

### 6. Apply the matches

Select **Map these codes**. For different codes, use Map to result field on the received-code row instead.

![Map these codes applies the proposed matches.](test-catalog-guide-match-apply.png)

**Expected result:** The matched code names its Result field. If the page reports a stale warehouse copy, its dots menu offers Rebuild warehouse copy.

![The received result code now names its result field.](test-catalog-guide-matched-result.png)

![Rebuild warehouse copy retries publishing mappings when the page reports a stale copy.](test-catalog-guide-rebuild-menu.png)

## Link a result field to LOINC

Use a confirmed code for the meaning of your real field. The fictional example only demonstrates the editor. Its illustrative LOINC entry is not a recommendation for your field. A lab receiving the dictionary from central cannot change these links.

### 1. Open Result fields

Select **Result fields**. Find the dictionary code and check its role and units.

![Result fields lists fields from the installed result dictionary.](test-catalog-guide-result-fields-tab.png)

![Result fields shows the dictionary code, role, units and LOINC link.](test-catalog-guide-result-field-row.png)

### 2. Choose Link LOINC

Open the field row dots menu and select **Link LOINC**.

![Open the result-field row dots menu.](test-catalog-guide-result-field-actions.png)

![Link LOINC opens the field link editor.](test-catalog-guide-loinc-link-menu.png)

### 3. Enter or select the confirmed LOINC

When LOINC is loaded, search and select it. Otherwise enter your confirmed code. This installation checks typed code format only. It does not prove the clinical meaning.

![Enter the confirmed LOINC code for your real result field. A typed code is checked only for format when LOINC is not loaded.](test-catalog-guide-loinc-input.png)

### 4. Save the link

Open the LOINC link dots menu and select **Save**.

![Use the LOINC link dots menu to save.](test-catalog-guide-loinc-actions.png)

![Save stores the link. Check the meaning against your own terminology before using it.](test-catalog-guide-loinc-save.png)

**Expected result:** The field row shows its LOINC code. Export CSV in the Result fields menu downloads the links.

![The result-field row now shows the saved LOINC code.](test-catalog-guide-loinc-result.png)

![Export CSV downloads the dictionary links for review or editing.](test-catalog-guide-result-export.png)

## Use Test catalog on a phone

The same tabs and actions remain available on a phone. Wide tables can scroll horizontally.

### 1. Choose the tab

Use Tests, Result fields or Observed at the top of the page.

![Tests, Result fields and Observed remain at the top on a phone.](test-catalog-guide-phone-tests.png)

### 2. Open the relevant actions

In Tests, the page dots menu is beside the search and table controls. Each row still has its own menu.

![The Tests dots menu stays beside the search and table controls.](test-catalog-guide-phone-actions.png)

### 3. Choose received result codes

In Observed, choose Results when you want received result codes rather than test codes.

![Use Results to work with received result codes on a phone.](test-catalog-guide-phone-results.png)

## Optional practice with fictional data

Every task above can use your own data. Use these files only in a test installation. A test can be retired, but cannot be deleted. Do not import fictional tests into a live catalog.

- [Download a two-test CSV](https://openldr.online/docs-samples/user-guide/test-catalog/example-tests.csv) for the import task.
- [Download a one-field result dictionary](https://openldr.online/docs-samples/user-guide/test-catalog/example-result-fields.json) for the result-field tasks.
- [Download four fictional lab resources](https://openldr.online/docs-samples/user-guide/test-catalog/example-lab-data.json) to populate Observed.

To follow the pictures exactly, add EXAMPLE-ALPHA manually first. Importing the CSV alone creates Beta and Gamma. Use your own matching names instead if you skip the practice files.

For the optional dictionary and lab-data bundle, first follow [Start here](/docs/start-here). Put the downloaded files in the installation's `data` folder. From an example development checkout:

```shell
cd ~/Downloads/openldr_ce
pnpm openldr terminology import parameters data/example-result-fields.json
pnpm openldr ingest data/example-lab-data.json
```

For an installed Linux or macOS copy, use `./openldr` instead of `pnpm openldr`. On Windows, use `.\openldr.ps1` from your installation folder, such as `C:\openldr_ce`. Replace the example folder with your real folder. Start here shows the full platform steps.

## Before changing shared catalog data

A catalog received from central has read-only shared definitions. Local availability, local specimen choices and local names remain this lab's settings.

Import accepts at most 5,000 rows and 5 MB. Excel import reads the first worksheet. Tests match by code. A file does not retire tests absent from it or change local settings.

Retiring a test hides it from the default active list. It can be restored. Catalog tests cannot be deleted. Use the Status filter when looking for retired tests.

## Troubleshooting

**Add test or Import is missing.** Check whether the catalog comes from central and whether your account can manage terminology. Read the ownership message above the table.

**A new test is absent from Lab order.** Check On at this lab. Creating or importing a test does not automatically enable it.

**The import refuses rows.** Read each row's reason in Review. Return to Values for unchosen category or specimen text. Check Name and the code or LOINC that supplies its identity.

**No result parameters appear.** This installation has no usable result fields in its dictionary. Load the dictionary for your system first. The optional practice dictionary is only an example.

**A code is still unmapped.** Check whether you selected Tests or Results. Mapping one level does not map the other.

**The page reports a stale warehouse copy.** Open Observed actions and choose Rebuild warehouse copy. The page reports a failure if it cannot rebuild.

## Related guides

[Terminology](/docs/terminology) explains configured code lists. [Facilities](/docs/facilities) explains facility codes. [Start here](/docs/start-here) explains installed and development CLI use.
