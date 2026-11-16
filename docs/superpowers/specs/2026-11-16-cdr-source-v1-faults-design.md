# The four decoder faults that waited for v1: design

Date: 2026-11-16. Repository: `cdr-source` (the plugin), with docs here in `openldr_ce`.
Follows `2026-11-15-cdr-source-plugin-design.md` (fault list, section 6.8) and
`2026-11-16-cdr-source-dates-design.md`.

## 1. What this is and why

Four faults in the old tool's decoder were left open because only OpenLDR v1 could say what
the right answer is. The plugin copied each one on purpose. The restored Tanzania source and
its v1 from the same afternoon now sit on one server, so each was counted there. This design
turns each count into a rule.

The operator asked for this as the second of three pieces of work on 2026-11-16: dates first,
then these four, then the 496 real twins that still fail the check against v1.

Who it is for: the person who reads a migrated request in CE and trusts its date of birth,
its taken date, and that every test ordered shows its own result.

## 2. What was checked first

Every count is from the whole restored tables, by SQL, counts only. The full tables are in
the plugin's notes (`.superpowers/notes/part3-real-data-facts.md`, not committed) and go
into `docs/fault-catalogue.md` with this work.

**Fault 11, the age bytes.** Two decoders read the registration record's age differently.
One reads years at byte 414, days at 416 and hours at 418. The other reads years at 414 and
days at 417 to 418, little-endian.

- On 19,621 sampled twins with a v1 age, byte 414 equals v1 `AgeInYears` on all, and bytes
  417 to 418 equal v1 `AgeInDays` on all. Byte 416 is set on 1,209, and there it is only the
  days value mod 256.
- The days are the whole age, not days on top of the years. Of 1,509,370 v1 requests with
  years set, the days fall inside that year of age on 1,509,345.
- The days are counted from the specimen date. On 882,043 requests with one birth row and a
  v1 age, days = specimen date minus birth date on 860,793. With the received or registered
  date in its place where there is no specimen date, all but 54 are explained.
- Where a request has no birth row, the days are a round number of years
  (years x 365, or floor(years x 365.25)) on 314,717 of 850,585 twins. Someone typed an age
  in years. Where a request has a birth row, that is so on 1,541 of 888,937, which is what
  chance gives (about 1 in 365).

**Fault 2, two birth dates.** 328 requests hold two or more different birth dates. Of the
284 with a twin and an age, the earliest date gives v1's days on 139, the latest on 127, and
no row on 18. The old tool took whichever the database returned first. The plugin takes the
earliest. Neither is right. The row that agrees with the stored age is.

**Fault 3, two taken dates.** 84 requests hold two or more taken dates. The index is read
on 70 of them, because the other 14 have a taken date on the registration itself. All 70
have a collected date, and it equals one of the taken dates on 69. v1's specimen day is the
collected date on 61 of 61 twins.

**Fault 13, one run per test code.** The plugin keeps only the latest run of a test code,
across every order of that code. Of 21,793 cases with a twin where one code has runs in two
or more orders, v1 kept one order row per order with results on every row on 15,526 (71%),
with results on some rows on 2,989, and one order row only on 2,594. In the sample of
20,000 twins, 66 requests fail the check on "a result only in v1".

## 3. Goals, non-goals, anti-goals

Goals:

1. One reading of the age bytes: years at 414, days at 417 to 418.
2. A date of birth worked out from the age is the collected date minus the stored days.
3. With two birth dates, the one the stored age confirms is taken.
4. With two taken dates, the one on the collected day is taken.
5. Each order of a test code keeps its own latest run.
6. No rule depends on the order the caller hands rows in.

Non-goals:

- A rule for one birth row that disagrees with the stored age (54 of 882,043). It goes in
  the catalogue as a check that needs only the incoming record. Nothing is built.
- A test code with more order numbers among its runs than orders on the registration. Such a
  code keeps today's rule whole: one latest run across all its runs. The real run counts how
  many there are.
- A reference date other than the collected date for the age. Where a record has no
  collected date, no date of birth is worked out from the age, as today.
- TBCOL and COL as forms, the unknown specimen code (fault 14), the 496 failures as such.

Anti-goals:

- A change that moves an output it does not state. Every moved field has an override or a
  value rule, as for every earlier fault.
- A request that passed the check against v1 failing it after this work, unexplained.

## 4. Approaches

For each fault the choice was between simple fixed rules and a rule the data supports.

| Fault | Considered | Chosen, and why |
|---|---|---|
| 11 | (a) keep both readings; (b) days at 417 to 418, added to the years; (c) days at 417 to 418 as the whole age | (c). v1 matches it on every row, and the days sit inside the year of age, so adding them to the years would count the age twice |
| 11, typed ages | (a) a guessed full date; (b) the year only; (c) no date of birth | (a). The operator first chose (c), then on 2026-11-16, after asking about babies and partial dates, chose "Full guessed date": an estimate is better than nothing, and the stored age still leaves beside it |
| 2 | (a) earliest; (b) latest; (c) the row the stored age confirms | (c). Earliest is right on 139 and latest on 127 of 284 |
| 2, none confirmed | (a) earliest silently; (b) no date of birth; (c) earliest with a warning | (c). The operator chose it on 2026-11-16: "Earliest, with a warning" |
| 3 | (a) earliest, as today; (b) latest; (c) the row on the collected day | (c). The collected day equals a taken date on 69 of 70, the latest on 47 and the earliest on 22 |
| 13 | (a) per test code, as today; (b) per order; (c) per order, and a spare run joins the last order | (b). The operator chose it on 2026-11-16: "Per order, as v1". (c) adds a rule for a shape seen twice in 283 sampled cases |

## 5. The design

### 5.1 The age (fault 11)

`dob_or_age` in `src/records.rs` reads `years` = byte 414 and `days` = bytes 417 and 418,
little-endian. It no longer reads byte 416 or an hours byte.

It gives no value when years and days are both 0, or when there is no collected date
(bytes 159 to 162). Both are as today.

Otherwise:

- days above 0: the collected date minus `days` whole days, printed as a date. This holds
  for a baby (years 0) and for an adult alike, and also when the days are a round number of
  years, which means someone typed the age. The operator chose a full estimated date there.
- days 0 and years above 0 (7 requests in 1.7 million): the collected date minus that many
  calendar years, as today.

Whether the collected date has a time does not matter, since no hours are taken off.

The stored age itself does not change. The request carries `age_years` and `age_days` as
stored, and a zero stays empty: a baby under one year has no age in years, only days. The
operator confirmed that on 2026-11-16: a 0 for years is not wanted.

Nothing marks an estimated date of birth as estimated. A consumer can tell only by the
missing birth row, which CE does not keep. That is an open point, in the catalogue.

### 5.2 Two birth dates (fault 2)

In `src/request.rs`, where the birth rows are read:

- The rows are read as distinct dates, sorted earliest first, by the decode itself.
- One distinct date: that date, as today.
- Two or more: the first date for which collected date minus that date, in whole days,
  equals the stored `days`. A date is confirmed only when the record has a collected date
  and `days` above 0.
- None confirmed: the earliest date, and the request carries one warning, class
  `birth_dates_disagree`, severity warn. Its details hold the distinct dates and the stored
  age in days. It never holds the request.

The request record must expose what this needs: the collected date and the stored days are
already decoded from the same registration record.

### 5.3 Two taken dates (fault 3)

Same place. When the registration has no taken date of its own and the index holds rows:

- The rows are read as distinct dates, sorted earliest first, by the decode itself.
- The first whose day equals the collected date's day. Else the earliest.
- No warning. v1 keeps the collected date, so nothing downstream shows a wrong choice.

### 5.4 One run per order (fault 13)

`supersede` in `src/observations.rs` keys the winner on the test code and the order number
of the run, where the order number is the run index with 100 taken off when it is above 100
(`base_index` in `src/payload.rs`, the same key the order rows use). The latest run wins
within that key, by the same comparison as today.

The new key applies to a test code only when its runs hold no more distinct order numbers
than the registration has orders of that code. That is the case in which every kept run has
an order to link to (`Linker::new` in `src/payload.rs` pairs a code's order numbers with its
orders and drops the surplus). When a code has more order numbers than orders, the code
keeps today's key, the test code alone. So `supersede` takes the registration's order count
per code as a second input.

`base_index` is used as it is. So index 100 stays 100, 101 is 1, 200 is 100, and 201 is 101.
That odd edge is catalogue entry A14 and is not changed here.

So a rerun of one order (index 1 and 101) still leaves one run. A code ordered twice with
runs at index 1 and 2 keeps both. A code ordered once with runs at index 1 and 2 keeps only
the later one, as today. `superseded_by` is the winner's index within the same key. The list of dropped runs and its order follow from the same rule. The
audit's finding for dropped runs lists fewer runs. An earlier order keeps its result, so its
status is no longer "in progress" for lack of one.

### 5.5 How each change stays tested

As for every earlier fault (the build's standing rule):

- Fixtures stay byte for byte. Each fixture output that moves is stated as override
  operations in `tests/overrides/`, each `now` checked by hand, never pasted from the code.
- Fixtures that move: `registration-request-facts` and `dates-day-ten-minute-32` (age),
  `birth-row` (birth dates), `taken-from-index` (taken dates),
  `panel-ordered-twice-two-runs` and `two-runs` (runs). Any other fixture that moves must be
  explained in the report.
- `tools/real-data-check/compare.py` gains one value rule per fault, keyed by its name and
  gated on the request's own raw rows. Each recomputes the value it allows:
  - age: the date of birth from the raw record bytes and the birth rows;
  - birth dates and taken dates: the chosen date from the raw rows and bytes;
  - runs: the kept and dropped runs worked out again from the old tool's own full list of
    observations. For the payload and FHIR stages the rule is gated on the same requests,
    and it checks that every result that appears belongs to a run the recompute keeps.
- Each rule also has the guard the last review asked for: a request the rule expects to move
  must have moved. A fix that stops applying fails the run.
- The 119 check fixtures give the verdicts they gave.

## 6. What is expected on real data

On 20,000 sampled twins, before any code:

- About half have no birth row. Of those, nearly all with an age of a year or more get a
  date of birth that moves by up to a year, from collected date minus years to collected
  date minus days. A baby's date of birth moves only when the age is 256 days or more.
- Two birth dates: 328 in 2.3 million, so 2 or 3 in the sample.
- Two taken dates with the index read: 70 in 2.3 million, so most likely none.
- Runs in two or more orders: about 280 test codes on about 270 requests.
- The check against v1: 19,504 pass today. The 66 that fail on "a result only in v1" should
  fall. No request that passes today may fail without a stated cause.

## 7. Calls of mine, for the operator to check

1. The age is counted from the collected date only. v1 used the received or registered date
   on the 2% with no specimen date. Those keep no date of birth from the age.
2. With two birth dates, a date is confirmed by an exact match in days. No tolerance.
3. `birth_dates_disagree` also fires when there is nothing to confirm with (no collected
   date, or no stored days), not only when the stored age disagrees.
4. Two taken dates give no warning.
5. A test code with more order numbers than orders is left as today, whole.
6. An age of years only (7 requests in 1.7 million) keeps today's rule: collected date minus
   the years.
7. A damaged birth or taken row is skipped before the choice is made. Today a damaged first
   row hides a good second one.
8. The new warning is added last, after `dates_out_of_order`, so no existing finding moves.
9. A stored age has no upper bound. 65,535 days is about 179 years.

## 8. Settled after a reviewer read this

A reviewer read the design against the code and asked twelve questions. None needed the
operator. The answers bind the build.

**Whole days.** Everywhere in this design, the days between two dates are the difference of
their calendar days. A time of day on either side is ignored. That is what the source
counted: v1's days equal the difference in calendar days. The payload already has this as
`age_days_between` (`src/payload.rs:476`). The builder reuses it or moves it. The collected
date's day minus `days` calendar days is the date of birth.

**Distinct dates, and damaged rows (5.2 and 5.3).** A birth row's date is what `birth_date`
(`src/request.rs:200`) gives, which has no time. A taken row's date is what `date_only`
gives. A row for which that gives nothing is skipped. Two rows on one day are one date. The
dates are sorted by year, month and day as numbers, never as text. When every row is
skipped, the request behaves as if it had no rows: the date of birth falls back to the age,
and the taken date is empty.

**What the request record gains (5.2).** One field, not printed in the request stage's
output, which must stay equal to the old tool's: the distinct birth dates and the stored
days, set only when the warning applies. The audit reads it and adds the finding. The
finding is the last in the list, after `dates_out_of_order`. `compare.py` accepts it only
when it equals the one worked out again from the raw birth rows and record bytes.

**A short record (5.1).** A record too short to hold byte 418 gives no date of birth from
the age, as it already gives no stored days in the payload. The decoder's two offsets (414
and 417) stay where they are in `src/records.rs`, and one test pins them to the site
profile's `age_years` and `age_days` offsets, so the two readings cannot drift apart again.

**Outputs that move with the date of birth (5.1 and 5.2).** Request `DobAge`. Payload
`patient.date_of_birth`, `age_years_at_received`, and `isolates[].patient_age_days`. FHIR
`Patient.birthDate`. The audit's date-of-birth findings. The payload's age fields fall back
to the stored age where there is no date of birth, as they do today. `compare.py` already
groups these paths as derived from the birth date; the age rule covers that group by working
each value out again.

**Outputs that move with the taken date (5.3).** Request `TakenDateTime`, the payload's
taken date, and the source value the check against v1 reads for the specimen date. FHIR's
collected time reads the collected date first, so it does not move on any of the 70 known
requests.

**Holds.** The rule that a date of birth after the specimen date is an error stays as it is.
The new date of birth is never after the collected date. It can be after a taken date only
when the taken date is earlier than the collected date by more than the age. For an age
under 256 days the date of birth does not change at all, so no newborn gains that error.
The real run reports the held count, and any request newly held is listed by cause.

**A typed age and two birth dates.** The stored days are used to confirm a birth date
whether or not they are a round number of years. A match must be exact.

**A typed age.** No test for a round number of years is built. The count stays in the
catalogue as a signal: where there is no birth row and the days equal years x 365 or
floor(years x 365.25), the date of birth is an estimate.

**The supersede list.** Its sort order does not change: test code, then run index.
