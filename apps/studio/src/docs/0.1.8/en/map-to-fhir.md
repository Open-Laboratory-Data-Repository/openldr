# Map to FHIR

Map to FHIR is a workflow node. It turns a lab's own rows into FHIR records that OpenLDR can store. It also passes FHIR on as it is, and turns answers to an allowed form into records. Anything it cannot map goes to its **held** output with a reason. Lab managers set it up once for each lab file.

The shipped **Ingest** workflow uses it on a new install. Its webhook sends to **Map to FHIR**, and **out** goes to **Persist store**. **held** goes to a Log node named **Held: not mapped**. An install set up before this release keeps its old Ingest graph. **Reset to default** gives the new one, and drops any change you made to the old one.

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

The sheet maps the columns of a real sample. Get one before you pick columns.

1. Save the workflow.
2. In the node settings, open the dots menu labelled **Node actions** and select **Open mapping**.
3. Open the dots menu labelled **Mapping actions** at the top right of the sheet.
4. Select **Listen**, then send one message or file to the workflow from the lab system.
5. Or select **Use the latest stored run** to read a run that already came in.

**Expected result:** the line under **Target** counts the sample rows.

**Listen** stops at the first new run that gives rows for this node, or after a minute. **Use this editor's last run** reads the last run you started in the editor. On a webhook workflow, a run started in the editor has no body, so use **Listen** or **Use the latest stored run** there.

## Pick a column for each field

Each line of the sheet is one field of the target. A star marks a required field. **Lab result** needs three: **Patient ID**, **Collected date** and **Test**.

1. On a field's line, open the select under **From your data** and choose the column that fills it.
2. Choose **Fixed value** instead when every row has the same value, then type it.
3. Leave **Not mapped** on a field your file does not have.
4. For a field that repeats, select **Add another column** to add a second column.
5. When a grey **Suggested** line shows a column, select **Accept** to use it.

**Expected result:** the sheet counts the required fields you mapped, and shows an example from the sample beside each column you picked.

A suggestion counts only after you select **Accept**. Until then the field keeps the column you chose, or none.

## Add a rule to a field

Use a rule when the cell does not hold the value as FHIR needs it.

1. On the field's line, open the select under **Rule**.
2. Choose **Date** and type the **Format**, for example `dd/MM/yyyy`.
3. Or choose **Values** to translate each value in your file to a code, one line per value.
4. Or choose **Code list** to look the value up in a code list from Terminology.
5. Or choose **Split** to keep one part of the cell, **Trim spaces**, or **Number** with its **Decimal mark**.
6. When a grey **Suggested rule** line shows, select **Accept** to use it.

**Expected result:** the rule's settings show under the field's line.

The sheet suggests a rule from the form of the example values, such as a decimal comma or a date format. Check a date suggestion when the day and the month can both be 12 or less.

## Add a field the target does not show

1. Open the dots menu labelled **Mapping actions**.
2. Select **Add a FHIR path**.
3. Choose the **Record**, such as Patient or Observation.
4. Choose the **FHIR path**.
5. Pick the column for the new line.

**Expected result:** a new line with the FHIR path as its name appears on the sheet.

## Test the mapping

1. Open the dots menu labelled **Mapping actions**.
2. Select **Test**.
3. Read the result under each row. **passes** means the row gives records that pass OpenLDR's checks.
4. For a row that does not pass, read the reason. It names the field when it can.
5. Fix that field's column or rule, then select **Test** again.

**Expected result:** every row of the sample passes, or you know why a row does not.

Test sends at most 20 rows of the sample. The reasons are in English.

## Save the mapping

1. Open the dots menu labelled **Mapping actions**.
2. Select **Save**.
3. Close the sheet.
4. Select **Save** in the workflow toolbar.
5. For **Ingest**, check the warning and select **Save anyway**.

**Expected result:** **Saved mappings** in the node settings counts the new mapping.

The sheet refuses to save while a required field has no column or fixed value, or while a rule is not finished. A mapping that covers more columns replaces a saved mapping of the same node that covers fewer. The sheet says so before you save.

## Wire the held output

1. Search the Node library for `Log`.
2. Drag **Log** beside **Map to FHIR**.
3. Drag the **held** dot of **Map to FHIR** to the dot on the left of the Log node.
4. In the Log node's settings, set **Message** to `Held: {{ $json.reason }}`.
5. Save the workflow.

**Expected result:** a held row shows its reason in that Log node in **History**.

Log the reason only. A held item also holds the row as it came in.

## Limits

- A row matches a saved mapping when every column of the row is one the mapping knows. Blank cells do not count. When two saved mappings of one node fit a row, the node holds it. Use one Map to FHIR node for each lab file.
- A row with no Patient ID is held.
- The same row sent twice gives the same records, not copies. The record ids come from the Patient ID, the specimen number or, without one, the collected date, and the test.
- If one file maps **Patient ID system** and another does not, one patient gets two Patient records.
- A patient with no name or no date of birth is stored. Duplicate-patient detection then finds them only by a shared identifier, not by name and date of birth.
- With nothing on **held**, one held row fails the node and the run. The steps after it do not run.
- Inside a loop, the loop passes on only what the last nodes of its body give. Connect **out** and **held** each to a node inside the loop body.
- The sheet keeps the sample only while it is open. OpenLDR never saves sample values in the workflow. Get a sample again each time you open the sheet.
- The **Date** rule reads a date only. A cell with a time after the date does not match the format, and the row is held.
- **Extract from File** reads a CSV cell such as `12,5` as the number 125. The **Number** rule then keeps 125. Post such data as JSON to a webhook instead. There `"12,5"` stays text, and the **Number** rule with a comma reads 12.5.
- **Extract from File** also reads some CSV dates, such as `01/12/2024`, as numbers. The **Date** rule then holds the row.
- This node does not read HL7 v2 messages.

## Troubleshooting

- **no mapping for this shape.** The row has a column that no saved mapping of the node knows. Get a sample with that row and save a mapping for it.
- **more than one saved mapping fits this row.** Two saved mappings know all of its columns. Keep one mapping per file, or use one node per file.
- **The run fails with "held port is not connected".** Connect **held** to a Log node.
- **nothing at body.** The source path does not point at the rows. After a webhook, set **Source path** to `body`.
- **Listen finds nothing.** Save the workflow first. Then select **Listen** and send the message within a minute.

## Related guides

- [Workflows](/docs/workflows)
- [Forms](/docs/forms)
- [Terminology](/docs/terminology)
