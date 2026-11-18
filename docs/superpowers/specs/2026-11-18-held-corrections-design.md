# Correct a held request centrally, then check it again

Date: 2026-11-18. Approach chosen by the operator: B, "correct, then re-check".

## Why

The cdr-source check holds a request back when a rule finds an error, such as a date of birth after the
specimen date. Today the only way forward is to fix the record at the source and read it again. On the
2026-11-18 call the team said going back to the source can be hard, and asked whether the data can be kept
so central staff can fix it later. Who does the fixing is for each country to decide; the system only has
to make it possible and record who did it.

CE already keeps every held request: its source rows in `import_copy_rows` and its findings in
`import_check_held`. What is missing is a way to correct a field and send the request through the check
again.

## Goals

- A permitted person opens a held request, corrects one or more fields, gives a reason, and checks it
  again. If it now passes, it is saved like any other request and leaves the held list.
- The source rows are never changed. A correction is kept beside them, with the old value, the new value,
  who, when and why.
- The saved request says it was corrected, with the original values, so an analyst can tell.
- The same action exists in the CLI.

Non-goals: editing result values (the operator's rule is to keep stored results as stored); editing a
request that was saved, not held; bulk correction of many requests at once; correcting at the source.

Anti-goals: a correction that silently changes data with no trace; a correction that bypasses the rules
(the request is checked again, and stays held if it still fails).

## Approaches

- A. Let it through unchanged. Rejected by the operator: it saves the wrong value.
- **B. Correct, then check again (chosen).**
- C. Fix at the source only. Exists today; no help where the source cannot be reached.

## Design

### What can be corrected (my call)

The fields the holding rules read, by their names in the decoded request, which are the same for every
source the plugin reads (DISA and OpenLDR v1):

`dob_age` (date of birth), `sex`, `specimen`, `taken`, `collected`, `received_in_lab`, `registered`.

Correcting decoded fields, not the source bytes, keeps one form for every source system. More fields can be
added later without a CE change: the plugin declares the list.

### Where corrections live (my call)

A new CE table `import_check_corrections`, migration 124:
`copy_id`, `key`, `field`, `value` (the corrected value, text), `original` (the decoded value it replaces),
`reason`, `corrected_by`, `corrected_at`. One row per field; a second correction of the same field
replaces the first. Every save writes an audit row, `import.check.correct`.

### How a correction is applied (my call)

The plugin's decode input gains `corrections`: for each key, the fields and values to use. The plugin
replaces those fields in the decoded request, then runs the audit on the corrected request.

The check against OpenLDR v1 compares the uncorrected request. v1 was built from the same source, so a
corrected date would always differ from it and fail the check. The check answers "did we read the source
as v1 did"; the audit answers "is the data plausible". Only the audit sees the correction.

A saved corrected request carries two more request attributes before the `v1-check` mark:
`v1-corrected` (the corrected field names, sorted, joined by commas) and `v1-corrections` (JSON: each
field with its original value, new value, reason, who and when).

### Checking again (my call)

"Check again" runs only the corrected request's key through the plugin, with its corrections. If it passes,
CE saves its resources as a normal check run would and removes it from the held list. If it still fails,
it stays held with its new findings, and the corrections stay for the next try.

### Who may correct (my call)

A new capability `imports.correct_held`, "Correct held requests". No preset role gets it; an admin grants it.

### The screen

In the plugin's Held tab, the detail sheet of a held request gets a ⋯ menu at the top right with
**Correct fields**. It shows the correctable fields, label left and input right: the value as read on a
line under the label, the new value in the input. A reason field is required. The sheet's ⋯ menu then
offers **Save and check again**. The result shows in the sheet: saved, or still held with the new
findings.

### CLI

`openldr import-check correct <copyId> <key> --set field=value ... --reason "..."` saves corrections, and
`openldr import-check recheck <copyId> <key>` checks it again. Both act as `cli` in the audit log and print
the outcome.

## Constraints

- AGENTS.md section 4: build only this. Section 5: sheet, ⋯ menu, label-left form. Section 6: CLI, docs in
  en, fr, pt, mobile, changelog.
- The plugin is published code. It ships as a new version, signed on the laptop, only on the operator's
  yes. CE must keep working with the published 0.1.1 and 0.1.2, which do not know `corrections`: CE asks
  the plugin's version and shows **Correct fields** only when it supports it.
- Migration 124: check no other branch claims it before merging.

## Left to the builder

Exact wording in three languages, the form's input types (a date input for dates), field validation
messages, test fixtures.
