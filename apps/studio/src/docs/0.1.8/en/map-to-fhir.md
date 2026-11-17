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

**Listen** stops at the first new run that gives rows for this node, or after a minute. To send a message, post it to the workflow's webhook address, as the Workflows guide shows. To send a file, use a workflow that starts with a **Webhook** and **Extract from File**, with Extract from File's format set to `csv` and **Read every cell as text** on. Post the file to its webhook with the header `Content-Type: application/octet-stream`. On a webhook workflow, a run started in the editor has no body, so it gives no rows.

The panel keeps the first 20 rows of the sample. It lists every column found in the sample's rows, also a column that is filled only after the 20th row. Such a column shows no example.

With no sample, the panel shows the node's saved mapping, the widest one when there are several. A **Saved mapping** select picks another. No example shows, and no column is marked as missing, since there is no sample to miss it from. You can change the mapping and save it. **Test** needs a sample.

## Pick a column for each field

Each row reads from your source field and example to its destination under **Maps to**. The destination shows a lab label and its FHIR path. You can map by the lab label without typing a FHIR path.

Each line of the panel is one field of the target. A star marks a required field. **Lab result** needs three: **Patient ID**, **Collected date** and **Test**.

1. On a field's line, open the select under **From your data** and choose the column that fills it.
2. Choose **Fixed value** instead when every row has the same value, then type it.
3. Leave **Not mapped** on a field your file does not have.
4. For a field that repeats, select **Add another column**, then tick each column to add. Type in **Filter columns** to narrow a long list. **Select all shown** ticks every column the list shows.
5. When a grey **Suggested** line shows a column, select **Accept** to use it.

**Expected result:** the panel counts the required fields you mapped, and shows an example from the sample beside each column you picked.

A suggestion shows only on a field with no column. The field stays without one until you select **Accept**. A nested column such as `patient.dob` is also read by its last part, `dob`. When two columns fit a field equally well, a column under the field's own record, such as `patient.dob` for a patient field, wins over one under another, such as `mother.dob`. A tie the names cannot settle gives no suggestion, and the order of the columns never decides. A column named like a full name, such as `name`, is never suggested for **First name** or **Last name**.

## Map a file with one column per test

A lab sheet or a WHONET export often has one column per test, for example `AMP`, `CIP` and `GEN`. Each cell holds that test's result.

1. On **Result (text)**, or on the result field your values fit, pick the first test column under **From your data**.
2. Select **Add another column** and tick the other test columns.
3. Check the test beside each column. It starts as the column's name. Type another test when the name is not the code you want.
4. Leave **Test** as it is. It reads **Set for each column on Result (text)**, with the real field's name.
5. To turn the tests into standard codes, add a **Code list** rule on **Test**. It runs on each column's test.

**Expected result:** each column shows on its own line, with its test beside it. A row then gives one result for each test column with a value, all linked to the row's patient, specimen and order. A blank cell gives no result.

A rule on the result field runs on every column. The panel refuses to save while a test is empty, or while two columns have the same test. Only one result field carries the tests. Another result field with several columns takes the tests of the same lines, so it needs the same number of columns. When you remove columns back to one, **Test** gets its own column select again.

Map **Patient ID system** the same way in every file, for example as a **Fixed value** with the same text each time. When you leave it out, the Patient record's id comes from the Patient ID alone, and duplicate-patient detection cannot compare these patients by Patient ID.

## Add a rule to a field

Use a rule when the cell does not hold the value as FHIR needs it.

1. On the field's line, open the select under **Rule**.
2. Choose the kind of rule.
3. Fill in the settings that show under the line.
4. When a grey **Suggested rule** line shows, select **Accept** to use it.

**Expected result:** the rule's settings show under the field's line.

The kinds of rule are these.

- **Date** reads a date in the **Format** you type, for example `dd/MM/yyyy`. For a date column of an Excel file, set **Date is** to **Excel date cell**. Excel keeps a date as a day number, and this reads it.
- **Values** translates each value in your file to a code, one line per value.
- **Code list** looks the value up in a code list. **This lab's own code list** holds the mappings added on a term's **Mappings** tab in Terminology. It holds codes from several systems, so pick its **Source system** too. The panel refuses to save without one. The other code lists are the ConceptMap resources stored in OpenLDR.
- **Split** keeps one part of the cell.
- **Trim spaces** removes spaces at both ends.
- **Number** reads a number with the **Decimal mark** you choose. On **Result (number)**, a leading `<`, `<=`, `>=` or `>` is kept as the comparator, so `>100000` is stored as more than 100000. `≤` and `≥` mean the same as `<=` and `>=`, and are stored as `<=` and `>=`. This works with or without the rule. When you pick **Number**, **Decimal mark** starts as the one the sample shows: a comma when the examples have decimal commas and no decimal points, and a point otherwise. Change it if it is wrong.
- **Number or text**, on **Result (number)** only, stores a value that reads as a number as a number, with its comparator, and stores anything else as text, exactly as sent, in **Result (text)**. Use it when a column mixes numbers and titres such as `1:320`. Nothing is held for a value that is not a number. A unit is stored only with a number. A whole number too long to keep exactly is stored as text with every digit. Do not also map **Result (text)**: the row is held, because both would fill the one text result. It reads values from your data only. On a fixed value the row is held: map a fixed number to **Result (number)** and a fixed text to **Result (text)**.

The panel suggests a rule from the form of the example values, such as a decimal comma or a date format. Check a date suggestion when the day and the month can both be 12 or less.

When a coded field's values are not its codes, the panel suggests **Values**. **Accept** opens the rule with one line per distinct value of the sample, at most 20. When a value is a code, or a code's name, ignoring case, that code is already picked on the **To** side. Fill in what the other values mean. A line is saved only once its **To** side is filled. A field with FHIR's own list, such as **Sex**, picks from that list. When every example of a date column is a day number, the panel suggests the Excel date cell.

A plain text in a coded field, such as **Test**, is stored as the lab's own code, with no system. A **Code list** rule stores a standard code instead. A code picked on the **To** side of a **Values** rule is stored with its system.

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
4. A row that ends in **passes** gives records that pass OpenLDR's checks. For any other row, read the reason. It names the field when it can. When a value is not one a coded field accepts, and the field has no **Values** or **Code list** rule, the line says to add a Values rule.
5. Fix that field's column or rule, then select **Test** again.

**Expected result:** every row of the sample passes, or you know why a row does not.

Test sends the sample rows, at most 20. The reasons are in English. Test checks each row alone. Two rows that give the same result with other values both pass in Test, while a run holds the second.

## Inspect the generated records

1. Open **Mapping actions** and select **Test**.
2. Find a row that passes in the results at the bottom.
3. Open that row's **Row actions** dots menu.
4. Select **View generated FHIR**.
5. Check the values and references in **Generated FHIR**.
6. Open **Generated record actions** and select **Copy JSON**.

**Expected result:** the sheet shows only that sample row's generated records. Test does not store these records.

Changing a source, rule, destination or sample clears the previous test results. Select **Test** again to inspect the new mapping.

## Save the mapping

1. Open the dots menu labelled **Mapping actions**.
2. Select **Save**.
3. Close the panel.
4. Select **Save** in the workflow toolbar.
5. For **Ingest**, check the warning and select **Save anyway**.

**Expected result:** **Saved mappings** in the node settings counts the new mapping.

The panel refuses to save while a required field has no column or fixed value, while a rule is not finished, or while a column's test is empty or repeated. Saving replaces a saved mapping of the same node whose columns are all in the new one. When that mapping has fewer columns than the new one, the panel says so before you save.

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
- A unit is stored only with a number. When a row has a unit but no number, for example a text result, the result is stored without the unit, and the run notes it.
- A whole number sent without quotes that is too long to keep exactly, above 9,007,199,254,740,991, such as a 19-digit specimen number, keeps every digit. The webhook reads it as text, and the trigger's output in **History** names the field under `notes`. Map it to a text field such as **Specimen number**. **Result (number)** refuses it and holds the row, because a number cannot hold that many digits exactly. Ask the lab to send such IDs in quotes.
- A column that mixes numbers and text, such as `12,5` beside `1:320`, needs the **Number or text** rule on **Result (number)**. **Number** alone holds a row whose value is not a number. **Number or text** stores the number as a number and anything else as text, exactly as sent. A unit is stored only with a number.
- When a result field already has a column, the panel gives no suggestion for the record's other result field, because a result record holds one value.
- A held reason about one entry of a list column, such as `results.value`, says which entry, for example `(entry 2 of 4)`. It never shows the value.
- Two results in one row with the same test are held, because they would be one result record. The reason names the two list entries, such as `entries 1 and 3 of 4 in results.code`, or the two columns. When **Result date** is not mapped, it says to map it: two results of one test with different result dates are kept apart.
- A test with a blank result, empty, null or missing, gives no result record. The order still lists the test, and the run notes it. A zero is a result and is kept.
- A result record holds one value. A row that fills both **Result (number)** and **Result (text)** for one test is held with the reason that it holds more than one result value.
- A row of nested JSON is read flattened. `{ "patient": { "number": "P-1" } }` gives the column `patient.number`. A list of objects gives one list column per key: `results: [{ code, value }, …]` gives `results.code` and `results.value`, and mapping **Test** and **Result (number)** to them gives one result per entry. Only one list level is read. A list inside a list entry, such as a culture's antibiotic results under each isolate, is not stored. **Test** shows a note under the row, and the node's result in **History** lists it under `notes`. To keep that data, send it as FHIR. Two columns that end with the same name, such as a `patient.number` key beside a `patient` object, hold the row.
- The same row sent twice gives the same records, not copies. Each record id comes from the row's own identifiers. The patient's uses the Patient ID and its system. The specimen's adds the specimen number or, without one, the collected date. The order's adds its test code when mapped. The result's adds the test and, when mapped, the result date. When the order's **Tests** field is not mapped, the order takes the test codes of all its results in the run, each once, and its id does not change. A later run replaces them with that run's codes.
- In one run, rows that give the same patient, specimen or order make one record. A later row fills only what an earlier one left empty.
- A file with fewer columns sent after a fuller one replaces the stored patient. The fields the thinner file does not have become empty. **History** keeps the old version.
- A patient already stored under another id with the same Patient ID, for example from a form, gets a second Patient record. Nothing looks a patient up by Patient ID before saving.
- In one run, a second row that gives the same result with other values is held, with the reason `this row gives a result that an earlier row of this run already gave, with other values`.
- If one file maps **Patient ID system** and another does not, one patient gets two Patient records.
- Duplicate-patient detection compares Patient IDs only when **Patient ID system** is mapped. It compares names and dates of birth only when the patient has a family name, a given name and a date of birth. A patient with neither is stored, and never found as a duplicate.
- With nothing on **held**, one held row fails the node and the run. The steps after it do not run.
- Inside a loop, the loop passes on only what the last nodes of its body give. Connect **out** and **held** each to a node inside the loop body.
- OpenLDR never saves sample values in the workflow. The panel forgets the sample when you close it.
- The **Date** rule reads a date only. A cell with a time after the date does not match the format, and the row is held.
- Turn on **Read every cell as text** on **Extract from File** before a Map to FHIR node. Then each CSV cell arrives as the text in the file, so `12,5`, `007` and `03/11/2026` arrive as written. Use the **Number** and **Date** rules to read them. A node added from the Node library has it on. A node saved before this release has it off. With it off, `12,5` arrives as the number 125, `007` as 7, and a date such as `01/12/2024` as a day number, which the **Date** rule holds. The Map to FHIR settings warn when the node before it has the option off.
- In an Excel file, a date cell arrives as a day number. Use the **Date** rule with **Excel date cell**. It reads Excel's usual 1900 date system only. A workbook saved in the 1904 date system, from an old Mac, gives dates four years and a day early.
- **This lab's own code list** needs a **Source system**. Without one, no code matches. When a code gives two targets, the row is held with `more than one match in the code list`.
- This node does not read HL7 v2 messages.

## Troubleshooting

- **no mapping for this shape.** The row has a column that no saved mapping of the node knows. Get a sample with that row and save a mapping for it.
- **more than one saved mapping fits this row.** Two saved mappings know all of its columns. Keep one mapping per file, or use one node per file.
- **The run fails with "held port is not connected".** In **Ingest** this is how a message that cannot be stored is refused. The error lists the first reasons. Fix the data or the mapping and send it again. In your own workflow, connect **held** to a Log node to store the good rows and set the bad ones aside.
- **nothing at body.** The item has nothing under `body`, or only an empty list or a single value. After **Extract from File**, leave **Source path** blank. After a webhook, check that the sender posts a body.
- **not a row.** The list under the source path holds something that is not a row, such as a number or a text. Each item of the list must be an object with columns.
- **Listen finds nothing.** Save the workflow first. Then select **Listen** and send the message within a minute.

## Related guides

- [Workflows](/docs/workflows)
- [Forms](/docs/forms)
- [Terminology](/docs/terminology)
