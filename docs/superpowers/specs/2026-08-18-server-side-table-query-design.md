# Filters and sorts the server can actually run

**Slice A of 4.** This slice builds the grammar and nothing else. No page changes, no route
changes. Slice B is Audit, slice C is Facilities, slice D is the marketplace RegistriesTab.

Nine studio tables now share one filter toolbar. Three do not. `RegistriesTab` is client-side and
was simply missed. Audit and Facilities are server-paginated, and that is a different problem: the
toolbar promises filtering and sorting their endpoints cannot perform.

Agreed with the operator on 2026-08-18.

---

## Why

**Every adopted page filters in the browser.** `listUsers()` takes no arguments at all —
`apps/studio/src/api.ts:733` is a bare `GET /api/users`. The page fetches every row and calls
`applyTableState`. All nine work this way. **No page sends a filter to the server today.** There is
no precedent to copy, which is exactly why these two were deferred rather than done.

**Copying that approach here would be wrong.** `audit_events` grows without bound, and the facility
registry holds a ~13,000-row national release. Both are server-paginated deliberately.

**The endpoints cannot express what the toolbar offers.** `AuditQuery`
(`apps/studio/src/api.ts:667`) accepts `action`, `entityType`, `entityId` and `actorId` as exact
matches, plus a `from`/`to` range. `FacilityListQuery` (`apps/studio/src/api.ts:826`) accepts `q`
plus thirteen equality fields. Neither accepts an operator, an OR, or a sort. The route confirms
it: `apps/server/src/audit-routes.ts:12-22` reads six named params and nothing else. Adopt the
toolbar unchanged and a user setting `status != active` gets a table that silently ignores them.

**The client already promised this.** `applyTableState.ts:80` documents its fold as "Matches the
backend's flat combine semantics" — a backend that does not exist yet. `ColumnDef.id`
(`apps/studio/src/components/data-table/types.ts:36`) is documented as "must match the SQL column
on the server whitelist". The kit was written expecting this slice.

**Audit paginates on a non-unique key.** `packages/audit/src/store.ts:111-113` is
`ORDER BY occurred_at DESC` followed by `LIMIT`/`OFFSET`, with no tiebreaker. Two events sharing a
timestamp can appear on two pages, or on none. AGENTS.md §7 names this trap and notes pg-mem can
never demonstrate it. Facilities does not have this bug — `facility-registry-store.ts:435,441`
already orders by `name` then `id`. User-controlled sort would multiply the audit case, so it is
fixed here.

---

## Scope

**In:** one new package holding the rule types, the per-resource column maps, and the query parser.
Plus a server-side translation module turning a parsed query into Kysely expressions.

**Out:** every consumer. No route parses the new format in this slice, no page emits it, no store
calls the translator. Slice A ships tested code with no live callers — deliberately, so the two
adopters in slices B and C do not each rewrite it.

**Out entirely:** `RegistriesTab` (slice D) has none of this problem. It is client-side. Its real
defect is that it has no `TablePagination` at all, which AGENTS.md §5 requires by name for
marketplace registries.

---

## The package

`@openldr/table-query`. **Zero runtime dependencies**, modelled on `packages/rbac/package.json`
(private, `type: module`, `exports: { ".": "./src/index.ts" }`, typecheck and test scripts only).

**Why its own package, not a corner of `@openldr/db`:** the studio must import this at runtime to
build its columns. Studio's only current use of `@openldr/db` is
`import type { FacilityHealth }` (`apps/studio/src/api.ts:17`) — type-only, erased at compile time.
The `@openldr/db` barrel re-exports `engine`, `internal-db`, `migrator` and the migration lists, so
a *value* import from it would pull Kysely, `pg` and every migration into the browser bundle. This
is the same defect class as exporting a `vitest`-importing helper from a barrel that production
code imports.

It holds three things.

**1. The rule types.** `FilterRule`, `SortRule`, `FilterOperator`, `FilterCombine` and `ColumnType`,
moved out of `apps/studio/src/components/data-table/types.ts`. The data-table barrel re-exports
them, so the nine adopted pages and their tests do not change.

**2. Per-resource column maps.** `AUDIT_COLUMNS` and `FACILITY_COLUMNS`. Each entry declares the
wire id, the SQL column, the column type, the operators allowed on it, and whether it is sortable.
This one object is both the security boundary (nothing reaches SQL unless it is listed) and the
honesty boundary (the UI offers exactly this and no more).

**3. `parseTableQuery(params, columns)`.** Decodes the JSON, validates every rule against the map,
enforces a size cap, and returns either a parsed query or a typed rejection naming what failed.

---

## Wire format

`?filters=<json>&sorts=<json>` on the existing `GET` endpoints.

The JSON is the client's `FilterRule[]` / `SortRule[]` verbatim. No translation layer, so the two
sides cannot drift in shape.

The costs, accepted: URLs get long and ugly, so the parser enforces an explicit cap on encoded
length and on rule count, returning 400 rather than truncating. Malformed JSON is a 400, never a
silently-empty filter set.

**The existing named params keep working.** `?status=active`, `?action=login` and `?q=dodoma` are
unchanged, and are ANDed with anything the grammar contributes. The CLI's audit command
(`packages/cli/src/audit.ts`) and any external caller keep working untouched. This is not a
migration.

---

## Translation, and the two rules it must hold

`packages/db/src/table-query-sql.ts`, exported from the `@openldr/db` barrel. It takes a parsed
query plus a column map and returns Kysely expressions. It lives there because Kysely is already a
dependency of that package and both the audit store and the facility store import from it.

It stays a **separate module from the column maps**: the maps are browser-safe and live in
`@openldr/table-query`, this translator is server-only. Studio must never value-import it.

**The fold must match the client exactly.** Flat and left-to-right: `A AND B OR C` is
`(A AND B) OR C`, mirroring `applyTableState.ts:80-92`. A different fold means the same filter set
gives different answers on a client-side page than on a server-side one. This is the most important
correctness property in the slice, and it gets a test that runs one rule list through both
implementations and compares the selected rows.

**Every sort appends a unique tiebreaker.** The resource's primary key is appended to whatever the
user sorted by. Without it, `ORDER BY` plus `OFFSET` is not stable across pages.

---

## Failure mode

An unknown column, a disallowed operator, an unsortable column, or an oversized filter set returns
**400, naming exactly what was rejected**.

It is never silently dropped. A dropped filter produces a table that disagrees with its own chips
row, which is the lying UI this design exists to prevent.

---

## Testing, and what it will not prove

Unit tests cover: parsing valid input, rejecting each invalid case with the right message, the size
cap, the fold against a hand-worked truth table, and the tiebreaker being appended.

The cross-implementation test is the one that matters. The same `FilterRule[]`, run through
`applyTableState` and through the SQL translator, must select the same rows.

**HONEST NON-PROOF — the tiebreaker.** pg-mem has a stable scan order and cannot demonstrate
`ORDER BY` tie non-determinism, so a pg-mem test passes with or without the fix. Proving it needs a
live Postgres instance, rows inserted with identical `occurred_at`, and a page-by-page walk
asserting no row repeats and none is missed. Written as a live test, or it proves nothing.

---

## Risks

**The column maps are a public contract.** Once a wire id ships, renaming it breaks saved URLs.
Name them for the wire, not for whatever the SQL column happens to be called today.

**Slice A has no live callers.** Nothing exercises this code until slice B. The cross-implementation
test is the only thing standing in for a real consumer, which is why it is not optional.

**Moving the rule types touches the data-table barrel.** The blast radius is contained to
re-exports, but all nine adopted pages compile against it. `pnpm --filter @openldr/studio test` is
the gate.
