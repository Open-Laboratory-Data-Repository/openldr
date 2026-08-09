# Registry at national scale — server paging, search, filters

Date: 2026-08-09
Status: designed, not implemented.
Source: `docs/audit/2026-08-07-facilities-page-audit.md` (external audit by Codex) — **FAC-P1-01**.
Predecessors: the three Phase 0 slices — `docs/superpowers/specs/2026-08-07-facilities-phase-0-design.md`
(`8af8c245`), `.../2026-08-08-facility-durable-updates-design.md` (`db36e4cb`), and
`.../2026-08-09-facility-map-namespace-key-design.md` (`731608ea`, follow-up `eada67e3`).
**Phase 0 is complete; this opens Phase 1.**

## Purpose

The Registry tab asks the server for at most 2 000 facilities and renders every one of them into the
DOM. A national master facility list runs 10 000–15 000 rows, so most facilities are simply
unreachable in the page, and the page cannot say how many it is hiding.

This makes the registry navigable at national scale: server-side paging with an authoritative total,
search, filters, and linkable URL state.

## Scope

In scope: **FAC-P1-01 only.**

Explicitly **out of scope**:

- **A2 — the import pipeline** (FAC-P1-02 background import jobs, P1-03 preview showing real database
  impact, P1-05 validation hardening). A2 is the write path; this is the read path. They share the
  registry and nothing else.
- **Sub-project B — lifecycle and identity** (P1-04, 06, 07, 08, 09, 18): retire/merge over delete,
  duplicate detection, source badges and change history, canonical status/level vocabularies,
  optimistic concurrency.
- **Sub-project C — the Resolve workflow** (P1-11 to P1-16).
- **Sub-project D — governance and config** (P1-10, P1-17).
- **FAC-P1-19/20 — states and action placement.** P1-20 in particular conflicts with this
  application's standing convention that every action lives in a `⋯` `DropdownMenu`; the operator has
  chosen to revisit that as its own app-wide question rather than settle it inside a Facilities
  slice. **This slice adds no action controls at all** — only inputs (a search box, filter selects, a
  pager) — so it neither depends on nor pre-empts that decision.

## Measured before designing

Live dev internal database and current code, 2026-08-09:

| Fact | Value |
|---|---|
| `facility_registry` rows on dev | **1** |
| Observed facility concepts | 152 |
| Client-requested cap (`FACILITIES_LIST_LIMIT`, `apps/studio/src/api.ts`) | **2 000** |
| Store default (`DEFAULT_LIST_LIMIT`, `packages/db/src/facility-registry-store.ts`) | 200 |
| Server cap (`MAX_LIST_LIMIT`, `apps/server/src/facilities-routes.ts`) | 20 000 |
| `facility_registry` indexes | PK on `id`, one btree on `council` |
| Audit filter dimensions already backed by a column | **9 of 10** |

Four consequences, all load-bearing:

1. **The defect cannot currently be reproduced by looking.** With one registry row, nothing about
   this page misbehaves on a developer machine. The same class of trap as the measured
   "`facilities` = 2 demo rows" note that shaped an earlier slice.
2. **The 2 000 cap was a deliberate, documented trade-off, not an oversight.** `api.ts` explains that
   requesting the server's own 20 000 would turn a 13 k register into roughly a 100 000-node
   synchronous render, and names pagination and virtualization as out of scope for that slice. This
   slice finishes work that was consciously deferred.
3. **`facility_registry` lives in the INTERNAL database, which is always Postgres.**
   `internalMigrations` takes no engine argument, unlike `externalMigrations('postgres'|'mssql'|'mysql')`.
   **There is no three-dialect burden here** — none of the MSSQL/MySQL hazards that dominated the
   `facility_map` work apply to this slice.
4. **The audit's citation for the store is stale.** It is `packages/db/src/facility-registry-store.ts`,
   not `packages/bootstrap/`.

### The filter surface that already exists

`facility_registry` columns: `id`, `local_code`, `national_system`, `national_code`, `name`, `level`,
`ownership`, `status`, `country`, `zone`, `region`, `district`, `council`, `ward`, `village`,
`address_text`, `phone`, `latitude`, `longitude`, `extras` (jsonb), `managed_origin`, `source`,
`created_at`, `updated_at`.

The audit names ten filter dimensions: country, zone, region, district, council, level, operational
status, registry source, managed origin, and mapping/projection health. **Nine are already real
columns.** `FacilityListOptions` already supports `region`/`district`/`council`/`status` plus `limit`,
and a `distinctAdminValues` helper already exists to populate filter values. **This slice extends an
existing surface; it does not invent one.**

⚠ **Three columns are provenance-ish and must not be conflated** — they answer different questions,
and this slice exposes all three as distinct filters:

| Column | Question it answers | Example |
|---|---|---|
| `national_system` | *Which national register does this facility's `national_code` belong to?* This is the audit's "registry source". | an HFR/MFL system URI |
| `source` | *How did this row get into our registry?* (NOT NULL) | `manual`, import |
| `managed_origin` | *Who owns this row's content — is it centrally synced or locally managed?* | central sync vs local |

`ownership` (facility ownership, e.g. public/private) is a fourth, unrelated column the audit did not
ask for; it is exposed as a filter because it exists and administrators ask for it.

The tenth dimension — **mapping/projection health** — has no column and requires a join. It is in
scope by explicit operator decision.

## Design

### 1. Health, and the fan-out trap it hides

A facility is a mapping target via its **projected concept code**, never its id:
`facility_concept_projection (registry_id PK → facility_registry.id ON DELETE CASCADE, concept_code)`
holds the code, and a resolution is a `term_mappings` row with
`to_system = 'urn:openldr:cs:facility-registry'`, `is_active`, `map_type = 'SAME-AS'`, and
`to_code = facility_concept_projection.concept_code`.

That yields three states, and the first is worth more than the filter it enables:

| State | Meaning |
|---|---|
| **`unprojected`** | No `facility_concept_projection` row. The facility **cannot be selected as a mapping target at all** — the FAC-P0-08 failure made visible in a list rather than only as a failed background job. |
| **`unmapped`** | Projected, but no active `SAME-AS` mapping resolves to it. |
| **`mapped`** | At least one active `SAME-AS` mapping resolves to it, with a count. |

⛔ **This must NOT be a plain `left join` to `term_mappings`.** One facility is legitimately the
target of MANY observed codes — migration 078's partial unique index constrains one active resolution
per *observed* code, not per *target*. A plain join therefore multiplies a facility by its mapping
count, which would corrupt both the page contents and the total. This is the same fan-out class the
`facility_of` CTE exists to prevent in the seeded reports.

⛔ **And it must not be an `EXISTS`/correlated subquery either**: pg-mem, which the test suite runs
against, has **zero support for correlated subqueries** — measured during the predecessor slice
(five variants all fail `column "t1.k" does not exist`; uncorrelated subqueries and `UPDATE … FROM`
work). A correlated form would be untestable here.

The shape that satisfies both — **an uncorrelated derived-table aggregate** — was probed against
pg-mem before this design was written and confirmed working, including paging and filtering:

```sql
from facility_registry fr
left join facility_concept_projection fcp on fcp.registry_id = fr.id
left join (select to_code, count(*) as n
             from term_mappings
            where to_system = <FACILITY_REGISTRY_SYSTEM> and is_active and map_type = 'SAME-AS'
            group by to_code) m on m.to_code = fcp.concept_code
```

with health derived as `case when fcp.registry_id is null then 'unprojected'
when coalesce(m.n,0) > 0 then 'mapped' else 'unmapped' end`, and `coalesce(m.n,0)` exposed as
`mapping_count`. In the probe, a facility with two mappings appeared **once**, with
`mapping_count: 2`.

### 2. Pagination — offset, deliberately

The audit permits "cursor or offset". **Offset with an exact `count(*)`**, chosen and recorded so a
later reader knows it was decided rather than defaulted into.

Cursor pagination is stable under concurrent inserts and scales indefinitely, but cannot express
"page 7 of 42", cannot jump, and composes badly with an authoritative total — which the audit
explicitly requires. Offset is trivially correct alongside search and filters, yields an exact total,
and supports jumping. Its weaknesses are drift under concurrent writes and cost at very deep offsets;
neither bites a 13 k-row table curated by a small number of ministry administrators.

### 3. Store — `packages/db/src/facility-registry-store.ts`

`FacilityListOptions` gains:

- `offset?: number`
- `q?: string` — case-insensitive substring search
- `country`, `zone`, `level`, `ownership`, `nationalSystem`, `managedOrigin`, `source` (alongside the
  existing `region`, `district`, `council`, `status`)
- `health?: 'mapped' | 'unmapped' | 'unprojected'`

`list()` returns `{ rows: FacilityRecord[]; total: number }` instead of a bare array. `total` counts
rows matching the same search and filters, before `limit`/`offset`.

⚠ **`list()`'s return type change is a breaking change to an exported interface.** Every caller must
be found and updated by following the compiler — not by assuming this spec's list is complete.

**Search covers** `name`, `local_code`, `national_code`, and the administrative columns.

⚠ **The audit also asks to search aliases. There is no alias column.** `extras` is an untyped jsonb
bag and inventing an alias convention inside it here would pre-empt sub-project B's identity
modelling (FAC-P1-04, P1-08). Aliases are therefore **not searchable in this slice**, and this is
recorded as an unmet audit requirement rather than quietly dropped.

### 4. HTTP — `apps/server/src/facilities-routes.ts`

`GET /api/facilities` gains `offset` and the new filter/search params, each parsed with the same
discipline the existing `parseLimit` already applies (reject `NaN`, non-positive, and repeated
array-valued params). `MAX_LIST_LIMIT = 20000` remains the backstop.

Response becomes `{ rows, total, limit, offset }`.

### 5. Client — `apps/studio/src/pages/Facilities.tsx`, `apps/studio/src/api.ts`

- **`FACILITIES_LIST_LIMIT` and the `truncated` banner are deleted.** With an exact total the banner
  conveys nothing, and it was itself defective — inferred from `data.length >= 2000`, so exactly
  2 000 real rows produced a false warning.
- Default page size 50, with a pager showing the total.
- Search, filters, and page live in the **URL**, so a filtered view is linkable and survives reload.
- **No virtualization.** The audit permits it only as a rendering optimization, never as a substitute
  for server paging. At 50 rows a page it earns nothing. YAGNI.
- Filter option values come from the existing `distinctAdminValues` helper where it applies.

## Testing

Synthetic rows generated in-suite — the operator chose this over wiring the real fixture (see Known
limits). Every test mutation-proven: break the behaviour, watch it fail, restore in place.

1. **Paging arithmetic** at boundaries: first page, last partial page, `offset` past the end returns
   an empty array rather than erroring.
2. **`total` is exact and filter-aware** — it reflects search and filters, not the page size.
3. ⭐ **The fan-out guard**: a facility that is the target of two active mappings appears **once**,
   carries `mapping_count: 2`, and does **not** inflate `total`. Mutation-proven by replacing the
   derived-table aggregate with a plain join and watching the row and total counts double.
4. **Each health state** — `unprojected` (no projection row), `unmapped`, `mapped` — including that
   an *inactive* or non-`SAME-AS` mapping does not make a facility read as mapped.
5. **Search** matches each covered field independently, and is case-insensitive.
6. **Long names** and realistic administrative strings do not break the query or the layout.
7. The client puts state in the URL and restores from it.

## Known limits, stated rather than implied away

- **No live demonstration at national scale.** The operator chose synthetic test data over wiring the
  real corpus, so "the page is usable at 13 000 rows" will be an inference from tests, not something
  anyone has looked at. ⚠ A prepared, entirely unused Tanzanian master-facility-list fixture exists
  at `../corlix/fixtures/mfl-TZ-2026-Q*.jsonl` — three successive releases of 20, 500 and **13 000**
  rows, each with a release header (`version`, `publishedAt`, `rowCount`, `deletionCount`) and
  explicit `deletion` records. Nothing in this repository references it. It is the natural corpus for
  **A2**, whose preview and retirement requirements need exactly release-over-release data.
- **No new indexes, pending measurement.** The table carries only a PK and a `council` index. 13 k
  rows of a few hundred bytes is a few megabytes, which Postgres should scan in single-digit
  milliseconds. An index will be added only if a measurement during implementation calls for one —
  not on principle, and not claimed to be necessary without evidence.
- **Aliases are not searchable** (see §3).
- **Offset pagination drifts under concurrent writes.** Two administrators editing the register while
  a third pages through it can see a row twice or skip one. Accepted for this workload; cursor
  pagination would trade away the exact total the audit requires.

Related: `docs/superpowers/specs/2026-08-09-facility-map-namespace-key-design.md`,
`docs/audit/2026-08-07-facilities-page-audit.md`.
