# S4 — `keyvalue` panel element

**Date:** 2026-08-03
**Status:** Agreed, not implemented.
**Parent:** `2026-08-03-clinical-report-template-design.md` (§1 bands 2 and 4; §2 slice S4).
**Depends on:** S1 cell status (`2026-08-03-clinical-report-cell-status-and-ranges-design.md`),
S5 template delivery (managed-overwrite seeding — without it a re-authored built-in reaches fresh
installs only).

---

## 0. What is wrong today

The built-in `rt-clinical-micro` fakes the reference mockup's patient/specimen panels as **one-row
tables**: `hdr` (7 columns) and `org` (1 column), both bound to `q-clinical-micro-header` with
different column projections. That produces a header band with column labels above a single row of
values — a spreadsheet fragment, not the label→value metadata block the mockup shows. It also costs
two elements to express one panel, and any panel-shaped band needs a third (`rect`) and fourth
(`text`) element to get a title bar, as the `ANTIMICROBIAL SUSCEPTIBILITY` band does today.

## 1. Falsification — what was actually true before designing

Checked against the working tree, not against notes:

| Claim | Verdict |
|---|---|
| `ElementKind` is `text\|table\|image\|line\|rect\|datetime` | **TRUE**, and written **twice** — the type alias (`schema.ts:3`) and the zod enum (`schema.ts:49`) are independent literals, plus `ELEMENT_KINDS`, `DEFAULT_NAME` (`model.ts`) and `KIND_ICON` (`elementIcons.ts`) in studio. Five sites, not one. |
| "Only tables have `dataSource`/`boundColumns`" | **FALSE.** `DesignElement` is one flat object, not a discriminated union; `dataSource` and `boundColumns` are already optional on **every** kind. Nothing in the schema stops a `keyvalue` element carrying them. |
| "`resolveDesignTables`/`ResolvedTable` are table-shaped" | **HALF FALSE.** `ResolvedTable` is `{columns,rows} \| {error}` — a generic query result that is merely *named* table-ish. What is genuinely table-shaped is four **guards**: `resolveDesignTables` (`el.kind !== 'table'` → continue), `rowsFor` and `cellStatusesFor` (early-return), `DataTab` (early-return), `exportDesignToExcel` (`filter(kind === 'table')`). |
| `PageCanvas` never resolves a bound query | **TRUE** — `ElementContent`'s `table` branch reads `el.columns`/`el.rows` only. |
| `packages/report-pdf` needs parity | **FALSE for this slice.** `report-pdf` is not a design renderer: it exports one function over `PdfInput {title, generatedAt, params, columns, rows}` — a single flat table for workflow exports. It has no element model at all, so a new element kind has no counterpart there. S1 needed parity because S1 was a *column* feature; S4 is an *element* feature. No new duplication debt is created, and the existing `columnWidths`/`isNumericColumn`/status-palette duplication is untouched. |

Two consequences follow, and they set the whole shape of the slice:

1. **There is no new binding model to invent.** The work is widening guards and adding a drawer.
2. **Pagination is already safe.** `tableChunkCount` returns `1` for any non-table element, so
   `pageChunkCount`/`totalPhysicalPages` need no change; a keyvalue panel can never split a page.

## 2. The element

A `keyvalue` element renders **label→value pairs**. Bound, **each entry in `boundColumns` is one
pair** — its `label` is the pair's label, its `key` selects the value from **row 0** of the query
result. Unbound, it draws its `rows` as `[label, value]` pairs, exactly as an unbound `table` draws
its sample rows.

Reusing `boundColumns` rather than inventing a `fields[]` array is the load-bearing decision:

- S1's `statusKey` and `emphasis` carry over with **no new code in the authoring layer** — a pair
  such as `Result: Positive` can paint a status chip because the query supplied the token, which is
  the same "the renderer never computes a status" contract S1 established.
- `DataTab` needs a widened guard and a heading change, not a second editor.
- `resolveDesignTables` needs one predicate changed, and both of its callers
  (`apps/server/src/report-designs-routes.ts`, `packages/bootstrap/src/index.ts`) inherit the
  behaviour with no change at all.

### 2.1 Schema additions

Three optional fields on `DesignElement`, all meaningful only for `keyvalue`, following the flat
kind-specific convention `src`/`columns`/`rows`/`text` already established:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `layout` | `'inline' \| 'stacked'` | `inline` | pair internal arrangement |
| `panelColumns` | int 1..4 | `1` | how many pairs sit side by side per line |
| *(reuses `text`)* | string | — | optional panel title; the title bar is drawn only when non-empty |

`ElementKind` gains `keyvalue` in all five sites listed in §1.

### 2.2 Layout

**Inline** — label and value on one line, the label taking 40% of the pair's width (floor 40pt), the
value beside it. 14pt per pair.

```
Surname      MWASEKAGA    Specimen   Urine
First name   FREDRICK     Received   2026-07-14
```

**Stacked** — a small uppercase label above its value. 22pt per pair. Chosen where a value is long
enough that a 40% label column would starve it (full names, specimen descriptions, an organism).

```
SURNAME          SPECIMEN
MWASEKAGA        Urine
```

`panelColumns` flows pairs **across, then down**, with a 12pt gutter. Panel padding is 6pt
horizontal, 4pt vertical. Content is **clipped** to the element box, as `drawGrid` clips: the box is
author-fixed and a metadata panel that silently grew would overprint whatever the author placed
beneath it.

### 2.3 Title bar

Drawn only when `text` is non-empty: a 16pt band across the top of the element, filled
`style.fill ?? '#334155'`, with 8pt bold text in `style.color ?? '#ffffff'`. Pairs begin below it.

This folds the mockup's band-4 panel — today three elements (`rect` + `text` + a fake table) — into
one, so the title cannot drift away from its own panel when the author moves it.

`style` therefore means *panel chrome* on this element (as it already does on `rect`), not text
colour: **label and value colours are fixed constants**, the same way a table does not expose
per-cell colours. Labels are muted slate, values are the table's `BODY_TEXT`.

### 2.4 Status

A pair whose bound column declares a `statusKey` colours its **value** from S1's palette —
`STATUS_TEXT_COLOR` for `text` emphasis (the default), a chip for `fill`. The chip is **sized to the
value text** (measured width + padding), not to the pair's full width, so it reads as a pill rather
than a bar; it is inset by the existing `CHIP_INSET_X`/`CHIP_INSET_Y` for the same
adjacent-slab-merging reason S1 documented. No new palette, no new tokens.

### 2.5 Degenerate cases

| Case | Behaviour |
|---|---|
| Query error | The same red `drawErrorPlaceholder` a bound table shows. |
| Zero rows | Labels are drawn with empty values. The panel's *shape* is part of the report — a blank Surname line is information; a vanished panel is a rendering bug the reader cannot see. |
| More pairs than fit the box | Clipped (see §2.2). |
| A `key` absent from the result row | Empty value, same as `rowsFor`'s `?? ''`. |

## 3. Surfaces

| Surface | Change |
|---|---|
| `report-designer/src/schema.ts` | `keyvalue` in both kind literals; `layout`, `panelColumns` fields. |
| `report-designer/src/render/draw.ts` | `drawKeyValue` + pure geometry helpers (`keyValuePairs`, `pairRects`) so layout is testable without a PDF document; `drawElement` case. |
| `report-designer/src/render/resolve.ts` | Guard becomes `if (!el.dataSource) continue` — kind-agnostic. Name and signature unchanged. |
| `apps/studio/.../model.ts`, `elementIcons.ts` | `ELEMENT_KINDS`, `DEFAULT_NAME`, `newElement` (two sample pairs), `KIND_ICON`. |
| `apps/studio/.../PageCanvas.tsx` | New `keyvalue` branch — see §4. |
| `apps/studio/.../DataTab.tsx` | Guard widens to `table \| keyvalue`; section heading becomes "Fields" for a keyvalue element. |
| `apps/studio/.../PropertiesTab.tsx` | `keyvalue` branch: title, title fill, layout, pair columns. |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | ~7 keys, with real fr/pt (`parity.test.ts` is enforced). |
| `packages/reporting/src/seed/report-seeds.ts` | Re-author `rt-clinical-micro` (§5). |

**Deliberately unchanged:**

- **`packages/report-pdf`** — no element model to extend (§1).
- **`exportDesignToExcel`** — keeps `filter(kind === 'table')`. A metadata panel is not a sheet;
  its content is one row of a query that some table in the same design already exports.
- **Pagination** — `tableChunkCount`'s non-table `return 1` already covers it.

## 4. What `PageCanvas` shows

`PageCanvas` renders the panel **structurally and never resolves a query**, which is the existing
contract for every element (a bound table shows its static sample rows, not query results).

- Title bar and pair grid are drawn in the chosen layout, so the author sees the panel's real shape.
- **Bound**: each `boundColumn.label` with a muted `—` where the value will be.
- **Unbound**: the `rows` sample pairs.

This is a deliberate, and strictly smaller, choice than resolving queries on the canvas. It is also
strictly *more* informative than the status quo, where a bound table renders completely empty on the
canvas while Preview shows rows — the defect that reads as a broken binding while editing. Live
values remain the job of Preview, which goes through the server route and the real renderer.

## 5. Re-authoring `rt-clinical-micro`

The two fake tables are replaced, same query, same two bindings:

- **`hdr`** → inline `keyvalue`, `panelColumns: 2`, no title: Surname, First name, Sex, DOB ·
  Specimen, Received, Lab number, Panel. This is the mockup's band-2 metadata strip.
- **`org`** → stacked `keyvalue` with title `ORGANISM ISOLATED`, one pair (`organism`), so the
  organism name gets the panel's full width. This is the mockup's band-4 titled panel.

Nothing else about the design moves. The seeds' managed-overwrite (S5) carries the change to
existing installs; per S5, an operator who edited the built-in in place loses those edits, which is
the accepted trade already documented there.

⚠ The seed-drift comparison in `designContent` is structural (`canonicalJson` over `pages`), so new
optional fields participate automatically — no change needed there, but the drift test must be
re-run: the shipped design changes shape, which is exactly the refresh path S5 built.

## 6. Testing

- **Geometry, no PDF**: `keyValuePairs` (bound row-0 projection, unbound `rows`, missing key,
  zero-row) and `pairRects` (inline vs stacked pitch, `panelColumns` flow order, title offset).
- **Rendered bytes**, as S1 did: title band present/absent, label and value text present, a stacked
  panel's value baseline below its label's, an inline panel's label and value sharing a baseline,
  chip drawn only for `fill` emphasis with a recognised token.
- **Resolve**: a design whose only bound element is a `keyvalue` resolves it (this is the regression
  the old `kind !== 'table'` guard would have caused).
- **Studio**: PageCanvas bound vs unbound rendering, DataTab accepting a keyvalue selection,
  PropertiesTab controls, i18n parity.
- **Seed**: `rt-clinical-micro` contains no `kind: 'table'` header elements and its keyvalue panels
  bind `q-clinical-micro-header`.

## 7. Out of scope

Barcode/QR (S3), static-pair editing in `PropertiesTab` (an unbound panel shows sample pairs and is
made real by binding a query — matching how a table's sample `rows` are also not editable), nested
or repeating panels, and per-pair colour overrides.
