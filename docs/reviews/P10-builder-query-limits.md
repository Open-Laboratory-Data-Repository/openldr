# P10 builder query bounds

Builder execution now reads the existing dashboard timeout and row cap settings. It fetches at most one group beyond the cap. Overflow returns an error before date bucketing, breakdown totals, derived measures, or top-N selection.

## Falsification

The gap would be false if builder execution already used configured SQL bounds. On base commit `2c7bc502`, `packages/bootstrap/src/index.ts:769` passed no execution options. `packages/dashboards/src/compile.ts:401` and `:455` fetched every grouped row before shaping. The raw SQL branch alone read both settings at `packages/bootstrap/src/index.ts:782`.

The initial PostgreSQL test run reproduced four failures. Overflow queries and a slow query resolved instead of rejecting. The normal result case passed. Existing compiler, shaping, and SQL runner suites passed before implementation.

## Changes

- `packages/bootstrap/src/index.ts:769` passes configured bounds and the target dialect.
- `packages/dashboards/src/compile.ts:398` caps grouped output at `rowCap + 1`, then refuses overflow. It does not limit source rows before aggregation.
- `packages/dashboards/src/sql-runner.ts:101` shares execution controls between raw SQL and compiled builder queries. Compiled parameters remain bound.
- Defaults remain 5,000 milliseconds and 10,000 groups. The top-N widget setting does not bypass the group cap.
- Studio dashboard docs explain the limits in English, French, and Portuguese. The public docs include all three languages under Dashboard query limits.
- The Studio fallback test now uses Settings, which still lacks French markdown. Dashboard has a French translation after this change.

## Verification

All commands ran from `D:/Projects/Repositories/openldr_ce/.worktrees/builder-query-limits`.

The PostgreSQL integration tests used only `postgresql://postgres@127.0.0.1:59437/review`. Each run created and dropped its own `builder_limits_<pid>` schema. Tests refuse a nonlocal host or a database other than `review`. No application environment files or live databases were read.

```powershell
$env:BUILDER_LIMITS_TEST_URL='postgresql://postgres@127.0.0.1:59437/review'
pnpm --filter @openldr/dashboards test
# 14 files passed, 213 tests passed.
```

That complete suite preceded one additional bound-filter regression. The final focused run included that test and strengthened the wide query case to include a derived ratio.

```powershell
pnpm --filter @openldr/dashboards test -- src/compile.limits.postgres.test.ts src/compile.run.test.ts src/sql-runner.test.ts
# 3 files passed, 40 tests passed.
pnpm --filter @openldr/dashboards typecheck
# tsc --noEmit, exit 0.
pnpm --filter @openldr/bootstrap typecheck
# tsc --noEmit, exit 0.
pnpm --filter @openldr/studio test -- src/docs/registry.test.ts src/docs/validation.test.ts
# 2 files passed, 31 tests passed.
pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx
# 1 file passed, 15 tests passed.
git diff --check
# Exit 0. New files included with git add -N.
```

The six PostgreSQL tests cover overflow before top-N, complete aggregate totals, date buckets with breakdowns, wide queries with derived ratios, bound filter values, and statement cancellation. The cancellation test also checks that the pooled connection remains usable and `statement_timeout` returns to zero.

The ten pg-mem shaping tests ignore only transaction control statements that pg-mem cannot parse. They prove shaping behavior, not database deadlines. The 24 SQL runner tests cover emitted controls and raw SQL behavior across dialects. They use an executor double and do not prove live MySQL or SQL Server behavior.

The web tests emit existing jsdom `window.scrollTo` and React Router warnings. These did not fail the run.

## Limits and deferred work

HONEST NON-PROOF: SQL Server still uses `LOCK_TIMEOUT`, which bounds lock waits only. This change does not enforce its configured execution deadline. Existing SQL Server session settings can also remain changed after a failed batch. Live SQL Server cancellation and session restoration tests would prove a later correction.

HONEST NON-PROOF: MySQL and MariaDB use existing statement timeout mechanisms. No live test ran against either engine. Actual slow-query tests on both engines would prove those controls.

HONEST NON-PROOF: Typechecking bootstrap does not verify the HTTP response shape. No new route test or browser/mobile test ran. The code adds no UI controls or layout changes. A route test and browser preview would prove widget error presentation.

No new CLI command was added. This corrects query execution using existing settings, not a new administrative action. No commit, merge, push, live-data write, or gallery capture occurred. The integrator must generate the landing changelog after merging to main, following repository policy.
