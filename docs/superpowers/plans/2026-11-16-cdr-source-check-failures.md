# The requests that fail the check against v1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plugin files registration frame 11 as clinical information and reads a numeric result from its own bytes; the check pairs v1's rows with the latest runs and does not fail a line for a format mark.

**Architecture:** Four changes in `cdr-source`, each its own task and commit. Two are in the decoder (`src/request.rs`), two in the check (`src/check_results.rs`, `src/check_cmp.rs`) with one new audit finding. Each states the outputs it moves, as the four earlier faults did. A fifth task, the controller's, runs both real samples and counts what is left.

**Tech stack:** Rust (no new dependency), Python 3 (`tools/real-data-check/compare.py`), Node test runner for the tool tests.

**Spec:** `docs/superpowers/specs/2026-11-16-cdr-source-check-failures-design.md` in `openldr_ce`. Section 5 binds the build. Section 2 holds the real counts.

**Repository:** `/home/fredrick/Projects/Repositories/cdr-source`, new branch `check-failures` from `main` (`726924a`).

## Global constraints

- Every constraint of `docs/superpowers/plans/2026-11-16-cdr-source-plugin-v1-faults.md`, section "Global constraints", holds here, with these changes.
- Fault names, used verbatim as rule and override keys: `frame-11-clinical-info`, `number-not-comment`, `pairs-latest-runs`, `format-marks`.
- Catalogue entries, added in the same change as each fix: A13 (frame 11), A14 (a number read from a comment), A15 (format marks). The pairing fix closes the open point of A12; say so there and do not add an entry.
- The check may now decide differently from the old tool, in two stated ways only: `pairs-latest-runs` and `format-marks`. Each check fixture among the 119 whose verdict or output moves is listed in the report with the reason. Any other move of the check is a defect: stop and report.
- The stored text of a result is never changed. No task strips, trims or rewrites a result's value because of a format mark.
- The marks are exactly `^B`, `^S` and `^I`: a caret and one of those three capital letters.
- "Shaped like an ICD-10 code" means: one ASCII letter of either case, two digits, then nothing or a point and one or two digits. A text is code-shaped when it has at least one part and every part is. Parts are split on commas, semicolons, slashes and spaces.

## Review focus

1. Frame 11 with a code and a word ("A09 fever"): clinical information, no code. (Task 1)
2. Frame 11 and frame 12 both filled: both texts are kept, and neither is lost. (Task 1)
3. A numeric slot whose bytes spell a comment code and that also has a text row: the text row still wins, as today. (Task 2)
4. A coded (not numeric) slot with the same bytes: the comment is still looked up. (Task 2)
5. The plugin keeps three runs and v1 two: v1's rows meet the last two. v1 keeps more than the plugin: pairing as today. (Task 3)

---

### Task 1: frame 11 is clinical information (`frame-11-clinical-info`)

**Files:**
- Modify: `src/request.rs` (the frame match near line 374, `f.icd10`, and where `clinical_diagnosis_text` is built near line 608)
- Modify: the files that carry the diagnosis text and the ICD-10 code into the payload and FHIR, if their inputs change
- Modify: `tools/real-data-check/compare.py`, `compare.test.mjs`, `allowed-differences.json`, the tool's `README.md`
- Modify: `tests/overrides/*.json` for each fixture that moves; `docs/fault-catalogue.md` (A13)

**Interfaces:**
- Produces: `pub fn is_icd10_shaped(text: &str) -> bool` in `src/request.rs` or `src/text.rs`.
- The request stage keeps the old tool's keys. The frame 11 text goes out under the existing diagnosis-text key, after the frame 12 text when both exist, joined the way the check already joins the texts it compares with `ClinicalInfo` (`src/check_request.rs:219-222`). Report how that join works.

- [ ] **Step 1: failing tests.**

| Test name | Frame 11 text | Frame 12 text | ICD-10 | Diagnosis text |
|---|---|---|---|---|
| `a_free_text_in_frame_11_is_clinical_information` | `Fever and cough` | empty | none | `Fever and cough` |
| `a_code_in_frame_11_stays_a_code` | `A09` | empty | `A09` | none |
| `a_code_with_a_decimal_stays_a_code` | `b20.1` | empty | `b20.1` | none |
| `two_codes_stay_codes` | `A09, B20.1` | empty | `A09, B20.1` | none |
| `a_code_and_a_word_are_clinical_information` | `A09 fever` | empty | none | `A09 fever` |
| `both_frames_keep_both_texts` | `Cough` | `Pneumonia` | none | both, frame 12 first |
| `a_blank_frame_11_gives_nothing` | spaces and NULs | empty | none | none |

Plus `is_icd10_shaped`: true for `A09`, `a09`, `B20.1`, `B20.12`, `A09;B20`; false for empty, `A9`, `A091`, `B20.`, `B20.123`, `AB1`, `A09 fever`, `09A`.

- [ ] **Step 2: run them, keep the failing output.**
- [ ] **Step 3: implement.** One helper decides the shape. Nothing else about frame 11 or frame 12 changes.
- [ ] **Step 4: run the whole suite.** State each moved fixture output as override operations with fault `frame-11-clinical-info`. Check each `now` by hand from the fixture's own rows.
- [ ] **Step 5: the compare rule.** Gate: the request has a frame 11 text row whose text is not blank and not code-shaped. The rule works the text out again from the raw row and requires the plugin's diagnosis text to hold it and the plugin's ICD-10 code to be empty, at every stage that shows them. Tests: a wrong text fails; a gated request that did not move fails.
- [ ] **Step 6: catalogue A13**, with the counts of the design's section 2.1 and the check as a rule a program could run.
- [ ] **Step 7: commit.** `fix: the text of registration frame 11 is clinical information, a code only when shaped like one`

### Task 2: a numeric result is read from its own bytes (`number-not-comment`)

**Files:**
- Modify: `src/request.rs` (`result_item`, near line 412)
- Modify: the compare tool's four files; `tests/overrides/*.json`; `docs/fault-catalogue.md` (A14)

- [ ] **Step 1: failing tests**, on a dictionary where the parameter has comment context 2 and context 2 has a comment with code `zC` and text `Clumped`:

| Test name | Type | Raw bytes | Text row | Expected value |
|---|---|---|---|---|
| `a_whole_number_is_not_looked_up_as_a_comment` | 1 | `00 00 7A 43 00` | none | number 250 |
| `an_accounting_number_is_not_looked_up_either` | 2 | `00 00 7A 43 00` | none | number 250 |
| `a_coded_result_is_still_looked_up` | a coded type the file already tests | the bytes of `zC` | none | text `Clumped` |
| `a_text_row_still_replaces_a_numeric_result` | 1 | `00 00 7A 43 00` | `Haemolysed` | as today (pin today's output) |
| `a_number_with_no_comment_of_that_code_is_unchanged` | 1 | `00 00 48 42 00` | none | number 50 |

- [ ] **Step 2 to 4:** as in Task 1, fault `number-not-comment`.
- [ ] **Step 5: the compare rule.** Gate: a kept result of type 1 or 2 whose raw bytes, NULs removed and trimmed, are a comment code in the parameter's context (use `dict.json`, as the runs gate reads it), and no text row for that slot. The rule reads the float from the raw bytes and requires the plugin's number, and every text printed from it, to equal that. Tests as in Task 1.
- [ ] **Step 6: catalogue A14**, counts from the design's section 2.2.
- [ ] **Step 7: commit.** `fix: a numeric result is read from its own bytes, never from a comment of the same code`

### Task 3: the check pairs v1's rows with the latest runs (`pairs-latest-runs`)

**Files:**
- Modify: `src/check_results.rs` (the buckets near lines 589 to 680)
- Modify: the compare tool's four files; `tests/overrides/*.json` or the check fixtures' stated moves; `docs/fault-catalogue.md` (A12)

- [ ] **Step 1: failing tests.** One panel and parameter, numbers made up.

| Test name | Plugin's kept runs, in bucket order | v1's rows | Expected |
|---|---|---|---|
| `v1_with_one_row_meets_the_latest_run` | 4.1, then 5.2 | 5.2 | 5.2 matches; 4.1 is only in the source; the check passes |
| `v1_with_two_rows_meets_the_last_two_of_three` | 1, 2, 3 | 2, 3 | 2 and 3 match; 1 is only in the source |
| `the_same_count_pairs_as_before` | 1, 2 | 1, 2 | both match |
| `v1_with_more_rows_pairs_as_before` | 5 | 4, 5 | as today (pin today's output, the overflow row included) |
| `a_latest_run_that_differs_still_fails` | 4.1, then 5.2 | 6.0 | 5.2 against 6.0 is a mismatch; the check fails |

- [ ] **Step 2: run them, keep the failing output.**
- [ ] **Step 3: implement.** Only the bucket where the plugin has more rows than v1 changes: v1's rows meet the plugin's last rows in the bucket's existing order. The earlier rows are reported as only in the source, with a reason in plain words that names no system.
- [ ] **Step 4: the 119 check fixtures.** List each whose verdict or output moves, with the reason. Expected: only fixtures built for the runs fault.
- [ ] **Step 5: the compare tool.** The check stage and the check-alone layer allow this difference under `pairs-latest-runs`: gate on a bucket where the plugin's kept rows outnumber v1's; work the pairing out again; require the plugin's check to equal it. Layer 3 no longer fails on a request that the old tool passed and the plugin failed only for this pairing; it still fails on any other such request. Tests for both.
- [ ] **Step 6: catalogue A12.** Close the open point, with the 52 rows and the 12 requests.
- [ ] **Step 7: commit.** `fix: the check pairs v1's rows with the latest runs when the source kept more`

### Task 4: format marks are set aside by the check and flagged (`format-marks`)

**Files:**
- Modify: `src/check_cmp.rs` or `src/check_results.rs` (where a text result is compared), `src/audit.rs` (one finding)
- Modify: the compare tool's four files; `tests/overrides/*.json`; `docs/fault-catalogue.md` (A15)

**Interfaces:**
- Produces: `pub fn without_format_marks(text: &str) -> String`, used by the check only. Nothing that stores or prints a result calls it.
- The finding: class `result_text_format_marks`, severity `info`, message `"<n> result line(s) hold format marks."`, details `{ "lines": n, "marks": [...] }` with the marks seen, sorted, each once.

- [ ] **Step 1: failing tests.**

| Test name | Source line | v1 line | Expected |
|---|---|---|---|
| `a_mark_inside_a_line_is_set_aside` | `Smear ^Bnegative^S for cells` | `Smear negative for cells` | match |
| `a_mark_at_the_start_still_matches` | `^BDiagnosis` | `Diagnosis` | match |
| `only_the_three_marks_are_set_aside` | `Grade ^X two` | `Grade two` | mismatch |
| `a_caret_alone_is_text` | `2^3` | `23` | mismatch |
| `text_that_differs_still_fails` | `^BBenign` | `Malignant` | mismatch |
| `the_stored_value_keeps_its_marks` | `Smear ^Bnegative^S` | any | the result's value in the payload and FHIR is `Smear ^Bnegative^S` |
| `a_request_with_marks_gets_one_info_finding` | two lines with marks, one without | | one finding, `lines: 2`, `marks: ["^B", "^S"]`, not held |
| `a_request_without_marks_gets_no_finding` | plain lines | | none |

- [ ] **Step 2 to 4:** as in Task 1, fault `format-marks`. The finding moves the audit stage of every request with a mark; state it.
- [ ] **Step 5: the compare tool.** Gate: a kept text result whose value holds one of the three marks. The rule requires the finding with the right count and marks, and allows the check's text fields to differ from the old tool's only where the two values are equal once the marks are set aside. Tests as in Task 1.
- [ ] **Step 6: catalogue A15**, counts from the design's section 2.4, and the open point that the marks' meaning is a guess.
- [ ] **Step 7: commit.** `feat: a format mark in a text result is set aside by the check and flagged, never removed`

### Task 5: the real run (the controller, not the build session)

- [ ] Run both samples at the branch head with `compare.py --explain`. Expected on the 20,000: the check fails on about 77 requests, where it failed on 436, and no request passes in the old tool and fails in the plugin.
- [ ] Count: requests with the format-marks finding; numeric slots replaced by a text row, and whether their number equals v1's; requests where frame 11 and frame 12 are both filled.
- [ ] Count what is left by cause, as section 2 of the design does, and bring it to the operator.
- [ ] Write the numbers into `docs/real-data-check.md` and the catalogue, or hand them to the build session to write.
