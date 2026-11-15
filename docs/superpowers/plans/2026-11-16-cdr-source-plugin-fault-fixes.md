# cdr-source plugin: fault fixes. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plugin stops copying six of the old tool's faults. Each fix is one change with its own test, and each records how many real requests it changes.

**Architecture:** The toolchain stays the reference for everything a fix does not touch. A fix writes down its intended differences in two small files: one the golden tests apply to the toolchain's stored answers, one the real-data compare reads. Anything that differs outside those files is still a failure.

**Tech Stack:** Rust (edition 2021, `serde_json`). Node 24 for the tool tests. Python 3 for `compare.py`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-cdr-source-plugin-design.md`, section 6.8 and step 7 of section 6.9.

**Where the work happens:** `/home/fredrick/Projects/Repositories/cdr-source`, on a new branch `fault-fixes` from `main` (`7eef3e3`). No file in `openldr_ce` or `cdr-toolchain` changes.

**The reference for every fault:** `cdr-source/.superpowers/notes/fault-facts.md`. It gives, for each fault, the TypeScript line that causes it, the Rust line that copies it, a smallest input, today's output and the output it should be. This plan names the section of that file each task works from.

## Scope

All 15 faults of section 6.8 were checked against both codebases on 2026-11-16, and the triggers were counted on the restored Tanzania database. 14 are confirmed, 1 is unclear.

| # | Fault | Verdict | Symptom, measured | In this plan |
|---|---|---|---|---|
| 1 | Contexts 9 to 12 read as blank | CONFIRMED | 64 parameters (2, 55, 1 and 6 at contexts 9 to 12). A coded result shows its raw code | Task 2 |
| 4 | Organism stems match whole words only | CONFIRMED | 16 of 659 organism descriptions are typed as bacteria: Cryptococcus, Histoplasma, Trichophyton, Plasmodium | Task 3 |
| 5 | Exponent zeros stripped | CONFIRMED | A stored number of 1e30 is saved as the text `1.0000000150474662e+3` | Task 4 |
| 7, 12 | A birth date from the birth index is lost | CONFIRMED, one cause | A patient whose date of birth comes from the index gets no `date_of_birth` and no FHIR `birthDate` | Task 5 |
| 8 | Four messages name the source system | CONFIRMED | A finding shown to a user says "DISA", "COMMDICT" or "PARMDICT" | Task 6 |
| 10 | Middle name never set | CONFIRMED | A patient's middle name is dropped | Task 7 |
| 9 | A tab in a panel code throws | REFUTED as plugin work | The toolchain throws. The plugin already gives the right answer (`src/observations.rs:376-418`) | No. Nothing to build |
| 6 | Run number minus 100 twice | DEFER-YAGNI | 0 test rows have a run number above 200. A site that has one would justify it | No |
| 15 | Result bytes trimmed before slots | DEFER-YAGNI | 0 of 3,778,852 test records start with a whitespace byte, 1 ends with one | No |
| 2 | Two birth rows, unordered read | DEFER to part 3 | The plugin already takes the earliest. Which date is right needs v1 | No |
| 3 | Two taken-date rows | UNCLEAR, DEFER to part 3 | At most 84 requests | No |
| 11 | Two age decoders read different bytes | DEFER to part 3 | Needs v1's age to say what byte 416 means | No |
| 13 | One run per panel code hides an order | DEFER to part 3 | 26,062 requests have a panel code with runs in two orders. v1 dropped earlier runs too, so v1 decides | No |
| 14 | An unknown specimen code is held back as missing | Needs the operator's rule | It changes which records are held. Task 8 counts how many | Count only |

Seven rows are fixed here by six changes. One is refuted as work, two are deferred for want of a symptom, four wait for v1, and one waits for a rule.

Two more were found while checking and are not fixed here. The `specimen_missing` message talks about "v2 storage" and CE internals (`src/audit.rs:121`); it goes with fault 14, which rewrites that rule. A registration with no age gives the specimen date as the date of birth (`src/records.rs:109-127`); it goes with fault 11.

## Global Constraints

- Outside the six fixes, the toolchain is still the reference. A change that moves any other output is a defect.
- A fix changes behaviour only where the facts file says. Its override and allowed-difference entries list every path it moves.
- `cdr-toolchain` is frozen. Read it. Never change it.
- The fixture files in `tests/fixtures/` and `tests/data/classify-golden.json` stay byte for byte as they are. They hold what the toolchain wrote. No task runs the fixture generator.
- No real patient row in the repository. A tool that reads real rows prints counts and field names, never a value.
- Nothing under `src/` reads the clock, the time zone, the locale, an environment variable or a file.
- Nothing under `src/` panics on any input.
- Only the controller may query the container `openldr-mssql`. An implementer never connects to it or to port 1433, never opens a file under a `temp/` or `data/` folder, and never opens a `.env` file.
- Never send a request to port 3000. Never touch the dev databases or the container `openldr-docs-system-mssql`.
- The plugin's page, README and strings never name the source system.
- No `Co-Authored-By` line in any commit. Prose follows the `unslop` skill. No em dash in any new string.

## Review Focus

1. **A context that now reads, with no dictionary row behind it.** A parameter at context 10 whose result code has no comment row must keep its raw code, as context 50 does today. Test in Task 2.
2. **A stem inside a word.** `plasmodi` must match `Plasmodium` and must not match a word that only contains it, such as `Xplasmodium`. The leading word boundary stays. Test in Task 3.
3. **A negative number and a mantissa with zeros.** `-2e-10` as a float, and `1.5e+100`, must keep their exponent whole. A plain `4.50` still prints `4.5`. Test in Task 4.
4. **A birth row with a time part or a short year.** `1990-05-06T13:45:00.000` gives `05/06/1990`. A year below 1000 is padded to four digits. A birth row that cannot be read falls back to the registration's own date, as today. Test in Task 5.
5. **A name with fewer or more than three parts.** `A`, `A,B`, `A,,C` and `A,B,C,D` must not panic and must give the same first and last name as today. Test in Task 7.

---

## File structure

```
tests/golden.rs                         applies a fixture's overrides before comparing
tests/overrides/<fixture>.json          one fix's intended differences for one fixture
tests/data/classify-overrides.json      the 16 organism descriptions fault 4 moves
tools/real-data-check/compare.py        reads the allowed differences
tools/real-data-check/allowed-differences.json   per fix, the paths it may move on real requests
src/dict.rs, src/codebook.rs, src/observations.rs, src/request.rs, src/records.rs,
src/dates.rs, src/audit.rs, src/payload.rs    one fix each, as the tasks say
docs/real-data-check.md                 the counts each fix moved
```

---

### Task 1: A way to write down an intended difference

**Files:**
- Modify: `tests/golden.rs`, `tools/real-data-check/compare.py`, `tools/real-data-check/compare.test.mjs`, `tools/real-data-check/README.md`
- Create: `tools/real-data-check/allowed-differences.json` (holding `[]`)

**Interfaces:**
- Produces, for the golden tests: an override file `tests/overrides/<fixture>.json`, a list of operations
  `{ "fault": string, "stage": "request"|"observations"|"audit"|"payload"|"fhir", "path": string, "was": any, "now": any }`.
  `path` uses `.key` and `[n]`, for example `.lab_results[0].result_value`. `was` is the value the toolchain's `expected.<stage>` holds at that path; leave the key out when the path is absent there. `now` is the fixed value; leave the key out when the fix removes the path. A whole list or object may be replaced by naming its own path.
- Produces, for the real-data compare: `allowed-differences.json`, a list of
  `{ "fault": string, "stage": string, "paths": [generic path] }`, where a generic path is a compare path with every `[n]` written `[]`.

- [ ] **Step 1: Write the failing tests in `tests/golden.rs`.**

```rust
#[test]
fn an_override_replaces_a_value_and_checks_what_was_there() {
    let mut e = json!({ "a": [{ "b": "old" }] });
    apply_overrides(&mut e, &[json!({ "fault": "f", "stage": "payload", "path": ".a[0].b", "was": "old", "now": "new" })], "payload").unwrap();
    assert_eq!(e, json!({ "a": [{ "b": "new" }] }));
}

#[test]
fn an_override_whose_was_is_stale_fails() {
    let mut e = json!({ "a": 1 });
    let r = apply_overrides(&mut e, &[json!({ "fault": "f", "stage": "payload", "path": ".a", "was": 2, "now": 3 })], "payload");
    assert!(r.unwrap_err().contains(".a"));
}

#[test]
fn an_override_can_add_and_remove_a_key() {
    let mut e = json!({ "a": 1 });
    apply_overrides(&mut e, &[json!({ "fault": "f", "stage": "payload", "path": ".b", "now": "x" })], "payload").unwrap();
    apply_overrides(&mut e, &[json!({ "fault": "f", "stage": "payload", "path": ".a", "was": 1 })], "payload").unwrap();
    assert_eq!(e, json!({ "b": "x" }));
}

#[test]
fn an_override_for_another_stage_is_left_alone() {
    let mut e = json!({ "a": 1 });
    apply_overrides(&mut e, &[json!({ "fault": "f", "stage": "audit", "path": ".a", "was": 1, "now": 2 })], "payload").unwrap();
    assert_eq!(e, json!({ "a": 1 }));
}

#[test]
fn an_override_adding_a_key_that_is_already_there_fails() {
    let mut e = json!({ "a": 1 });
    assert!(apply_overrides(&mut e, &[json!({ "fault": "f", "stage": "payload", "path": ".a", "now": 2 })], "payload").is_err());
}

#[test]
fn every_override_file_names_a_fixture() {
    // Each file under tests/overrides/ has the name of a file under tests/fixtures/.
}
```

- [ ] **Step 2: Run them.** `cargo test --test golden override` Expected: FAIL, `apply_overrides` not found.

- [ ] **Step 3: Implement `fn apply_overrides(expected: &mut Value, ops: &[Value], stage: &str) -> Result<(), String>` in `tests/golden.rs`, and call it from `check_stage`.**
  `check_stage` loads `tests/overrides/<name>.json` when it exists, clones `expected.<stage>`, applies the operations for that stage, then calls `diff`. A failed operation is a test failure that names the fixture, the fault and the path. Numbers compare as numbers, as `diff` already does. With no override file the behaviour is today's.

- [ ] **Step 4: Run the whole golden file.** `cargo test --test golden` Expected: PASS, all stage tests on 46 fixtures as before.

- [ ] **Step 5: Write the failing tests in `tools/real-data-check/compare.test.mjs`.** Four cases, each a made-up folder of one or two requests, in the file's existing style:
  1. One request differs only at `.p` in the payload stage, and `allowed-differences.json` (passed by `--allowed <file>`) lists `{ fault: "x", stage: "payload", paths: [".p"] }`. Exit 0. Output has `allowed x: requests 1, fields 1` and `result: pass`.
  2. The same request also differs at `.q`, which is not listed. Exit 1. Output lists `.q` under `fields different`.
  3. No `--allowed` argument and the same difference. Exit 1. This pins that the default is strict.
  4. The existing known case, which has no test today: two requests differ only at `.DobAge` in the request stage; `raw.ndjson` gives one of them two `births` rows and the other one row. Output has `requests known, two birth rows: 1`, and exit 1 because of the other.

- [ ] **Step 6: Run them.** `node --test tools/real-data-check/compare.test.mjs` Expected: cases 1 and 2 FAIL on the unknown argument. Cases 3 and 4 may already pass.

- [ ] **Step 7: Implement `--allowed <file>` in `compare.py`.** Usage becomes `compare.py <dir> [--allowed <file>]`. In `compare_stage`, after `differing` is computed and after the two-birth-rows case: when `differing` is not empty and every generic path in it is listed for this stage, the request counts as allowed, not identical and not different. Each listed entry whose paths include a differing path gets one request and its field count. Print one line per entry that matched: `allowed <fault>: requests N, fields M`. The stage passes when `identical + known + allowed == compared` and the other three conditions hold as today. A file that is not a list of such entries is an error, exit 2.

- [ ] **Step 8: Run all tool tests.** `node --test tools/real-data-check/*.test.mjs tests/fixture-guard.test.mts` Expected: PASS, 58 tests.

- [ ] **Step 9: Describe both files in `tools/real-data-check/README.md`**, in a short section "After a fault is fixed".

- [ ] **Step 10: Commit.**

```bash
git add tests/golden.rs tools/real-data-check
git commit -m "test: a fix can write down the differences it intends"
```

---

### Task 2: A parameter at context 9 to 13 keeps its coded answers (fault 1)

Facts file section 1.

**Files:**
- Modify: `src/dict.rs:72-81` and its test at `:269-280`
- Create: `tests/overrides/coded-context-ten.json`
- Modify: `tools/real-data-check/allowed-differences.json`

**Interfaces:** none change. `Parameter.context` holds the byte's value where it held -1.

- [ ] **Step 1: Rewrite the test at `src/dict.rs:269-280` and add one.**

```rust
#[test]
fn a_context_byte_from_9_to_13_is_a_context() {
    for c in [9u8, 10, 11, 12, 13, 50, 97] {
        let mut b = vec![0u8; 2017];
        b[121] = c;
        assert_eq!(parameter_from_bytes(&b).context, c as i64, "byte {c}");
    }
}

#[test]
fn a_context_byte_of_0_or_32_or_a_short_record_is_no_context() {
    for c in [0u8, 32] {
        let mut b = vec![0u8; 2017];
        b[121] = c;
        assert_eq!(parameter_from_bytes(&b).context, -1, "byte {c}");
    }
    assert_eq!(parameter_from_bytes(&[0u8; 100]).context, -1);
}
```

- [ ] **Step 2: Run.** `cargo test --lib context_byte` Expected: FAIL for 9 to 13.

- [ ] **Step 3: Change `parameter_from_bytes`.** Read byte 121 of the record itself. 0 and 32 mean no context, because a NUL and a space cannot be told apart once the record's NULs are turned into spaces. Any other value is the context. Replace the "known fault, kept" comment with one line saying what the toolchain does and that this differs on purpose.

- [ ] **Step 4: Add the Review Focus test.** In `src/request.rs` tests: a parameter at context 10 and a coded result whose code has no comment row gives the raw code as its value, the same as the existing test for context 50 with no row.

- [ ] **Step 5: Run the golden tests.** `cargo test --test golden` Expected: FAIL on `coded-context-ten` only, at the request, observations, payload and fhir stages.

- [ ] **Step 6: Write `tests/overrides/coded-context-ten.json`.** One operation per path the failure lists. The fixed values must be those the fixture `coded-comment` holds for the same shape at context 50: the value and its text become `Made up ten positive`, the raw code `POS` moves to the raw-value field, and the FHIR coded value carries the description. Check each `now` against `coded-comment`'s expected output by eye, path by path, and say so in the report.

- [ ] **Step 7: Add the entry to `allowed-differences.json`.** `fault: "context-9-to-13"`, one entry per stage, with the generic form of every path in the override file.

- [ ] **Step 8: Run everything.** `cargo test` Expected: PASS.

- [ ] **Step 9: Commit.** `git commit -m "fix: a parameter at context 9 to 13 keeps its coded answers"`

---

### Task 3: An organism word stem matches the start of a word (fault 4)

Facts file section 4.

**Files:**
- Modify: `src/codebook.rs:128-130`, `:137-175`, and the tests at `:395-396` and `:428-445`
- Create: `tests/data/classify-overrides.json`
- Modify: `tools/real-data-check/allowed-differences.json`

- [ ] **Step 1: Write `tests/data/classify-overrides.json`.** A list of 16 entries `{ "description": string, "was": "bacteria", "now": "fungus" | "parasite" }`: the 4 Cryptococcus rows, `Histoplasma capsulata` and the 10 Trichophyton rows become `fungus`, and `Plasmodium falciparum` becomes `parasite`. Take each description from `classify-golden.json` exactly.

- [ ] **Step 2: Change the tests.** `:395-396` now expects `classify("Plasmodium falciparum")` to be `Parasite`. The golden test at `:428-445` applies the overrides: for an overridden description it expects `now`, and it fails if the golden file's own answer is not `was`, or if an override names a description the golden file lacks. Add:

```rust
#[test]
fn a_stem_matches_at_the_start_of_a_word_only() {
    assert_eq!(classify("Plasmodium vivax"), OrganismCategory::Parasite);
    assert_eq!(classify("Cryptococcus neoformans"), OrganismCategory::Fungus);
    assert_eq!(classify("Xplasmodium"), OrganismCategory::Bacteria);
    assert_eq!(classify("Yeasts"), OrganismCategory::Fungus);
}
```

- [ ] **Step 3: Run.** `cargo test --lib classify` Expected: FAIL.

- [ ] **Step 4: Change the fungus and parasite matches** so a listed word matches when it starts at a word boundary, with no boundary needed after it. The other five patterns keep their trailing boundary. Fix the doc comment.

- [ ] **Step 5: Run.** `cargo test` Expected: PASS. The golden classify test must report exactly 16 overridden descriptions.

- [ ] **Step 6: Add the allowed entry.** `fault: "organism-stems"`, stage `payload`, path `.isolates[].organism_type`.

- [ ] **Step 7: Commit.** `git commit -m "fix: an organism word stem matches the start of a word"`

---

### Task 4: A number keeps its whole exponent (fault 5)

Facts file section 5.

**Files:**
- Modify: `src/observations.rs:207-219` and the test at `:556`
- Modify: `tools/real-data-check/allowed-differences.json`

- [ ] **Step 1: Write the failing tests.**

```rust
#[test]
fn a_number_keeps_its_whole_exponent() {
    assert_eq!(stringify_num(1e30_f32 as f64), "1.0000000150474662e+30");
    assert_eq!(stringify_num(2e-10_f32 as f64), "2.000000026702864e-10");
    assert_eq!(stringify_num(3e-30_f32 as f64), "3.0000000095132306e-30");
    assert_eq!(stringify_num(-2e-10_f32 as f64), "-2.000000026702864e-10");
    assert_eq!(stringify_num(1.5e100), "1.5e+100");
    assert_eq!(stringify_num(1e21), "1e+21");
}

#[test]
fn a_plain_number_still_loses_its_trailing_zeros() {
    assert_eq!(stringify_num(4.5), "4.5");
    assert_eq!(stringify_num(5.0), "5");
    assert_eq!(stringify_num(0.1 + 0.2), "0.30000000000000004");
}
```

Check each expected text with `node -e "console.log(String(Math.fround(1e30)))"` and put the output in the report.

- [ ] **Step 2: Run.** `cargo test --lib stringify` Expected: FAIL on the first test.

- [ ] **Step 3: Change `stringify_num`** to strip zeros, and then a bare dot, from the part before `e` only. Fix the doc comment, which also cites the wrong lines: the TypeScript is at `result-mapping.ts:178-183`.

- [ ] **Step 4: Run.** `cargo test` Expected: PASS. No fixture holds such a number, so no override file.

- [ ] **Step 5: Add the allowed entry.** `fault: "exponent-zeros"`: observations `.kept[].valueStr` and `.all[].valueStr`; payload `.lab_results[].result_value`; and every message or detail path that prints the value. Find those by reading the callers of `value_str` in `src/audit.rs` and `src/payload_results.rs`, and list each in the report with its line.

- [ ] **Step 6: Commit.** `git commit -m "fix: a number keeps its whole exponent"`

---

### Task 5: A birth date from the birth index reaches the patient (faults 7 and 12)

Facts file sections 7 and 12.

**Files:**
- Modify: `src/request.rs:450-455`, `src/dates.rs` (`dob_text` at `:362-373` and what only it uses), `src/audit.rs:570`, `src/payload.rs:699-707`, and the tests at `src/payload.rs:1145` and `:1316`
- Create: `tests/overrides/birth-row.json`, `birth-after-specimen-date.json`, `birth-date-in-future.json`, `collected-year-219.json`
- Modify: `tools/real-data-check/allowed-differences.json`

**Interfaces:**
- `Request.dob_age` from a birth row is now the text `MM/DD/YYYY`, the form a registration's own date of birth has. It was an ISO time ending in `Z`.

- [ ] **Step 1: Write the failing tests** in `src/request.rs`:

```rust
#[test]
fn a_birth_row_date_reads_as_month_day_year() {
    // births: [{ DOBDATE: "1990-05-06T00:00:00.000" }]
    assert_eq!(decoded.dob_age.as_deref(), Some("05/06/1990"));
}

#[test]
fn a_birth_row_time_part_is_dropped_and_a_short_year_is_padded() {
    // "1990-05-06T13:45:00.000" gives "05/06/1990"; "0219-05-06T00:00:00.000" gives "05/06/0219"
}

#[test]
fn a_birth_row_that_cannot_be_read_falls_back_to_the_registration() {
    // DOBDATE null or "x": dob_age is the registration's own value, as today
}
```

And in `src/payload.rs`, replacing the two tests that pin the long text: a request with a birth row `1990-05-06` gives `patient.date_of_birth` `1990-05-06`, has no `patient_data.dob_or_age_raw`, and gives the same ages a registration date of `05/06/1990` gives.

- [ ] **Step 2: Run.** `cargo test --lib birth_row` Expected: FAIL.

- [ ] **Step 3: Change the decode.** A birth row's `DOBDATE` becomes `MM/DD/YYYY` from its date part, month and day two digits, year at least four. Remove the `dob_text` calls in the audit and the payload, and remove `dob_text` and any helper that only it used. The birth row still wins over the registration's own date, and the first row is still taken.

- [ ] **Step 4: Run the golden tests.** `cargo test --test golden` Expected: FAIL on the four fixtures with a birth row and on no other.

- [ ] **Step 5: Write the four override files.** What each must show:
  - `birth-row`: request `.DobAge` `05/06/1990`; payload patient `date_of_birth` `1990-05-06`, `dob_or_age_raw` removed, and the ages the payload derives from that date; FHIR Patient `birthDate` `1990-05-06`.
  - `birth-after-specimen-date`: the same kind of changes for `2020-06-01`, and the finding's message and `details.dob_raw` hold `06/01/2020` where they held the long text. The finding's class and severity do not change.
  - `birth-date-in-future` and `collected-year-219`: the same kind of changes for their own dates.
  For every operation whose `now` is a derived number (an age), work the number out by hand from the two dates and show the sum in the report. An override that only repeats what the code printed proves nothing.

- [ ] **Step 6: Add the allowed entry.** `fault: "birth-index-date"`, with the generic form of every path in the four files.

- [ ] **Step 7: Run everything.** `cargo test`, `cargo clippy --all-targets` Expected: PASS, no warning.

- [ ] **Step 8: Commit.** `git commit -m "fix: a birth date from the birth index reaches the patient"`

---

### Task 6: No finding names the source system (fault 8)

Facts file section 8.

**Files:**
- Modify: `src/audit.rs:174`, `:374`, `:414`, `:425` and the asserts at `:924`, `:947`, `:961`, `:1037`
- Create or modify: `tests/overrides/` for `same-parameter-two-specimen-kinds`, `specimen-kind-mismatch-with-results`, `coded-value-invalid`, `numeric-1e13`, `text-replaces-numeric`, `text-with-units-over-numeric-slot`
- Modify: `tools/real-data-check/allowed-differences.json`

The new texts. Only the part shown changes; the rest of each message stays.

| Line | Old | New |
|---|---|---|
| `:174` | `so the test was performed \u{2014} likely DISA's single-specimen-per-request limitation. Migrating with the recorded specimen.` | `so the test was performed. The source system records one specimen per request. Migrating with the recorded specimen.` |
| `:374` | `decoded as "Invalid" outside an AST context \u{2014} likely a COMMDICT description typo.` | `decoded as "Invalid" outside a susceptibility test. The coded-value dictionary likely holds a typing error.` |
| `:414` | `outside plausible range \u{2014} likely uninitialised-float garbage from a misdecoded DISA blob slot.` | `outside the plausible range. The source record likely holds an unset number here.` |
| `:425` | `has units typed inline; PARMDICT already supplies` | `has units typed inline; the parameter dictionary already supplies` |

- [ ] **Step 1: Change the four test asserts** to the new texts, and add one test:

```rust
#[test]
fn no_finding_message_names_the_source_system() {
    // Run the audit over every fixture's request. No message contains "DISA", "COMMDICT",
    // "PARMDICT", "TESTDICT", "REGDAT" or "TESTDATA", in any letter case.
}
```

- [ ] **Step 2: Run.** `cargo test --lib audit` Expected: FAIL.

- [ ] **Step 3: Change the four strings.**

- [ ] **Step 4: Run the golden tests.** Expected: FAIL on the six fixtures above, in the audit and payload stages, at message paths only.

- [ ] **Step 5: Write the override operations.** Each replaces one message. `was` is the toolchain's full message, `now` the full new one. If a fixture already has an override file from an earlier task, add to it.

- [ ] **Step 6: Add the allowed entry.** `fault: "neutral-messages"`: audit `.anomalies[].message`; payload `.data_quality.anomalies[].message`.

- [ ] **Step 7: Run everything.** `cargo test` Expected: PASS.

- [ ] **Step 8: Commit.** `git commit -m "fix: no finding names the source system"`

---

### Task 7: A patient keeps a middle name (fault 10)

Facts file section 10.

**Files:**
- Modify: `src/records.rs:40-56` (`Registration` gains `middle_name`), `src/request.rs:378-390` (`audit_name` returns three parts), `:444-448`, `:94-95`, `:606`, `src/payload.rs:721-722`
- Create: `tests/overrides/audit-corrected-name.json`
- Modify: `tools/real-data-check/allowed-differences.json`

**The rule.** Each part of the name comes from the newest name-correction audit row when that row has it, and otherwise from the registration. First and last name already follow this rule (`src/request.rs:447-448`). The middle name is the second of the comma-separated parts on both sides.

- [ ] **Step 1: Write the failing tests.**

```rust
// src/records.rs
#[test]
fn a_registration_name_keeps_its_middle_part() {
    // "SMITH,MARY,JANE" gives surname SMITH, middle MARY, first JANE
    // "A" gives surname A, no middle, no first
    // "A,B" gives surname A, middle B, no first
    // "A,,C" gives surname A, no middle, first C
    // "A,B,C,D" gives surname A, middle B, first C
}

// src/request.rs
#[test]
fn the_middle_name_follows_the_same_rule_as_first_and_last() {
    // registration "SMITH,MARY,JANE", no audit row: MiddleName MARY
    // audit row "SMITH,ANN,JANE": MiddleName ANN
    // audit row "SMITH,,JANE": MiddleName MARY, from the registration
}
```

And one in `src/payload.rs`: a request with a middle name gives `patient.middlename`, and `src/fhir.rs`'s existing test for a middle name still passes.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** The request JSON's `MiddleName` and the payload's `middlename` hold the value, or null when there is none.

- [ ] **Step 4: Run the golden tests.** Expected: FAIL on `audit-corrected-name` only, whose audit row holds the middle part `MID`: request `.MiddleName`, payload `.patient.middlename`, FHIR Patient `.name[0].given`.

- [ ] **Step 5: Write `tests/overrides/audit-corrected-name.json`** and the allowed entry `fault: "middle-name"` for those three paths in generic form.

- [ ] **Step 6: Run everything.** `cargo test`, `cargo clippy --all-targets`, `cargo build --release --target wasm32-wasip1` Expected: PASS, no warning, exit 0.

- [ ] **Step 7: Commit.** `git commit -m "fix: a patient keeps a middle name"`

---

### Task 8: The counts on real requests (the controller's task)

The controller runs this, not an implementer. It needs the operator's yes for a read-only login in `openldr-mssql`, created for the run and dropped after it.

- [ ] **Step 1: Before Task 2 starts,** dump 20,000 requests with `tools/real-data-check/dump.mjs`, decode them at `main` (`7eef3e3`), and run `compare.py` with no `--allowed`. Expected: every stage identical, as on 2026-11-15. This is the baseline. Keep `ts.ndjson`.
- [ ] **Step 2: Count for fault 14.** From the baseline's audit stage, count the requests whose only error-level finding is `specimen_missing` and whose `details.specimen_code` is not empty. Print the count only. This is how many records an unknown specimen code holds back by itself.
- [ ] **Step 3: After each of Tasks 2 to 7,** decode the same rows at that task's commit and run `compare.py --allowed tools/real-data-check/allowed-differences.json`. Expected: `result: pass`, and each `allowed` line names only faults fixed so far. A differing path that no entry lists stops the plan: it goes back to the task that owns it.
- [ ] **Step 4: Record** in `docs/real-data-check.md`, in a new section "After the fault fixes": per fault, the requests and fields it moved, and the fault 14 count. Commit as `docs: what each fault fix changes on real requests`.
- [ ] **Step 5: Delete the dumped rows and drop the login.** Confirm both.

---

## What this plan leaves

- Faults 2, 3, 11 and 13 wait for part 3, where v1 says which answer is right.
- Fault 14 waits for the operator's rule, with the count from Task 8 in hand. The `specimen_missing` message is rewritten with it.
- Faults 6 and 15 wait for a site whose data has the trigger. Count both before a new site goes live: test rows with a run number above 200, and test records whose result bytes start or end with a whitespace byte.
- The finding messages stay English. Whether the plugin's page translates a finding by its class is a part 4 question.
