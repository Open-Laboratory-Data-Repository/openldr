# The facility registry filters and sorts for real

**Slice C of 4, the last one.** Slice A built the grammar
(`2026-08-18-server-side-table-query-design.md`). Slice B made the audit log its first consumer
(`2026-08-18-audit-adopts-table-query-design.md`, merged as `916c5288`). Slice D shipped as
`ba12d22d`. This slice does Facilities — the largest page in the app and the last table not on the
shared toolbar.

Agreed with the operator on 2026-08-19.

---

## Why this one is not a copy of Audit

Audit was the simpler of the two server-paginated pages, chosen first for that reason. Facilities
differs in three ways that change the design.

**`health` cannot be a grammar column.** It is computed across two joins — a `leftJoin` to
`facility_concept_projection` and a `leftJoin` to a derived aggregate over `term_mappings`
(`packages/db/src/facility-registry-store.ts:405-424`). Its three states apply three *different*
predicates against the joined tables:

```
unprojected  ->  fcp.registry_id is null
mapped       ->  coalesce(m.n, 0) > 0
unmapped     ->  fcp.registry_id is not null and coalesce(m.n, 0) = 0
```

`TableColumnSpec.sql` is a bare column name. It cannot express any of that.

**Facilities has a real server-side free-text search.** `q` is a five-column OR `ILIKE` over
`name`, `facility_code`, `region`, `district`, `council`
(`facility-registry-store.ts:361-377`). Audit had no free-text parameter at all, which is why its
toolbar shipped without a search box. Here the search input can be wired to something that works.

**There is no `facilities list` CLI command.** `audit list` already existed and merely gained flags.
The facilities command group has `import`, `suggest-map`, `suggest-values`, `import-runs`,
`scan-observed`, `publish`, `conflicts` and `jobs` — no plain list.

---

## What was verified before designing

**Every `sql` name in `FACILITY_COLUMNS` is real.** All twelve exist on `facility_registry`,
checked against the live database. Nothing in the map points at a column that does not exist.

**Unqualified column references survive the joins.** The grammar emits `sql.ref(spec.sql)` — bare
names — while the store's own ordering uses qualified ones (`facility_registry.name`). That could
have been ambiguous. It is not: `facility_concept_projection` has only `registry_id`,
`concept_code` and `updated_at`, and the derived table `m` exposes only `to_code` and `n`. None
collides with a mapped name.

**The map is missing three filters the page already has.** `FacilityListOptions`
(`facility-registry-store.ts:82-107`) accepts `source`, `managedOrigin` and `registerState`;
`FACILITY_COLUMNS` does not carry them. They are ordinary columns and should be there.

---

## The split

**Into the toolbar** — every filter backed by a real column. The map gains `source`
(`source`), `managedOrigin` (`managed_origin`) and `registerState` (`register_state`), all
`type: "enum"` with the enum operator set, matching how the page already offers them.

**Stays its own control** — `health`. It sits beside the toolbar rather than inside the popover.
The chips row therefore shows only what the grammar applied, which is honest: a chip that claimed
to represent `health` would be describing a predicate the grammar never produced.

**Becomes the search box** — `q`. Wired to `DataTableToolbar`'s `onSearchChange`, sent to the
server as the existing named param. This is the first adopted page whose search is genuinely
server-side; every client-side page pre-filters rows in the browser, and Audit has no search at
all.

**Not renamed.** The store's option is `nationalSystem` while the column is `facility_system` and
the map calls it `facilitySystem` — leftover from the "one code, one system" refactor
(`054f2afe`). The map's name is the wire contract and stays `facilitySystem`; the store's option
name is left alone. Renaming it is a separate change with its own blast radius, and this slice does
not need it.

---

## The four surfaces

**Store.** `FacilityListOptions` gains optional `filters: ParsedFilter[]` and `sorts: ParsedSort[]`.
`applyFilters` ANDs the grammar expression with the named params. Ordering routes through
`applySorts`.

⛔ The store already orders `facility_registry.name asc` then `facility_registry.id asc`
(`facility-registry-store.ts:435-441`) — it has a correct tiebreaker today, unlike audit. That
default must be passed to `applySorts` via its `defaultSorts` parameter. Omit it and an unsorted
request falls through to tiebreaker-only, silently changing the page's load order from
alphabetical to UUID order.

**Route.** `GET /api/facilities` calls `parseTableQuery` with `FACILITY_COLUMNS` and returns
**400 naming exactly what was rejected**. All fourteen named params keep working and are ANDed with
the grammar. This is not a migration.

**CLI.** A new `openldr facilities list` with `--where` and `--sort`, reusing `parseWhereFlags`
(`packages/cli/src/table-query-flags.ts`) unchanged. Both surfaces terminate at `parseTableQuery`,
so an unknown column or a disallowed operator fails identically whether the operator used the
studio or a headless shell.

**Page.** `apps/studio/src/pages/Facilities.tsx` builds `ColumnDef[]` from `FACILITY_COLUMNS` with
`operators` set from the map, and adopts toolbar + chips + pagination. `health` keeps its control.

⛔ The page is server-paginated. `applyTableState` must never be called there — filtering in the
browser would filter only the current page while the pagination total claimed otherwise.

---

## A latent trap worth a guard

`updated_at` exists on **both** `facility_registry` and `facility_concept_projection`. It is not
mapped today, so nothing breaks. Map it later and every unqualified reference becomes ambiguous and
the query 500s.

A test asserts that no mapped `sql` name collides with a column on any table the list query joins.
That is cheap now and catches the trap when someone adds `updatedAt` in a year.

---

## Testing, and what it will not prove

Store tests cover grammar filters ANDing with named params, and `q` still searching all five
columns. Route tests pin the 400 shape — `typecheck` green does not pin a wire shape. CLI tests
cover flag parsing, including an unknown column failing the same way it does on the route.

**Must run live, not on pg-mem:**
- sorting real `facility_registry` rows by a text column with mixed case — pg-mem has no ICU and
  cannot parse `COLLATE`
- paging over facilities that share a name, which is the norm rather than the exception in a
  national register

**HONEST NON-PROOF — the page.** `AUTH_DEV_BYPASS=false`, so the studio needs a real Keycloak login
and Facilities will not be opened in a browser. Component tests cover the toolbar and the filter
round trip. Layout, and mobile at 375px, stay unverified — the same gap Audit and RegistriesTab
shipped with. On the largest page in the app that gap is worth stating twice.

---

## Risks

**This is the biggest page in the app.** If the toolbar adoption fights the existing filter panel,
the health control and the admin-hierarchy pickers, the page should be split into its own task
rather than dragging the slice.

**`q` is an unindexed sequential scan.** The store's own comment says so
(`facility-registry-store.ts:361-368`): a leading `%` means no btree index can serve it, and it was
never benchmarked at national-register scale. Wiring it to a toolbar search box makes it easier to
trigger, on a table holding a ~13,000-row release. This slice does not fix that — but it should not
pretend the search is free either.

**Three filters gain operators they never had.** `source`, `managedOrigin` and `registerState` were
equality-only named params. In the map they get the full enum operator set, including `ne` and
`in`. That is the point, but it is new SQL against columns nothing has filtered flexibly before.
