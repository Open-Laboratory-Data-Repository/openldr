# Monthly LIS transmission grid

**Date:** 2026-08-18
**Status:** design, awaiting approval
**Scope:** slice 2 of 3. Page 1 of the reference report — two grids of laboratories against working
days, two states per cell. Nothing else.

Reference: `D:\Documents\OpenLDR\Reports\2021\1 - Monthly LIS Stakeholders Update - 1 to 31 January 2021.pdf`,
itself an OpenLDR v1 artefact (jsPDF 1.5.3, title "OPENLDR").

---

## What this builds

For each testing laboratory, for each working day of a month: did any data arrive from that
laboratory that day. Two tables — HVL/EID, and Other — matching the reference's

> "Any* HVL/EID Data Submission by Testing Laboratory"
> "Any* Other Test Data Submission by Testing Laboratory"

Slice 1 built the durable arrival record this reads. Slice 3 adds per-lab expected-submission
windows and the reference's third cell state ("data with date stamp should not have occurred").

---

## ⛔ Attribution goes through the BATCH, not the DiagnosticReport

This is the finding that shapes the slice, and it reverses the assumption slice 1's spec carried
forward.

Slice 1 assumed the grid would attribute an arrival to a laboratory through
`DiagnosticReport.performer`, since that is the only resource carrying a laboratory. **Measured
2026-08-18, that loses 11.5% of all requests and almost every EID request:**

| route | requests reached |
|---|---|
| via `lab_results.specimen_id` then `diagnostic_reports` | 6,652 of 7,520 |
| via `batch_id` then that batch's `diagnostic_reports.performer` | **7,520 of 7,520** |

The 868 it loses are the requests with **no `lab_results` at all**. Their panels:

```
HIVPC   548   HIV Early Infant Diagnosis
RNAHF   143   RNA PCR Haemorrhagic Fever
PCRIN    55   PCR Influenza
HIVVL    26   HIV Viral Load
HIVDR    24   HIV Drug Resistance
COL      15   Specimen Collection
```

**548 of the 550 EID requests in this warehouse — 99.6% — have no results.** That is not a data
defect; it is what an EID workflow looks like, specimens registered and shipped with results arriving
later or not at all. The reference's own footnote counts exactly these:

> "Any HVL/EID data captured when: specimens registered, rejected, tested but not authorized and
> authorized."

So report-based attribution would print an EID grid that is almost entirely empty while those
laboratories were demonstrably transmitting. The report's primary subject is its worst case.

**The batch is the submission**, which is what "Data Submission by Testing Laboratory" means. Safety
measured: **3,713 batches, 0 carrying more than one laboratory, max 1.** And every clinical arrival
type reaches a batch — ServiceRequest, Specimen, Observation and DiagnosticReport all 100%.

⚠ `Patient` arrivals carry no panel, so they cannot be classified HVL/EID or Other and appear in
neither table. A submission's patient always travels with a request in the same batch, so no
submission becomes invisible — but a patient-only bundle, if one ever existed, would not register.

---

## Design

### 1. The cell

**Read ServiceRequest arrivals only.** Measured 2026-08-18: the 3,713 batches carrying a laboratory
and the 3,713 batches carrying a request are **the same 3,713**, and **0 requests sit in a batch with
no laboratory**. So one join path covers everything, with no per-resource-type branching:

```
ingest_events (resource_type = 'ServiceRequest')
  -> lab_requests            on id            -- gives panel_code AND batch_id
  -> diagnostic_reports      on batch_id      -- gives performer, one per batch
  -> facility_map            -- the laboratory's name
```

That matters: an earlier draft of this section said only "whose batch resolves to L", which hid a
four-way branch. An Observation arrival reaches a panel through `lab_results.request_id`, but a
Specimen or DiagnosticReport arrival reaches one only through `lab_results.specimen_id` — which does
not exist for the 868 result-less requests, the very rows this slice exists to include. Reading
ServiceRequest arrivals alone avoids the branch and is the only path that is complete.

For laboratory L, working day D, table T the cell is then:

> does any ServiceRequest arrival exist whose `lab_requests.batch_id` resolves to L, whose
> `recorded_at` falls on D in the configured timezone, and whose `panel_code` is in (T = HVL/EID) or
> not in (T = Other) the run-time panel list.

Two states, rendered as the reference's filled and hollow marks. Slice 3 adds the third.

### 2. Classification — a run-time report parameter

`AGENTS.md` §8 forbids inlining clinical vocabulary into source or SQL. A run-time parameter is
**config supplied at run time, not vocabulary in source**, so it complies. The operator chose it over
a seeded value set, accepting the stated trade-off: the list is retyped per run, and two people using
different lists produce non-comparable grids.

One parameter serves both tables — Other is the complement.

### 3. Timezone — a new `lab.timezone` setting

Days must be bucketed in a civil timezone and CE holds none. `app_settings` has exactly eight keys
(`dashboard.raw_sql`, `lab.logo`, `lab.name`, `report.categories`, three `update.*`, `workflow.*`) —
no timezone.

⛔ **Getting this wrong silently misfiles a whole day.** The dev warehouse's arrivals sit at
`2026-08-05T21:00Z`, which is `2026-08-06 00:00` at +03. Bucketed in UTC, every one of them lands on
the previous day. It is not a rounding error; it is an off-by-one-day on every cell.

A timezone is a property of where the laboratory is, not of a report run, so it is a setting rather
than a parameter — and it joins the existing `lab.*` namespace beside `lab.name` and `lab.logo`.

⚠ **This is genuine added scope, and by §6's own measure it is a second feature.** A new setting
needs a Settings UI control, a CLI equivalent (labs run headless), docs, i18n across en/fr/pt, and a
mobile check — the same five surfaces the report itself needs.

**Kept in this slice deliberately, not by oversight.** Shipping the grid without it means shipping a
report that is silently wrong by one day for every deployment east or west of UTC, and shipping the
setting alone delivers a control that nothing reads. They are a prerequisite pair. If the plan grows
past roughly six tasks, split the setting out and build it first — but do not ship the grid on a
hardcoded UTC assumption.

### 4. Grid shape — 23 fixed day columns, with the dates in a data row

The column count cannot vary per month, and the orientation is forced:

- `transposeResolved` (`packages/report-designer/src/render/draw.ts:239-254`) turns the **first
  column's row values into the new headers**, so a transposed grid needs one SQL column per
  laboratory. Laboratories are unbounded — 88 performers in this warehouse.
- Working days per month are bounded at **23**.
- Rows are always dynamic; columns never are.

So days are the columns, laboratories are the rows, and no transpose is involved. A 20-weekday month
leaves the trailing columns blank.

Headers are therefore static (`d01`..`d23`) and cannot carry dates. Rather than lose the dates —
which is most of the report's value, since "lab 07 went silent on the 14th" must be readable — the
query emits **one synthetic first row carrying the dates**:

```
Laboratory                          d01    d02    d03    d04 ...
(dates)                            1 Jan  4 Jan  5 Jan  6 Jan
01  Bugando Medical Centre           filled filled hollow filled
02  Kilimanjaro Christian Medical    filled hollow filled filled
```

A `UNION ALL` with an ordering discriminator puts it first. No new rendering support is needed.

⚠ `boundColumns` left empty makes a table take its headers from the query's own columns
(`draw.ts:271`, `:348`) — worth knowing, but it does not help here, because a query's column labels
are static in its SQL text and cannot vary by month either.

### 5. Rows — every laboratory that appears in the window

The reference's fixed, numbered list of 21 laboratories is a curated deployment artefact. CE has 88
performers and no such list, and inventing one is slice 3's registry work, not this slice's.

⚠ 88 rows is four times the reference's 21. `TablePagination` is mandatory on every table
(`AGENTS.md` §5) so the studio surface is fine, but the **PDF** will run to several pages where the
reference is one. That is a real difference from the source document, and it follows from CE knowing
more laboratories than the reference's curated list — not from a design choice here.

### 6. Days — weekdays only, no holiday calendar

Monday to Friday, derived from a month parameter. The reference shows **1 January 2021** — a public
holiday — so it applies no holiday calendar, and neither does this.

---

## Verification

**What proves it:** live Postgres, because the whole slice is a set of joins over real data shapes.

- A laboratory that submitted only registrations on a day — no results anywhere — still shows a
  filled cell. This is the finding above and the single most important test: build the fixture from a
  result-less ServiceRequest and assert its cell is filled.
- A day with no arrivals shows hollow, and a lab absent from the window does not appear.
- The timezone boundary: an arrival at `21:00Z` buckets to the **next** day at +03, not the day it
  carries in UTC. Assert both, or the test proves nothing about the setting.
- A month with 20 working days leaves columns 21-23 blank rather than shifting cells left.
- The date row is first, and its cells align with the columns beneath.
- HVL/EID and Other partition the arrivals — no arrival appears in both, none in neither.

**What does not prove it — `AGENTS.md` §7:** pg-mem cannot stand in; it has no correlated-subquery
support and a stable scan order. A hermetic `pnpm test` will **skip** the live tests, and a skipped
run is not a pass. `typecheck` green pins nothing about a report's wire shape — route tests do.

**HONEST NON-PROOF, stated now:** nothing here proves the grid matches the reference document for the
same month, because CE holds neither the 2021 data nor the curated 21-laboratory list. It proves the
grid answers correctly for the data CE has.

---

## Definition of done — `AGENTS.md` §6

1. **UI** — the report in `apps/studio`, following §5. Plus the `lab.timezone` control in Settings.
2. **CLI parity** — `lab.timezone` must be settable from `openldr`; labs run headless. Shared logic in
   `@openldr/bootstrap` so the route and the command call identical code.
3. **Docs** — in-app and web. The in-app tree is English-only, so the translated surface is the i18n
   strings for the new setting, which `parity.test.ts` enforces across en/fr/pt.
4. **Mobile** — the report page at 375×812. ⛔ A 23-column grid will not fit a phone; decide whether it
   scrolls horizontally in its own container or the page offers a narrower reading. Do not report it
   verified from headless Chromium alone where bottom-anchored UI is involved.
5. **Landing changelog** — `pnpm make:changelog` after merging to `main`.

---

## Explicitly not in this slice

- **No third cell state**, and no per-lab expected-submission windows. Slice 3.
- **No page 2** of the reference — the volume tables. Not buildable: `lab_requests.status` holds only
  `completed` (6,991) and `revoked` (529), and `specimens.status` is empty on all 3,713 rows, so
  Registered / Tested / Authorized cannot be distinguished.
- **No curated laboratory list**, no laboratory numbering, and no LIS suffix on names (the reference's
  "- Disa*Lab", "- EVLIMS", "- TilleLab", "- Jeeva"). CE records `source_system = 'webhook-ingest'`
  for all 88 performers and does not know which LIS sent what.
- **No holiday calendar.**
- **No change to `ingest_events`**, the projection, or `reprojectAll`. Slice 1, merged.

## On the list, not fixed

- The `ingest_events` index is `(recorded_at, resource_type)`. Slice 1 justified it by a
  DiagnosticReport filter no code performed yet; this slice filters on **ServiceRequest** instead,
  which the same index still serves. Confirm the plan's query actually uses it rather than assuming.
- `Patient` arrivals cannot be classified and appear in neither table (see above).
