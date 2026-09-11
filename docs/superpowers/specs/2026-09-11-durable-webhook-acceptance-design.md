# P05 durable webhook acceptance

Approved by the operator. Implementation authorized; commits and merge require a separate request.
Branch: `codex/p05-webhook-acceptance`. Base: `416a36eb`.

## Confirmed problem

A durable request written before workflow execution would refute P05. The webhook route instead calls the runner directly at `apps/server/src/workflows-routes.ts:496`. The runner invokes the engine at `packages/workflows/src/trigger-runner.ts:68` and records the run afterward at line 97.

The repository already has durable events, transactional claims and worker leases in `packages/adapter-event-bus/src/index.ts`. Bootstrap connects eventing and internal storage to the same database at `packages/bootstrap/src/index.ts:604`. Reuse that infrastructure. Its automatic redelivery does not make external workflow effects safe to repeat.

## Approaches

1. Recommended: persist a receipt and queue event atomically, then wait briefly for completion. Preserve completed response semantics for fast workflows. Return 202 with a status URL when work remains pending. This changes how slow callers handle responses, but removes request lifetime from execution.
2. Return 202 for every accepted request. Simpler, but forces every current sender to change immediately. The sample ingestion webhook explicitly targets existing CDR tooling.
3. Persist a receipt but keep execution attached to the HTTP handler indefinitely. This leaves sender timeouts and recovery coupled to the API process. It does not meet the intended outcome.

## Acceptance and identity

Authenticate through P14 before accepting or looking up a duplicate submission. Keep header-only secrets and stripped authentication headers. Reject oversized or invalid inputs before acceptance.

Persist the request ID, workflow identity, accepted definition fingerprint, sanitized input, binary references and queued status. Store binary content through the existing blob adapter before committing acceptance. An unsuccessful blob write must not create an accepted request. A failed database transaction must not return acceptance; clean up newly uploaded unreferenced objects where possible.

Insert the receipt and existing outbox event in one internal database transaction. The event contains only the receipt ID. Database polling must recover committed events even if notification delivery fails.

Accept an optional `Idempotency-Key`, a sender-chosen request identity scoped to the workflow. Enforce uniqueness in PostgreSQL. Matching repeated submissions return the original receipt without creating another job. Reusing a key with different execution input returns 409. Use a deterministic fingerprint of body, query, forwarded headers and binary content; exclude transport-only and authentication headers. Reject malformed or excessively long keys. Without a key, each POST is a new request; document that retries cannot then be deduplicated.

Receipt identifiers and duplicate records must survive workflow deletion. No cascading removal of accepted requests. Do not automatically expire idempotency records in this slice. Document storage growth and the absence of an automatic retention policy.

## Response contract

Wait at most 10 seconds after durable acceptance. Wait by reading persisted status, without holding a database connection or transaction. Stop waiting when the client disconnects, without cancelling accepted work. `Prefer: respond-async` skips waiting.

Completed work preserves the current 200 response fields. Recorded execution failure preserves failure semantics and includes the request ID. Queued or running work returns 202 with `accepted: true`, `requestId`, `status` and `statusUrl`. A 202 response must never imply clinical processing completed. Include `Location` and a bounded polling interval in `Retry-After`.

A sender status endpoint returns minimal receipt status and completed run identity. Require the current webhook secret and verify workflow ownership on every lookup. Never expose payloads, node results or raw errors through this endpoint. Renamed or deleted webhook paths may make sender lookup unavailable; authorized operators can still inspect the receipt by workflow/request ID. Do not use the request ID as a bearer credential.

## Execution and interruption

The receipt state machine is queued, running, completed, failed, interrupted or cancelled. The worker must durably transition queued to running before invoking the engine. Concurrent or repeated delivery must not invoke the same receipt again.

Check workflow existence, enabled state and definition fingerprint before execution. Cancel with a clear operator-visible reason if configuration changed or the workflow was disabled/deleted while queued. Do not silently execute a different definition. Once execution begins, existing workflow behavior applies; live revocation of running nodes remains outside scope.

A restarted worker can process queued receipts. A redelivery that finds an already-started receipt must not rerun it. If the original completion cannot be established after ownership expires, classify the receipt as interrupted. This means the outcome is uncertain, not that nothing happened. A stale original worker must not overwrite a newer terminal decision.

Reserve run identity before execution. Persist the completed run and receipt outcome atomically. A failure after external effects but before final persistence remains interrupted. Do not claim exactly-once execution or automatic rollback. Event retries may repeat bookkeeping but must not repeat workflow execution after the durable start marker.

Do not add a one-click replay action. Operators must verify the original worker has stopped and reconcile existing side effects before submitting a new request identity. Failed and interrupted receipts remain visible. This conservative recovery contract avoids silently duplicating clinical or external writes.

## Operator access and documentation

Show webhook receipts alongside existing workflow run history, with paginated status and detail views. Reuse the existing history Sheet. Show queued, running and interrupted requests even when no completed run exists. Keep actions in the dots menu. Use shared loading/empty states, stable ordering with request ID as a tiebreaker, bounded server pagination and mobile layout checks.

Provide CLI list/show commands for headless operators. API and CLI call the same service in `@openldr/bootstrap`. No replay or destructive command is proposed.

Update Studio and public docs in English, French and Portuguese. Include sender examples for 200 versus 202, idempotency conflicts, polling, database outages and interrupted processing. Check the actual CDR client contract if its source is available; otherwise state that compatibility remains unproven. Never label an accepted request as completed in examples.

Generate and commit the landing changelog only after a separately authorized merge. No live database migration, provider change or clinical upload is part of development verification.

## Verification

Use disposable PostgreSQL with separate worker processes for crash tests. Cover acceptance rollback, missing notification recovery, duplicate concurrent POSTs, different-input key conflicts, binary payloads, two-worker claims, and crashes before execution and after a simulated side effect. Assert that interrupted work does not repeat the side effect.

Exercise response wire shapes through HTTP, status authorization across workflows, rotated secrets, cancellation after definition changes, and queued recovery after process restart. Test database outage during acceptance and final outcome persistence. Confirm receipt/run atomicity and indexed bounded list queries on PostgreSQL.

Run affected unit tests and package typechecks. Verify Studio receipt states and mobile layout at 375 by 812. A headless browser cannot establish real phone browser-chrome behavior. State that limit if bottom-anchored UI changes.

## Boundaries

P05 covers workflow webhook receipt, dispatch, status and conservative recovery. It does not add workflow checkpointing, external-effect rollback, generic retries for every trigger, queue replacement, automatic retention cleanup or P15 uninterrupted upgrades.

## Approved contract

The operator approved the bounded 10-second wait with 202 for longer work and no automatic replay after execution has started.
