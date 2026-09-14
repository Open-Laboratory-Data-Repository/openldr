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
