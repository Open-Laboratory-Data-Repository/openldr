# Browsing the test catalog from a Lab order, design

**Date:** 2026-09-16
**Status:** approved in brainstorming, not planned yet

## 1. What this is for

The Lab order's Tests field searches from two typed characters. A technician who does not know a test's
code or name finds nothing, and the field looks broken. This adds a way to look at the catalog and
pick from it.

It follows bench result entry (`2026-09-16-bench-result-entry-design.md`), which this repo built on
2026-09-16, and the test catalog arc before it.

## 2. What already exists, measured 2026-09-16 at `16b8b070`

- **The Tests field binds this lab's test list** (`urn:openldr:valueset:lab-tests`), worked out when
  read from the catalog and the lab settings (test catalog S4).
- **The picker searches from two characters** (`apps/studio/src/forms-runtime/ReferencePicker.tsx`),
  and the narrowed-list case S4 added lists on focus only when the server answered with a short list.
- **`GET /api/test-catalog` already lists the catalog** with paging and filters, through
  `parseCatalogListQuery` and `TestCatalog.list` (`apps/server/src/test-catalog-routes.ts:129-133`).
  It is gated on `terminology.view` and answers management data, including `ownedHere`.
- **A Lab Technician holds `forms.view` and `forms.submit` only** (`packages/rbac/src/presets.ts:52`).
- **`CatalogTest` already carries `lab.enabled`**, so whether a test is switched on here needs no new
  storage.
- **The form runtime has no i18n** (`FormRuntime.tsx:84-92`). Chrome copy arrives as a prop.

## 3. Settled with the operator, 2026-09-16

1. **Browse shows the whole catalog**, marking which tests are switched on here. Not just the
   orderable ones: a technician needs to see that a test exists before asking why it is missing.
2. **A test that is not switched on cannot be picked**, and says why. The submit check validates
   against the lab's list, so allowing the pick would refuse the order later, which reads as a bug.
3. **Nothing is seeded.** A fresh install browses an empty catalog until a lab imports its national
   list. No sample CSV ships, and no demo tests are written at boot. Hardcoding clinical vocabulary is
   forbidden (AGENTS.md section 8), and the operator chose not to work around it.

## 4. The screen

**The control.** The Tests field gains a `⋯` menu holding one item, "Browse all tests". A standalone
button would break AGENTS.md section 5. The menu appears only on a reference field that another field
depends on through `referenceDependsOn`, which is what the Lab order's results field does. That test
is structural, so the studio still names no value set (AGENTS.md section 8).

**The sheet.** A `Sheet` in the pattern of `forms-builder/FieldEditorSheet.tsx`, holding:

- a search box over code and name,
- a category filter,
- one row per test: code, name, category,
- a marker on any test not switched on at this lab, whose row is inert,
- `TablePagination`, because the catalog can hold thousands.

Picking an offered test adds its coding to the Tests answer exactly as the picker does, then closes
the sheet. The results row for that test appears underneath, as it does for a typed pick.

**Empty.** `StripedEmpty` saying no tests are loaded on this install, naming the Test catalog page as
where they come from. `LoadingState` while the first page is read, never both.

**Mobile.** At 375px the sheet is the surface that matters. A picker inside a sheet cannot scroll
sideways, so rows wrap. Only a real phone can confirm the bottom edge.

## 5. The server

**`GET /api/test-catalog/browse`**, gated on `forms.view`, taking the paging and filters
`parseCatalogListQuery` already parses, and answering `{ rows, total }` where a row is
`{ code, display, category, enabled }`.

Not the existing `GET /api/test-catalog`: that is gated on `terminology.view`, which a Lab Technician
does not hold, and it answers management data a data-entry surface has no business seeing. The new
route reuses `TestCatalog.list` and narrows what it returns.

**No CLI command.** This is data entry, not administration (AGENTS.md section 6, item 2), the same
reasoning that gave S4 and bench result entry no command.

## 6. Tests, and what each layer proves

- **Route tests:** the wire shape, the `forms.view` gate, that `terminology.view` alone is refused,
  and that the filters reach the store unchanged.
- **Studio component tests:** rows render with their marker, search and the category filter ask the
  server, an off test cannot be picked, picking an offered test writes the coding, the empty state,
  and the loading state.
- **Runtime test:** the `⋯` menu appears on a field another field depends on, and not on an ordinary
  reference field.

**HONEST NON-PROOF.**

- Nobody has browsed a real catalog: this dev database holds no tests, by decision 3.
- The sheet at 375px on a real phone.
- Paging against a catalog of thousands. pg-mem's stable scan order cannot show ordering trouble
  (AGENTS.md section 7), so any `ORDER BY` with `OFFSET` needs its unique tiebreaker, which
  `TestCatalog.list` already has.

## 7. Deferred, and why

- **Switching a test on from the sheet.** A Lab Technician holds no terminology capability, so it
  would need a request-an-admin workflow. Its own piece of work.
- **Browsing from anywhere else.** Only the Lab order needs it today.
- **Seeding, of any kind** (decision 3).
