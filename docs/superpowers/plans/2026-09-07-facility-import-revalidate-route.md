# Facility import: re-validate a stored upload (plan B, server and CLI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change a column map and check the file again without sending the file again.

**Architecture:** A run that is waiting for a decision goes back to the head of the validate queue with new operator-supplied options, against the blob it already stored. One store method, one route, one CLI command, and no worker change: the worker already claims `queued` runs.

**Tech Stack:** TypeScript, Fastify, Kysely, vitest, pg-mem for store tests.

**Spec:** `docs/superpowers/specs/2026-09-07-facility-import-review-is-read-only-design.md` §5

**Sibling plan:** `docs/superpowers/plans/2026-09-07-facility-import-review-read-only.md` (plan A).
**Do plan A first.** Plan A is what makes going back to Mapping a normal move; without it this route
has no caller in the studio. This plan is still independently useful through the CLI.

## Global Constraints

- `AGENTS.md` §6 item 2: an admin feature is a route AND a CLI command, with the shared logic in
  `@openldr/bootstrap` so both call identical code. Never duplicate. Audit as `actorName: 'cli'`.
- `AGENTS.md` §8: never hardcode clinical vocabulary. Nothing in this plan should contain a code.
- No em dashes. No emoji in headings or bullets.
- Kysely enforces strict numeric migration order and a gap blocks boot. **This plan adds no
  migration.** If you find yourself writing one, stop: see Decision record fact 4.
- `apps/server` is the only package with real lint, and it enforces the return/await `reply.send`
  rule. Run `pnpm --filter @openldr/server lint`.
- Full gate: `pnpm turbo run test`. Never pipe turbo through `tail`.
- Branch `feat/facility-import-revalidate`, cut from `main` after plan A merges.

---

## Decision record

Checked on 2026-09-07.

**1. The blob survives validation.** `facility_import_runs.blob_key` holds it
(`080_facility_import_runs.ts:23`), the worker's validate phase reads it
(`facility-import-worker.ts:383-384`) and so does apply (`:453-454`). So a second validate has
something to read.

**2. The worker needs no change.** `VALIDATE_PHASE = { from: 'queued', to: 'validating' }`
(`facility-import-run-states.ts:100-101`) and the worker claims with
`claimNext(VALIDATE_PHASE.from, VALIDATE_PHASE.to)`. Move a run back to `queued` and it is picked up
by the code that already exists.

**3. Options are read off the run row, not the request.** `validateOptions` and `applyOptions` both
start from `run.options` (`facility-import-worker.ts:254`, `:293`, `:320`), and identity fields win
over operator-supplied JSON so "a hand-edited `options` JSON cannot import under a register this run
does not name" (`:278`). This route writes `options`; it must not write identity.

**4. No migration.** `facility_import_runs.status` is plain `text notNull` with no check constraint,
and `options` is `jsonb` (`080_facility_import_runs.ts:41`). Nothing about this needs a schema change.

**5. Cancel deletes the blob.** `deps.blob.delete(run.blobKey)` on cancel
(`facility-import-worker.ts:363-365`). So "the run has a blob key" is not the same question as "the
blob is there", and a cancelled run must be refused on status before anything tries to read it.

**6. The three capability constants are one capability.** `MANAGE`, `IMPORT` and `UPLOAD`
(`facilities-routes.ts:38`, `:57`, `:145`) all guard `facilities.manage` and differ only in
`bodyLimit`. This route's body is a column map and a few booleans, so it takes plain `MANAGE`. Do not
reach for `UPLOAD` by analogy with the upload route; that raises the body limit to the file cap for
no reason.

**7. The store's guarded-update idiom.** `confirm(id, expectedStatus, options)` returns a boolean and
updates zero rows for a second caller (`facility-import-run-store.ts:94`, and the note at `:60`
describing the idiom). The new method follows it exactly, so two clicks cannot queue two validates.

**8. A run holds the register lock while active.** `startUpload` calls `assertRegisterFree`
(`facility-import-run-store.ts:316`) and terminal writers clear `active_key`. Moving
`awaiting_confirmation` to `queued` keeps the run active throughout, so the lock is held the whole
time and no second import can slip in between. Do not release and re-take it.

## File structure

| File | Responsibility |
|---|---|
| Modify `packages/db/src/facility-import-run-store.ts` | `requeueForValidation`, the guarded move back to the validate queue. |
| Modify `packages/db/src/facility-import-run-store.test.ts` | That it is guarded, and that it writes options without touching identity. |
| Create `packages/bootstrap/src/facility-revalidate.ts` | The shared decision: which runs may be re-validated, and what the refusal says. Called by the route and the CLI. |
| Create `packages/bootstrap/src/facility-revalidate.test.ts` | Every refusal, and the happy path. |
| Modify `apps/server/src/facilities-routes.ts` | `POST /api/facilities/import/runs/:id/revalidate`. |
| Modify `apps/server/src/facilities-routes.test.ts` | Wire shape and the refusals. |
| Modify `packages/cli/src/facilities.ts` and `packages/cli/src/index.ts` | `facilities import revalidate`. |
| Modify `packages/cli/src/facilities.test.ts` | The command. |
| Modify `apps/studio/src/api.ts`, `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` | Call it instead of prompting a re-upload. |
| Modify docs, four files | The loop no longer costs a re-upload. |

---

### Task 1: `requeueForValidation` in the store

**Files:**
- Modify: `packages/db/src/facility-import-run-store.ts`
- Modify: `packages/db/src/facility-import-run-store.test.ts`

**Interfaces:**
- Produces, on `FacilityImportRunStore`:
  ```ts
  /** Guarded move back to the head of the validate queue, replacing the operator-supplied options.
   *  Returns false when the run was not in `expectedStatus`, exactly like `confirm`. */
  requeueForValidation(id: string, expectedStatus: FacilityImportRunStatus, options: unknown): Promise<boolean>;
  ```

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/facility-import-run-store.test.ts`, following that file's existing fixture
setup:

```ts
describe('requeueForValidation', () => {
  it('moves an awaiting_confirmation run back to the validate queue with new options', async () => {
    const run = await store.startUpload({
      nationalSystem: 'urn:zm:mfl', sourceFormat: 'csv', blobKey: 'blob-1',
      fileHash: 'h', byteSize: 10, options: { columnMap: { columns: { A: 'name' } } },
    });
    await store.completeValidation(run.id, { parsed: 2 });

    const ok = await store.requeueForValidation(run.id, 'awaiting_confirmation', {
      columnMap: { columns: { B: 'name' } },
    });

    expect(ok).toBe(true);
    const after = await store.get(run.id);
    expect(after?.status).toBe('queued');
    expect((after?.options as { columnMap: unknown }).columnMap).toEqual({ columns: { B: 'name' } });
  });

  // ⛔ The same guarded-update idiom `confirm` uses. Two clicks must not queue two validates.
  it('updates nothing for a second caller', async () => {
    const run = await store.startUpload({
      nationalSystem: 'urn:zm:mfl2', sourceFormat: 'csv', blobKey: 'blob-2',
      fileHash: 'h', byteSize: 10, options: {},
    });
    await store.completeValidation(run.id, { parsed: 1 });

    expect(await store.requeueForValidation(run.id, 'awaiting_confirmation', {})).toBe(true);
    expect(await store.requeueForValidation(run.id, 'awaiting_confirmation', {})).toBe(false);
  });

  // ⛔ Identity is not operator-supplied. The worker already refuses to import under a register a
  // run does not name (`facility-import-worker.ts:278`); this keeps the row honest at the source.
  it('does not let options rewrite the run identity', async () => {
    const run = await store.startUpload({
      nationalSystem: 'urn:zm:mfl3', sourceFormat: 'csv', blobKey: 'blob-3',
      fileHash: 'h', byteSize: 10, options: {},
    });
    await store.completeValidation(run.id, { parsed: 1 });

    await store.requeueForValidation(run.id, 'awaiting_confirmation', {
      nationalSystem: 'urn:tz:hfr', sourceFormat: 'jsonl',
    });

    const after = await store.get(run.id);
    expect(after?.nationalSystem).toBe('urn:zm:mfl3');
    expect(after?.sourceFormat).toBe('csv');
  });

  it('keeps the blob key, which is the whole point', async () => {
    const run = await store.startUpload({
      nationalSystem: 'urn:zm:mfl4', sourceFormat: 'csv', blobKey: 'blob-4',
      fileHash: 'h', byteSize: 10, options: {},
    });
    await store.completeValidation(run.id, { parsed: 1 });
    await store.requeueForValidation(run.id, 'awaiting_confirmation', {});
    expect((await store.get(run.id))?.blobKey).toBe('blob-4');
  });
});
```

Read the file's existing tests first and reuse their `store` construction and their
`completeValidation` call shape. Do not invent a second fixture.

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run src/facility-import-run-store.test.ts --root packages/db`
Expected: FAIL, `store.requeueForValidation is not a function`.

- [ ] **Step 3: Implement it**

Add to the interface at `packages/db/src/facility-import-run-store.ts:36-142` and implement beside
`confirm`, copying that method's guarded-update shape:

```ts
    /** ⛔ `VALIDATE_PHASE.from`, never the literal `'queued'`. The worker claims with
     *  `claimNext(VALIDATE_PHASE.from, VALIDATE_PHASE.to)`, and a literal here is exactly the drift
     *  that constant exists to prevent: the route would answer 202 and no worker would ever look.
     *
     *  ⛔ WRITES `options` ONLY. `national_system`, `source_format`, `blob_key`, `file_hash` and
     *  `byte_size` are the run's identity and its stored file. The worker already refuses to import
     *  under a register the run does not name; this keeps the row itself honest so that refusal
     *  never has to fire.
     *
     *  ⛔ DOES NOT TOUCH `active_key`. The run has held the register lock since `startUpload` and
     *  goes on holding it: it never reaches a terminal state here. Releasing and re-taking would
     *  open a window for a second import of the same register. */
    async requeueForValidation(id, expectedStatus, options) {
      const res = await db.updateTable('facility_import_runs')
        .set({
          status: VALIDATE_PHASE.from,
          options: JSON.stringify(options) as never,
          // The previous validate's verdict is not the new one's. Left in place it would be read as
          // the answer to a question that has not been asked yet.
          summary: null as never,
          error: null,
        })
        .where('id', '=', id)
        .where('status', '=', expectedStatus)
        .executeTakeFirst();
      return Number(res.numUpdatedRows ?? 0) > 0;
    },
```

Check the column names against migration 080 before writing them; `summary` and `error` are guesses
from the store's own `finish` signature and must be verified.

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run src/facility-import-run-store.test.ts --root packages/db`
Expected: PASS.

**HONEST NON-PROOF to record:** pg-mem is not Postgres. This is a guarded UPDATE racing the worker's
own `claimNext`, and pg-mem has a stable scan order and cannot show that race. What would prove it is
a live run against real Postgres with a worker polling.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/facility-import-run-store.ts packages/db/src/facility-import-run-store.test.ts
git commit -m "feat(facilities): a stored import run can be put back in the validate queue"
```

---

### Task 2: The shared decision in `@openldr/bootstrap`

One function both doors call, so the route and the CLI can never disagree about which runs may be
re-validated.

**Files:**
- Create: `packages/bootstrap/src/facility-revalidate.ts`
- Create: `packages/bootstrap/src/facility-revalidate.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (export it)

**Interfaces:**
- Consumes: `requeueForValidation` from Task 1.
- Produces:
  ```ts
  export type RevalidateOutcome =
    | { ok: true }
    | { ok: false; code: 'not-found' | 'not-revalidatable' | 'no-stored-file' | 'raced'; message: string };

  export interface RevalidateInput {
    runId: string;
    /** Operator-supplied options only. Identity fields present here are ignored, not an error. */
    options: Record<string, unknown>;
  }

  export function revalidateImportRun(
    runs: FacilityImportRunStore, input: RevalidateInput,
  ): Promise<RevalidateOutcome>;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/facility-revalidate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { revalidateImportRun } from './facility-revalidate';

const runStore = (run: unknown, requeue = vi.fn().mockResolvedValue(true)) => ({
  get: vi.fn().mockResolvedValue(run),
  requeueForValidation: requeue,
} as never);

const awaiting = { id: 'fir_1', status: 'awaiting_confirmation', blobKey: 'b1' };

describe('revalidateImportRun', () => {
  it('requeues a run that is waiting for a decision', async () => {
    const requeue = vi.fn().mockResolvedValue(true);
    const out = await revalidateImportRun(runStore(awaiting, requeue), {
      runId: 'fir_1', options: { columnMap: { columns: {} } },
    });
    expect(out).toEqual({ ok: true });
    expect(requeue).toHaveBeenCalledWith('fir_1', 'awaiting_confirmation', { columnMap: { columns: {} } });
  });

  it('reports a run that does not exist', async () => {
    const out = await revalidateImportRun(runStore(null), { runId: 'nope', options: {} });
    expect(out).toMatchObject({ ok: false, code: 'not-found' });
  });

  // ⛔ An inline preview stores nothing. Requeueing one hands the worker a run it can only fail,
  // which is the same trap the confirm route names at facilities-routes.ts:2641-2646.
  it('refuses a run with no stored file', async () => {
    const out = await revalidateImportRun(
      runStore({ id: 'fir_2', status: 'previewed', blobKey: null }), { runId: 'fir_2', options: {} },
    );
    expect(out).toMatchObject({ ok: false, code: 'no-stored-file' });
  });

  // ⛔ Cancel DELETES the blob (facility-import-worker.ts:363-365), so a cancelled run must be
  // refused on status before anything tries to read a key that points at nothing.
  it.each(['applied', 'failed', 'cancelled', 'applying', 'validating', 'queued', 'confirmed'])(
    'refuses a run in status %s',
    async (status) => {
      const out = await revalidateImportRun(
        runStore({ id: 'fir_3', status, blobKey: 'b' }), { runId: 'fir_3', options: {} },
      );
      expect(out).toMatchObject({ ok: false, code: 'not-revalidatable' });
    },
  );

  it('reports a race when the guarded update loses', async () => {
    const out = await revalidateImportRun(
      runStore(awaiting, vi.fn().mockResolvedValue(false)), { runId: 'fir_1', options: {} },
    );
    expect(out).toMatchObject({ ok: false, code: 'raced' });
  });

  // ⛔ Identity fields are IGNORED, not rejected. A CLI user sending a whole options file that
  // happens to contain nationalSystem should get their column map applied, not a refusal.
  it('drops identity fields from the options it writes', async () => {
    const requeue = vi.fn().mockResolvedValue(true);
    await revalidateImportRun(runStore(awaiting, requeue), {
      runId: 'fir_1',
      options: { nationalSystem: 'urn:tz:hfr', sourceFormat: 'jsonl', columnMap: { columns: {} } },
    });
    expect(requeue).toHaveBeenCalledWith('fir_1', 'awaiting_confirmation', { columnMap: { columns: {} } });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run src/facility-revalidate.test.ts --root packages/bootstrap`
Expected: FAIL on the missing module.

- [ ] **Step 3: Implement**

Create `packages/bootstrap/src/facility-revalidate.ts` with the interface above. The whole decision:

- `runs.get(runId)`; absent gives `not-found`.
- Status must be exactly `'awaiting_confirmation'`. Anything else gives `not-revalidatable`, with the
  status named in the message.
- `blobKey` falsy gives `no-stored-file`, with the message pointing at the inline route the same way
  the confirm route's does.
- Strip `nationalSystem`, `sourceFormat`, `completeRelease`, `releaseVersion`, `blobKey`, `fileHash`
  and `byteSize` from `options` before writing.
- `requeueForValidation(runId, 'awaiting_confirmation', stripped)` returning false gives `raced`.

Write the identity list as a named `const IDENTITY_KEYS` with a docblock saying why each is there, so
a field added later has an obvious place to be considered.

- [ ] **Step 4: Run, expect pass. Export from `index.ts`. Commit.**

```bash
git add packages/bootstrap/src/facility-revalidate.ts packages/bootstrap/src/facility-revalidate.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(facilities): one decision about which import runs may be checked again"
```

---

### Task 3: The route

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Modify: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `revalidateImportRun` from Task 2.
- Produces: `POST /api/facilities/import/runs/:id/revalidate`, body
  `{ columnMap?: FacilityColumnMap; allowUnknownColumns?: boolean; allowInvalidCoordinates?: boolean }`,
  `202` on success, `404` for `not-found`, `409` for `not-revalidatable`, `no-stored-file` and
  `raced`, `400` for a body that fails the zod parse.

- [ ] **Step 1: Write the failing route tests**

Add to `apps/server/src/facilities-routes.test.ts`, in the style of the file's existing run tests: the
happy path returns 202 and leaves the run `queued`; a missing run is 404; a `confirmed` run is 409
naming its status; a body that is not an object is 400.

Include one that pins the wire shape, because `typecheck` green does not pin it:

```ts
  it('accepts a column map and nothing about the register', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/facilities/import/runs/${runId}/revalidate`,
      payload: { columnMap: { columns: { Name: 'name' }, constants: {}, extras: [] },
                 nationalSystem: 'urn:tz:hfr' },
    });
    expect(res.statusCode).toBe(202);
    const run = await ctx.importRuns.get(runId);
    expect(run?.nationalSystem).not.toBe('urn:tz:hfr');
  });
```

- [ ] **Step 2: Run, expect 404 from the router (the route does not exist yet)**

Run: `npx vitest run src/facilities-routes.test.ts --root apps/server`

- [ ] **Step 3: Write the route**

Place it beside the confirm route (`facilities-routes.ts:2618`). Guard with `MANAGE` and the docblock
from Decision record fact 6, so the next reader does not "fix" it to `UPLOAD`.

Map the outcome codes to statuses as listed above. Audit the action the way the neighbouring routes
audit theirs.

**Lint rule:** `apps/server` enforces return/await on `reply.send`. Follow the shape the neighbouring
routes use exactly; that rule exists to stop gzip clobbering the response.

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run src/facilities-routes.test.ts --root apps/server`
Run: `pnpm --filter @openldr/server lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): check a stored import again without sending the file again"
```

---

### Task 4: CLI parity

`AGENTS.md` §6 item 2. Shared logic already lives in `@openldr/bootstrap` from Task 2, so this is a
thin command.

**Files:**
- Modify: `packages/cli/src/facilities.ts`, `packages/cli/src/index.ts`
- Modify: `packages/cli/src/facilities.test.ts`

- [ ] **Step 1: Write the failing test**

`openldr facilities import revalidate --run <id> --column-map <file.json>` requeues the run and
prints its new status. A refusal prints the shared message and exits non-zero. Follow the existing
`--column-map` reading in `packages/cli/src/facilities.ts:203-211` rather than writing a second
reader.

- [ ] **Step 2: Implement, register in `index.ts`, run the tests**

Audit as `actorName: 'cli'`. This command is not destructive (it writes no facility data), so it does
not need `--force`.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): facilities import revalidate, for labs that work headless"
```

---

### Task 5: The studio calls it

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

- [ ] **Step 1: Add the client**

```ts
/** `POST /api/facilities/import/runs/:id/revalidate`. Check a stored upload again under a new
 *  column map, without sending the file again. */
export const revalidateFacilityImportRun = (
  runId: string,
  body: { columnMap?: FacilityColumnMap; allowUnknownColumns?: boolean; allowInvalidCoordinates?: boolean },
): Promise<{ status: string }> =>
  authFetch(`/api/facilities/import/runs/${encodeURIComponent(runId)}/revalidate`, jbody(body, 'POST'))
    .then((r) => okJson<{ status: string }>(r, 'revalidate import run'));
```

- [ ] **Step 2: Use it on the streamed door**

When the operator moves forward from Mapping and a `runId` exists whose run is
`awaiting_confirmation`, call this instead of prompting a re-upload. Plan A's `summarySignature`
already told the sheet the summary is stale; this is what earns a fresh one.

Remove the `reupload` prompt from `ReconciliationSummary` only once this path is proven live. Until
then it is the honest fallback and deleting it early would leave the streamed door with no way
forward if this call fails.

- [ ] **Step 3: Test, typecheck, commit**

---

### Task 6: Docs, verification, merge, changelog

- [ ] **Step 1: Docs, four files**

`apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md` and `apps/web/src/docs/0.1.0/facilities.md`.
Say that going back to Mapping and forward again re-checks the file already uploaded, and that only
a different file needs uploading again. Add the CLI command to the CLI reference if that file lists
the others.

- [ ] **Step 2: Full gate**

`pnpm turbo run test --concurrency=4`. Never through `tail`.

- [ ] **Step 3: Live check against real Postgres**

This is the step that matters most in this plan, because pg-mem cannot show the race in Task 1.

Upload a real multi-thousand-row register through the streamed door, reach Review, go back to
Mapping, change a column map entry, go forward, and confirm the run re-validated against the stored
blob with no second upload. Watch the run's status move `awaiting_confirmation` to `queued` to
`validating`.

Then double-click the forward action and confirm exactly one validate is queued.

- [ ] **Step 4: Merge, push, confirm the origin SHA, regenerate the changelog after the merge**

---

## What this plan does not do

- **No worker change.** The worker already claims `queued` runs; this plan makes runs queued.
- **No migration.** `status` is unconstrained text and `options` is jsonb.
- **No change to what a validate computes.** Only which options it computes it under.
- **It does not remove the re-upload path** until Task 5 Step 2 is proven live. Deleting the fallback
  before the replacement is proven would leave the streamed door with no way forward on a failure.
