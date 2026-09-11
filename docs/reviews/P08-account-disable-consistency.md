# P08 account disable consistency

Implemented in `codex/account-disable-consistency`. No commits, merges, pushes, or provider writes were performed. PostgreSQL tests used disposable schemas in the agent-owned review database.

The refutation would have been a shared status operation already updating both stores. Baseline `apps/server/src/users-routes.ts` updated only the provider. `packages/cli/src/user.ts:92` updated only the local record. `apps/server/src/auth-plugin.ts:119` synchronized claims before checking local status. The existing provider-only disable therefore did not invalidate an already-issued token locally.

## Changes

- `packages/bootstrap/src/account-status.ts` owns status changes for both HTTP and CLI. HTTP IDs are provider subjects. CLI IDs remain local user IDs.
- Migration `095_account_access_blocks` stores disabled subjects independently of user provisioning. It has no user foreign key, so accounts without a login record can be blocked.
- Disable writes the subject block before provider access. Existing local users become disabled before provider access. Provider metadata then supplies the username for safe local provisioning.
- Enable updates the provider before activating the local user. It removes the subject block last. Any partial failure returns an error and records `user.status.failed` with the known local status, provider update state, and block state.
- `apps/server/src/auth-plugin.ts:119` checks the subject block before claim synchronization. The existing local disabled check remains.
- `packages/users/src/store.ts:147` binds a provider subject only to an unclaimed username. Existing IDs, profile fields, and roles survive. A different nonnull subject never gets replaced. Claim synchronization also rejects that collision.
- CLI-only accounts continue to change locally. Status audit events use `actorName: 'cli'`.
- Studio users docs cover English, French, and Portuguese. The existing public CLI page contains all three translations because its loader has no locale folders.

## Concurrent status changes

A reviewer reproduced an older enable resuming after a newer disable completed. The older enable activated the local record and removed its block while the provider remained disabled.

`InternalDb.withAccountStatusLock` now acquires a PostgreSQL advisory lock for the provider subject. All status writes run through one pinned connection and commit before provider calls. A competing operation returns `409` from the API or an error from the CLI. The operator can retry after the earlier operation finishes. HTTP subjects and CLI local IDs resolve to the same lock key.

The connection is discarded if acquisition is uncertain or unlock fails. Checked-out connection errors mark it for discard. Audit writes run after release, so a one-connection pool cannot deadlock waiting for an audit connection. No in-memory lock controls production behavior.

## Verification

Commands ran in `.worktrees/account-disable-consistency`. Live checks set `P08_TEST_DATABASE_URL` to `postgresql://postgres@127.0.0.1:59437/review` in PowerShell before running Vitest.

| Command | Result | Layer |
| --- | --- | --- |
| `pnpm --filter @openldr/users exec vitest run src/store.test.ts src/status.test.ts` | 10 passed | Actual user store with pg-mem, including subject collisions |
| `pnpm --filter @openldr/bootstrap exec vitest run src/account-status.test.ts` | 11 passed | Shared service, provider and local failures, unclaimed identity preservation |
| `pnpm --filter @openldr/server exec vitest run src/account-status-auth.test.ts src/users-routes.test.ts src/auth-plugin.test.ts` | 44 passed | Fastify route shape, actual auth hook, same verified claims, first-token block |
| `pnpm --filter @openldr/cli exec vitest run src/user.test.ts` | 8 passed | CLI handler, linked subject selection, local-only behavior, no success on failure |
| `pnpm --filter @openldr/db exec vitest run src/migrations/migrations.test.ts src/migrations/internal/095_account_access_blocks.test.ts` | 3 passed | Exact migration map, creation, subject uniqueness without a user, and removal |
| `pnpm --filter @openldr/db --filter @openldr/users --filter @openldr/bootstrap --filter @openldr/server --filter @openldr/cli typecheck` | Exit 0 | TypeScript only |
| `pnpm --filter @openldr/db exec vitest run src/internal-db-lock.test.ts` | 4 passed | Acquisition uncertainty, unlock failure, callback failure, socket error cleanup |
| `pnpm --filter @openldr/bootstrap exec vitest run src/account-status.live.test.ts src/account-status.test.ts` | 15 passed | Four real PostgreSQL checks plus 11 service tests |
| `git diff --check` | Exit 0 | Patch whitespace, with line-ending warnings |

All changed files were decoded strictly as UTF-8.

The original storage regression failed before implementation. It allowed replacing another identity's subject. The new store tests then passed. WASI experimental warnings appeared during server tests.

## Rollout and limits

Apply migration 095 with the normal `openldr db migrate` deployment step before serving authenticated requests. Update every server instance. Old instances do not check subject blocks. Do not drop this table during rollback while relying on its disabled subjects. Back up its rows first.

A database failure reading the new guard denies authentication. Existing tokens need no provider logout to be rejected on their next request. Already-running requests and data already loaded in a browser are not withdrawn.

PostgreSQL checks used unique schemas and removed them afterward. Two independent one-connection pools proved cross-replica exclusion, committed blocks during provider calls, failure persistence, recovery after terminating the test's own lock session, and progress for distinct subjects with a one-connection pool. Migration 095 created the table in these schemas.

HONEST NON-PROOF: the provider remains an in-memory test implementation. No provider write, signature verification, or real browser session was tested. A staged provider account and signed token would prove those layers. pg-mem could not repeat table creation or recreate its primary key after dropping it; migration idempotency was not claimed.

No UI layout changed. No mobile or real-phone test ran. No directory pagination was added. No clinical vocabulary changed. Changelog generation remains for the integrating agent after merge to main, as required by the repository rule.
