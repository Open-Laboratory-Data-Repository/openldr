# Facilities

Give the facilities in your data consistent names, codes and locations. Add individual facilities, import a register, then link the codes arriving from your data sources to the right facility.

**This setup is optional.** OpenLDR can receive and process data before you configure Facilities. We strongly recommend setting it up as you use the system, so reports can identify the facilities behind their codes.

**Registry** holds the facilities you add or import. **Observed** holds the codes received in lab data and shows which facility each code resolves to. Adding a facility and linking an observed code are separate tasks.

A **register** is a list maintained by an organisation, such as a national facility directory or your own organisation's list. **System** selects that register. Its URI and the **Facility code** identify the facility together.

Use your own register, facility details and files throughout this guide. The screenshots use fictional facilities to make the actions visible. No documentation sample data is required. [Optional practice files](#optional-practice-with-fictional-data) are at the end.

Reading needs **View facilities**. Adding, editing, importing and linking need **Manage facilities**. Add and Edit also need one published form targeting Facilities. That form determines the fields and required markers you see.

## Register the source of your facility list

Do this once for a register you will use for manual entries or imports. If your register already appears under **System** or **National system**, use it and skip this task. Do not create another source for the same register.

### 1. Open Facilities

Select **Facilities** in the main menu on the left.

![Facilities is in the main menu on the left.](facilities-guide-open-facilities.png)

### 2. Open Import facilities

On **Registry**, open the dots at the right of the tab strip and select **Import facilities**.

![Open the page dots menu at the right of the tab strip.](facilities-guide-source-actions.png)

![Import facilities opens the source registration and file import controls.](facilities-guide-source-import.png)

### 3. Choose Register a source

Select **Register a source**. You can register it before choosing a file. If sources already exist, this action is in the import sheet's dots menu.

![Register a source is available before choosing a file.](facilities-guide-register-source-button.png)

![Open the import sheet dots menu when sources already exist.](facilities-guide-register-existing-actions.png)

![Register a source is available for adding a different register.](facilities-guide-register-existing-menu.png)

### 4. Enter the register's permanent URI

In **Canonical URI**, use the identifier supplied by the organisation maintaining the register. For your own list, choose a stable URI once. The fictional example uses `urn:example:facilities:guide`.

![Use the permanent URI that identifies this register.](facilities-guide-register-url.png)

### 5. Enter its display name

In **Display name**, enter the name people should choose. The example uses `Example facility register`.

![The display name appears when you choose a register.](facilities-guide-register-name.png)

### 6. Enter a short code

In **Code**, enter a short identifier for this register. The example uses `EXAMPLE`. Version, jurisdiction and contact are optional.

![Use a short code for this register.](facilities-guide-register-code.png)

### 7. Register the source

Open this panel's dots menu and select **Register**.

![The source registration actions are in its own dots menu.](facilities-guide-register-actions.png)

![Register saves the source without importing a file.](facilities-guide-register-save.png)

**Expected result:** the new register is selected in the import sheet. Registering the source has not imported any facility rows.

![The registered source is now available for adding or importing facilities.](facilities-guide-register-selected.png)

### 8. Close the import sheet if you are adding by hand

Select **Close** at the top right. To import a file instead, keep the sheet open and [continue with the file import](#choose-your-register-file).

![Close the import sheet if you want to add a facility manually.](facilities-guide-close-import.png)

## Start a facility record

Add a facility by hand when you have one site to enter. The following steps use the published form in this installation. Fill the required fields shown by your own form.

### 1. Choose Add facility

On **Registry**, open the page dots menu and select **Add facility**.

![The Registry dots menu contains Add facility.](facilities-guide-add-actions.png)

![Choose Add facility to open the published form.](facilities-guide-add-menu.png)

### 2. Choose System

Under **System**, select the registered source this facility belongs to. The name selects its canonical URI.

![Choose the register this facility belongs to.](facilities-guide-add-system.png)

### 3. Enter Facility code

Enter the exact code used by that register, including any leading zeros. The example uses `EXAMPLE-CLINIC-01`.

![Keep the exact facility code, including any leading zeros.](facilities-guide-add-code.png)

### 4. Enter Name

Enter the facility's readable name. The example uses `Example Clinic North`.

![Enter the facility name people should see.](facilities-guide-add-name.png)

### 5. Choose Country

Search for the country, then select a result. Typing a search alone does not select the answer.

![Search Country, then select the matching result.](facilities-guide-add-country.png)

### 6. Enter Zone if your form requires it

Enter the facility's actual zone. Suggestions come from locations already entered in this register. The screenshot uses `Example Zone`.

![Complete required location fields. This form requires Zone.](facilities-guide-add-zone.png)

### 7. Enter District and any other required location fields

This form also requires **District**. Fill it with the facility's district. Complete Region or Council when you have those details.

![This form also requires District.](facilities-guide-add-district.png)

**Continue below:** the record is still in the open New facility sheet. It has not been saved.

## Finish and save the facility

Continue in the open **New facility** sheet. Choose the facility's status and type from the configured terminology, then save it.

### 1. Choose Status

Search under **Status** and select the appropriate result. The example chooses **Active**.

![Select a status from the terminology results.](facilities-guide-add-status.png)

### 2. Choose Level

**Level** selects the facility type. Search and choose the type that fits this site. Use the types available in your installation.

![Choose the facility type in Level from the available results.](facilities-guide-add-level.png)

### 3. Open the sheet dots menu

Select the dots below the sheet title, near the top right.

![The form actions are in the sheet dots menu.](facilities-guide-add-sheet-actions.png)

### 4. Choose Create

Select **Create**. If the form marks missing fields, complete them and try again.

![Create saves the facility after checking the form.](facilities-guide-add-create.png)

**Expected result:** the sheet closes and Registry reloads. The facility appears with its code, name and source. If an active filter hides it, search for its code.

![The facility now appears in Registry.](facilities-guide-add-result.png)

## Find and change a facility

Use this when a name, location or another detail needs correcting. Searching first also helps you avoid adding a second record for an existing facility.

### 1. Search for the facility

In **Search facilities…**, enter its name or code. The example searches for `EXAMPLE-CLINIC-01`.

![Find a facility by its name or code.](facilities-guide-search-input.png)

### 2. Open its row

Select the facility's row. Its stored details open in **Edit facility**.

![Select a Registry row to open its details.](facilities-guide-edit-row.png)

### 3. Change the details

Edit the field you need to correct. Here, Name changes to `Example Clinic North Updated`.

![Change the name or the other details you need to correct.](facilities-guide-edit-name.png)

### 4. Open the sheet dots menu

Select the sheet's dots below the title.

![Open the sheet dots menu when your changes are ready.](facilities-guide-edit-actions.png)

### 5. Choose Save

Select **Save**. Existing records use Save; new records use Create.

![Existing facilities use Save.](facilities-guide-edit-save.png)

**Expected result:** Registry shows the changed details. The example keeps the same facility code. System and Facility code can also be corrected when necessary; do not delete the record just to correct its code.

![The updated name appears beside the same code.](facilities-guide-edit-result.png)

## See what changed

History shows recorded changes to one facility, with the time and actor. You can read it without changing the record.

### 1. Open the row dots menu

Select the dots at the right end of the facility's row.

![Each facility row has its own dots menu.](facilities-guide-history-row-actions.png)

### 2. Choose History

Select **History**.

![History opens the saved changes for this facility.](facilities-guide-history-menu.png)

**Expected result:** Facility history lists changes newest first. The example shows the name change and the original creation.

![History shows the actor, time and field changes, newest first.](facilities-guide-history-result.png)

### 3. Close History

Select **Close** at the top right to return to Registry.

![Close returns to Registry without changing the facility.](facilities-guide-history-close.png)

## Choose your register file

Use an import when you already have a list of facilities. Choose your own CSV, JSON Lines or Excel `.xlsx` file. An import needs a column for the facility code and a column for the name. Other fields can be mapped, supplied as fixed values, or kept as extra data.

Use the registered source that owns the codes in this file. Manual form requirements do not determine the import's required columns.

### 1. Open Import facilities

On Registry, open the page dots menu and select **Import facilities**.

![Import starts from the Registry page dots menu.](facilities-guide-import-actions.png)

![Choose Import facilities to open the three-step wizard.](facilities-guide-import-menu.png)

### 2. Choose your file

Select the File area and choose your prepared file. Its name appears under Source. The format follows the file you chose.

![The selected file name appears in Source.](facilities-guide-import-file.png)

![The format follows the chosen file. Check it before continuing.](facilities-guide-import-format.png)

### 3. Choose National system

Select the registered source for this file. If it is missing, [register its source](#register-the-source-of-your-facility-list) first.

![Choose the registered source that owns these facility codes.](facilities-guide-import-register-step-3.png)

### 4. Decide whether this is a complete release

Tick **This file is a complete release** only when it contains the whole register. Leave it unticked for a partial file. A complete release enables checking which existing facilities are absent from it.

![Leave complete release unticked when this is only part of a register.](facilities-guide-import-complete-release.png)

### 5. Continue to Mapping

Select **Continue**. This uploads and stores the file, then opens Mapping. No facility rows have been imported yet.

![Continue stores the file and opens Mapping. It does not import facility rows.](facilities-guide-import-continue.png)

## Map the columns and fixed values

Mapping connects your file's headings to OpenLDR's fields. The suggested map is a starting point. Check the code and name columns, then decide how to handle the other columns.

### 1. Check the required columns

The column carrying your facility code must map to `national_code`. The readable name must map to `name`. Open the list beside a heading to correct its target.

![Check that the file column carrying the facility code maps to national_code.](facilities-guide-map-code.png)

![Check that the facility name column maps to name.](facilities-guide-map-name.png)

### 2. Correct other column targets

Choose the appropriate field beside each heading. Here, **Operating Status** must map to `status`, rather than remaining extra data.

![Choose status for the column holding operating status.](facilities-guide-map-status-option.png)

### 3. Keep additional columns when needed

For a column that does not fill a standard field, open that row's dots menu and select **Keep as extra**. This example keeps Notes.

![Use the Notes row dots menu when you want to retain this extra column.](facilities-guide-map-extra-actions.png)

![Keep as extra explicitly retains the source column.](facilities-guide-map-extra-save.png)

### 4. Supply fixed values for missing columns

If every facility shares a value absent from the file, enter it under **Fixed values**. Here, Country is selected from its terminology list. Every row receives that country.

![A fixed Country value fills that field for every row when the file has no country column.](facilities-guide-map-fixed-country.png)

### 5. Decide how to handle changes after the preview

Under **Rows changed since this preview**, choose whether to skip those rows or overwrite them with the file. The default keeps those registry rows untouched.

![Decide what to do if a row changes after this preview. The default keeps that row untouched.](facilities-guide-map-conflict-policy.png)

### 6. Validate the file

Select **Validate all**. The file is checked in the background, then the wizard opens Review. Fix any missing required column mapping before continuing.

![Validate all checks the stored file with the current mapping.](facilities-guide-map-validate.png)

**Expected result:** Review describes what the current file and mapping would do. If it lists values with no canonical mapping, decide those values as shown below.

![Review reports values that did not match the configured vocabulary.](facilities-guide-review-unmapped.png)

## Decide unrecognised values

A file can use different words from your configured terminology. Map those words to the intended values. The example file uses Operating and Closed for status.

### 1. Return to Mapping

In Review, select **Map these values**. The choices appear below their file column on Mapping.

![Map these values returns to Mapping so you can decide the unmatched values.](facilities-guide-review-map-values.png)

### 2. Choose the meaning of Operating

For this example, select **Active** for Operating. For your file, choose the value that has the same meaning.

![Map Operating from the file to the configured Active status.](facilities-guide-map-operating.png)

### 3. Choose the meaning of Closed

For this example, select **Inactive** for Closed. Do not map different meanings together just to remove a warning.

![Map Closed from the file to the configured Inactive status.](facilities-guide-map-closed.png)

### 4. Check again

Select **Validate all**. The value decisions are saved for this register and the file is checked again.

![Validate all saves your value decisions and checks the file again.](facilities-guide-map-revalidate.png)

**Expected result:** Review reflects the new decisions. In this example, the unmapped-status warning disappears.

## Review and apply the import

Read the planned changes before writing them. A new file may create rows, change existing rows or match rows already in the registry. Counts depend on your file and current register.

### 1. Read the summary

Check the new, changed, unchanged and skipped counts, plus any warnings. If something is wrong, return to Mapping and validate again. Review reports the decisions; it does not edit them.

![Read the planned new, changed, unchanged and skipped row counts before importing.](facilities-guide-review-summary.png)

### 2. Confirm the reviewed import

Select **Confirm import**. Wait for the completion panel.

![Confirm import applies the reviewed changes.](facilities-guide-import-confirm.png)

**Expected result:** Import complete reports what was created, updated, unchanged or skipped.

![The completion panel reports what was created, updated or skipped.](facilities-guide-import-complete.png)

### 3. Return to Registry

Select **Close** at the top right. The registry reloads with the imported facilities.

![Close the completed import to return to Registry.](facilities-guide-import-close.png)

![The imported facilities appear alongside the facility you entered by hand.](facilities-guide-import-result.png)

## Refresh an existing register

When a register's next file arrives, repeat the same import with the same National system. The register and facility code identify existing rows. You do not need to create those facilities again by hand.

### 1. Reuse the registered source

Choose the same register in the new import and repeat the Source and Mapping steps above. Check the columns again.

![Choose the registered source that owns these facility codes.](facilities-guide-import-register-step-1.png)

### 2. Read which rows would change

After validation, review the counts. Repeating the identical example file finds two unchanged rows and creates none.

![The same register and codes are recognised on a repeat import. Unchanged rows are reported.](facilities-guide-reimport-summary.png)

### 3. Apply the reviewed changes

Select **Confirm import** when the summary matches your intention.

![Confirm import applies only the changes shown by the review.](facilities-guide-reimport-confirm.png)

**Expected result:** the repeated file reports unchanged rows instead of creating duplicates. A changed file reports its actual differences.

![A repeat import reports unchanged rows instead of creating duplicates.](facilities-guide-reimport-complete.png)

## Link received codes that match the register

Do this after lab data has arrived. Observed lists the facility codes received with that data. If it is empty, you can still build Registry now and return after your normal data feed arrives.

Exact-code matching links an observed code to the facility with the same code in the register you choose. Existing mappings are kept.

### 1. Open Observed

Select **Observed** beside Registry.

![Observed shows facility codes received in lab data.](facilities-guide-observed-tab.png)

### 2. Choose Link matching codes

Open the Observed page dots menu and select **Link matching codes**.

![The Observed tab has its own page dots menu.](facilities-guide-observed-actions.png)

![Link matching codes previews exact-code matches in a chosen register.](facilities-guide-matching-menu.png)

### 3. Choose the register

Select the register whose codes you want to match.

![Choose the register to check against the observed codes.](facilities-guide-matching-register.png)

### 4. Read the proposed matches

Check the counts and facility names. This example has three codes to link and one with no match. Your counts come from your own data.

![Check which codes would link, which already link and which have no match.](facilities-guide-matching-preview.png)

### 5. Open Link actions

Select the dots at the top right of this sheet.

![Open the Link actions dots menu after reviewing the preview.](facilities-guide-matching-actions.png)

### 6. Apply the matches

Select **Link N codes**, where N is the number in your preview. The example shows Link 3 codes.

![Link 3 codes applies only the matches in this preview.](facilities-guide-matching-apply.png)

**Expected result:** the matched codes show the corresponding Registry facility under Resolves to. Report facilities may show Updating while the report lookup is rebuilt, then Current.

![The exact-code matches now resolve to their Registry facilities.](facilities-guide-matching-result.png)

## Link a code that is different in the source

Use this when a source uses a different code for the same physical facility. Choose the Registry facility it really represents. The example maps EXTERNAL-CLINIC to the existing north clinic.

### 1. Choose Map on the observed row

Open that row's dots menu and select **Map**. A mapped row offers Edit mapping instead.

![For a different code, use that observed row's dots menu.](facilities-guide-mapping-row-actions.png)

![Map code lets you choose the same facility when the source uses a different code.](facilities-guide-mapping-menu.png)

### 2. Search for the destination facility

In Target, use **Search terms** to find the facility by its name or code. System is fixed to FACILITY-REGISTRY in this flow.

![Search for the Registry facility that this observed code represents.](facilities-guide-mapping-search.png)

### 3. Select the matching facility

Choose the correct facility from the results.

![Choose the matching facility from the search results.](facilities-guide-mapping-target.png)

### 4. Check the map type

Keep **Same as** when both codes mean the same facility. A broader or narrower relationship is not an identity match.

![Same as means the observed code identifies the same facility.](facilities-guide-mapping-type.png)

### 5. Open the mapping dots menu

Select the dots at the top right of the mapping sheet.

![Mapping actions are in the sheet dots menu.](facilities-guide-mapping-sheet-actions.png)

### 6. Choose Create

Select **Create** for the new mapping. An existing mapping uses Save.

![Create saves this observed-code mapping.](facilities-guide-mapping-create.png)

**Expected result:** Resolves to shows the chosen facility beside the source's different code.

![The source code now resolves to the selected Registry facility.](facilities-guide-mapping-result.png)

## Use Facilities on a phone

The same Registry and Observed tasks are available on a phone. The header wraps to leave room for the report status.

### 1. Choose Registry

Select **Registry** at the top to work with the facility list.

![Registry and Observed remain at the top on a phone.](facilities-guide-phone-registry.png)

### 2. Choose Observed

Select **Observed** to work with received codes.

![Use Observed on a phone to see received facility codes.](facilities-guide-phone-observed.png)

### 3. Open that tab's dots menu

Select the dots at the right of the tab strip. The available actions follow the selected tab. Scroll a table horizontally if its remaining columns are off screen.

![The same actions are available in the tab strip dots menu.](facilities-guide-phone-actions.png)

## Optional practice with fictional data

You can complete every task above using your own data. These files are only for practice in a test installation:

- [Download the two-facility CSV](https://openldr.online/docs-samples/example-facilities.csv) used in the import screenshots.
- [Download the seven-resource lab-data bundle](https://openldr.online/docs-samples/example-observed-data.json) used to demonstrate received facility codes. It contains a fictional patient, three requests and three reports.

For the same three exact-code matches shown above, also add `EXAMPLE-CLINIC-01` using the manual-entry task. Use the Example facility register for these fictional records. With only the two-row CSV, there are fewer exact-code matches; the link preview explains which codes have no match.

Import the CSV through the browser using the instructions above. To load the optional lab-data bundle, first read [Start here](/docs/start-here) for installed and development CLI instructions. Put the downloaded JSON in the installation's `data` folder.

Installed Linux or macOS example:

```shell
cd ~/Downloads/openldr_ce
./openldr ingest data/example-observed-data.json
```

Installed Windows example:

```shell
cd C:\openldr_ce
.\openldr.ps1 ingest data\example-observed-data.json
```

Development checkout example, after saving the file under its `data` folder:

```shell
cd ~/Downloads/openldr_ce
pnpm openldr ingest data/example-observed-data.json
```

These are example installation folders. Replace them with your real folder, as explained in Start here. Return to Observed after the import completes, then follow the linking tasks above.

## Troubleshooting

### Create marks required fields

Complete the marked fields in the published form. In a terminology field, select a search result rather than leaving only the search text. Then choose Create again.

![Missing required fields are shown on the form before anything is saved.](facilities-guide-required-error.png)

### A facility with that code already exists in this register

The same System and Facility code pair cannot be added twice. Close the new form, find the existing row and edit it. The reproduced error below refers to the national code, which this form calls Facility code.

![An existing register and facility-code pair cannot be created twice.](facilities-guide-duplicate-error.png)

### The mapping says a required field has no column

Map the facility-code column to `national_code` and the facility-name column to `name`, or supply the appropriate fixed value. Then validate again.

![The mapping names required fields that have no source column or fixed value.](facilities-guide-missing-code-error.png)

![Restore the facility-code column to national_code before checking again.](facilities-guide-missing-code-fix.png)

### An observed code still says Not mapped

Importing a register alone does not link received codes. Use Link matching codes for exact codes, or the observed row's Map action when the source uses a different code.

### Add or Edit is unavailable

These actions need Manage facilities and one published form targeting Facilities. The page names a missing form. Open Forms to publish or correct that form before trying again. Importing a register does not require the facility-entry form.

### A saved facility is not in the visible list

The current search, filters and page still apply after saving. Search for the facility code to check the record.

## Keep these distinctions in mind

Manual entries follow your published Facility form. File imports use their column mapping instead. A register source, a Registry facility and a mapping from an Observed code are separate records.

A partial file does not evaluate facilities absent from the file. Only mark a file as a complete release when it contains the whole register, then read the additional decisions on Mapping and the resulting Review.

## Related guides

[Terminology](/docs/terminology) explains controlled lists and codes. [Start here](/docs/start-here) explains the CLI. [Dashboards](/docs/dashboard) covers charts and optional data practice. [Your preferences](/docs/user-preferences) covers your personal settings.
