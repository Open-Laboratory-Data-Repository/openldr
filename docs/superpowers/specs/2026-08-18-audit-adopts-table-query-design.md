# Audit filters and sorts for real

**Slice B of 4.** Slice A (`2026-08-18-server-side-table-query-design.md`) built the grammar and
merged with no callers. This slice makes the audit log its first consumer, end to end: store,
route, CLI and page. Slice C is Facilities. Slice D (RegistriesTab) already merged as `ba12d22d`.

Audit is server-paginated, so it never got the shared filter toolbar. It has a bespoke
draft-then-apply form with four text boxes and a date range, and no sorting at all.

Agreed with the operator on 2026-08-18.

---

## Why now

**The grammar has no consumers.** Slice A shipped `@openldr/table-query` and
`packages/db/src/table-query-sql.ts` deliberately unwired, so that its two adopters would not each
invent their own. Nothing has exercised it against a real endpoint yet.

**Two Importants were left open** on the explicit condition that they close before a page is
wired. They are grammar-level, so they are fixed here and slice C inherits them.

**Audit is the smaller of the two server-paginated pages.** Facilities is the largest page in the
app. Doing audit first establishes the route, store and CLI pattern against a simpler surface.

---

## Fix 1 — text sort order stops depending on the base image

`applySorts` (`packages/db/src/table-query-sql.ts:114`) emits a bare `ORDER BY`. That takes the
database's default collation, and today that disagrees with the client:

| | order of `''`, `BETA`, `alpha`, `epsilon` |
|---|---|
| server, bare `ORDER BY` | `''`, `BETA`, `alpha`, `epsilon` |
| client `localeCompare` | `''`, `alpha`, `BETA`, `epsilon` |
| `COLLATE "en-US-x-icu"` | `''`, `alpha`, `BETA`, `epsilon` |
| `ORDER BY lower(x)` | `''`, `alpha`, `BETA`, `epsilon` |

All four rows measured against the live dev database, not reasoned about.

**The interesting part is why.** The database reports `datcollate = en_US.utf8`, which under glibc
would already sort `alpha` before `BETA`. It does not, because `postgres:16-alpine` is musl-based
and locale support falls back to byte order. **So the current order is a property of the base
image, not of any decision made here.** Swap in a Debian-based or managed cloud Postgres and every
text sort silently reorders — including which rows land on which page.

**Decision: `COLLATE "en-US-x-icu"` on text-column sorts.** ICU ships in this image (908 collations
present), so ordering becomes a property of the query rather than the container. It also happens to
match the client exactly.

**Honest scope of the benefit.** The client sorter and the SQL sorter never run on the same page —
client-side pages use `applyTableState`, server-paginated pages use SQL. So this is a determinism
and consistency fix, not a wrong-rows bug. The determinism half is the part that matters.

**Cost, accepted:** a plain btree index will not serve a sort with a non-default collation. Nothing
indexes these columns for sorting today, so nothing regresses; it becomes a consideration when
`audit_events` grows large enough to need one.

**The existing test cannot show this.** `table-query-sql.test.ts`'s sort fixture is all-lowercase
(`"a"`, `"m"`, `"z"`), so it passes with or without the fix. The new test uses mixed case, and it
must run **live** — pg-mem is not Postgres and has no ICU.

---

## Fix 2 — the popover stops offering operators the server rejects

`AUDIT_COLUMNS.id` is `type: "text"` with `operators: ["eq", "in"]`
(`packages/table-query/src/columns.ts:22`). But `FilterPopover` derives its operator list from
`validOperators(col.type)`, which returns six operators for text. Picking `like` on an id column
produces a 400 the user cannot act on.

**Decision:** `ColumnDef` gains an optional `operators?: FilterOperator[]`, and the popover uses
`col.operators ?? validOperators(col.type)`.

There are **three** call sites, not one: `FilterPopover.tsx:144` (seeding a new rule), `:194`
(rendering the operator list for an existing rule) and `:226` (re-picking an operator when the
column changes). Missing any one leaves the defect alive on that path.

**A guard test is the point of this fix.** For every entry in both column maps, assert the map's
operator list is a subset of what the UI would offer, and that the page builds `ColumnDef.operators`
from the map. Nothing enforces this agreement today, which is how it drifted.

---

## The store is the integration point

`AuditFilter` gains optional `filters: ParsedFilter[]` and `sorts: ParsedSort[]`.
`createAuditStore` passes them to `buildFilterExpression` and `applySorts`, ANDed with the existing
named fields, which keep working exactly as they do now.

**Why the store and not the route:** the CLI calls `ctx.audit.list()` directly
(`packages/cli/src/audit.ts:18`), not the HTTP endpoint. Parsing in the route alone would leave the
CLI with nothing, and AGENTS.md §6 requires the route and the CLI to call identical shared code
rather than each implementing it.

**The tiebreaker lands here too.** `packages/audit/src/store.ts:111` is
`ORDER BY occurred_at DESC` followed by `LIMIT`/`OFFSET` with no unique key, so two events sharing
a timestamp can appear on two pages or on none. `applySorts` already appends the tiebreaker; routing
audit's ordering through it fixes the pre-existing bug as a side effect of the adoption.

---

## Three surfaces

**Route.** `apps/server/src/audit-routes.ts` calls `parseTableQuery` and returns **400 naming
exactly what was rejected**. A filter is never silently dropped — a dropped filter gives a table
that disagrees with its own chips row. Existing named params (`?action=`, `?from=`) are unchanged
and are ANDed with the grammar.

**CLI.** `audit list` gains `--sort` and `--where`, per the operator's decision that a headless lab
should have what the UI has. `--where` is repeatable and takes `column:operator:value`; `--sort`
takes a column with an optional `-` prefix for descending. Both parse into the same
`ParsedFilter[]` / `ParsedSort[]` the route produces and go through the same validator, so an
invalid column fails the same way on both surfaces.

**Studio.** `apps/studio/src/pages/Audit.tsx` builds its `ColumnDef[]` from `AUDIT_COLUMNS` and
adopts `DataTableToolbar` + `ActiveFilterChips` + `TablePagination`, replacing the bespoke
draft-then-apply form. The popover has the same draft-then-apply shape, so no capability is lost.

Its current field labels — `"Action"`, `"Entity type"`, `"Entity ID"`, `"Actor"`
(`apps/studio/src/pages/Audit.tsx:158-161`) — are hardcoded English literals. That markup is being
deleted and rewritten, so they become i18n keys in en, fr and pt on the way past. Leaving them
would ship a French UI with English filter labels.

---

## Two smaller defects, now reachable

**Date validation.** The route accepts anything `Date.parse` accepts, which includes `"2026"` and
`"2026-08"`. Postgres rejects those, so the user gets a 500 where the honest answer is a 400.

**Client tiebreaker.** `applyTableState` relies on `Array.sort` stability while the server appends
`id asc`. Rows with equal sort keys come back in the same set but a different order depending on
which page you are looking at. One line to align the client.

---

## Testing, and what it will not prove

Store tests cover filters and sorts reaching SQL, and the named params still ANDing. Route tests
pin the 400 shape and the preserved named params — `typecheck` green does not pin a wire shape,
route tests are the only thing that does. CLI tests cover flag parsing into rules, including an
invalid column failing the same way it does on the route.

**Must run live, not on pg-mem:**
- the collation ordering, with a mixed-case fixture — pg-mem has no ICU
- the tiebreaker walk over rows sharing one `occurred_at`, since pg-mem's stable scan order means
  the test would pass with or without the fix

**HONEST NON-PROOF — the page.** `AUTH_DEV_BYPASS=false`, so the studio needs a real Keycloak login
and the Audit page will not be seen in a browser. Component tests cover the toolbar rendering and
the filter round trip. Layout, and mobile at 375px, stay unverified — the same gap as RegistriesTab.

---

## Risks

**The route is a public contract.** Once `?filters=` ships on `/api/audit`, its shape is committed.
The named params staying valid is what keeps this from being a migration.

**Both Importants are folded in rather than split out.** That makes this slice larger, but each fix
is a line or two and splitting would buy two extra review cycles for no design benefit. If either
turns out to be more than a line, it should be pulled into its own task rather than dragging the
slice.

**`applySorts` already carries a `defaultSorts` parameter** added during slice A's fix wave
(`table-query-sql.ts:119`). Audit's existing `occurred_at desc` default must be passed through it,
not reimplemented, or the page loads in a different order than it does today.
