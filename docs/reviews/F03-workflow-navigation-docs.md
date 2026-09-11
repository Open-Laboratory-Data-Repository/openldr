# F03 workflow navigation documentation

The approved documentation changes are ready for review. The operator authorized local commit and merge.

## Scope and evidence

The gap would be refuted if the workflow guide already explained canvas navigation.
At base `65c5f46d`, `apps/studio/src/docs/0.1.0/en/workflows.md:24` begins the steps.
Line 40 then begins templating. Neither section explains Fit View, zoom, or panning.

Existing controls provide these actions:

- `apps/studio/src/workflows/components/canvas.tsx:47` sets mouse buttons for panning by interaction mode.
- `apps/studio/src/workflows/components/canvas.tsx:186` renders Controls with the interactivity toggle hidden.
- `apps/studio/src/workflows/components/canvas.tsx:190` renders the minimap with panning and zooming enabled.
- `apps/studio/src/workflows/components/interaction-mode-toggle.tsx:23` labels the hand button as Pan.

The installed `@xyflow/react` module, `dist/esm/index.mjs:4492`, confirms the Controls defaults.
Zoom and Fit View are enabled, positioned vertically at the bottom left.
The render order is zoom in, zoom out, then Fit View.

## Changes

- Added canvas navigation instructions to the English workflow guide.
- Added concise French and Portuguese workflow guides with procedural headings and existing screenshot references.
- Added a standalone public `workflow-navigation` guide with English, Français, and Português sections.
- Registered that public page's title and navigation entry in `apps/web/src/docs/content.ts`.

The French and Portuguese guides cover setup, execution, navigation, and troubleshooting.
They are concise guides, not full translations of the English node reference.
Existing screenshots are reused. No screenshots or annotations were created.

## Verification

Commands ran in `D:/Projects/Repositories/openldr_ce/.worktrees/workflow-navigation-docs`.
Branch is `codex/workflow-navigation-docs`, based on `65c5f46d`.

| Command | Output | Layer covered |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Exit 0, pnpm v11.22.0 | Dependency installation |
| `pnpm --filter @openldr/studio test src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers=1 --minWorkers=1` | Exit 0, 2 files passed, 31 tests passed | Registry and English document integrity |
| `pnpm --filter @openldr/web test src/docs/DocsPage.test.tsx --maxWorkers=1 --minWorkers=1` | Exit 0, 1 file passed, 14 tests passed | Existing public document rendering tests |
| `git diff --check` | Exit 0 | Patch whitespace |

A separate file check found Fit View and all three expected screenshot references in each locale.
The unslop review covered all new prose. Existing English prose outside the added section was preserved.

Logs are outside the worktree:

- `D:/Projects/Repositories/openldr_ce/.worktrees/review-evidence/workflow-navigation-install.log`
- `D:/Projects/Repositories/openldr_ce/.worktrees/review-evidence/workflow-navigation-studio-tests.log`
- `D:/Projects/Repositories/openldr_ce/.worktrees/review-evidence/workflow-navigation-web-tests.log`

## Limits and remaining work

HONEST NON-PROOF: These tests do not exercise canvas gestures or mobile layout.
No browser was used for this slice. Browser review remains with the coordinating agent.
The existing DocsPage suite does not open the new navigation page specifically.
The Studio validation suite checks English; translated prose received a manual review.

No behavior, CLI, or clinical vocabulary changes were needed for this documentation slice.
No build or full test suite was run. The operator authorized local commit and merge.
Run the changelog generator after an approved merge, as required by AGENTS.md.

## Combined browser verification

The parent task opened this public guide in the temporary combined checkout. All three language sections rendered. At 375x812, document scroll width was 365 pixels. All five batch guides appeared in public navigation. No physical-phone or live business-operation test was performed.

The combined checkout passed 46 Studio tests, including 15 temporary authored-locale and link checks, and 15 public-doc tests. Studio typecheck exited 0. Preserve all five public guide entries and both new Studio guide entries during the later merge.
