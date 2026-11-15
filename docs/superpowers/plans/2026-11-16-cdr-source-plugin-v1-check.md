# cdr-source plugin: the check against OpenLDR v1. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For each request of a page, the plugin finds its OpenLDR v1 twin, compares the two as the old toolchain does, and returns passed, failed or unchecked, with the rows that differ.

**Architecture:** The check is a set of plain functions over two inputs: the fields and kept observations of a decoded request, and the twin's v1 rows. It never reads the decode's own types, so it can be proven against the old tool on the old tool's inputs. `source_decode` calls it after the decode and before the audit. The old check has no tests, so the first task builds its answers.

**Tech Stack:** Rust (edition 2021, `serde_json`). No regex crate and no new dependency. Node 24 and `tsx` for the fixture and check scripts. Python 3 for `compare.py`.

**Spec:** `docs/superpowers/specs/2026-11-16-cdr-source-v1-check-design.md`.

**Where the work happens:** `/home/fredrick/Projects/Repositories/cdr-source`, on a new branch `v1-check` from `main` once the branch `fault-fixes` is merged. Task 8 alone works in `/home/fredrick/Projects/Repositories/openldr_ce`, on a branch of its own. No file in `cdr-toolchain` changes.

**The reference for every rule:** the compare map at `cdr-source/.superpowers/notes/part3-compare-map.md`. It lists every function, field, comparator, tolerance and oddity of the old check with file and line. This plan names the section of the map each task ports. Where the plan and the TypeScript disagree, the TypeScript wins, and the builder says so.

## Global Constraints

- The old check is the reference, loose rules included. A place where the Rust is stricter or looser than the TypeScript is a defect in this plan. The loose rules are tightened in the next plan, one by one.
- `cdr-toolchain` is frozen. Read it. Never change it.
- No real patient row in the repository. Fixtures are made up. A tool that reads real rows prints counts and field names, never a value.
- Nothing under `src/` reads the clock, the time zone, the locale, an environment variable or a file. The toolchain is always run with `TZ=UTC`, and the Rust gives the answer that run gives.
- Nothing under `src/` panics on any input, a twin row of the wrong shape included. A column that is missing or of the wrong type reads as null.
- The 46 fixtures in `tests/fixtures/`, their override files and `tests/data/classify-golden.json` stay byte for byte as they are.
- Code tables stay in Rust source, each with a comment naming the toolchain file and line it came from. That includes the below-detection codes of `compare/result-diff.ts:287-334`.
- A string that leaves the plugin never names the source system. The check's output says `source` where the old tool says `disa`.
- An error text holds no row value. The check's result rows do hold values, and nothing else may.
- Only the controller may query the container `openldr-mssql`. An implementer never connects to it or to port 1433, never opens a file under a `temp/` or `data/` folder, and never opens a `.env` file.
- A scratch SQL Server container gets `--memory 3g` and `-e MSSQL_MEMORY_LIMIT_MB=2048`, the image already on the machine, a port from 14331 to 14339, a name starting `cdr-scratch-`, and is removed afterwards. One heavy run at a time.
- Never send a request to port 3000. Never touch the dev databases or the container `openldr-docs-system-mssql`.
- No `Co-Authored-By` line in any commit. Prose follows the `unslop` skill. No em dash in any new string.

## Review Focus

1. **A twin key that differs only in letter case or trailing spaces.** The old tool asked SQL Server, which ignores both. The plugin matches rows itself, so `tzdisa0000000001 ` must find `TZDISA0000000001`. Tests in Tasks 2 and 6.
2. **Dates that are not a full date and time.** A v1 value at midnight, a source value with a date only, and a text that is no date. Midnight on either side forgives the time; an unreadable value is a mismatch, never a panic. Test in Task 3.
3. **JavaScript's rounding.** `Math.round` takes a half up, so 2.5 gives 3 and -2.5 gives -2, where Rust's `round` gives -3. The number tolerance uses it twice. Test in Task 5.
4. **A twin with no results, and v1 results the source lacks.** No v1 result rows makes every source observation "only in the source", which passes. A v1 row under a panel and parameter the source has no row for fails. Tests in Tasks 5 and 6.
5. **Text with odd ends and case.** JavaScript's `trim` strips U+FEFF and U+00A0 and leaves U+0085, the reverse of Rust's. `toLowerCase` is full Unicode. Test in Task 3.

---

## File structure

```
src/twin.rs             the twin key, a twin's rows, panel codes, the point-of-care split, v1 observations
src/check_cmp.rs        the comparators: text, loose text, dates to the minute, the "v1 dropped it" rules
src/check_request.rs    the fields the check reads from a request, the 13 request fields, the request diff
src/check_results.rs    pairing, the five result fields, number tolerance, bounds, the below-detection rule
src/check.rs            the verdict and the check's two JSON forms
src/decode.rs           source_decode takes twins; source_twin_keys; the mark
tests/check-cases.mts   the made-up v1 rows of every check case
tests/check-stages.mts  runs the old tool's check for one request and one twin
tests/check-fixtures/   one file per case: input and the old tool's answers
tests/check_golden.rs   one test per check stage over every check fixture
tools/real-data-check/dump-twins.mjs   real twins: rows, the old tool's inputs and answers
examples/check_file.rs  the Rust check on a dumped folder
```

---

### Task 1: The old check's answers on made-up pairs

Map sections 1 to 5. This task writes no Rust.

**Files:**
- Create: `tests/check-cases.mts`, `tests/check-stages.mts`, `tests/check-fixtures/*.json`
- Modify: `tests/generate-fixtures.mts` (new source cases, and a call that writes the check fixtures), `tests/fixture-guard.test.mts` only if a guard needs a case

**Interfaces:**
- Produces: one file per case, `tests/check-fixtures/<case>.json`:

```
{ "input":    { "key", "rows", "dictionaries", "options", "now", "twins": { "requests": [...], "results": [...] } },
  "expected": { "twin_key": "...",
                "v1":      { "found": true, "all_panel_codes": [...], "facility": ..., "ward": ..., "observations": [...] },
                "request": { "fields": [...], "summary": {...} } | null,
                "results": { "observations": [...], "summary": {...} } | null,
                "passed":  true | false | null } }
```

  `input` is a normal fixture's input plus `twins`. `options` gains `poc_format`. A twin row is the row as CE hands it to a plugin (`asPluginRow` in `tests/plugin-rows.mts`): a datetime is `YYYY-MM-DDTHH:MM:SS.mmm`, with `__key` holding the `RequestID`. `expected.request` is the old tool's `DiffResult` as JSON and `expected.results` its `ResultDiff` as JSON, keys unchanged (`disa`, `openldr_v1`). `expected.v1.observations` is `flattenV1`'s output. `expected.v1.facility` and `.ward` are `splitPointOfCare`'s. `passed` is `isPerfectMatch(request.summary) && isResultPerfectMatch(results.summary)`. With no twin, `found` is false and the three after it are null.

- [ ] **Step 1: Write `tests/check-stages.mts`.** One function, `checkStages(recpt, v1RequestRows, v1ResultRows, opts)`. It builds the old tool's v1 request exactly as `fetchRequestByRequestId` does at `openldr.ts:162-174`: the row with the lowest `OBRSetID`, plus `allPanelCodes`. It calls `normalizeLabNumber`, `splitPointOfCare`, `flattenV1`, `diffRecord` with `{ pocFormat }`, `diffResults` with `{}`, and the two perfect-match functions. The v1 rows it is given are driver-shaped: a datetime is a `Date` whose UTC fields hold the wall clock. It returns the `expected` object above through a JSON round trip.

- [ ] **Step 2: Add source requests to `tests/generate-fixtures.mts`.** The check needs source requests that the existing 46 do not hold. Each new case also becomes a normal fixture in `tests/fixtures/`, so the stage tests cover it. Keep them clear of the six fixed faults: no parameter at context 9 to 13 or 160, no birth row, no middle name, no number whose exponent ends in 0. Add:
  - `check-full-request`: every one of the 19 request fields the check reads is set: facility code and name, ward, one ordered panel, specimen, taken, collected, received in lab, registered, priority, sex, ICD-10, therapy, notes, clinical diagnosis. Results: one numeric, one coded with a description, one text.
  - `check-bare-request`: the fewest fields a registration can have. No received date, no ward, no notes.
  - `check-two-panels`: two ordered panels, each with two results, and one parameter that appears twice in a panel.
  - `check-viral-load`: a panel with a resulted comment parameter `SCOM` whose raw value is `TLINT`, and the four viral-load parameters `HIVVQ`, `HIVVM`, `HIVTL`, `HIVTM` empty. The below-detection rule of `compare/result-diff.ts:287-334`.

- [ ] **Step 3: Write `tests/check-cases.mts`.** A list of `{ name, source, pocFormat, requests, results }`, where `source` names a fixture and the two lists are made-up v1 rows written as plain objects with every one of the 36 and 21 columns the check reads. A helper builds a v1 request that matches `check-full-request` on all 13 fields, and each case changes one thing. The cases, by name:
  - Twin: `no-twin` (empty lists), `twin-key-other-case-and-spaces`, `two-order-rows-lowest-wins` with panel codes gathered across both.
  - Each of the 13 fields, four cases each where the comparator allows them: `<field>-match`, `<field>-mismatch`, `<field>-only-source`, `<field>-only-v1`. The fields: `facility_code`, `facility_name`, `ward`, `panel_code`, `specimen_code`, `taken_at`, `collected_at`, `received_at`, `priority`, `sex`, `icd10`, `therapy`, `clinical_info`.
  - Forgiven at the request level, one case per row of the map's table 5.3: `ward-v1-dropped`, `facility-name-v1-dropped`, `icd10-v1-dropped`, `ward-substring`, `clinical-info-substring`, `taken-at-v1-midnight`, `taken-at-source-date-only`, `received-at-no-source-value`, `facility-code-v1-prefixed`.
  - Second candidates: `taken-at-from-collected`, `received-at-from-registered`, `clinical-info-from-diagnosis`, `therapy-from-therapy-text`.
  - Point of care: `poc-one-part`, `poc-facility-ward`, `poc-district-facility-ward` (with that format), `poc-control-byte-06`.
  - Results: `results-all-match`, `result-number-within-half-percent`, `result-number-rounds-to-same-hundredth`, `result-number-rounds-to-same-whole`, `result-number-too-far`, `result-half-rounds-up` (2.5 against 3, and -2.5 against -2), `result-source-inside-v1-bound` (`< 40`), `result-v1-inside-source-bound`, `result-coded-description-match`, `result-coded-raw-code-match`, `result-text-match`, `result-text-mismatch`, `result-one-matches-ten` (the substring fault, map 7.11), `result-description-as-result` (map 7.10), `result-backtick-apostrophe`, `result-only-in-source`, `result-only-in-v1`, `result-v1-overflow-rows` (map 7.12), `result-repeated-parameter-best-match` (map 4.3 step 4), `result-v1-empty-row-dropped`, `result-v1-zero-row-dropped`, `result-si-value-implausible`, `twin-with-no-results`.
  - Below detection, on `check-viral-load`: `below-detection-v1-synthesised`, `below-detection-source-zero`, and `below-detection-no-comment` where the rule must not fire.
  - Odd text: `text-nbsp-and-feff-ends`, `text-u0085-end`, `text-unicode-case`.

- [ ] **Step 4: Run the generator** against a scratch server on port 14331, as its header says, from the toolchain's CLI folder with `TZ=UTC`. Expected: it prints the count of fixtures and of check fixtures. `git status --short tests/fixtures tests/data tests/overrides` shows only the four new source fixtures. Remove the container.

- [ ] **Step 5: Check the answers by eye.** For ten cases of your choice, covering each group above, read the old tool's answer in the fixture and say in the report why it is what the map predicts. A case whose answer surprises you is a finding: report it, do not change the case to make it tidy.

- [ ] **Step 6: Run the existing tests.** `cargo test` Expected: PASS, with 50 fixtures in every stage test and no override needed for the four new ones. If one needs an override, the source case touches a fixed fault: change the case.

- [ ] **Step 7: Commit.**

```bash
git add tests
git commit -m "test: the old check's answers on made-up pairs"
```

---

### Task 2: The twin

Map sections 2 and 3.

**Files:**
- Create: `src/twin.rs`, `tests/check_golden.rs`
- Modify: `src/lib.rs`

**Interfaces:**
- Produces:
  - `pub fn twin_key(lab_no: &str, prefix: &str) -> Option<String>`. None when the lab number is empty after a JavaScript trim.
  - `pub enum PocFormat { FacilityWard, DistrictFacilityWard }` and `pub fn parse_poc_format(s: Option<&str>) -> Result<PocFormat, String>`, default `FacilityWard`, error `poc_format must be facility_ward or district_facility_ward`.
  - `pub struct Twin` holding the lowest-order request row, `all_panel_codes: Vec<String>`, and `observations: Vec<V1Obs>`.
  - `pub fn find_twin<'a>(key: &str, requests: &'a [Value], results: &'a [Value]) -> Option<Twin>`. Rows match the key by SQL Server's equality (`src/sqlcmp.rs`). None when no request row matches.
  - `pub fn split_point_of_care(text: Option<&str>, format: PocFormat) -> (Option<String>, Option<String>)`, facility then ward.
  - `Twin::to_toolchain_json(&self, format: PocFormat) -> Value`, the `expected.v1` object.

- [ ] **Step 1: Write `tests/check_golden.rs`** with the fixture loader and one stage test, `twin_stage`: for every check fixture, `twin_key(input.key, options.prefix)` equals `expected.twin_key`, and `find_twin(...)` gives `expected.v1`. Add three unit tests in `src/twin.rs`:

```rust
#[test]
fn a_twin_is_found_whatever_the_case_or_trailing_spaces() {
    let rows = [json!({ "__key": "tzdisa0000000001  ", "RequestID": "tzdisa0000000001  ", "OBRSetID": 1 })];
    assert!(find_twin("TZDISA0000000001", &rows, &[]).is_some());
}

#[test]
fn a_twin_row_of_the_wrong_shape_reads_as_nulls_and_never_panics() {
    for bad in [json!(null), json!(7), json!([]), json!({ "RequestID": 5, "OBRSetID": "x", "LIMSPanelCode": [1] })] {
        let _ = find_twin("K", &[bad.clone()], &[bad]);
    }
}

#[test]
fn the_lab_number_that_already_starts_with_the_prefix_is_kept_as_typed() {
    assert_eq!(twin_key("tzdisa00001", "TZDISA").as_deref(), Some("tzdisa00001"));
    assert_eq!(twin_key("0000000001", "TZDISA").as_deref(), Some("TZDISA0000000001"));
    assert_eq!(twin_key("   ", "TZDISA"), None);
}
```

- [ ] **Step 2: Run.** `cargo test --test check_golden` Expected: FAIL, `twin` not found.

- [ ] **Step 3: Implement `src/twin.rs`.** `flatten_v1` and its empty-row rule follow `compare/result-mapping.ts:714-777`, with `Number()` from `observations::parse_number`. Order rows sort by `OBRSetID` as a number; a tie keeps arrival order.

- [ ] **Step 4: Run.** `cargo test` Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat: the plugin finds a request's v1 twin"`

---

### Task 3: The comparators

Map section 4.1.

**Files:**
- Create: `src/check_cmp.rs`
- Modify: `src/lib.rs`

**Interfaces:**
- Produces:
  - `pub enum Status { Match, Mismatch, OnlySource, OnlyV1 }`, printed `match`, `mismatch`, `only_disa`, `only_v1` in the toolchain form and `only_source` in the output form.
  - `pub struct Outcome { pub status: Status, pub reason: Option<String> }`.
  - `pub enum Cell { Null, Text(String), Number(f64) }`, a compared value. A datetime is `Text`.
  - `pub fn string_ci`, `string_ci_strip_v1_prefix(prefix)`, `string_ci_loose`, `ward`, `facility_name`, `icd10`, `datetime`, each `(source: &Cell, v1: &Cell) -> Outcome`.
  - `pub fn to_wall_clock(c: &Cell) -> Option<(i64, u32, u32, u32, u32)>`: year, month, day, hour, minute.

- [ ] **Step 1: Write the failing tests.** One test per comparator with the map's cases, and the Review Focus tests:

```rust
#[test]
fn midnight_on_either_side_forgives_the_time() {
    let a = datetime(&text("03/04/2019 07:15"), &text("2019-03-04T00:00:00.000"));
    assert_eq!((a.status, a.reason.as_deref()), (Status::Match, Some("same date; v1 stored as date-only (midnight)")));
    assert_eq!(datetime(&text("03/04/2019 07:15"), &text("2019-03-04T07:16:00.000")).status, Status::Mismatch);
    assert_eq!(datetime(&text("not a date"), &text("2019-03-04T07:15:00.000")).status, Status::Mismatch);
}

#[test]
fn text_is_trimmed_and_lowered_as_javascript_does() {
    assert_eq!(string_ci(&text("\u{feff}Abc\u{a0}"), &text("ABC")).status, Status::Match);
    assert_eq!(string_ci(&text("Abc\u{85}"), &text("ABC")).status, Status::Mismatch);
    assert_eq!(string_ci(&text("STRASSE İ"), &text("strasse i\u{307}")).status, Status::Match);
}
```

  These values were run through the toolchain's `stringCi` and `datetime` on 2026-11-16. Check every further expected value in Node the same way, and paste the output in the report. The exact reason texts are in the map's table 5.3 and in `compare/comparators.ts`.

  Some reason texts name the source system, for example `wall clock differs: DISA=2019-03-04 07:15 v1=2019-03-04 07:16`. The toolchain form keeps each text word for word, because the fixtures compare it. The output form says `source` in its place. One function does the rewrite, and Task 6's test checks that no output text holds the name.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** `to_wall_clock` reads, in order, `MM/DD/YYYY HH:MM`, `MM/DD/YYYY`, an ISO text with no zone read as written, and otherwise the shared `dates::date_parse` taken at UTC. A v1 datetime arrives as `YYYY-MM-DDTHH:MM:SS.mmm`, which is the third form and gives the same clock fields the old tool read from its `Date`.

- [ ] **Step 4: Run.** `cargo test --lib check_cmp` Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat: the check's comparators"`

---

### Task 4: The request level

Map section 4.2 and oddities 1 to 9.

**Files:**
- Create: `src/check_request.rs`
- Modify: `src/lib.rs`, `tests/check_golden.rs`

**Interfaces:**
- Consumes: `Twin`, `PocFormat`, the comparators.
- Produces:
  - `pub struct SourceFields`, the 19 values the check reads from a request, each an `Option<String>`: facility code, facility name, ward, ward resolved, first ordered panel, specimen, taken, collected, received in lab, registered, priority, sex, ICD-10, therapy, therapy text, notes, notes text, clinical diagnosis, clinical diagnosis text.
  - `impl SourceFields { pub fn from_request(r: &Request) -> Self; pub fn from_toolchain_json(v: &Value) -> Self }`. The second reads the old tool's request JSON, for the real-twin check of Task 7.
  - `pub struct FieldRow { field, status, source: Cell, v1: Cell, reason, note }` and `pub struct RequestDiff { pub fields: Vec<FieldRow>, pub summary: Summary }`.
  - `pub fn diff_record(src: &SourceFields, twin: &Twin, format: PocFormat) -> RequestDiff`.
  - `RequestDiff::passed(&self) -> bool`: no mismatch, no only-source, no only-v1.
  - `RequestDiff::to_toolchain_json(&self) -> Value`: the old tool's `DiffResult`. A v1 datetime prints as the old tool prints its `Date`: the stored text with `Z` added.

- [ ] **Step 1: Add the stage test** `request_check_stage` to `tests/check_golden.rs`: for every check fixture with a twin, decode `input`, build `SourceFields::from_request`, and `diff_record(...).to_toolchain_json()` equals `expected.request`. Add a unit test that `from_request` and `from_toolchain_json` give equal `SourceFields` for every one of the 50 fixtures, using each fixture's `expected.request` with its overrides applied.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** The 13 fields in the order of `compare/mapping.ts:88-215`. Candidates are tried as `compare/diff.ts:59-78` tries them: the first pair, then every other pair, stopping at the first match, with the note `matched via DISA + v1 fallback candidate` kept word for word in the toolchain form and without the source's name in the output form. The `received_at` rule of `compare/diff.ts:80-93` checks only the first source candidate, as the code does and not as its comment says.

- [ ] **Step 4: Run.** `cargo test` Expected: PASS, `request_check_stage` on every case.

- [ ] **Step 5: Commit.** `git commit -m "feat: the check compares the 13 request fields"`

---

### Task 5: The result level

Map section 4.3, table 5.3, and oddities 10 to 17.

**Files:**
- Create: `src/check_results.rs`
- Modify: `src/lib.rs`, `tests/check_golden.rs`

**Interfaces:**
- Consumes: `&[Obs]` (the kept observations of `observations::supersede`), `Twin`.
- Produces:
  - `pub fn numbers_match(a: f64, b: f64) -> bool`, `pub fn js_round(x: f64) -> f64`, `pub fn parse_inequality(s: &str) -> Option<(Op, f64)>`.
  - `pub struct ObservationRow { panel_code, param_code, occurrence, status, source, v1, fields, reason }` and `pub struct ResultDiff { pub observations: Vec<ObservationRow>, pub summary: ResultSummary }`.
  - `pub fn diff_results(kept: &[Obs], twin: &Twin) -> ResultDiff`.
  - `ResultDiff::passed(&self) -> bool`: no observation or field that is a mismatch or only in v1.
  - `ResultDiff::to_toolchain_json(&self) -> Value`: the old tool's `ResultDiff`.

- [ ] **Step 1: Write the failing tests.** The stage test `result_check_stage`, as in Task 4. And:

```rust
#[test]
fn rounding_takes_a_half_up_as_javascript_does() {
    assert_eq!(js_round(2.5), 3.0);
    assert_eq!(js_round(-2.5), -2.0);
    assert_eq!(js_round(-0.5), 0.0);
    assert_eq!(js_round(0.49999999999999994), 0.0);
}

#[test]
fn numbers_match_by_each_of_the_five_rules() {
    assert!(numbers_match(1.0, 1.0));
    assert!(numbers_match(1.0, 1.0000005));
    assert!(numbers_match(200.0, 200.9));          // within 0.5%
    assert!(numbers_match(0.014, 0.0149));         // same hundredth after rounding
    assert!(numbers_match(9.6, 10.4));             // same whole number, within 10%
    assert!(!numbers_match(1.0, 10.0));
}

#[test]
fn a_bound_reads_only_in_its_exact_form() {
    assert!(parse_inequality("< 40").is_some());
    assert!(parse_inequality("<=20.5").is_some());
    assert!(parse_inequality("<40 copies").is_none());
    assert!(parse_inequality("40").is_none());
}
```

  The toolchain's `numbersMatch` is not exported. Check each `numbers_match` line in Node first, through the `numeric_value` entry of the exported `RESULT_FIELDS` or by evaluating the five conditions of `compare/result-mapping.ts:234-247`. If Node disagrees with a line here, Node wins: say so. The `parse_inequality` and rounding lines were checked against Node on 2026-11-16. `Math.round(-0.5)` is negative zero, which equals zero.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** Buckets keyed by panel code and parameter code, exact and case-sensitive after a JavaScript trim. Keys visited in UTF-16 code unit order. Inside a bucket the greedy best match of `compare/result-diff.ts:175-206`. The five fields and their skip rule from `compare/result-mapping.ts:307-443` and `compare/result-diff.ts:236-254`. The three forgiven cases of the map's table 5.3 with their reason texts word for word. The below-detection codes go in one table with the toolchain line beside it.

- [ ] **Step 4: Run.** `cargo test` Expected: PASS, `result_check_stage` on every case.

- [ ] **Step 5: Commit.** `git commit -m "feat: the check compares every result"`

---

### Task 6: The verdict, and the check inside the decode

Design sections 6.1, 6.2 and 6.4.

**Files:**
- Create: `src/check.rs`
- Modify: `src/decode.rs`, `src/options.rs`, `src/lib.rs`, `scripts/build.mjs`, `README.md`, `examples/decode_file.rs`, `tests/check_golden.rs`

**Interfaces:**
- Produces:
  - `pub enum Check { Unchecked, Checked { request: RequestDiff, results: ResultDiff } }`, `Check::status(&self) -> &'static str` giving `unchecked`, `passed` or `failed`, and `Check::to_json(&self) -> Value` in the output form of design 6.1.
  - `pub fn check(src: &SourceFields, kept: &[Obs], twin: Option<&Twin>, format: PocFormat) -> Check`.
  - `pub fn source_twin_keys(input: &Value) -> Result<Value, String>`: `{ options, keys }` gives `{ "keys": [...] }`, one v1 key per source key, in order, null for a key that is empty.
  - `source_decode` takes `twins`. Each group gains `check`.
  - `DecodeOptions.poc_format: PocFormat`.

- [ ] **Step 1: Write the failing tests.** In `tests/check_golden.rs`, `verdict_stage`: for every check fixture, `check(...).status()` is `unchecked` when `expected.v1.found` is false, `passed` when `expected.passed` is true, and `failed` otherwise. In `src/decode.rs`:

```rust
#[test]
fn a_call_without_twins_fails() {
    // input with no `twins`, with `twins: {}` and with `twins: { requests: [] }`
    // each gives Err("twins must hold requests and results")
}

#[test]
fn a_request_with_no_twin_is_unchecked_and_carries_the_mark() {
    // a clean fixture with twins of two empty lists: check.status "unchecked", held false,
    // and the ServiceRequest holds the extension urn:openldr:ext:request-attribute with the
    // code v1-check in urn:openldr:cs:request-attribute and the text value "unchecked"
}

#[test]
fn a_request_that_passes_carries_the_mark_passed() {}

#[test]
fn a_failed_check_holds_the_request_and_still_returns_the_findings() {
    // check.status "failed", held true, no resources, findings as the audit gives them,
    // check.fields holds the row that differs with both values
}

#[test]
fn only_the_rows_that_differ_are_returned_for_results() {}

#[test]
fn the_twin_keys_come_back_in_order() {
    // source_twin_keys {options: tanzania, keys: ["0000000001", "", "0000000002"]}
    // gives { keys: ["TZDISA0000000001", null, "TZDISA0000000002"] }
}

#[test]
fn no_check_output_names_the_source_system() {
    // over every check fixture: the output form of check holds no key or reason text with "disa"
}
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** The order of design 6.2. The mark is added to the resources after `resources(...)` returns, on every ServiceRequest, in the form `src/fhir.rs` already writes a request attribute. `findings` and `resources` keep their rules; `held` is true when the check failed or the audit has an error. Every existing caller of `source_decode` passes `twins`; with two empty lists every request is unchecked. `decode_file` reads `twins` from each `raw.ndjson` line when the line has it, and writes a stage `check` in the toolchain form: `{ twin_key, v1, request, results, passed }`.

- [ ] **Step 4: Add both entrypoints to the manifest** in `scripts/build.mjs`, and describe `twins`, `check`, the mark and `source_twin_keys` in `README.md`, without naming the source system.

- [ ] **Step 5: Run everything.** `cargo test`, `cargo clippy --all-targets`, `cargo build --release --target wasm32-wasip1`, `node scripts/build.mjs` Expected: PASS, no warning, exit 0, and the manifest lists both entrypoints.

- [ ] **Step 6: Commit.** `git commit -m "feat: source_decode checks each request against its v1 twin"`

---

### Task 7: The tools for real twins, proven on made-up data

Design section 6.5, layers 2 and 3.

**Files:**
- Create: `tools/real-data-check/dump-twins.mjs`, `tools/real-data-check/dump-twins.test.mjs`, `examples/check_file.rs`
- Modify: `tools/real-data-check/compare.py`, `tools/real-data-check/compare.test.mjs`, `tools/real-data-check/README.md`, `tests/generate-fixtures.mts` (a made-up v1 database on the scratch server)

**Interfaces:**
- `dump-twins.mjs <dir> <n> --v1-db <name> --prefix <text> [--poc-format <f>] [--concurrency <n>]`. It samples `n` source requests that have a twin, spread across the table. It writes `dict.json` and `run.json` as `dump.mjs` does. Each `raw.ndjson` line gains `twins`, the twin's rows as CE would hand them. Each `ts.ndjson` line holds the five stages and two more: `check`, the old tool's answer in the Task 1 `expected` shape, and `check_input`, what the old tool's check was given: the 19 request fields and the kept observations as JSON.
- `check_file <dir>` runs the Rust check on each line's `check_input` and `twins`, and writes a stage `check_alone` in the same shape as `check`.
- `compare.py` compares `check` in the tool's line with `check_alone` in the Rust line, and `check` with `check`, as two more stage blocks. Neither can be allowed away by `--allowed`.

- [ ] **Step 1: Write the failing tests** in the tools' style: the sampling SQL holds no bare word CE refuses and reads with SELECT only; a key with no twin is never sampled; a request on which the old check throws is counted as failed in `run.json`; `compare.py` fails when the two check stages differ and when one side lacks the stage.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the three programs.** The two v1 statements are `SELECT [RequestID] AS [__key], * FROM [db].[dbo].[Requests] WHERE [RequestID] IN (...) ORDER BY [RequestID], [OBRSetID]` and the same for `LabResults` ordered by `[RequestID], [OBRSetID], [OBXSetID], [OBXSubID]`. The old tool's side is given driver rows; the file is given the same rows through `asPluginRow`.
- [ ] **Step 4: Prove them on made-up data.** Extend the generator's scratch databases with a made-up v1 database holding the twins of the check cases. Run `dump-twins.mjs`, `decode_file`, `check_file` and `compare.py` against the scratch server. Expected: every stage identical, the two check stages included, and the folder passes. Remove the container.
- [ ] **Step 5: Run everything.** `cargo test`, the tool tests. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat: the real-data check covers the v1 check"`

---

### Task 8: CE knows the mark's code

Design section 6.4. This task works in `/home/fredrick/Projects/Repositories/openldr_ce`, on a branch `v1-check-code` from `main`. It needs the operator's yes before it merges.

**Files:**
- Modify: `packages/terminology/codesystems/openldr-request-attribute.json`
- Test: `packages/terminology/src/request-attribute-codesystem.test.ts`, `packages/db/src/relational/request-facts.test.ts`

- [ ] **Step 1: Write the failing tests.** The code system holds a concept with code `v1-check` and display `Check against OpenLDR v1`. A ServiceRequest carrying the request-attribute extension with that code and the text value `unchecked` gives one row in `lab_request_attributes`, in the style of the tests already in `request-facts.test.ts`.
- [ ] **Step 2: Run.** `pnpm --filter @openldr/terminology test` and `pnpm --filter @openldr/db test` Expected: the first new test FAILS. If the second already passes, the reader takes any code: say so and keep the test.
- [ ] **Step 3: Add the concept** after `unique-id`.
- [ ] **Step 4: Run both packages' tests and typechecks.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(terminology): a request attribute for the check against OpenLDR v1"`

The full gate, the merge to `main`, the push and `pnpm make:changelog` are the controller's, after the operator's yes.

---

### Task 9: Real twins (the controller's task)

It needs the operator's yes for a read-only login that can SELECT in the three source databases and in the restored v1 database, created for the run and dropped after it.

- [ ] **Step 1: Dump 20,000 real twins** with `dump-twins.mjs`. Expected: 0 failed in the old tool.
- [ ] **Step 2: Layer 2.** Run `check_file` and `compare.py`. Expected: `check` against `check_alone` identical for every request. A difference goes back to the task that owns the rule, with the field name, the count and a new made-up case that shows it.
- [ ] **Step 3: Layer 3.** Run `decode_file` and `compare.py --allowed`. Count passed, failed and unchecked on each side. For every request whose verdict differs, name the fault fix that explains it by the field that differs. One that cannot be explained stops the plan.
- [ ] **Step 4: Count what fails.** By request field and by result status, counts only: the table the next plan's tightening starts from.
- [ ] **Step 5: Time `source_decode`** over pages of 500 with twins.
- [ ] **Step 6: Record** all of it in `docs/real-data-check.md`, delete the dumped rows, drop the login. Commit as `docs: the v1 check on real twins`.

---

## What this plan leaves

- The next plan: the four faults that wait for v1, and the loose rules, each with a measured count (design section 7).
- Part 4: how the host pairs the two copies, the held-back view, and the list of v1 requests with no source record.
- CE's v1 import cannot copy a v1 of schema 1.1.1, which has no `Patients` and no `ASTResults` table. Part 4's real run needs that fixed first.
