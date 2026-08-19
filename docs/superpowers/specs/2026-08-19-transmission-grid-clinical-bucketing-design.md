# LIS Stakeholders Update: bucket by clinical date, not arrival

**Status:** designed, not started. Operator approved on 2026-08-19.

**Supersedes one decision** in `2026-08-18-transmission-grid-design.md`: the day a cell represents.
Everything else in that spec stands, including the batch attribution route, the 23 fixed working-day
columns, the run-time panel parameter, and the exclusions listed under "Explicitly not in this slice".

## Why

The report today marks a cell when data *arrived* at the central system. After a bulk load of
13,193 historical DISA labs on 2026-08-19, every mark landed in one column, 19 August 2026, while
the clinical work spanned 2013 to 2019.

That is not a rendering fault. The report answered the question it was built to answer. The
problem is what a reader concludes from it. A grid showing August 2026 activity for work recorded
in 2013 tells stakeholders a laboratory was transmitting in a month when it was not.

Measured on the loaded warehouse, 2026-08-19:

| Bucketed by | Range | Distinct days |
|---|---|---|
| arrival, `ingest_events.recorded_at` | 2026-08-19 to 2026-08-19 | 1 |
| clinical, `lab_requests.authored_at` | 2013-03-01 to 2019-01-15 | 474 |

The prior system solved this already. `WebProt.Provider.Plugin.OpenLDR/Helpers/Transmission.cs`
buckets on the first clinical timestamp falling inside the requested month, in the order
registered, tested, authorised. It had an arrival column available, `Requests.DateTimeStamp`, and
passed it over. The v1 data shows why: 199 distinct arrival days against 1,195 clinical days for
the same request set, with 32,697 rows stamped on 2019-01-14 alone. Arrival stamps were lumpy
there for the same reason they are lumpy here.

## The date rule

For each request, for the requested month, take the first of these whose date falls inside it:

1. `lab_requests.authored_at` (registered)
2. earliest `lab_results.result_timestamp` for that request (tested)
3. `diagnostic_reports.issued` (authorised)

A request with none of the three inside the month does not appear. This mirrors the old `ELSE 0`
branch and its `<> 0` filter.

**One mark per request per month, not one per event.** A request registered on the 3rd and
authorised on the 7th marks the 3rd only, because the `CASE` stops at its first match. The
operator confirmed this on 2026-08-19: "keep it faithful, one mark per request". A denser grid
marking every day of activity is a different report and is out of scope.

A request can still appear in two different months. Registered 28 March, tested 2 April marks day
28 of the March run and day 2 of the April run. That is the old behaviour and it is correct. The
laboratory did show activity on both days.

## Day extraction

`left(<timestamp>, 10)`.

All three columns store ISO 8601 strings carrying the source offset, applied at ingest by the CDR
toolchain's `--ce-tz`. Sample shape: `2013-06-03T15:10:00+03:00`. The date part is the
laboratory's own calendar day.

Do not convert to a viewer zone. The day a laboratory registered a specimen is a fact about that
laboratory's calendar. Converting it makes one historical cell render differently for two readers,
a milder form of the problem this change exists to fix. Taking the date part also degrades safely
if a source writes a timestamp with no offset.

## Parameters

`month` and `panels` stay. `tz` is removed from both queries, from the report record, and from the
design's Time zone meta row.

Drift propagates to installs that already have the report. `report-seeds.ts:3798` calls
`customQueries.update(q.id, { sql: wantSql, params: q.params })`, so both the SQL and the
parameter list refresh on reseed.

## Attribution

The laboratory name keeps the existing batch route,
`diagnostic_reports.batch_id = lab_requests.batch_id` then `facility_map`, including the `distinct`
that collapses the fan-out. The 2026-08-18 spec measured and justified that route. Do not swap it
while changing something else.

Step 3 of the ladder needs `diagnostic_reports.issued` per request rather than per batch.

**Resolved 2026-08-19. The id match is an artefact, not a guarantee.**
`packages/db/src/relational/diagnostic-report.ts:13` sets `id: String(r['id'])`, the wire id. It
equals `lab_requests.id` on all 23,285 rows only because the CDR toolchain mints one `obrId` for
both resources (`fhir-transform.ts:225` and `:242`). Another source need not.

`min(issued)` over the batch is not a usable fallback either. A batch carries up to 15
`diagnostic_reports`, so it would attribute one report's authorisation date to a different request.

The real link is on the wire and simply is not projected. `fhir-transform.ts:250` emits
`basedOn: [{ reference: 'ServiceRequest/<obrId>' }]`, and CE already projects `basedOn` for
Observation (`observation.ts:16`, as `request_id`) and QuestionnaireResponse
(`questionnaire-response.ts:26`, as `based_on_id`). DiagnosticReport is the gap.

So this slice adds `based_on_id` to `diagnostic_reports`, following that established pattern, and
joins step 3 through it. That brings a migration (next free number is 017, no unmerged branch
claims it), a schema type change, a projection change, and a reprojection of existing warehouses.

Step 3 is not droppable to avoid that work. Measured on the loaded warehouse, `issued` falls in a
month where neither registration nor any result falls for **6,950 of 21,309** requests. A two-step
ladder would silently lose a third of the authorised-month activity.

`ingest_events` leaves both queries entirely. The month window comes from the clinical dates.

One caveat from the 2026-08-18 spec disappears as a side effect. `Patient` arrivals carry no panel
and appeared in neither grid. Reading `lab_requests` directly rather than `ingest_events` removes
that path, so the classification gap it described no longer exists.

## Scope

Two queries in `packages/reporting/src/seed/report-seeds.ts`: `q-transmission-hvleid` and
`q-transmission-other`. They stay a partition of the month, so no request-day lands in both grids
or in neither.

Plus the warehouse change the ladder's third step needs: migration `017`, the
`DiagnosticReportsTable` type in `packages/db/src/schema/external.ts`, and
`packages/db/src/relational/diagnostic-report.ts`. Existing installs need
`openldr db reproject --force` to populate the new column, since a migration adds it empty.

Unchanged: the 23 fixed working-day columns, Mon to Fri, no holiday calendar, the leading
`(dates)` row, the `ord` sort column, and the printed page layout.

Still out of scope, unchanged from 2026-08-18: page 2's volume tables, the third cell state,
per-lab expected-submission windows, a curated laboratory list, LIS suffixes on names, and a
holiday calendar. Page 2 remains blocked for its own reason, which is that `lab_requests.status`
holds only `completed` and `revoked`. That is a status-column limit and is unrelated to the
timestamp columns this change reads.

## Wording

Both of these describe arrival and stop being true:

- the report description, `report-seeds.ts:3664`
- the page footer, `report-seeds.ts:339`

New wording: a filled cell means the laboratory registered, tested or authorised work that day.

`apps/studio/src/docs/0.1.0/{en,fr,pt}/reports.md` carries the same claim in three places,
including a timezone troubleshooting bullet at `en/reports.md:50` that loses its subject once `tz`
is gone. All three languages ship together. A missing key renders as literal braces, so a partial
translation ships visibly broken.

## Tests

`packages/reporting/src/seed/transmission-grid-live.test.ts`, 381 lines. Its fixtures seed
`ingest_events`. Those become clinical timestamps. The grid-shape and PDF-layout assertions stand.

`packages/reporting/src/seed/transmission-grid-tz-live.test.ts`, 174 lines. Its subject is gone.
Rewrite it to assert the replacement rule: a stored offset governs the day, and the server's
session zone cannot move it.

Two new cases:

- the ladder falls through to step 2 when registration sits outside the month but a result sits
  inside it
- one mark per request per month, at the highest-priority in-month date

Both files run against real Postgres through `pg` and `PostgresDialect`. pg-mem could not run
them: it has no correlated-subquery support.

## Definition of done, AGENTS.md §6

1. **UI.** No work. The report renders itself from the seeded design.
2. **CLI parity.** Documentation only. `openldr report run r-transmission-grid` loses one parameter.
3. **Docs.** `reports.md` in en, fr and pt.
4. **Mobile.** No surface. The 23-column grid question belongs to the 2026-08-18 slice.
5. **Landing changelog.** `pnpm make:changelog` after merging to `main`, as a `fix`.

## What this change gives up

"Did this laboratory transmit to us today" stops being answerable from this report. Under arrival
bucketing it was. That is the trade the operator accepted. A laboratory that does its work on
Monday and transmits on Friday now marks Monday, and a silent transmission link is invisible here.

Steady-state operation hides the difference, since a laboratory sending daily has its clinical and
arrival dates close together. The two diverge on backfills and outages, which is where the
misleading reading appeared.
