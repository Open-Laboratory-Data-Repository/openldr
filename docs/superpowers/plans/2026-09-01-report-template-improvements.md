# Report Template Improvements (Spec 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The six confirmed template fixes, in the spec's build order: T1 logo placeholder, T2 border widths, T3 metric lines, T4 per-column decimals, T5 compact chips, T6 organism panel slack. T7 (summary bands) stays held per the spec.

**Spec:** `docs/superpowers/specs/2026-09-01-report-template-improvements-design.md`.

## Global Constraints

As before, plus: T1 and T2 change golden bytes — update goldens DELIBERATELY, one fix per commit, and rasterize a before/after look for each. All ten seeded designs re-render on the next boot, so seed edits (T3, T5, T6) reach installs automatically.

## Tasks, in the spec's order

### T1: an unset logo prints nothing
`draw.ts` image case: a `src` that INTERPOLATES to empty (unset `{{lab.logo}}`) draws nothing; a non-empty src that fails to draw keeps the dashed defect box. The canvas keeps its placeholder always (authoring needs to see the slot). Failing test: a design whose image el has `src: '{{lab.logo}}'` and no identity renders byte-identical (normalized) to the same design without the image element. Update goldens if touched.

### T2: strokeWidth converts like fontSize
Multiply `style.strokeWidth` by `PX_TO_PT` at draw.ts:700, :1037, :1042. Alone in its commit; goldens updated; before/after PNG rendered and looked at. The PtRect branding idea rides along only if it stays a small change, else it is dropped with a note.

### T3: metric lines on the six factory reports
Author `metric` in `report-seeds.ts` for amr-resistance, test-volume, turnaround-time, patient-demographics, amr-facility-summary, amr-first-isolate-summary. Wording states what the numbers measure, one line each, no clinical vocabulary beyond what the report already names. The scope panel sizes itself from its pair count, so no geometry edits; re-run the seed geometry tests.

### T4: per-column decimals
`BoundColumnSchema` gains `decimals?: number` (int 0..4). At the value-formatting point in draw.ts, a parseable number renders with that many decimals; non-numbers pass through. Author `decimals: 1` on the seeded %R and hours columns. Data tab: a small decimals Input beside statusKey for included columns. Opt-in, inert, golden proof.

### T5: compact chips
`emphasis` gains `'chip'` (schema enum + `CellEmphasis` union + the two emphasis Selects). Drawing: a chip fills a rounded rect sized to the TEXT plus padding, not the whole cell; `fill` and `text` are untouched. Author `rt-clinical-micro`'s result column to `chip`. Render and look.

### T6: organism panel slack
Grow `org` h in report-seeds.ts (58 → 78) and shift `band`, `bandt`, `tbl` down 20px, the same move the ten-pair slice made. Add the toPt+pairRects capacity assertion for a TWO-column org panel and prove it discriminates (fails at the old height).

### T7: gate, look, merge
Full gate; rasterize the three changed templates (clinical micro, one factory report, transmission grid for T2's thinner rules) and LOOK; a short live smoke only if a UI control changed (T4's decimals input); merge `--no-ff`, changelog, push, confirm SHA.
