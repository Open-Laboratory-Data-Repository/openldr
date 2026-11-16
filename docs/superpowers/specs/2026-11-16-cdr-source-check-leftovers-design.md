# The 56 requests that still fail the check against v1: design

Date: 2026-11-16. Repository: `cdr-source`, from `main` at `893e6d9`.
This follows `2026-11-16-cdr-source-check-failures-design.md`, which took the failures from 436 to 56.

## 1. Intent

On a sample of 20,000 lab-system requests with a v1 twin, the plugin's check fails 56. Each of the 56
now has a cause, counted on the real rows. Four changes clear 49 of them. The other 7 stay failing,
each with a written cause.

## 2. What the real rows show

Counted on 2026-11-16 at `893e6d9`. Counts, codes and field names only.

| Requests | Cause |
|---|---|
| 25 | A text line with a format mark takes the wrong v1 line, and the lines after it shift. |
| 10 | v1 lacks the source's first panel. The check compares the source's first panel with v1's panels. |
| 9 | One character: the source holds a backslash, v1 holds a yen sign. 5 are text results, 4 are clinical infos. |
| 3 | The result is the text "Information missing". The plugin drops the row, v1 keeps it. |
| 2 | A text line with runs of spaces that v1 holds as single spaces. |
| 3 | Clinical info where the source holds `?` and v1 holds `º`. |
| 1 | Clinical info with an apostrophe against a grave accent. |
| 1 | A 3-character frame 11 text shaped like an ICD-10 code. The plugin files it as a code. |
| 1 | One text line where v1 lacks 8 characters. |
| 1 | The source registration record holds no date. v1 holds a registered date. |

Proof for each cause is in `cdr-source/.superpowers/notes/f436-real-data-facts.md`, last section.

- **Pairing.** The sample has 2,200 groups of two or more text lines. In 2,174 the check pairs v1's
  rows in sub-id order. In 26 it does not, and all 26 fail. In each of the 26 the first shifted line
  holds a format mark. Pairing source line k with v1's k-th row, marks set aside, makes 25 agree and
  breaks none.
- **Panel code.** On all 10, every v1 panel is one of the source's panels, every v1 result row
  matches, and no other request field differs.
- **Backslash and yen.** The raw byte in the source is 0x5C on every one.
- **"Information missing".** The sample holds exactly 3 such rows. v1 holds all 3, with a coded value.

## 3. Decisions the operator made on 2026-11-16

1. Build both check fixes: the pairing and the panel code.
2. The plugin keeps a result whose text is "Information missing". It saves the row as stored.
3. The check reads v1's yen sign as a backslash and treats runs of spaces as one space. No other
   one-character allowance.

## 4. Goals and non-goals

Goals:
- The four changes of section 5, each with a stated move of the outputs.
- On the 20,000 the check fails 7 requests, and no request that passes today fails.

Non-goals:
- The 7 that stay. No rule is added for `?` against `º`, the apostrophe, the code-shaped frame 11, the
  line with 8 characters missing, or the request with no dates.
- What the Feedback tab shows for a failed clinical info, where the check prints the source side as
  empty. That is still an open point for the operator.

Anti-goals:
- A check rule that could turn a match into a mismatch.
- Any change to a stored result's text.

## 5. The four changes

### 5.1 The pairing of text lines tries the marks set aside (`pairs-marks-aside`)

`align_bucket` in `src/check_results.rs` pairs each source row with the first free v1 row whose result
matches, on the stored text. A line with a format mark does not match its own v1 line there.

The check keeps today's pairing first. Where it leaves a row that holds a v1 row and is not a match, the
check pairs the bucket again with the format marks set aside in the match test. The bucket takes the
second pairing only if every row that holds a v1 row is then a match. This is the same shape as the
latest-rows pairing: it can turn a failing bucket into a passing one and never the reverse.

The order of attempts is: today's pairing, then the latest rows (already built), then the marks set
aside. The first one that makes every v1 row match wins. If none does, today's pairing stands.

### 5.2 The request's panel code is any of the source's panels (`panel-among-source-panels`)

`src/check_request.rs:224` compares the source's first panel with all of v1's panel codes. When that
is not a match, the check tries the source's other panels, in the request's order. The field is a
match when one of them is among v1's panel codes. The output shows the source panel that matched.

When v1 holds no panel that the source has, the field stays a mismatch and shows the first panel, as
today.

### 5.3 A result "Information missing" is kept (`information-missing-kept`)

`flatten` in `src/observations.rs` drops an item whose text is "information missing". That rule goes.
The row is kept, checked, saved and sent on like any other result. `is_information_missing` and its use
are removed.

This is the one decoder change. It moves the observations, payload and FHIR outputs of a request that
holds such a row, and nothing else.

### 5.4 The check reads v1's yen sign as a backslash, and runs of spaces as one (`yen-and-spaces`)

Where the check compares a text of the source with a text of v1 and they do not match as stored, it
tries once more with two changes, on the v1 side and the source side alike:
- U+00A5 in v1's text is read as U+005C.
- A run of two or more spaces is read as one space.

It applies to the loose text comparison (`string_ci_loose` in `src/check_cmp.rs`), which the result
fields `result` and `text_value` and the request field `clinical_info` use. It does not apply to codes,
numbers or dates. Like the marks, it can only turn a mismatch into a match.

## 6. Approaches

- **Chosen: fall back, never replace.** Each check change runs only after today's comparison fails,
  and wins only if it gives a full match. No passing request can fail. It costs a slightly more
  lenient check in four named cases.
- **Sort and pair by position for text lines.** Simpler to state, but it replaces today's pairing for
  every text bucket, so a passing bucket could in principle fail. Dropped for that.
- **Leave the check, list the causes.** No risk, and the count stays at 56. The operator chose to build.

## 7. Proof on real rows (the controller runs it)

Both samples, with `compare.py --explain`, at the build's commit.

- 20,000: the check fails 7. No request that passes at `893e6d9` fails. No request passes in the old
  tool and fails in the plugin.
- 326: the check fails 0, as today.
- Every stage but the whole-plugin check has no difference without a rule.
- `information-missing-kept` allows 3 requests.

## 8. Calls of mine

- The order of the three pairings in 5.1. If wrong, a bucket that two pairings can fix shows the rows
  of the earlier one. The verdict is the same.
- 5.4 applies to `clinical_info` as well as result texts, since 4 of the 9 yen cases are there.
- The four fault names. They are used as rule and override keys.
