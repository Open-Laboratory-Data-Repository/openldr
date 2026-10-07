# The facility register in the warehouse

Date: 2026-10-07. Status: approved in chat, awaiting spec review.

## Problem

A custom query cannot read the facility register. The register lives in `facility_registry` in
the internal database. The Query page has one connector, to the warehouse. The warehouse has no
copy of the register:

- `facilities` holds ingested FHIR Organization and Location resources
  (`packages/db/src/relational/facility.ts:20`). It never sees the register.
- `facility_map` holds register data only for facility codes that results have used
  (`packages/bootstrap/src/facility-reconcile.ts:870-931`). With no results it is empty.
- `terminology_codes` holds value set expansions: system, code and display only.

On the dev CE today: the register has 2,839 Mozambique facility rows and 311 lab rows. The
warehouse shows none of them. A query shaped like Mozambique's v1 `viewFacilities` returns nothing.

The user action this unblocks: an analyst lists, filters or counts facilities from the Query page
or a custom query, with or without results.

## Decision

A new warehouse table, `facility_registry`, holds a copy of every register row. The existing
`facility-map-rebuild` job rewrites it in the same transaction that rewrites `facility_map`.

Rejected:

- Widening `facility_map` with facilities no result has used. Reports already join on it, and
  rows with no source code could add or double-count rows in those joins.
- Copying row by row on every register write. It needs a write path per edit, delete and import.
  A full rewrite is cheap at register size (10,000 to 15,000 rows for a national register,
  `facility-registry-store.ts:114`).
- A connector to the internal database. It exposes every internal table to raw SQL.

## The table

Migration `external/021_facility_registry.ts`. One row per internal `facility_registry` row,
every register, every `register_state`.

| Column | Type | From the internal row |
|---|---|---|
| `id` | key, primary key | `id` |
| `facility_system` | key | `facility_system` (the register URL; nullable there too) |
| `facility_code` | key, not null | `facility_code` |
| `name` | text, not null | `name` |
| `level`, `ownership`, `status`, `register_state` | text | same names |
| `country`, `zone`, `region`, `district`, `council`, `ward`, `village` | text | same names |
| `address_text`, `phone` | text | same names |
| `latitude`, `longitude` | float | same names |
| `extras` | text | `extras` as JSON text, NULL when empty |
| `updated_at` | timestamp, not null | `updated_at` |

- Types come from `migrations/external/dialect.ts`, so the table builds on Postgres, SQL Server
  and MySQL. On MySQL the table uses `character set utf8mb4`, as `012_facility_map.ts` does.
- `extras` is text, not `jsonb`: SQL Server and MySQL have no `jsonb`.
- One index on `(facility_system, facility_code)`. Every lookup filters on both.
- `managed_origin`, `source` and `created_at` are not copied. They describe how the internal row
  was written, not the facility.
- The same name as the internal table is deliberate: it is the same data. The two never meet in
  one query, since they are in different databases.

`packages/db/src/schema/external.ts` gets a `WarehouseFacilityRegistryTable` type (the internal
schema already exports `FacilityRegistryTable`, and the db barrel re-exports both modules), an entry in
`ExternalSchema`, and an entry in `EXTERNAL_TABLE_COLUMNS` (the type requires it).

## The refresh

`publishFacilityMap(deps, { apply: true })` (`facility-reconcile.ts:848`) reads every internal
`facility_registry` row and, inside the transaction that already rewrites `facility_map`
(`:923-931`), deletes every warehouse `facility_registry` row and inserts the copy.

- Delete then insert, never upsert then prune, for the reason the function's own comment gives:
  MSSQL's parameter limit makes a `where id not in (...)` prune unworkable at register size.
- Batched inserts sized for MSSQL's 2,100 parameter limit: 21 columns per row, so 90 rows per
  batch (1,890 parameters).
- One transaction with `facility_map`, so a reader never sees the copy empty or out of step with
  the dimension.
- A dry run (`apply` false) counts the register rows and writes nothing.
- `PublishResult` gains `registryRows`: the number of rows copied. The CLI and the route print it.

Every path that changes register rows already queues `facility-map-rebuild`:

- create, update and delete in the studio (`apps/server/src/facilities-routes.ts:1353, 1516, 1843`)
- every import, including a content pack's register step (`packages/bootstrap/src/facility-import.ts:1136`)
- link-matching and mapping saves (`facilities-routes.ts:1112`, `terminology-admin-routes.ts:263, 302, 326`)
- boot (`packages/bootstrap/src/index.ts:1067`) and `openldr facilities publish --apply`

One path does not: bulk delete (`facilities-routes.ts:1777`) queues only `registry-projection`
jobs (`:1820-1825`). Deleted rows would stay in the copy, and in `facility_map`, until the next
rebuild. Bulk delete will also queue `facility-map-rebuild`, wrapped and logged like the other
sites.

Sync between nodes is not affected. `facility_registry` sync is suspended
(`migrations/internal/076_suspend_facility_registry_sync.ts`). Each node copies its own register.

## Out of scope

- The dashboard builder's model list (`packages/dashboards/src/models/registry.ts`) and Data
  Exposure governance (`dashboards-routes.ts:23`). The Query page needs neither. Both list tables
  by hand, so the new table stays out of them until someone adds it. The table carries no patient
  data. `export-data.test.ts` pins the list of warehouse tables, and its comment records why this
  one is there.
- Warehouse CSV export (`packages/db/src/export-data.ts`). It lists tables by hand too.
- Value-mapping Mozambique's facility type and `HFStatus`, and carrying the MISAU national code
  or province and district codes. Those are pack changes. Once a pack carries them in `extras`,
  they reach this table with no schema change.
- An optional `daterange` query parameter left blank still fails with "unbound parameter".

## Definition of done (AGENTS.md section 6)

1. UI: no new screen. The Query page reads the table.
2. CLI: `openldr facilities publish --apply` already runs the rebuild. It prints the new count.
3. Docs: the Facilities and Query docs say the register is in the warehouse as
   `facility_registry`, refreshed with the facility map. en, fr and pt.
4. Mobile: no screen changes.
5. Changelog: `pnpm make:changelog` on main after the merge.

## Tests

- Migration: `021` creates the table and index and drops them on down (pg-mem, as the other
  external migration tests do).
- `publishFacilityMap` with apply: the copy holds every register row, from two registers,
  including a row whose `register_state` is dropped. `extras` arrives as JSON text.
- A second apply after an internal row is deleted: the row is gone from the copy.
- Without apply: the copy is unchanged.
- The bulk-delete route queues `facility-map-rebuild`.
- What these do not prove: SQL Server and MySQL DDL. pg-mem is Postgres only. The dialect
  helpers are shared with `012_facility_map.ts`, which runs on all three, but no test here
  builds the table on SQL Server or MySQL.

## Live check

On the dev CE: run `openldr facilities publish --apply`. Expect 3,150 rows in the warehouse
`facility_registry` (2,839 MZFAC + 311 MZLABS). Then on the Query page, run a `viewFacilities`
shaped query: `FacilityCode`, `Description`, `ProvinceName`, `DistrictName` and the fixed
country columns, filtered to `urn:openldr:mz:facilities`.
