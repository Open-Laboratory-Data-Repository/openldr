# Map to FHIR

Map to FHIR is a workflow node that turns a lab's own rows into FHIR records OpenLDR can store. It also passes FHIR on, turns answers to an allowed form into records, and holds anything it cannot map with a reason. Lab managers set it up once for each lab file.

## Add Map to FHIR to a workflow

Put the node after the step that gives the rows, such as a **Webhook** trigger or **Extract from File**.

1. Open the workflow.
2. In the Node library, search for `Map to FHIR`.
3. Drag **Map to FHIR** beside the step that gives the rows.
4. Drag the dot on the right of that step to the dot on the left of **Map to FHIR**.
5. Select **Map to FHIR**, then the gear labelled **Configure** above it.
6. Set **Source path**. After a webhook, type `body`. After **Extract from File**, leave it blank.
7. Choose **Target**. **Lab result** is the target OpenLDR ships.
8. Under **Allowed forms**, add a form only if senders post answers to that form.

**Expected result:** the node shows two outputs, **out** and **held**.

## Get a sample

The panel maps the columns of a real sample. Get one before you pick columns.

1. Save the workflow.
2. In the node settings, open the dots menu labelled **Node actions** and select **Open mapping**.
3. Open the dots menu labelled **Mapping actions** at the top right of the panel.
4. Select **Listen**.
5. Send one message to the workflow from the lab system within a minute.

**Expected result:** the line under **Target** counts the sample rows.

To use a run that already came in, select **Use the latest stored run** instead of steps 4 and 5. When the editor holds a run of its own, the panel loads it as the sample when it opens. **Use this editor's last run** loads it again.

**Listen** stops at the first new run that gives rows for this node, or after a minute. To send a message, post it to the workflow's webhook address, as the Workflows guide shows. To send a file, use a workflow that starts with a **Webhook** and **Extract from File**, with Extract from File's format set to `csv`. Post the file to its webhook with the header `Content-Type: application/octet-stream`. On a webhook workflow, a run started in the editor has no body, so it gives no rows.

The panel keeps the first 20 rows of the sample. When those rows have different columns, the **Sample shape** select lists each group of rows with its count of fields and rows. Pick the group to map.

## Pick a column for each field

Each line of the panel is one field of the target. A star marks a required field. **Lab result** needs three: **Patient ID**, **Collected date** and **Test**.

1. On a field's line, open the select under **From your data** and choose the column that fills it.
2. Choose **Fixed value** instead when every row has the same value, then type it.
3. Leave **Not mapped** on a field your file does not have.
4. For a field that repeats, select **Add another column** to add a second column.
5. When a grey **Suggested** line shows a column, select **Accept** to use it.

**Expected result:** the panel counts the required fields you mapped, and shows an example from the sample beside each column you picked.

A suggestion shows only on a field with no column. The field stays without one until you select **Accept**.

Map **Patient ID system** the same way in every file, for example as a **Fixed value** with the same text each time. When you leave it out, the Patient record's id comes from the Patient ID alone, and duplicate-patient detection cannot compare these patients by Patient ID.

## Add a rule to a field

Use a rule when the cell does not hold the value as FHIR needs it.

1. On the field's line, open the select under **Rule**.
2. Choose the kind of rule.
3. Fill in the settings that show under the line.
4. When a grey **Suggested rule** line shows, select **Accept** to use it.

**Expected result:** the rule's settings show under the field's line.

The kinds of rule are these.

- **Date** reads a date in the **Format** you type, for example `dd/MM/yyyy`.
- **Values** translates each value in your file to a code, one line per value.
- **Code list** looks the value up in a code list. **This lab's own code list** holds the mappings added on a term's **Mappings** tab in Terminology. The other code lists are the ConceptMap resources stored in OpenLDR.
- **Split** keeps one part of the cell.
- **Trim spaces** removes spaces at both ends.
- **Number** reads a number with the **Decimal mark** you choose.

The panel suggests a rule from the form of the example values, such as a decimal comma or a date format. Check a date suggestion when the day and the month can both be 12 or less.

## Add a field the target does not show

1. Open the dots menu labelled **Mapping actions**.
2. Select **Add a FHIR path**.
3. Choose the **Record**, such as Patient or Observation.
4. Choose the **FHIR path**.
5. Pick the column for the new line.

**Expected result:** a new line with the FHIR path as its name appears in the panel.

## Test the mapping

1. Open the dots menu labelled **Mapping actions**.
2. Select **Test**.
3. Read the results in the block at the bottom of the panel, one line for each row, **Row 1**, **Row 2** and so on.
4. A row that ends in **passes** gives records that pass OpenLDR's checks. For any other row, read the reason. It names the field when it can.
5. Fix that field's column or rule, then select **Test** again.

**Expected result:** every row of the sample passes, or you know why a row does not.

Test sends the sample rows of the group on screen, at most 20. The reasons are in English.

## Save the mapping

1. Open the dots menu labelled **Mapping actions**.
2. Select **Save**.
3. Close the panel.
4. Select **Save** in the workflow toolbar.
5. For **Ingest**, check the warning and select **Save anyway**.

**Expected result:** **Saved mappings** in the node settings counts the new mapping.

The panel refuses to save while a required field has no column or fixed value, or while a rule is not finished. Saving replaces a saved mapping of the same node whose columns are all in the new one. The panel says so before you save.

## Wire the held output

The shipped **Ingest** workflow uses Map to FHIR on a new install, with **out** going to **Persist store** and nothing on **held**, on purpose. So Ingest refuses a whole message when any part of it cannot be stored. The run fails, the sender gets an error, and nothing from that message is stored. An install set up before this release keeps its old Ingest graph. **Reset to default** gives the new one, and drops any change you made to the old one.

Wire **held** in your own workflow when good rows should be stored and bad rows set aside. Leave it unconnected in **Ingest**.

1. Search the Node library for `Log`.
2. Drag **Log** beside **Map to FHIR**.
3. Drag the **held** dot of **Map to FHIR** to the dot on the left of the Log node.
4. In the Log node's settings, set **Message** to `Held: {{ $json.reason }}`.
5. Save the workflow.

**Expected result:** in **History**, the Log node shows the reason of the first held row of the run.

The Map to FHIR node's result in **History** lists up to 20 held reasons. Log the reason only, because a held item also holds the row as it came in.

## Limits

- A row matches a saved mapping when every column of the row is one the mapping knows. **Extract from File** leaves out blank cells, so a blank cell there does not count. In a JSON post, a key counts even when its value is empty. When two saved mappings of one node fit a row, the node holds it. Use one Map to FHIR node for each lab file.
- A row with no Patient ID is held.
- The same row sent twice gives the same records, not copies. Each record id comes from the row's own identifiers. The patient's uses the Patient ID and its system. The specimen's adds the specimen number or, without one, the collected date. The order's adds its test code when mapped, and the result's adds the test.
- If one file maps **Patient ID system** and another does not, one patient gets two Patient records.
- Duplicate-patient detection compares Patient IDs only when **Patient ID system** is mapped. It compares names and dates of birth only when the patient has a family name, a given name and a date of birth. A patient with neither is stored, and never found as a duplicate.
- With nothing on **held**, one held row fails the node and the run. The steps after it do not run.
- Inside a loop, the loop passes on only what the last nodes of its body give. Connect **out** and **held** each to a node inside the loop body.
- OpenLDR never saves sample values in the workflow. The panel forgets the sample when you close it.
- The **Date** rule reads a date only. A cell with a time after the date does not match the format, and the row is held.
- **Extract from File** reads a CSV cell such as `12,5` as the number 125. The **Number** rule then keeps 125. Post such data as JSON to a webhook instead. There `"12,5"` stays text, and the **Number** rule with a comma reads 12.5.
- **Extract from File** also reads some CSV dates as numbers, for example `01/12/2024` and `2025-04-23`. The **Date** rule then holds the row.
- This node does not read HL7 v2 messages.

## Troubleshooting

- **no mapping for this shape.** The row has a column that no saved mapping of the node knows. Get a sample with that row and save a mapping for it.
- **more than one saved mapping fits this row.** Two saved mappings know all of its columns. Keep one mapping per file, or use one node per file.
- **The run fails with "held port is not connected".** In **Ingest** this is how a message that cannot be stored is refused. The error lists the first reasons. Fix the data or the mapping and send it again. In your own workflow, connect **held** to a Log node to store the good rows and set the bad ones aside.
- **nothing at body.** The item has nothing under `body`. After **Extract from File**, leave **Source path** blank. After a webhook, check that the sender posts a body.
- **not a row.** The list under the source path holds something that is not a row, such as a number or a text. Each item of the list must be an object with columns.
- **Listen finds nothing.** Save the workflow first. Then select **Listen** and send the message within a minute.

## Related guides

- [Workflows](/docs/workflows)
- [Forms](/docs/forms)
- [Terminology](/docs/terminology)
