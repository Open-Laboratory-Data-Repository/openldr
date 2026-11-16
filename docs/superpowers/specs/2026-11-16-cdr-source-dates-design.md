# cdr-source plugin: dates with no time, and dates in order. Design

Date: 2026-11-16. A short design. It follows `2026-11-16-cdr-source-v1-check-design.md` and
changes one decision of that work.

## 1. What this is and why

The operator's point on 2026-11-16: for a laboratory system with no second database to compare
with, the checks can only work on the record that comes in, and dates matter most, because a
negative turnaround time is pointless.

Two things follow.

1. **A date stored with no time of day leaves the plugin as a date only.** Today it is written
   as 00:00. That was a fix of the same day: before it, such a date was dropped whole. But a
   midnight nobody recorded reads as a time. On 20,000 real requests it puts a received date
   before a same-day collection time in 176 of 38,917 order rows.
2. **A check that a request's dates are in order.** It needs nothing but the record.

## 2. What was checked first

- The plugin already carries a date-only text to the end. `disa_to_iso` turns `MM/DD/YYYY`
  into `YYYY-MM-DD` (`src/payload.rs:421-431`), and `fhir_datetime` keeps a date as a date
  (`src/text.rs:178-185`). A taken date read from the index is already a date only
  (`src/request.rs:214`). So no later stage needs to learn a new form.
- CE stores these values as text, as sent (`packages/db/src/relational/specimen.ts:14`,
  `packages/db/src/migrations/external/001_flat_tables.ts:50`). A date-only value is kept as
  one.
- The v1 check compares a date-only source value with v1's midnight and calls it a match
  (`same date; v1 stored as date-only (midnight)`). The 5,961 requests that pass since the
  morning's fix still pass.
- Counted on the plugin's output for the sample, 40,114 order rows. A later step dated before
  an earlier one: collected then received 176, all from the invented midnight; registered
  then analysed 250, of which 248 on the same day; analysed then authorised 8; received then
  analysed 4; three other pairs 1 or 2 each. Collected or received then registered: 0.

## 3. Goals, non-goals, anti-goals

Goals:

- No time is written where none was recorded, in the request, the payload or FHIR.
- A request whose dates are out of order is saved and carries a warning that names each pair
  and both values. The operator chose a warning over a hold on 2026-11-16, and gave the reason:
  getting access to the source is sometimes not possible, or takes a very long time, so
  flagging the record at least starts the process of getting it corrected.
- The warning holds what a person needs to raise it with the source: which two steps, both
  dates as recorded, and the order row's test code. The request it sits on already carries
  its number and its facility.
- Two dates are compared to the minute when both have a time, and by day when either has none.
  So a date with no time can never make a pair look out of order within one day.
- The same check, written as a rule a program could run, goes in the fault catalogue.

Non-goals:

- Why 250 real rows have analysis before registration. That is looked at with the 496.
- How a CE report works out a turnaround time. A report that casts a date-only text to a
  timestamp will read midnight. That is CE content and is noted for it.
- Any other new audit rule.
- The process that follows a warning: who is told, and how a corrected record comes back. A
  list of flagged requests for a facility is part 4's screen.

Anti-goals:

- A warning raised by a time the plugin made up.
- A record held for its dates alone.
- A date that was read this morning being dropped again.

## 4. Approaches

| | Approach | Why not, or why |
|---|---|---|
| A | The decode prints a zero-time date as `MM/DD/YYYY`, with no time | Chosen. Every later stage already takes that form, so one function changes |
| B | Keep `00:00` and carry a flag beside each date | Two forms of one fact, in three stages, and every reader must learn the flag |
| C | Keep `00:00` in the request and drop the time in the payload | The request and the v1 check would then say midnight while the payload says none |

## 5. The design

**The date.** `datetime_value` in `src/records.rs` gives `MM/DD/YYYY` when the date bytes are set
and the two time bytes are zero, and `MM/DD/YYYY HH:MM` otherwise. This covers the collected,
received-in-lab and registered dates. `long_datetime` itself still returns the date at 00:00
with a mark that the time is unknown, because `dob_or_age` needs the date to subtract an age
from.

**The age.** With no time of day, `dob_or_age` subtracts the years and the days and leaves the
hours alone. An age in hours taken off a midnight nobody recorded lands on the day before.

**The rule.** A new audit rule, class `dates_out_of_order`, severity warn. The steps, in order:
the specimen's date (collected, else taken), received in lab, registered, and for each order
row its analysis time and its authorisation time. For every pair of steps that are both set,
the later must not be before the earlier. Both with a time: the pair is out of order only when
the later step is more than 10 minutes before the earlier one. Either with no time: compared by
day. One finding per request, whose details list each pair that is out of
order with the two step names, the two values as the request holds them, and the order row's
test code where the pair involves one. The analysis and authorisation times are read the way
the payload already reads them (`status_by_obr` in `src/payload.rs`), so the audit and the
payload cannot disagree.

**What does not change.** `header_long_datetime`, which reads a test header's date and treats
00:00 as noise. The v1 check. The six earlier fixes and the two of this morning, except the
printed form of a zero-time date.

**The real-data rules.** The rule for a date with no time expects the date-only form. A new
rule lets the finding `dates_out_of_order` appear only when the plugin's own dates for that
request are out of order by the rule above, worked out again by the compare tool from the
payload, and only with the pairs it works out. The hole parked this morning is closed first: a
date-of-birth finding that appears must hold the birth row's own date.

## 6. What is expected on real data

- The 176 order rows with received before collected no longer show as out of order.
- About 260 order rows of the sample carry the new warning: 250 with analysis before
  registration, 8 with authorisation before analysis, and the few others.
- No verdict of the v1 check moves.
- No request that was saved is now held.

## 7. Calls of mine, for the operator to check

1. The specimen's date is the collected date when there is one and the taken date otherwise,
   as the payload already chooses.
2. Registration sits between received and analysed. The sample has no row with registration
   before receipt, and 250 with analysis before registration.
3. One finding per request, listing every pair, not one finding per pair.
4. The hours of an age are ignored when the collected date has no time.

## 8. Decided after the first real run of the rule

On 20,000 real requests the rule as first built flagged 255. 250 of those were one pair,
analysis before registration, and the gap was up to 1 minute in 205 of them, 1 to 5 minutes in
40, 5 to 10 in 3, and over an hour in 2. One test code held 164 of the 250, and none had an
analyser code: tests recorded at reception in the minute the registration was saved. Nothing
shows whether the registration time is the first registration or the last save.

Such a pair is not a fault a laboratory could correct, and 250 of them would bury the few that
are. The operator decided on 2026-11-16: allow 10 minutes. Two timed steps are out of order
only when the later is more than 10 minutes before the earlier. A step with no time is still
compared by day.

The operator then asked what the 250 were. Counted by panel on the same run:

| Panel | Dictionary name | A form panel in the site list | Requests holding it | Pairs |
|-------|-----------------|-------------------------------|--------------------:|------:|
| TBCOL | TB Collection Info | no | 258 | 164 |
| COL | Specimen Collection | no | 57 | 36 |
| VLID | HIV VL Patient Information | yes | 1,115 | 27 |
| EIDID | HIV EID Client Information | yes | 271 | 10 |
| ARTID | ART Patient Information | yes | 3 | 3 |
| real tests | | | | 10 |

So 240 of the 250 sit on panels that hold information typed in, not a laboratory step. The
operator said the document travels with the sample from the tracking system, so its time can
come before registration. None in this sample is more than 10 minutes early, but a form typed
hours or days before the laboratory registers the sample would be.

The operator decided on 2026-11-16: the rule skips all five. An order row whose panel is one
of the site's form panels (ARTID, EIDID, VLID) or one of its collection information panels
(TBCOL, COL) gives no pair. The second list is new in the site profile. TBCOL and COL still
leave as lab results, since only the date rule reads the new list. The 10-minute allowance
stays for every other panel. Pairs between the request's own steps do not change.

Not decided here: whether TBCOL and COL should leave as forms like the other three. The old
tool does not send them as forms, and no form is named for them.
