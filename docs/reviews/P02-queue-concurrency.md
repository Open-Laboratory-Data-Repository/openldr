# P02 queue concurrency

One approved finding implemented in `codex/queue-concurrency`. No commits, merges, or pushes.

## Evidence

The finding would be false if overlapping drains already shared an active operation.
Baseline `packages/adapter-event-bus/src/index.ts:130` claimed a new batch on every call.
Its worker invoked `drain()` on every tick at line 176 and every notification at line 189.
Neither path checked an active operation.

Live PostgreSQL tests blocked the first handler, then issued 30 overlapping calls or notifications with timer ticks.
Both tests failed before implementation with `expected 4 to be 1` for peak active handlers.

## Change

The bus holds one active drain promise. Manual calls and worker ticks share that promise.
The existing batch loop continues to await each handler serially.
The first caller chooses the batch limit. Overlapping callers receive that batch's result, regardless of their requested limit.
Completion or rejection clears the promise so later calls can claim another batch.
No concurrency setting was added.

Studio's Activity guide and public Activity docs describe waiting behavior in English, French, and Portuguese.

## Verification

Run from the worktree root:

```powershell
pnpm --dir packages/adapter-event-bus test
pnpm --dir packages/adapter-event-bus typecheck
$env:INTERNAL_DATABASE_URL='postgresql://postgres@localhost:59437/review'
pnpm --dir packages/adapter-event-bus test src/concurrency-live.test.ts
```

The package suite reported 9 passed and 4 live tests skipped without the database variable.
Typecheck exited 0 with no diagnostics.
The selected live suite reported 2 passed against disposable PostgreSQL.
Each live test creates and drops a unique schema copied from the existing outbox table definition.
It does not modify rows in the public outbox table.

Live assertions cover one active handler, pending rows remaining unclaimed, shared batch results, and subsequent batch limits.
The unit test covers shared claim failure and recovery on the next drain.
Removing the guard made that unit test fail because the second call succeeded instead of sharing the failure.

These tests exercise the event bus, not HTTP routes or browser layout.
HONEST NON-PROOF: cross-process lease ownership and shutdown safety remain outside P02.
Their proof requires P03 and P04 tests. A slow handler can still outlive its lease.

## Integration boundaries

P03 lease ownership and P04 graceful shutdown were not changed.
P04 can use `activeDrain` to await the current operation.
No UI controls or CLI commands were added because this changes shared event-bus execution behavior.
Mobile layout was not tested because no layout changed.
No live application data was changed.
The landing changelog was not generated. Repository rules require generation after merging to main, and merging was not authorized here.
