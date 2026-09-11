# P03 queue lease ownership

Implemented in `.worktrees/queue-lease-ownership`, branch `codex/queue-lease-ownership`, based on `2c7bc502`.

## Evidence and scope

The gap would be refuted if claims retained transaction locks during handlers, or writes checked ownership. The original `packages/adapter-event-bus/src/index.ts:120` committed before handlers. Its original completion update at line 155 matched only the event ID. Five new PostgreSQL tests failed against that implementation. The competing worker processed both events behind a blocked handler, and stale workers changed completion, retry, and failure state.

Six invalid lease tests failed before validation was added. Zero, negative, non-finite, and overflowing renewal intervals are rejected before creating a pool.

Each claim now receives a random token. Renewal covers every row in the batch every third of the lease window. A worker checks ownership before starting each handler. Completion, retry, terminal failure, and missing-handler requeue updates require the current token and processing status. Counts reflect rows actually updated. Reclaim transactions retain row locks while changing ownership or exhausting retries.

Migration 094 adds nullable `claim_token`. Existing rows survive upgrade and rollback. Migration 093 belongs to P01 and is intentionally absent from this branch. Integration must retain both registrations and update the expected migration list accordingly.

P02's overlapping-drain wrapper is not copied here. Integrate this drain body into its `drainBatch` function, retaining the P02 wrapper. P04 shutdown work remains separate.

## Verification

Run from this worktree with `QUEUE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:59437/review`.

- `pnpm --filter @openldr/adapter-event-bus test -- src/ownership-live.test.ts` before implementation: 5 failed. Failures exposed duplicate dispatch, stale completion, stale retry, stale failure, and unchanged crash token.
- `pnpm --filter @openldr/adapter-event-bus test`: 20 passed, 2 skipped. Six tests use real PostgreSQL. They cover blocked handlers past the lease, waiting rows, a competing reclaimer, stale completion/retry/failure, and crash reclaim.
- `pnpm --filter @openldr/db test -- src/migrations/internal/094_outbox_claim_token.live.test.ts src/migrations/migrations.test.ts`: 3 passed. The live migration test preserves pending and processing rows through upgrade and rollback.
- `pnpm --filter @openldr/adapter-event-bus typecheck`: exit 0.
- `pnpm --filter @openldr/db typecheck`: exit 0.

Tests create random schemas on disposable PostgreSQL and drop only those schemas. The existing `lease-live.test.ts` remains skipped because `INTERNAL_DATABASE_URL` was not set. No application database was accessed.

## Limits and integration

Queue delivery remains repeatable. Tokens protect queue state, not side effects inside handlers. Side effects already performed after ownership loss cannot be undone. A paused process or database outage can allow another worker to execute the handler. Handlers still need to tolerate repeats. Old workers must stop before upgrading because their ID-only updates bypass token checks.

Studio Activity docs and public Activity docs include English, French, and Portuguese updates. No UI or CLI behavior was added, so no new controls or commands were required.

HONEST NON-PROOF: No browser, mobile, end-to-end ingest, or real-phone checks ran. These tests prove queue database behavior and migration behavior only. Process death was represented by an expired processing row; no OS process was killed. Stale-owner tests deliberately expire database timestamps while the handler is blocked.

No commits, merges, pushes, application writes, or changelog generation occurred. Run the changelog generator after the requested merge to main, per repository rules. Root integration owns that step.
