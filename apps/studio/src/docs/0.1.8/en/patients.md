# Patients

Find the patient records received with lab data, read their identifiers and requests, and review possible duplicates. The Patients page reads source records. It does not offer patient editing or merging.

**Patient settings are optional.** OpenLDR receives patients with lab data before you label identifier systems. We strongly recommend adding useful labels and reviewing possible duplicates during use.

Use your own received records and identifier systems. No documentation sample data is required. The pictures show fictional patients in a test installation. [Optional practice data](#optional-practice-with-fictional-patients) is at the end.

**View patient index** allows a masked list and exact-identifier searches. **View patient identifiers** allows full names, identifiers, dates of birth and contact details, plus name searches. These unmasked views are audited. The pictures use this permission.

**Manage patient index** allows identifier-system settings and duplicate decisions. A lab receiving identifier labels from central cannot change those shared labels here.

## Find a patient and read their details

Use this when you need to check who a source record describes and which lab requests belong to it. If the list is empty, return after your normal feed has sent patient data.

### 1. Open Patients

Select **Patients** in the main menu, then use the **Patients** tab.

![Patients is in the main menu on the left.](patients-guide-open-page.png)

![Patients lists records received from your source systems.](patients-guide-patients-tab.png)

### 2. Search for the person

In **Search name or identifier**, enter a name or identifier. Without permission to view identifiers, the field reads **Exact identifier** and requires the complete identifier value.

![With identifier-view permission, search can find part of a name.](patients-guide-search-name.png)

### 3. Check the matching row

Read the name, sex, age, listed identifiers and request count. Match the person using your source records. Names alone do not establish identity.

![Read the matching patient row before opening it.](patients-guide-search-result.png)

### 4. Open the patient

Select the row. **Identity** in the Patient sheet shows source details. The row dots menu also offers **View**.

![Select the patient row to open its read-only details.](patients-guide-open-row.png)

![View in the patient row menu opens the same details.](patients-guide-row-view.png)

![Identity shows source details. The Patients page does not edit them.](patients-guide-identity.png)

### 5. Read the identifiers

Under **Identifiers**, read each identifier system and value. A system label changes the display name, not the source value.

![Identifiers shows the systems and values received for this patient.](patients-guide-identifiers.png)

### 6. Read the requests

Under **Requests**, check the order dates, panels, requesting facilities, statuses and result counts. Use the request pagination if there are more rows.

![Requests shows this patient's orders, status and result counts.](patients-guide-requests.png)

### 7. Close the sheet

Select **Close** at the top right to return to the list.

![Close returns to the patient list.](patients-guide-close-details-step-7.png)

**Expected result:** You can inspect the record without changing patient details. Corrections to source identity data belong in the system that maintains it.

## Name an identifier system and show it in the list

An identifier system is the URI that says what kind of identifier a value is. Configure systems that have arrived from your data sources. Use a label people recognise.

### 1. Open Identifier systems

Select **Identifier systems** at the top of Patients. It lists received systems and patient counts.

![Identifier systems lists the identifier types that have arrived.](patients-guide-identifier-tab.png)

### 2. Choose Edit for the system

Open the dots on the correct system row and select **Edit**. Check the URI before changing its settings.

![Open the dots beside the identifier system you want to label.](patients-guide-identifier-row-actions.png)

![Edit opens this identifier system's display and search settings.](patients-guide-identifier-edit.png)

### 3. Enter the label

In **Label**, enter the readable name. The fictional example uses `Example ID`. Leave it blank to use the source-provided name.

![Give this identifier system a name people recognise. The example uses Example ID.](patients-guide-identifier-label.png)

### 4. Choose whether to show its values

Turn on **Show in the list** to include this system in the Patients table's Identifiers column.

![Show in the list includes this identifier system in the patient table.](patients-guide-identifier-list.png)

### 5. Check whether searches should match it

Keep **Search matches it** on for useful identifying values. Turn it off for a placeholder system that should not identify a person. It also affects same-identifier duplicate matching.

![Search matches it determines whether identifiers from this system participate in searching.](patients-guide-identifier-searchable.png)

### 6. Open Identifier system actions

Select the dots in this settings sheet.

![Identifier system settings have their own dots menu.](patients-guide-identifier-actions.png)

### 7. Save the settings

Select **Save**.

![Save stores the label and display/search choices.](patients-guide-identifier-save.png)

**Expected result:** The system row shows its saved label and display/search settings.

![The identifier system now displays the saved label.](patients-guide-identifier-saved.png)

## Find a patient by a listed identifier

Search by the identifier value, not the label. More than one matching record can appear when the source contains a shared or duplicated identifier.

### 1. Return to Patients and search

Select **Patients** and enter the identifier value. The example searches `DOCS-001`.

![Patients lists records received from your source systems.](patients-guide-patients-tab.png)

![Search an identifier value rather than its label. These two fictional records deliberately share DOCS-001.](patients-guide-search-identifier.png)

### 2. Check the labelled value

Read the Identifiers column. This example shows **Example ID: DOCS-001**. The two fictional records deliberately share it.

![The listed identifier appears with its configured label.](patients-guide-listed-identifier.png)

**Expected result:** Matching patients appear with the configured identifier label. An empty Identifiers column does not mean the source record has no identifiers; check the display setting.

## Find records marked Merged

Use this when the source has made a record inactive or reported a replacement. The default patient list shows active records.

### 1. Open Filter

Select **Filter** above the patient list.

![Use Filter to include records marked Merged by the source.](patients-guide-filter-open.png)

### 2. Add a filter

Select **Add filter**.

![Add filter starts a Status rule.](patients-guide-filter-add.png)

### 3. Check the Status rule

Use **Status** as the column and keep **Equals**.

![Choose Status and keep its equals operator.](patients-guide-filter-status.png)

### 4. Choose Merged

Select **Merged** as the value.

![Choose Merged to inspect inactive or replaced records.](patients-guide-filter-merged.png)

### 5. Apply the filter

Select **Apply**.

![Apply updates the patient list with this Status rule.](patients-guide-filter-apply.png)

**Expected result:** The list shows records marked Merged. A badge appears beside their names. Clear the status filter when you want active records again.

![Merged records show a badge beside the patient name.](patients-guide-merged-row-step-0.png)

## Follow a replacement reported by the source

A replaced record can point to the patient it was merged into upstream. OpenLDR follows that reported link; this action does not merge records.

### 1. Open the merged record

Select the merged patient row. A reported replacement adds an actions menu in its Identity section.

![Merged records show a badge beside the patient name.](patients-guide-merged-row-step-1.png)

![A source-reported replacement adds a patient-sheet dots menu.](patients-guide-merged-actions-step-1.png)

### 2. Open the patient-sheet actions

Select the dots beside **Identity**.

![A source-reported replacement adds a patient-sheet dots menu.](patients-guide-merged-actions-step-2.png)

### 3. Follow the replacement

Select **Open the patient this record was merged into**.

![Open the patient this record was merged into follows the source replacement.](patients-guide-merged-replacement.png)

**Expected result:** The replacement patient opens in the read-only Patient sheet.

![The replacement patient opens in the same read-only sheet.](patients-guide-replacement-result.png)

## Inspect a possible duplicate group

Review the evidence before deciding whether records describe the same person. A shared identifier can be a data-entry problem or a placeholder. OpenLDR does not resolve that decision for you.

### 1. Open Duplicates

Select **Duplicates** at the top of Patients.

![Duplicates lists groups that may represent the same person.](patients-guide-duplicates-tab.png)

### 2. Read the rule and evidence

Check why each group was suggested and how many patients it contains. The example matches a shared identifier.

![Read the rule and evidence before deciding whether the group is a duplicate.](patients-guide-duplicate-group.png)

### 3. Open the group

Select the group row to open **Likely duplicates**.

![Select the group row to inspect its members.](patients-guide-duplicate-open.png)

### 4. Compare the members

Read the evidence, identifiers and available identity details. Same-name matching also requires matching birth details and compatible sex values.

![The group sheet explains why these patients were matched.](patients-guide-duplicate-evidence.png)

### 5. Open a member when needed

Use that member's dots menu and select **Open patient** to inspect its full record and requests.

![Each member has its own dots menu for opening the full patient.](patients-guide-member-actions.png)

![Open patient opens the selected member's read-only record.](patients-guide-member-open.png)

**Expected result:** The selected member opens in a read-only Patient sheet. No patient record is merged by reviewing the group.

![Open patient displays the selected member in its read-only patient sheet.](patients-guide-member-view-result.png)

## Record that a group contains different people

Only use this after checking that the suggested records are different people. For an actual duplicate, correct the source records instead. The group decision is reversible.

### 1. Return to the group

If a member's Patient sheet is open, select **Close** to return to Likely duplicates.

![Close returns to the patient list.](patients-guide-close-details-step-1.png)

### 2. Enter a reason if useful

In **Reason**, record why these are different people. The example explicitly describes its fictional demonstration.

![If you have confirmed different people, enter a reason for the decision.](patients-guide-duplicate-reason.png)

### 3. Open the group actions

Select the dots beside the group's Evidence heading.

![Use the group dots menu to record your decision.](patients-guide-duplicate-actions.png)

### 4. Mark the group as different people

Select **Mark as not duplicates**.

![Mark as not duplicates hides this reviewed group from Open. It does not merge or delete patients.](patients-guide-duplicate-mark.png)

**Expected result:** The group disappears from Open. Patient records remain unchanged.

![The reviewed group is absent from the Open list.](patients-guide-duplicate-dismissed.png)

## Show a reviewed group again

Use this to undo a previous Not duplicates decision and return the group for review.

### 1. Choose Not duplicates

In Duplicates, open **Status** and choose **Not duplicates**.

![Use Status to find groups marked as not duplicates.](patients-guide-duplicate-status.png)

![Not duplicates lists reviewed groups.](patients-guide-duplicate-status-option.png)

### 2. Open the reviewed group

Select its row.

![Open the reviewed group if you need to undo the decision.](patients-guide-duplicate-reopen.png)

### 3. Choose Show again

Open the group dots menu and select **Show again**.

![Use the group dots menu to record your decision.](patients-guide-duplicate-actions.png)

![Show again returns the group to Open without changing patient records.](patients-guide-duplicate-restore.png)

### 4. Return to Open

Use **Status** to choose **Open**.

![Choose Open to return to unresolved duplicate groups.](patients-guide-duplicate-status-open.png)

**Expected result:** The group is back in the open review list.

![The group is back in Open for review.](patients-guide-duplicate-restored.png)

## Export open duplicate groups

Use this when the team maintaining the source records needs the open groups. Export requires View patient identifiers and is audited.

### 1. Open Duplicates actions

Select the dots above the Duplicates table.

![The Duplicates tab has a separate export menu.](patients-guide-duplicate-export-actions.png)

### 2. Choose Export CSV

Select **Export CSV**. The browser downloads the open groups.

![Export CSV downloads open groups for the team that maintains the source data.](patients-guide-duplicate-export.png)

**Expected result:** The CSV includes the identifiers needed for source review. The export does not mark or merge any patient.

## Use Patients on a phone

The tabs and patient sheet remain available on a phone. A wide list can scroll horizontally.

### 1. Choose the tab

Use Patients, Identifier systems or Duplicates at the top.

![Patients, Identifier systems and Duplicates remain at the top on a phone.](patients-guide-phone-tabs.png)

### 2. Search for the patient

Use the search field, with the same identifier permissions as on desktop.

![Use the patient search on a phone.](patients-guide-phone-search.png)

### 3. Open the patient details

Select the matching row and scroll the Patient sheet to read its sections.

![The patient sheet uses the phone width and scrolls through its sections.](patients-guide-phone-details.png)

## Optional practice with fictional patients

Every task above can use your received records. This optional file is only for a test installation. It contains three fictional patient records, one request, one report and one result. Two patient records share an identifier; one old record points to its replacement.

[Download the six-resource practice bundle](https://openldr.online/docs-samples/user-guide/patients/example-patients.json). Read [Start here](/docs/start-here) for installed and development CLI instructions, then put the file in your installation's data folder.

Development checkout example:

```shell
cd ~/Downloads/openldr_ce
pnpm openldr ingest data/example-patients.json
```

For an installed Linux or macOS copy, use `./openldr` instead of `pnpm openldr`. On Windows, use `.\openldr.ps1` from your installation folder, such as `C:\openldr_ce`. Replace example folders with your real folder. Start here shows each platform.

The fixture does not require the optional Test catalog practice files. Request and patient counts in your installation can differ from the pictures.

## Understand masking and duplicate limits

Without View patient identifiers, names are masked, identifiers show only their last four characters, and birth dates show only the year. Phone and email are hidden. Search requires an exact identifier. These limits also apply when inspecting duplicate groups.

Same-identifier groups use the same value in the same searchable identifier system. Identifiers with no system and systems with Search matches it off are excluded. Name-and-birth-date matching ignores case, spacing and accents. Active records are compared.

A group shows at most 50 members. A larger group cannot be marked here. Check whether a placeholder identifier has been used for many people and correct the source data or searchable-system setting.

Patient data belongs to the source workflow. This page reads identity records, labels identifier systems and records duplicate-review decisions. It has no patient-edit or merge action.

## Troubleshooting

**The patient list is empty.** Check whether patient data has arrived from your normal feed. You do not need sample data or identifier labels to receive patients.

**Part of a name finds nothing.** A user without View patient identifiers must search the complete identifier value. Check Search matches it for that identifier system.

**The Identifiers column is empty.** Enable Show in the list for a received system. Open the Patient sheet to check the source identifiers themselves.

**Identifier settings cannot be edited.** Check Manage patient index and whether the labels come from central. A central-managed lab reads those labels here.

**The sheet says the list is out of date.** Reload the page and reopen the patient. The list reference can expire after a server restart.

**A duplicate group returns after a source update.** Compare the current membership and evidence. Correct actual duplicates in the source system rather than marking them as different people.

## Related guides

[Facilities](/docs/facilities) explains facility identity. [Test catalog](/docs/test-catalog) explains test and result codes. [Start here](/docs/start-here) explains the CLI.
