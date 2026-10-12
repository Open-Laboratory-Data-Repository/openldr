# Patients

The Patient Index lists the patients CE has received with lab data. The source system, such as a HIMS, owns each patient. CE shows patients and never edits them.

Open **Patients** in the sidebar. You need the View patient index permission.

## What you see

Without the View patient identifiers permission, names and identifiers are masked. A name shows its first letter, such as `J*** M***`. An identifier shows its last four characters. You see the birth year, not the date of birth, and no phone or email. Search then matches an exact identifier only, because a partial name search would reveal names one letter at a time.

With View patient identifiers, you see everything, and search also matches part of a name. Every list and every patient you open is written to the audit log. The audit log records how many patients matched, never what you searched for.

## Finding a patient

Type an identifier, such as an MPI number or a national id, and CE finds the patient whichever identifier it is. Use **Filter** and **Status** to show merged records.

The **Identifiers** column shows the identifier systems chosen on the **Identifier systems** tab.

## A patient's sheet

Click a row, or choose **View** from its ⋯ menu. The sheet shows the patient's details, every identifier with its label, and their lab requests, newest first. If the record was merged into another, choose **Open the patient this record was merged into** from the ⋯ menu.

If the sheet says the list is out of date, the server has restarted. Reload the page.

## Identifier systems

Each identifier arrives with a system, a URI that says what kind of identifier it is. This tab lists every system CE has seen, with how many patients carry it.

With the Manage patient index permission, choose **Edit** from a row's ⋯ menu to give a system a label, such as NRC or ART number. Leave the label empty to use the name the source system sends. **Show in the list** adds it to the Identifiers column. **Search matches it** lets search find patients by it. Choose **Save** from the sheet's ⋯ menu.

A lab that receives these labels from central cannot change them.

## Duplicates

The **Duplicates** tab lists patients that look like the same person. CE finds two kinds:

- **Same identifier.** Two or more patients carry the same value in the same identifier system, such as the same NRC. Identifiers with no system, and systems where **Search matches it** is off, are not used.
- **Same name and date of birth.** Surname, first name and date of birth match, ignoring case, extra spaces and accents. Patients whose sexes differ are not matched. A patient with no date of birth is never matched this way.

Only active patients are compared. CE does not merge patients: fix duplicates in the source system, and the next update from it clears the group here.

Click a group to see its patients. Choose **Open patient** from a patient's ⋯ menu to see the full record.

A group can be large. The list shows at most 50 patients per group, and the sheet says how many it shows out of the total. A group with more patients than that cannot be marked as not duplicates here. Fix it in the source system, or turn off **Search matches it** for that identifier system. A placeholder identifier shared by many patients is the usual cause.

With the Manage patient index permission, choose **Mark as not duplicates** from the group's ⋯ menu when the patients are different people. You can add a reason. Use **Status** to see these groups again, and **Show again** to undo.

With the View patient identifiers permission, choose **Export CSV** from the tab's ⋯ menu to send the open groups to the source system's team. Each export is written to the audit log.

## After upgrading

Patients received before this release have no identifiers listed until you run `openldr db reproject --force` once. It also fills in what CE needs to find patients with the same name and date of birth.

## From the command line

- `openldr patients list [--search <text>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <system> [--label <text>] [--list-column on|off] [--searchable on|off]`
- `openldr patients duplicates list [--status open|dismissed|all] [--identifiers]`
- `openldr patients duplicates dismiss <idA> <idB> [--reason <text>]` and `restore <idA> <idB>`
- `openldr patients duplicates export [--out <file>]`

Output is masked unless you pass `--identifiers`. `patients list` and `patients show` with `--identifiers` are audited. `duplicates export` is always unmasked and audited. `duplicates dismiss` and `restore` are audited.
