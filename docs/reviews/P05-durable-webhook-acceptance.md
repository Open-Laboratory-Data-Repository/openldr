# P05 durable webhook acceptance

Implemented in `.worktrees/p05-webhook-acceptance`, branch `codex/p05-webhook-acceptance`, based on `416a36eb`. The operator approved the design and implementation. The operator has now authorized a local commit and merge. No push is authorized.

## Behavior

Every authenticated webhook request commits a receipt and queue event in one PostgreSQL transaction before execution. Sender identity is optional `Idempotency-Key`, scoped to the workflow. Repeated identical input returns the original receipt. Changed input with the same key returns 409. Without a key, each POST is a new submission.

The API waits up to 10 seconds for a recorded result. Fast successful runs preserve 200 with the existing fields. Pending work returns 202, `accepted:true`, request ID, status URL, Location and Retry-After. Prefer respond-async skips the wait. A hung status read or disconnected client does not cancel accepted work.

The existing event worker receives its actual delivery token. It records running before invoking the engine. A stale delivery cannot adopt a new worker's token. Completion and run history share one transaction. Queued work resumes after restart. Work interrupted after starting is never automatically replayed. Terminal or missing dispatch records cancel unstarted receipts and classify started receipts as interrupted. Changed, disabled or deleted workflows cancel queued work before execution.

Sender polling requires the current webhook secret and matching workflow ownership. It exposes only request ID, status and run ID. Operators see paginated receipts in the existing history Sheet and through `openldr workflows receipts list` and `show`. Both call the same bootstrap service. Stored payloads and full node results are excluded from receipt history reads; node results remain in the recorded workflow run.

Studio and public docs cover the contract in English, French and Portuguese. No replay button or automatic cleanup policy was added.

## Verification

All commands ran in the P05 worktree. Database checks used disposable PostgreSQL with isolated schemas, never the deployed database.

| Command | Result and layer |
| --- | --- |
| `pnpm --filter @openldr/server exec vitest run src/workflows-routes.test.ts` before implementation | 65 baseline tests passed |
| `pnpm --filter @openldr/adapter-event-bus exec vitest run src/lease.test.ts src/publish.test.ts` before implementation | 5 baseline tests passed |
| `pnpm --filter @openldr/server exec vitest run src/workflows-receipts.live.test.ts src/workflows-receipts-routes.test.ts src/webhook-receipt-wait.test.ts src/workflows-routes.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=15000` | 79 passed before the final binary test and rejection cleanup assertion |
| `pnpm --filter @openldr/server exec vitest run src/workflows-receipts.live.test.ts src/workflows-receipts-routes.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=15000` with `WEBHOOK_TEST_DATABASE_URL` | Final 13 passed: 10 route contract tests and 3 PostgreSQL HTTP tests, including binary dispatch |
| `pnpm --filter @openldr/bootstrap exec vitest run src/index.test.ts src/workflow-secret-migrate.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=15000` | 23 passed |
| `pnpm --filter @openldr/cli test src/workflows.test.ts src/read-commands.test.ts src/audit-cli-parsing.test.ts` | 20 passed; parsing, shared-service calls and cleanup |
| `pnpm --filter @openldr/studio test src/workflows/components/panels/receipt-history.test.tsx src/api.workflow-receipts.test.ts --maxWorkers=1 --minWorkers=1` | 7 passed |
| `pnpm --filter @openldr/studio test src/workflows/components/panels/run-history-drawer.test.tsx --maxWorkers=1 --minWorkers=1` | 4 existing run-detail tests passed |
| `pnpm --filter @openldr/studio exec vitest run src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers=1 --minWorkers=1` | 34 passed |
| `pnpm --filter @openldr/web exec vitest run src/docs/DocsPage.test.tsx --maxWorkers=1 --minWorkers=1` | 16 passed, with existing jsdom scrollTo/router warnings |

The combined ports, DB, event bus, workflows, bootstrap, server, CLI and Studio typecheck passed seven packages and found untyped JSON responses in the new server test. After adding test response types, `pnpm --filter @openldr/server typecheck` exited 0. All eight packages therefore passed. Main remains unchanged.

Initial HTTP regressions failed in five cases against the old direct-execution route. Wait tests failed before the helper existed. Binary rejection cleanup first failed with one delete instead of two, then passed after correction. A concurrent broad run hit the existing secret-sealing test's 5-second timeout; the focused single-worker run passed with a 15-second test allowance. No production timeout was relaxed.

## Review corrections

Independent review found two concrete remaining cases and then verified both corrections. Queued receipts now reach a terminal status if dispatch exhausts retries or disappears. A new binary upload is deleted when acceptance is definitively rejected. Review also checked actual delivery-token fencing, receipt/run atomicity, status ownership, metadata-only queries and translated docs. Final source review found no remaining blockers; the reviewer did not rerun tests.

## Mobile

An isolated browser fixture at 375 by 812 covered populated, interrupted, empty and loading states. Viewport and document width both measured 375 in every state. Empty/loading views omit the table. Loading shows a spinner without empty-state stripes. Screenshots were inspected, including the interruption warning and action menu. Preview and browser were stopped; fixture source files were removed. PNGs and browser logs remain as untracked review artifacts, not source changes.

HONEST NON-PROOF: the browser used mocked receipt responses. It does not prove live API integration or real phone browser-chrome behavior. The full production UI was not exercised against clinical data.

## Deployment and limits

Stop old API instances and old workflow writers, run migrations including 097 with upgraded code, then start upgraded instances. P14's deployment constraint still applies. No migration was applied to the running application.

HONEST NON-PROOF: binary HTTP tests use task-local files through a blob test adapter, not S3. Process crash tests use a recorded SQL side effect rather than an external clinical system. No sustained-load, CDR-client or full production deployment proof is claimed. Those require representative clients, storage and traffic.

There is no automatic expiry of receipts or idempotency records. Storage grows until a separate retention policy is introduced. After an uncertain database commit, the API keeps uploaded bytes because acceptance may have committed. This can leave unreferenced uploads. Confirmed duplicate or rejected submissions delete their new upload. No garbage collector is added here.

An interrupted receipt means effects may already exist. Verify the original worker has stopped and reconcile those effects before submitting a new request identity. This is durable acceptance with conservative recovery, not exactly-once external execution. P09 auth portability and P15 uninterrupted upgrades remain separate.

## Final core verification

- `pnpm --filter @openldr/db test -- src/workflow-receipts.live.test.ts src/migrations/migrations.test.ts --maxWorkers=1 --minWorkers=1` with `WEBHOOK_TEST_DATABASE_URL`: 25 passed, including 23 receipt tests and 2 migration-map tests. No unhandled errors.
- `pnpm --filter @openldr/workflows test -- src/receipt-service.test.ts src/trigger-runner.test.ts --maxWorkers=1 --minWorkers=1`: 17 passed.
- `pnpm --filter @openldr/adapter-event-bus test -- src/index.test.ts src/lease.test.ts src/publish.test.ts src/shutdown.test.ts --maxWorkers=1 --minWorkers=1`: 18 passed.
- Final DB and bootstrap typechecks exited 0 after the metadata changes.

The PostgreSQL suite killed independent worker processes before claim, after durable start and after a simulated SQL effect. Queued work resumed. Started work was interrupted without another effect. Two worker processes produced one effect. Test triggers terminated only their disposable PostgreSQL backend during acceptance and final persistence. Rollback and no-replay assertions passed.

EXPLAIN of the actual compiled receipt-list query over 1,200 rows used `idx_workflow_webhook_receipts_history` and Limit. Tied timestamps paginated in stable request-ID order. Receipt node metadata stayed empty while the run retained its full result.

The task-owned PostgreSQL container was stopped after verification. `git diff --check` passed with line-ending warnings. Main remained clean but advanced independently to `6dbb577b` during this task. Recheck merge compatibility when merging. This task performed no commits, merges, pushes or live migrations.

## Handoff

Local merge authorized. Commit source/docs without contributor trailers, merge, verify the merged tree, run `pnpm make:changelog` on main and commit the generated changelog. Do not push unless asked. Exclude `.playwright-cli/` and `apps/studio/output/` from source commits.


## Local merge verification

Merged as `b3db694a`, source commit `010d288a`, onto main `6dbb577b`. No conflicts. Comparing every P05 path between source and merge with `git diff --exit-code` returned 0. The newer release-cleanup changes remained intact.

Fresh pre-merge workflow receipt/runner tests passed 17 tests. Post-merge checks on main:

- `pnpm --filter @openldr/server exec vitest run src/workflows-routes.test.ts src/workflows-receipts-routes.test.ts src/webhook-receipt-wait.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=15000`: 77 passed.
- `pnpm --filter @openldr/studio exec vitest run src/workflows/components/panels/receipt-history.test.tsx src/api.workflow-receipts.test.ts --maxWorkers=1 --minWorkers=1`: 7 passed.
- `pnpm make:changelog`: 2,706 entries across 70 days. Diff adds the P05 entry.

The real PostgreSQL crash suite was not repeated during merge. Its earlier evidence and limitations remain above. No live migration or push was performed. Source and merge commits use the operator's identity without contributor trailers. The worktree is retained with untracked browser logs and screenshots, excluded from the commits.
