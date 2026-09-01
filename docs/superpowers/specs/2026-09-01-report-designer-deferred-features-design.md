# Report designer: the five approved deferred features

Date: 2026-09-01. Status: awaiting operator review. Spec 4 of 4.
Follows specs 1 to 3, all shipped. Builds on their element kinds, flow fields and page strip.

## Scope

The operator approved five of spec 2's seven deferred items on 2026-09-01, in this order:

1. Live sample data on the canvas
2. Sparklines in table cells
3. Version history
4. Element groups
5. Multilingual print

Still deferred, unchanged: **batch render** (waits for a program asking for per-district
mailings) and **group bands** (waits for a report needing one section per group). Do not build
either from this spec.

Each feature is its own slice: its own branch, gate, live smoke, merge and push.

## What the falsification pass found

Cheap refutation before expensive building (AGENTS.md §2). Three claims from spec 2 were wrong
or stale, and the costs moved:

- **Version history is mostly built.** `packages/db/src/migrations/internal/084_report_design_versions.ts`
  already creates `report_design_versions` (design_id, version, name, paper, orientation, pages,
  parameters, margins, page_numbers, published_at, published_by, unique on design_id+version).
  `store.listVersions()` (`packages/report-designer/src/store.ts:212`) and
  `GET /api/report-designs/:id/versions` (`apps/server/src/report-designs-routes.ts:114`) exist,
  and `publish()` snapshots on every publish. Missing: a single-version fetch, a restore, and any
  UI. Spec 2's "the forms builder is the sibling to copy" was right about the SHAPE only: the
  studio already calls `/api/forms/:id/versions` and `/api/forms/:id/versions/:version`
  (`apps/studio/src/api.ts:1766`), which is the reference for the new endpoints.
- **Live canvas data is nearly free.** `PageCanvas` already takes `resolved`
  (`apps/studio/src/report-designer/PageCanvas.tsx:42`, added by slice B for break lines) and
  `fetchResolvedTables` already loads it. Only `ElementContent` (`PageCanvas.tsx:365`) does not
  receive it.
- **Element groups, sparklines and multilingual print are genuinely new.** No `groupId`, no
  spark option, no per-design locale map exists anywhere in the schema.

## Global constraints

Every schema addition is **opt-in and inert when unset**, with a golden proving an old design
renders byte-identical. Every user-visible string is an i18n key in en, fr AND pt. shadcn only.
Studio patch opts follow the discrete-vs-coalesced convention. `pnpm turbo run test
--concurrency=4`, never piped through `tail`. No `Co-Authored-By` trailers.

---

## Slice 1: live sample data on the canvas

**Broken today.** An author sizes a table box against placeholder stripes and finds out what
actually fits by exporting. Slice B's page strip already loads the real rows to count pages, and
then throws that data away for drawing purposes.

**Design.** A Show data toggle in the canvas header, next to the zoom controls. It reuses the
page strip's existing snapshot (`resolvedData` in `ReportDesignerPage`), so it costs no extra
query: if the strip has not loaded yet, the toggle is disabled and says to load pages first,
rather than guessing. `ElementContent` gains the `resolved` prop that `ElementBox` already
receives, and each bound kind renders its real projection instead of sample content:

- `table`: real headers and the rows that fit, using the same `rowsFor` projection the renderer
  uses, so decimals, totals and status tokens all show as they will print.
- `cellgrid`: real label column and real filled cells.
- `keyvalue`: real label and value pairs from row 0.
- `chart`: real bars, line or donut from `chartData`.
- `barcode` and `qrcode`: unchanged, they already encode their bound value.

**No schema change and no renderer change.** The toggle is view state, not design state, so it is
never persisted and never reaches the PDF.

**The honest-fit rule.** The canvas must show only the rows the FIRST page will hold, computed
with the same `maxRowsFor` the renderer and the break line already use. Showing more rows than
the PDF fits is the exact defect this slice exists to remove, so showing all of them would be a
regression wearing a feature's clothes.

**Testing.** Component tests that a bound table with a resolved map renders real values, that it
renders sample placeholders without one, and that it never renders more rows than `maxRowsFor`
allows. HONEST NON-PROOF: these prove the canvas layer only. The canvas and the PDF agreeing is
asserted by using one projection function, not by a test that renders both.

---

## Slice 2: sparklines in table cells

**Broken today.** Nothing, strictly. This is the operator's approved taste call: a trend column
next to a count is the difference between a table and a report you can read at a glance.

**Design.** `BoundColumn` gains `spark?: boolean`. The query supplies a delimited numeric string
in that column, for example `4,6,9,7,11`. A spark cell draws a miniature line inside the cell
rectangle instead of drawing the text, reusing `linePoints` from `render/chart.ts` at cell size
with the same `CHART_COLORS[0]`.

- A value that does not parse as two or more numbers draws the raw text instead, never a blank
  cell and never a throw.
- Column width policy: a spark column is never right-aligned and never measured from its string,
  since the string is data, not a label. It takes a declared minimum like a `flag` column.
- Excel export writes the raw string, not a picture. A spreadsheet cell holding the numbers is
  honest; an image is not exportable data.

**Testing.** Geometry unit tests at cell size, a render test, a golden proving an old design is
unchanged, and a rasterized look before the slice is called done.

---

## Slice 3: version history

**Broken today.** Autosave overwrites the good design about 1.2 seconds after a bad edit, and
undo is in-memory only, so closing the tab loses the ladder. Publish already snapshots into
`report_design_versions`, and nothing in the studio can see or use those snapshots.

**Design.** No migration. The table is already right.

- `store.getVersion(id, version)` returning one snapshot as a `ReportDesign`.
- `GET /api/report-designs/:id/versions/:version`, mirroring the forms endpoint exactly.
- A Versions item in the designer's kebab opening a drawer: version number, published at,
  published by, and a Restore action per row.
- **Restore loads the snapshot into the working copy as an ordinary edit.** It is a
  `pushTemplate` on the client, so it lands as one undo step and autosave persists it like any
  other change. It is deliberately NOT a server-side overwrite: a restore that bypassed the
  normal save path would skip the write gates (`findUnsortedHeaderRows`, `findTransposedTotals`,
  `findInvalidImageSources`) that every other write passes.
- Restoring does not publish. The restored working copy is a draft until the operator publishes
  it, which is what makes restore safe to try.

**Snapshots stay publish-time, not save-time.** Spec 2's sketch said "snapshots on save". That
would write a row every 1.2 seconds of typing and bury the meaningful versions in noise. The
autosave-loss symptom is answered by restore plus the existing publish snapshots; a save-time
history is a different feature and waits for its own symptom.

**Testing.** Store test for `getVersion`, route test for the new endpoint including 404 on an
unknown version, and a studio test that Restore pushes one undo step rather than calling an API.

---

## Slice 4: element groups

**Broken today.** The operator asked for this on 2026-09-01: a letterhead or a section block is
several elements that are moved, locked and hidden one at a time. Slice C's per-element lock and
hide cover the single-element case only.

**Design.** Flat, not nested:

- `DesignElement` gains `groupId?: string`.
- `DesignPage` gains `groups?: { id: string; name: string; locked?: boolean; hidden?: boolean }[]`.

**Flat because `elements[]` order IS z-order**, and flow (`flowAfter`, `showWithTable`),
pagination and the Layers list all index that array. Nesting would restructure it and break all
three at once. A group is a label over members, never a container.

- Selecting any member selects the whole group. Alt-click selects the single member inside it,
  the standard escape hatch.
- A group's `locked` and `hidden` OR with the member's own flag: locking a group cannot silently
  unlock an element that was locked on its own.
- The Layers tab shows a group as a header row with its own eye and lock, its members indented
  beneath it.
- Renderer: `hidden` on a group hides its members, reusing slice C's existing absence semantics.
  Nothing else in the renderer changes, and a design with no groups renders byte-identical.
- No nested groups. A group inside a group waits for a symptom.

**Testing.** Model tests for group create, add, remove and the OR semantics; canvas tests for
group selection and alt-click; a golden for the no-groups case.

---

## Slice 5: multilingual print

**Broken today.** The studio ships in en, fr and pt; its printed output is English only, so a
French-speaking lab prints English reports.

**Design.** An optional override map on the design, never a change to `text` itself:

- `ReportDesign` gains `i18n?: Record<string, Record<string, string>>`, language then element id
  then text.
- At render, an element's text is the override for the run's language, or the authored text when
  there is none. A missing translation falls back rather than printing blank. That is the whole
  reason for an override map rather than replacing `text` with an object: an existing design
  keeps working untouched.
- The run's language comes from `RenderOptions.lang`, supplied by the caller the same way
  `identity` and `values` already are. The reports page passes the operator's current language;
  the CLI and scheduler pass theirs.
- Authoring: a language switcher in the Properties tab. With a non-default language selected,
  the content field edits the override for that language and shows the authored text as its
  placeholder.
- Data is never translated. Only authored text is.

**Testing.** Renderer tests for override, fallback and an absent map (byte-identical golden);
studio tests for the switcher writing the right map entry; a rasterized French render to look at.

## Definition of done, per slice

UI, docs in the guide, mobile check at 375x812, `pnpm make:changelog` after merge, and a live
smoke with the operator's bypass procedure. CLI parity is not applicable to authoring surfaces,
stated here per AGENTS.md §6 rather than left silent.

## Open questions

1. Slice 5: should the reports page expose a print-language picker per run, or always use the
   operator's studio language? The spec assumes the latter, which needs no new UI.
2. Slice 4: should a group's name appear on the canvas, or only in Layers? The spec assumes
   Layers only, to keep the canvas clean.
