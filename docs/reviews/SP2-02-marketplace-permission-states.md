# SP2-02: marketplace permission states

Implemented in `codex/marketplace-permission-states`, based on `9c432508`.
Worktree: `.worktrees/marketplace-permission-states`. The operator authorized local commit and merge.

## Confirmed problem and change

Registry list entries have no authoritative permission list. PackageDetail previously displayed their empty fallback during loading and retrieval failure. Regression tests reproduced both misleading states before implementation.

The permission section now distinguishes loading, unavailable, and confirmed empty permissions. Install remains disabled until the selected version's permission list loads. Changing versions immediately hides the previous version's details. Installed packages without registry references retain their stored permission fallback.

English, French, and Portuguese labels and Studio guides explain these states. A public guide covers all three languages and is linked from Getting started. Its route has a rendering test.

No API, CLI, schema, or installation approval changes were needed. This slice changes permission display and keeps installation tied to loaded details.

## Verification

Commands ran from this worktree.

| Command | Output |
| --- | --- |
| `pnpm --filter @openldr/studio test -- src/pages/settings/marketplace/PackageDetail.test.tsx src/pages/settings/Marketplace.test.tsx --maxWorkers 1 --minWorkers 1` | 31 tests passed, 2 files passed, exit 0 |
| `pnpm --filter @openldr/studio typecheck` | exit 0 |
| `pnpm --filter @openldr/studio test -- src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers 1 --minWorkers 1` | 31 tests passed, 2 files passed, exit 0 |
| `pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1` | 14 tests passed, 1 file passed, exit 0 |
| `git diff --check` | exit 0 |

Before implementation, PackageDetail regression checks produced 3 failures and 11 passes. Before registering the public guide route, its rendering check produced 1 failure and 13 passes.

Browser checks used the actual component with controlled responses in an isolated preview. Loading disabled Install. Failed retrieval displayed the French unavailable message. Confirmed empty permissions displayed the Portuguese empty message and enabled Install. Changing versions removed the old permission list and displayed loading.

At 375x812, the French message stayed within the viewport without horizontal overflow. No package was installed. No live registry or API data changed. The preview server was stopped and its browser tab closed.

Independent code review found no introduced defects in the component change. The final public route addition was checked locally by its regression test. Existing React Router and DOM warnings remain outside this slice.

HONEST NON-PROOF: component tests and controlled browser responses do not prove live registry reliability or server enforcement. No physical-phone test was run. No production load test was run.

## Handoff

Test logs and the temporary browser preview are retained in the main checkout's ignored `.worktrees/review-evidence/marketplace-permission-states/` directory.

The operator authorized committing and merging this slice locally. Do not add AI contribution trailers. Generate and commit the landing changelog after merging into main.

The preceding SP2-09 hypothesis, missing disabled-sync feedback, was refuted. `DistributedSync.tsx:185` shows the disabled result; `api.ts:580` handles the 409 result from `settings-routes.ts:139`. The live UI displayed the existing disabled-sync notification. No sync change was made.
