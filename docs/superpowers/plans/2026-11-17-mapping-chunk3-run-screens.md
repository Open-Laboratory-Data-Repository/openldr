# Mapping chunk 3: run screens

Spec: `docs/superpowers/specs/2026-11-17-mapping-review.md`, findings 8a, 8b and 8c.
Branch: `fix/chunk3-run-screens`, from main `2fc616ef`.

## What changes

1. **Held count in the run list (8a).** A run can complete with every row held. The run list
   keeps the execution status and adds an amber `N held` badge when any Map to FHIR node held rows.
   The run detail header adds mapped, held and persisted counts, each only when a node reported it.
   Mapped comes from Map to FHIR `meta.mapped`, held from its `meta.held`, persisted from Persist
   store `meta.persisted`. Mapped is never shown as persisted.
   The list already returns each run's `result`, so no server change. Where: `run-history-drawer.tsx`.
2. **Labels on skipped steps (8b).** The executor writes a skipped node's label, as it does for
   others. Old runs keep showing the node id. Where: `packages/workflows/src/engine/run-workflow.ts`.
3. **Loading without stripes (8c).** `LoadingState` keeps its layout and spinner and drops the
   hatch, as AGENTS.md section 5 says. It is shared by 53 files, so every loading screen changes,
   and none of them shows stripes while loading any more. Where: `components/ui/spinner.tsx`.

## Tests first

- `run-workflow.test.ts`: a skipped node's result has its label.
- `spinner.test.tsx`: `LoadingState` renders the spinner and label and no hatch pattern.
- `run-history-drawer.test.tsx`: a completed run with held rows shows `3 held`; one with none shows
  no held badge; the detail shows mapped, held and persisted counts.

## Done means

- Full gate with `OPENLDR_SKIP_ENV_FILE=true`, server lint.
- New strings in en, fr and pt. In-app and web docs en, fr and pt where run history is described.
- Phone width (375) check of the run list. Demo retest on 3991 with `claude-repeat-test`.
- Codex review on the relay. Changelog after merge.

Not in this chunk: the run list's own plain "Loading…" and "No runs yet." texts. They predate this
work and are listed as a follow-up, not fixed here.
