# Seeded report templates: findings and improvements

Date: 2026-09-01. Status: awaiting operator review. Spec 3 of 3.

## How these findings were produced

All ten seeded designs were reviewed. Nine were rendered to PDF with synthetic data via a
throwaway script (scratchpad `render-seeds.ts`: `renderReportDesignPdf` with fake resolved
tables, rasterized with pdfjs-dist@6.0.227 plus @napi-rs/canvas@1.0.0, white background
first) and inspected as images. `rt-transmission-grid` was inspected from the operator's
own exported PDF instead of synthesized, because faking its grid data correctly is
error-prone and a real render existed.

Limits of that pass, stated plainly: the data was synthetic, so data-dependent layout
(very long facility names, hundreds of rows, six-week months) was not exercised. The
rasterizer substituted fonts in the PNGs; that affects the pictures, not the PDF layout,
which pdfkit measures with its own metrics.

## Verdict table

| ID | Finding (plain words) | Verdict | Proof | Cost |
|----|------------------------|---------|-------|------|
| T1 | No configured logo prints a dashed placeholder box on every report | CONFIRMED | draw.ts:1066 falls through to the dashed rect; visible in all nine renders | S |
| T2 | Authored border widths print one third too thick | CONFIRMED | draw.ts:700, :1037, :1042 pass `strokeWidth` to pdfkit unconverted; fontSize converts at its call site | S |
| T3 | Eight factory reports state no metric; reader must guess what the numbers measure | CONFIRMED | simple-design.ts:56 renders `metric` only when set; only glass-ris and antibiogram set it (report-seeds.ts:4593, :4643) | S |
| T4 | Number formatting is inconsistent inside one column (65 beside 23.7) | CONFIRMED | first-isolate render, %R column; renderer stringifies values as-is | M |
| T5 | Clinical micro status chips fill the whole 350px column and shout | CONFIRMED | clinical-micro render; drawGrid fills the full cell at draw.ts:1306 | M |
| T6 | Clinical micro `org` panel has 1.5pt slack; a second bound column clips 93% | CONFIRMED | px-vs-pt memory, re-checked against rect at report-seeds.ts:4727 | S |
| T7 | Factory reports read flat next to the transmission grid; no summary band | CONFIRMED as taste, not defect | compare any factory render with the operator's PDF | M-L |
| T8 | Numeric table columns left-align and read badly | REFUTED | renders show right-aligned numerics; no work needed | 0 |
| T9 | Transmission grid needs template work | REFUTED | the operator's PDF is the house standard; only T1 touches it | 0 |
| T10 | Canvas shows more keyvalue rows than the PDF fits | CONFIRMED, but owned by spec 1 | PageCanvas.tsx:199 CSS grid vs pairRects points, px-vs-pt memory | M |

Count: 8 confirmed (one owned elsewhere), 2 refuted.

## Fixes, in build order

**T1, logo placeholder.** The dashed box is right on the canvas and wrong on paper. In the
renderer, when an image's `src` interpolates to empty (unset `{{lab.logo}}`), draw
nothing. Keep the dashed box for a src that resolved but failed to draw, because that is
a real defect worth showing. Canvas keeps its placeholder always. Golden tests will
change for identity-less renders; update them deliberately in the same commit.

**T2, strokeWidth.** Multiply by `PX_TO_PT` at the three sites, matching fontSize. Every
seeded design's rules get 25% thinner, so every golden changes. Do it alone in one slice
with a before and after PNG pair in the commit message. The px-vs-pt memory's PtRect
branding idea (typed points so mixing scales fails to compile) rides along here if cheap,
else it is noted and dropped.

**T3, metric lines.** Author `metric` for the six factory reports missing one. Pure seed
data. Wording per report, for example turnaround: "Hours between specimen received and
report issued." The scope panel already sizes itself from its pair count
(simple-design.ts:77), so no geometry work.

**T4, number formatting.** Add `decimals?: number` to `BoundColumn`. When set, a value
that parses as a number renders with that many decimals; non-numbers pass through. Author
it on the seeded %R (1) and hours (1) columns. Renderer-side because the seeds' own
comment says dialect SQL is where number-to-string formatting goes wrong
(report-seeds.ts:4838). Small UI: a decimals input beside the column label in the Data
tab.

**T5, compact chips.** New emphasis value `chip`: fill sized to the text plus padding,
not the whole cell. Default stays `text`; existing `fill` is untouched. Author
`rt-clinical-micro`'s result column to `chip`. Render and look before and after.

**T6, org slack.** Grow the `org` rect (report-seeds.ts:4727) so a second bound column
fits, shifting `band`, `bandt`, `tbl` down by the same amount, exactly as the ten-pair
slice did. Add the missing capacity assertion through `toPt` plus `pairRects`, and prove
it discriminates by shrinking the box and watching it fail.

**T7, summary bands.** Do NOT build in this spec. It needs one summary query per report,
which is real SQL against three dialects each. Revisit after spec 2 lands totals, which
covers part of the want. If the operator wants one flagship, start with turnaround time
(reports, average hours, worst test as stat pairs) as its own slice.

## Testing

- T1, T2, T5: renderer unit tests plus updated goldens, then rasterize and look. The
  look is the test that catches what unit-blind suites miss; this repo has the scar.
- T4: unit test the formatter, one golden with decimals set.
- T6: the discriminating capacity test described above.
- Layer honesty: all green suites here prove the renderer layer only. No studio behavior
  changes except the two small Data tab inputs (T4 decimals, T5 emphasis option), which
  get component tests.

## Definition of done (AGENTS.md §6)

Changelog after merge. Docs: the report designer docs mention decimals and chip emphasis
in en, fr and pt. UI surface is two small controls. CLI parity not applicable, stated per
the rule. Mobile: no layout change beyond the Data tab rows; check them at 375x812.

## Open questions for the operator

1. T2 changes the look of every printed report slightly (thinner rules). Approve?
2. T7: want the one flagship summary band on turnaround time, or hold entirely?
