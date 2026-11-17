# Map to FHIR reads nested JSON

## Why

Codex sent a lab's own JSON with `patient.number`, specimen fields and a `results` list. The
Map to FHIR sheet offered only `patient`, `specimen` and `results`, so nothing could be mapped and
the row was held. A lab that cannot send FHIR, and sends its own nested JSON, is stuck today.
The node reads top-level columns only (`packages/forms/src/map/apply.ts`, `json[from.field]`).

## Approach (operator's choice, 2026-11-17)

The node flattens each row before it matches a mapping. The sheet shows the flattened columns.
The rest of the node, rules and the per-test lists, works as it does today.

Other ways considered: a tree picker in the sheet (same reach, more screen work), and lifting
fields with a Set node first (no list of results). Both dropped.

## How it flattens

```
{ patient: { number: "P-1" },
  results: [ { code: "HB", value: "14.9" }, { code: "WBC", value: "6.2" } ] }
```
becomes the columns
```
patient.number   "P-1"
results.code     ["HB", "WBC"]
results.value    ["14.9", "6.2"]
```

- An object's keys join with a dot, at any depth.
- A list of objects gives one list column per key, lined up by position. An entry without that key
  gives an empty value at its position, so the lists stay lined up.
- A list of plain values stays a list column, as today.
- Mapping `Test <- results.code` and `Result <- results.value` gives one result record per entry,
  through the same code that reads one column per test today.

## Calls I made (the operator approved them on 2026-11-17)

1. **One list level.** A list inside a list entry (a culture's isolates, each with its antibiotic
   results) is not flattened. That column keeps today's note: nested data no mapping reads. FHIR
   stays the way to send a full culture.
2. **Old mappings keep working.** A mapping saved before this, which knows a column `culture`, also
   covers `culture.status` and the rest. Such a row still matches it and stores what it did before.
3. **Forms are matched first, on the row as sent**, as today. Flattening is only for mappings.
4. **Two columns that flatten to one name** (a key literally named `patient.number` beside a
   `patient` object) hold the row, with a reason naming the column.
5. **The sheet's column list, the sample examples and Test all use the flattened row**, so what
   the sheet shows is what a run reads.

## Not in this change

- Lists inside lists.
- XML that is not FHIR.

## Done means

- Unit tests: flattening, a list of results giving one record each, uneven entries, a list in a
  list left noted, an old mapping still matching, a name clash held.
- A sheet test: the flattened columns show and can be picked.
- A run on the 3991 demo with Codex's nested sample (`wf_mwkjqd0t_lep9je`): mapped and stored.
- Docs for Map to FHIR in en, fr and pt. Changelog after the merge.
