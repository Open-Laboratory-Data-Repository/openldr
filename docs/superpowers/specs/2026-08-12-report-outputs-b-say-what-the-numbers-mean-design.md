# Root B — the AMR reports say what their numbers mean

Source: `docs/audit/2026-08-07-report-visual-design-audit.md`.
Closes **P0-05**, **P0-07** and **P0-09**. Absorbs the cheap half of **P1-09** and **P1-10**.

## The problem

The antibiogram prints cells like `0% (1)` and `100% (1)`. Nowhere on the page does it say the
percentage is **resistant**. A reader sees `100%` and reads excellent susceptibility; it means the
opposite. The meaning exists, but only in the Reports-page description
(`packages/reporting/src/seed/report-seeds.ts:2370`), which is not on the document and not in the PDF.

The same table has many blank cells with no stated meaning.

The GLASS table prints `CSF`, `HAEIN`, `PSEAE`, `R`, `I`, `S` with no legend, and its title never
spells out AMR, GLASS or RIS.

## What was checked first, and what it changed

RULE 0 pass before designing. Five of the audit's assumptions did not survive.

| Assumption | Finding |
|---|---|
| GLASS needs new joins for pathogen names | **False.** `pathogen_name` is already computed (`report-seeds.ts:967`) and already in the `GROUP BY` (`:1029`). It is simply not projected. |
| Specimen names need the terminology service | **False.** `specimens.type_text` sits beside `type_code` (`packages/db/src/schema/external.ts:194`). |
| `AntibioticCode` is a machine code | **False.** `antibioticNormalizeSql` emits `then ${lit(display)}` (`report-seeds.ts:136-137`). The column *key* says code; the *value* is already the display name. |
| The PDF is the only consumer of the GLASS query | **False, and this is the constraint that shapes the design.** Five things consume `r-amr-glass-ris`'s columns. **Pinned to `GLASS_SUBMISSION_COLUMNS`** (the constraint this row originally named): `GET /api/reports/glass/ris.csv` (`apps/server/src/reports-routes.ts:65-72`) and `openldr report glass-export --out` (`packages/cli/src/report.ts:60-80`). **NOT pinned — they call `toCsv(result.columns, result.rows)` and now emit 14 columns where they emitted 12, because this slice's Task 6 added display-name columns to the query:** `GET /api/reports/:id.csv` (`apps/server/src/reports-routes.ts:54-63` — reached from the studio's "Export CSV" button, `apps/studio/src/reports/ReportSpreadsheetTab.tsx:64-67` calling `downloadReportCsv` in `apps/studio/src/api.ts:204-206`), `openldr report run r-amr-glass-ris --csv` (`packages/cli/src/report.ts:47`), and the report scheduler's stored CSV/XLSX artifacts (`packages/bootstrap/src/report-scheduler.ts:67-72`). Whether a human-facing export should show display names too is a product decision this slice does not make — the pin covers two consumers, not five, and that boundary was not written down until this note. |
| A parity harness guards the SQL against the TypeScript path | **False.** `packages/reporting/src/seed/amr-glass-ris-parity.test.ts` is `expect(true).toBe(true)` — a documentation-only record of a manual comparison that was run once and deleted. |

## Decisions taken

- **Keep `%R`.** Do not switch to `%S`. Changing the metric means three SQL dialects, the catalog,
  the fixtures and the snapshots, and it inverts the meaning of every historical run. It is a
  clinical decision, not a design one. This slice labels the existing metric loudly.
- **The wording is authored design data, not renderer code.** It ships in `SEED_DESIGNS`, so a lab
  can edit it in the Report Designer. Nothing about the metric or the legend is compiled in.
- **The submission CSV shape becomes explicit.** Today it is a side effect of whatever the query
  projects. It becomes a pinned list that a test asserts.

## Design

### 1. `SimpleDesignSpec` gains two optional fields

```ts
/** One line stating what the table's numbers measure. Rendered as the last scope pair before
 *  `Generated`, because the metric IS part of the scope the run was computed under. */
metric?: string;
/** One line explaining the table's notation — blanks, codes, abbreviations. Rendered directly
 *  under the table, next to the cells it explains. */
legend?: string;
```

Both unset on the six designs that do not need them; those render byte-identical to today.

### 2. Where each renders

**`metric` → a scope-panel pair.** `scopePairs` (`simple-design.ts:38-45`) appends
`['Metric', spec.metric]` before the existing `['Generated', '{{date}}']`.

This is the load-bearing choice. The panel already computes its own height from its pair count
(`panelHpx`, `simple-design.ts:64-65`), so the metric costs **no new layout arithmetic at all**.

**`legend` → a `text` element between the table and the footer rule.** The table's rect shrinks by
one term.

### 3. The layout arithmetic — the trap this file has already fallen into

`simple-design.ts:59-63` records that a previous slice shipped a **silently clipped row** by
computing in px@96 while the `KV_*` constants were points, and every unit-blind test stayed green.
See `[[report-designer-px-vs-pt-units]]`.

So, explicitly:

- `LEGEND_H_PX` is **px@96**, like every other rect in this file. No point constant enters the new
  arithmetic. The metric pair touches no arithmetic at all.
- Table height becomes `footRuleY - tableY - 8 - (spec.legend ? LEGEND_H_PX : 0)`.
- The legend's own `y` is `footRuleY - LEGEND_H_PX`.
- **A test asserts the table's bottom edge stays above the legend, and the legend's above the footer
  rule, for both A4 portrait and Letter landscape.** A unit error shows up as a negative gap, not as
  a green test and a clipped PDF.

### 4. The antibiogram — `rt-amr-antibiogram`

```
metric: 'Percent resistant (%R). Figure in parentheses is the number of isolates tested.'
legend: 'A blank cell means that antibiotic was not tested against that organism in this period.'
```

The legend states one meaning because the data has exactly one. `antibiogramCellSql`
(`report-seeds.ts:164-183`) emits `''` only when `count(*) = 0` for that antibiotic. The audit asks
for a four-token taxonomy (`not tested` / `not applicable` / `suppressed` / `missing`); three of
those states do not exist in the data today, and inventing display tokens for them would be a false
affordance. **When P0-06 adds a suppression rule, it adds its own token and extends this line.**

### 5. GLASS — `rt-amr-glass-ris`

```
metric: 'Counts of isolates by antimicrobial susceptibility test result.'
legend: 'R resistant, I intermediate, S susceptible. AMR: antimicrobial resistance. '
      + 'GLASS: Global Antimicrobial Resistance and Use Surveillance System. '
      + '(unknown) means the value was not recorded in the source record.'
```

Query changes, in all three dialects:

- project the already-computed `pathogen_name` as `"Pathogen"`;
- add `coalesce(s.type_text, s.type_code, '(unknown)') as specimen_name` and project it as
  `"SpecimenName"`; add `type_text` to the `GROUP BY` beside `type_code`;
- leave `AntibioticCode`'s value alone — it is already a display name — and relabel the design
  column so the reader is not told it is a code.

The design's `boundColumns` bind the name columns. **The code columns stay in the query, untouched.**

### 6. The submission CSV stops being a side effect

New exported constant in `@openldr/reporting`:

```ts
/** The exact ordered column list a GLASS submission file carries. Pinned deliberately: the query
 *  projects MORE than this now (display names for the PDF), and `toCsv(result.columns, ...)` would
 *  otherwise put them in a file submitted to a national programme. */
export const GLASS_SUBMISSION_COLUMNS = [
  'Iso3Country', 'Year', 'Specimen', 'PathogenCode', 'AntibioticCode',
  'Gender', 'AgeGroup', 'Origin', 'Resistant', 'Intermediate', 'Susceptible', 'Total',
] as const;
```

`GET /api/reports/glass/ris.csv` and `openldr report glass-export` both project this list instead of
`result.columns`. Shared, per AGENTS.md §6.2 — the route and the CLI call identical code.

## Testing

| What | Layer it proves | Layer it does NOT prove |
|---|---|---|
| Scope pairs include `Metric` when set, absent when unset | the design builder | nothing about the PDF |
| Legend element present, and the geometry assertion in §3 | px@96 arithmetic | not a real PDF; pdfkit is not exercised |
| Six untouched designs are byte-identical to today | no collateral change | — |
| GLASS query projects `Pathogen` and `SpecimenName` | SQL shape (pg only under pg-mem) | **mssql and mysql are string-compared, never executed** |
| **CSV header equals `GLASS_SUBMISSION_COLUMNS` after the query gains columns** | the submission shape is pinned | — |
| Route test + CLI test both hit the pinned list | route and CLI agree | — |

**HONEST NON-PROOF.** Nothing here proves the rendered PDF is legible or that the legend does not
collide with the table on a real page. Only opening the generated PDF proves that, and this plan
should generate one for both papers and look at it.

**Parity stays unenforced.** `amr-glass-ris-parity.test.ts` asserts nothing. This slice does not fix
that — it is a separate piece of work — but the plan must not claim the SQL and
`packages/reporting/src/amr/glass.ts` agree, because nothing checks it.

## Out of scope

- **P0-06**, the minimum-isolate suppression rule. It needs a programme-approved threshold and must
  come from config, never a constant (AGENTS.md §8). Its legend token extends §4's line.
- **P1-09's** therapeutic-class grouping, italicised binomials, and isolate counts in headings.
- **P0-08's** blank country/year gate and **P0-03/04's** document status — those are the publication
  gate, which is slice T4.
- Anything in Roots A, C, D or E.

## Notes for the implementer

- Changing `SEED_DESIGNS` means the boot seed calls `upsertPublished` and **re-publishes to every
  lab**, overwriting in-place operator edits to the built-ins. That is the existing managed-overwrite
  behaviour, and Duplicate is the documented escape hatch. It is expected here, not a regression.
- No migration. No new i18n keys — this text is design data, not UI chrome.
