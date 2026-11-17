# Mapping chunk 7: follow-ups from chunks 1 to 6

Branch `fix/chunk7-follow-ups`, from main `11d49fbe`. Each item was checked first (RULE 0).

| Item | Proof it is real | Change |
| --- | --- | --- |
| (a) C3-6 run history panel and AGENTS.md section 5 | `run-history-drawer.tsx:245` hides pagination on one page; `:332` node table has none; `:207`, `:211` plain text; `:386`, `:411` native buttons | Pagination always on the runs table and on the node table; `LoadingState` and `StripedEmpty` at the same height as the table; shadcn `Button` for both |
| (b) C3-7 run paging | `run-store.ts:39` orders by `started_at` only before OFFSET | Add `id` as a tiebreaker, descending |
| (c) Result comment | `results.comment` is suggested as Clinical Notes (`ServiceRequest.note.0.text`), the requester's note. Lab result has no result-note field | New field **Result comment** (`Observation.note.0.text`), labels and synonyms in en, fr, pt. Stored in FHIR; the warehouse does not read it yet |
| (d) Editor save | `use-workflow-api.ts:27-29` always sends `description: null` and `enabled: true`; nothing else can turn a workflow on | Save keeps the stored description and on/off state. The workflow row's dots menu gets **Enable** and **Disable** (operator, 2026-11-17). A path clash on Enable is refused by the server, naming the holder |
| (e) Number or text on a fixed value | `RuleEditor.tsx` offers it whatever the source; the refusal shows only at Test | The rule list leaves it out when the row has a fixed value |

Operator decisions, 2026-11-17: (d) "Keep state + menu"; (c) "Add Result comment".

## Tests first

- `run-store.test.ts`: three runs with one `started_at` page by id, descending, with no repeat.
- `use-workflow-store.test.ts` or a save test: Save sends the loaded description and `enabled: false` unchanged.
- `WorkflowList.test.tsx`: Disable sends `enabled: false`; Enable sends `enabled: true`; a refusal shows the server's message.
- `run-history-drawer.test.tsx`: pagination shows with one run; loading shows the spinner and no stripes; no runs shows the striped empty state.
- `suggest.test.ts` / `targets.test.ts`: `results.comment` is suggested as Result comment; the field writes `Observation.note`.
- Sheet test: Number or text is not offered on a fixed-value row.

## Done means

Full gate, server lint, docs in en, fr and pt (in-app and web), phone width for the run history panel
and the list menu, demo retest on 3991, Codex review, changelog after merge.

Not done: no `openldr` CLI command for enabling a workflow. The CLI has no workflow commands today.
