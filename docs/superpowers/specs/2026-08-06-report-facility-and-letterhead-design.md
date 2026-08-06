# Reports — working facility identity, and no report left plain — Design

**Goal:** every seeded report resolves facilities to names the way the Clinical Microbiology Report
now does, the Facility filter actually filters, and no report prints as an unbranded table.

Follows `2026-08-05-clinical-report-performing-lab-design.md`, which resolved the performing
laboratory on `rt-clinical-micro` only. That slice fixed one report; this one carries the same
facility identity across the other eight and gives them a letterhead.

---

## 1. Four defects, all measured

### 1.1 ⛔ The Facility filter selects nothing

`q-facilities` — the query behind the Facility dropdown on four reports — is:

```sql
select distinct managing_organization as facility from patients ...
```

**`patients.managing_organization` is populated on 1 of 3714 patients, and that one is the seed.**
The dropdown therefore offers exactly one option, `Organization/seed-org`, which is a FHIR reference
string rather than a facility name. The matching predicates in `q-amr-resistance`,
`q-turnaround-time` and `q-patient-demographics` filter on the same never-set column:

```sql
and ({{param.facility}} = '' or o.patient_id in (
  select p.id from patients p where p.managing_organization = {{param.facility}}))
```

So selecting a facility returns nothing real. The facility the data *does* carry is
`diagnostic_reports.performer` — 88 codes across 7520 reports — which the previous slice made
resolvable through `facility_map`.

### 1.2 ⛔ `q-test-volume` declares the control and ignores it

`rt-test-volume` renders a Facility select, and `q-test-volume`'s SQL never references
`{{param.facility}}`. Choosing a facility silently changes nothing. A control that visibly does
nothing is worse than no control: the reader concludes the data is wrong rather than the filter.

### 1.3 ⛔ `q-amr-facility-summary` prints codes where it used to print names

It groups by `coalesce(f.performer, p.managing_organization)`. When the CDR feed split the facility
into code + display (external migration `013`), `performer` became the **code** — so this report now
renders `NICD` rather than a laboratory name. Measured on the live warehouse, that is exactly what
it returns today.

### 1.4 The other eight reports have no identity at all

`simpleTableDesign` (`packages/reporting/src/seed/simple-design.ts`) emits **three elements**: a
title, a `Generated {{date}}` line, and a table. No logo, no laboratory name, no rule, no footer.
Beside `rt-clinical-micro`'s letterhead they read as unbranded printouts, and nothing on the page
records the scope the numbers were computed over.

## 2. Measured state (live `openldr_target`, 2026-08-06)

| Fact | Measured |
|---|---|
| `patients` rows / with `managing_organization` | 3714 / **1** (the seed) |
| Options the Facility dropdown offers today | **1** — `Organization/seed-org` |
| `diagnostic_reports` rows / distinct `performer` codes | 7520 / 88 |
| What `q-amr-facility-summary` returns today | one row, facility = **`NICD`** (a code) |
| Resolved labels for the 88 codes | 88 distinct, **0 collisions** — ⚠ see §2.1 |
| Queries consuming `{{param.facility}}` | `q-amr-resistance`, `q-turnaround-time`, `q-patient-demographics` |
| Queries declaring the param but not using it | `q-test-volume` |
| `paramOptions` entries in the whole repo | **1** — `facility: 'q-facilities'` |
| `app_settings` rows with a `lab.*` key | **0** — the letterhead renders blank |

### 2.1 ⛔ Label uniqueness is an accident of this dataset — do NOT build on it

All 88 resolved labels are distinct **here**. That is not a property. The spec for the previous
slice records five DISA codes (`BAMAA`, `BBFAF`, `CDABE`, `EAFAE`, `NDFAM`) all displaying
**"Aga Khan"**, in five different districts. Measured on this warehouse: **only `BAMAA` is present.**
The other four arrive with a fuller national ingest, and four labels then collide.

⇒ **The filter value must be the CODE, never the label.** A name-valued dropdown works on this
laptop and silently merges five laboratories in production. This is the same "cannot currently
occur" reasoning that produced a real fan-out defect in the previous slice; it is not repeated here.

## 3. Part A — facility identity that works

### 3.1 Param options carry a value and a label

`optionsDataDriven` (`packages/bootstrap/src/index.ts`) returns `Record<string, string[]>`, built
from **column 0 only**, and `ReportParametersBar.tsx` renders
`<SelectItem key={o} value={o}>{o}</SelectItem>` — so the label *is* the value. §2.1 makes that
unusable.

The contract widens to `{ value, label }[]`: column 0 is the value, column 1 the label. **A query
returning one column keeps working**, with `label = value` — so the change is additive and
`facility` is in any case the only `paramOptions` entry in the repo.

Touched: `optionsDataDriven`, the type it returns, the `/api/reports/:id/options` passthrough, and
the Studio select. The Studio renders `value={o.value}` with `{o.label}` as the visible text.

### 3.2 `q-facilities` moves onto the real dimension

```sql
select distinct dr.performer as value,
       coalesce(fm.name, dr.performer_display, dr.performer) as label
from diagnostic_reports dr
left join facility_map fm
  on fm.source_system = coalesce(dr.source_system, '') and fm.source_code = dr.performer
where dr.performer is not null and dr.performer <> ''
order by 2
```

The same three-level ladder and the same `coalesce(..., '')` NULL-`source_system` guard the clinical
header uses — one resolution rule across the product, not two. 1 fake option becomes 88 real ones.

### 3.3 The predicates repoint onto the performer

Each of the four queries filters on the **code**, via its own grain — the grains genuinely differ
and a single shared predicate would be wrong:

| Query | Grain | Predicate |
|---|---|---|
| `q-amr-resistance` | `lab_results o` | `o.specimen_id in (select specimen_id from diagnostic_reports where performer = {{param.facility}})` |
| `q-turnaround-time` | `diagnostic_reports dr` | `dr.performer = {{param.facility}}` — already the right table |
| `q-patient-demographics` | `patients p` | `p.id in (select patient_id from diagnostic_reports where performer = {{param.facility}})` |
| `q-test-volume` | `lab_requests sr` | `sr.id in (select l.request_id from lab_results l join diagnostic_reports d on d.specimen_id = l.specimen_id where d.performer = {{param.facility}})` — **newly wired**, §1.2 |

Every one keeps its existing `{{param.facility}} = '' or ...` escape so "All" still means all.

**The columns these routes need are measured present and fully populated**, not assumed:
`diagnostic_reports.patient_id` 7520/7520, `lab_requests.patient_id` 7520/7520,
`lab_results.request_id` and `lab_results.specimen_id` 22915/22915.

⛔ `q-test-volume` routes through the request's own specimens rather than through its patient. A
patient may be served by more than one laboratory, so `sr.patient_id in (… where performer = …)`
would attribute every one of that patient's requests to whichever facility tested any of them.

### 3.4 `q-amr-facility-summary` labels by name, groups by code

⛔ **Grouping stays on the code.** The code is the identity; the label is presentation. Grouping by
a resolved label would merge the five Aga Khans into one row the day they arrive — the §2.1 trap
wearing a different hat. Only the projected column resolves.

## 4. Part B — no report left plain

### 4.1 ⛔ `{{param.*}}` in a design currently renders the DESIGN DEFAULT, not the run's value

`renderDataDriven` computes `values` from the run, passes them to `resolveDesignTables`, then calls
`renderReportDesignPdf(design, resolved, { identity })` — **handing the renderer the unmodified
design**. `paramMap` builds its token map from `design.parameters[].value`, i.e. the authored
defaults.

⇒ A header reading `Reporting period {{param.from}} – {{param.to}}` would print blanks regardless of
what the operator picked, and would look correct while being wrong. `RenderOptions` gains `values`,
and `paramMap` prefers them over the design's defaults. **This must land before any metadata panel,
or the panel ships lying.**

### 4.2 ⛔ `drawKeyValue` does not interpolate

`drawElement` holds the token map, but only `text`, `datetime` and image `src` use it
(`draw.ts:433`, `:562`, `:573`). `drawKeyValue(doc, el, r, resolved)` is called **without tokens**,
so an unbound keyvalue pair prints its value literally — `{{lab.name}}` renders as those nine
characters.

This is a latent inconsistency, not merely an obstacle: the same token resolves in a text element
and not in a panel. `drawKeyValue` takes the tokens and interpolates **unbound** pair values and the
panel title. Bound values are NOT interpolated — those are query data, and interpolating data would
let a result cell containing `{{lab.name}}` forge letterhead into the body of a report.

### 4.3 The letterhead, on every report

`simpleTableDesign` gains the band `rt-clinical-micro` already ships — logo, laboratory name,
address, contact, and a closing rule — plus a page footer. One helper, so all eight aggregates
change together and stay consistent by construction rather than by review.

The table moves down to clear the band. ⛔ Its height must shrink by exactly what the band consumes:
a table whose `y` grows while its `h` does not runs off the page bottom, and the renderer chunks
rows by height rather than clipping, so the symptom is a spurious extra page rather than an obvious
overflow.

⛔ **Layout arithmetic is in px@96**, and the renderer multiplies the rect by 0.75 to reach points
while applying its layout constants in points. That mismatch shipped a silently clipped row in the
previous slice, green tests and all. Any capacity claim here is computed in **points**.

### 4.4 A metadata panel of what is actually relevant

Not a performing laboratory — these are cross-facility aggregates and a single lab line would be
false. The panel is **generated from the design's own declared parameters**, so each report
describes its own scope with no per-report authoring:

- one pair per declared parameter — `dateRange` contributes `Reporting period` as `from – to`;
  `facility` contributes `Facility`; `asOf` contributes `As of`
- plus `Generated`, from `{{date}}`

An unset optional parameter renders an **em dash**, not an empty value: a blank beside a label reads
as a failure, where `—` reads as "not filtered". This is why §4.1 and §4.2 are prerequisites rather
than niceties — the panel is entirely token-driven.

## 5. Part C — the OpenLDR logo

`apps/studio/public/favicon.svg` is the product mark: a steel-blue (`#4682B4`) rounded square with a
white droplet. ⚠ **pdfkit renders neither SVG nor remote URLs** — an `https://` logo silently
placeholders, which is why `lab.logo` is validated as a data URI at write time
(`packages/bootstrap/src/lab-identity.ts`). So the mark is rasterised to PNG and seeded as a default
`lab.logo` data URI.

`lab.name` is seeded alongside it as **`OpenLDR`** — a logo beside a blank line looks more broken
than no logo. ⛔ It is **not** given an invented ministry name: the letterhead is the *issuing*
organisation, and inventing a real-world issuer on a clinical document is a forgery risk, not a
placeholder. Both are defaults an operator overwrites in Settings ▸ Laboratory.

⚠ Seeding must be **create-if-absent**, never managed-overwrite: an operator who has set their own
identity must not have it reverted by a re-seed.

## 6. Testing

- The dropdown lists resolved names; the value carried is the **code** (pins §2.1).
- A one-column options query still works, with `label = value` (the additive-contract claim).
- Each of the four predicates filters to one facility, and `''` still means all.
- `q-test-volume` actually changes its result when a facility is chosen — the defect in §1.2 is
  invisible to any test that only checks the SQL parses.
- `q-amr-facility-summary` projects a name and still **groups by the code** — assert two codes
  sharing one label stay two rows.
- `paramMap` prefers run values over design defaults (§4.1), and a report rendered with a
  parameter prints that parameter's value, not its default.
- An unbound keyvalue pair interpolates; a **bound** one does not (§4.2 — the forgery guard).
- Every seeded design's table fits the page after the band is added, in **points** (§4.3).
- Re-seeding does not overwrite an operator's `lab.name` / `lab.logo`.
- ⛔ **Render a PDF of each report and look at it.** The previous slice's clipped row was green in
  every test and visible immediately in the PDF.

## 7. Out of scope

- **Backfilling `facility_registry`.** 1 of 88 facilities is registered; the feature is correct at 1
  and at 88.
- **Multi-select facility filtering.** The control is single-select today and stays so.
- **Re-authoring `rt-clinical-micro`.** It already has its letterhead; only the shared helper
  changes.
- **The header query's 4× re-execution** (`resolveDesignTables` caches by element id, not query id)
  — a real inefficiency, filed separately, not this slice.

Related: [[clinical-report-performing-lab-slice]], [[facility-reconciliation-slice]],
[[report-designer-px-vs-pt-units]], [[lab-identity-letterhead]],
[[clinical-report-template-workstream]], [[fresh-install-defaults]].
