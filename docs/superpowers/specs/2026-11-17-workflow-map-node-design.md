# A Map node for workflows: data that is not FHIR becomes FHIR

Date: 2026-11-17. Size: a project. Status: for the operator's approval.

## 1. Intent

A lab's data often is not FHIR. It is a CSV, a sheet, or JSON from the lab's own API. CDC asked
what such a lab does. Today the answer is "write a plugin", which needs a developer. The three
old plugins (whonet-sqlite, hl7v2, tabular) were early samples of that answer.

The operator wants a workflow node instead. In the operator's words there are known knowns and
unknown unknowns:

- **Plain FHIR.** Nothing to map.
- **A known form's answers.** `firstname` is a field of a form, and the form already says what it
  maps to. Nothing to map.
- **Unknown data.** `name`, `pat_no`, `res`. A person sees the real data arrive, maps it, tests
  it, and saves it, the way n8n works. After that it is known.

## 2. Goals, non-goals, anti-goals

Goals:

- One node, **Map to FHIR**, that takes any of the three kinds and gives FHIR records.
- A person with no FHIR knowledge can map unknown data, using plain field labels.
- A person who knows FHIR can pick any FHIR path.
- Mapping happens on a real sample, with a test that shows the records and CE's own check result.
- A saved mapping is reused for every later message of the same shape.
- A message that cannot be mapped leaves by its own port with the reason. Nothing is dropped.

Non-goals:

- Reading file formats. `extract-from-file` (CSV, JSON, Excel) and the XML node already do that.
- HL7 v2 parsing. It is not rows. It stays a plugin node or becomes a later parse node.
- Changing what a form extracts.
- Republishing the three old plugins. This node replaces their purpose.

Anti-goals, which would make this a failure even if it works:

- A real patient value saved in a workflow definition, an export, an audit row or a log.
- A lab result stored with no order, or a record CE's checks would refuse, passed on silently.
- Clinical vocabulary written into source code. Sex codes, test codes and the like come from the
  terminology service or from what the person typed (AGENTS.md section 8).
- A node that guesses a mapping and uses it without a person confirming it.

## 3. What is true today

- The default Ingest workflow forks on one test, "is the body a bundle or a list"
  (`packages/workflows/src/sample-workflow.ts:50`). FHIR goes to Unwrap FHIR Bundle. Everything
  else is assumed to be answers for one fixed form and goes to Validate form answers.
- Validate form answers runs two extractors only, `ObservationExtractor` and
  `ServiceRequestExtractor` (`packages/bootstrap/src/form-validate-service.ts:43`,
  `packages/forms/src/extract/extract.ts:140` and `:221`). **A form cannot produce a Patient or a
  Specimen.** So a form alone cannot be the target for a lab's results file.
- CE holds the whole R4 path table with a picker: `fhirPathOptionsFor(resourceType)`
  (`packages/fhir/src/paths/index.ts:105`), and a helper that writes a value at a path, `setPath`
  (`packages/forms/src/extract/set-path.ts`).
- CE's check "a lab result must link to an order" (`packages/fhir/src/rules/result-requires-request.ts:31`)
  applies from the medium level up. It refused the published whonet-sqlite 1.2.0.
- The editor already keeps each node's input and output of the last run
  (`apps/studio/src/workflows/hooks/use-workflow-store.ts:213`). Stored runs are readable at
  `GET /api/workflows/:id/runs` and `/runs/:runId` (`apps/server/src/workflows-routes.ts:345`).
- A node can have two output ports. `if` has `true` and `false` (`packages/workflows/src/host-nodes.ts:40`).
- CE has a name-similarity ranker for suggestions (`packages/bootstrap/src/facility-mapping-suggest.ts:104`).

## 4. Approaches

| Way | For | Against | Verdict |
|---|---|---|---|
| Map onto a form's fields only | No FHIR knowledge needed, one mapping system | A form gives no Patient or Specimen | Not enough alone |
| Map onto raw FHIR paths only | Covers everything | Needs FHIR knowledge, the thing CDC asked about | Not enough alone |
| Map onto a **target**: a named set of fields, each with a label and a FHIR path. Raw paths can be added | Plain labels for most people, full reach for the rest, one engine | A target has to be authored once | Chosen |

The operator chose "one Map node" and then "plus raw FHIR paths" on 2026-11-17.

## 5. The design

### 5.1 The node

- Host node `map-to-fhir`, label "Map to FHIR", kind transform.
- One input. Two outputs: `out` (FHIR records, one per item) and `held` (the input item plus a
  `reason`, for anything not mapped or refused by the check).
- It handles each incoming item in this order:
  1. **FHIR.** The item is a resource, a bundle or a list of resources. It is unwrapped and passed on.
  2. **A known form.** The item's keys are all fields of one form in the node's allowed forms,
     and cover that form's required fields. It is handed to the existing form-validate service.
  3. **A saved mapping.** The item's shape (section 5.4) matches a mapping saved in the node.
  4. **Otherwise** it goes to `held` with the reason "no mapping for this shape", and the shape.

### 5.2 A target

A target is content, not code. It is a named list of fields. Each field has:

- a label in en, fr and pt;
- a FHIR path, such as `Patient.birthDate` or `Observation.valueQuantity.value`;
- whether it is required;
- whether it repeats (one result per antibiotic, per test);
- an optional value set from the terminology service.

A target also names its records and how they link. The first shipped target is **Lab result**:
Patient, Specimen, ServiceRequest, Observation. The node writes the links itself: each result
points at its patient, specimen and order. So a mapped message always passes the order rule.

Targets ship as content in the same way value sets and report templates do, and a lab can add
one. In the mapping sheet a person can also add a row for any raw FHIR path from the path table.

### 5.3 The mapping sheet

It is a Sheet, opened from the node, with actions in a dots menu.

```
Map to FHIR                                              ...
Target     [ Lab result                              v ]
Sample     3 messages held     ( Listen )  ( Use last run )

Target field           From your data           Example    Rule
Patient ID *           [ pat_no              v ] 88213
Family name            [ name                v ] BANDA      split: last word
Sex                    [ gender              v ] M          values: M=male, F=female
Date collected *       [ coll_dt             v ] 03/11/26   date: dd/MM/yy
Test *                 [ test_code           v ] HB         code list: Local tests
Result *               [ result_val          v ] 12.1
Unit                   ( fixed: g/dL )
+ Add a FHIR path

4 of 4 required fields mapped. Unused: ward, notes
Test   message 1 of 3:  Patient, Specimen, ServiceRequest, Observation   passes
```

- **Left:** target fields by label, required ones starred. Hovering shows the FHIR path.
- **Middle:** a dropdown of the fields found in the sample, or a fixed value.
- **Example:** the value from the sample message on screen. Shown only in the browser.
- **Rule:** one small transform per row: a date format, a value translation, a code list, a
  split, a trim, a number with a decimal comma. No free code.
- **Suggestions.** On opening, each target field shows the best-matching source field, by name
  similarity and by a synonym list that is content, in three languages. A suggestion is a grey
  proposal. It counts only once the person accepts it.
- **Test.** Runs the mapping on the held samples in the server and shows, per message, the
  records and the check result, or the reason for failing.
- **Repeats.** A source field holding a list, or several source columns chosen for one repeating
  target field, give one record each.

### 5.4 Shapes and what is saved

- A **shape** is the sorted list of an item's field names with their types, hashed. It holds no value.
- The node's config stores, per shape: the target, the field mappings, the rules, and the field
  names. It stores **no sample values**.
- Samples live in the editor's memory for the session only. "Listen" reads the newest stored runs
  of this workflow that started after the press. "Use last run" reads what the editor already holds.
- Value translations a person types (`M = male`) are config, so they are saved. A code list is a
  reference to the terminology service.

### 5.5 The Ingest workflow

The default Ingest workflow's fork becomes one Map to FHIR node feeding Persist store, with
`held` feeding a log. Existing workflows keep working: the three old nodes stay.

### 5.6 The five places (AGENTS.md section 6)

- **UI:** the sheet above, by the studio conventions.
- **CLI:** `openldr workflow map-test <workflow> <node> <file>` runs a node's saved mappings on a
  file and prints the records or the reasons, through the same shared code as the Test button.
- **Docs:** an in-app how-to and a web page, in en, fr and pt.
- **Mobile:** the sheet at 375 wide stacks each row.
- **Changelog:** generated after the merge.

## 6. Left to the builder

- The exact hash for a shape.
- How the sheet stacks on a phone.
- Where the target and synonym content files live, following how value sets ship.

## 7. Calls of mine

- The Rule column offers a fixed list of transforms, not expressions. Free code is the Code node.
- Sample values are never saved. The cost: after a reload the person presses Listen again.
- A form match needs every key to be a field of the form. One stray key sends it to mappings.
- The first target is Lab result only. Others wait until someone needs them.
- The old Ingest fork is replaced in the default workflow, not removed from the product.
- "Listen" reads stored runs. It does not open a live socket.

## 8. Checked after approval (2026-11-17)

- **A stored run keeps each node's output, not its input** (`NodeRunResult`,
  `packages/workflows/src/engine/run-workflow.ts:23`). "Listen" therefore reads the output of the
  node feeding the Map node. No new route is needed for that.
- **The path table has no "required" mark** (`FhirPathInfo`, `packages/fhir/src/paths/index.ts:15`).
  Stars come from the target. A raw path a person adds is never starred.
- **A target is built from starter packs.** CE already has them: labelled fields with a FHIR path,
  `required` and a bound value set, per record type (`packages/forms/src/starter-pack.ts`). Packs
  exist for Patient and ServiceRequest. Lab result needs two more, Specimen and Observation.
  This replaces "a target is new content" in 5.2 with "a target is a named list of starter packs
  and the links between their records".
- **The engine sends a node's whole output down one branch** (`run-workflow.ts:215`). The `held`
  port needs the runner to carry items per output port. That is a small engine change and the
  plan's first task.

- **Record ids come from the row's own identifiers** (the operator, 2026-11-17, during the build:
  "From the row's identifiers"). A random id per row would make a second Patient, Specimen and
  order each time a row is sent again.
  - Patient: the mapped patient identifier, its system when mapped plus its value.
  - Specimen: the mapped specimen number, scoped by the patient. With no specimen number, the
    patient plus the collected date.
  - ServiceRequest: the specimen plus the order's test code.
  - Observation: the order plus the result's own code, so two results of one order stay two.
  - The id is a hash of those parts, so no raw identifier value appears in an id.
  - The same row sent twice gives the same ids. Two rows with one patient ID give one Patient id.
  - A row with no patient identifier goes to `held`, with a reason naming the field. The Lab
    result target marks the patient identifier required.
  - A target declares each record's identity, as it declares its links. The mapping core knows no
    resource type.
- **The Lab result target has its own short required list** (the operator, 2026-11-17: "Short
  list"). Required: Patient ID, date collected, test. Everything else is optional, including first
  name, last name, date of birth, sex and priority. The starter packs keep their own required
  flags for forms. Only the target overrides them. With no test code on the order itself, the
  order's id comes from the specimen alone.
- **Mapped results carry the laboratory category** (the operator, 2026-11-17: "Mark as
  laboratory"). It is a default of the target, kept beside the status defaults, not a literal in
  handler code. So the rule "a lab result must link to an order" runs on every mapped result.
- **A saved mapping matches a row whose columns it knows** (found during the build, 2026-11-17).
  The Extract from File node drops blank cells, so the rows of one file have different field
  lists, and one column can be a number in one row and text in the next. Matching on the exact
  shape of 5.4 would hold every row with a blank cell. So a mapping matches a row when every field
  of the row is one of the mapping's field names. Types play no part. A row with a field the
  mapping never saw is still a new shape and goes to `held`. The shape hash stays as the name of
  the sample a mapping was made from.
- **Starter pack labels are English only.** The Lab result target takes its fr and pt labels from
  two content files keyed by target field.
- **A loop passes on what the last nodes of its body give** (`extractTerminalItems`,
  `run-workflow.ts:309`). A Map node with nothing after it in the body is a last node, and its
  output is its `out` items. Its `held` items go on only through a node connected to `held` inside
  the body. The in-app guide says to connect both.
- **A plain text in a coded field is the lab's own code** (ruling R35, fix wave). The writer gives
  `{ text, coding: [{ code }] }` with no system, so the warehouse finds the code. A code list
  rule gives a standard coding.
- **The sheet works on one set of columns per sample** (fix wave). It takes the columns of every
  row the feeding node gave, before the cut to 20 rows. There is no shape select.
- **Extract from File has `cellsAsText`** (fix wave, the operator's ruling). With it on, a CSV
  cell reaches the workflow as the text in the file. Saved nodes have it off and behave as before;
  a node dropped from the sidebar has it on. An Excel cell keeps its type.
- **A result id that two rows of one run give with other values is a clash** (fix wave). The
  later row is held. A result's identity also takes the result date, when mapped.
- **Rows of one run that give one patient, specimen or order make one record** (fix wave). The
  first non-empty value of each path wins, and the record goes out once, at the first row. Across
  runs, a thin row still replaces the stored record.

## 9. Still not checked

- How good name suggestions are on real lab files. No real file has been tried.
- Whether starter pack labels exist in fr and pt.
