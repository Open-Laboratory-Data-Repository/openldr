# P15 planned upgrades

Worktree `.worktrees/p15-planned-upgrades`, branch `codex/p15-planned-upgrades`, base `93997b23`.
The operator approved this scope and authorized a local commit and merge. No push is authorized.

## Approved findings

Three findings: one confirmed, one refuted, one deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| P15-A | Upgrade advice omits preparation and recovery steps. | CONFIRMED | At the base commit, `packages/cli/src/update.ts:79` offers only pull and restart. | Small |
| P15-B | Shutdown cannot drain requests and workers. | REFUTED | `apps/server/src/shutdown.ts:15` awaits request and worker shutdown. `packages/adapter-event-bus/src/index.ts:286` waits for active work. | None |
| P15-C | Every release requires uninterrupted rolling upgrades. | DEFER-YAGNI | `packages/db/src/migrations/internal/088_facility_drop_old_codes.ts:28` drops columns. Mixed-version compatibility would need release-specific design and an availability requirement. | Large |

## Scope

Replace the CLI and Studio update notices with preparation guidance and a runbook link.
Publish the runbook in Studio and public docs in English, French and Portuguese.
Give the installer API a configurable five-minute stop grace period.
Retain the existing shutdown implementation and migration commands.

The procedure requires downtime. Operators stop all writers before backing up and migrating.
They verify restoration into isolated destinations before changing the deployed schema.
Backups must include databases, blobs, configuration and keys from the same no-write window.
Operators resume senders only after health and receipt checks.

The CLI links to repository-hosted Markdown because no canonical public docs hostname was verified.
Studio uses its existing documentation route.
Existing installations must add the Compose grace setting or specify the stop timeout explicitly.
Changing the repository template alone does not update their installed Compose files.

## Verification

`pnpm install --offline --ignore-scripts --frozen-lockfile` exited 0 in this worktree.
`pnpm --filter @openldr/server test src/shutdown.test.ts` passed one test.
That test exercises shutdown ordering and repeated calls, not real application draining under load.

`pnpm --filter @openldr/cli test src/update.test.ts` passed 21 tests.
`pnpm --filter @openldr/studio test src/pages/settings/General.test.tsx` passed 22 tests.
Before the notice edits, the new assertions failed in two CLI cases and three Studio cases.
The Studio tests cover translated preparation text and the `/studio/docs/upgrading` link.
The CLI tests retain JSON output, exit code and version verdict coverage.

The disposable Compose check resolved the default to `5m0s` and an override to `9m0s`.
A test process finished its 12-second signal handler with exit 0 and `StopTimeout=300`.
This exercises Docker grace handling, not OpenLDR's full workload.
`pnpm --filter @openldr/studio test src/docs/registry.test.ts src/docs/validation.test.ts src/docs/search.test.ts --maxWorkers=1 --minWorkers=1` passed 41 tests.
`pnpm --filter @openldr/web test src/docs/DocsPage.test.tsx --maxWorkers=1 --minWorkers=1` passed 16 tests.
The focused total is 101 tests. These exercise notices, shutdown ordering and documentation integrity.
Public renderer tests do not constitute a full browser navigation test of the new page.
Existing React Router future warnings and jsdom `window.scrollTo` warnings remain.

`pnpm --filter @openldr/cli typecheck` and `pnpm --filter @openldr/studio typecheck` both exited 0.
`git diff --check` exited 0 without output.
Independent review found no blockers in notices, Compose configuration, translations or upgrade sequencing.
The reviewer did not independently repeat the tests or rehearsal.

## Mobile

An isolated browser fixture rendered the real General component at 375 by 812.
Its local mock supplied configuration and update responses in English, French and Portuguese.
All three views had document width 375. The notice and link wrapped within the viewport.
Screenshots were inspected. The fixture files were removed, and its browser and Vite server stopped.
Screenshots remain outside the repository under
`C:/Users/Fredrick/.codex/visualizations/2026/09/11/01a08ee9-9d1a-7eb3-ac46-e8bd886676bd/p15/`.

HONEST NON-PROOF: this checks the notice fixture, not the full application shell or real phone browser chrome.
No bottom-anchored UI changed.

## Limits and handoff

HONEST NON-PROOF: this change does not establish uninterrupted rolling upgrades.
It does not establish a production backup or restore, sustained-load behavior, or compatibility between arbitrary release pairs.
The disposable rehearsal is recorded separately in `P15-upgrade-rehearsal.md`.
No live deployment, database, credentials or clinical data were changed.

No backup service, replay feature, new migration, or shutdown framework was added.
Landing changelog generation belongs after an authorized merge to main.
P09 auth provider portability remains separate. P16 still needs measured contention.

The main checkout remained clean at `93997b23` during final verification.
The operator authorized merging these reviewed changes into main.

## Local merge

Source commit `87dc9c23` merged into main as `4cafa1de`.
Post-merge checks passed on main:

- `pnpm --filter @openldr/cli test src/update.test.ts`: 21 passed.
- `pnpm --filter @openldr/studio test src/pages/settings/General.test.tsx src/docs/registry.test.ts src/docs/validation.test.ts src/docs/search.test.ts --maxWorkers=1 --minWorkers=1`: 63 passed.
- `pnpm --filter @openldr/web test src/docs/DocsPage.test.tsx --maxWorkers=1 --minWorkers=1`: 16 passed.
- `pnpm --filter @openldr/server test src/shutdown.test.ts`: one passed.
- `pnpm make:changelog`: exit 0, 2707 entries across 70 days.

The 101 tests verify the same focused layers described above. Existing renderer warnings remain.
No push was performed. No contributor trailers were added.
