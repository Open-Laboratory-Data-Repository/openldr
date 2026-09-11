# P14 webhook replica consistency

Implemented in `codex/webhook-replica-consistency`, based on `138b83dd`.
Worktree: `D:/Projects/Repositories/openldr_ce/.worktrees/webhook-replica-consistency`.
The operator authorized a local merge on 2026-09-11. No push is authorized. No contributor trailers.

## Result

Webhook authentication reads shared database state on every request. Migration 096 adds an indexed path table. Workflow saves replace paths in the same transaction as the definition. Deletes cascade. Lookup returns at most two enabled workflows, enough to reject conflicts.

The production bootstrap uses the shared resolver. Startup and save routes no longer refresh a process-local webhook map. The old registry remains a test utility. Secret lookup returns null for missing or unreadable credentials and propagates database failures.

Saved secret rotations, path changes, disable and delete apply to subsequent requests on both tested instances. Conflicts and database outages return generic 503 responses without executing the workflow. Missing paths return 404. Invalid credentials return 401. Requests authenticated before a save can finish.

Studio and public docs cover the behavior in English, French and Portuguese. No new UI controls or admin operation were added. Existing store callers, including headless workflow writers, maintain the path table. No separate CLI command is required.

## Deployment

Stop every old API instance and every old workflow writer before migration 096. Run `openldr db migrate` with the upgraded code, then start upgraded instances. Old writers do not maintain the path index. This deployment requires downtime. Do not allow mixed-version writes. All instances must share the database and encryption key.

No migration was applied to the running application. Tests used a disposable PostgreSQL 16 container and isolated schemas.

## Verification

Commands ran from the worktree. Real database tests used explicit opt-in URLs for the disposable database.

| Command | Result and layer |
| --- | --- |
| `pnpm --filter @openldr/server exec vitest run src/workflows-routes.test.ts` before changes | 63 passed, route baseline |
| Same command with `-t 'shared webhook lookup'` before route fix | 2 failed, expected 200/503 but received 401/500 |
| `pnpm --filter @openldr/workflows exec vitest run` | 81 files, 477 tests passed before final secret-error correction |
| `pnpm --filter @openldr/workflows exec vitest run src/shared-webhook-resolver.test.ts` after correction | 4 passed |
| `pnpm --filter @openldr/db exec vitest run src/workflow-secret-store.test.ts` after correction | 9 passed |
| `pnpm --filter @openldr/db exec vitest run src/migrations/migrations.test.ts` | 2 passed |
| `pnpm --filter @openldr/db exec vitest run src/migrations/internal/096_workflow_webhook_paths.live.test.ts` with `WEBHOOK_TEST_DATABASE_URL` | 1 passed on real PostgreSQL. Backfilled 1,206 paths in bounded batches, verified rollback and indexed actual store query |
| `pnpm --filter @openldr/server exec vitest run src/workflows-replicas.live.test.ts src/workflows-routes.test.ts` with `P14_TEST_DATABASE_URL` | 67 passed after final correction, including two HTTP listeners and secret-table outage/recovery |
| `pnpm --filter @openldr/bootstrap exec vitest run src/index.test.ts src/workflow-secret-migrate.test.ts` | 23 passed |
| `pnpm --filter @openldr/studio exec vitest run src/docs/registry.test.ts src/docs/validation.test.ts` | 34 passed |
| `pnpm --filter @openldr/web exec vitest run src/docs/DocsPage.test.tsx` | 16 passed, existing jsdom scrollTo and router warnings |

`pnpm --filter @openldr/db --filter @openldr/workflows --filter @openldr/bootstrap --filter @openldr/server --filter @openldr/cli typecheck` exited 0 for all five packages. `git diff --check` exited 0 with line-ending warnings. Main remained clean. The disposable test container was stopped after verification.

The added secret-table outage assertion first failed with 401 instead of 503. It passed after wiring `resolveIfAvailable` directly.

Independent review found no introduced code blocker. It caught the old-writer rollout risk; the deployment instructions now require stopping writers before migration. Final review checked secret-error classification and rollout docs. Review did not rerun tests.

## Limits and separate findings

HONEST NON-PROOF: the HTTP tests use two listeners, contexts and PostgreSQL pools in one Node process. Separate OS processes, a load balancer, sustained load and full production bootstrap were not exercised. The runner records execution requests; these tests do not execute clinical workflows. A deployed two-process test and representative traffic measurements would establish those layers.

No browser or phone test ran. No layout changed. Documentation tests establish registry and rendering behavior, not human translation review.

Two existing races remain outside P14. `packages/bootstrap/src/workflow-secret-seal.ts` deletes old secret references before saving the definition. `packages/bootstrap/src/workflow-secret-migrate.ts` can save a definition read earlier during boot. Concurrent saves deserve a separate falsification and review pass. They were not changed here.

P05 durable acceptance, P09 auth portability and P15 uninterrupted upgrades remain separate. No running-workflow revocation or durable acceptance claim is made. No load-based score is claimed.

## Handoff

Local merge authorized on 2026-09-11. Fresh pre-merge checks passed: workflow store/resolver 6 tests, database secret-store/migration map 11 tests. Generate the changelog after merging and record post-merge verification. Do not push unless asked.
