# P11 connector query deadlines

1 finding: 1 confirmed, 0 refuted, 0 convention-conflict, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
|----|---------|---------|-------|------|
| P11 | PostgreSQL and MySQL connector queries can wait without a query deadline. | CONFIRMED | At base `2c7bc502`, `packages/bootstrap/src/connector-sql-service.ts:54` awaits the query; line 66 closes afterward. `packages/bootstrap/src/connector-db.ts:45` uses the default PostgreSQL pool. Line 90 wraps MySQL without a deadline. Both real database tests initially resolved after a two-second sleep instead of rejecting. | One connector implementation, targeted tests, operator docs. |

## Scope and behavior

The falsifying fact would have been an existing driver or server query deadline. Neither connector supplied one. The shared runner's `finally` cannot run until its query settles.

PostgreSQL now sends a 30-second `statement_timeout` when connecting. A 31-second client query timeout covers missing server responses. `pool.query` discards a failed client. Connection setup has its own timeout.

MySQL starts a 30-second timer when it acquires the query connection. On expiry, a separate connection sends `KILL CONNECTION` for that session. The original session stays open until cancellation completes, avoiding reuse of its connection identifier. The control connection has a one-second bound. Both local connections are destroyed afterward. A cancellation failure reports `server cancellation failed`; it does not claim the server stopped.

The MySQL connection still runs `set collation_connection = @@collation_database`. TLS settings, SQL Server behavior, and SQL validation remain unchanged. The internal factory accepts a shorter deadline, bounded between 1 and 30000 milliseconds. Connector records and forms gain no new setting.

The connector code serves existing callers through their shared SQL runner. No new CLI command or UI control was added. Studio docs cover en, fr, and pt. The public page contains all three languages and has a navigation entry.

## Verification

Disposable databases only:

```powershell
$env:CONNECTOR_DEADLINE_TEST_PG_URL='postgresql://postgres@127.0.0.1:59437/review'
$env:CONNECTOR_DEADLINE_TEST_MYSQL_URL='mysql://root@127.0.0.1:63122/review'
pnpm --filter @openldr/bootstrap test src/connector-db.cancellation.test.ts src/connector-db.deadline.integration.test.ts src/connector-db.test.ts src/connector-sql-service.test.ts
```

Before implementation: 2 deadline tests failed because both slow queries resolved. Existing connector tests: 9 passed.

After implementation: 4 test files passed, 30 tests passed. The real driver tests verify slow-query rejection within 1500 milliseconds with a 150-millisecond deadline. They also verify subsequent healthy queries and closed server sessions. MySQL checks the database collation. Tests skip unless their explicit disposable database URLs are set.

A cancellation failure test initially failed when control-connection construction threw: the query remained pending and Vitest reported an unhandled rejection. It now passes. Three driver-boundary tests cover construction failure, a stalled control connection, and refused cancellation. Each asserts caller rejection and closure of both local sockets. These use a fake MySQL driver; they do not prove cancellation during a real network partition.

`pnpm --filter @openldr/bootstrap typecheck`: exit 0, no diagnostics.

`pnpm --filter @openldr/web test src/docs/DocsPage.test.tsx`: 15 tests passed. Existing jsdom `window.scrollTo` and React Router future-flag warnings remain. These tests cover the docs shell, not visual layout of the new page.

`git diff --check`: exit 0, no whitespace errors.

These checks exercise connector drivers and the shared runner. They do not prove HTTP response shapes or browser behavior.

## Limits and integration

HONEST NON-PROOF: No real-phone or browser layout test was run. This change adds documentation, with no interactive layout changes. No full bootstrap suite was run. No network-partition or cancellation-permission failure was reproduced. If MySQL cannot open its cancellation connection, local cleanup is bounded but server cancellation remains unconfirmed. Database operators must check active queries in that case.

MySQL cancellation uses the same credentials. The account must be allowed to open another connection and terminate its own sessions. Cancellation on the server follows the database's interrupt rules; a blocked server may not stop immediately.

Driver references: [node-postgres client configuration](https://node-postgres.com/apis/client), [MySQL KILL](https://dev.mysql.com/doc/refman/8.4/en/kill.html).

No commits, merges, or pushes. No live application databases or secret environment files were accessed. No temporary files remain. Run `pnpm make:changelog` after integration commits reach main, as required by AGENTS.md.

This work does not edit bootstrap index exports or connector config readback. Merge P10 and SP2-11 separately without replacing their changes. Public docs navigation may need an additive merge with other documentation slices.
