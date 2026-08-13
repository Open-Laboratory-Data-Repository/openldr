# One filter toolbar, every table

**Slice 1 of 3.** Client-side pages only. Slice 2 is Audit, slice 3 is Facilities — both
server-side, both specced separately.

The Users page already handles filters the way the operator wants: search, Filter with a count
badge, Sort, Columns `n/m`, Reset, and a row of removable chips under it. Seven other tables do
something else. This slice makes them all do the Users thing.

Agreed with the operator on 2026-08-13, after they searched the studio and saw the inconsistency.

---

## Why

**The kit already exists and almost nobody uses it.** `apps/studio/src/components/data-table/`
holds `DataTableToolbar`, `ActiveFilterChips`, `FilterPopover`, `SortPopover`,
`ColumnPickerPopover`, `useTableState` and `applyTableState`. It has three consumers:
`pages/Users.tsx:155`, `pages/Notifications.tsx:199`, `reports/ReportSpreadsheetTab.tsx:98`.
This is adoption, not construction. No new components.

**Each page invented its own controls.** Three shapes across seven tables. A bare search input on
Forms (`pages/Forms.tsx:192`), Activity (`pages/Activity.tsx:190`) and DistributedSync
(`pages/settings/DistributedSync.tsx:196`). Search plus a code-system dropdown on Terminology
(`pages/Terminology.tsx:876,882`). Nothing at all on Roles, Connectors and Sites.

**The chrome is already translated.** `table.filter`, `table.sort`, `table.columns`,
`table.reset` and all eleven operators live at `apps/studio/src/i18n/en.ts:23`. Adopting the
toolbar costs no new chrome keys — only per-page column labels.

**One rule beats per-page judgement.** AGENTS.md §5 already mandates `TablePagination` on every
table, "a deliberate operator override of the YAGNI rule". The operator applied the same
reasoning here: every table gets the toolbar, including short config lists.

---

## Scope

| Page | Filter UI today | Work |
|---|---|---|
| `pages/Activity.tsx` | search input | columns + swap |
| `pages/Forms.tsx` | search input | columns + swap |
| `pages/Terminology.tsx` | search + code-system Select | columns + swap + i18n fix |
| `pages/Roles.tsx` | none | columns + add |
| `pages/settings/Connectors.tsx` | none | columns + add |
| `pages/settings/DistributedSync.tsx` | search input over sync activity (`:196`) | columns + swap |
| `pages/settings/Sites.tsx` | none | columns + add |

**Out of this slice.** `pages/Audit.tsx` and `pages/Facilities.tsx` are server-side paginated.
`applyTableState.ts:3` states the boundary in its own header: "Server-side pagination
(patient:query, audit:query) bypasses this entirely." They need `FilterRule[]` translated into
query params and a server-side column whitelist. Different problem, separate spec.

**Out entirely.** `pages/Docs.tsx`, `pages/Reports.tsx`, `pages/FormCapture.tsx` have search
boxes but no table. A table toolbar does not apply. `settings/DataExposure.tsx`, `General.tsx`,
`Laboratory.tsx`, `Marketplace.tsx` and `NotificationPreferences.tsx` have no `TableBody`.

**Terminology is scoped to the value sets table only.** That page has a rail and several nested
tables across tabs. The value sets table is the one with filters today. The others are out.

---

## The shape

Every page ends up with the same five lines, copied from `pages/Users.tsx:121-180`:

```
const table = useTableState({ columns, defaultPageSize: 25 })
<DataTableToolbar columns … searchValue searchPlaceholder actions={⋯ menu} />
<ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
const view = applyTableState(rows, { filters, sorts, page, pageSize }, columns)
<Table> … <TablePagination>
```

Per page the actual work is three things:

1. **Write a `ColumnDef[]`** — `id`, `labelKey`, `accessor`, `type`, `defaultVisible`, and
   `enumOptions` where the column is an enum. Shape at `components/data-table/types.ts:35`.
2. **Delete the bespoke search and Select markup.**
3. **Move the page's existing `⋯` menu into the toolbar's `actions` slot**, so AGENTS.md §5's
   dots-menu rule still holds. The prop exists at `DataTableToolbar.tsx:25`.

`type` decides the filter widget and which operators appear — see `validOperators` at
`types.ts:75`. Getting `type` wrong is the likeliest defect, so column types are worth a second
look during review.

### Some enum options are derived from the rows, not static

`ColumnDef.enumOptions` is a static array (`types.ts:45`). Terminology's code-system options are
not — they are computed from the loaded value sets at `pages/Terminology.tsx:218`, deduped from
`primarySystem`.

So that column's `enumOptions` must be built in a `useMemo` over the rows, and the `columns`
array must be memoised on it. Miss this and `columns` is a new array every render, so
`defaultVisible` (`useTableState.ts:36`), `visibleColumns` (`:60`) and the page's
`applyTableState` memo all recompute on every keystroke.

It will not reset the user's chosen columns — `visibleIds` is `useState(defaultVisible)`, an
initial value only, and nothing syncs it afterwards. The cost is churn, not lost state.

Any other page whose filter values come from data has the same requirement.

### No page gets a default filter

Users seeds `status = Active` (`pages/Users.tsx:121`). None of the seven needs an equivalent.
Checked each one for an implicit default — hiding archived rows, defaulting to published:
Terminology's `vsSystem` starts at `'__all__'` (`:213`), DistributedSync and Forms filter on the
search box only, and the rest do no default filtering. `defaultFilters` stays unset, so
`resetAll()` clears to empty.

---

## Two deliberate behaviour changes

**Terminology's code-system dropdown moves behind the popover.** It is one click today
(`pages/Terminology.tsx:876`) and becomes two. The operator chose this knowingly: one pattern
everywhere beats a faster path on one page. Once set it shows as a chip, so it stays visible.

**Terminology's filter strings get translated.** `"Search value sets..."` and `"Filter by code
system"` are hardcoded English literals. This is the same defect fixed in `faa7d56f` on the
register-source dialog. Not scope creep — that markup is being deleted and rewritten anyway, and
leaving it would ship a French UI with English filter labels.

---

## i18n

New keys are **per-page column labels only**, in `en.ts`, `fr.ts` and `pt.ts`.

`i18n/parity.test.ts` compares key paths across all three locales and fails on any mismatch. That
is the gate: a half-translated column set cannot ship. A missing key renders as literal braces
(AGENTS.md §6), so partial translation is visibly broken rather than silently wrong.

---

## Guarding the drift

The operator chose to keep `ActiveFilterChips` a separate component rather than folding it into
the toolbar. That keeps the change small but leaves nothing structural stopping page eight from
rendering the toolbar and forgetting the chips.

The substitute is a shared test helper — `expectStandardTableToolbar(screen)` — asserting the
search box, Filter, Sort, Columns and the chips container are all present. Every one of the seven
page tests calls it. Cheap, and it fails loudly when a page half-adopts.

---

## Definition of done (AGENTS.md §6)

**UI** — the seven pages above.

**CLI parity** — not applicable. This is presentation only; no admin, settings, danger-zone or
maintenance behaviour changes.

**Docs** — `docs/0.1.0/en/connectors.md` and any other doc describing controls this slice
replaces, in en, fr and pt. Audit the doc set for screenshots or prose naming the old inputs.

**Mobile** — `DataTableToolbar` is already `flex-wrap` (`DataTableToolbar.tsx:48`), so the
controls wrap. The chips row needs checking at 375×812. The §6 table traps still apply: the
`Table` scroll wrapper needs `wrapperClassName="min-h-0 flex-1"`, and an empty table's header
forces intrinsic width, so render `<Table>` only when populated.

---

## Verification, and what it will not prove

Per-page component tests assert the toolbar renders, a filter produces a chip, and removing the
chip restores the rows. `parity.test.ts` covers i18n completeness. `pnpm --filter @openldr/studio
test` is the gate.

**These prove the component layer only.** They do not prove the pages look right together — that
is the whole point of the change and only a browser can show it. Mobile at 375px needs
`resize_window`. Per AGENTS.md §6, headless Chromium cannot see the `vh`-vs-`dvh` class of bug,
so if anything bottom-anchored moves, only a real phone confirms it.

---

## Risks

**Column `type` errors are silent.** A date column typed `text` offers the wrong operators and
still renders fine. Review column types explicitly.

**Terminology is the hard one.** Rail, tabs, nested tables, and the largest page in the set. If
it fights, it should be split into its own task rather than dragging the slice.

**Seven pages is a wide diff.** Each page is independent, so they can land one at a time. Nothing
requires a big-bang merge.
