# The 56 requests that still fail the check against v1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plugin keeps a result "Information missing"; the check pairs text lines with the format marks set aside when today's pairing fails, takes any of the source's panels as the request's panel, and reads v1's yen sign as a backslash and runs of spaces as one.

**Architecture:** Four changes in `cdr-source`, each its own task and commit. One is in the decoder (`src/observations.rs`). Three are in the check (`src/check_results.rs`, `src/check_request.rs`, `src/check_cmp.rs`). Every check change runs only after today's comparison fails and wins only on a full match. A fifth task, the controller's, runs both real samples.

**Tech stack:** Rust (no new dependency), Python 3 (`tools/real-data-check/compare.py`), Node test runner for the tool tests.

**Spec:** `docs/superpowers/specs/2026-11-16-cdr-source-check-leftovers-design.md` in `openldr_ce`. Section 5 binds the build. Section 2 holds the real counts.

**Repository:** `/home/fredrick/Projects/Repositories/cdr-source`, new branch `check-leftovers` from `main` (`893e6d9`).

## Global constraints

- Every constraint of `docs/superpowers/plans/2026-11-16-cdr-source-check-failures.md`, section "Global constraints", holds here, with these changes.
- Fault names, used verbatim as rule and override keys: `information-missing-kept`, `pairs-marks-aside`, `panel-among-source-panels`, `yen-and-spaces`.
- Catalogue entries: one new entry per fault, numbered from the next free number in `docs/fault-catalogue.md`, added in the same change as each fix, each with a runnable check.
- The check may decide differently from the old tool in these three new stated ways, beside the ones already listed in the tool's README. Each of the 119 check fixtures whose verdict or output moves is listed in the report with the reason. Any other move of the check is a defect: stop and report.
- No check change may turn a match into a mismatch. Each one runs after today's comparison is not a match, and is taken only when it gives a match.
- The stored text of a result is never changed. Nothing strips, trims or rewrites a value for a mark, a yen sign or a run of spaces.
- The yen sign is U+00A5 and the backslash is U+005C. A run of spaces is two or more U+0020. No other character is treated as equal to another.
- "Information missing" is matched as `flatten` matches it today: trimmed, case ignored.

## Review focus

1. A text bucket where two lines are equal once the marks are aside: each v1 row is still used once. (Task 2)
2. A bucket that today's pairing passes: its rows and order do not change. (Task 2)
3. A request whose first panel is in v1: the field shows the first panel, as today. (Task 3)
4. "Information missing" in a coded slot and in a text slot: both are kept, with the coded value. (Task 1)
5. A yen sign in the SOURCE text against a backslash in v1: not a match. Only v1's yen is read as a backslash. (Task 4)

---

### Task 1: a result "Information missing" is kept (`information-missing-kept`)

**Files:**
- Modify: `src/observations.rs` (`is_information_missing` at line 296 and its use at line 330; the test near line 950)
- Modify: `tools/real-data-check/compare.py` (the same drop near line 1963), `compare.test.mjs`, `allowed-differences.json`, the tool's `README.md` (line 356 names the drop)
- Modify: `tests/overrides/*.json` for each fixture that moves; `docs/fault-catalogue.md`

- [ ] **Step 1: failing tests.** In `src/observations.rs`, made-up values.

| Test name | Item | Expected in `flatten(req, false)` |
|---|---|---|
| `information_missing_is_kept` | text ` Information MISSING `, resulted | one row, `value_str` `Information MISSING` |
| `information_missing_in_a_coded_slot_is_kept` | coded type, raw value `12`, text `Information missing`, resulted | one row, raw value `12` |
| `an_unresulted_information_missing_is_still_dropped` | text `Information missing`, not resulted, not coded | no row |
| `a_stray_status_flag_is_still_dropped` | as the existing case | no row |

- [ ] **Step 2: run them, keep the failing output.**
- [ ] **Step 3: implement.** Remove `is_information_missing` and its use. Change the existing test `flatten_drops_what_the_toolchain_drops` to say what is now kept.
- [ ] **Step 4: the fixtures.** List each decode fixture whose output moves, with the reason, under `information-missing-kept`.
- [ ] **Step 5: the compare tool.** Rule `information-missing-kept` for the observations, audit, payload, fhir and both check stages: gate on a request with an item whose trimmed text is "information missing", case ignored; rebuild the tool's output with that row kept; require the plugin's output to equal it. A "not held" line as the other rules have. Tests for the rule alone and beside `format-marks` and `number-not-comment`.
- [ ] **Step 6: catalogue and docs.** New catalogue entry, with the count from the spec (3 rows in 20,000, v1 holds all 3). Amend the README line that lists what is dropped.
- [ ] **Step 7: commit.** `fix: a result "Information missing" is kept, not dropped`

### Task 2: the pairing of text lines tries the marks set aside (`pairs-marks-aside`)

**Files:**
- Modify: `src/check_results.rs` (`align_bucket` near line 501, `result_matches` near line 491, `diff_results` near line 758)
- Modify: the compare tool's four files; `docs/fault-catalogue.md`

**Interfaces:**
- Consumes: `without_format_marks` (`src/check_cmp.rs:152`), `latest_pairs` and `v1_rows_match` (`src/check_results.rs`).
- Produces: a second match test for `align_bucket` that sets the marks aside. Its name and shape are the builder's choice; say them in the report.

- [ ] **Step 1: failing tests.** One panel and parameter of text lines, made-up words. `^B` is a mark.

| Test name | Source lines, in order | v1 lines, by sub id | Expected |
|---|---|---|---|
| `a_marked_line_keeps_its_own_v1_line` | `Alpha`, `^BBeta`, `Gamma`, `Delta` | `Alpha`, `Beta`, `Gamma`, `Delta` | all four match, in this order; the check passes |
| `a_marked_first_line_keeps_its_own` | `^BAlpha`, `Beta` | `Alpha`, `Beta` | both match |
| `equal_lines_once_marks_are_aside_use_each_v1_row_once` | `^BSame`, `Same` | `Same`, `Same` | both match, each v1 row used once |
| `a_bucket_that_passes_today_is_not_touched` | `Alpha`, `Beta` | `Alpha`, `Beta` | output byte-equal to today's |
| `a_line_that_differs_still_fails` | `Alpha`, `^BBeta` | `Alpha`, `Other` | today's pairing stands; `Beta` against `Other` is a mismatch |
| `the_latest_rows_pairing_still_wins_where_it_fits` | the existing P15 cases | as today | as today |

Also one test that reproduces the real shape: five lines, the second holds a mark, and today's pairing gives a shifted, failing bucket. Show today's output as the red.

- [ ] **Step 2: run them, keep the failing output.**
- [ ] **Step 3: implement.** In `diff_results`, per bucket: today's pairing; if a row holding a v1 row is not a match, the latest-rows pairing as today; if still none wins, `align_bucket` with the marks set aside in the match test. Take a later pairing only when `v1_rows_match` holds for it. Otherwise today's pairing stands.
- [ ] **Step 4: the 119 check fixtures.** List each that moves. Expected: none.
- [ ] **Step 5: the compare tool.** The check and check-alone stages allow this under `pairs-marks-aside`: gate on a text-line bucket with a format mark where the tool's pairing leaves a v1 row not a match; work the pairing out again; require the plugin's check to equal it. A "not held" line. Tests, and one beside `format-marks`.
- [ ] **Step 6: catalogue and READMEs.** New entry with the counts from the spec (26 groups, 25 agree, none broken, of 2,200). Both READMEs say how the pairing decides, in the three attempts.
- [ ] **Step 7: commit.** `fix: the check pairs text lines with the format marks set aside when the stored text fails`

### Task 3: the request's panel code is any of the source's panels (`panel-among-source-panels`)

**Files:**
- Modify: `src/check_request.rs` (the `panel_code` definition at line 224, `SourceFields`, and where `first_panel` is filled)
- Modify: the compare tool's four files; `docs/fault-catalogue.md`

- [ ] **Step 1: failing tests.** Made-up codes.

| Test name | Source panels, in order | v1 panels | Expected `panel_code` |
|---|---|---|---|
| `the_first_panel_in_v1_matches_as_today` | `A`, `B` | `a`, `b` | match, source `A`, output byte-equal to today's |
| `a_later_panel_in_v1_matches` | `A`, `B`, `C` | `b`, `c` | match, source `B` |
| `no_panel_in_v1_is_a_mismatch_on_the_first` | `A`, `B` | `x` | mismatch, source `A`, v1 `x`, as today |
| `no_v1_panel_is_only_in_the_source` | `A`, `B` | none | only in the source, source `A`, as today |
| `no_source_panel_is_as_today` | none | `x` | as today (pin today's output) |

- [ ] **Step 2: run them, keep the failing output.**
- [ ] **Step 3: implement.** Keep the first-panel comparison. Only when it is not a match, try the source's other panels in the request's order against the same v1 list, with the same rule. Take the first that matches. The note says which v1 panel it matched, as the existing note does.
- [ ] **Step 4: the 119 check fixtures.** List each that moves, with the reason.
- [ ] **Step 5: the compare tool.** Rule `panel-among-source-panels` in the check and check-alone stages: gate on a request whose first panel is not among v1's panels and another of its panels is; require the plugin's `panel_code` row and the request summary to equal the rebuild. Layer 3 no longer counts such a request as a verdict the tool and plugin must share. Tests.
- [ ] **Step 6: catalogue.** New entry with the count from the spec (10 requests; on all 10 every v1 panel is one of the source's).
- [ ] **Step 7: commit.** `fix: the check takes any of the source's panels as the request's panel when the first is not in v1`

### Task 4: v1's yen sign is a backslash, and runs of spaces are one (`yen-and-spaces`)

**Files:**
- Modify: `src/check_cmp.rs` (`string_ci_loose` at line 157, beside `without_format_marks`)
- Modify: `src/check_results.rs` and `src/check_request.rs` only where they call the loose comparison
- Modify: the compare tool's four files; `docs/fault-catalogue.md`

**Interfaces:**
- Produces: `pub fn yen_and_spaces_aside(source: &str, v1: &str) -> (String, String)` in `src/check_cmp.rs`: v1's U+00A5 becomes U+005C, and on both sides a run of two or more spaces becomes one space.

- [ ] **Step 1: failing tests.** Made-up texts. `\` is U+005C and `¥` is U+00A5.

| Test name | Source | v1 | Expected |
|---|---|---|---|
| `a_yen_sign_in_v1_is_a_backslash` | `1\2` | `1¥2` | match |
| `a_trailing_yen_and_space_in_v1` | `Word\` | `Word¥ ` | match |
| `a_yen_sign_in_the_source_is_not_a_backslash` | `1¥2` | `1\2` | mismatch |
| `runs_of_spaces_are_one_space` | `a   b  c` | `a b c` | match |
| `runs_of_spaces_in_v1_too` | `a b` | `a   b` | match |
| `a_match_as_stored_is_not_touched` | `a b` | `a b` | output byte-equal to today's |
| `another_character_is_still_a_mismatch` | `a?b` | `aºb` | mismatch |
| `a_marked_line_with_a_yen_sign` | `^B1\2` | `1¥2` | match (marks and yen both set aside) |

Plus `yen_and_spaces_aside` on its own: the eight inputs above give the texts you expect, and a text with neither comes back unchanged.

- [ ] **Step 2: run them, keep the failing output.**
- [ ] **Step 3: implement.** In the loose comparison, after the stored texts fail and after the marks-aside attempt for a text line, compare once more with `yen_and_spaces_aside` applied on top. Take it only on a match. The reason text says in plain words that a yen sign or a run of spaces was set aside.
- [ ] **Step 4: the 119 check fixtures.** List each that moves. Expected: none.
- [ ] **Step 5: the compare tool.** Rule `yen-and-spaces` in the check and check-alone stages: gate on a field where v1's text holds U+00A5 or either side holds a run of spaces; rebuild; require equality. A "not held" line. Tests, and one beside `format-marks` and `pairs-marks-aside`.
- [ ] **Step 6: catalogue.** New entry with the counts from the spec (9 requests for the yen sign, 2 for the spaces; the raw byte is 0x5C on every one).
- [ ] **Step 7: commit.** `fix: the check reads v1's yen sign as a backslash and runs of spaces as one`

### Task 5: the real run (the controller, not the build session)

- [ ] Run both samples at the branch head with `compare.py --explain`.
- [ ] Expected on the 20,000: the check fails 7; no request that passes at `893e6d9` fails; no request passes in the old tool and fails in the plugin; `information-missing-kept` allows 3 requests; every stage but the whole-plugin check has no difference without a rule.
- [ ] Expected on the 326: the check fails 0.
- [ ] Send the counts to the build session for `docs/real-data-check.md` and the catalogue.
