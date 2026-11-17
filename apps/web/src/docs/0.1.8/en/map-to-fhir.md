# Map lab data to FHIR

<!-- operator-platform -->

Map to FHIR is a workflow node. It reads what a lab sends and gives FHIR records that OpenLDR stores. It knows three kinds of input:

- FHIR already, as a Bundle, a list of resources or one resource. The node passes it on as its resources.
- Answers to a form the node allows. The node checks them against the form and turns them into records.
- A lab's own rows, such as the lines of a CSV export or a JSON list. The node turns a row into records only when a person has saved a mapping for its columns in the node.

Every set of records goes through OpenLDR's checks at the configured validation level. Anything the node cannot map, or that fails a check, goes to its **held** output with a reason. Nothing from a held row is stored.

## When to use it

Use it when a lab system sends its own export and cannot send FHIR. A person maps the columns once, in the studio, on a real sample. After that, each new file with those columns maps without help.

On a new install, the shipped **Ingest** workflow already uses it. Its webhook, `/api/workflows/hooks/ingest`, sends every post to Map to FHIR. **out** goes to **Persist store**. Nothing is connected to **held**, on purpose. An install set up before this release keeps its older Ingest graph. **Reset to default** on the Ingest workflow gives the new one, and drops any change made to the old one.

The in-app guide **Map to FHIR** shows how to map a file, step by step.

Use one Map to FHIR node for each lab file. A row is mapped only when exactly one saved mapping of the node knows all its columns. When two saved mappings fit a row, the node holds it.

## Inspect a mapping before using it

The studio shows each source field and its example before the destination label and FHIR path. After **Test**, a passing row's dots menu offers **View generated FHIR**. It shows the records for that row as copyable JSON, including converted values and links between records. Test does not store these records. Editing the mapping or loading another sample clears the previous results.

## A file with one column per test

A lab sheet or a WHONET export often has one column per test, for example one column per antibiotic. To map it:

1. In the mapping panel, pick the first test column on the result field.
2. Select **Add another column** and tick the other test columns.
3. Check the test beside each column. It starts as the column's name.
4. To turn the tests into standard codes, add a **Code list** rule on **Test**.
5. Save the mapping, then the workflow.

Each row then gives one result for each test column with a value, linked to the row's patient, specimen and order. A blank cell gives no result. The mapping holds each column's test as config, never a value from a row.

## What a sender sees

The webhook answers for the whole run. The default **Ingest** workflow refuses a whole message when any part of it cannot be stored. With nothing connected to **held**, one held row fails the node and the run, and Persist store does not run. Nothing from that message is stored. The sender gets HTTP 500 with `ok: false`, the run id and the error `workflow execution failed; inspect the recorded run before resubmitting`. The held reasons are not in the response. They are in the run, on the Map to FHIR node, in **History**.

A run that completes answers HTTP 200 with `ok: true` and its `runId`.

Some labs want the good rows of a message stored and the bad ones set aside. For that, build your own workflow and connect **held** to a Log node or another node. A run of that workflow completes and answers `ok: true` even when rows were held. Check the node on **held** in **History** to find them.

## Try a saved mapping from the command line

`workflows map-test` runs a Map to FHIR node's saved mappings on a `.json` list or a `.csv` file. It stores nothing. Without `--json`, it prints counts and held reasons, never a row value. It reads the saved workflow, so save the workflow in the studio first. In the shipped Ingest workflow, the workflow id is `wf-ingest` and the node id is `map-1`.

```sh
{{operator:data-map-test}}
```

![Try the saved mappings of a Map to FHIR node on a file.](guide:operator-data-map-test)

The command exits with 0 when every row passes and 1 when any row is held. It checks each row alone, as **Test** in the studio does. Two rows that give the same result with other values both pass there, while a run holds the second. With `--json`, it prints each row's result, records included, so the output holds the row's values. A CSV run reads every cell as text, with the spaces around it cut, and leaves out blank cells. **Extract from File** with **Read every cell as text** on gives the same rows but keeps those spaces.

## Limits

- A row with no Patient ID is held.
- The same row sent twice gives the same records, not copies. Each record id comes from the row's own identifiers. The patient's uses the Patient ID and its system. The specimen's adds the specimen number or, without one, the collected date. The order's adds its test code when mapped. The result's adds the test and, when mapped, the result date. When the order's Tests field is not mapped, the order takes the test codes of all its results in the run, each once, and its id does not change. A later run replaces them with that run's codes.
- In one run, rows that give the same patient, specimen or order make one record, and a later row fills only what an earlier one left empty. A file with fewer columns sent in a later run replaces the stored record, and the fields it does not have become empty. History keeps the old version. A second row of one run that gives the same result with other values is held: `this row gives a result that an earlier row of this run already gave, with other values`.
- A patient already stored under another id with the same Patient ID, for example from a form, gets a second Patient record. Nothing looks a patient up by Patient ID before saving.
- If one file maps the Patient ID system and another does not, one patient gets two Patient records. Map it the same way in every file, for example as a fixed value. Without it, duplicate-patient detection cannot compare patients by Patient ID.
- Turn on **Read every cell as text** on **Extract from File** before a Map to FHIR node. Then each CSV cell arrives as the text in the file, and the **Number** and **Date** rules read it. A node added from the Node library has it on, and a node saved before this release has it off. With it off, `12,5` arrives as 125, `007` as 7, and a date such as `01/12/2024` as a day number, which the **Date** rule holds.
- In an Excel file, a date cell arrives as a day number. The **Date** rule reads it with **Excel date cell**, in Excel's usual 1900 date system only. A workbook saved in the 1904 date system, from an old Mac, gives dates four years and a day early.
- A plain text in a coded field is stored as the lab's own code, with no system. A **Code list** rule stores a standard code, and a code picked in a **Values** rule is stored with its system. The lab's own code list needs a source system on the rule; without one, no code matches.
- The **Date** rule reads a date only, not a time.
- The node does not read HL7 v2 messages.
- Held reasons are in English.

## Troubleshooting

These are the held reasons a person meets most often. A rule's reason starts with the column name, and a check's reason starts with the record it found at fault.

- **no mapping for this shape.** The row has a column that no saved mapping of the node knows. Map a sample that has this column.
- **more than one saved mapping fits this row.** Two saved mappings of the node know all its columns. Keep one mapping per file, or use one node per file.
- **Patient ID is required and has no value.** The row's Patient ID cell is empty. The label in the reason names the field.
- **expected a date in the format dd/MM/yyyy.** The cell does not match the **Date** rule's format. The reason gives the format you set.
- **value is not in the translation list.** A **Values** rule has no line for this value. Add one.
- **value has no match in the code list.** The **Code list** rule found no match for the value. With the lab's own code list, check that the rule names a source system.
- **more than one match in the code list.** The code gives two targets in the code list.
- **not a FHIR Bundle this node can unwrap.** The body looks like FHIR but cannot be unwrapped.
- **laboratory result must reference a ServiceRequest (basedOn).** A FHIR lab result came with no order. Send the order in the same post.
- **basedOn ServiceRequest not found in batch or store.** A FHIR lab result names an order that is neither in the same run nor stored.
- **nothing at body.** The item has nothing under `body`, or only an empty list or a single value. After Extract from File, leave the source path blank. After a webhook, check that the sender posts a body.
- **not a row.** The list under the source path holds something that is not a row, such as a number or a text.
- **held port is not connected.** This is a run failure, not a held reason. The error lists up to five reasons. In **Ingest** it is how a message that cannot be stored is refused. In your own workflow, connect **held** to a Log node to keep the good rows.
