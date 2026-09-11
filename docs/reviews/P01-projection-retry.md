# P01 projection retries

The projection worker now saves failures before advancing its cursor.
Worktree: `.worktrees/projection-retry`; branch: `codex/projection-retry`.
Base commit: `2c7bc502`. No commits, merges, pushes, or application database writes.

## Falsification

The gap would be false if failed tasks already entered durable storage before cursor advancement.
At the base commit, `packages/db/src/projection/cycle.ts:94` catches ledger failures and discards them.
The catch at line 115 also discards apply failures, then line 119 advances the cursor.
The restart regression reproduced the loss: expected two recovered rows, received zero.

## Changes

Migration 093 creates `fhir.projection_retries`, keyed by resource type and ID.
The queue stores an attempt counter and next attempt time, without copying clinical payloads.
Each cycle selects at most 100 due retries using time and the unique resource key for ordering.
New change-log tasks still run after retry selection. Duplicate resource tasks run once per cycle.
Retries reread current canonical data and provenance. Missing canonical resources take the deletion path.
Clinical and ledger writes must both succeed before the queue entry is removed.
Ancillary `onProjected` errors remain nonfatal and do not enter the retry queue.

Repeated failures wait 1, 2, 4 seconds and so forth, capped at five minutes.
The worker retains failures indefinitely; the per-cycle work and delay are bounded.
A new canonical change can trigger an earlier attempt.
If queue persistence fails, the cycle rejects before cursor advancement.
Existing idempotent writes permit replay after a crash or partial write.

Studio documentation uses English, French, and Portuguese files for the existing advanced guide.
The public CLI guide contains corresponding sections in all three languages.
No new user action or CLI command was added; this repairs automatic worker behavior.

## Verification

All commands ran from the worktree. Dependency setup used `pnpm install --offline --frozen-lockfile`.

- RED: `pnpm --filter @openldr/db test src/projection/retry.test.ts`.
  Two failures. Restart recovery expected two rows and received zero; retry storage did not exist.
- GREEN: `pnpm --filter @openldr/db test src/projection/retry.test.ts src/projection/cycle.test.ts`.
  16 tests passed after the initial implementation.
- `pnpm --filter @openldr/db test src/projection src/migrations/internal/registration.test.ts`.
  37 passed, 10 skipped. The skipped tests belong to the existing arrival-ledger live suite.
  Their separate database environment variables were not set.
  This run included six retry regressions and the new PostgreSQL test.
- `pnpm --filter @openldr/db test src/projection/retry.test.ts`.
  Seven tests passed after adding the five-minute backoff cap case.
  Coverage includes restart recovery, newest canonical data, poison records, later valid work,
  ledger recovery, deletion recovery, retry-persistence failure, and bounded queue draining.
- `pnpm --filter @openldr/studio exec vitest run src/docs/registry.test.ts src/docs/validation.test.ts`.
  31 passed. These validate document resolution and structure, not rendered layout.
- `pnpm --filter @openldr/db typecheck`: exit 0, no diagnostics.
  Earlier typechecks caught test-only type errors; those were corrected.

The PostgreSQL test uses `PROJECTION_RETRY_TEST_URL=postgresql://postgres@127.0.0.1:59437/review`.
It creates a unique `projection_retry_*` schema and maps all test tables into that schema.
It drops the schema afterward. It verifies reconnect persistence, deterministic bounded selection,
backoff eligibility, queue clearing, and migration down/up. It does not use application schemas.

## Limits

HONEST NON-PROOF: full projection recovery uses pg-mem with real stores and injected writer failures.
The PostgreSQL test proves queue SQL and migration behavior, not a complete two-database projection cycle.
A full PostgreSQL recovery test against disposable internal and external databases would prove that layer.
No browser or phone testing ran because this change adds no UI layout or actions.
No full repository test suite ran. Existing arrival-ledger live tests were skipped as stated above.

Changelog generation was not run because the required post-merge commit history does not exist yet.
The integrating agent must run `pnpm make:changelog` after the approved merge to main.

The strengthened hook regression also ran:
`pnpm --filter @openldr/db test src/projection/cycle.test.ts -t 'swallows an onProjected'`.
One test passed; 13 unrelated cases were filtered out.
It asserts both the successful clinical row and an empty retry queue.
`git diff --check` exited 0. Git reported only configured LF-to-CRLF conversion warnings.
