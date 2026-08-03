# Clinical report template — scope note

**Date:** 2026-08-03
**Status:** NOT STARTED. Scoped from a reference mockup; sized as its own workstream.
**Reference:** `D:\Downloads\Lab-Report-Formats.svg` (341KB structural mockup) + operator screenshots.

---

## 0. Why this is a workstream and not a styling pass

The table *inside* a report now looks considered — content-proportional columns, right-aligned
numerics, header band and rules, in both renderers (`3ac8b4e0`, `8cf8acdf`). What the reference
shows is a different thing: a **clinical report document**. The gap is not visual polish, it is
missing capability. Three independent blockers, each of which alone would stop the template:

1. **The element vocabulary cannot express it.** `ElementKind` is
   `text | table | image | line | rect | datetime` (`report-designer/src/schema.ts:3`). The
   reference needs a **barcode**, a **QR code**, a **key/value metadata panel**, and **section
   bands**. Only the last is expressible today (`rect` + `text`).
2. **The data the reports carry cannot fill it.** The reference's whole visual language is
   per-result *status*: green / red / amber cells, a Result vs Reference-Range vs Units column
   triplet, flags in the margin. CE's report rows are untyped `string[][]` by the time they reach
   `drawGrid` — no units, no reference range, no per-cell abnormality. `lab_results` HAS
   `abnormal_flag` and `numeric_units`, but no report projects them and the renderer has no cell
   model to colour against.
3. **A new template cannot reach an existing install.** `SEED_DESIGNS` and `SEED_REPORT_DEFS` are
   **create-if-absent only** (only `SEED_QUERIES` managed-overwrites). Authoring a beautiful design
   document changes nothing for anyone who already has the old one. A delivery mechanism is a
   prerequisite, not a detail.

Any one of these is a slice. Together with the template itself they are a workstream.

## 1. Anatomy of the reference

Read off the mockup and the operator's screenshots, top to bottom:

| # | Band | Needs |
|---|---|---|
| 1 | Identity header — logo, lab name/address, report title | `image` ✔, `text` ✔ |
| 2 | Patient / sample metadata, two columns of label→value, plus **barcode** | **new `keyvalue`**, **new `barcode`** |
| 3 | Rule closing the header | `line` ✔ |
| 4 | Paired dark-header panels (Practice / Patient / Sample Information) | **new `keyvalue`** |
| 5 | Full-width **section band** introducing a results block | `rect`+`text` ✔ (awkward) |
| 6 | Status rows — green / magenta / grey pills against a label | needs cell status model |
| 7 | Results table — Result, Quantitation, Cutoff/Range, colour-coded per cell | needs §0.2 data + cell status model |
| 8 | **QR code** bottom-left, signature line bottom-right | **new `qrcode`**, `line`+`text` ✔ |

## 2. Suggested slices

- **S1 — cell status model.** Let a table column declare a *kind* (`value`, `range`, `units`,
  `flag`) and a row carry per-cell status. Renderer colours from status only; no clinical logic in
  the renderer. Unblocks 6 and 7. Biggest single win, and testable without any new element kind.
- **S2 — reference ranges reach the report.** Project `abnormal_flag` / `numeric_units` (already in
  `lab_results`) and decide where a reference range comes from — terminology, or a new column. This
  is the clinical-correctness slice and deserves its own falsification pass; do NOT invent ranges.
- **S3 — `barcode` + `qrcode` element kinds.** Self-contained: schema, designer palette, renderer.
  Needs a dependency choice (pdfkit has neither built in).
- **S4 — `keyvalue` panel element.** Removes the need to hand-place dozens of text elements.
- **S5 — template delivery.** Managed-overwrite for `SEED_DESIGNS`, or versioned templates the
  operator can adopt. Without this, S1–S4 reach fresh installs only.
- **S6 — author the template(s)** against the reference.

Sequence S1 → S2 before anything visual: they are what makes the report *clinical* rather than
decorated, and S6 is cheap once they exist.

## 3. Catalogue the operator wants eventually

Not in scope here; recorded so it is not lost. Per-test report formats seen listed online:

- **Haematology** (12+): Absolute Eosinophil Count, APTT, DLC, ESR (Westergren), ESR (Wintrobe),
  Filarial Parasite (Card), G6PD, Haemoglobin, Malaria Parasite (Card), Platelet Count, PT/INR,
  Reticulocyte Count
- **Biochemistry** (42): Albumin, ALP, Amylase, Anti-CCP, Anti-TPO, Blood Sugar PP, BUN, Calcitonin,
  Calcium, Chloride, Cholesterol, CMV antibody, CPK-MB, D-Dimer, DHEA, Fasting Blood Sugar,
  Ferritin, GGT, GTT, HbA1c, Indirect Coombs, Iron, Lipase, Potassium, Protein, Random Blood Sugar,
  Bilirubin (Total), Creatinine, IgE, Phosphorus, Urea, Uric Acid, SGOT (AST), SGPT (ALT), Sodium,
  Thyroglobulin, TgAb, TIBC, Triglycerides, Troponin I, Vitamin B12, Vitamin D3
- **Serology & immunology** (24): Anti Cardiolipin, ANA by ELISA, Anti Phospholipid, ASO Titer,
  Beta-2 Glycoprotein 1, Beta HCG, CRP, Chikungunya, Dengue NS1, HBeAg, HBsAg, HCV, HIV (Card),
  Insulin Random, Malaria Antigen, Myoglobin, Occult Blood (Stool), Progesterone, RA (Quantitative),
  Rubella, Testosterone Free, Testosterone Total, Total PSA, VDRL
- **Endocrinology** (10): T3, T4*, TSH, FT3*, FT4*, AFP, Prolactin, LH, FSH*, Folic Acid  (*listed
  "coming soon" at the source)
- **Microbiology** (7): AFB, Blood C&S, Gram's Stain, PUS C&S, Sputum C&S, Stool C&S, Urine C&S
- **Clinical pathology** (4): Urine Albumin/Creatinine Ratio, Semen Examination, Urine Cortisol,
  Urine Routine Examination

⚠ These are a *reference list of shapes*, not a mandate to hardcode 100 templates. Most differ only
in analyte rows and reference ranges — which is precisely what S1/S2 turn into data. Building the
model right means the catalogue is content, not code.

## 4. Also outstanding

`columnWidths`/`isNumericColumn` are duplicated between `report-designer/render/draw.ts` and
`report-pdf/src/index.ts` (leaf package; the dependency direction forbids importing upward).
Consolidate when this workstream restructures the renderers.
