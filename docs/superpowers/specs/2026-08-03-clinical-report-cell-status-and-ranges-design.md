# Clinical report — cell status model (S1) + reference ranges & units (S2)

**Date:** 2026-08-03
**Status:** **S1 IMPLEMENTED** and merged to local `main` (`39d7fe90`). S2 not started.
Supersedes §2 slices S1/S2 of
`2026-08-03-clinical-report-template-design.md` (which scoped them before the data was measured).
**Reference:** `D:\Downloads\Lab-Report-Formats.svg`

---

## 0. Falsification pass — what changed the design

Measured on the live dev warehouse (`openldr_target`) and internal FHIR store
(`openldr.fhir.fhir_resources`), 2026-08-03. **4,821 `lab_results`, 4,821 `Observation`s.**
Probe scripts: `e2e/probe-s2{,b,c,d}.mjs` (throwaway).

| Premise in the original spec | Measured reality |
|---|---|
| `abnormal_flag` supplies per-cell abnormality | **FALSE.** 115/4821 (2.4%) populated; values exclusively `S`(108) / `R`(5) / `I`(2) — antimicrobial susceptibility. **Zero** HL7 `H`/`L`/`N`/`HH`/`LL`. |
| Reference ranges are absent and must be sourced | **Half false, and worse.** `referenceRange` *does* reach `fhir_resources` — 134 Observations carry it — but **all 134 are `text`-only** (no `low`/`high`), and the text is a **citation**: `"Roche Reference Ranges for Adults and Children"` (112), `"CREP2 package insert"` (16), `"Tietz NW Clinical Guide to Laboratory Tests 3r"` (6). A citation names where a range came from; it is not comparable to a value. |
| Units need only projecting | **Already corrupt at the FHIR layer:** `æmol/l`, `æmol/L`, `cells\æL` (should be `µmol/L`, `cells/µL`). Corruption predates projection. |

Two facts the original spec did not anticipate, both load-bearing:

**F1 — the reference's colour language is qualitative, and CE has that data.**
`result_type`: `CE` 2535 (52.6%) / `ST` 1258 / `NM` 1028 (21%). Coded values are exactly the
green/magenta/grey vocabulary in the mockup: `UNDET` "Undetected" (634), `INFND` "Influenza A and B
Not Detected" (368), `POS` (38), `NEG` (11), `IND` (2), plus `S`/`R`/`I`.
⇒ **A status model keyed on coded results is well-populated; one keyed on numeric-vs-range is not.**

**F2 — most "results" are not results.** `TPCON` Condition for Transportation (545), `COLBY`
Collected By (539), `TPD` Transportation Date (525), `CONNO` Collect By Contact Number (416),
`INSTR` Equipment ID (115). A template rendering "all results for this request" prints **the
courier's phone number as a lab result**. Filtering is a requirement, not a refinement.

### Decisions taken from this (user, 2026-08-03)

| # | Decision |
|---|---|
| D1 | Reference ranges come from **terminology**, authored as data — not invented, not ingested. |
| D2 | The units mojibake is **fixed at ingest and backfilled**, not papered over in the report. |
| D3 | Reportable-vs-metadata is **terminology-driven classification**, not a heuristic and not per-template SQL. |

---

## 1. S1 — cell status model

> ⚠ **Two claims below were falsified during planning and did NOT ship as written.** The
> implementation is authoritative; §1.1 and §1.6 are kept for the reasoning, not the conclusion.
>
> 1. **§1.1 — `rowsFor` does NOT return `Cell[][]`.** It keeps its `string[][]` shape. Changing it
>    would have dragged `tableChunkCount`, `columnWidths` and `isNumericColumn` into scope. A
>    parallel `cellStatusesFor()` ships instead — more surgical, and it makes the
>    "no `statusKey` ⇒ unchanged output" contract trivially provable.
> 2. **§1.6 — `PageCanvas.tsx` was NOT a surface.** It renders only static sample rows and never
>    resolves a bound query, so it cannot preview bound-column status. `DataTab.tsx` is the studio
>    surface that changed. A third `boundColumns` consumer the spec missed, `exportExcel.ts`, was
>    verified to need no change (it projects `boundColumns` only, so a status column cannot leak
>    into the spreadsheet).
>
> Also: **§1.4's `kind` is consumed, not inert** — `units`/`range` columns never right-align.
> And the "byte-identical" wording in §1.5 is too strong: a no-`statusKey` design differs by a
> redundant colour-operator pair in a chunk with zero body rows. **Visually** identical.

**Principle: the renderer colours from a status token it is *given*. It never computes one.**
All clinical judgement lives in SQL/terminology. This is what makes the ~100-format catalogue in
the parent spec *content* rather than 100 hardcoded templates ([[dont-hardcode-use-terminology]]).

### 1.1 Where status enters

`rowsFor()` (`packages/report-designer/src/render/draw.ts:137`) flattens
`ResolvedTable.rows` (`Record<string, unknown>[]`, `render/index.ts:7`) into `string[][]`. That is
the **last point where the whole query row is still in hand**, so it is the insertion point.

`BoundColumn` (`schema.ts:28`) gains two optional fields:

```
BoundColumn { key: string; label: string; statusKey?: string; emphasis?: 'fill' | 'text' }
```

`statusKey` names **another column in the same query result** carrying the status token.
`rowsFor` returns `Cell[][]`, `Cell = { text: string; status?: CellStatus }`, reading
`row[statusKey]`, validating against the enum, and **dropping anything unrecognised**.

**No `statusKey` → no status → byte-identical output to today.** This is the compatibility
contract that keeps all 8 built-in reports safe.

### 1.2 The vocabulary is presentational, not clinical

```
CellStatus = 'normal' | 'abnormal' | 'critical' | 'indeterminate' | 'none'
```

Deliberately **not** `high`/`low`/`resistant`/`positive`. Those are clinical facts; the mapping
`R → abnormal`, `UNDET → normal`, `IND → indeterminate` belongs in the query. This is precisely
what lets one renderer serve AST (S/I/R), serology (POS/NEG/IND) and chemistry without knowing
which it is looking at.

### 1.3 Two emphases, because the reference uses both

The centre card paints the whole cell and knocks the text out white (a chip); the left card only
turns the text red. A column declares `emphasis`, defaulting to **`'text'`** — the quieter option,
and the one that survives a mono office printer ([[report-pdf-table-layout]] palette note).

### 1.4 Column kind

`kind: 'value' | 'range' | 'units' | 'flag' | 'label'` drives alignment and width policy only.
Notably `range` and `units` must **never** right-align: today's strict `isNumericColumn`
(`draw.ts:109`) already declines `"3.5-5.0"`, and `kind` makes that intent explicit rather than
incidental.

### 1.5 What must not regress

The pagination contract is load-bearing and assumes **fixed-height single-line rows**: `ROW_H`
(`draw.ts:20`), `maxRowsFor`, `tableChunkCount`, and the `height`-based ellipsis fix from
[[pdf-table-cell-overlap]]. A filled chip must paint **within** `ROW_H` and must not change the
y-advance.

⚠ **Pin this with a test that can fail.** Assert the measured y-advance of a status-filled row
equals that of an unstyled row (equality, not `>=`) — per [[plans-cite-or-flag]] rule 7. A test
that merely checks "a fill was emitted" would stay green through exactly the regression it names.

### 1.6 Surfaces

| File | Change |
|---|---|
| `packages/report-designer/src/schema.ts` | `CellStatus`, `statusKey`, `emphasis`, `kind` |
| `packages/report-designer/src/render/draw.ts` | `rowsFor` → `Cell[][]`; `drawGrid` paints status |
| `apps/studio/src/report-designer/PageCanvas.tsx` | canvas preview matches the PDF |
| `packages/report-pdf/src/index.ts` | workflow-export sibling; otherwise silently ignores status |

⚠ `report-pdf` is a **leaf package** — it cannot import `report-designer` without inverting the
dependency direction, which is why `columnWidths`/`isNumericColumn` are already duplicated there
([[report-pdf-table-layout]]). Consolidation is out of scope for S1; parity is not.

---

## 2. S2 — the data that fills it

### 2.1 S2a — reference ranges as terminology

Observation codes in live data are `urn:openldr:default_result` (`STBIL`, `SAST`, `CD4`, …).

**Rejected: one range per code via CodeSystem concept properties.** It reuses the organism-import
machinery verbatim and is the cheaper build, but reference ranges are sex- and age-dependent for
exactly the commonest analytes (haemoglobin, creatinine, ferritin). One range per code means a
female patient's Hgb is compared against a male interval and the report asserts a clinically wrong
"normal". **That is worse than printing no range.**

**Chosen:** FHIR **`ObservationDefinition`** with `qualifiedInterval[]` (`gender`, `age`, `range`,
`condition`) — the standards-correct home for qualified ranges — projected to a `reference_ranges`
dimension keyed `(system, code, sex, age_low, age_high)`.

The v1 resolver picks the matching interval. **A single unqualified interval applies to everyone**,
so no operator is forced to author six. The data *shape* is the expensive thing to change later;
the resolver is cheap. This is the one place worth spending extra now.

### 2.2 S2b — result classification

A `result_role` property (`result | metadata | specimen | admin`) on the code system, with an
intensional ValueSet over it.

**Fail-open:** an unknown code is treated as **reportable**, following D4 of the agreed organism
slice ([[amr-terminology-slice-c]]). Silently dropping a real result from a clinical report is a
patient-safety failure; showing a stray metadata row is an embarrassment. **Loud and slightly wrong
beats quiet and wrong.** Unknown codes are surfaced to the operator, never hidden.

### 2.3 Shared machinery — the real cost

Both need terminology to reach the warehouse. Today `projectResource` drops every terminology
resource at `default: return null` (`packages/db/src/relational/index.ts:36`).

1. **Both** switches in `relational/index.ts` — `projectResource` **and** `tableForResourceType`
   (lines 36 and 50). They must stay in lockstep.
2. New dimension tables in `ExternalSchema` **and** `EXTERNAL_TABLE_COLUMNS`
   (`packages/db/src/schema/external.ts:118`).
3. An external migration.

Precedent that reference data already crosses the internal/external boundary:
`Organization`/`Location` → `facilities` (`relational/index.ts:31-32`).

⚠ **This is the exact machinery the agreed AMR organism slice specified and never built**
([[amr-slice-c-organism-semantics]] "NOT built — the consumption half"). Building it here means
that slice inherits it instead of duplicating it. Coordinate before either lands.

⚠ Open question inherited from that slice, still unverified: **does the projection DELETE a stale
dimension row when a ValueSet shrinks?** If not, a removed code is silently re-admitted. Must be
answered by this slice, since this slice is the first real consumer.

### 2.4 S2c — the units defect

The corruption is present in `fhir.fhir_resources`, therefore **upstream of projection**.

**Leading hypothesis, NOT a diagnosis:** DISA\*Lab stores `µ` as byte `0xE6` (DOS CP437, where
`0xE6` is `µ`) and the read path decodes it as Latin-1/CP1252, yielding `æ`. This fits both
`æmol/L` and `cells\æL`.

⚠ **This must be confirmed against the actual bytes before anyone edits a decode table**
([[plans-cite-or-flag]] Rule 0). The fix may land in the separate `cdr-toolchain` repo, not CE.

Backfill is not a one-liner: repairing stored resources requires re-deriving `lab_results`, and
`reprojectAll` has **no production callers** ([[ce-projection-drops-provenance]]).

---

## 3. Sequencing

| Slice | Content | Independently landable |
|---|---|---|
| **S1** | Cell status model, all four surfaces | Yes — visible coloured table with no terminology work |
| **S2a+S2b** | Terminology model + shared projection machinery | Yes |
| **S2c** | Units root-cause + fix + backfill | Yes; may be out-of-repo |

**Scope note, stated plainly:** S1 is one clean slice. S2 is three, and S2c may not be CE's code at
all. S1 lands first so the coloured clinical table is visible before the terminology work begins
([[dont-hardcode-use-terminology]] — "I work better if I could see it").

## 4. Out of scope

Barcode/QR element kinds (S3), the `keyvalue` panel (S4), template delivery / managed-overwrite of
`SEED_DESIGNS` (S5), and authoring the template itself (S6) remain as scoped in the parent spec.
**S5 remains a hard prerequisite for any of this reaching an existing install.**
