# Mapping chunk 6: age at request

Spec: `docs/superpowers/specs/2026-11-17-mapping-review.md`, finding 6, the age amendment, and the
storage agreement (Claude, Codex, operator). Branch: `fix/chunk6-age`, from main `d3667811`.

## What changes

1. **Two target fields** on Lab result, in the ServiceRequest record: **Age**
   (`ServiceRequest.extension:age-at-request`) and **Age unit**
   (`ServiceRequest.extension:age-at-request.unit`). They are not FHIR element paths, so the
   writer never sees them: `applyMapping` builds the extension from their values. Labels in en, fr, pt.
   Synonyms such as `age`, `âge`, `idade`, `age_unit`.
2. **Reading an age** (`packages/forms/src/map/age.ts`, pure):
   - Written: `3 days`, `6 wk`, `18 months`, `2 y`, `2y 3m`, `23 hours`, in en, fr and pt
     (`jours`, `semaines`, `mois`, `ans`, `heures`; `dias`, `semanas`, `meses`, `anos`, `horas`).
   - A number with **Age unit**. A bare number with no unit row is years.
   - Units: hours, days, weeks, months, years, with UCUM codes `h`, `d`, `wk`, `mo`, `a`.
3. **What is stored**, in the `urn:openldr:ext:age-at-request` extension on the ServiceRequest:
   - `days`: total days. Hours give completed days (`floor(h / 24)`), days as sent, weeks x 7. These
     are exact. Months x 30.4375 and years x 365.25, rounded down, are estimates.
   - `daysEstimated` true when any part was months or years. Absent otherwise.
   - `years`: completed years, only from years and months (12 months is a year), and only when 1
     or more. A baby never gets 0 years.
   - `source` (valueAge: value, unit as sent, UCUM system and code) when the age is one value and one unit.
   - `text` (valueString) when the age was written as text, exactly as sent.
   - An age that cannot be read keeps only `text`, the run notes the field, and the row is not held.
   - Never a birth date from an age.
4. **Warehouse.** External migration `027_lab_request_age_estimate` adds nullable boolean
   `lab_requests.age_days_estimated`. The projector (`request-facts.ts`) sets true when
   `daysEstimated` is true, false when `days` is present without it, null otherwise. Existing rows
   stay null; no backfill. 027 is free on every local branch (checked with `git ls-tree` on all refs).
5. **AGENTS.md section 8** names `age_days_estimated` beside `age_years` and `age_days`, with the
   operator's reason and date.

## Examples (tests)

| Sent | Stored |
| --- | --- |
| `3 days` | days 3, source 3 d, text |
| `6 wk` | days 42, source 6 wk, text |
| `1 month` | days 30, daysEstimated, source 1 mo, text |
| `2 years` | years 2, days 730, daysEstimated, source 2 a, text |
| `23 hours` | days 0, source 23 h, text |
| `2y 3m` | years 2, days 821, daysEstimated, text (two units, no source) |
| 3 with unit `semanas` | days 21, source 3 semanas (wk), no text |
| 45 with no unit row | years 45, days 16436, daysEstimated, source 45 a |
| `unknown` | text only, note, row stored |

## Done means

- Full gate with `OPENLDR_SKIP_ENV_FILE=true`, server lint. A real boot of the 3991 demo runs migration 027.
- In-app and web docs in en, fr and pt.
- Demo retest with `claude-newborn-age`. Codex review on the relay. Changelog after merge.
