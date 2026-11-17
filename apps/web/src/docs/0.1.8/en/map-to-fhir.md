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

The command exits with 0 when every row passes and 1 when any row is held. With `--json`, it prints each row's result, records included, so the output holds the row's values. A CSV run reads every cell as text and leaves out blank cells. So it can differ from the same file read by **Extract from File**.

## Limits

- A row with no Patient ID is held.
- The same row sent twice gives the same records, not copies. Each record id comes from the row's own identifiers. The patient's uses the Patient ID and its system. The specimen's adds the specimen number or, without one, the collected date. The order's adds its test code when mapped, and the result's adds the test.
- If one file maps the Patient ID system and another does not, one patient gets two Patient records. Map it the same way in every file, for example as a fixed value. Without it, duplicate-patient detection cannot compare patients by Patient ID.
- **Extract from File** reads a CSV cell such as `12,5` as the number 125, and the **Number** rule keeps 125. It also reads some CSV dates, such as `01/12/2024` and `2025-04-23`, as numbers, and the **Date** rule then holds the row. Post such data to a webhook as JSON instead. There `"12,5"` stays text.
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
- **value has no match in the code list.** The **Code list** rule found no single match for the value.
- **not a FHIR Bundle this node can unwrap.** The body looks like FHIR but cannot be unwrapped.
- **laboratory result must reference a ServiceRequest (basedOn).** A FHIR lab result came with no order. Send the order in the same post.
- **basedOn ServiceRequest not found in batch or store.** A FHIR lab result names an order that is neither in the same run nor stored.
- **nothing at body.** The item has nothing under `body`. After Extract from File, leave the source path blank. After a webhook, check that the sender posts a body.
- **not a row.** The list under the source path holds something that is not a row, such as a number or a text.
- **held port is not connected.** This is a run failure, not a held reason. The error lists up to five reasons. In **Ingest** it is how a message that cannot be stored is refused. In your own workflow, connect **held** to a Log node to keep the good rows.
