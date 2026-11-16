# cdr-source plugin: dates with no time, and dates in order. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A date stored with no time of day leaves the plugin as a date only, and a request whose dates are out of order is saved with a warning that names each pair.

**Architecture:** One change in the decode: the registration's three long dates print with no time when their time bytes are zero. Every later stage already takes a date-only text. One new audit rule compares the steps of a request in order, to the minute when both have a time and by day when either has none. Each change states what it moves, as the earlier fixes do.

**Tech Stack:** Rust (edition 2021, `serde_json`). Node 24 for the tool tests. Python 3 for `compare.py`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-16-cdr-source-dates-design.md`.

**Where the work happens:** `/home/fredrick/Projects/Repositories/cdr-source`, on a new branch `dates` from `main` (`0050173`). No file in `openldr_ce` or `cdr-toolchain` changes.

## Global Constraints

- Outside the plugin's stated fixes, the TypeScript toolchain is still the reference for the decode, the audit, the payload and FHIR. A change that moves any other output is a defect.
- A change states every output it moves: override operations in `tests/overrides/` for the fixtures, and a value rule in `tools/real-data-check/compare.py` keyed by the fault's name, with its paths in `allowed-differences.json`. A rule is gated on the request's own rows and checks each value it allows.
- An override's `now` is justified without the code's help.
- The fixture files in `tests/fixtures/` and `tests/check-fixtures/` and `tests/data/classify-golden.json` stay byte for byte as they are. No task runs the fixture generator or starts a container.
- The v1 check decides what it decided before for every one of the 119 check fixtures.
- Nothing under `src/` reads the clock, the time zone, the locale, an environment variable or a file. Nothing under `src/` panics on any input.
- No real patient row in the repository. A tool that reads real rows prints counts and field names, never a value.
- Only the controller may query the container `openldr-mssql`. An implementer never connects to it or to port 1433, never opens a file under a `temp/` or `data/` folder, and never opens a `.env` file.
- A string that leaves the plugin never names the source system. No em dash in any new string.
- Every fault found or fixed gets its entry in `docs/fault-catalogue.md` in the same change, with the same fields as the others.
- No `Co-Authored-By` line in any commit. Prose follows the `unslop` skill.

## Review Focus

1. **A date with no time beside a date with a time on the same day.** Collected `03/04/2019 10:00`, received `03/04/2019` with no time: in order. Received `03/03/2019` with no time: out of order. Test in Task 3.
2. **Two timed dates one minute apart.** `10:00` then `09:59` the same day is out of order; `10:00` then `10:00` is not. Test in Task 3.
3. **A request with one date, or none.** No pair, no finding, no panic. Test in Task 3.
4. **An order row with an analysis time and no authorisation, and the reverse.** Only the pairs that are both set are compared. Test in Task 3.
5. **A zero-time date that is also the only source of an age.** The date of birth is the date minus years and days; the hours are left alone. Test in Task 2.

---

### Task 1: A date-of-birth finding that appears must hold the birth row's own date

The hole parked as ruling G12 of the v1-check build.

**Files:**
- Modify: `tools/real-data-check/compare.py`, `tools/real-data-check/compare.test.mjs`
- Modify: `docs/fault-catalogue.md` (entry D1)

- [ ] **Step 1: Write the failing tests.** In the file's style, on a made-up folder: under `date-with-no-time`, a `dob_after_specimen_date` finding that appears with a `dob_raw` equal to the request's first dated birth row passes; with any other date two days after the zero-time date it fails; with extra text in its message or another key in its details it fails.
- [ ] **Step 2: Run.** `node --test tools/real-data-check/compare.test.mjs` Expected: the two failing cases pass the run today, so the tests FAIL.
- [ ] **Step 3: Implement.** The rule's facts gain the date of the request's first birth row that holds one, read from `raw.ndjson`. A finding of a date-of-birth class that appears must have `dob_raw` equal to that date or to the gained date of birth the rule already works out, a message that is the plugin's own text for that class with those values, and no detail key the plugin's rule does not write. Read `src/audit.rs` for the message and the keys.
- [ ] **Step 4: Run all tool tests.** Expected: PASS.
- [ ] **Step 5: Update entry D1 of the catalogue**, and commit. `git commit -m "fix: a date-of-birth finding that appears must hold the birth row's date"`

---

### Task 2: A date with no time of day leaves as a date only

Design section 5, "The date" and "The age".

**Files:**
- Modify: `src/dates.rs`, `src/records.rs`, their tests, `tests/golden.rs` (the in-memory test that zeroes each fixture's time bytes), `tools/real-data-check/compare.py`, `tools/real-data-check/compare.test.mjs`, `tools/real-data-check/allowed-differences.json`, `tools/real-data-check/README.md`, `docs/fault-catalogue.md` (entries A1, F1)

**Interfaces:**
- `Registration.collected`, `.received_in_lab` and `.registered` hold `MM/DD/YYYY` when the field's time bytes are both zero, and `MM/DD/YYYY HH:MM` otherwise. No caller's type changes.

- [ ] **Step 1: Write the failing tests.**

```rust
// src/records.rs
#[test]
fn a_registration_date_with_a_zero_time_prints_with_no_time() {
    // collected 159..165, received in lab 666..670 with its time at 154..156, registered 126..130
    // with its time at 132..134. Date 4 March 2019 and a zero time: "03/04/2019" in each.
    // The same date with the time 10:05: "03/04/2019 10:05".
}

#[test]
fn an_age_in_hours_is_ignored_when_the_collected_date_has_no_time() {
    // collected 03/04/2019 with a zero time, bytes 414 = 0, 416 = 0, 418 = 5: dob_age is "03/04/2019"
    // the same with the time 10:00: dob_age is "03/04/2019", five hours before 10:00
    // collected 03/04/2019 with a zero time, 414 = 30, 418 = 5: dob_age is "03/04/1989"
}
```

  And in `src/payload.rs` and `src/fhir.rs`: a request whose collected date is `03/04/2019` with no time gives `collected_datetime` `2019-03-04` in the payload and `collectedDateTime` `2019-03-04` in FHIR, with no time and no zone.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `long_datetime` keeps returning the date at 00:00 and also says whether the time was recorded. `datetime_value` prints with `mmddyyyy` when it was not. `dob_or_age` skips the hours when it was not.
- [ ] **Step 4: Run the golden tests.** No fixture holds a zero-time date, so no fixture may move. Update the in-memory golden test that zeroes each fixture's time bytes to expect the date-only form at each path it lists, and list any path it now shows that it did not.
- [ ] **Step 5: The v1 check.** Add a unit test in `src/check_request.rs`: a source collected date of `03/04/2019` with no time against a v1 specimen time of `2019-03-04T00:00:00.000` is a match, and against `2019-03-05T00:00:00.000` is a mismatch. Run `cargo test --test check_golden`: all 119 as before.
- [ ] **Step 6: The real-data rule.** The `date-with-no-time` rule now expects the record's zero-time date in the date-only form of the stage: `MM/DD/YYYY` in the request, `YYYY-MM-DD` in the payload and FHIR, with no time and no zone. A value at `00:00` now fails. Tests for both.
- [ ] **Step 7: Run everything.** `cargo test`, `cargo clippy --all-targets`, `cargo build --release --target wasm32-wasip1`, the tool tests. Expected: PASS.
- [ ] **Step 8: Update the catalogue** (A1's open point is closed; F1's cause of the 176 is fixed) and commit. `git commit -m "fix: a date with no time of day leaves as a date only"`

---

### Task 3: A request whose dates are out of order carries a warning

Design section 5, "The rule".

**Files:**
- Modify: `src/audit.rs`, `src/payload.rs` (only to share how an order row's analysis and authorisation times are read), `src/decode.rs`, `tests/golden.rs`, `tools/real-data-check/compare.py`, `tools/real-data-check/compare.test.mjs`, `tools/real-data-check/allowed-differences.json`, `README.md`, `docs/fault-catalogue.md` (entry F1)
- Create: override files under `tests/overrides/` for each fixture that gains the finding

**Interfaces:**
- A finding of class `dates_out_of_order`, severity warn. Message: `N pair(s) of dates are out of order.` Details: `pairs`, a list of `{ "earlier": step, "later": step, "earlier_value": text, "later_value": text, "test_code": text or absent }`, in the order the steps are compared. Step names: `specimen`, `received`, `registered`, `analysed`, `authorised`.
- The finding is added after every existing finding, so no existing finding changes its place.
- `audit` takes the site profile, from which it reads what it read before and how to find an order row's two times.

- [ ] **Step 1: Write the failing tests** in `src/audit.rs`, one per line of the Review Focus and these:

```rust
#[test]
fn dates_in_order_give_no_finding() {}

#[test]
fn every_pair_that_is_out_of_order_is_listed_once_with_both_values() {
    // specimen 03/04/2019 10:00, received 03/03/2019 09:00, registered 03/03/2019 08:00:
    // three pairs: specimen-received, specimen-registered, received-registered
}

#[test]
fn an_order_row_pair_names_its_test_code() {}

#[test]
fn the_finding_is_a_warning_and_never_holds_the_request() {
    // through source_decode: held false, resources present, the finding in findings
}

#[test]
fn the_specimen_step_is_the_collected_date_else_the_taken_date() {}
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the rule.** A step's value is the text the request holds. A value with a time compares to the minute; a value with no time compares by day, and a pair with one such value compares by day. A text that is not a date is no step. The analysis and authorisation times of an order row come from the function the payload uses, so both stages read the same header bytes.
- [ ] **Step 4: Run the golden tests** and list every fixture that gains the finding, with its pairs. For each, check the pairs by hand against the fixture's dates in `tests/generate-fixtures.mts`, then write the override operations under the fault name `dates-out-of-order`: the audit's findings and its `max_severity` where it rises, and the payload's `data_quality` copy. A fixture that gains a pair you cannot explain is reported, not overridden.
- [ ] **Step 5: The real-data rule.** A finding of the class `dates_out_of_order` may appear only when the compare tool, working the pairs out again from the plugin's own payload for that request by the rule of Step 3, gets the same pairs with the same values. Then `max_severity` may rise to warn and the payload's `data_quality` block may appear or grow by that finding. Tests: the right pairs pass; a missing pair, an extra pair, a wrong value and a finding on a request whose dates are in order each fail.
- [ ] **Step 6: Run everything.** Expected: PASS.
- [ ] **Step 7: Update the catalogue** (F1 is now an audit rule) and the README's list of findings, and commit. `git commit -m "feat: a request whose dates are out of order carries a warning"`

---

### Task 4: The counts on real requests (the controller's task)

It needs the operator's yes for a read-only login with SELECT on the three source databases and on the restored v1 database, created for the run and dropped after it.

- [ ] **Step 1: Dump 20,000 real twins** with `dump-twins.mjs`. Expected: 0 failed in the toolchain.
- [ ] **Step 2: Run** `decode_file`, `check_file` and `compare.py --allowed`. Expected: result pass; the check alone identical on every request; no verdict of the v1 check differs from the run of this morning's branch head (13,543 passed in both, 496 failed in both, 5,961 failed in the tool and passed in the plugin).
- [ ] **Step 3: Count.** Order rows with each pair out of order, before and after. Requests that carry the new warning. Requests held, before and after: the number must not rise.
- [ ] **Step 4: Record** in `docs/real-data-check.md` and the catalogue, delete the dumped rows, drop the login. Commit as `docs: dates with no time and dates in order, on real requests`.
