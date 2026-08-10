# A2b — the facility import runs as a job (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator import a national facility register from the browser — streamed to storage,
processed by a worker, confirmed against a real reconciliation summary, and cancellable — without the
2 000-row cap that today sends them to a shell.

**Architecture:** Upload streams to blob and mints a `facility_import_runs` row; a polling worker
validates and classifies, parks the run at `awaiting_confirmation`, and applies only after the
operator confirms. Both the worker and the existing inline route call the **same**
`importFacilities`, so the two entry paths cannot diverge on semantics. Nothing about the
classification, retirement or validation logic A2a shipped changes.

**Tech Stack:** TypeScript, Kysely, Postgres (internal DB — always Postgres), `BlobStoragePort`
(`putStream`/`getStream`), Fastify, Vitest + pg-mem plus `TARGET_DATABASE_URL`-gated real-Postgres
tests, React + i18next, Commander.

**Spec:** `docs/superpowers/specs/2026-08-09-facility-import-pipeline-design.md` — **§9 was rewritten
against the merged A2a code (`bd94d576`); read that version, not your memory of it.**
**Predecessor:** A2a, merged `b4b1d389`. Read `.superpowers/sdd/progress.md` for what it left and the
traps it paid for.
**Branch:** `slice/facility-import-jobs` (create from `main`).
**Scope:** FAC-P1-02 only.

## Global Constraints

- **Internal DB is always Postgres.** `internalMigrations` takes no engine argument. No dialect branching.
- **Next internal migration number is `081`.** 080 is the highest that exists.
- ⛔ **Every run-state predicate is expressed against an explicit named set** (terminal /
  supersedable / active), **never against a single literal.** A2a compares `status !== 'previewed'`
  in two places and both break the moment the enum widens — see Task 1.
- ⛔ **Supersede, not 409, for an abandoned run.** A 409 on any abandonable state makes a register
  permanently unimportable. An *actively running* state (`validating`, `applying`) is the only case
  that answers 409.
- ⛔ **Cancel cannot interrupt the running transaction.** Say so in the UI (*cancelling*, not
  *cancelled*) and in the code. Never claim a cancellation that has not happened.
- ⛔ **No cursor, no resume.** The import is idempotent by construction (deterministic ids + upsert);
  recovery is re-running from the start. A half-applied national release is worse than a repeated one.
- ⛔ **The inline `POST /api/facilities/import` path and its route tests stay.** They carry the CLI,
  integrators, and the only assertions pinning the wire shape. `MAX_INLINE_APPLY_ROWS` still bounds
  *that* path; the job path is not subject to it.
- ⛔ **Every action control lives in a `⋯` `DropdownMenu`.** Inputs are exempt (label-left /
  input-right, `grid-cols-[auto_1fr]`).
- ⛔ **Every new i18n key goes in `en.ts`, `fr.ts` AND `pt.ts`** in the same commit — `parity.test.ts`
  enforces it.
- ⛔ **Never `git add -A`** (shared working directory); stage named paths only.
- ⛔ **Never add a `Co-Authored-By` trailer.**
- ⛔ **Never revert a mutation with `git checkout -- <file>`.** Use in-place reverse edits.
- **Gate:** `pnpm turbo run typecheck test --force`. **Never pipe turbo through `tail`.** Whole-package
  vitest runs need `--testTimeout=30000`.

## Test-oracle hazards (measured, all of them cost this workstream a round)

- ⛔ **pg-mem's `now()` is real millisecond wall-clock and collides on ~50% of consecutive calls.**
  Any assertion that one timestamp is strictly later than another **races**. Force the gap
  (`now() + interval '1 second'`).
- ⛔ **A mutation must be shown to actually EXECUTE the mutated line.** Three were inert in A2a —
  short-circuited by an upstream guard, by spread key order, and by an early return.
- ⛔ pg-mem has **zero correlated-subquery support**, does **not roll back** on a thrown error, returns
  `numInsertedOrUpdatedRows: 1` for a skipped `onConflict().doNothing()`, and its **scan order is
  stable**, so it can never reveal a missing `ORDER BY` tiebreaker.
- ⛔ **"Built + tested + reviewed" is not "delivered."** A2a shipped a module through three gates with
  zero production callers. **Grep for callers before calling anything done.**
- ⛔ Assertions that cannot fail: A2a shipped two `queryByText` guards whose regexes never matched the
  real copy. Check that each new assertion can actually fail.

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `packages/db/src/migrations/internal/081_facility_import_run_states.ts` | Backfill/constrain nothing structural — see Task 1; exists only if Task 1 concludes a data change is needed. |
| `packages/bootstrap/src/facility-import-worker.ts` | Claim → validate → park; claim → apply → finish. Mirrors `facility-job-worker.ts`'s tick/claim/process/bounded-attempts shape. |
| `packages/bootstrap/src/facility-import-worker.test.ts` | Worker state transitions, cancel, stale recovery. |
| `packages/bootstrap/src/facility-import-run-states.ts` | The named state sets every predicate uses. Pure, no I/O. |
| `packages/bootstrap/src/facility-import-run-states.test.ts` | Exhaustiveness of the sets against the union. |

**Modify:**

| Path | Change |
|---|---|
| `packages/db/src/facility-import-run-store.ts` | Widen the status union; add `startUpload`, `claimNext`, `updateProgress`, `requestCancel`, `failStaleRunning`, `finish`. |
| `apps/server/src/facilities-routes.ts` | Upload / confirm / cancel routes; replace both `!== 'previewed'` literals with set membership. |
| `apps/studio/src/api.ts` | Upload (XHR, progress), poll, confirm, cancel clients. |
| `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` | Upload → poll → summary → confirm, reusing A2a's summary rendering. |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | New keys, all three. |
| `packages/bootstrap/src/index.ts` | Build and register the worker beside `terminologyIngestWorker` (~`:861`) and `facilityJobWorker` (~`:876`); stop it on shutdown (~`:1523`). |
| `packages/cli/src/facilities.ts`, `program.ts` | `import-run cancel <id>`; run listing already exists. |

---

### Task 1: name the run states, and fix the two guards that assume there are three

**Files:**
- Create: `packages/bootstrap/src/facility-import-run-states.ts`, `.test.ts`
- Modify: `packages/db/src/facility-import-run-store.ts`, `apps/server/src/facilities-routes.ts`

**Interfaces — Produces:**

```ts
export type FacilityImportRunStatus =
  | 'queued' | 'validating' | 'awaiting_confirmation' | 'applying'   // active
  | 'previewed'                                                      // inline path, A2a
  | 'applied' | 'failed' | 'cancelled';                              // terminal

/** Nothing more will happen to this run. Its `active_key` is released. */
export const TERMINAL_RUN_STATES: ReadonlySet<FacilityImportRunStatus>;
/** A run a NEW request may take over: the operator walked away. Superseded, never 409'd. */
export const SUPERSEDABLE_RUN_STATES: ReadonlySet<FacilityImportRunStatus>;
/** A worker is mid-flight. A new request gets 409 — taking over would race a live run. */
export const RUNNING_RUN_STATES: ReadonlySet<FacilityImportRunStatus>;
/** May an apply be started against this run? */
export function isApplicable(status: FacilityImportRunStatus): boolean;
```

⛔ **This task exists because of a defect pattern, not to add a type.** A2a compares
`status !== 'previewed'` at `facilities-routes.ts:1222` (supersede gate) and `:1299` (apply guard).
Widening the enum without widening those makes a `queued` or `awaiting_confirmation` run
un-supersedable **and** un-appliable — the register locks, which is exactly the bug A2a's fix wave
closed, reintroduced by the enum. **This is the same shape as A2a's Critical finding: a guard written
against a narrow condition meeting a wider one later.**

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  TERMINAL_RUN_STATES, SUPERSEDABLE_RUN_STATES, RUNNING_RUN_STATES, isApplicable,
  ALL_RUN_STATES, type FacilityImportRunStatus,
} from './facility-import-run-states';

describe('facility import run states', () => {
  it('classifies every state exactly once across terminal/supersedable/running', () => {
    for (const s of ALL_RUN_STATES) {
      const n = [TERMINAL_RUN_STATES, SUPERSEDABLE_RUN_STATES, RUNNING_RUN_STATES]
        .filter((set) => set.has(s)).length;
      expect(n, `state ${s} is in ${n} sets, expected exactly 1`).toBe(1);
    }
  });

  it('never lets a RUNNING state be superseded — taking over would race a live worker', () => {
    for (const s of RUNNING_RUN_STATES) expect(SUPERSEDABLE_RUN_STATES.has(s)).toBe(false);
  });

  it('treats an abandoned queued/awaiting run as supersedable, not as a permanent lock', () => {
    expect(SUPERSEDABLE_RUN_STATES.has('queued')).toBe(true);
    expect(SUPERSEDABLE_RUN_STATES.has('awaiting_confirmation')).toBe(true);
    expect(SUPERSEDABLE_RUN_STATES.has('previewed')).toBe(true);
  });

  it('permits an apply only from a state that has a completed preview behind it', () => {
    expect(isApplicable('previewed')).toBe(true);
    expect(isApplicable('awaiting_confirmation')).toBe(true);
    expect(isApplicable('queued')).toBe(false);      // nothing has classified yet
    expect(isApplicable('applying')).toBe(false);    // already in flight
    expect(isApplicable('applied')).toBe(false);     // replay
    expect(isApplicable('cancelled')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** (`cd packages/bootstrap && npx vitest run src/facility-import-run-states.test.ts`) — module not found.

- [ ] **Step 3: Implement the module.** Derive `ALL_RUN_STATES` as a `readonly` array and the union
  from it (`typeof ALL_RUN_STATES[number]`) so a state added later cannot be omitted from the
  exhaustiveness test.

- [ ] **Step 4: Widen the store's union** to import from this module rather than declaring its own.

- [ ] **Step 5: Replace both literals in `facilities-routes.ts`.**
  `:1222` becomes a `SUPERSEDABLE_RUN_STATES.has(existing.status)` check that **409s** when the state
  is in `RUNNING_RUN_STATES`; `:1299` becomes `isApplicable(run.status)`.
  ⚠ Preserve A2a's existing behaviour for `previewed` exactly — its tests pin it.

- [ ] **Step 6: Run the affected suites**

```
cd packages/bootstrap && npx vitest run src/facility-import-run-states.test.ts
cd apps/server && npx vitest run src/facilities-routes.test.ts
```
Both must pass with **no** change to A2a's existing route assertions.

- [ ] **Step 7: Mutation-prove the guard replacement.** Revert `:1222` to `!== 'previewed'` and add a
  test that an `awaiting_confirmation` run is superseded by a new upload; confirm it fails; restore
  in place.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/facility-import-run-states.ts packages/bootstrap/src/facility-import-run-states.test.ts packages/db/src/facility-import-run-store.ts apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "refactor(facilities): name the run states and stop comparing status to one literal"
```

---

### Task 2: extend the run store for a worker

**Files:** modify `packages/db/src/facility-import-run-store.ts` and its test.

**Interfaces — Produces** (added to `FacilityImportRunStore`):

```ts
  /** Mint a run for an uploaded file. Sets blob_key and status 'queued'. Throws when a RUNNING run
   *  holds this national_system; the route supersedes a supersedable one before calling. */
  startUpload(input: {
    nationalSystem: string; sourceFormat: 'csv' | 'jsonl'; blobKey: string;
    fileHash: string; byteSize: number; releaseVersion?: string | null;
    options: unknown; requestedBy?: string | null;
  }): Promise<FacilityImportRun>;
  /** Guarded UPDATE claim, exactly like facility-job-store's: a second claimer updates 0 rows. */
  claimNext(status: 'queued' | 'awaiting_confirmation', to: 'validating' | 'applying'): Promise<FacilityImportRun | null>;
  updateProgress(id: string, p: { phase: string; processed?: number | null; total?: number | null }): Promise<void>;
  /** Sets cancel_requested. Does NOT stop anything by itself — the worker observes it. */
  requestCancel(id: string): Promise<'requested' | 'not-found' | 'already-terminal'>;
  finish(id: string, status: 'applied' | 'failed' | 'cancelled', opts: { summary?: unknown; error?: string | null }): Promise<void>;
  /** Crash recovery: fail every run left in a RUNNING state at boot. Returns how many. */
  failStaleRunning(error: string): Promise<number>;
```

⛔ `finishApply` (A2a) stays for the inline path. `finish` is its generalisation — **do not delete
`finishApply` and do not change its behaviour**; the inline route and CLI both depend on it.

- [ ] **Step 1: Write failing tests** covering: `startUpload` mints `queued` with the blob key and
  holds `active_key`; `claimNext` moves exactly one row and a second concurrent claim gets `null`;
  `claimNext` returns `null` when nothing is in the requested state; `updateProgress` writes phase
  and leaves `processed`/`total` untouched when omitted; `requestCancel` reports `already-terminal`
  for a finished run; `finish('cancelled', …)` releases `active_key`; `failStaleRunning` fails only
  RUNNING states and returns the count.

⚠ **`claimNext` must use the guarded-UPDATE idiom** (`update … where id = ? and status = ?
returning *`), not `SELECT … FOR UPDATE SKIP LOCKED` — pg-mem cannot do the latter in a correlated
subquery, and the guard is race-safe on real Postgres anyway. `facility-job-store.ts:174-183` is the
model; copy its `CLAIM_CANDIDATES` loop reasoning too.

⚠ Any ordering here needs a **unique tiebreaker** (`created_at` is transaction time, so rows created
in one transaction tie). pg-mem cannot show you this.

- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Mutation-prove the claim guard.** Drop `and status = ?` from the UPDATE (the plausible
  wrong implementation — a claimer that trusts its SELECT); confirm the double-claim test fails.
  ⚠ Verify the mutated line actually executes. Restore in place.
- [ ] **Step 6: Commit** — `feat(facilities): give the import-run store a worker surface`

---

### Task 3: the upload route

**Files:** modify `apps/server/src/facilities-routes.ts` and its test.

`POST /api/facilities/import/upload?nationalSystem=&format=&releaseVersion=` — `facilities.manage`.

- Streams `req.body` (a Node `Readable`) through a hashing `PassThrough` into
  `ctx.blob.putStream(key, …)`, so `file_hash` and `byte_size` are computed **without buffering**.
  `apps/server/src/terminology-admin-routes.ts:442-463` is the working precedent — read it first,
  including `isReadableBody`.
- Blob key shape: `facility-import/<nationalSystem-slug>/<runId>.<ext>`.
- Before minting: if a run holds this `national_system`, supersede it when
  `SUPERSEDABLE_RUN_STATES.has(status)` (finish it `cancelled`, reason *superseded by a newer
  upload*), and **409** when `RUNNING_RUN_STATES.has(status)`.
- ⛔ **No row cap on this path.** `MAX_INLINE_APPLY_ROWS` still bounds the inline route; say so in a
  comment naming both, so a reader does not "unify" them.
- Returns `202 { runId }`.
- Audits `facility.import.uploaded`.

- [ ] **Step 1: Write failing tests** — a successful upload returns a `runId` and a `queued` run
  carrying the blob key, file hash and byte size; a second upload while the first is
  `awaiting_confirmation` **supersedes** it; a second upload while the first is `validating`
  **409s**; a non-stream body is a clear 400; the blob receives the bytes.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Mutation-prove the hash.** Make the `PassThrough` hash a constant; confirm the
  file-hash assertion fails.
- [ ] **Step 6: Commit** — `feat(facilities): stream an import upload to blob and mint its run`

---

### Task 4: the worker — validate phase

**Files:** create `packages/bootstrap/src/facility-import-worker.ts` + test; modify
`packages/bootstrap/src/index.ts`.

**Interfaces — Produces:**

```ts
export interface FacilityImportWorkerDeps {
  runs: FacilityImportRunStore;
  blob: Pick<BlobStoragePort, 'getStream' | 'delete'>;
  importDeps: FacilityImportDeps;           // db / admin / facilityJobs / logger, as the route passes
  intervalMs?: number;                      // default 3000, mirroring createFacilityJobWorker
  maxAttempts?: number;                      // default 5
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}
export interface FacilityImportWorker { tickOnce(): Promise<void>; stop(): Promise<void>; }
export function createFacilityImportWorker(deps: FacilityImportWorkerDeps): FacilityImportWorker;
```

Validate phase: `claimNext('queued', 'validating')` → read the blob → call `importFacilities` with
`apply: false` and the run's stored options → `completePreview(id, summary)` → move to
`awaiting_confirmation`.

⛔ **The worker calls the SAME `importFacilities` the inline route calls.** It does not reimplement
parsing, classification, validation or retirement. If you find yourself duplicating any of that, stop
and report it.

⛔ **Cancel is observed at the phase boundary**: if `cancel_requested` is set when the claim returns
or before the summary is written, finish `cancelled` without applying anything.

⛔ **Crash recovery** runs at construction, exactly like `createFacilityJobWorker`'s: best-effort
`failStaleRunning`, never blocking startup, handle retained so `stop()` can await it.

- [ ] **Step 1: Write failing tests** — a queued run is validated and parked at
  `awaiting_confirmation` with a real summary; a cancel requested before validation finishes leaves
  the run `cancelled` and writes nothing; a throwing `importFacilities` leaves the run `failed` with
  its message and releases `active_key`; `tickOnce` with an empty queue is a no-op; a run left
  `validating` at construction is failed by crash recovery.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Register it in `packages/bootstrap/src/index.ts`** beside `terminologyIngestWorker`
  (~`:861`) and `facilityJobWorker` (~`:876`), and stop it in shutdown (~`:1523`).
  ⚠ **Grep for callers afterwards** — A2a shipped a module through three reviews with none.
- [ ] **Step 5: Run, expect pass.**
- [ ] **Step 6: Mutation-prove the cancel check.** Delete it; confirm the cancel test fails and that
  the deleted line was on the executed path.
- [ ] **Step 7: Commit** — `feat(facilities): validate an uploaded register in a worker`

---

### Task 5: confirm, and the apply phase

**Files:** modify `apps/server/src/facilities-routes.ts`, `packages/bootstrap/src/facility-import-worker.ts`, both tests.

`POST /api/facilities/import/runs/:id/confirm` — `facilities.manage` — carries the operator's choices
(`onDeleted`, `onAbsent`, `onConflict`, `allowUnknownColumns`, `allowMalformedRows`,
`allowInvalidCoordinates`), merges them into the run's `options`, and moves
`awaiting_confirmation` → `queued`-for-apply. **409 unless `isApplicable(run.status)`.**

Worker apply phase: `claimNext('awaiting_confirmation', 'applying')` → `importFacilities` with
`apply: true`, the merged options, **and the run's `previewedAt` as the watermark** → `finish('applied', { summary })`.

⛔ **The watermark is the whole point of the two-phase flow.** The run's `previewed_at` was stamped
when the worker classified; passing it makes conflict detection real. Do not skip it.
⛔ The applied import must still project via `deps.admin` and enqueue exactly one
`facility-map-rebuild` — that happens inside `importFacilities`; do not duplicate it.
⛔ Audit `facility.import` on a successful apply, matching the inline route's record.

- [ ] **Step 1: Write failing tests** — confirm on an `awaiting_confirmation` run moves it and the
  worker applies it; the applied run's summary reports `written`; a row edited between validate and
  apply is reported `conflict` and skipped by default, and **written when `onConflict: 'overwrite'`**;
  confirm on an already-`applied` run is a 409; confirm on an unknown id is a 404.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Mutation-prove the watermark.** Pass `previewedAt: null` from the worker; confirm the
  conflict test fails (it will report `conflict: null`, the not-evaluated signal).
- [ ] **Step 6: Commit** — `feat(facilities): apply a confirmed import in the worker`

---

### Task 6: cancel

**Files:** modify the route, the worker, and both tests.

`POST /api/facilities/import/runs/:id/cancel` — `facilities.manage` → `requestCancel`.

⛔ **Honest semantics.** The flag is observed at phase boundaries and between insert chunks. It
**cannot interrupt the running transaction**. A cancel during `applying` may therefore arrive too
late — in which case the run finishes `applied`, and that is the truthful outcome. **Do not report
`cancelled` for a run that applied.** The API returns *requested*, not *cancelled*.

- [ ] **Step 1: Write failing tests** — cancel on a `queued` run finishes it `cancelled` and writes
  nothing; cancel on a terminal run reports `already-terminal` (409), not a false success; cancel
  requested mid-apply **does not** produce a partial write (the transaction is all-or-nothing);
  a run that completes before the flag is observed reports `applied`, not `cancelled`.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(facilities): let an operator request cancellation of an import run`

---

### Task 7: MEASURE the per-row progress threshold — do not guess it

**Files:** modify `packages/bootstrap/src/facility-import-worker.ts` (one constant + its comment).

This task produces a **measurement and a constant**, and may produce no other code. That is a correct
outcome — A1's index task did exactly this.

The question: **at what row count does an apply take long enough that per-row progress could actually
be observed?** Baseline already measured on real Postgres: 13 000 rows = **2 689 ms** cold end to end.

- [ ] **Step 1: Provision a scratch database** (`docker exec openldr_ce-postgres-1 psql -U openldr -d postgres -c "CREATE DATABASE openldr_a2b_probe;"`).
      ⛔ **Never point a probe at the dev database `openldr`.**
- [ ] **Step 2: Measure** apply duration at 1 000 / 2 500 / 5 000 / 10 000 / 13 000 rows, ≥3 runs
      each, recording the median. Convert the real MFL corpus
      (`../corlix/fixtures/mfl-TZ-2026-Q3-large.jsonl`) rather than inventing synthetic rows — its
      row width is the realistic one.
- [ ] **Step 3: Choose the threshold** as the smallest row count whose median apply exceeds ~1 s of
      observable work, and set `PER_ROW_PROGRESS_MIN_ROWS` to it.
- [ ] **Step 4: Write the measurement into the comment beside the constant** — the row counts, the
      medians, the machine, and the date. ⛔ **State the caveats**: loopback Postgres, no TLS, no
      concurrent load. A remote database is slower and the threshold is a floor, not a law.
- [ ] **Step 5: Implement the gate** — below the threshold report phase only; at or above it also
      report `processed`/`total`.
- [ ] **Step 6: Drop the scratch database** and confirm it is gone.
- [ ] **Step 7: Commit** — `perf(facilities): measure where per-row import progress becomes observable`

---

### Task 8: the studio switches to upload

**Files:** modify `apps/studio/src/api.ts`, `ImportFacilitiesSheet.tsx`, its test, and all three locales.

- New clients: `uploadFacilityImport` (XHR, so upload progress is available — copy
  `uploadTerminologyDistribution` at `apps/studio/src/api.ts:1504`, which already does exactly this),
  `getFacilityImportRun`, `confirmFacilityImportRun`, `cancelFacilityImportRun`.
- The sheet's flow becomes: pick file + system + format → **Upload** (⋯ menu) → poll → render A2a's
  existing reconciliation summary → **Confirm** (⋯ menu) → applied summary. **Cancel** in the ⋯ menu
  while a run is active.
- ⛔ **Reuse A2a's summary rendering.** It already renders create/changed/unchanged, the
  null-is-not-evaluated cases, samples with before→after diffs, invalid coordinates,
  unmapped/notValidated and countMismatch. **Do not rewrite it**; move it if it needs to be shared.
- ⛔ The browser stops doing `f.text()`. The `File` is the request body.
- ⛔ `conflict: null` / `absent: null` still render as *not evaluated*, never `0`. A2a's
  mutation-proven test for this must keep passing.

- [ ] **Step 1: Write failing component tests** — upload transitions the sheet to a polling state;
  a run reaching `awaiting_confirmation` renders the summary and offers Confirm; Confirm sends the
  operator's choices; Cancel is offered only while active and shows *cancelling* rather than
  *cancelled*; a `failed` run shows its error.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement**, adding keys to `en.ts`, `fr.ts` **and** `pt.ts` in the same commit.
- [ ] **Step 4: Run** `cd apps/studio && npx vitest run --testTimeout=30000` — including
      `src/i18n/parity.test.ts`.
- [ ] **Step 5: Mutation-prove the cancelling copy.** Render *cancelled* instead; confirm the test fails.
- [ ] **Step 6: Commit** — `feat(facilities): upload and confirm a register import from the browser`

---

### Task 9: CLI parity

**Files:** modify `packages/cli/src/facilities.ts`, `program.ts`, and the tests.

- `openldr facilities import-run cancel <id>` — requests cancellation, reports what actually happened
  (*requested* vs *already terminal*), never claiming a cancellation that did not occur.
- `openldr facilities import-runs` already exists (A2a) — extend its output with the new states and
  the phase, so an operator can see a job-path run.
- ⛔ The CLI's own `facilities import` stays **synchronous and direct**. It is automation and a queue
  would cost it its exit code. Do not route it through the worker.

- [ ] **Step 1: Write failing tests** — cancel reports each outcome distinctly; `import-runs` renders
  a `validating` run's phase; exit codes are non-zero on failure.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd packages/cli && npx vitest run --testTimeout=30000`.
- [ ] **Step 5: Commit** — `feat(cli): cancel and inspect job-path import runs`

---

### Task 10: full gate, live verification, whole-branch review

- [ ] **Step 1:** `pnpm turbo run typecheck test --force`. Never pipe through `tail`. If a package
  times out, re-run it alone before blaming a change — and if it is slow *because of this branch*,
  fix it rather than re-running (see A2a's 60 s CLI budget and its comment).
- [ ] **Step 2: Live end-to-end on real Postgres** — upload the real 13 000-row MFL release through
  the job path, confirm it, and assert: the run reaches `applied`; a byte-identical second upload
  reports `unchanged: 13000`; a cancel before confirm leaves the registry untouched.
- [ ] **Step 3: Verify both entry paths still agree.** Import the same file inline and through the
  job path against separate scratch registers and assert the resulting rows are identical. This is
  the property that justifies keeping two paths.
- [ ] **Step 4: Grep for callers of every module this branch adds.** A2a shipped one with none through
  three reviews.
- [ ] **Step 5: Whole-branch review** via superpowers:requesting-code-review, on the most capable
  model. ⛔ Ask explicitly: *which guard introduced early in this branch did a later commit make
  vacuous?* That question found A2a's Critical defect, and this branch widens a state enum that two
  existing guards already compare against.
- [ ] **Step 6: Drop every scratch database** created along the way and confirm.

---

## Self-review

**Spec coverage.** §9's flow maps to Tasks 3–6; the status-enum hazard it names maps to Task 1; the
"measure, don't guess" instruction maps to Task 7; both-paths-survive to Tasks 3 and 10 Step 3;
supersede-not-409 to Tasks 1 and 3; honest cancel to Task 6; no-cursor to Task 4's crash recovery.

**Placeholder scan:** clean. Every task states its interface and its test cases. Tasks 1 and 2 carry
full code for the parts where a wrong signature would propagate; Tasks 3–9 specify behaviour and
tests, because their implementations are mostly wiring against precedents named by file and line.

**Type consistency.** `FacilityImportRunStatus` is defined once in Task 1 and imported everywhere
after; `startUpload`/`claimNext`/`requestCancel`/`finish`/`failStaleRunning` keep their Task 2
signatures through Tasks 3–6 and 9; `isApplicable` is the single apply predicate in Tasks 1 and 5.

**Two things deliberately NOT built**, so they are not mistaken for gaps: a resume cursor (recovery is
re-run; the import is idempotent), and any change to A2a's classification, validation, retirement or
inline route semantics. Migration `081` is listed conditionally — Task 1 may conclude no schema change
is needed at all, since `status` is already a free-text column.
