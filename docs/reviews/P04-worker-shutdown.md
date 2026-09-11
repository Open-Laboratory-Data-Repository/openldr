# P04 worker shutdown

The approved shutdown change waits for active queue and projection work before closing databases.
The worktree is `.worktrees/worker-shutdown`, on `codex/worker-shutdown`.
No commit, merge, push, or deployment was made.

## Falsification

The finding would be false if stop already awaited active work before database closure.
At base commit `2c7bc502`, queue stop only cleared the timer and released its listener.
See `packages/adapter-event-bus/src/index.ts:194` and `packages/adapter-event-bus/src/index.ts:228`.
Projection stop did not await its running cycle, and manual ticks ignored the stopped flag.
See `packages/bootstrap/src/projection-worker.ts:22` and `packages/bootstrap/src/projection-worker.ts:41`.
Both context closes also closed eventing and stores concurrently.
See `packages/bootstrap/src/ingest-context.ts:111` and `packages/bootstrap/src/index.ts:1658`.

## Changes

- Queue stop cancels future timer and notification dispatch, then waits for the claimed batch.
- Queue close stops every worker, waits for manual drains, then ends the pool once.
- Manual drains remain available after worker stop. Closing the bus rejects new drains and workers.
- Projection stop removes triggers and awaits the active cycle. Later manual ticks do nothing.
- Context close waits for eventing before closing stores. Repeated closes share one promise.
- Server shutdown stops request intake and queue dispatch together, then awaits both.
- Repeated signals do not start another close. Successful shutdown sets the exit code without forcing exit.
- Studio connector docs and public environment docs explain shutdown in English, French, and Portuguese.

## Integration

The queue drain wrapper is the same prerequisite as P02, plus the closing guard.
Keep one `activeDrain` variable and one `drainBatch` wrapper when combining patches.
P03 claim and heartbeat code belongs inside `drainBatch`.
The shutdown fake pool returns `rowCount: 1` for P03 ownership checks.
The live shutdown fixture includes the P03 `claim_token` column.

The P02 worktree test `packages/adapter-event-bus/src/concurrency-live.test.ts` was adjusted separately.
Both blocked-handler cleanup paths now request stop, release the handler, then await stop.
Refresh the P02 delta when integrating. Those edits are not in this worktree's diff.

## Verification

`pnpm exec vitest run packages/adapter-event-bus/src/shutdown.test.ts packages/bootstrap/src/projection-worker.test.ts`
first reproduced three failures. Queue stop and projection stop returned before release.
Queue close called pool end twice while its handler was blocked.

`pnpm exec vitest run packages/adapter-event-bus/src packages/bootstrap/src/projection-worker.test.ts apps/server/src/shutdown.test.ts`
reported 18 passed and 2 skipped before the new live shutdown test was added.
The skipped tests were the existing lease tests requiring their own database environment.
The final run of that command, with the shutdown database variable set, reported 19 passed and 2 skipped.

With `QUEUE_SHUTDOWN_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:59437/review`,
`pnpm exec vitest run packages/adapter-event-bus/src/shutdown-live.test.ts` reported 1 passed.
It created and dropped a unique schema in the disposable database.
It proved 20 claimed rows finished before pool closure, while one unclaimed row stayed pending.

`pnpm --filter @openldr/adapter-event-bus typecheck`,
`pnpm --filter @openldr/bootstrap typecheck`, and
`pnpm --filter @openldr/server typecheck` each exited 0 with `tsc --noEmit`.
`git diff --check` exited 0 after new files were added with `git add -N`.

## Limits

HONEST NON-PROOF: the server lifecycle test uses callbacks, not an operating-system signal or a full server.
A process-level test with blocked HTTP and queue work would prove real signal wiring and request drainage.
The context store ordering was inspected in source, not tested through complete context construction.
The projection test blocks a supplied cycle. It does not exercise a live projection database.

A handler or database call that never settles can keep shutdown waiting indefinitely.
No cancellation deadline or forced exit was introduced.
Already claimed rows finish as one batch, even if their handler had not started when stop was called.
Unclaimed rows remain for the next worker.

No UI controls or CLI commands were needed for this lifecycle correction.
No mobile layout changed or was tested. No real-phone claim is made.
The changelog generator was not run because no merge to main was authorized.
