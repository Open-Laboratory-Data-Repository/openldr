# Report designer: four new features

Date: 2026-09-01. Status: awaiting operator review. Spec 2 of 3.
Builds on spec 1 (authoring catch-up). Nothing here starts before spec 1 lands.

## Scope

Four features, chosen from the concept gallery by cost and by the user action each fixes:

1. Totals row and sum tokens (small).
2. Draft watermark (small).
3. Conditional formatting rules (medium).
4. Shared letterhead (medium, deliberately narrowed).

Explicitly deferred, each waiting for a named symptom: batch render (a program asks for
per-district mailings), group bands (a real report needs one section per group),
multilingual print (a non-English lab asks), version history (someone loses a design to
autosave), live sample data on canvas (spec 1's page strip already loads counts; full
inline data waits), sparklines (a report asks for trends). Do not build these from this
spec.

## 1. Totals row and sum tokens

Broken today: a totals line needs an extra UNION in the SQL, and it pollutes `sortBy`.

- Schema: on a `table` element, `totals?: { label: string; columns: string[] }`. Opt-in,
  inert when unset, golden test proves byte-identical renders without it.
- Renderer: after the last body row of the LAST chunk only, draw one bold row. `label`
  goes under the first column, each named column gets the sum of its numeric values.
  A value that does not parse as a number makes that column's total blank, never NaN.
  A `headerRow` table sums body rows only. A transposed table refuses totals at write
  time (summing across organisms is meaningless); enforce beside the `headerRow` gate in
  `header-row.ts`, same pattern.
- Text elements: `{{sum(elementName.columnKey)}}` resolves against a bound table on the
  same page. An unresolvable sum renders an em dash character, matching the unset-param
  convention in draw.ts:264.
- UI: a Totals section in the Data tab, checkbox plus column picker.
- Excel export: totals row appended to the sheet, kept in parity by a shared helper.

## 2. Draft watermark

Broken today, weakly: `status: 'draft' | 'published'` exists (schema.ts:370) but a
printed draft is indistinguishable from a published report.

- Renderer: when `design.status === 'draft'`, draw one diagonal DRAFT stamp per physical
  page, low-opacity stroke text, drawn LAST so nothing covers it. No schema change.
- The word DRAFT is a literal in the renderer for round one. It is process vocabulary,
  not clinical vocabulary, so AGENTS.md §8 does not apply. If a lab wants other words,
  that is a later design field.
- Preview and export both show it, since both render the working design. The studio
  Preview dialog gains nothing; it already renders truth.
- One golden test for a draft design and one proving published output is unchanged.

## 3. Conditional formatting rules

Broken today: a highlight needs a status column written in SQL
(`silent_status` in q-transmission-hvleid is the live example). An author who cannot
write SQL cannot mark late labs.

- Schema: on `BoundColumn` and `TrailingColumn`,
  `rule?: { op: 'gte' | 'lte' | 'eq' | 'neq'; value: string; status: CellStatus }`.
  One rule per column in round one. Multiple thresholds wait for a symptom.
- Resolve time, not draw time: where bound results are projected, a column with a `rule`
  and no `statusKey` computes status tokens from its own values. `statusKey` wins when
  both are present, because data that already carries judgment should not be second-guessed
  by a display rule. Numeric compare when both sides parse as numbers, else string equals.
- The renderer's drawing paths do not change at all. Rules compile into the same status
  tokens `statusKey` already delivers. One mechanism, two authoring routes.
- Threshold values are authored per design and stored in the design JSON, typed by the
  operator. Nothing clinical is hardcoded in source (AGENTS.md §8). The rule editor's
  status options are the existing presentational CELL_STATUSES, no new colors.
- UI: in the Data tab's per-column row, next to the existing statusKey Select: op Select,
  value Input, status Select.
- Studio canvas: no change. The canvas draws shape, not data, per CellGridPreview's
  contract.

## 4. Shared letterhead, narrow version

Broken today: the letterhead geometry is COPIED into `simpleTableDesign` and into both
literal designs (report-seeds.ts:4676 and :4798, simple-design.ts:119). The lab moves
office and someone edits every design, or misses one. The `{{lab.*}}` VALUES are already
shared through Settings; only the layout drifts.

- New element kind `letterhead`. One rect, no children. The renderer expands it to the
  standard band: logo, `{{lab.name}}`, `{{lab.address}}`, `{{lab.contact}}`, rule. The
  band's geometry lives in ONE exported constant in `@openldr/report-designer`.
- Canvas preview mirrors the same constant, so the author sees the true band.
- Seeds: migrate `simpleTableDesign` and both literal designs to the new element in the
  SAME slice, deleting the copied four-element blocks. That migration is the point of the
  feature. The seed tests that pin letterhead geometry move to pinning the constant.
- A design that wants a custom letterhead simply does not use the element. Nothing is
  taken away.
- A full component system (arbitrary reusable blocks, a components table, refs) is
  deferred until a second shared block exists. One instance is a constant, not a system.

## Testing

- Every schema addition: opt-in, inert when unset, golden test for byte-identical output
  on old designs. This repo's flags all carry that contract (schema.ts:177, :219, :241);
  keep it.
- Rules: resolve-layer unit tests (tokens computed), one render test (chips drawn), and a
  rasterized look at a page with rules firing and not firing.
- Letterhead: render one migrated seed and diff its PNG against a pre-change render by
  eye. Byte-identical PDF is NOT expected (element order changes); visual sameness is the
  bar, and a human look is the test.
- State the layer each green test proves. pg-mem proves nothing here.

## Definition of done (AGENTS.md §6)

Same as spec 1: studio UI, en, fr and pt keys, mobile pass with the dvh caveat,
`pnpm make:changelog` after merge. CLI parity not applicable, stated per the rule.

## Open questions for the operator

1. Rules: is one rule per column enough for round one?
2. Letterhead: is migrating all ten seeds in the same slice acceptable churn?
