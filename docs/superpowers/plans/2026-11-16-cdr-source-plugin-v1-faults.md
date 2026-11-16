# The four decoder faults that waited for v1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Parked on 2026-11-16.** The operator approved this build, then chose to start part 4 (the check step and screens in CE) first, because the plugin is not usable in CE until part 4 exists. Nothing here is built. No branch exists. Pick it up after part 4, before the 496 requests that fail the check against v1.

**Goal:** The plugin reads the stored age one way, picks between two birth dates and two taken dates by a rule the data supports, and keeps each order's own latest run.

**Architecture:** Four changes in `cdr-source`, each its own task and commit: the age in `src/records.rs`, a mark on a date of birth worked out from the age, the birth and taken rows in `src/request.rs` with one new audit warning, and the order a run belongs to in `src/observations.rs` and `src/payload.rs`. Each states the outputs it moves as override operations and as one value rule in the real-data compare. The controller then runs the branch on real twins, writes the numbers down, and adds the mark's code to CE.

**Tech stack:** Rust (no new dependency), Python 3 (`tools/real-data-check/compare.py`), Node test runner for the tool tests.

**Spec:** `docs/superpowers/specs/2026-11-16-cdr-source-v1-faults-design.md` in `openldr_ce`. Section 8 of it binds the build.

**Repository:** `/home/fredrick/Projects/Repositories/cdr-source`, new branch `v1-faults` from `main` (`cc290ae`).

## Global constraints

- Outside the four stated fixes, the TypeScript toolchain at `/home/fredrick/Projects/Repositories/cdr-toolchain` is still the reference. A change that moves any other output is a defect. Change no file there, and no file in `openldr_ce`.
- A change states every output it moves: override operations in `tests/overrides/<fixture>.json` (`{ fault, stage, path, was, now }`), and a value rule in `tools/real-data-check/compare.py` keyed by the fault's name, with its paths in `allowed-differences.json`. A rule is gated on the request's own raw rows and works out again each value it allows.
- Fault names, used verbatim as rule and override keys: `age-in-days`, `birth-date-estimated`, `birth-date-by-age`, `taken-date-by-collected`, `runs-per-order`.
- An override's `now` is checked by hand from the fixture's own bytes and rows, never pasted from the code's output. The report says how each was checked.
- Fixture files in `tests/fixtures/`, `tests/check-fixtures/` and `tests/data/classify-golden.json` stay byte for byte. Existing override operations do not change; new ones go at the end. Never run or change the fixture generator. Never start a container.
- The v1 check decides what it decided before for every one of the 119 check fixtures. If one moves, stop and report.
- Nothing under `src/` reads the clock, the time zone, the locale, an environment variable or a file. Nothing under `src/` panics on any input. No regex crate.
- The request stage's printed output keeps exactly the old tool's keys.
- A string that leaves the plugin never names the source system. No em dash in any new string.
- No real patient row in the repository. Never connect to `openldr-mssql` or port 1433, never open a `.env`, a `temp/` or `data/` folder, or the scratchpad folder `tw3`.
- Every fault fixed gets its catalogue entry updated in the same change (`docs/fault-catalogue.md`: A9, A10, A11, A12), with the counts from the design's section 2 and a check written as a rule a program could run.
- For every allowed path or rule added to `compare.py`, a test where a wrong value at that path fails the run, and a test where a request the rule expects to move has not moved and fails the run.
- "Whole days" between two dates is the difference of their calendar days. A time of day is ignored.
- No `Co-Authored-By` and no "Generated with" line in any commit. Never push.

## Review focus

1. A record cut short before byte 418: no date of birth from the age, and no panic. (Task 1)
2. Birth or taken rows handed in reverse order: the same answer. (Task 2)
3. A damaged first birth row beside a good second one: the good one is used. (Task 2)
4. A collected date with no time of day, or a damaged collected date, when a birth date is confirmed: confirmed by the day, and nothing confirmed when the collected date does not read. (Task 2)
5. A test code with more order numbers than orders: the spare run joins the last order and its result links there. A code not on the registration at all: today's rule. (Task 4)

---

### Task 1: one reading of the age (fault 11, `age-in-days`)

**Files:**
- Modify: `src/records.rs` (`dob_or_age`, about line 119), `src/site.rs` (one test)
- Modify: `tools/real-data-check/compare.py`, `compare.test.mjs`, `allowed-differences.json`, `README.md` of the tool
- Modify: `tests/overrides/registration-request-facts.json`, `tests/overrides/dates-day-ten-minute-32.json`, and any other fixture that moves
- Modify: `docs/fault-catalogue.md` (A9, A2's note)

**Interfaces:**
- Consumes: `long_datetime` in `src/dates.rs`; a whole-day subtraction (reuse the date arithmetic `js_set` already gives, or `age_days_between`'s parser in `src/payload.rs:476`).
- Produces: `dob_or_age(raw: &[char]) -> String`, same signature. Task 2 relies on a helper it adds here: `pub fn stored_age_days(raw: &[char]) -> Option<u32>` in `src/records.rs`, none when the record is too short to hold byte 418 or the two bytes are 0.

- [ ] **Step 1: write the failing tests** in `src/records.rs`, on records built the way its existing age tests build them. Collected date 03/04/2019 10:00 unless said.

| Test name | Bytes 414, 416, 417, 418 | Expected `DobAge` |
|---|---|---|
| `an_age_in_days_is_taken_off_the_collected_date` | 0, 0, 40, 1 (296 days) | `05/12/2018` |
| `the_days_are_the_whole_age_not_added_to_the_years` | 2, 0, 32, 3 (800 days) | `12/24/2016` |
| `a_typed_age_in_years_gives_an_estimated_date` | 30, 0, 205, 42 (10,957 days) | `03/04/1989` |
| `byte_416_is_not_read` | 0, 10, 0, 0 | empty |
| `an_age_of_years_only_keeps_the_calendar_years` | 2, 10, 0, 0 | `03/04/2017` |
| `a_date_with_no_time_gives_the_same_date_of_birth` | 0, 0, 40, 1, time bytes 0 | `05/12/2018` |
| `a_short_record_gives_no_date_of_birth_from_the_age` | record cut to 418 characters, 414 = 2 | empty |
| `stored_age_days_reads_two_bytes_little_endian` | 417 = 40, 418 = 1 | `Some(296)`; 0, 0 gives none; a short record gives none |

In `src/site.rs`: `the_age_decoder_and_the_site_profile_read_the_same_bytes`: the site's `age_years` offset is 414 and `age_days` is 417.

- [ ] **Step 2: run them, keep the failing output.** `cargo test --lib records`. Expected: the new tests fail.
- [ ] **Step 3: implement.** Years = byte 414, days = `stored_age_days`. No value when both are 0, when there is no collected date, or when the record is too short for byte 418. Days above 0: the collected day minus that many calendar days. Days 0 and years above 0: the collected date minus the calendar years, as the code does today. Print with `mmddyyyy`.
- [ ] **Step 4: run the whole suite.** `cargo test`. Every fixture that fails is a moved output. State each as override operations with fault `age-in-days`. Check each `now` by hand from the fixture's bytes in `tests/generate-fixtures.mts`. Expected to move: `registration-request-facts` (bytes 0, 0, 0, 44, 1: 300 days) and `dates-day-ten-minute-32` (2, 0, 10, 0, 12: 3,072 days). Moved fields: request `DobAge`, payload `patient.date_of_birth`, `age_years_at_received`, `isolates[].patient_age_days`, FHIR `Patient.birthDate`, and date-of-birth findings. A fixture that moves and is not explained by its bytes is a defect.
- [ ] **Step 5: the compare rule `age-in-days`.** Gate: the record holds days above 0 and a collected date, and no birth row gives a date. The rule works the date of birth out again from the raw record bytes and requires the plugin's value at each moved path to equal it. It runs for every request in the gate, whether or not the field differs from the tool, so a fix that stops applying fails. Tests in `compare.test.mjs`: the right value passes; a date one day off fails; the old tool's value in the plugin's output fails; a request outside the gate with a differing date fails.
- [ ] **Step 6: catalogue.** A9: Fix, Count (the design's section 2 tables), State fixed. Add the signal for an estimated date of birth: no birth row AND days = years x 365 or floor(years x 365.25), 314,717 of 850,585 twins. Add the open point: nothing marks an estimated date as estimated.
- [ ] **Step 7: gate and commit.** `cargo test`, `cargo clippy --all-targets`, `cargo build --release --target wasm32-wasip1`, `node --test tools/real-data-check/*.test.mjs tests/fixture-guard.test.mts`. Commit: `fix: the age is years at 414 and whole days at 417 to 418`.

### Task 2: a mark on a date of birth worked out from the age (`birth-date-estimated`)

**Files:**
- Modify: `src/request.rs` (the `Request` struct and where `dob_age` is chosen), `src/site.rs` (`REQUEST_ATTRIBUTES`), `src/payload.rs` (the attributes list, about line 651), `src/fhir.rs` only if the attribute needs it
- Modify: `tools/real-data-check/compare.py`, `compare.test.mjs`, `allowed-differences.json`, the tool's `README.md`
- Modify: the override file of every fixture whose date of birth comes from the age
- Modify: `README.md`, `docs/fault-catalogue.md` (A9's open point closes)

**Interfaces:**
- Consumes: Task 1's `dob_or_age`.
- Produces: `Request` gains `pub dob_from_age: bool`, true when `dob_age` is set and came from the registration's age, false when it came from a birth row or is empty. Not printed by the request stage. `REQUEST_ATTRIBUTES` gains `birth_date_estimated: Some("birth-date-estimated")`, the last in the fixed order.

- [ ] **Step 1: write the failing tests.** In `src/request.rs`: `a_date_of_birth_from_the_age_is_marked` (no birth row, age set: true), `a_date_of_birth_from_a_birth_row_is_not_marked`, `no_date_of_birth_is_not_marked`. In `src/payload.rs`, beside `request_attributes_come_in_the_fixed_order_and_only_with_a_value`: the attribute `{ "code": "birth-date-estimated", "valueBoolean": true }` is last and present only when `dob_from_age`. In `src/fhir.rs`: it leaves on the ServiceRequest as a request-attribute extension with `valueBoolean` true, the same shape as `newborn`. In `src/site.rs`: the code's text.
- [ ] **Step 2: run them, keep the failing output.**
- [ ] **Step 3: implement.**
- [ ] **Step 4: run the whole suite and state what moved.** Fault `birth-date-estimated`. Every fixture whose date of birth comes from the age gains the attribute in the payload and in FHIR, and nothing else. Check each by hand from the fixture: it has no birth row and an age.
- [ ] **Step 5: the compare rule `birth-date-estimated`.** For every request, work out again from the raw rows and record bytes whether the date of birth comes from the age. The attribute must be present in the payload and in FHIR exactly when it does, with value true, and it is the only thing the rule allows. Tests: present when it should be passes; missing when it should be there fails; present on a request with a birth row fails; a value other than true fails.
- [ ] **Step 6: catalogue and README.** A9: the open point "nothing marks an estimated date" is closed by this attribute. README: the attribute and what it means.
- [ ] **Step 7: gate and commit**, as in Task 1. Commit: `feat: a date of birth worked out from the age is marked on the request`.

### Task 3: two birth dates and two taken dates (faults 2 and 3)

**Files:**
- Modify: `src/request.rs` (the birth and taken rows, about lines 470 to 478; the `Request` struct), `src/audit.rs` (one rule), `src/decode.rs` only if a caller changes
- Modify: `tools/real-data-check/compare.py`, `compare.test.mjs`, `allowed-differences.json`, the tool's `README.md`, `tools/real-data-check/dump-twins.mjs` and its test
- Modify: `tests/overrides/birth-row.json`, `tests/overrides/taken-from-index.json`
- Modify: `README.md` (the findings list), `docs/fault-catalogue.md` (A10, A11, one new F entry)

**Interfaces:**
- Consumes: `stored_age_days` from Task 1; `dob_from_age` from Task 2 (a date taken from a birth row is not from the age); `birth_date` and `date_only` in `src/request.rs`; the registration's collected date.
- Produces: `Request` gains `pub birth_dates_disagree: Option<BirthDatesDisagree>` with `pub struct BirthDatesDisagree { pub dates: Vec<String>, pub age_days: Option<u32> }`, dates as `YYYY-MM-DD`, earliest first. It is not printed by the request stage. The audit reads it.

- [ ] **Step 1: write the failing tests** in `src/request.rs`, with the existing helper `decoded_with_births` and a like one for taken rows. Use made-up dates. Collected date 03/04/2019.

Birth dates:
- `the_birth_date_the_stored_age_confirms_is_taken`: stored days 300, rows 2018-05-08 and 2017-01-01. `DobAge` is `05/08/2018`. No `birth_dates_disagree`.
- `birth_rows_in_any_order_give_the_same_date`: the same rows reversed give the same.
- `with_no_birth_date_confirmed_the_earliest_is_taken`: stored days 300, rows 2018-06-01 and 2017-01-01. `DobAge` is `01/01/2017`. `birth_dates_disagree` holds `["2017-01-01", "2018-06-01"]` and `Some(300)`.
- `with_nothing_to_confirm_with_the_earliest_is_taken_and_it_is_noted`: stored days 0. Earliest, and `birth_dates_disagree` holds the dates and `None`.
- `two_birth_rows_on_one_day_are_one_date`: 1990-05-06T08:00 and 1990-05-06T13:45. `05/06/1990`, nothing noted.
- `a_damaged_first_birth_row_does_not_hide_a_good_one`: a row `birth_date` rejects, then 1990-05-06. `05/06/1990`.
- `every_birth_row_damaged_falls_back_to_the_age`: equals the request decoded with no birth rows.
- `one_birth_date_is_taken_as_before`: one row, stored days that disagree. That row's date, nothing noted.
- `a_collected_date_that_does_not_read_confirms_nothing`.

Taken dates:
- `the_taken_row_on_the_collected_day_is_taken`: registration taken date empty, rows 2019-03-09 and 2019-03-04. Taken is the 2019-03-04 value.
- `with_no_taken_row_on_the_collected_day_the_earliest_is_taken`: rows 2019-03-09 and 2019-03-06 give 2019-03-06.
- `taken_rows_in_any_order_give_the_same_date`.
- `the_registrations_own_taken_date_still_wins`.
- `a_damaged_taken_row_is_skipped`.
- `dates_sort_by_number_not_by_text`: years 0999 and 2019 give 0999 as the earliest.

In `src/audit.rs`:
- `birth_dates_disagree_is_a_warning_and_comes_last`: class `birth_dates_disagree`, severity warn, after `dates_out_of_order`, details keys `dates` and `age_days`, message `"The request has more than one date of birth and its stored age confirms none of them."`.
- Through `source_decode`: `held` is false when it is the only finding above info.

- [ ] **Step 2: run them, keep the failing output.**
- [ ] **Step 3: implement** as the design's sections 5.2, 5.3 and 8 say. Skip damaged rows, take distinct days, sort by year, month and day as numbers. Confirm a birth date when the collected day minus that date, in whole days, equals `stored_age_days`. The first confirmed date wins. None confirmed: the earliest, and set `birth_dates_disagree`.
- [ ] **Step 4: run the whole suite and state what moved.** Faults `birth-date-by-age` and `taken-date-by-collected`. `birth-row` holds 1991-01-01 and 1990-05-06: work out by hand from its record whether either is confirmed, and write what follows. `taken-from-index` holds 2019-03-09 and 2019-03-04 with a collected date: check it by hand. Any other fixture that moves is explained or is a defect.
- [ ] **Step 5: the compare rules.** `birth-date-by-age`: gate, two or more distinct birth days in the raw rows. Work the chosen date and the finding out again from the raw rows and the record bytes; require the plugin's `DobAge`, the paths derived from it, and the finding to equal them; it runs for every request in the gate. `taken-date-by-collected`: gate, an empty registration taken date and two or more distinct taken days. Same shape, for `TakenDateTime`, the payload's taken date and the check's source value. Tests per the global constraint, for both.
- [ ] **Step 6: a way to run chosen requests.** `dump-twins.mjs` gains `--labs-file <path>`: a text file with one lab number per line replaces the sample. Test it in the tool's existing test file with made-up numbers: the parsed arguments hold the path, and the built query filters on the listed numbers through a parameter, never by pasting them into the SQL text.
- [ ] **Step 7: catalogue and README.** A10 and A11: Fix, Count, State. A new F entry, open, nothing built: one birth row that disagrees with the stored age (54 of 882,043), with its check. The plugin's README lists the new warning.
- [ ] **Step 8: gate and commit**, as in Task 1. Commit: `fix: two birth dates are settled by the stored age, two taken dates by the collected day`.

### Task 4: each order keeps its own latest run (fault 13, `runs-per-order`)

**Files:**
- Modify: `src/observations.rs` (`supersede`, about line 379, and its caller at about 534), `src/payload.rs` (`Linker::new`, about line 151), `src/payload_results.rs` (caller, about line 431), `tests/check_golden.rs` (three callers)
- Modify: `tools/real-data-check/compare.py`, `compare.test.mjs`, `allowed-differences.json`, the tool's `README.md`
- Modify: `tests/overrides/panel-ordered-twice-two-runs.json`, `tests/overrides/two-runs.json`
- Modify: `docs/fault-catalogue.md` (A12)

**Interfaces:**
- Consumes: `base_index` in `src/payload.rs:76`, as it is; the request's `test_orders` (one entry per order, repeats included).
- Produces: `pub fn supersede(obs: Vec<Obs>, orders: &[String]) -> (Vec<Obs>, Vec<Superseded>)`. Every caller passes the request's `test_orders`. One shared function, used by `supersede` and by `Linker::new`: `pub fn order_of_base(bases: &[f64], orders: usize, base: f64) -> Option<usize>`, where `bases` is the code's distinct order numbers sorted by the existing `sort_bases`. It gives the position of the order the base belongs to: its own position when that is below `orders`, else `orders - 1`, and none when `orders` is 0.

- [ ] **Step 1: write the failing tests** in `src/observations.rs`, with its existing `obs(code, index, time)` helper.

| Test name | Orders | Run indexes of code P | Kept | Dropped, with `superseded_by` |
|---|---|---|---|---|
| `a_code_ordered_twice_keeps_each_orders_latest_run` | P, P | 1, 2 | 1 and 2 | none |
| `a_rerun_of_one_order_leaves_one_run` | P | 1, 101 | 101 | 1 by 101 |
| `two_orders_each_rerun_keep_one_run_each` | P, P | 1, 101, 2, 102 | 101 and 102 | 1 by 101, 2 by 102 |
| `a_spare_run_joins_the_last_order` | P | 1, 2 | 2 | 1 by 2 |
| `a_spare_run_competes_only_with_the_last_order` | P, P | 1, 2, 3 | 1 and 3 | 2 by 3 |
| `a_code_not_on_the_registration_keeps_the_old_rule` | Q | 1, 2 | 2 | 1 by 2 |
| `one_codes_spare_run_does_not_change_another_code` | P, P, Q | P: 1, 2; Q: 1, 2 | P 1, P 2, Q 2 | Q 1 by 2 |
| `index_100_and_200_share_an_order_number` | P | 100, 200 | the later by the existing comparison | the other |
| `the_dropped_list_is_sorted_by_code_then_index` | P, P, A, A | P: 1, 101; A: 2, 102 | | A 2, then P 1 |

Keep the existing tests green by passing each one orders that fit its intent.

In `src/payload.rs`: `a_spare_runs_result_links_to_the_last_order`: one order of P, runs at 1 and 2; `Linker` gives the order's id for order number 2. `order_of_base`: 3 sorted numbers and 2 orders give positions 0, 1, 1; 0 orders give none.

- [ ] **Step 2: run them, keep the failing output.**
- [ ] **Step 3: implement.** Per test code: its distinct `base_index` values, sorted with `sort_bases`, and the times the code appears in `orders`. The winner key is the code and `order_of_base` of the run's base. With no order of the code, the key is the code alone, as today. `Linker::new` links each base to the order `order_of_base` gives, where it zipped and dropped the surplus before.
- [ ] **Step 4: run the whole suite and state what moved.** Fault `runs-per-order`. Expected: `panel-ordered-twice-two-runs` (both runs kept; order 1's status goes from in progress to final; its report from partial with 0 results to final with 1; the dropped-runs finding goes). `two-runs` (one order, runs 1 and 2) also moves: the later run's result now links to the order, so the payload holds it and the order is final. All 119 check fixtures must give the same verdict; if one does not, stop and report.
- [ ] **Step 5: the compare rule `runs-per-order`.** Gate: from the raw rows, a test code whose runs hold two or more order numbers and that is on the registration at least once (the ordered codes sit in the registration record, 20 slots of 7 bytes from offset 187, the code in the first 5). Observations stage: work the kept runs and the dropped list out again from the old tool's own full list (`observations.all` in `ts.ndjson`) and require the plugin's to equal them. Audit stage: the dropped-runs finding worked out again from that list. Payload and FHIR: allowed only for a gated request; every result, report and status that differs must belong to an order whose kept run differs from the tool's, and every result that appears must be of a run the recompute keeps. It runs for every request in the gate. Tests per the global constraint: a kept run too many fails; one too few fails; a result of a dropped run in the payload fails; a gated request that equals the tool fails; a request outside the gate with a differing kept list fails.
- [ ] **Step 6: catalogue.** A12: Fix, Count (the design's fault 13 table), State fixed, the spare-run rule with its count (283 cases in the whole table, a result in the source on 273), and the open point: a code with no order on the registration (27 cases) keeps the old rule.
- [ ] **Step 7: gate and commit**, as in Task 1. Commit: `fix: each order of a test code keeps its own latest run`.

### Task 5: the branch on real twins, and the code in CE (controller)

- [ ] **Step 1: the operator's yes** to a read-only login for this run, SELECT only on the four restored databases, dropped afterwards, sampled rows deleted.
- [ ] **Step 2: sample.** 20,000 twins with `dump-twins.mjs`, as before, into `scratchpad/tw3/run`. After Task 3: a second folder `tw3/pairs` with every request that has two or more birth days or two or more taken days (at most 412), through `--labs-file`. The list is made by SQL into a file in `tw3` and never printed.
- [ ] **Step 3: run each folder at the branch head:** `decode_file`, `check_file`, `compare.py --allowed`, `decode_file --page 500 <dir>`.
- [ ] **Step 4: read and record.** Requests moved per rule. Held before and after, with every newly held request by cause. Verdicts against v1: passed in both, failed in both, each direction of change; any pass that became a fail is explained or is a defect. How many spare runs joined a last order, and how many codes have no order on the registration. How many requests carry the estimate mark. On `pairs`: confirmed, earliest with a warning, and the taken choice against v1's day.
- [ ] **Step 5: docs.** A section in `docs/real-data-check.md`; real counts into A9, A10, A11, A12; the catalogue copy in `openldr_ce/.superpowers/reports/`. Commit: `docs: the four faults that waited for v1, on real requests`.
- [ ] **Step 6: clean up.** Delete `tw3`. Drop the login and its users. Confirm 0 left and 8 databases online.
- [ ] **Step 7: the code in CE.** On a branch of `openldr_ce`: add `{ "code": "birth-date-estimated", "display": "Date of birth worked out from the stored age" }` to `packages/terminology/codesystems/openldr-request-attribute.json`, after `v1-check`. Run the full gate (`pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`). Ask the operator before merging to `main`, then run `pnpm make:changelog` and commit it.
