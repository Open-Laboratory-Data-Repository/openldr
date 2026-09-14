# P16 authentication database contention

1 finding: 1 confirmed, 0 refuted, 0 convention-conflict, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
|----|---------|---------|-------|------|
| P16 | Every authenticated request updates one user row and contends under same-user concurrency. | CONFIRMED | Two PostgreSQL runs each executed 1,000 requests per scenario. At concurrency 10, same-user p95 was 16.84 to 17.71 ms versus 8.48 to 8.54 ms for distinct users, with no pool wait. At concurrency 50, same-user throughput was 927.6 to 952.3 requests per second versus 1,442.2 to 1,569.7 for distinct users. | Operator scope decision required before optimization. |

The falsifying fact was that same-user concurrency would match distinct-user concurrency without lock waits. It did not.

The benchmark ran the current user and role stores against PostgreSQL 16. Each request checked account blocking, synchronized claims, and resolved capabilities. These are the calls at `apps/server/src/auth-plugin.ts:119`, `:124`, and `:138`. Existing users are read and then updated at `packages/users/src/store.ts:193` through `:196`. Capabilities are read at `packages/db/src/role-store.ts:256` through `:262`.

Each measured scenario ran 1,000 requests after a full warm-up pass. The pool size was 10. Tests covered concurrency 1, 10, and 50 with one shared subject and with distinct subjects. The database was freshly migrated and contained 1,000 initialized users with identical role assignments.

At concurrency 10, neither subject pattern recorded a waiting pool client. The same-user p95 increase therefore cannot be explained by pool saturation. At concurrency 50, both patterns recorded the same maximum of 40 waiting clients, while same-user throughput remained lower.

HONEST NON-PROOF: This is a local database benchmark, not production traffic. It excludes JWT verification, HTTP handling, endpoint work, and network distance. It proves PostgreSQL contention caused by the per-request user-row update under repeated same-user concurrency. It does not establish current production frequency or an acceptable latency target.

The benchmark used a separate `openldr_p16_proof` database. It did not read or modify the OpenLDR application database.

## Implementation result

The approved change keeps account blocks, local user status, and capabilities live on every request. It does not cache authorization data.

For an existing user, `syncFromClaims` now leaves `last_login_at` unchanged for 15 minutes. A stale refresh includes the cutoff in the database update. If another request refreshes first, the losing request reads the current row instead of writing it again. New users and users without a login timestamp still record the current login time.

A PostgreSQL regression test started 20 simultaneous requests for one stale user. The winning refresh changed the status to disabled. Before the database condition, 16 requests updated the row. After the change, one request updated it. Every request returned the new disabled status, including requests that first read the active row.

A second PostgreSQL test forced 20 requests through a concurrent first login. Before the conflict condition, the winner inserted once and the other 19 requests updated the row. After the change, the winner inserted once and no conflict update ran. Every request returned the same stored user.

The original 1,000-request workload ran twice after the change:

| Concurrency | Subject pattern | p95 range | Throughput range | Maximum pool waiters |
|----|----|----|----|----|
| 1 | Distinct | 4.54 to 4.81 ms | 303.6 to 323.1 requests/s | 0 |
| 1 | Same | 4.57 to 4.58 ms | 318.2 to 324.5 requests/s | 0 |
| 10 | Distinct | 7.46 to 7.64 ms | 1,542.6 to 1,545.4 requests/s | 0 |
| 10 | Same | 7.35 to 7.82 ms | 1,554.9 to 1,628.1 requests/s | 0 |
| 50 | Distinct | 32.10 to 32.81 ms | 1,700.1 to 1,718.3 requests/s | 40 |
| 50 | Same | 31.95 to 33.40 ms | 1,693.1 to 1,765.9 requests/s | 40 |

The previous same-user penalty did not recur. At concurrency 10, same-user p95 had been 16.84 to 17.71 ms. At concurrency 50, same-user throughput had been 927.6 to 952.3 requests per second.

Verification:

| Command | Result |
|----|----|
| `pnpm --filter @openldr/users test` | 4 files, 13 tests passed |
| `pnpm --filter @openldr/bootstrap exec vitest run src/auth-contention.live.test.ts src/account-status.test.ts` | 2 files, 16 tests passed |
| `pnpm --filter @openldr/users --filter @openldr/bootstrap typecheck` | Both packages passed |

HONEST NON-PROOF: The post-change benchmark still uses a local PostgreSQL database. It does not establish production capacity, HTTP latency, or JWT verification cost. It proves that the repeated same-user row-update penalty did not recur in this workload.
