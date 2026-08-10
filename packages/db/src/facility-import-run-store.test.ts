import { describe, it, expect } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { makeMigratedDb, makeMigratedDbWithMem } from './migrations/internal/test-helpers';
import { createFacilityImportRunStore } from './facility-import-run-store';
import { ALL_RUN_STATES, RUNNING_RUN_STATES, APPLY_PHASE, type FacilityImportRunStatus } from './facility-import-run-states';
import type { InternalSchema } from './schema/internal';

const base = { nationalSystem: 'urn:tz:hfr', sourceFormat: 'csv' as const, fileHash: 'h1', byteSize: 42, options: {} };
const upload = { ...base, blobKey: 'blob/tz/1.csv' };

/** The stored row, not the mapped run — `active_key` is deliberately NOT on `FacilityImportRun`, so
 *  every "does this run still hold the register?" assertion has to read the column itself. */
const row = (db: Kysely<InternalSchema>, id: string) =>
  db.selectFrom('facility_import_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

/** Puts a run into a state no store method mints yet (`failStaleRunning`'s inputs, a terminal run
 *  still holding its key). Every row takes a DISTINCT national system so the unique `active_key`
 *  index (migration 080) permits them to coexist. */
const insertRun = (db: Kysely<InternalSchema>, id: string, status: FacilityImportRunStatus) =>
  db.insertInto('facility_import_runs').values({
    id, national_system: `urn:sys:${id}`, source_format: 'csv', file_hash: 'h', byte_size: 1,
    status, options: JSON.stringify({}), active_key: `urn:sys:${id}`,
  } as never).execute();

describe('createFacilityImportRunStore', () => {
  it('startPreview leaves previewedAt null; completePreview sets it and the summary', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startPreview(base);
    expect(run.previewedAt).toBeNull();
    expect(run.status).toBe('previewed');

    const done = await store.completePreview(run.id, { create: 3 });
    expect(done.previewedAt).not.toBeNull();
    expect(done.summary).toEqual({ create: 3 });
  });

  it('refuses a second active run for the same national system', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    await store.startPreview(base);
    await expect(store.startPreview(base)).rejects.toThrow(/already/i);
  });

  it('a finished run frees the national system for the next import', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const first = await store.startPreview(base);
    await store.finishApply(first.id, 'applied', { summary: { create: 1 } });
    const second = await store.startPreview(base);
    expect(second.id).not.toBe(first.id);
  });

  it('list orders newest first with a unique tiebreaker', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const a = await store.startPreview(base);
    await store.finishApply(a.id, 'applied', {});
    const b = await store.startPreview({ ...base, fileHash: 'h2' });
    await store.finishApply(b.id, 'applied', {});
    const rows = await store.list('urn:tz:hfr');
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  // ── A2b Task 2: the surface the background worker claims and drives a run through ──

  it('startUpload mints a queued run carrying the blob key and holding the register', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);

    expect(run.status).toBe('queued');
    expect(run.blobKey).toBe('blob/tz/1.csv');
    // No preview has RUN yet, so there is no watermark and nothing is classified.
    expect(run.previewedAt).toBeNull();
    expect(run.summary).toBeNull();
    // Holding `active_key` is what makes the register exclusive; without it two uploads race.
    expect((await row(db, run.id)).active_key).toBe('urn:tz:hfr');
  });

  it('startUpload refuses a second run while one already holds the register', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    await store.startUpload(upload);
    await expect(store.startUpload(upload)).rejects.toThrow(/already/i);
  });

  it('claimNext moves exactly one row; a second claim of the same state gets null', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);

    const claimed = await store.claimNext('queued', 'validating');
    expect(claimed?.id).toBe(run.id);
    expect(claimed?.status).toBe('validating');
    expect(claimed?.startedAt).not.toBeNull();
    expect(await store.claimNext('queued', 'validating')).toBeNull();

    // ⛔ A claim must NOT release `active_key` — unlike `facility-job-store.claimNext`, which clears
    // it deliberately. Here a RUNNING run is precisely when a new upload must be refused, and the
    // key is the only thing that refuses it.
    expect((await row(db, run.id)).active_key).toBe('urn:tz:hfr');
  });

  it('claimNext returns null when nothing is in the requested state', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    await store.startUpload(upload); // queued, not confirmed

    // A2b Task 6 narrowed `claimNext`'s source type to the two phase heads, so this asks for the
    // APPLY head rather than the parked state it used to name. The property under test is unchanged
    // — "a state nothing is in yields null" — and `awaiting_confirmation` was only ever standing in
    // for "some state other than queued"; it is now, correctly, not a claimable state at all.
    expect(await store.claimNext('confirmed', 'applying')).toBeNull();
  });

  it('claimNext advances to the next candidate when a concurrent claimer wins the guarded UPDATE first', async () => {
    // Stages the race the `and status = ?` guard exists for: something else claims the head-of-queue
    // row between claimNext's own SELECT and its own UPDATE. A claimer that trusts its SELECT would
    // DOUBLE-CLAIM that row — two workers validating one register's file at once.
    const { db, mem } = await makeMigratedDbWithMem();
    const store = createFacilityImportRunStore(db as Kysely<InternalSchema>);
    await store.startUpload(upload);
    await store.startUpload({ ...upload, nationalSystem: 'urn:tz:other', blobKey: 'blob/tz/2.csv' });

    // Same ordering claimNext itself queries by, so this really is "the row it will try first".
    const head = await db.selectFrom('facility_import_runs').select('id')
      .where('status', '=', 'queued')
      .orderBy('created_at', 'asc').orderBy('id', 'asc')
      .limit(1).executeTakeFirstOrThrow();

    let stolen = false;
    mem.public.interceptQueries((sqlText: string) => {
      if (!stolen && /update facility_import_runs/i.test(sqlText) && sqlText.includes(head.id)) {
        stolen = true; // guard: the steal query below is itself an UPDATE matching head.id
        mem.public.none(`update facility_import_runs set status='validating' where id='${head.id}'`);
      }
      return null; // fall through to the real query, which the steal above now makes match 0 rows
    });

    const claimed = await store.claimNext('queued', 'validating');

    expect(stolen).toBe(true); // the guarded UPDATE really was issued
    expect(claimed).not.toBeNull();
    expect(claimed!.id).not.toBe(head.id);
    expect(claimed!.status).toBe('validating');
  });

  it('claimNext breaks a created_at tie by id, not by insertion order', async () => {
    // Two rows with a LITERAL identical created_at (not merely close), inserted in the OPPOSITE of id
    // order — so without the `id` tiebreaker pg-mem's stable scan order would answer 'fir_bbb'.
    // `created_at` defaults to now(), which is TRANSACTION time in Postgres, so this tie is real.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const tie = new Date('2026-01-01T00:00:00Z');
    for (const id of ['fir_bbb', 'fir_aaa']) {
      await db.insertInto('facility_import_runs').values({
        id, national_system: `urn:sys:${id}`, source_format: 'csv', file_hash: 'h', byte_size: 1,
        status: 'queued', options: JSON.stringify({}), active_key: `urn:sys:${id}`, created_at: tie,
      } as never).execute();
    }

    expect((await store.claimNext('queued', 'validating'))?.id).toBe('fir_aaa');
  });

  it('updateProgress writes the phase and leaves processed/total untouched when omitted', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);

    await store.updateProgress(run.id, { phase: 'parsing', processed: 120, total: 500 });
    await store.updateProgress(run.id, { phase: 'classifying' });

    const after = await store.get(run.id);
    expect(after?.phase).toBe('classifying');
    expect(after?.processed).toBe(120);
    expect(after?.total).toBe(500);
  });

  it('requestCancel flags a live run, and reports not-found / already-terminal otherwise', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);

    expect(await store.requestCancel(run.id)).toBe('requested');
    expect((await store.get(run.id))?.cancelRequested).toBe(true);
    // Flagging does not itself stop anything — the worker observes the flag.
    expect((await store.get(run.id))?.status).toBe('queued');

    expect(await store.requestCancel('fir_nope')).toBe('not-found');

    await store.finish(run.id, 'cancelled', { error: 'cancelled by operator' });
    expect(await store.requestCancel(run.id)).toBe('already-terminal');
  });

  it('⛔ requestCancel on a state NO worker will ever claim cancels outright, releasing the register', async () => {
    // A2b Task 4's carry-forward. `previewed` is not a `claimNext` source state and is not RUNNING,
    // so nothing will ever read `cancel_requested` on it: flagging and reporting 'requested' told the
    // operator a live run had been asked to stop while the run sat there holding `active_key`, its
    // flag inert forever. The cancel is therefore EFFECTED here instead of merely recorded.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startPreview(base); // the inline A2a path's state

    expect(await store.requestCancel(run.id)).toBe('cancelled');

    const stored = await row(db, run.id);
    expect(stored.status).toBe('cancelled');
    expect(stored.active_key).toBeNull();
    // The register really is free — the next upload succeeds instead of "already in progress".
    await expect(store.startUpload(upload)).resolves.toMatchObject({ status: 'queued' });
  });

  it('⛔ requestCancel on a run PARKED for the operator cancels outright — the Task 4/5 carry-forward', async () => {
    // A2b Task 6. `awaiting_confirmation` is the state EVERY background run parks in, and the one an
    // operator is most likely to cancel from — and until this task it was in `CLAIMABLE_RUN_STATES`
    // purely because `claimNext`'s TYPE named it. No worker has ever claimed it (Task 5's apply
    // claims `confirmed` precisely so an undecided run is never written), so the flag was inert: the
    // operator was told 'requested' while the register stayed locked behind a run nothing would ever
    // look at again. Deriving the set from the phase heads is what makes this branch reachable.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);
    await store.claimNext('queued', 'validating');
    expect(await store.completeValidation(run.id, { parsed: 1 })).toBe(true);
    expect((await store.get(run.id))?.status).toBe('awaiting_confirmation');

    expect(await store.requestCancel(run.id)).toBe('cancelled');

    const stored = await row(db, run.id);
    expect(stored.status).toBe('cancelled');
    expect(stored.active_key).toBeNull();
    // Not merely marked — the flag path was NOT taken, so nothing is left waiting to be observed.
    expect(stored.cancel_requested).toBe(false);
    // And the register is genuinely free again, which is the whole point.
    await expect(store.startUpload(upload)).resolves.toMatchObject({ status: 'queued' });
  });

  it('requestCancel only FLAGS a run a worker is mid-flight on — it cannot interrupt one', async () => {
    // The other half of the branch above: `validating` IS worker-observed, so the flag is the whole
    // mechanism and the run must keep both its status and its register until the worker acts.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);
    await store.claimNext('queued', 'validating');

    expect(await store.requestCancel(run.id)).toBe('requested');

    const stored = await row(db, run.id);
    expect(stored.status).toBe('validating');
    expect(stored.active_key).toBe('urn:tz:hfr');
    expect((await store.get(run.id))?.cancelRequested).toBe(true);
  });

  it('completeValidation parks a validating run for the operator, with the watermark and summary', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);
    await store.claimNext('queued', 'validating');

    expect(await store.completeValidation(run.id, { create: 2 })).toBe(true);

    const after = await store.get(run.id);
    expect(after?.status).toBe('awaiting_confirmation');
    expect(after?.summary).toEqual({ create: 2 });
    // The watermark an apply will compare `facility_registry.updated_at` against — stamped by the
    // DATABASE clock in this same statement, exactly as `completePreview` does it.
    expect(after?.previewedAt).not.toBeNull();
    // Still holds the register: the operator has not decided yet, and a second upload landing now
    // would race the confirm.
    expect((await row(db, run.id)).active_key).toBe('urn:tz:hfr');
  });

  it('⛔ completeValidation does NOT resurrect a run that left `validating` under the worker', async () => {
    // Another process's boot sweep (`failStaleRunning`) fails the run and RELEASES its key. An
    // unguarded write here would move that run to `awaiting_confirmation` holding no `active_key` —
    // a run the apply phase would happily claim while a second upload owns the same register.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);
    await store.claimNext('queued', 'validating');
    await store.failStaleRunning('another process restarted');

    expect(await store.completeValidation(run.id, { create: 2 })).toBe(false);

    const stored = await row(db, run.id);
    expect(stored.status).toBe('failed');
    expect(stored.active_key).toBeNull();
    expect((await store.get(run.id))?.summary).toBeNull();
  });

  // ── A2b Task 5: confirm ───────────────────────────────────────────────────────────────────────
  it('confirm hands a parked run to the apply queue, merging the operator\'s options', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload({ ...upload, options: { nationalSystem: 'urn:tz:hfr' } });
    await store.claimNext('queued', 'validating');
    await store.completeValidation(run.id, { create: 2 });

    expect(await store.confirm(run.id, 'awaiting_confirmation', {
      nationalSystem: 'urn:tz:hfr', onConflict: 'overwrite', allowMalformedRows: true,
    })).toBe(true);

    const after = await store.get(run.id);
    // ⛔ `APPLY_PHASE.from`, the state the worker claims — NOT `awaiting_confirmation`, which the
    // worker deliberately never claims. This transition IS the operator's authorisation.
    expect(after?.status).toBe(APPLY_PHASE.from);
    expect(after?.options).toEqual({
      nationalSystem: 'urn:tz:hfr', onConflict: 'overwrite', allowMalformedRows: true,
    });
    // The watermark the validate stamped survives the confirm — it is what the apply compares
    // `facility_registry.updated_at` against.
    expect(after?.previewedAt).not.toBeNull();
    // Still holds the register: the apply has not run yet, and a second upload landing now would
    // race it.
    expect((await row(db, run.id)).active_key).toBe('urn:tz:hfr');
  });

  it('⛔ confirm does NOT move a run that left the status the caller observed', async () => {
    // The route READ the status in an earlier statement. Between that read and this write the run can
    // be superseded by a newer upload (which releases `active_key`), and an unconditional write keyed
    // on the id alone would then queue an apply for a register this run no longer owns.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);
    await store.claimNext('queued', 'validating');
    await store.completeValidation(run.id, { create: 2 });
    await store.supersede(run.id, 'awaiting_confirmation', 'superseded by a newer upload');

    expect(await store.confirm(run.id, 'awaiting_confirmation', { nationalSystem: 'urn:tz:hfr' })).toBe(false);

    const stored = await row(db, run.id);
    expect(stored.status).toBe('failed');
    expect(stored.active_key).toBeNull();
  });

  it("⛔ finish('cancelled') releases the register — a terminal run must not hold active_key", async () => {
    // `TERMINAL_RUN_STATES` states this as a rule and enforces none of it: `finishApply` covers only
    // applied/failed. A cancelled run that kept its key would lock the national system out of every
    // future import with no operator path back.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const first = await store.startUpload(upload);

    await store.finish(first.id, 'cancelled', { error: 'cancelled by operator' });

    const stored = await row(db, first.id);
    expect(stored.status).toBe('cancelled');
    expect(stored.active_key).toBeNull();
    expect((await store.get(first.id))?.error).toBe('cancelled by operator');
    // The register really is free: the next upload succeeds rather than throwing "already in progress".
    await expect(store.startUpload(upload)).resolves.toMatchObject({ status: 'queued' });
  });

  it('failStaleRunning fails exactly the RUNNING states, releases their keys, and returns the count', async () => {
    // Built from `ALL_RUN_STATES` so a state added later is covered here automatically: the
    // expectation is derived from `RUNNING_RUN_STATES`, never from a list re-spelled in this test.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    for (const status of ALL_RUN_STATES) await insertRun(db, `fir_${status}`, status);

    const failed = await store.failStaleRunning('worker restarted');

    expect(failed).toBe(RUNNING_RUN_STATES.size);
    for (const status of ALL_RUN_STATES) {
      const stored = await row(db, `fir_${status}`);
      if (RUNNING_RUN_STATES.has(status)) {
        expect(stored.status).toBe('failed');
        expect(stored.error).toBe('worker restarted');
        expect(stored.active_key).toBeNull();
      } else {
        expect(stored.status).toBe(status);
        expect(stored.active_key).toBe(`urn:sys:fir_${status}`);
      }
    }
  });

  // ⛔ WHOLE-BRANCH REVIEW C1, half 2. `failStaleRunning` is not scoped to a process — any process
  // holding this database can run it — so without an age bound it releases the `active_key` of an
  // apply another process is INSIDE, and a second upload can then start a second apply over the same
  // national register. `minAgeMs` is the bound; `started_at` (stamped by `claimNext`, in the same
  // UPDATE that writes the RUNNING status) is what it measures.
  it('⛔ failStaleRunning spares a freshly-claimed run and still fails one that outlived the lease', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);

    // Two runs, DISTINCT national systems so the unique `active_key` index permits both.
    const fresh = await store.startUpload(upload);
    const old = await store.startUpload({ ...upload, nationalSystem: 'urn:tz:old', fileHash: 'h2' });
    await store.claimNext('queued', 'validating');
    await store.claimNext('queued', 'validating');
    expect((await store.get(fresh.id))?.status).toBe('validating');
    expect((await store.get(old.id))?.status).toBe('validating');
    // Only `claimNext` writes `started_at`, so backdating it is the only way to age a run — and it is
    // exactly the state a process killed an hour ago leaves behind.
    await sql`update facility_import_runs set started_at = now() - interval '3600 seconds' where id = ${old.id}`.execute(db);

    const failed = await store.failStaleRunning('lease expired', 15 * 60 * 1000);

    expect(failed).toBe(1);
    // The live one is untouched AND still owns its register — releasing the key is the actual harm.
    const liveRow = await row(db, fresh.id);
    expect(liveRow.status).toBe('validating');
    expect(liveRow.error).toBeNull();
    expect(liveRow.active_key).toBe('urn:tz:hfr');
    const sweptRow = await row(db, old.id);
    expect(sweptRow.status).toBe('failed');
    expect(sweptRow.error).toBe('lease expired');
    expect(sweptRow.active_key).toBeNull();
  });

  // The `started_at IS NULL` half of the same predicate. `claimNext` always stamps it, so a RUNNING
  // row without one cannot have its age established — and a run whose age is unknown is exactly the
  // one no lease will ever release. Also what keeps the `ALL_RUN_STATES` sweep above (whose rows are
  // hand-inserted with no `started_at`) meaningful under a non-zero lease.
  it('failStaleRunning sweeps a RUNNING run with no started_at however long the lease is', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    await insertRun(db, 'fir_nostart', 'applying');

    expect(await store.failStaleRunning('lease expired', 24 * 60 * 60 * 1000)).toBe(1);
    expect((await row(db, 'fir_nostart')).status).toBe('failed');
  });

  it('supersede releases a run only while it is still in the status the caller observed', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);

    expect(await store.supersede(run.id, 'queued', 'superseded by a newer preview')).toBe(true);
    const stored = await row(db, run.id);
    expect(stored.status).toBe('failed');
    expect(stored.error).toBe('superseded by a newer preview');
    expect(stored.active_key).toBeNull();
  });

  it('⛔ supersede does NOT touch a run a worker claimed after the caller read it', async () => {
    // The lost update this method exists to prevent: the supersede gate reads `queued`, a worker
    // claims the row to `validating`, and an unconditional write would then mark it failed and null
    // `active_key` under a LIVE worker.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startUpload(upload);
    const observed = run.status; // what the gate saw
    await store.claimNext('queued', 'validating'); // the worker gets there first

    expect(await store.supersede(run.id, observed, 'superseded by a newer preview')).toBe(false);
    const stored = await row(db, run.id);
    expect(stored.status).toBe('validating');
    expect(stored.error).toBeNull();
    expect(stored.active_key).toBe('urn:tz:hfr');
  });
});
