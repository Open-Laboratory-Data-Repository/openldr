# F07: Laboratory setup guide

Implemented in `codex/laboratory-docs`, based on `65c5f46d`. Worktree: `.worktrees/laboratory-docs`. The operator authorized local commit and merge.

## Scope and evidence

Adds English, French, and Portuguese Laboratory guides, a Settings link, and a public guide with navigation. Covers report identity, logo save behavior, the default facility register, and time-zone limits.

`Laboratory.tsx:90` saves the values and confirms success. `Laboratory.tsx:160` renders the register picker. `FacilityDialog.tsx:235` uses the selected register for new facility entry. `packages/config/src/lab-identity.ts:83` defines the setting. The previous Settings guide omitted this setup.

No laboratory settings, logos, facility records, or report outputs were changed. No screenshot assets were added.

## Verification

Commands ran from this worktree.

| Command | Output |
| --- | --- |
| `pnpm --filter @openldr/studio test -- src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers 1 --minWorkers 1` | 31 tests passed, exit 0 |
| `pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1` | 14 tests passed, exit 0 |
| `git diff --check` | exit 0 |

The temporary combined checkout, `.worktrees/small-docs-check`, also passed 46 Studio tests and 15 web tests. Its 15 additional temporary checks verify that all five batch guides are authored in en/fr/pt, discoverable, and have resolvable documentation links. Studio typecheck exited 0.

The combined public preview rendered all three language sections. At 375x812, document scroll width was 365 pixels. The public navigation included this guide and the other four batch guides.

HONEST NON-PROOF: documentation tests do not prove the underlying business operations. No physical-phone test was run. Studio guides were checked through their loader and translations, not separately opened in a browser. No complete application test suite was run.

## Handoff

Test logs are in the main checkout's ignored `.worktrees/review-evidence/laboratory-docs-*.log` files. Combined logs use `small-docs-combined-*.log`.

The operator authorized local commit and merge. Do not add AI contribution trailers. After merging, run `pnpm make:changelog` and commit generated changes, if any. Preserve all five public navigation entries and both new Studio guide entries when combining the batch. The temporary combined checkout is verification material, not a sixth fix.


Independent factual review found no actionable errors in the English guides or registry additions. The combined preview server was stopped, its browser tab closed, and the viewport reset.
