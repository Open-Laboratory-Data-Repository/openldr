# SP2-12: registry save confirmation

Status: implemented and verified; local merge authorized by the operator. Branch: `codex/registry-save-feedback`.
Base: `c363bdb2`. Worktree: `.worktrees/registry-save-feedback`.

## Change

Registry creation and editing confirm the saved record's name. English, French, and Portuguese translations are provided.

Create/edit refreshes the marketplace without a second Refresh notification. Explicit refresh and other registry actions keep their existing feedback. No API, CLI, schema, layout, or permission changes were needed. This slice changes feedback only. The earlier documentation workflow findings remain separate.

## Verification

- Baseline: 24 tests passed.
- Regression check before implementation: 1 failed, 16 passed. Registry creation produced Refresh instead of a named confirmation.
- Final command: `pnpm --filter @openldr/studio test -- src/pages/settings/marketplace/RegistriesTab.test.tsx src/pages/settings/Marketplace.test.tsx --maxWorkers 1 --minWorkers 1`.
- Final output: 2 files passed, 24 tests passed, exit 0.
- `pnpm --filter @openldr/studio typecheck`: exit 0.
- Independent review of the final diff found no introduced defects.
- The integration check waits for background refresh completion before asserting absence of the misleading Refresh notification.
- Live browser creation showed `Saved registry Review Fix - Registry confirmation`.
- Live browser editing showed `Saved registry Review Fix - Disabled registry`.
- At 375x812, the edited notification was visible within the viewport. The synthetic registry was disabled through the edit form.
- Runtime translation check produced:
  - English: `Saved registry Review registry`.
  - French: `Registre Review registry enregistré`.
  - Portuguese: `Registo Review registry guardado`.

Existing React Router, DOM nesting, and dialog-description warnings occurred before these changes.

HONEST NON-PROOF: a desktop viewport does not reproduce a phone's retractable browser chrome. No physical-phone test was run. The browser checks preceded the final callback separation, which preserves create/edit behavior; final tests cover that wiring.

## Handoff and merge

A disabled synthetic registry named `Review Fix - Disabled registry` remains in the development API. It points to the same local directory as the existing Local registry. The original registry was unchanged.

The operator authorized committing and merging this fix locally. Do not add Claude, Codex, or other AI contribution trailers. At authorized merge, generate the landing changelog after the fix enters main, as AGENTS.md requires.

Temporary preview server stopped. Test logs are retained under the main checkout's ignored `.worktrees/review-evidence/registry-save-feedback/` directory.
