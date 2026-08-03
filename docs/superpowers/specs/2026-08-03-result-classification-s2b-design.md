# S2b — result classification (reportable vs metadata)

**Date:** 2026-08-03
**Status:** Design agreed. Not implemented.
**Parent:** `2026-08-03-clinical-report-cell-status-and-ranges-design.md` §2.2 — this supersedes it.
**Depends on:** [[terminology-projection-fanout]] (`958fe625`) — the dimension this slice reads.

---

## 0. The problem, measured

A clinical report that renders "all results for this request" prints **the courier's phone number as
a lab result**. Measured in the live warehouse (4,821 `lab_results`, 84 distinct codes):

| Code | Description | Rows |
|---|---|---|
| `TPCON` | Condition for Transportation | 545 |
| `COLBY` | Collected By | 539 |
| `COLST` | Site of Collection | 536 |
| `TPD` | Transportation Date | 525 |
| `CONNO` | Collect By Contact Number | 425 |
| `INSTR` | Equipment ID | 115 |

## 1. Falsification pass — two candidate classifiers, both dead

**⛔ There is no structural signal.** Measured on the FHIR store:
- `category` exists on **0 of 4,821** Observations. FHIR's own mechanism for this is unused.
- The only `identifier.system` is `urn:openldr:obx-set-id` — no discriminator.
- The fill pattern does not separate: `TPCON` (metadata) and `PCRIN` (a real PCR result) have
  **identical** signatures (coded + text, no units, no numeric), and `CONNO` (a phone number) is
  numeric exactly like `CD4`.

**⛔ `PARMDICT.CONTEXT` does not classify either — and this one was nearly built.**
DISA's parameter dictionary carries a `CONTEXT` per code, decoded from the `PARMDICT_STATUS` blob.
cdr-toolchain describes these as *"DISA-product-level constants … the same CONTEXT numbers carry the
same semantics across deployments"* and already ships a `QUESTIONNAIRE_CONTEXTS` set. It looked like
the ideal import-don't-curate source.

Measured against the real `DisaGlobal` dictionary (1,547 rows):

| Code | CONTEXT | Truly is |
|---|---|---|
| `COLBY` Collected By | **-1** | metadata |
| `TPD` Transportation Date | **-1** | metadata |
| `CONNO` Contact Number | **-1** | metadata |
| `CD4` CD4 Count | **-1** | **result** |
| `SAST` AST | **-1** | **result** |
| `SCRT` Creatinine | **-1** | **result** |

`-1` holds **638 of 1,547** codes and contains both classes. `TPCON` sits at 76 and `COLST` at 75,
so the signal is not merely inverted — it is absent. ⇒ **Classification must be authored in CE.**

⚠ Do not re-propose `CONTEXT` as the classifier. It is recorded as a concept property below because
it is real dictionary data worth having, **not** because it separates these classes.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **CodeSystem property + intensional ValueSet**, mirroring the agreed organism slice. No second vocabulary mechanism. |
| D2 | **Fail-open.** An unclassified code is REPORTABLE. Silently dropping a real result from a clinical report is a patient-safety failure; showing a stray metadata row is an embarrassment. |
| D3 | **Import the dictionary, author the roles.** The code list and descriptions come from DISA's PARMDICT (an operator-run import, never a product seed — the dictionary is site-specific). `result_role` is CE's own semantics, authored on top. |

## 3. The model

A CodeSystem for `urn:openldr:default_result` whose concepts carry:

- `result_role` — `result | specimen | metadata | admin`. **CE's semantics, authored.**
- `parm_context` — PARMDICT's CONTEXT verbatim. Recorded as data; NOT a classifier (§1).
- `parm_units` — PARMDICT.UNITS. ⚠ mojibake at source (`cells\æL`, `æmol/L`); see §5.
- `reference_citation` — PARMDICT.REFERENCE. ⚠ a **citation**, never a range; see §5.

**Four roles, not a boolean**, because the reference template needs them separately: `result` fills
the results table, `specimen` fills the Sample Information panel, `metadata`/`admin` appear nowhere.

### Fail-open falls out of a positive definition

Three ValueSets, following the organism slice's D4 reasoning verbatim — *the non-pathogen set must
exclude only the EXPLICIT negatives while keeping unknowns*:

1. `openldr-result-observation` — extensional, every imported code (the dictionary's own scope).
2. `openldr-reportable-result` — intensional, `result_role = 'result'`.
3. `openldr-non-reportable` — intensional, `result_role` ∈ {`metadata`, `admin`}.

**The clinical template EXCLUDES set 3.** An unclassified code is in none of them, so it is not
excluded, so it still prints — fail-open by construction, with nothing to remember to exclude.

⚠ `filterConcepts` honours only `filters[0]` and op `'='` (verified in the organism slice). Set 3 is
therefore **two include clauses**, which union — not one clause with an `in`. `specimen` is
deliberately absent from set 3: it is displayed, just in a different band.

## 4. How it reaches a report

Sets 2 and 3 project to `terminology_codes` through the machinery merged at `958fe625`, and the
report joins `lab_results.observation_code = terminology_codes.code` in the external warehouse.

⚠ This slice is the dimension's **first reader**, so it must settle what that slice deliberately
left open: `terminology_codes` is absent from `JOINABLE_TABLES`, `GOVERNED` and `PII_COLUMNS`, i.e.
ungoverned. Decide whether it becomes joinable in the widget builder here.

⚠ `terminology_codes` carries `(value_set_id, system, code)`. A report filtering on set 3 must scope
by `value_set_id`, not by `code` alone, or two value sets sharing a code collide.

## 5. Findings this pass produced for the sibling slices

**S2c is root-caused end to end.** `PARMDICT.UNITS` returns `cells\æL` / `æmol/L` **at the source
read** — decoded from the blob at offsets 126–136 via `Core.FixText`
(`cdr-toolchain/packages/disalab/src/lib/core.ts`). That is the function already documented as "for
human-readable string fields … do NOT use for date/time/bit fields", so it is the correct fix site.
The `\` in `cells\µL` is genuine source data; only the `µ` is an encoding fault.
⚠ Still unresolved: CP437 vs CP850. `0xE6` is `µ` in both — measure a discriminating byte first.

**S2a's premise is settled and is worse than recorded.** `PARMDICT.REFERENCE` returns exactly the
three citation strings CE holds ("Roche Reference Ranges for Adults and Children", "CREP2 package
insert", "Tietz NW Clinical Guide to Laboratory Tests 3r"). **DISA itself stores a citation, not a
numeric range, at parameter level.** CE did not mangle anything. Ranges must be authored.
⚠ Open thread, not a contradiction: an older mapping spec cites `SIHiRange`/`SILoRange` at ~99.8%.
Those are not in PARMDICT, so they must be per-RESULT elsewhere. Unverified — check before S2a.

## 6. Out of scope

Reference ranges (S2a), the units fix (S2c), barcode/QR (S3), the keyvalue panel (S4), template
delivery (S5), authoring the template (S6).
