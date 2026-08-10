import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFacilityImportRunStore, referenceCapture, type InternalSchema, type FacilityImportRunStore } from '@openldr/db';
import { importFacilities } from './facility-import';
import { createFacilityImportWorker } from './facility-import-worker';

const SYSTEM = 'urn:tz:hfr';
const KEY = 'facility-import/tz-hfr/one.csv';
const CSV = 'national_code,name\n100,Dodoma Regional Referral\n';
// Measured trigger from the route's own suite: csv-parse throws SYNCHRONOUSLY on this rather than
// returning a result, so it exercises the REAL failure path of the real `importFacilities` — no
// stub stands in for the one function this worker exists to call.
const UNTERMINATED_QUOTE = 'national_code,name\n100,"Dodoma Regional\n101,Kongwa\n';

const fakeLogger = () => ({ info: vi.fn(), error: vi.fn() });

const upload = (blobKey = KEY) => ({
  nationalSystem: SYSTEM, sourceFormat: 'csv' as const, blobKey,
  fileHash: 'h1', byteSize: CSV.length, options: { nationalSystem: SYSTEM },
});

/** A blob store holding one object, with a hook that runs as the worker opens the stream — the
 *  natural seam for "the operator cancels while the file is being validated" without stubbing
 *  `importFacilities` itself. */
function fakeBlob(body: string, onGet?: (key: string) => Promise<void> | void) {
  return {
    getStream: vi.fn(async (key: string) => {
      await onGet?.(key);
      return Readable.from([Buffer.from(body, 'utf8')]);
    }),
    delete: vi.fn(async () => {}),
  };
}

async function harness(body: string, onGet?: (key: string) => Promise<void> | void) {
  const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
  const runs: FacilityImportRunStore = createFacilityImportRunStore(db);
  const blob = fakeBlob(body, onGet);
  const logger = fakeLogger();
  const worker = createFacilityImportWorker({
    runs, blob, importDeps: { db, capture: referenceCapture }, intervalMs: 10_000, logger,
  });
  return { db, runs, blob, logger, worker };
}

const rowFor = (db: Kysely<InternalSchema>, id: string) =>
  db.selectFrom('facility_import_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

const registryRows = (db: Kysely<InternalSchema>) =>
  db.selectFrom('facility_registry').selectAll().execute();

describe('createFacilityImportWorker — validate phase', () => {
  it('validates a queued run and parks it at awaiting_confirmation with a real summary', async () => {
    const { db, runs, worker } = await harness(CSV);
    const run = await runs.startUpload(upload());

    await worker.tickOnce();
    await worker.stop();

    const after = await runs.get(run.id);
    expect(after?.status).toBe('awaiting_confirmation');
    // A REAL summary from the same `importFacilities` the inline route calls — the row would be
    // created, and a validate writes NOTHING.
    expect(after?.summary).toMatchObject({
      parsed: 1, skipped: 0, blocked: false, create: 1, changed: 0, unchanged: 0,
      written: { created: 0, updated: 0, retired: 0 },
      runId: run.id,
    });
    // The watermark an apply will compare against; and the phase the operator sees while it runs.
    expect(after?.previewedAt).not.toBeNull();
    // Progress really is reported, and the phase the operator is left looking at is the one that
    // actually finished — not the one that was running when the status flipped.
    expect(after?.phase).toBe('validated');
    expect(await registryRows(db)).toHaveLength(0);
    // Still owns the register while the operator decides — a second upload must not race the confirm.
    expect((await rowFor(db, run.id)).active_key).toBe(SYSTEM);
  });

  it('a cancel requested before the summary is written leaves the run cancelled and writes nothing', async () => {
    let runs!: FacilityImportRunStore;
    let runId = '';
    // Requested AFTER the claim (so the claim-time check has already passed) and BEFORE
    // `importFacilities` returns — the phase boundary the worker must observe.
    const h = await harness(CSV, async () => { await runs.requestCancel(runId); });
    runs = h.runs;
    const run = await runs.startUpload(upload());
    runId = run.id;

    await h.worker.tickOnce();
    await h.worker.stop();

    const after = await runs.get(run.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.summary).toBeNull();
    expect(after?.previewedAt).toBeNull();
    expect(await registryRows(h.db)).toHaveLength(0);
    // A terminal run must not hold the register — otherwise a cancel locks it out for good.
    expect((await rowFor(h.db, run.id)).active_key).toBeNull();
    // The stored file will never be applied now, so it is not left behind.
    expect(h.blob.delete).toHaveBeenCalledWith(KEY);
  });

  it('a cancel requested while the run is still queued is honoured at the claim, unread', async () => {
    const { runs, blob, worker } = await harness(CSV);
    const run = await runs.startUpload(upload());
    await runs.requestCancel(run.id);

    await worker.tickOnce();
    await worker.stop();

    expect((await runs.get(run.id))?.status).toBe('cancelled');
    // Not merely cancelled eventually — the file is never even read.
    expect(blob.getStream).not.toHaveBeenCalled();
  });

  it('a throwing importFacilities leaves the run failed with its own message and releases the register', async () => {
    const { db, runs, blob, worker } = await harness(UNTERMINATED_QUOTE);
    const run = await runs.startUpload(upload());

    // The message the SAME call produces standalone, so this pins "the parser's own text" without
    // hardcoding csv-parse's wording.
    const thrown = await importFacilities({ db, capture: referenceCapture }, UNTERMINATED_QUOTE, { nationalSystem: SYSTEM })
      .then(() => null, (e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(thrown).toBeTruthy();

    await expect(worker.tickOnce()).resolves.toBeUndefined();
    await worker.stop();

    const after = await runs.get(run.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toBe(thrown);
    expect(await registryRows(db)).toHaveLength(0);
    expect((await rowFor(db, run.id)).active_key).toBeNull();
    // Retained, unlike a cancel: the operator asked for this file to be imported and the object is
    // the only evidence of what was actually uploaded.
    expect(blob.delete).not.toHaveBeenCalled();
  });

  it('fails a queued run that carries no blob key rather than throwing out of the tick', async () => {
    // Not reachable through `startUpload` (which always writes one) — but `blobKey` is nullable on
    // the row, so the worker must answer for the case rather than crash the tick.
    const { db, runs, worker } = await harness(CSV);
    await db.insertInto('facility_import_runs').values({
      id: 'fir_nokey', national_system: SYSTEM, source_format: 'csv', file_hash: 'h', byte_size: 1,
      status: 'queued', options: JSON.stringify({ nationalSystem: SYSTEM }), active_key: SYSTEM,
    } as never).execute();

    await expect(worker.tickOnce()).resolves.toBeUndefined();
    await worker.stop();

    const after = await runs.get('fir_nokey');
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/blob/i);
    expect((await rowFor(db, 'fir_nokey')).active_key).toBeNull();
  });

  it('tickOnce with an empty queue is a no-op', async () => {
    const { db, blob, logger, worker } = await harness(CSV);

    await expect(worker.tickOnce()).resolves.toBeUndefined();
    await worker.stop();

    expect(blob.getStream).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(await registryRows(db)).toHaveLength(0);
  });

  it('crash recovery: a run left validating at construction is failed and releases its register', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const runs = createFacilityImportRunStore(db);
    const run = await runs.startUpload(upload());
    await runs.claimNext('queued', 'validating'); // a process killed mid-validate

    const worker = createFacilityImportWorker({
      runs, blob: fakeBlob(CSV), importDeps: { db, capture: referenceCapture },
      intervalMs: 10_000, logger: fakeLogger(),
    });
    await worker.stop(); // stop() awaits the crash-recovery handle

    const after = await runs.get(run.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/restart/i);
    expect((await rowFor(db, run.id)).active_key).toBeNull();
  });

  it('stop() genuinely AWAITS the crash-recovery handle rather than merely firing it', async () => {
    // Same construction as facility-job-worker.test.ts's: without a real timer-backed delay the
    // plain recovery test above passes whether or not stop() awaits, because enough microtask turns
    // elapse anyway. Delaying `failStaleRunning` makes the ordering deterministic.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const runs = createFacilityImportRunStore(db);
    const run = await runs.startUpload(upload());
    await runs.claimNext('queued', 'validating');

    const delayedRuns: FacilityImportRunStore = {
      ...runs,
      failStaleRunning: (error: string) =>
        new Promise((resolve) => setTimeout(() => resolve(runs.failStaleRunning(error)), 30)),
    };
    const worker = createFacilityImportWorker({
      runs: delayedRuns, blob: fakeBlob(CSV), importDeps: { db, capture: referenceCapture },
      intervalMs: 10_000, logger: fakeLogger(),
    });
    await worker.stop();

    expect((await runs.get(run.id))?.status).toBe('failed');
  });
});
