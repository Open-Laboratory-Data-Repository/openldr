21 hypotheses: 15 confirmed, 5 refuted, 1 deferred.

# Third pass: production code review

Date: 2026-09-11. Scope: authentication, analytics, pagination, ingestion, workers, and upgrades.

Scores assess the inspected implementation. They do not establish production capacity. An 8 or above means the inspected approach is sound. Lower scores identify limitations. Zero remains reserved for a critical failure or security risk, following the previous pass's security rule. The two zero scores below concern access control, not measured overload.

This review contains evidence and improvement options. It is not an approved implementation plan. Cost estimates describe relative engineering effort, excluding deployment and load testing.

## Verdict table

| ID | Finding | Verdict | Score | Proof | Cost |
|---|---|---|---:|---|---|
| P01 | Failed projection writes are skipped permanently by the normal cursor. | CONFIRMED | 1 | `packages/db/src/projection/cycle.ts:115`; isolated failure probe below | Medium |
| P02 | Queue notifications start overlapping drains without a concurrency bound. | CONFIRMED | 2 | `packages/adapter-event-bus/src/index.ts:176`; isolated concurrency probe below | Medium |
| P03 | A live queue job can outlast its lease and run twice. | CONFIRMED | 2 | `packages/adapter-event-bus/src/index.ts:79`, `:120`, `:146` | Medium |
| P04 | Worker stop resolves while handlers remain active. | CONFIRMED | 3 | `packages/adapter-event-bus/src/index.ts:193`; isolated stop probe below | Medium |
| P05 | Workflow webhooks have no durable acceptance step before execution. | CONFIRMED | 3 | `apps/server/src/workflows-routes.ts:492`; `packages/workflows/src/trigger-runner.ts:96` | High |
| P06 | Data-driven report exports silently stop at 1,000 query rows. | CONFIRMED | 3 | `packages/dashboards/src/custom-query-run.ts:44`; `packages/bootstrap/src/index.ts:290` | Medium |
| P07 | SQL Server query tables cannot advance beyond the first page. | CONFIRMED | 3 | `apps/server/src/query-routes.ts:115`; `apps/studio/src/query/workspace/TableTab.tsx:100` | Low to medium |
| P08 | Disabling a directory account leaves existing application tokens usable. | CONFIRMED | 0 | `apps/server/src/users-routes.ts:265`; `apps/server/src/auth-plugin.ts:120` | Medium |
| P09 | Replacing Keycloak requires changes beyond configuration. | CONFIRMED | 4 | `apps/studio/src/auth/oidc.ts:36`; `packages/adapter-auth/src/index.ts:93` | High |
| P10 | Builder widgets bypass the SQL execution timeout and row cap. | CONFIRMED | 4 | `packages/bootstrap/src/index.ts:769`; `packages/dashboards/src/compile.ts:404` | Medium |
| P11 | PostgreSQL and MySQL connector queries lack application execution deadlines. | CONFIRMED | 4 | `packages/bootstrap/src/connector-sql-service.ts:54`; `packages/bootstrap/src/connector-db.ts:44` | Medium |
| P12 | Dashboard refreshes overlap slow requests. | CONFIRMED | 5 | `apps/studio/src/dashboard/DashboardWidget.tsx:48` | Medium |
| P13 | Users beyond the first 100 are unavailable through directory pagination. | CONFIRMED | 3 | `packages/adapter-auth/src/index.ts:171`; `apps/server/src/users-routes.ts:119` | Medium |
| P14 | Workflow path and secret updates do not reach other running replicas. | CONFIRMED | 0 | `packages/workflows/src/webhook-registry.ts:51`; `apps/server/src/workflows-routes.ts:215` | High |
| P15 | The supplied upgrade path does not provide uninterrupted webhook service. | CONFIRMED | 5 | `packages/cli/src/update.ts:79`; `apps/server/src/index.ts:48` | High |
| P16 | Per-request user writes may become an authentication bottleneck. | DEFER-YAGNI | 5 | `packages/users/src/store.ts:145`; no measured contention | Measure first |
| P17 | Token verification needs a Keycloak administration request every time. | REFUTED | 8 | `packages/adapter-auth/src/index.ts:51`, `:150` | None |
| P18 | Keycloak owns authorization after initial role migration. | REFUTED | 8 | `apps/server/src/auth-plugin.ts:127`; `packages/db/src/role-store.ts:258` | None |
| P19 | Raw SQL widgets only have browser-side timeout protection. | REFUTED | 8 | `packages/dashboards/src/sql-runner.ts:111`, `:115` | None for PG/MySQL |
| P20 | All table pagers first download the entire database table. | REFUTED | 8 | `packages/db/src/facility-registry-store.ts:523`; `apps/studio/src/pages/Facilities.tsx:316` | None for inspected bounded paths |
| P21 | Updating existing clinical resources requires rebuilding or restarting everything. | REFUTED | 8 | `packages/db/src/fhir-store.ts:251`, `:273`; `packages/bootstrap/src/projection-worker.ts:33` | None for normal updates |

Sixteen scores are below 8. Five inspected safeguards score 8. There are no convention-conflict findings.

## Answers to the main questions

**Auth is partly decoupled.** Server token verification discovers signing keys through OIDC, the standard identity protocol. Permissions live locally after initial migration. Browser login endpoints and account administration remain Keycloak-specific. Replacing the provider is not a configuration-only change.

**Large-data behavior varies by feature.** Facilities and connector table browsing request bounded pages. Builder widgets can retrieve every aggregate group before trimming. Report queries cap output at 1,000 rows without telling the report consumer. A visible pager does not establish server pagination or completeness.

**Clinical updates can be incremental.** A stable resource type and ID updates canonical data and appends history. Background projection updates the reporting database. No restart or full rebuild is needed for this normal path.

**Software upgrades still replace the running application.** The supplied commands pull images and recreate services. Startup migrations apply schema changes; persistent database volumes remain. This is not a database reset. It is also not an uninterrupted-ingestion upgrade protocol. Workflow webhooks execute in the request, so senders need retries and a defined duplicate-handling contract.

## Findings below 8

### P01. Projection failure recovery: 1/10

A projection is the reporting copy derived from canonical clinical data. The runner catches a failed write, logs it, then advances the shared cursor. The next cycle starts after that resource.

Proof: `packages/db/src/projection/cycle.ts:112` through `:120`. Arrival-ledger failures also log and skip at `:95`.

An isolated test made the writer throw. The runner reported one task, advanced to cursor 1, and attempted no write on the next cycle. A temporary reporting-database failure can therefore leave reporting data incomplete after the database recovers.

Counterevidence: canonical data remains available, and `reprojectAll` can repair the reporting copy. A subsequent resource update can also trigger another projection. Neither is automatic retry of the failed change.

Improvement: retain failed work for retry, or prevent cursor advancement past unrecoverable gaps. Report successful writes separately from attempted tasks.

### P02. Queue concurrency: 2/10

Each notification and timer tick starts another drain. The worker does not track an active drain or limit concurrent handlers.

Proof: `packages/adapter-event-bus/src/index.ts:174` through `:191`. Each drain processes its claimed rows sequentially at `:134`, but multiple drains run concurrently.

The isolated probe held the first handler open. A second notification started a second handler. Under sustained slow work, more ticks can add active work faster than it completes.

Counterevidence: database row locking protects claims during the claim transaction. This prevents one class of duplicate claim; it does not bound total active handlers.

Improvement: establish an explicit worker concurrency budget and expose active-job and backlog measurements.

### P03. Lease expiry during live work: 2/10

The default lease is five minutes. A claim marks the batch as processing, commits, and releases its connection before handlers execute. Claimed rows then run sequentially. The worker does not renew ownership while processing.

Proof: `packages/adapter-event-bus/src/index.ts:17`, `:79`, `:115`, `:120`, and `:146`. Completion updates identify only the row at `:147`.

A sufficiently long handler, or a row waiting behind earlier handlers, becomes reclaimable while its original drain remains alive. A later drain can execute it again. Late completion from the old handler is not fenced by an ownership token.

Counterevidence: expiring leases are useful crash recovery. The problem is distinguishing abandoned work from slow, live work.

Improvement: renew active leases and reject writes from obsolete owners. Side effects still need duplicate protection. PostgreSQL concurrency behavior was inspected, not load-tested.

### P04. Shutdown while jobs are active: 3/10

Queue stop clears future triggers and releases its notification connection. It does not await running handlers. The isolated probe returned from stop with two handlers still active.

Proof: `packages/adapter-event-bus/src/index.ts:193`. Projection stop similarly omits waiting for its current cycle at `packages/bootstrap/src/projection-worker.ts:41`.

Server shutdown then closes services and exits at `apps/server/src/index.ts:167` through `:171`. Background work can be interrupted during upgrade or restart.

Counterevidence: HTTP shutdown is awaited, and durable queue rows can be reclaimed later. That does not guarantee completion of background side effects before exit.

Improvement: stop accepting new work, await or checkpoint active work within a defined grace period, then close dependencies.

### P05. Workflow webhook durability: 3/10

The webhook route awaits the complete workflow inside the HTTP request. The run record is written after execution.

Proof: `apps/server/src/workflows-routes.ts:492`; `packages/workflows/src/trigger-runner.ts:67` and `:96`.

A process interruption can leave partial side effects without a recorded completed run or durable accepted request to replay. A disconnected sender cannot infer whether earlier steps committed. The gateway also configures a 120-second proxy read timeout at `deploy/nginx/openldr.conf.template:56`.

Counterevidence: this route verifies its secret and returns failure for failed workflows at `workflows-routes.ts:480` and `:504`. It does not acknowledge success before execution finishes. The separate batch-ingest path stores a blob, batch record, and event at `packages/ingest/src/accept.ts:25`; that durability is not inherited by workflow webhooks.

Improvement: define durable acceptance, request identity, retry behavior, and status lookup. Account for partial execution: `packages/db/src/persist.ts:41` saves resources individually, not as one batch transaction.

### P06. Report completeness: 3/10

Stored custom queries pass a hard-coded 1,000-row cap. Data-driven reports return those rows with a count of the returned rows. CSV exports use that result. Bound PDF tables use the same stored-query runner.

Proof: `packages/dashboards/src/custom-query-run.ts:44` and `:65`; `packages/bootstrap/src/index.ts:284`, `:290`, and `:306`; `apps/server/src/reports-routes.ts:57`.

A query returning 1,001 rows produces an incomplete export without a truncation marker. This concerns output rows or groups. It does not mean an aggregate can only count 1,000 source records.

Counterevidence: the cap bounds result transfer. Its existence is useful; presenting a bounded preview as a complete report is the issue.

Improvement: separate preview limits from complete exports. Surface truncation explicitly and provide bounded, complete export processing.

### P07. SQL Server pagination: 3/10

The route omits a total count for SQL Server. The UI substitutes the number of returned rows. Pagination disables Next when the first page reaches that substituted total.

Proof: `apps/server/src/query-routes.ts:115`; `apps/studio/src/query/workspace/TableTab.tsx:100`; `apps/studio/src/components/ui/table-pagination.tsx:67`. The default page size is 50 at `TableTab.tsx:17`.

Counterevidence: PostgreSQL and MySQL take a different count path. This finding does not apply to every database.

Improvement: use a real total or a separate “more rows available” signal. SQL Server pagination also fetches offset plus limit before slicing, at `packages/dashboards/src/sql-runner.ts:54`, so deep pages need separate cost review.

### P08. Account disable and existing tokens: 0/10

Zero follows the prior pass's security rule.

The disable route updates the identity-provider account. Application authentication checks local user status, which this route does not update. Signature verification does not check the provider account's current enabled state.

Proof: `apps/server/src/users-routes.ts:265`; `apps/server/src/auth-plugin.ts:119`; `packages/adapter-auth/src/index.ts:150`.

A route/auth-hook reproduction returned successful disable, unchanged local active status, and HTTP 200 for existing verified claims. An otherwise valid token can continue accessing application endpoints after the administrator disables the directory account.

Counterevidence: locally disabled users are rejected. Token expiry also limits the window. Authentication was deliberately disabled in the earlier UI environment; that setting is not counted as a vulnerability.

Improvement: make the administrative disable action enforce application access immediately, with an explicit token-revocation policy.

HONEST NON-PROOF: the reproduction mocked verified claims and provider calls. Replay against real Keycloak is needed to measure the operational window.

### P09. Provider replaceability: 4/10

The port abstraction exists, but the browser builds Keycloak endpoint paths and bootstrap constructs the current adapter directly. Account administration expects a realm-based issuer.

Proof: `apps/studio/src/auth/oidc.ts:36` and `:50`; `packages/adapter-auth/src/index.ts:93`; `packages/bootstrap/src/index.ts:586`.

Counterevidence: generic server JWT validation and local permissions are already separated. Replacing the provider would not require rewriting all permission checks.

Improvement: use provider discovery for browser metadata and select administration adapters explicitly. Document which features require provider administration. A second real-provider integration test would establish portability.

### P10. Builder-widget limits: 4/10

Builder mode calls its query runner directly. Only the raw SQL branch reads the configured timeout and row cap. Builder results are materialized before JavaScript applies the requested top-N limit.

Proof: `packages/bootstrap/src/index.ts:769` and `:781`; `packages/dashboards/src/compile.ts:404`, `:433`, `:454`, and `:473`.

High-cardinality groups can increase memory and transfer costs. Broad date ranges can require long scans even when the final widget shows few values.

Counterevidence: some aggregates return very few groups, and database administrator settings may impose deadlines. Those settings were not inspected.

Improvement: apply execution deadlines consistently and push suitable limits into SQL without changing aggregate semantics.

### P11. Connector execution deadlines: 4/10

Connector SQL awaits the database query directly. PostgreSQL and MySQL connector construction does not configure an execution deadline. Connection cleanup follows query settlement.

Proof: `packages/bootstrap/src/connector-sql-service.ts:54` and `:66`; `packages/bootstrap/src/connector-db.ts:44` and `:64`.

A result-row cap does not bound time spent computing joins or aggregates. PostgreSQL/MySQL browsing also executes a total-count query before returning at `apps/server/src/query-routes.ts:116`.

Counterevidence: SQL Server's installed driver has its own request default. External database policies may also impose limits. “Every connector can wait forever” would be too broad.

Improvement: set explicit execution deadlines and cancellation behavior per driver. Evaluate whether exact counts justify their cost.

### P12. Dashboard request overlap: 5/10

Refresh uses an interval independent of request completion. Cleanup stops future intervals but does not cancel outstanding requests.

Proof: `apps/studio/src/dashboard/DashboardWidget.tsx:48`; `apps/studio/src/api.ts:397`.

For illustration, a ten-second interval and a forty-second query permit roughly four simultaneous requests per widget. This is arithmetic from control flow, not a load-test result.

Counterevidence: a promptly cancelled database query limits overlap on protected SQL paths. Builder mode lacks that same configured deadline.

Improvement: allow one refresh per widget at a time, cancel obsolete requests, and avoid synchronized refresh bursts.

### P13. Directory size and request fan-out: 3/10

The adapter requests the first 100 users. The API exposes no paging parameters for this call, and the UI paginates the returned array. Each returned user also triggers a role request.

Proof: `packages/adapter-auth/src/index.ts:171` and `:174`; `apps/server/src/users-routes.ts:119`; `apps/studio/src/pages/Users.tsx:136`.

The actual adapter with a mocked 101-user provider returned 100 users and made 100 role requests. Page controls cannot retrieve the missing user.

Counterevidence: small directories fit inside the bound. This is not unbounded user enumeration.

Improvement: propagate server pagination and search through the API. Bound or reduce per-user role requests.

### P14. Workflow changes across replicas: 0/10, conditional on multiple API instances

Zero follows the security rule because webhook secrets remain stale, not just route labels.

Each application context owns an in-memory path-to-secret map. Startup fills it. Workflow edits synchronize only the receiving process's map.

Proof: `packages/workflows/src/webhook-registry.ts:51`, `:68`, and `:77`; `packages/bootstrap/src/index.ts:813`; `apps/server/src/index.ts:144`; `apps/server/src/workflows-routes.ts:215`. The webhook authenticates against that map at `workflows-routes.ts:476` through `:480`.

With two running replicas, changing a webhook path or rotating its secret on one leaves the other holding its old entry. Requests can reach inconsistent routes, and the other replica can continue accepting the old secret.

Counterevidence: the supplied single-API deployment avoids this cross-replica case. The runner reads the current workflow before executing, so this does not prove a deleted or disabled workflow still runs.

Improvement: distribute configuration invalidation or resolve versioned webhook credentials through shared state. Verify rotation across every replica before claiming horizontal scaling.

HONEST NON-PROOF: no multi-process deployment or real secret rotation was exercised.

### P15. Software upgrades during ingestion: 5/10

The CLI prescribes image pull and service recreation. Optional startup migration finishes before the API starts listening.

Proof: `packages/cli/src/update.ts:79`; `apps/server/src/index.ts:48` and `:177`. The installer defines one API service at `deploy/install/docker-compose.yml:5` and retains PostgreSQL data at `:72`.

Counterevidence: upgrades need not erase data. Workflow edits already refresh triggers in the running process at `apps/server/src/workflows-routes.ts:215`. Normal clinical updates are incremental, as P21 explains.

Schema changes are not uniformly backward-compatible. Migration `packages/db/src/migrations/internal/088_facility_drop_old_codes.ts:28` drops old columns. Running old and new application versions together therefore needs release-specific compatibility proof.

Improvement: document an upgrade contract covering sender retries, worker drain, backup/restore validation, and schema compatibility. An uninterrupted rolling upgrade would require more than adding a second API container.

### P16. Authentication database work: 5/10, deferred optimization

For an initialized user, each authenticated request reads the user, updates login timestamps, and resolves capabilities. That adds two reads and one write before the endpoint's own work.

Proof: `apps/server/src/auth-plugin.ts:119` and `:132`; `packages/users/src/store.ts:143` and `:145`.

Counterevidence: indexed subject and role lookups exist at `packages/db/src/migrations/internal/006_users.ts:18` and `packages/db/src/migrations/internal/062_rbac.ts:36`. No measured production latency or lock contention establishes a current bottleneck.

Defer optimization until representative PostgreSQL measurements show row contention, pool waits, or significant authentication latency. Preserve immediate local permission changes if caching is introduced.

## Safeguards that scored 8

**P17: JWT verification.** The adapter shares discovery and signing-key initialization through a cached promise. It verifies signatures, issuer, audience when configured, and allowed algorithms. It does not call Keycloak administration for every request. Proof: `packages/adapter-auth/src/index.ts:51`, `:60`, and `:150`. This supports scalable verification in principle; provider outage behavior and throughput remain unmeasured.

**P18: Local authorization.** Realm roles seed local roles once. Later capability checks resolve local assignments. Local permission changes affect subsequent requests without requiring a refreshed token. Proof: `apps/server/src/auth-plugin.ts:127`; `packages/db/src/role-store.ts:258`; `apps/server/src/rbac.ts:26`.

**P19: PostgreSQL/MySQL raw SQL widget controls.** The runner caps rows and applies database statement limits. PostgreSQL also uses a read-only transaction. Defaults are five seconds and 10,000 rows. Proof: `packages/dashboards/src/sql-runner.ts:97`, `:111`, and `:115`; `packages/config/src/number-settings.ts:28` and `:36`. These controls do not bound pool acquisition time. SQL Server's `LOCK_TIMEOUT` at `sql-runner.ts:102` limits lock waits, not the full execution duration; the 8 does not extend to equivalent SQL Server deadline enforcement.

**P20: Actual database pagination exists.** Facilities requests 50 rows and applies SQL limit/offset with an ID ordering tie-breaker. Proof: `apps/studio/src/pages/Facilities.tsx:316`; `packages/db/src/facility-registry-store.ts:523` through `:526`. This refutes the blanket claim about all pagers, not every possible paging concern.

**P21: Incremental clinical persistence.** A supplied resource ID selects the existing canonical key. Save atomically updates canonical state, history, and the change log for that resource. Projection consumes changes in batches and also polls. Proof: `packages/db/src/fhir-store.ts:220`, `:251`, `:264`, and `:273`; `packages/db/src/projection/cycle.ts:109`; `packages/bootstrap/src/projection-worker.ts:33`. Missing IDs generate new IDs. Replaying identical local saves still creates versions. Concurrent writes to one key can conflict and require retry. This is incremental persistence, not an exactly-once webhook guarantee.

## What the visible table controls mean

| Surface inspected | Initial retrieval and paging | Limitation |
|---|---|---|
| Facilities | 50 rows, database pagination | No large-data query plan measured |
| Connector table | 50 rows, bounded SQL | Exact counts add work; SQL Server Next issue |
| Users | First 100 provider users, browser pages | Later users cannot be retrieved by those page controls |
| Report spreadsheet | Capped report received, browser pages of 25 | Paging does not restore rows beyond the report cap |
| Dashboard table widget | Renders every returned row | No table pagination in `apps/studio/src/dashboard/widgets/TableWidget.tsx:18` |
| Stored dataset browsing | Fetches the stored snapshot's rows | `apps/server/src/query-routes.ts:198`; maximum snapshot size not established |
| Report history and schedules | Request pagination | `apps/server/src/reports-routes.ts:94`, `:126`, and `:181` |

## Verification and limits

No application code or configuration was changed. No live service was restarted, load-tested, or mutated. No provider credentials or environment secrets were read.

Commands executed during this review:

| Command | Output |
|---|---|
| `pnpm --filter @openldr/adapter-event-bus exec vitest run src/index.test.ts src/lease.test.ts src/publish.test.ts src/backoff.test.ts` | 4 files, 8 tests passed |
| `pnpm --filter @openldr/db exec vitest run src/projection/cycle.test.ts src/projection/plan.test.ts src/persist.test.ts --maxWorkers 1 --minWorkers 1` | 3 files, 28 tests passed |
| `pnpm --filter @openldr/dashboards test -- src/sql-runner.test.ts src/custom-query-run.test.ts src/compile.run.test.ts` | 3 files, 36 tests passed |
| `pnpm --filter @openldr/server exec vitest run src/query-routes.test.ts src/run-stored-query.test.ts` | 2 files, 32 tests passed |
| `pnpm --filter @openldr/adapter-auth exec vitest run src/index.test.ts --maxWorkers 1 --minWorkers 1` | 1 file, 39 tests passed |
| `pnpm --filter @openldr/server exec vitest run src/auth-plugin.test.ts src/users-routes.test.ts --maxWorkers 1 --minWorkers 1` | 2 files, 39 tests passed |
| `pnpm --filter @openldr/db exec vitest run src/role-store.test.ts --maxWorkers 1 --minWorkers 1` | 1 file, 27 tests passed |

Total: 16 test files, 209 tests passed. These cover mocked contracts, generated SQL, and in-memory behavior. Passing tests do not refute the failure paths documented above.

Additional inline probes used existing modules and isolated dependencies. They created no repository source files:

| Probe | Method | Exact output |
|---|---|---|
| Queue overlap and stop | `node --import tsx --input-type=module -e`; real event-bus module, fake pool, two notifications, blocked handlers, then stop | `{"notifications":2,"peakConcurrentHandlers":2,"activeHandlersWhenStopResolved":2}` |
| Failed projection | Same Node command; pg-mem internal database, real runner, throwing relational writer, two cycles | `{"firstReported":1,"cursor":1,"secondReported":0,"writeAttempts":1,"loggedErrors":1}` |
| Directory pagination | Inline tsx; actual adapter, mocked provider with 101 available users | `{"availableUsers":101,"returnedUsers":100,"roleRequests":100}` |
| Disable action | Inline tsx; real routes/auth hook, mocked provider and verified claims | `{"disableHttp":200,"directoryEnabled":false,"localStatus":"active","localStatusWrites":0,"existingTokenHttp":200}` |

HONEST NON-PROOF: pg-mem cannot establish PostgreSQL locking, transaction ordering, or query plans. Mock pools cannot establish broker throughput. No production capacity, database cancellation timing, real-provider revocation window, or rolling-upgrade availability was proven.

The review did not exhaustively assess plugin isolation, all synchronization conflict paths, backup restoration, disaster recovery, every clinical query, or mobile UI. An overall production-readiness average would conceal the access-control and data-recovery findings, so none is assigned.
