# Clinical report — the performing laboratory — Design

**Goal:** the Clinical Microbiology Report must state **which laboratory performed the test**.
Today it does not, and on a national instance nothing else on the page supplies it.

---

## 1. Why this is a defect, not a nicety

**OpenLDR runs as a national instance in an MoH data centre**, not per-lab (the only per-lab
deployment is the poor-connectivity case that distributed sync serves). So the letterhead
(`{{lab.*}}`, Settings ▸ Laboratory) is the **issuing organisation** — the ministry. The
**performing laboratory** is a per-report fact that arrives in the data.

`q-clinical-micro-header` (`packages/reporting/src/seed/report-seeds.ts`) selects patient
surname/firstname, sex, dob, specimen type, received date, lab number, panel and organism.
**It selects no facility at all.** A clinician receiving `rt-clinical-micro` cannot tell which
laboratory produced the result.

## 2. Measured state (verified 2026-08-05, not assumed)

| Fact | Evidence |
|---|---|
| `lab_requests`, `lab_results`, `specimens` carry **no** performer/facility column | `information_schema` on the target DB |
| `diagnostic_reports` carries **`performer`** and **`specimen_id`** | same |
| The clinical header query already computes a `specimen_id` (via `max(l.specimen_id)`) | `report-seeds.ts` |
| `q-amr-facility-summary` already joins this way, using `min(performer)` per specimen | `report-seeds.ts` ~line 757 |
| `count(distinct performer) = 1` for all 585 specimens ⇒ `min()` is lossless | recorded in that query's own comment |

### 2.1 ⛔ The 30-character truncation is UPSTREAM — not CE, not the renderer

Measured on the live target DB:

- `diagnostic_reports.performer` is **`text` with `character_maximum_length: null`** — CE imposes no cap.
- Length distribution has a hard wall: **15 rows at exactly 30**, then 25, 24, 14, 12, 11 — not a
  natural spread.
- The 30-char values are cut mid-token: `"International School of Tangan"` (Tanganyika),
  `"Ocean Road Cancer Institute (O"` — an unclosed parenthesis.

⇒ A fixed-width 30-char field in the **source system (DISA)** clipped these before ingest. It is the
original schema.

**This is what makes registry resolution mandatory rather than optional.** The full name is
*unrecoverable from the data*. Printing `"Ocean Road Cancer Institute (O"` on a report that goes to a
clinician is not acceptable, and no amount of work on the report can fix it — the name must come from
the facility registry.

## 3. What ships

### 3.1 The join

`q-clinical-micro-header` gains the performing lab by joining `diagnostic_reports` on the
`specimen_id` it already computes, taking `min(performer)` per specimen — the same route and the same
justification `q-amr-facility-summary` documents.

⚠ Must be added to **all three dialect variants** (`postgres`, `mssql`, `mysql`). The seed carries
one SQL string per dialect and they are maintained together.

### 3.2 The resolution — the raw string is a MATCH KEY, not a name

Resolve `performer` through `facility_aliases (source_system, local_code)` →
`facility_registry.name`. That is exactly what aliases exist for: one alias resolves to one facility,
many aliases point at one row.

⛔ **Never fuzzy-match.** The registry spec is explicit and the reason is concrete: `Dodoma` is a
region; `HYDOH` / `CDCIL` / `NHLQATC` are acronyms. A similarity score is confidently wrong exactly
where it matters. Store and match the arrived string **exactly**.

### 3.3 The fallback

An **unmapped** performer prints the raw string. A clinical report must never go out with a blank
laboratory because nobody has reconciled that alias yet. A truncated name is worse than a full one
and far better than nothing.

⚠ **On today's data this will mostly print raw strings**, because no aliases are populated yet. That
is expected and still an improvement over printing nothing. Reconciliation is §5.

### 3.4 Placement on the page

The performing lab belongs in the **band 2 / band 4 keyvalue panel** (the `keyvalue` element S4
shipped), **not** the letterhead. Two different facts:

- letterhead = the **issuing** organisation (MoH), from `app_settings`, same on every report
- performing lab = **who tested this specimen**, from the row, different per report

Putting it in the letterhead would re-introduce the exact confusion the architecture correction
resolved.

## 4. Testing

- The header query returns a performing lab for a specimen whose `diagnostic_reports` row has one.
- An **unmapped** performer falls back to the raw string (not null, not blank).
- A **mapped** performer resolves to `facility_registry.name`, not the truncated string.
- A specimen with **no** `diagnostic_reports` row yields null and the report still renders.
- ⚠ Parity: `report-seeds.test.ts` and the per-report parity tests pin these queries. All three
  dialect variants must stay in step.
- Render a PDF and look at it. The operator asked for this explicitly last time: *"Show me a rendered
  PDF early — I want to see it, not just tests."*

## 5. Out of scope

- **The reconciliation screen** (mapping the 23 truncated `performer` strings to registry
  facilities). This slice *consumes* aliases; creating them stays deferred.
- The **Historical Charts** band from `Lab-Report-Formats.svg` — it needs chart data-binding in the
  report designer, which is deferred, and deserves its own spec.
- The **Confirmation Summary** band from that SVG — largely band 7, which already ships; re-authoring
  the seeded design is separate work.

## 6. Context for whoever picks this up

The 8 bands of `2026-08-03-clinical-report-template-design.md` §1 are **all shipped** (letterhead,
S1 cell status, S2b classification, S3 barcode/QR, S4 keyvalue, S5 delivery). This is not a missing
band — it is a missing **field** in a shipped report.

Related: [[facility-registry-workstream]], [[clinical-report-template-workstream]],
[[lab-identity-letterhead]], [[cdr-v1-ce-field-mapping]], [[disa-stores-blobs-not-columns]].
