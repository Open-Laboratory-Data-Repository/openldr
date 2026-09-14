21 hypotheses: 20 refuted, 1 deferred, 0 confirmed, 0 convention-conflict.

# Third pass: production code review

Reviewed 14 September 2026 at `a1533cd83445325b9f25003ea83bc201aa6e0333` on `main`.

The original 21 hypotheses were checked against current source. Focused verification passed 567 tests across 44 files. These results assess the inspected implementation, not production capacity. New cross-pass findings about query naming and Facilities page updates appear in the second-pass report. They do not reinstate the original hypotheses below.

The fresh score is **7.81/10**, calculated as 164 / 21. Nineteen areas score 8. SQL Server pagination scores 7. Uninterrupted upgrades remain at 5. The latter retains the original capability criterion: safer planned downtime does not establish uninterrupted service.

An 8 means the inspected approach is sound within its documented scope. A refuted finding can still score below 8 when another limitation remains. The prior report remains an accurate record of its earlier revision.

## Verdict table

| ID | Finding | Verdict | Score | Current proof | Remaining cost |
|---|---|---|---:|---|---|
| P01 | Projection failures are skipped permanently. | REFUTED | 8 | Durable retries precede cursor advancement in `packages/db/src/projection/cycle.ts:101`; retry persistence is in `packages/db/src/projection/retry.ts:18`. | None for the original finding |
| P02 | Queue notifications start unbounded overlapping drains. | REFUTED | 8 | Callers share `activeDrain` at `packages/adapter-event-bus/src/index.ts:139`. Worker triggers use that path at line 216. | None |
| P03 | Live queue jobs lack lease renewal and ownership checks. | REFUTED | 8 | Batch lease renewal is at `packages/adapter-event-bus/src/index.ts:152`. Completion and failure require the claim token at line 183. | None for missing renewal; handlers still need duplicate protection |
| P04 | Worker stop returns before active handlers finish. | REFUTED | 8 | Queue stop awaits active work at `packages/adapter-event-bus/src/index.ts:235`. Projection does likewise at `packages/bootstrap/src/projection-worker.ts:38`. Shutdown order is in `apps/server/src/shutdown.ts:13`. | None |
| P05 | Webhook execution begins before durable acceptance. | REFUTED | 8 | Receipt and dispatch event commit together at `packages/workflows/src/receipt-service.ts:130`. The route exposes receipt status at `apps/server/src/workflows-routes.ts:539`. | None for acceptance; external effects still need duplicate protection |
| P06 | Report exports silently truncate after 1,000 rows. | REFUTED | 8 | Row 1,001 triggers refusal at `packages/dashboards/src/custom-query-run.ts:44`. PDF overflow propagates at `packages/bootstrap/src/index.ts:309`. | None for silent truncation; larger exports are a separate capability |
| P07 | SQL Server table browsing cannot reach page two. | REFUTED | 7 | `hasMore` is returned at `apps/server/src/query-routes.ts:106`, consumed at `apps/studio/src/query/workspace/TableTab.tsx:94`, and honored at `apps/studio/src/components/ui/table-pagination.tsx:73`. | Measure deep-page cost before further work |
| P08 | Disabling directory users leaves existing tokens usable. | REFUTED | 8 | Subject blocking and local status persist before provider changes at `packages/bootstrap/src/account-status.ts:67`. Authentication checks both at `apps/server/src/auth-plugin.ts:118`. | None |
| P09 | Using another OIDC provider requires application source changes. | REFUTED | 8 | Browser discovery is at `apps/studio/src/auth/oidc.ts:47`. Configurable authentication and administration selection are at `packages/adapter-auth/src/index.ts:39` and `packages/bootstrap/src/index.ts:599`. | Generic mode omits provider administration by design |
| P10 | Builder widgets bypass execution deadlines and row limits. | REFUTED | 8 | Configured bounds reach builders at `packages/bootstrap/src/index.ts:786`. Excess groups are refused before shaping at `packages/dashboards/src/compile.ts:397`. | None |
| P11 | PostgreSQL and MySQL connector queries lack execution deadlines. | REFUTED | 8 | PostgreSQL deadlines are at `packages/bootstrap/src/connector-db.ts:55`. MySQL cancellation uses a separate control connection at line 92. SQL Server request deadlines are at `packages/adapter-mssql-store/src/request-timeout.ts:11`. | None for the original finding |
| P12 | Slow dashboard refresh requests overlap. | REFUTED | 8 | The next refresh follows settlement, and cleanup aborts requests at `apps/studio/src/dashboard/DashboardWidget.tsx:46`. | None |
| P13 | Directory users after the first 100 are unreachable. | REFUTED | 8 | Offset pages and continuation are implemented at `packages/bootstrap/src/user-directory.ts:26`. Studio sends offsets at `apps/studio/src/pages/Users.tsx:48`. | None |
| P14 | Webhook changes remain stale across running replicas. | REFUTED | 8 | Requests resolve path and secret from shared storage at `packages/workflows/src/shared-webhook-resolver.ts:24` and `packages/workflows/src/store.ts:47`. | None |
| P15 | Supplied upgrades cannot keep webhook service uninterrupted. | DEFER-YAGNI | 5 | `apps/web/src/docs/0.1.0/upgrading.md:6` explicitly requires downtime. Writers stop before backup and migration. `deploy/install/docker-compose.yml:5` provides a drain grace period. | High if uninterrupted upgrades become a requirement |
| P16 | Repeated same-user requests contend on unconditional user-row updates. | REFUTED | 8 | A 15-minute metadata interval and conditional updates replace unconditional writes at `packages/users/src/store.ts:87` and line 193. Earlier PostgreSQL measurements are recorded separately below. | None for the measured update penalty |
| P17 | Token verification performs provider administration on every request. | REFUTED | 8 | Discovery and signing keys are cached; verification is cryptographic at `packages/adapter-auth/src/token-verifier.ts:9` and line 53. | None |
| P18 | Keycloak remains authoritative for permissions after migration. | REFUTED | 8 | Requests resolve local capabilities at `apps/server/src/auth-plugin.ts:130` and `packages/db/src/role-store.ts:256`. | None |
| P19 | Raw SQL widgets rely only on browser timeouts. | REFUTED | 8 | Server bounds and database or driver deadlines are applied at `packages/dashboards/src/sql-runner.ts:105`. | None |
| P20 | Table pagination first downloads entire database tables. | REFUTED | 8 | Facilities use SQL limit, offset, and a unique tie-breaker at `packages/db/src/facility-registry-store.ts:514`. Studio requests bounded pages at `apps/studio/src/pages/Facilities.tsx:781`. | None for inspected paths |
| P21 | Updating clinical resources requires a full rebuild or restart. | REFUTED | 8 | Canonical state, history, and change log update transactionally at `packages/db/src/fhir-store.ts:217`. Projection consumes changes at `packages/db/src/projection/cycle.ts:96`. | None for normal updates |

## Remaining limitations

SQL Server now reaches later pages. It still fetches preceding rows before slicing at `packages/bootstrap/src/connector-sql-service.ts:53`. That makes deep-page cost worth measuring against representative data. This pass did not establish unacceptable latency, so it does not authorize a pagination redesign.

P15 was deliberately narrowed to safe planned upgrades. Some migrations remove columns used by earlier releases, including `packages/db/src/migrations/internal/088_facility_drop_old_codes.ts:28`. Keeping old and new servers active together therefore requires release-specific schema compatibility. Multiple API instances, traffic draining, and uninterrupted webhook acceptance would also need an agreed availability requirement. The implemented runbook covers backups, isolated restoration checks, stopping writers, draining work, migration, and recovery. It does not provide rolling upgrades. See [the approved P15 scope](reviews/P15-planned-upgrades.md).

P16's earlier local PostgreSQL benchmark measured the contention before implementation and repeated the workload afterward. At concurrency 10, same-user p95 changed from 16.84-17.71 ms to 7.35-7.82 ms. The earlier penalty did not recur in that workload. This pass reran store tests and inspected the conditional update; it did not repeat the benchmark. See [the measurement and implementation record](reviews/P16-authentication-database-contention.md).

Durable acceptance and lease renewal do not guarantee exactly-once external effects. Report overflow refusal preserves completeness by refusing oversized results; it does not add unrestricted exports. Generic OIDC supports authentication without promising every provider's account-administration features.

## Fresh verification

All commands below ran against the reviewed revision. Each Vitest command used `pnpm --filter <package> exec vitest run <files> --maxWorkers 1 --minWorkers 1`.

| Package | Files after `vitest run` | Result |
|---|---|---|
| `@openldr/db` | `src/projection/cycle.test.ts src/projection/retry.test.ts src/fhir-store.test.ts src/facility-registry-store.test.ts src/role-store.test.ts` | 5 files, 94 passed |
| `@openldr/adapter-event-bus` | `src/index.test.ts src/lease.test.ts src/shutdown.test.ts src/publish.test.ts src/backoff.test.ts` | 5 files, 19 passed |
| `@openldr/workflows` | `src/receipt-service.test.ts src/shared-webhook-resolver.test.ts src/trigger-runner.test.ts` | 3 files, 21 passed |
| `@openldr/dashboards` | `src/custom-query-run.test.ts src/compile.run.test.ts src/sql-runner.test.ts` | 3 files, 42 passed |
| `@openldr/bootstrap` | `src/projection-worker.test.ts src/reporting-row-limit.test.ts src/connector-db.test.ts src/connector-db.cancellation.test.ts src/user-directory.test.ts src/account-status.test.ts` | 6 files, 51 passed |
| `@openldr/server` | `src/shutdown.test.ts src/workflows-routes.test.ts src/workflows-receipts-routes.test.ts src/webhook-receipt-wait.test.ts src/reports-routes.test.ts src/query-routes.test.ts src/account-status-auth.test.ts src/auth-plugin.test.ts src/users-routes.test.ts` | 9 files, 196 passed |
| `@openldr/adapter-auth` | `src/index.test.ts` | 1 file, 45 passed |
| `@openldr/users` | `src/store.test.ts src/status.test.ts src/directory-pagination.test.ts` | 3 files, 12 passed |
| `@openldr/studio` | `src/auth/oidc.test.ts src/dashboard/DashboardWidget.test.tsx src/query/workspace/TableTab.test.tsx src/components/ui/table-pagination.test.tsx src/pages/Users.test.tsx` | 5 files, 47 passed |
| `@openldr/adapter-mssql-store` | `src/request-timeout.test.ts src/index.test.ts` | 2 files, 7 passed |
| `@openldr/cli` | `src/update.test.ts` | 1 file, 21 passed |
| `@openldr/config` | `src/auth.test.ts` | 1 file, 12 passed |

`git diff --check` exited 0 during the code review. The review introduced no source changes, app-data changes, commits, or pushes.

HONEST NON-PROOF: These tests do not establish production capacity, real database locking, or query-plan performance. PostgreSQL concurrency tests, real identity providers, MySQL, and SQL Server were not exercised in this repeat. Mocked cancellation does not prove cancellation timing. Multiple live API processes, real secret rotation, backup restoration, sender retry behavior, and physical phones were not retested.
