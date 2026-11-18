# Interrupted Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every long job carries on after a server restart where it safely can, records each interruption, and the studio and CLI say what happened.

**Architecture:** One shared table and store for interruption records, one bootstrap helper that takes back an orphaned job (records it, then resumes it or leaves it waiting), and one studio badge. Each worker swaps its "fail stale running jobs" step for the helper; each job's list API gains an `interruptions` field.

**Tech Stack:** TypeScript, Kysely on Postgres (pg-mem in tests), Fastify routes, React + shadcn studio, commander CLI.

**Spec:** `docs/superpowers/specs/2026-11-18-interrupted-jobs-design.md`

## Global Constraints

- Migration number is `122` (latest on `main` is `121_workflow_version.ts`; no unmerged branch claims 122). Kysely needs strict order.
- Workflow runs never carry on by themselves. Every other job does, up to `MAX_SELF_RESUMES = 3` interruptions in a row.
- "In a row" means records for the same job and the same `phase`; reaching a later phase resets the count.
- A waiting job's status is the string `'interrupted'`.
- Continue is a `⋯` dropdown item, never a button (AGENTS.md section 5). The badge uses shadcn `Badge` + `Tooltip`.
- Every Continue has a CLI twin through shared bootstrap code, audited; CLI actor `cliNamedActor()`.
- Docs in en, fr, pt (in-app troubleshooting and web docs). Changelog after merge.
- No em dashes in any new text.

## Review Focus

1. A job interrupted while the server is still starting twice in a minute: the count must not double-record one cut. Test in Task 2 (`takeBack` called twice for the same job and same `at` records once).
2. A Continue pressed on a job that already carried on by itself: must refuse with a plain message, not start a second copy. Tests in Tasks 3 to 7.
3. A workflow whose definition changed after the cut: Continue still runs, and its confirm text says the definition changed. Test in Task 7.
4. An ingest batch whose outbox event ran out of attempts while `processing`: must show `interrupted`, not stay `processing`. Test in Task 6.
5. A facility import cut in `applying` must apply without a second confirm; cut in `validating` must stop at confirm. Tests in Task 5.

---

### Task 1: Interruption table and store

**Files:**
- Create: `packages/db/src/migrations/internal/122_job_interruptions.ts`, `packages/db/src/job-interruption-store.ts`, `packages/db/src/job-interruption-store.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Produces:
  - Table `job_interruptions(id text pk, job_kind text, job_id text, phase text null, at timestamptz, cause text, resumed_at timestamptz null, resumed_by text null, continued_as text null, created_at timestamptz default now())`, index on `(job_kind, job_id)`, unique on `(job_kind, job_id, at)`.
  - `type JobKind = 'cdr-run' | 'facility-import' | 'facility-job' | 'terminology-ingest' | 'ingest-batch' | 'workflow-receipt'`
  - `type InterruptionCause = 'server-restart' | 'lease-expired' | 'attempts-exhausted'`
  - `interface JobInterruption { id; at: string; cause: InterruptionCause; phase: string | null; resumedAt: string | null; resumedBy: 'self' | 'person' | null; continuedAs: string | null }`
  - `createJobInterruptionStore(db)` with `record(kind, jobId, { at: Date; cause; phase: string | null }): Promise<{ id: string; inserted: boolean }>`, `resolve(id, { resumedBy; resumedAt: Date; continuedAs?: string }): Promise<void>`, `listFor(kind, jobIds: string[]): Promise<Map<string, JobInterruption[]>>`, `inARow(kind, jobId, phase: string | null): Promise<number>`.

- [ ] **Step 1:** Write tests: `record` twice with the same `(kind, jobId, at)` returns `inserted: false` the second time; `listFor` returns records oldest first keyed by job id; `inARow` counts only records whose `phase` equals the argument; `resolve` sets `resumedBy`, `resumedAt`, `continuedAs`.
- [ ] **Step 2:** Run `pnpm --filter @openldr/db test -- job-interruption-store`. Expected: FAIL (module missing).
- [ ] **Step 3:** Write migration 122 (with `down`), the schema type, the store (`on conflict do nothing` for `record`).
- [ ] **Step 4:** Run the same command, plus `pnpm --filter @openldr/db test -- registration`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(db): a table for job interruptions`.

### Task 2: The take-back helper

**Files:**
- Create: `packages/bootstrap/src/job-interruptions.ts`, `packages/bootstrap/src/job-interruptions.test.ts`

**Interfaces:**
- Consumes: Task 1 store.
- Produces:
  - `export const MAX_SELF_RESUMES = 3`
  - `takeBack(deps: { store: JobInterruptionStore; now: () => Date }, input: { kind: JobKind; jobId: string; phase: string | null; at: Date; cause: InterruptionCause; selfResume: boolean; resume(): Promise<void>; wait(): Promise<void> }): Promise<'resumed' | 'waiting' | 'already-recorded'>`
  - `continueJob(deps, input: { kind; jobId; interruptionId: string; start(): Promise<string | void> }): Promise<void>` records `resumedBy: 'person'` and `continuedAs` when `start` returns an id.

- [ ] **Step 1:** Tests: first cut with `selfResume: true` calls `resume` and resolves the record as `self`; the fourth cut in the same phase calls `wait` instead; `selfResume: false` always calls `wait` and leaves the record unresolved; a repeat call with the same `at` returns `'already-recorded'` and calls neither; `continueJob` resolves as `person` with `continuedAs`.
- [ ] **Step 2:** Run `pnpm --filter @openldr/bootstrap test -- job-interruptions`. Expected: FAIL.
- [ ] **Step 3:** Implement in `job-interruptions.ts`.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(bootstrap): take back an interrupted job and record it`.

### Task 3: Terminology upload and facility map rebuild carry on

**Files:**
- Modify: `packages/db/src/terminology-ingest-job-store.ts` (`failStaleRunning` at :35/:150), `packages/db/src/facility-job-store.ts` (:33/:242), `packages/bootstrap/src/terminology-ingest-worker.ts:47-52`, `packages/bootstrap/src/facility-job-worker.ts:65-70`, the routes that list these jobs, `packages/cli/src/terminology.ts`, `packages/cli/src/facilities.ts`
- Test: the two store tests and the two worker tests

**Interfaces:**
- Consumes: Task 2 `takeBack`, `continueJob`.
- Produces: both stores gain `listRunning(): Promise<{ id; phase: string | null; updatedAt: Date }[]>`, `requeue(id)`, `markInterrupted(id)`; statuses widen to include `'interrupted'`. Bootstrap `continueTerminologyIngestJob(ctx, actor, id)` and `continueFacilityJob(ctx, actor, id)`. CLI `openldr terminology jobs` and new `openldr facilities map-jobs` print interruptions; `openldr terminology job-continue <id>` and `openldr facilities map-job-continue <id>`.

- [ ] **Step 1:** Tests: at worker start, a `running` job is requeued (not `failed`) and gets one record `{ cause: 'server-restart', resumedBy: 'self' }`; a job with 3 records in its phase is set `interrupted`; `continue...` on an `interrupted` job requeues it and records `person`; on a `queued` or `running` job it throws `OpenLdrError('this job is not waiting to continue')`.
- [ ] **Step 2:** Run the four test files. Expected: FAIL.
- [ ] **Step 3:** Implement; remove `failStaleRunning` where nothing else calls it.
- [ ] **Step 4:** Run them again plus `pnpm --filter @openldr/cli test -- terminology facilities`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: terminology uploads and map rebuilds carry on after a restart`.

### Task 4: cdr-source runs record their interruptions

**Files:**
- Modify: `packages/bootstrap/src/import-run.ts` (`adopt` at :786), the check and copy adopt paths in `import-check.ts` and `import-copy.ts`, the run view returned by the import routes
- Test: `import-run.test.ts`, `import-check.test.ts`, `import-copy.test.ts`

**Interfaces:**
- Consumes: Task 2 `takeBack` with `kind: 'cdr-run'`, `selfResume: true`, `at` = the run's `updatedAt` (its last heartbeat).
- Produces: every import, copy and check view gains `interruptions: JobInterruption[]`. CLI `import status`, `import copy status`, `import check status` print them.

- [ ] **Step 1:** Tests: adopting a stale run writes one `self` record with the run's `updatedAt` as `at`; the run view lists it; adopting twice for the same cut writes one record.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement. The existing "interrupted, may be resumed" path stays the waiting state after 3 cuts.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(import): runs record each interruption they carried on through`.

### Task 5: Facility import carries on

**Files:**
- Modify: `packages/db/src/facility-import-run-store.ts` (`failStaleRunning` :152/:501), `packages/bootstrap/src/facility-import-worker.ts` (sweep :186-196, boot :543-548), `apps/server/src/facilities-routes.ts`, `packages/cli/src/facilities.ts` (`import-run`, `import-runs`)
- Test: `facility-import-run-store.test.ts`, `facility-import-worker.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: store `listStaleRunning(minAgeMs)`, `returnTo(id, status: 'uploaded' | 'confirmed')`. Bootstrap `continueFacilityImportRun(ctx, actor, id)`. CLI `openldr facilities import-run-continue <id>`.

- [ ] **Step 1:** Tests: at boot (`minAgeMs` 0) a run in `applying` goes back to `confirmed` and applies with no second confirm; a run in `validating` goes back to its pre-validation state and stops at the usual confirm; the sweep on the poll interval still uses `FACILITY_IMPORT_STALE_LEASE_MS`; the register's `active_key` stays held while a run is taken back; after 3 cuts in `applying` the run is `interrupted` and holds no key.
- [ ] **Step 2:** Run the two files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again plus `pnpm --filter @openldr/server test -- facilities`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(facilities): a register import carries on after a restart`.

### Task 6: Ingest batches say they were interrupted

**Files:**
- Modify: `packages/ingest/src/handle.ts` (:37 `markProcessing`), `packages/ingest/src/batch-store.ts`, the outbox exhausted-attempts path in `packages/adapter-event-bus/src/index.ts`, the Activity batches route, the CLI pipeline `status`
- Test: `packages/ingest/src/handle.test.ts`, `batch-store.test.ts`, the `adapter-event-bus` test

**Interfaces:**
- Consumes: Task 1 store (`kind: 'ingest-batch'`).
- Produces: when the handler meets a batch already `processing`, it records `{ cause: 'lease-expired', resumedBy: 'self' }` before running it again. When the outbox gives up on an `ingest.received` event whose batch is `processing`, the batch becomes `interrupted` with an `'attempts-exhausted'` record. Continue is the existing retry (`batchStore.reset` + new event), recorded as `person`.

- [ ] **Step 1:** Tests for the three behaviors above (Review Focus 4).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ingest): a batch says when it was interrupted`.

### Task 7: Workflow runs wait for Continue

**Files:**
- Modify: `packages/workflows/src/receipt-service.ts` (`reconcile` :82-92), `apps/server/src/workflows-routes.ts` (:610, :621), `packages/cli/src/workflows.ts`
- Test: `receipt-service.test.ts`, `workflows-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 with `kind: 'workflow-receipt'`, `selfResume: false` for `running`, `selfResume: true` for `queued`.
- Produces: `POST /api/workflows/:id/receipts/:requestId/continue` returns `{ runId, definitionChanged: boolean }`; bootstrap `continueWorkflowReceipt(ctx, actor, workflowId, requestId)`; CLI `openldr workflows runs <id>` and `openldr workflows run-continue <id> <requestId>`.

- [ ] **Step 1:** Tests: `reconcile` now requeues `queued` with a `self` record (unless the definition changed, which still cancels); `running` becomes `interrupted` with an unresolved record; Continue starts a new run with the stored input and a fresh idempotency key, sets `continuedAs`, and returns `definitionChanged: true` when the version differs; Continue on a non-interrupted receipt is refused.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(workflows): an interrupted run waits for Continue and never re-runs alone`.

### Task 8: The studio badge and Continue items

**Files:**
- Create: `apps/studio/src/components/ui/interruption-badge.tsx` (+ test)
- Modify: `apps/studio/src/api.ts` (types and the continue calls), `apps/studio/src/pages/Terminology.tsx`, the facility import history in `apps/studio/src/facilities/`, `apps/studio/src/pages/Activity.tsx`, `apps/studio/src/workflows/components/panels/receipt-history.tsx`, `apps/studio/src/i18n/{en,fr,pt}.ts`

**Interfaces:**
- Consumes: the `interruptions` fields from Tasks 3 to 7.
- Produces: `<InterruptionBadge interruptions={JobInterruption[]} />`, renders nothing for an empty list; tooltip lines "Interrupted at {time}. Carried on by itself at {time}." / "Interrupted at {time}. Continued by a person at {time}." / "Interrupted at {time}. Waiting for Continue."

- [ ] **Step 1:** Tests: empty list renders nothing; each of the three line forms; on each page, an `interrupted` row's `⋯` menu has Continue and calls its API; the workflow Continue confirm says the definition changed when the API says so.
- [ ] **Step 2:** Run `pnpm --filter @openldr/studio test -- interruption`. Expected: FAIL.
- [ ] **Step 3:** Implement, with en/fr/pt keys.
- [ ] **Step 4:** Run the studio tests and `npx tsc --noEmit -p apps/studio`. Expected: PASS, exit 0.
- [ ] **Step 5:** Check each page at 375x812 with `resize_window`; screenshot the badge. Commit `feat(studio): a badge for interrupted jobs, Continue in the row menu`.

### Task 9: Docs, gate, merge

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/` troubleshooting page, `apps/web/src/docs/0.1.8/{en,fr,pt}/` troubleshooting and `cli.md`

- [ ] **Step 1:** Write "When a job is interrupted" (what each job does after a restart, what the badge means, Continue) in all three languages; add the new CLI commands to `cli.md`.
- [ ] **Step 2:** Full gate: `OPENLDR_SKIP_ENV_FILE=true pnpm turbo run test --force --concurrency=2 --continue`, `pnpm turbo run typecheck --force --concurrency=2`, `pnpm --filter @openldr/server lint`. Expected: all exit 0.
- [ ] **Step 3:** Real check on the dev stack: start one job of each kind, restart the API mid-job, record what the page shows. Write HONEST NON-PROOF for anything only a real power cut or phone can show.
- [ ] **Step 4:** Commit, merge to local `main` on the operator's yes, `pnpm make:changelog`, commit the changelog, push, confirm the origin SHA.
