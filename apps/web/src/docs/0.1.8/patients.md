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

## After upgrading

Patients received before this release have no identifiers listed until you run `openldr db reproject --force` once.

## From the command line

- `openldr patients list [--search <text>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <system> [--label <text>] [--list-column on|off] [--searchable on|off]`

Output is masked unless you pass `--identifiers`, which is audited.
