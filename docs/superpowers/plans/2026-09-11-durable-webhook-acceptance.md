# P05 durable webhook acceptance implementation plan

Use superpowers:subagent-driven-development. No commits, merge or push until requested.

Goal: persist accepted webhook requests before executing them and expose recoverable status.
Architecture: receipt and outbox event share one transaction; a durable start marker prevents automatic replay. Existing event workers dispatch receipt IDs. Bootstrap owns the service shared by HTTP and CLI.
Spec: `docs/superpowers/specs/2026-09-11-durable-webhook-acceptance-design.md`, approved by the operator.

## Constraints

Work only in `.worktrees/p05-webhook-acceptance`. No live data, provider changes or production migrations. No contributor trailers. No automatic replay after start. Keep durable handoff in `docs/reviews/P05-durable-webhook-acceptance.md`. Docs en/fr/pt and mobile UI are in scope. Changelog waits for merge.

## Tasks

- [x] Storage and worker. Create migration 097 and receipt store/service with unit and disposable PostgreSQL tests. Receipt plus outbox insert atomic; unique workflow/key identity, mismatch conflict; queued-to-running compare-and-set; completion plus run atomic; duplicate deliveries never repeat execution. Reuse existing worker. Wire bootstrap and expose `workflows.receipts`. Separate engine execution from recording only as needed for atomic completion. Test queued recovery and interrupted no-replay.
- [x] HTTP. Replace direct webhook execution with acceptance; preserve authentication and binary bounds. Stable input digest excludes transport/auth headers. Handle duplicate blob cleanup, 10-second bounded wait and Prefer respond-async. Add authorized operator list/show and secret-gated sender status routes. Test 200/202/failure/conflict/status authorization and disconnect behavior.
- [x] Studio and CLI. Extend history Sheet with receipt tab, bounded pagination, status details and refresh using dots actions. Add read-only CLI list/show through bootstrap service. Test wire mapping, command invocation and mobile layout.
- [x] Documentation. Update Studio and public docs en/fr/pt with request identity, polling, interruption and deployment contract. Record client compatibility limits and unbounded retention.
- [x] Verification. Real PostgreSQL process crash proof and two-worker races; affected tests and typechecks; UI mobile checks; independent final review and corrections. Record commands, results and limits. Leave changes uncommitted for operator review.

## Shared API

Bootstrap `workflows.receipts` must offer `accept({workflowId,input,files?,idempotencyKey?})`, returning `{receipt,created}`; `get(id)`; `list(workflowId,{limit,offset})`. Receipt JSON fields: `id`, `workflowId`, `status`, `runId`, `createdAt`, `startedAt`, `finishedAt`, `reason`, `outcome`. Status is queued/running/completed/failed/interrupted/cancelled. Accept deduplicates semantic input and binary content, not generated blob paths. Public/operator reads omit stored input and secrets. Exact implementation types may be tightened without changing these field names. HTTP operator endpoints: GET `/api/workflows/:id/receipts?limit=...&offset=...` returns array; GET `/api/workflows/:id/receipts/:requestId` returns receipt. Sender endpoint GET `/api/workflows/hooks/*` takes query `requestId` and current x-webhook-token, returns minimal status. Bootstrap service owns list/show, so CLI shares it.

## Test outline

```ts
expect(await acceptSameKeyTwice()).toHaveOneReceiptAndOneEvent();
expect(await acceptChangedInputSameKey()).toRejectWithConflict();
expect(await deliverSameReceiptTwice()).toExecuteOnce();
expect(await restartAfterDurableStart()).toBeInterruptedWithoutReplay();
expect(await postWithAsyncPreference()).toMatchObject({status:202});
expect(await readOtherWorkflowReceipt()).toMatchObject({status:404});
```

Each implementer writes and runs concrete failing tests before implementation. Root verifies task reports and whole diff. No broad adjacent refactors.
