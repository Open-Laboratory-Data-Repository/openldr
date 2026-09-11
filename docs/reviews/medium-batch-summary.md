# Medium batch review

Implementation covers 19 approved findings in 18 worktrees. The batch was merged into main as `2ccd3be9` on 2026-09-11. The SQL Server execution-deadline limitation below remains open.

The merge preserves all 18 slice commits. Its tree exactly matches the reviewed combined tree, `0b771e1c2a572a037e4874f08d932395701e29f6`. All new commits use the operator's author identity with no contributor trailers. Nothing was pushed.

## Post-merge verification

These commands ran on main after the merge, with 95 tests passing in total:

| Command | Result |
| --- | --- |
| `pnpm --filter @openldr/server exec vitest run src/account-status-auth.test.ts src/users-routes.test.ts src/auth-plugin.test.ts` | 49 passed |
| `pnpm --filter @openldr/cli exec vitest run src/user.test.ts` | 9 passed |
| `pnpm --filter @openldr/db exec vitest run src/internal-db-lock.test.ts src/migrations/migrations.test.ts src/migrations/internal/095_account_access_blocks.test.ts` | 7 passed |
| `pnpm --filter @openldr/web exec vitest run src/landing/changelog-model.test.ts src/changelog/ChangelogPage.test.tsx` | 30 passed |

`pnpm make:changelog` generated 2,703 entries across 70 days. All 15 fix commits from this batch appear in the generated file. These checks cover HTTP, CLI, database helper and changelog behavior. They do not add live-provider or physical-phone proof.

## Changes and evidence

Each source worktree is under `D:/Projects/Repositories/openldr_ce/.worktrees/`. Each linked handoff records commands, results, and limits for that slice.

| Finding | Source worktree | Result and handoff |
| --- | --- | --- |
| F01 | start-here-callouts | [Annotated first journey](F01-start-here-callouts.md), using synthetic screenshots |
| F04 | facility-entry-docs | [Manual facility instructions](F04-facility-entry-docs.md), including prerequisites and Create versus Save |
| F09, SP2-01 | data-exposure-scope | [Policy scope documentation](F09-SP2-01-data-exposure-scope.md) states which query paths it governs |
| SP2-03 | facility-canonical-values | [Canonical facility values](SP2-03-facility-canonical-values.md) survive form submission |
| SP2-04 | form-submit-readiness | [Submission readiness](SP2-04-form-submit-readiness.md) explains eligibility and shows field labels |
| SP2-05 | dashboard-create-menu | [Dashboard creation](SP2-05-dashboard-create-menu.md) is available through the normal menu |
| SP2-11 | connector-config-readback | [Connector readback](SP2-11-connector-config-readback.md) preserves omitted secrets and supports the CLI |
| P01 | projection-retry | [Projection retries](P01-projection-retry.md) persist failures for later processing |
| P02 | queue-concurrency | [Queue concurrency](P02-queue-concurrency.md) shares one drain across overlapping triggers |
| P03 | queue-lease-ownership | [Queue ownership](P03-queue-lease-ownership.md) renews claimed rows and fences acknowledgements |
| P04 | worker-shutdown | [Shutdown](P04-worker-shutdown.md) awaits claimed work before closing dependencies |
| P06 | complete-report-exports | [Report exports](P06-complete-report-exports.md) refuse overflow instead of returning partial results |
| P07 | sqlserver-table-pagination | [SQL Server pagination](P07-sqlserver-table-pagination.md) exposes later pages without inventing totals |
| P08 | account-disable-consistency | [Account status](P08-account-disable-consistency.md) blocks old tokens and serializes API and CLI status changes |
| P10 | builder-query-limits | [Builder limits](P10-builder-query-limits.md) reject excess groups before aggregation shaping |
| P11 | connector-query-deadlines | [Connector deadlines](P11-connector-query-deadlines.md) cancel PostgreSQL and MySQL work |
| P12 | dashboard-refresh-control | [Widget refresh](P12-dashboard-refresh-control.md) avoids overlap and ignores obsolete responses |
| P13 | directory-pagination | [Directory paging](P13-directory-pagination.md) reaches accounts beyond 100 through the UI and CLI |

## Combined checks

Commands ran from `.worktrees/medium-batch-check`. Earlier slice results remain in their handoffs. These counts are separate runs, not an unduplicated total.

| Command | Result | What it proves |
| --- | --- | --- |
| `pnpm --filter @openldr/adapter-event-bus exec vitest run src/index.test.ts src/lease.test.ts src/lease-live.test.ts src/concurrency-live.test.ts src/ownership-live.test.ts src/shutdown.test.ts src/shutdown-live.test.ts` | 27 passed | Combined queue behavior, including disposable PostgreSQL concurrency, ownership and shutdown |
| `pnpm exec vitest run packages/bootstrap/src/projection-worker.test.ts apps/server/src/shutdown.test.ts` | 6 passed | Lifecycle ordering with supplied callbacks |
| `pnpm --filter @openldr/dashboards exec vitest run src/compile.run.test.ts src/sql-runner.test.ts src/compile.limits.postgres.test.ts` | 40 passed | Builder shaping, SQL controls and actual PostgreSQL cancellation |
| `pnpm --filter @openldr/bootstrap exec vitest run src/connector-db.test.ts src/connector-db.cancellation.test.ts src/connector-db.deadline.integration.test.ts src/connector-sql-service.test.ts src/connector-config.test.ts` | 33 passed on rerun | Connector behavior, with actual PostgreSQL and MySQL cancellation |
| `pnpm --filter @openldr/bootstrap exec vitest run src/reporting-row-limit.test.ts src/reporting-data-driven.test.ts src/reporting-param-format.test.ts src/report-scheduler.test.ts src/index.test.ts` | 62 passed | Report refusal, secondary PDF queries and scheduler behavior |
| `pnpm --filter @openldr/server exec vitest run src/reports-routes.test.ts` | 34 passed | HTTP report response shape and overflow refusal |
| `pnpm --filter @openldr/studio exec vitest run src/api.reports.test.ts src/reports/ReportSpreadsheetTab.test.tsx src/reports/ReportDocumentTab.test.tsx --testTimeout 30000` | 12 passed | Visible report error messages and no success recording on refusal |
| `pnpm --filter @openldr/server exec vitest run src/query-routes.test.ts src/connectors-routes.test.ts` | 62 passed | Query continuation and connector HTTP contracts |
| `pnpm --filter @openldr/studio exec vitest run src/docs/registry.test.ts src/docs/validation.test.ts` | 34 passed | Studio documentation registration and validation |
| `pnpm --filter @openldr/web exec vitest run src/docs/DocsPage.test.tsx` | 16 passed | Public documentation navigation and rendering |
| `pnpm --filter @openldr/adapter-event-bus --filter @openldr/dashboards --filter @openldr/db --filter @openldr/bootstrap --filter @openldr/server --filter @openldr/studio --filter @openldr/cli typecheck` | Exit 0 | TypeScript across seven packages before the final two slices |

Final account and directory integration checks passed 168 tests:

| Command | Result |
| --- | --- |
| `pnpm --filter @openldr/bootstrap exec vitest run src/account-status.live.test.ts src/account-status.test.ts` | 15 passed, including four real PostgreSQL tests |
| `pnpm --filter @openldr/db exec vitest run src/internal-db-lock.test.ts src/migrations/migrations.test.ts src/migrations/internal/095_account_access_blocks.test.ts` | 7 passed |
| `pnpm --filter @openldr/server exec vitest run src/account-status-auth.test.ts src/users-routes.test.ts src/auth-plugin.test.ts` | 49 passed |
| `pnpm --filter @openldr/cli exec vitest run src/user.test.ts` | 9 passed |
| `pnpm --filter @openldr/users exec vitest run src/store.test.ts src/status.test.ts src/directory-pagination.test.ts` | 11 passed |
| `pnpm --filter @openldr/bootstrap exec vitest run src/user-directory.test.ts` | 9 passed |
| `pnpm --filter @openldr/studio exec vitest run src/pages/Users.test.tsx src/api.users.test.ts src/i18n/parity.test.ts src/components/ui/table-pagination.test.tsx src/docs/registry.test.ts src/docs/validation.test.ts --testTimeout 30000` | 52 passed |
| `pnpm --filter @openldr/web exec vitest run src/docs/DocsPage.test.tsx` | 16 passed |
| `pnpm --filter @openldr/ports --filter @openldr/adapter-auth --filter @openldr/db --filter @openldr/users --filter @openldr/bootstrap --filter @openldr/server --filter @openldr/studio --filter @openldr/cli typecheck` | Exit 0 across all eight packages |

The combined CLI report and connector suite also passed nine tests using `pnpm --filter @openldr/cli exec vitest run src/report.test.ts src/connectors.test.ts src/connectors-execution.test.ts`.

All 18 source patches passed `git diff --check`. The combined staged and unstaged checks also exited 0. Final review found no introduced integration blocker in the combined routes, CLI, stores, exports or migrations.

Disposable database URLs were supplied explicitly. Both disposable containers were stopped after testing. No live clinical database or provider configuration was changed.

The connector suite initially failed one MySQL test using a 150 millisecond deadline. Its isolated rerun passed, followed by the full 33-test rerun. The cause was not proven. No production change was made based on that failure.

## Review corrections

Review caught and corrected a dashboard creation race, omitted MySQL certificate settings, connector cancellation cleanup, mobile pagination caption clipping, and an exact migration-map expectation. Combining shutdown with concurrency tests required releasing the blocked handler before awaiting stop.

Account review also found an older enable could remove a later disable block. Status changes now take a PostgreSQL advisory lock on one pinned connection. Overlapping changes receive a retryable conflict. Writes commit before provider calls, so failed provider operations retain the block. A failed unlock discards the connection. Four real PostgreSQL tests cover cross-replica exclusion, visible blocks, connection loss and one-connection pool progress.

## Deployment and proof limits

- Apply migrations 093, 094 and 095 before serving the corresponding updated code.
- Stop old queue workers before migration 094 deployment. Their writes do not honor ownership tokens.
- Update every authenticated server for account subject blocks. Old instances do not check them.
- Queue delivery remains at least once. Handlers still need idempotent side effects.
- A handler that never settles can keep graceful shutdown waiting indefinitely.
- SQL Server's configured builder execution deadline remains an existing limitation. `LOCK_TIMEOUT` only bounds lock waits. Its session cleanup also needs a separate correction.
- Report queries retain a 1,000-row bound. The change refuses overflow; it does not add unbounded streaming or regenerate historical artifacts.
- HONEST NON-PROOF: no real SQL Server, MariaDB, authentication provider or physical phone was tested. Browser checks at 375 by 812 pixels cannot prove behavior under retractable phone browser chrome.
- HONEST NON-PROOF: lifecycle callbacks do not prove operating-system signal behavior. Injected export responses do not prove every live database dialect.

Large findings P05, P09, P14 and P15 remain outside this batch. P16 remains deferred pending measured contention. P19 remains refuted. Data Exposure enforcement was not expanded to arbitrary SQL. Forms did not gain generic response storage.

The landing changelog was generated after the authorized merge to main. No gallery capture or usage reset was performed.

Automatic approval review rejected cleanup of P13's temporary preview directories as "blocked by policy." The untracked `.playwright-cli/`, `apps/studio/.tmp-directory-preview/` and `output/` remain in its source worktree, excluded from the patch. Preview servers and browsers were stopped. Do not include those directories when committing the slice.
