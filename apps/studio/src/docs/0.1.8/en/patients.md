# Patients

**Patients** lists every patient OpenLDR has received with lab data, and where they were tested. The source system, such as a HIMS or a lab system, owns each patient. OpenLDR shows patients and never edits them.

Patient settings are optional. OpenLDR receives patient records with your lab data without requiring you to label identifier systems first. We strongly recommend configuring these settings and reviewing possible duplicates as you use the system.

This guide takes about 15 minutes. It uses the docs sample data, so load that first. Select any picture or clip to enlarge it.

![Patients with the sample data loaded: 25 patients.](patients-list.png)

## Who can do what

| Permission | What it lets you do |
| --- | --- |
| View patient index | Open **Patients**. Names and identifiers are masked, and search matches an exact identifier only. |
| View patient identifiers | See names, identifiers, date of birth, phone and email in full, and search by part of a name. Every unmasked view is audited. |
| Manage patient index | Name identifier systems, and choose which ones are listed and searched. Mark duplicate groups. |

### What masking hides

Without **View patient identifiers**:

- A name shows its first letter, such as `J*** M***`.
- An identifier shows its last four characters.
- You see the birth year, not the date of birth, and no phone or email.
- Search matches an exact identifier only. A partial name search would reveal names one letter at a time.

With it, you see everything, and search also matches part of a name. Every list and every patient you open is written to the audit log. The log records how many patients matched, never what you searched for.

## Before you start

The examples need the docs sample data. If **Total Orders** on the sample dashboard reads 0, load it first. See [Load the sample data](/docs/dashboard#load-the-sample-data).

With the sample loaded, the list shows 25 patients: the 24 sample patients and one patient a new install seeds itself, **Seed Sample**. Ages are worked out from today's date, so yours may differ by a year from the pictures.

## Example 1: open a patient

![Selecting Chausiku Demo to open the patient sheet.](patients-sheet.mp4)

1. Open **Patients**.
2. Select the row **Chausiku Demo**, aged 32, with 4 requests.

![The patient sheet: identity, identifiers and requests.](patients-sheet-detail.png)

**Expected result:** the **Patient** sheet. **Identity** shows sex M, date of birth 1994-05-14, and **Source id** SAMPLE-0004. **Identifiers** lists `urn:openldr:sample:patient` SAMPLE-0004. **Requests** lists four orders, newest first, with their panel, requesting facility, status and number of results. One Full blood count is **revoked**, with 0 results.

You can also open a patient with **View** in its row menu. If a record was merged into another, the sheet's menu offers **Open the patient this record was merged into**.

If the sheet says the list is out of date, the server has restarted. Reload the page.

## Example 2: name an identifier and search by it

Each identifier arrives with a **system**: a URI that says what kind of identifier it is, such as a national ID or an ART number. The sample patients use `urn:openldr:sample:patient`. By default no system is shown in the list, so the **Identifiers** column is empty.

![Labelling the sample system Sample ID, showing it in the list, and searching SAMPLE-0007.](patients-identifier-system.mp4)

1. Open the **Identifier systems** tab. It lists every system seen, with how many patients carry it. The sample system has 24.
2. Open the row menu of `urn:openldr:sample:patient` and select **Edit**.
3. In **Label**, type `Sample ID`.
4. Turn on **Show in the list**. Leave **Search matches it** on.
5. Open the sheet's actions menu and select **Save**.
6. Go back to the **Patients** tab. In **Search name or identifier**, type `SAMPLE-0007`.

**Expected result:** one patient, **Hamisi Sample**, F, with `Sample ID: SAMPLE-0007` in the **Identifiers** column.

![Search by the sample identifier: one match.](patients-search.png)

- Leave **Label** empty to use the name the source system sends.
- **Show in the list** adds the system to the **Identifiers** column.
- **Search matches it** lets search find patients by it.
- A lab that receives these labels from central cannot change them.

You need **Manage patient index** to edit a system.

## Find a patient

Type any identifier, such as an MPI number or a national ID, and OpenLDR finds the patient whichever identifier it is. **Filter** and **Status** show merged records too. **Columns** chooses what the list shows.

## Duplicates

The **Duplicates** tab lists patients that look like the same person.

![The Duplicates tab with the sample data: No likely duplicates.](patients-duplicates.png)

With the sample data it reads **No likely duplicates.** OpenLDR finds two kinds:

- **Same identifier.** Two or more patients carry the same value in the same identifier system, such as the same NRC. Identifiers with no system, and systems where **Search matches it** is off, are not used.
- **Same name and date of birth.** Surname, first name and date of birth match, ignoring case, extra spaces and accents. Patients whose sexes differ are not matched. A patient with no date of birth is never matched this way.

The sample has two patients called Amina Demo. They are not a duplicate group: their dates of birth and sexes differ.

Only active patients are compared. OpenLDR does not merge patients. Fix duplicates in the source system, and its next update clears the group here.

- Select a group to see its patients. **Open patient** in a patient's menu opens the full record.
- The list shows at most 50 patients per group, and says how many it shows out of the total. A group bigger than that cannot be marked here. Fix it in the source system, or turn off **Search matches it** for that identifier system. A placeholder identifier shared by many patients is the usual cause.
- With **Manage patient index**, **Mark as not duplicates** in the group's menu records that the patients are different people. You can add a reason. Use **Status** to see these groups again, and **Show again** to undo.
- With **View patient identifiers**, **Export CSV** in the tab's menu sends the open groups to the source system's team. Each export is audited.

## On a phone

The patient list and the sheet work on a phone.

![Patients on a phone.](patients-phone.png)

## After upgrading

Patients received before this release have no identifiers listed until you run `openldr db reproject --force` once. It also fills in what OpenLDR needs to find patients with the same name and date of birth.

## From the command line

- `openldr patients list [--search <text>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <system> [--label <text>] [--list-column on|off] [--searchable on|off]`
- `openldr patients duplicates list [--status open|dismissed|all] [--limit <n>] [--offset <n>] [--identifiers]`
- `openldr patients duplicates dismiss <idA> <idB> [--reason <text>]` and `restore <idA> <idB>`
- `openldr patients duplicates export [--out <file>]`

Output is masked unless you pass `--identifiers`. `patients list` and `patients show` with `--identifiers` are audited. So are `duplicates list` with `--identifiers` and `duplicates export`, which is always unmasked. `duplicates dismiss` and `restore` are audited too.

For example, the same label as Example 2:

```bash
./openldr patients identifier-systems set urn:openldr:sample:patient --label "Sample ID" --list-column on
```

## Troubleshooting

- **Names show as `J*** M***`.** Your role lacks **View patient identifiers**.
- **Search finds nothing for part of a name.** Without **View patient identifiers**, search matches an exact identifier only.
- **The Identifiers column is empty.** No identifier system has **Show in the list** on. See [Example 2](#example-2-name-an-identifier-and-search-by-it).
- **Search does not find a patient by an identifier.** That system has **Search matches it** off.
- **A patient has no identifiers after an upgrade.** Run `openldr db reproject --force` once.
- **The sheet says the list is out of date.** Reload the page.

## Related guides

- [Facilities](/docs/facilities)
- [Test catalog](/docs/test-catalog)
- [Data exposure](/docs/data-exposure)
