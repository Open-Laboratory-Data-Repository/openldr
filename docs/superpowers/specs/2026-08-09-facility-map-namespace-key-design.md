# `facility_map` keyed by the observed coding namespace

Date: 2026-08-09
Status: designed, not implemented.
Source: `docs/audit/2026-08-07-facilities-page-audit.md` (external audit by Codex) — **FAC-P0-07**,
i.e. Phase 0 item 5. The last remaining Phase 0 item.
Predecessors: `docs/superpowers/specs/2026-08-07-facilities-phase-0-design.md` (items 1–4, merged as
`8af8c245`) and `docs/superpowers/specs/2026-08-08-facility-durable-updates-design.md` (item 6,
merged as `db36e4cb`). This spec depends on the second one's `facility_jobs` worker.

## Purpose

Facility **resolution** distinguishes two facilities by their coding namespace. The report-facing
**dimension** and the **report join** do not. So a distinction the resolver is careful to preserve is
thrown away one layer later, in two different ways, both silent.

This closes it by making `facility_map` keyed on the raw observed wire tuple — feed, namespace, code
— which is exactly what the report join has available to match on.

## Scope

In scope: FAC-P0-07 — the dimension's natural key, the report join, the publish fan-out, and the
upgrade path for an existing install.

Explicitly **out of scope**, all pre-existing and none created here:

- `facilities repair-links` (two facilities sharing a projection link).
- A settle path for `facility_mapping_conflicts.resolved_at` — still has no writer anywhere.
- Retry backoff on the facility job worker (5 attempts on a fixed 3 s tick, stated honestly in the
  predecessor spec).
- Audit Phases 1–3: the facility Resolve sheet, removing `Browse`, server pagination, background
  imports, retire/merge, accessibility.
- The `facility_of` CTE's independent-`min()` pairing hazard — see "Known limits" below. This spec
  inherits it and says so; it does not fix it.

## Measured before designing

Live dev analytics database, re-measured 2026-08-09 (the predecessor's 2026-08-08 figures reproduce
exactly):

| Fact | Value |
|---|---|
| `diagnostic_reports` rows | 7 520 |
| rows with `performer_system` | 7 520 |
| **distinct `performer_system`** | **1** (`urn:openldr:default_fac`) |
| **distinct `source_system` (feed)** | **1** (`webhook-ingest`) |
| distinct `performer` | 88 |
| `facility_map` rows | **88** (1 with a `registry_id`) |
| max length: `source_system` / `source_code` / `id` | 14 / 5 / 20 |

**This defect is LATENT, not live.** With one namespace and one feed nothing can collide today, and
nothing in any report is currently wrong because of it. It becomes live the moment a second LIS or a
second performer namespace appears. This is correctness hardening, and the plan should not pretend
otherwise.

## The defect, verified

### Direction A — one feed, two namespaces (the audit's finding)

`resolveObservedFacilities` folds on `(resolvedSystem, code)`, where
`resolvedSystem = performer_system ?? observedSystemForFeed(source_system)`
(`facility-reconcile.ts`, `resolvedObservedSystem`). Two rows sharing a code under genuinely
different namespaces are correctly kept apart — that separation is the entire point of the per-feed
system work.

But `facilityMapId(sourceSystem, sourceCode)` (`packages/db/src/facility-observed.ts`) derives the
dimension key from the **feed** only. Both rows therefore land on one `facility_map.id`, and
`publishFacilityMap` **silently drops one** with a `Set`-based filter. The code documents the
collision honestly and then discards data anyway.

⚠ The audit cites `facility-reconcile.ts:660-678` for this and the brief repeats it. Both are stale:
the dedupe is at **`facility-reconcile.ts:798-816`**.

### Direction B — two feeds, one namespace (NOT in the audit; found while verifying)

The same fold runs the other way, and this direction is not mentioned in the audit, the brief, or any
prior spec.

Two feeds emitting the same code under the same wire `performer_system` fold into a **single**
`ResolvedFacility`, whose `sourceSystem` is only the **representative** feed chosen by the
display/count/alphabetical tiebreak. Publish writes one `facility_map` row, for that one feed. The
report join is `fm.source_system = coalesce(dr.source_system, '')`, so **the losing feed's reports
match nothing** and fall back to the raw performer code.

No collision, no dedupe, no warning — the curated mapping simply never reaches half the reports.

The codebase already knows this fold happens: `apps/server/src/facilities-routes.test.ts` has a test
named *"reports the SUMMED reportCount for two feeds sharing a wire performer_system but differing
source_system"*. Nobody checked that publish can only emit one of those feeds.

⇒ **A design that only widens the key fixes A and leaves B.** Both are in scope here.

### The constraint that decides the design

`observedSystemForFeed` is a TypeScript slugify-with-hash-fallback. **It cannot be expressed in
SQL.** At report time the join has only `dr.source_system` and `dr.performer_system`, so it can never
compute the resolver's fold key. It can only match on raw wire columns. That is why the dimension's
grain moves to the raw tuple rather than the resolved one.

## Design

### 1. Grain and key

`facility_map` becomes **one row per raw observed wire tuple**: `(source_system, performer_system,
source_code)` — feed, namespace, code, each read straight off `diagnostic_reports`.

**Column name: `performer_system`**, identical to `diagnostic_reports`. The join then reads
`fm.performer_system = coalesce(dr.performer_system, '')`, self-evidently a wire-column match. A name
like `source_namespace` sitting beside `source_system` would invite exactly the feed-versus-namespace
confusion that caused this defect.

**NULL handling — store `''`, join `coalesce(..., '')`.** `performer_system` is nullable on
`diagnostic_reports`, and `NULL = NULL` is false in SQL. This mirrors the existing
`coalesce(dr.source_system, '')` in every one of these joins, which exists for precisely this reason
and is already pinned by tests. The column is `NOT NULL DEFAULT ''`, keeping migration 012's stated
discipline that both key columns are NOT NULL because `FacilityMapTable` types them `string`.

**The index is deliberately NOT widened.** `facility_map_source_idx` stays `(source_system,
source_code)`.

- MSSQL: `keyType` is `varchar(450)`; three would be 1350 of the 1700-byte nonclustered cap — fine.
- MySQL: `keyType` is `varchar(255)` utf8mb4 ≈ 1022 bytes each; three would be ≈ 3066 of 3072.
  **Single-digit bytes of headroom, arithmetic only — not measured against a real MySQL.**

The existing two-column pair already narrows to about one row, so widening buys nothing and would
stake the migration on an unmeasured byte budget. Not touching it sidesteps the question entirely.
The synthetic `id` primary key is unchanged, so migration 012's 900-byte clustered-PK reasoning is
untouched.

### 2. Why the collision becomes impossible rather than rarer

`resolvedSystem` is a **pure function of `(performer_system, source_system)`**. So any raw tuple
`(feed, ns, code)` maps to exactly one fold key. Therefore:

- two distinct `ResolvedFacility` rows **cannot** share a raw tuple, and
- two observations within one `ResolvedFacility` are distinct by construction.

The raw grain is a strict **refinement** of the resolution grain — never coarser — so nothing merges,
and `facilityMapId(feed, ns, code)` is unique by construction.

⇒ The `seenIds` filter at `facility-reconcile.ts:811` becomes dead code. It is replaced by a
**throw**, not a filter. This is the audit's *"never resolve a collision by first-row-wins
deduplication"*: there is no collision left to resolve, and if the invariant is ever broken the
publish fails loudly instead of discarding a facility.

Note the raw grain can legitimately produce **two rows carrying identical resolution** — e.g. feed
`webhook-ingest` with `performer_system` NULL and with an explicit `urn:openldr:default_fac` both
resolve to the default system. That is correct and harmless: both rows join, both name the same
facility. Refinement never loses information.

### 3. Publish fan-out

`ResolvedFacility` gains:

```ts
/** Every raw wire tuple that folded into this resolved facility. One `facility_map` row is
 *  emitted per entry, all sharing this row's resolution. */
observations: { sourceSystem: string; performerSystem: string }[];
```

accumulated **inside the existing fold loop**, not re-queried. `publishFacilityMap` flat-maps over it.

⛔ Publish must **not** re-query `diagnostic_reports` for the raw groups. That is precisely the
anti-pattern `resolveObservedFacilities`' own doc comment records as having already caused a bug — a
route re-deriving its own grouping, whose key drifted from the fold key and dropped a feed's
contribution. One owner of the grouping.

`facilityMapId` gains a third parameter — `facilityMapId(sourceSystem, performerSystem, sourceCode)`
— keeping its existing shape: readable while it fits `MAX_ID_LENGTH`, djb2-hashed when it does not.
It must stay deterministic, because a re-publish recomputes it.

The representative `sourceSystem` field stays as it is, so the Observed tab's
`` `${sourceSystem}|${sourceCode}` `` React key, `reportCount`, and the `/api/facilities/observed`
route are all untouched.

This is what fixes **direction B**: each feed now gets its own dimension row.

### 4. Migration 015 and the upgrade path

Next external migration number is **015** — `014_facility_location.ts` is verified as the last.

**`015_facility_map_performer_system`:**

1. Add `performer_system` as `keyType`, `NOT NULL DEFAULT ''`.
2. One correlated `UPDATE` backfilling from `diagnostic_reports`:
   `performer_system = coalesce((select min(dr.performer_system) from diagnostic_reports dr
   where coalesce(dr.source_system,'') = facility_map.source_system
     and dr.performer = facility_map.source_code), '')`.

⛔ **The migration cannot split rows.** `facility_map.id` is `facilityMapId`, a djb2 hash above
`MAX_ID_LENGTH = 200` — a TypeScript function with no SQL equivalent. A migration cannot mint ids for
rows it would create. So the backfill only *sets the namespace on rows that already exist*. On
today's data that is exactly correct (one distinct namespace ⇒ `min` is the value). Where a code
genuinely spans two namespaces the backfill is lossy in a specific, bounded way: SQL `min` ignores
NULLs, so it takes the alphabetically first *non-null* namespace and the row for any other namespace
sharing that `(feed, code)` is left unrepresented until the rebuild below recreates it.

**Why a backfill at all, and why it is not optional:** adding the column with `''` and waiting for
the next publish is *measurably harmful*. All 7 520 live rows carry
`performer_system = 'urn:openldr:default_fac'`, so a join comparing that to a backfilled `''` fails
for **all 88 dimension rows**. Every report would lose its resolved facility name and fall back to
the raw code, immediately on upgrade. The backfill is what prevents the fix from shipping a
regression.

**The safety net:** `bootstrap()` in `packages/bootstrap/src/index.ts` enqueues one
`facility-map-rebuild` immediately after `facilityJobs` is constructed (`index.ts:875`).
Unconditional and best-effort — a `.catch()` that logs and never aborts boot — mirroring the
`seedColumnExposurePolicy` call ~340 lines above it, which is the established precedent for
"unconditional on every boot, best-effort, needs a db handle". At most one job per boot; a queued
rebuild absorbs a repeat through the existing coalescing.

⛔ **Not `seedEssentials`.** An earlier draft of this spec put it there and was wrong:
`EssentialSeedTarget` is a forms/workflows surface with **no db handle**, and `index.ts` already
carries a comment explaining that this exact class of boot-time seed is deliberately *not* routed
through `seedEssentials`/`seedDatabase` — those are gated behind `SEED_ON_START` for optional demo
data. Corrected by reading the code rather than the spec.

This also fixes a chip that would otherwise lie, **with no change to `facilityHealth`'s rule**.
`stale` is defined purely as *last successful rebuild older than the last `facility_registry` /
`term_mappings` mutation* — a schema change touches neither table, so an upgraded install would
otherwise read **Current** over a dimension of obsolete grain. A pending rebuild makes it read
**Updating**, which is honest.

⚠ Nothing else enqueues on upgrade. Every existing `facility-map-rebuild` enqueue is a facility or
mapping *mutation* (HTTP routes, CLI import, `facility-import.ts`). Verified.

### 5. Report SQL — 9 strings, 3 query families

| Query | Joins via | Dialects |
|---|---|---|
| `q-facilities` | `diagnostic_reports` directly | postgres / mssql / mysql |
| `q-amr-facility-summary` | `facility_of` CTE | postgres / mssql / mysql |
| `q-clinical-micro-header` | `facility_of` CTE | postgres / mssql / mysql |

Each join gains `and fm.performer_system = coalesce(<alias>.performer_system, '')`. The two CTE-based
families additionally need `min(performer_system) as performer_system` in `facility_of`.

Four existing tests pin the current join text by regex in
`packages/reporting/src/seed/report-seeds.test.ts` and must be updated in step.

`SEED_QUERIES` uses **managed-overwrite** — create-if-absent, else refresh when the stored SQL
differs from the shipped definition (`report-seeds.ts`, `seedDataDrivenReports`). So the new SQL
reaches existing installs on `db seed`; no stale-seed migration is needed.

**Report Designer needs no change.** No `facility_map` reference exists anywhere outside
`report-seeds.ts`; `SEED_DESIGNS` bind to query *ids*. The audit's "carry that system through
report-designer datasets" requirement is already satisfied by the query change alone.

### 6. Governance

`facility_map` **is** in `EXTERNAL_TABLE_COLUMNS` (`packages/db/src/schema/external.ts`), whose test
is exhaustive on purpose, so the new column must be added there deliberately.

It is **not** in `GOVERNED` (Settings → Data Exposure, `apps/server/src/dashboards-routes.ts`) and
**not** in the query builder's joinable tables or query models
(`packages/dashboards/src/models/registry.ts`). This spec leaves both as they are — exposing the
dimension to the builder is a separate product decision, not a consequence of re-keying it.

## Testing

Every test mutation-proven: break the behaviour it pins, watch it fail, restore in place.

**Both failure directions, end to end.** Following the predecessor's proven pattern —
import `SEED_QUERIES` and execute the shipped SQL **verbatim**, never a hand-copied join, so the
assertion cannot drift from what reports actually run:

1. **Direction A** — one feed, two namespaces, same code ⇒ two dimension rows; each report resolves
   to *its own* facility. Fails today by silent drop.
2. **Direction B** — two feeds, one shared wire namespace, same code ⇒ two dimension rows; **both**
   feeds' reports resolve. Fails today by silent miss.
3. **NULL namespace** — a report with `performer_system` NULL still joins, via the `''` convention.
   This is the class of bug that produced a silent `reportCount: 0` in an earlier slice.
4. **The uniqueness invariant** — publish **throws** rather than dropping, proven by forcing a
   duplicate rather than by asserting the happy path.
5. **Migration 015** — backfill correctness on real Postgres, including a `facility_map` row with no
   matching `diagnostic_reports` row (⇒ `''`).
6. `EXTERNAL_TABLE_COLUMNS` updated, exhaustive test green.

**Live verification on real Postgres before this is called done.** pg-mem hid a bound parameter in a
`CREATE INDEX` predicate that would have failed every real install, and reports
`numInsertedOrUpdatedRows: 1` after a skipped `onConflict().doNothing()`. External-migration tests
are Postgres-only.

## Known limits, stated rather than implied away

- **MSSQL and MySQL correctness of the backfill `UPDATE` rests on live verification, not the gate.**
  External-migration tests run against Postgres only. The statement is written to be portable (a
  correlated scalar subquery over a *different* table, which all three engines accept), but CI proves
  Postgres alone.
- **The `facility_of` CTE folds with independent `min()` per column**, so it can already pair one
  row's `performer` with another row's `source_system`. Adding `min(performer_system)` inherits that
  hazard. It does not create it, and this spec does not fix it.
- **The MySQL index budget is arithmetic, not a measurement.** It is only load-bearing if someone
  later widens the index; this spec does not.
- **The backfill cannot split a row** when one `(feed, code)` genuinely spans two namespaces — it can
  only relabel the single row that exists. Impossible on today's data, and always superseded by the
  safety-net rebuild, which is why the rebuild is part of this design rather than an optimisation.
- **This fixes a latent defect.** No current report is wrong. The value is that a second feed or
  namespace can now arrive without silently corrupting the facility dimension.

Related: `docs/superpowers/specs/2026-08-07-facilities-phase-0-design.md`,
`docs/superpowers/specs/2026-08-08-facility-durable-updates-design.md`,
`docs/superpowers/specs/2026-08-05-facility-reconciliation-design.md`.
