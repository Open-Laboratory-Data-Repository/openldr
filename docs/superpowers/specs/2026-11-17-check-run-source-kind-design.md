# Check run summary names its source kind

Small change in the `cdr-source` plugin page. Date: 2026-11-17.

## Why

The operator read a finished v1 run as a failed match. The run showed 14,981 requests as
"Not compared". The only clue that the source was OpenLDR v1 was that the settings line
showed "Time zone" and nothing else. A v1 source is never compared, so that count was correct.

## Goal

A person reading a finished run can tell, without opening settings, that the run read an
OpenLDR v1 source and that its requests were not compared for that reason.

Non-goals: no change to the check, the counts, the labels, or CE. No new strings.

## Approaches

- **A (picked).** Add "Kind" to the run's settings line, and on a v1 run put the existing
  sentence "An OpenLDR v1 source is not compared." under the Breakdown heading. Reuses
  strings that exist in en, fr and pt.
- B. Kind line, plus rename the row to "Not compared (v1 source)" on v1 runs. Needs a new
  string in three languages, and the row name would differ by run kind.
- C. Kind line only. The breakdown still does not explain itself.

The operator picked A.

## Design

1. `ui/src/CheckPanel.tsx`, the `check-run-context` list: put a first item
   `options.kind` with `options.kind.openldrV1` or `options.kind.labSystem`, from the
   `kind` the panel already works out for the chosen source. The Time zone and Lab code items
   stay as they are.
2. `ui/src/LaboratoryBrowser.tsx`: take a new prop `v1: boolean`. When it is true and the
   Breakdown shows, render `check.v1NotCompared` as a muted line under the heading, with
   `data-testid="check-labels-v1"`. `CheckPanel` passes `v1`.
3. Tests in `CheckPanel.test.tsx` and the `LaboratoryBrowser` tests: a v1 run shows Kind
   OpenLDR v1 and the sentence; a lab-system run shows Kind Lab system and no sentence.

Rules that hold: the source system's name never appears; every string in en, fr and pt
(met by reuse); one writer per tree, so the work goes on its own branch and worktree from
`main` (2dd8a7b). Merging into `main` needs the operator's yes.

## Left to the builder

Exact spacing and where the sentence sits relative to the heading, following the page's
existing muted text style.

## Revision 1 (operator, 2026-11-17, after seeing the built page)

On a v1 run, "Not compared" always equals Saved, so the row adds nothing. The operator chose:

1. On a v1 run, hide the `unchecked` ("Not compared") row in the Breakdown, in the source total
   and in each laboratory. Other rows, such as "Held by rules", stay. Lab-system runs are unchanged.
2. Keep the sentence `check.v1NotCompared` under the Breakdown heading on v1 runs. The Breakdown
   shows on a v1 run whenever the run has any label counts, even if every row is hidden, so the
   sentence explains the empty list.
3. At the top of the tab, replace the v1 sentence under Source with a Reference field like the
   Source field: a disabled select reading "Not applicable". This needs one new string,
   `check.referenceNotApplicable`: en "Not applicable", fr "Sans objet", pt "Não aplicável".
4. The guide (`ui/src/guide/en.ts`, `fr.ts`, `pt.ts`) says the sentence shows "where the
   reference would be", and that a passing v1 request is labelled Not compared. Both change, so
   the guide text changes in all three languages.

The "no new strings" non-goal is lifted for that one key and the guide text.
