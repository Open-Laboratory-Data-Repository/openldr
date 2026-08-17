# Durable arrival ledger in the warehouse

**Date:** 2026-08-18
**Status:** design, awaiting approval
**Scope:** slice 1 of 3. Projects a per-arrival ledger into the warehouse so reports can answer
"when did this actually reach us". Nothing else.

---

## Why this exists

The operator asked for a monthly LIS stakeholders transmission report: for each testing laboratory,
did any data arrive on each working day of the month. The reference document is
`D:\Documents\OpenLDR\Reports\2021\1 - Monthly LIS Stakeholders Update - 1 to 31 January 2021.pdf`
— itself an OpenLDR v1 artifact (jsPDF 1.5.3, title "OPENLDR"), 21 labs × working-day columns,
three-state cells.

The operator chose **ingest date** semantics: a cell asks "did anything reach OpenLDR from this lab
that day", not "is there data stamped that day".

**CE cannot answer that today, and the obvious column is a trap.**

`lab_requests.created_at` looks like an arrival time. It is not. The projection never writes it —
`projectServiceRequest` (`packages/db/src/relational/service-request.ts:6-21`) writes `id`,
`request_id`, `patient_id`, `panel_code`, `panel_system`, `panel_desc`, `status`, `priority`,
`authored_at` and then spreads `provColumns`, which is exactly four columns — `source_system`,
`plugin_id`, `plugin_version`, `batch_id` (`packages/db/src/relational/extract.ts:5-17`). The
`Provenance` interface carries no timestamp at all
(`packages/db/src/provenance.ts:1-6`).

So `created_at` falls to its column default `now()`: the moment the warehouse row was written.
**`reprojectAll` rewrites every one of them.** Measured on the dev warehouse 2026-08-17: all 7,520
requests carry `created_at` of 2026-08-06 while their `authored_at` values span 2013-03-01 to
2013-11-07 — thirteen years apart.

A transmission report built on that column would show a wall of green on the reprojection date and
nothing anywhere else. Reprojection is routine here; it is the documented fix for adding warehouse
columns. A silently-wrong operational report is worse than no report.

**The durable record already exists.** `fhir.resource_history` holds one row per write to the
canonical store, with `recorded_at`, `version` and `op`. It is written in the same transaction as
`fhir_resources` (`packages/db/src/fhir-store.ts:182`, `:265`). Reprojection reads the canonical
store and writes the warehouse, so it never adds history — the ledger survives it.

It is in the **internal** database. Reports run against the warehouse. That boundary is the same one
that forced `facility_map` to exist. So the ledger must be projected.

---

## The three slices

This spec covers slice 1 only. The other two are recorded here so the decisions are not lost.

| # | Slice | Status |
|---|---|---|
| 1 | **Durable arrival ledger in the warehouse** | this spec |
| 2 | Two-state transmission grid — labs × working days | decisions below, not yet specced |
| 3 | Per-lab expected-submission window + the third cell state | decisions below, not yet specced |

**Decisions already taken by the operator, binding on slices 2 and 3:**

- Page 1 of the reference only — the two transmission grids. Page 2's volume tables are **not
  buildable**: `lab_requests.status` holds only `completed` (6,991) and `revoked` (529), and
  `specimens.status` is empty on all 3,713 rows, so Registered / Tested / Authorized cannot be
  distinguished.
- HVL/EID vs Other is decided by a **run-time report parameter**, not a value set. This is compliant
  with `AGENTS.md` §8 — a parameter is config supplied at run time, not vocabulary inlined into
  source or SQL. The operator accepted the stated trade-off: the list is retyped per run, and two
  people using different lists produce non-comparable numbers.
- Cells mean **arrival**, not data date.
- The third state ("data with date stamp should not have occurred") **is** wanted, via per-lab
  windows entered in the facility registry. `facility_registry` has no onboarding or decommission
  column today (verified: 24 columns, none temporal beyond `created_at`/`updated_at`).

---

## Design

### 1. The table

`ingest_events` in the warehouse (external schema), mirroring the canonical ledger:

```
resource_type   text        not null
resource_id     text        not null
version         bigint      not null
recorded_at     timestamptz not null
primary key (resource_type, resource_id, version)
```

The primary key is the same natural key as `fhir.resource_history`'s, so the projector upserts and
is safely re-runnable. That idempotence is what lets the live path and the rebuild path write the
same table without coordinating.

**No provenance columns, deliberately.** `resource_history` does not carry `source_system`,
`batch_id` or the plugin fields — those live on `fhir_resources` and describe the *current* version,
not the version that arrived. Copying them onto a historical row would attach today's provenance to
yesterday's arrival. If a later slice needs per-arrival provenance, the honest fix is to add it to
`resource_history` upstream, not to infer it here.

### 2. Which rows

Clinical resource types only: `ServiceRequest`, `Specimen`, `Observation`, `DiagnosticReport`,
`Patient`. Measured on the dev warehouse:

| resource_type | history rows | resources | versions each |
|---|---|---|---|
| Observation | 46,086 | 22,915 | 2.0 |
| DiagnosticReport | 15,196 | 7,520 | 2.0 |
| ServiceRequest | 15,196 | 7,520 | 2.0 |
| Patient | 8,158 | 3,714 | 2.2 |
| Specimen | 7,759 | 3,713 | 2.1 |
| — excluded — | | | |
| Organization | 4,132 | 89 | **46.4** |
| Questionnaire | 1,302 | 14 | **93.0** |
| Location | 399 | 1 | **399.0** |

~92,000 rows in scope here. The exclusions matter: config and reference resources churn 46× to 399×
because they are re-saved by seeding and admin edits. Including them would let one operator editing
a Questionnaire look identical to a laboratory transmitting, and they would dominate the table.

⚠ The uniform 2.0 across every clinical type is worth noting rather than assuming away: it means
each clinical resource was written exactly twice in this dataset, most likely an ingest followed by
a re-ingest of the same bundles. It does **not** mean labs amend results twice. The slice does not
depend on the number, but anyone reading arrival counts should know it.

### 3. Getting the laboratory — not in the projector

`ingest_events` stays a dumb mirror. The report joins it to `diagnostic_reports` on `resource_id`
where `resource_type = 'DiagnosticReport'`, and reads `performer`, reusing the facility resolution
built for the clinical microbiology report (`facility_map` → `facilities`, keyed on
feed + namespace + code).

Rationale: no jsonb extraction in the projector, no second copy of facility logic, and the projector
stays a mechanical mirror of the ledger — which is what makes its rebuild verifiable.

⛔ **Two consequences to state plainly, not discover later:**

1. `diagnostic_reports.performer` is the **current** performer. A laboratory whose identity changed
   between versions attributes its whole arrival history to its current identity. Acceptable here —
   0 of 3,713 specimens disagree on performer — but it is a property of current data, not a
   guarantee.
2. Attribution runs **through the DiagnosticReport**. An arrival of an Observation or Specimen
   carries no lab of its own. Measured 1:1 today — 7,520 ServiceRequests and 7,520
   DiagnosticReports — so every submission carries one. **The reference's footnote says data counts
   when specimens are merely "registered", and it is not established that a registration-only
   submission produces a DiagnosticReport.** Slice 2 must check that against a real feed before
   relying on it; if registrations arrive without a report, the grid will under-report and the fix
   belongs in slice 2's attribution, not here.

### 4. The two write paths

Projection is CQRS. `fhir.change_log` drives a cursored runner
(`packages/db/src/projection/cycle.ts:65-84`), and `reprojectAll` (`:87`) rebuilds the read model
from the canonical store. Both funnel through the relational writer, which is the single choke point
this design depends on.

- **Live path.** New arrivals ride the existing change_log → relational writer path, and the writer
  gains an `ingest_events` upsert.

  ⛔ **The task carries neither field today, and this is the second piece of new machinery.**
  `ProjectionTask` is exactly `{ resourceType: string; id: string }`
  (`packages/db/src/projection/plan.ts:18-21`). `applyProjection` then calls `getWithProvenance`,
  which reads the **current** canonical row (`packages/db/src/projection/cycle.ts:39-42`) — so the
  live path knows *which* resource changed but not *which version* arrived or *when*. Writing an
  arrival event needs one of:
  - thread the change_log row's version and timestamp into `ProjectionTask` — a change to a shared
    type used by `planProjection`, the gap logic and the cursor, or
  - read the version and `recorded_at` from `fhir.resource_history` at apply time — leaves
    `ProjectionTask` alone at the cost of a read per projected resource.

  **RESOLVED 2026-08-18 — read from `fhir.resource_history` at apply time.** `ProjectionTask` is
  left alone. It is a shared type that `planProjection`, the gap logic and the cursor all depend on,
  and that logic exists because of real ordering bugs around gaps and snapshot boundaries; widening
  it to carry two more fields puts that correctness at risk to save one indexed read. The lookup is
  on `resource_history`'s primary key `(resource_type, id, version)` — or, since apply time knows
  only the resource, on `(resource_type, id)` taking the greatest version.

  ⚠ That "greatest version at apply time" is a real subtlety the plan must handle: if two versions
  of one resource arrive between projection cycles, the live path sees one task and would record
  only the newest arrival. The rebuild path records both. So live and rebuild can legitimately
  disagree until the next rebuild. Either record every version not yet in `ingest_events` for that
  resource rather than only the newest, or accept and document the divergence. The plan must pick
  one; recording every missing version is the one that makes live and rebuild agree.
- **Rebuild path — the one genuinely new piece of machinery.** `reprojectAll` scans
  `fhir_resources`, which holds only **current** versions. It structurally cannot rebuild an arrival
  ledger from that source. It needs a second scan, over `fhir.resource_history`, filtered to the
  clinical types above.

That second scan is the highest-risk item in the slice and the thing most likely to be got wrong. It
is also the thing the verification below exists to prove.

---

## Verification

**What proves it:** a live-Postgres test that does the contrast, because the contrast *is* the
feature.

1. Ingest a bundle. Record `ingest_events` and the warehouse `created_at` values.
2. Run `reprojectAll`.
3. Assert `ingest_events` is unchanged — same rows, same `recorded_at` — while the warehouse
   `created_at` values have moved to the reprojection time.

Step 3's second half is not decoration. It is the demonstration that the old column was never usable
and the new table is.

Further tests: idempotence (running the rebuild twice changes nothing), type filtering (an
Organization edit produces no ingest_event), and that a second version of one resource produces a
second row rather than replacing the first.

**What does not prove it — `AGENTS.md` §7:** pg-mem cannot stand in. This slice is about behaviour
across two write paths and a real rebuild, and pg-mem has no correlated-subquery support and a
stable scan order. `typecheck` green proves nothing here. A hermetic `pnpm test` will **skip** the
live test; a skipped run is not a pass.

**HONEST NON-PROOF, stated now:** nothing in this slice proves the ledger is *complete* against a
real laboratory feed. It proves the ledger mirrors `resource_history` and survives reprojection.
Whether `resource_history` itself records every transmission a lab makes — in particular a
registration-only submission — is a question about the ingest path, and it is slice 2's to answer.

---

## Definition of done — `AGENTS.md` §6

1. **UI** — none. This slice adds no user-facing surface; it is a warehouse table and a projector.
   Stated explicitly so its absence is not read as an omission.
2. **CLI parity — the capability exists but is misnamed. Rename, do not duplicate.**

   ⚠ Two earlier drafts of this section were wrong, in opposite directions. The first said
   `reprojectAll` is reachable from the CLI; the second said it is not. **The accurate position:
   `openldr terminology reproject` already calls the general `reprojectAll` and rebuilds the ENTIRE
   read model** — patients, lab_requests, lab_results and the rest, not only `terminology_codes`.
   Its own code comment says so (`packages/cli/src/terminology.ts:163-167`), written after someone
   read its count as "8692 terminology rows" when the dimension held 2,025. But its registered
   description (`packages/cli/src/program.ts:530`) reads "Rebuild terminology_codes (the warehouse
   ValueSet dimension) from canonical FHIR", so the command is filed and documented as
   terminology-scoped while behaving globally.

   So this is a naming defect, not a missing capability. Adding a second command that calls the same
   function would be the duplication `AGENTS.md` §6 explicitly forbids.

   **RESOLVED 2026-08-18 — one implementation, correctly named.**
   - `openldr db reproject` becomes the real command: rebuilds the whole read model from the
     canonical store, including the new arrival ledger.
   - It is **destructive-shaped** — it rewrites the read model and every warehouse `created_at`
     moves — so per §6 it refuses without `--force`, and audits as `actorName: 'cli'`.
   - `openldr terminology reproject` becomes a thin **deprecated alias** so existing runbooks and
     scripts keep working, and its description is corrected to say what it actually does.
   - Shared logic stays in `@openldr/bootstrap` so the command and any route call identical code.

   ⚠ The existing command has **no `--force` guard today** despite already rebuilding everything.
   Adding one to the alias is a behaviour change for anyone scripting it. The plan must decide
   whether the alias inherits the guard or keeps its current unguarded behaviour until removal;
   inheriting it is safer and is the recommendation, but it will break an unattended script.
3. **Docs** — the in-app docs tree is English-only (`apps/studio/src/docs/0.1.0/en/`), so the
   translated surface for this slice is any new i18n string, of which there should be none. Document
   the table and the rebuild where reprojection is already documented.
4. **Mobile** — not applicable, no UI.
5. **Landing changelog** — `pnpm make:changelog` after merging to `main`.

---

## Explicitly not in this slice

- **No transmission report.** That is slice 2.
- **No per-lab windows, no third cell state.** That is slice 3.
- **No provenance on arrival rows.** See §1 — it would attach current provenance to a historical
  arrival. If wanted, fix `resource_history` upstream.
- **No change to `fhir.resource_history`**, the canonical store, or the ingest path.
- **No retention or pruning policy.** The table grows with ingest volume. It is a mirror of a table
  that already grows the same way, so this slice does not create the growth — but it does not solve
  it either, and a national-scale deployment will eventually want an answer.

## On the list, not fixed

- `ingest_batches` in the internal database has a `batch_id`/`created_at` shape that looks purpose-
  built for exactly this question, and holds **0 rows** — the DISA data was loaded by a path that
  never wrote it, while `lab_requests.batch_id` is populated on all 7,520 rows with 3,713 distinct
  values. Either that table is dead or the webhook path should be writing it. Worth knowing before
  someone builds a second arrival record on top of it.
