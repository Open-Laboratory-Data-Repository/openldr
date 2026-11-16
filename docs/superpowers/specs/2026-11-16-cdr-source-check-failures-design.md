# The requests that fail the check against v1

Date: 2026-11-16. Repository: `cdr-source` (the plugin). This follows
`2026-11-16-cdr-source-v1-faults-design.md`, which left 436 of 20,000 sampled requests failing
the check against OpenLDR v1, and 12 that pass in the old tool and fail in the plugin.

## 1. What this is and why

A request that fails the check is held back. It does not reach the warehouse until someone
acts on it. Each failure is one of two things. Either the plugin reads the source wrongly, and
CE would store a wrong record. Or the plugin is right and the check is wrong, and a good
record is held for nothing. The work is to tell which, cause by cause, and fix the side that
is wrong.

v1 is a witness, not the target. The operator said on 2026-11-16: "we are trying to improve
data capture/storage of openldr_ce not carry over issues of v1". Where the source's own bytes
settle a question, they decide. v1 only confirms.

## 2. Counted on the real sample

Counted by the controller on the 20,000 lab-system requests with a v1 twin, with the decoder
on `main` at `fdfbfb1`. Counts, field names, codes and byte classes only. The full notes are in
the plugin repository, `.superpowers/notes/f436-real-data-facts.md`.

| Cause | Requests | Who is wrong |
|---|---|---|
| The clinical text of registration frame 11 is filed as an ICD-10 code | 255 | The plugin |
| A whole number is replaced by a comment's text, read as a number | 67 | The plugin |
| v1 holds one run where the plugin kept two, and the check pairs it with the earlier one | about 13 | The check |
| A text result holds a format mark inside a line | 33 in full, part of 56 more | Neither: a difference of form |
| A text result where v1 lacks words, or its line pairs with another | about 56 | Not known |
| The panel code differs | 10 | Not known |
| A result row only in v1 | 3 | Not known |
| Taken and collected dates only in v1 | 1 | Not known |

### 2.1 Frame 11

The source keeps registration texts in rows keyed by a frame number. The plugin reads frame 12
as the diagnosis and frame 11 as the ICD-10 code (`src/request.rs:374-376`). 2,170 requests
have a frame 11 row. On 250 its text is not blank. On 246 of those the text equals v1's
`ClinicalInfo` exactly, on 3 it is part of it, and on 1 it differs. On 249 of the 250, no part
of the text is shaped like an ICD-10 code. v1's own ICD-10 field is empty on all 250.

### 2.2 A number read from a comment

`result_item` (`src/request.rs:412-460`) takes a slot's five raw bytes. When the parameter has
a comment context, it drops the NULs, looks the rest up as a comment code, and puts the
comment's text in place of the result. For a numeric type it then reads the first four
characters of that text as a float. A whole number such as 250 is the bytes 00 00 7A 43. With
the NULs dropped that is two letters, and seven such pairs are comment codes in the
dictionary.

- 69 result rows on 67 requests have a number 10^20 or more times v1's. All 69 have raw bytes
  of two NULs, two letters and a NUL, with the entered flag set.
- v1's number is in the same test row as a float, at the same offset as in requests that pass.
- On all 69 a comment has the code the bytes spell. On 42 the plugin's number equals that
  comment's first four characters read as a float.
- No numeric slot in the sample holds a comment code written as text from its first byte.
- Codes: platelets in two panels (43 rows), neutrophil and lymphocyte percentages (20), six
  others.

### 2.3 One run in v1, two in the plugin

On 52 result rows v1's number is another run of the same parameter, panel and order, with a
later stamp (44) or the same stamp (8). The plugin kept both runs. v1 has one row. The check
sorts each side and pairs by position (`src/check_results.rs:589-600`), so v1's row meets the
earlier run. This is the open point of catalogue entry A12, and the cause of the 12 requests
that pass in the old tool and fail in the plugin.

### 2.4 Format marks in text results

Cytology, histology and semen reports hold the marks `^B` (3,229 times in the sample), `^S`
(339) and `^I` (14). v1 never has them. 2,967 of the `^B` open a line, where the check passes
today. A mark inside a line makes that line a mismatch (213 values). With the marks set aside,
120 of the 259 mismatching lines equal v1, and 33 of 89 requests pass on their text results.

## 3. Goals, non-goals, anti-goals

Goals:

1. The plugin files frame 11 where it belongs, and reads a number from its own bytes.
2. The check pairs v1's rows with the runs they belong to, and does not fail a line for a
   format mark.
3. Each change is proven on the 20,000 real requests, with the count it moves.

Non-goals: the causes marked "not known" in section 2. They are counted again after these
four, because the fixes change which requests are left. Filing each request under its own
laboratory is separate work.

Anti-goals:

- A stored result changed to look like v1. The operator: "its extremely tricky to change
  medical results".
- A check loosened until everything passes. Each rule names the one difference it allows.

## 4. Approaches

1. **Fix each cause on the side that is wrong, in the plugin's own process.** A decoder change
   states the outputs it moves and gets one value rule in the real-data compare. A check change
   states which verdicts it moves. Chosen: it is how the four earlier faults were fixed, and it
   keeps every difference from the old tool named and counted.
2. Loosen the check for the whole family at once (ignore clinical text, ignore numbers that
   differ by a large factor). Rejected: CE would still store a free text as a code and a wrong
   platelet count.
3. Do nothing in the plugin and let people release held requests by hand. Rejected: 436 in
   20,000 is about 37,000 requests on the whole source.

## 5. The design

### 5.1 Frame 11 is clinical information (operator: "Clinical info, code if shaped")

- The text of frame 11 is clinical information. It joins the texts the check compares with
  v1's `ClinicalInfo`, and it is stored where the diagnosis text is stored today.
- It is kept as an ICD-10 code only when every part of it is shaped like one: a letter, two
  digits, and an optional point and one or two digits. Parts are split on commas, semicolons,
  slashes and spaces.
- When it is kept as a code it is not also stored as clinical information.

### 5.2 A numeric result is read from its own bytes

For a slot of type 1 or 2, the comment lookup by the raw bytes is not done. The number is the
float of the slot's first four bytes, as it is today when no comment is found. A text row for
the slot still replaces the result, as today. Whether that branch has the same fault is counted
on the real run and reported; it is not changed here.

### 5.3 The check pairs v1's rows with the latest runs

Where the plugin keeps more rows than v1 for a panel and parameter, v1's rows are paired with
the plugin's latest runs, and the earlier runs are rows only in the source, which do not fail
the check. Where both sides have the same number, or v1 has more, pairing stays as it is.

### 5.4 Format marks: kept, set aside by the check, and flagged

The operator: "its extremely tricky to change medical results, maybe we keep and flag it as I
don't know if its an error or something".

- The stored text is not changed. The marks stay in it.
- The check sets `^B`, `^S` and `^I` aside when it compares a text line, wherever they sit.
- A request whose text results hold such a mark gets one finding, class
  `result_text_format_marks`, severity `info`, with the number of lines and the marks seen. It
  never holds a request. My reading of "flag": a finding, since CE has no other place for a
  note on a saved request today (design of the check run, section 10.4).

### 5.5 Order of work

1. Frame 11. 2. The numeric result. 3. The pairing. 4. The format marks. Each is its own task
and commit. After the four, the controller runs both real samples, then counts what is left.

## 6. What is not known

- Why, on about 56 requests, v1's text lacks whole words or its lines pair with other lines.
- The 10 panel-code differences, the 3 rows only in v1, the 1 request with dates only in v1,
  and the 9 clinical-information failures frame 11 does not explain.
- Whether a text row on a numeric slot gives a wrong number too (5.2).
- The marks' meaning. They look like bold, standard and italic from the report editor. That is
  a guess from their position, not a fact from the source system's documents.

## 7. Calls of mine, for the operator to check

1. A code-shaped frame 11 text is stored as the code only, not in both places.
2. "Flag" is an `info` finding (5.4).
3. The check sets the marks aside everywhere in a line, not only where v1 lacks them.
4. The build goes to the session that built the four faults, since it knows the compare tool.
