import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { type Kysely, sql } from 'kysely';
import type { AuditEventInput } from '@openldr/audit';
import { makeMigratedDb } from '@openldr/db/testing';
import {
  createFacilityImportRunStore, referenceCapture, APPLY_PHASE,
  type InternalSchema, type FacilityImportRunStore,
} from '@openldr/db';
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
function fakeBlob(body: string | (() => string), onGet?: (key: string) => Promise<void> | void) {
  return {
    getStream: vi.fn(async (key: string) => {
      await onGet?.(key);
      // A2b Task 5: a THUNK is accepted so one harness can serve a different file to a second run —
      // the apply-phase conflict tests upload a register, then upload an edited one over the same db.
      return Readable.from([Buffer.from(typeof body === 'string' ? body : body(), 'utf8')]);
    }),
    delete: vi.fn(async () => {}),
  };
}

async function harness(
  body: string | (() => string),
  onGet?: (key: string) => Promise<void> | void,
  opts?: { maxBufferBytes?: number },
) {
  const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
  const runs: FacilityImportRunStore = createFacilityImportRunStore(db);
  const blob = fakeBlob(body, onGet);
  const logger = fakeLogger();
  // A2b Task 5: an applied import is audited (`facility.import`, matching the inline route's record),
  // so the worker takes an audit store. Recorded into an array here rather than stubbed away — the
  // apply tests assert on the entry.
  const audited: AuditEventInput[] = [];
  const audit = { record: vi.fn(async (e: AuditEventInput) => { audited.push(e); return e as never; }) };
  const worker = createFacilityImportWorker({
    runs, blob, importDeps: { db, capture: referenceCapture }, intervalMs: 10_000, logger, audit,
    ...(opts?.maxBufferBytes === undefined ? {} : { maxBufferBytes: opts.maxBufferBytes }),
  });
  return { db, runs, blob, logger, worker, audit, audited };
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

  // ⛔ THE UPLOAD'S `completeRelease` DECLARATION HAS TO SURVIVE INTO THE VALIDATE. Absence is
  // classified during THIS phase, off `run.options` (see `validateOptions`' spread), so a
  // declaration that stopped at the route would leave every background run reporting `absent: null`
  // — NOT EVALUATED — however complete the file actually is, and the background door could not
  // express two-tier retirement at all. Its inline twin lives in facility-import.test.ts ("counts
  // absent rows when the release IS declared complete"); what this pins is the WIRING between them.
  it('⛔ counts absent rows for an upload that declared a complete release — the declaration reaches importFacilities through run.options', async () => {
    const TWO_ROWS = 'national_code,name\n100,Dodoma Regional Referral\n200,Kongwa District\n';
    let body = TWO_ROWS;
    const h = await harness(() => body);

    // Register both facilities, so there is something for the next file to be silent ABOUT. Absence
    // is a claim about the registry, not about the file, and it cannot be measured against nothing.
    const first = await h.runs.startUpload(upload());
    await h.worker.tickOnce();
    expect(await h.runs.confirm(first.id, 'awaiting_confirmation', { nationalSystem: SYSTEM })).toBe(true);
    await h.worker.tickOnce();
    expect((await h.runs.get(first.id))?.status).toBe('applied');
    expect(await registryRows(h.db)).toHaveLength(2);

    // A second upload — declared complete, and mentioning only one of the two.
    body = CSV;
    const run = await h.runs.startUpload({
      ...upload(), options: { nationalSystem: SYSTEM, completeRelease: true },
    });
    await h.worker.tickOnce();
    await h.worker.stop();

    const after = await h.runs.get(run.id);
    expect(after?.status).toBe('awaiting_confirmation');
    const summary = after?.summary as {
      absent: number | null; samples: { absent: { nationalCode: string | null }[] };
      written: { retired: number };
    };
    // ⛔ 1, and NOT null. `null` is exactly what this reports when the declaration never arrives, so
    // this assertion is the whole wiring: route → run.options → validateOptions → importFacilities.
    expect(summary.absent).toBe(1);
    expect(summary.samples.absent).toMatchObject([{ nationalCode: '200' }]);
    // ⛔ Declaring a complete release RETIRES NOTHING. A validate writes nothing at all, and
    // `onAbsent` defaults to `'report'` regardless — only the operator's confirm can raise it.
    expect(summary.written.retired).toBe(0);
    expect(await registryRows(h.db)).toHaveLength(2);
  });

  it('an upload that declared NOTHING still reports absence as NOT EVALUATED, never as zero', async () => {
    // The counter-assertion for the test above: same registry, same one-row file, no declaration.
    // `null` here is the honest answer — the question was never asked — and a `0` would be a
    // measurement nobody took, the FAC-P1-03 defect this whole workstream exists to remove.
    const TWO_ROWS = 'national_code,name\n100,Dodoma Regional Referral\n200,Kongwa District\n';
    let body = TWO_ROWS;
    const h = await harness(() => body);

    const first = await h.runs.startUpload(upload());
    await h.worker.tickOnce();
    expect(await h.runs.confirm(first.id, 'awaiting_confirmation', { nationalSystem: SYSTEM })).toBe(true);
    await h.worker.tickOnce();
    expect(await registryRows(h.db)).toHaveLength(2);

    body = CSV;
    const run = await h.runs.startUpload(upload());
    await h.worker.tickOnce();
    await h.worker.stop();

    expect((await h.runs.get(run.id))?.summary).toMatchObject({ absent: null });
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

  it('refuses a register larger than it will buffer, failing the run instead of holding the file', async () => {
    // ⛔ `importFacilities` takes a STRING, so the worker reads the whole file onto the heap of the
    // API process it runs inside. Without a ceiling one authenticated `facilities.manage` client
    // could OOM the server, and anything over Node's maximum string length would die in the decode
    // with a message no operator can act on. The limit is injected low here for the same reason the
    // upload route's 413 test lowers its config value — nothing in a unit test can push past 64 MiB.
    const big = `national_code,name\n${'100,Dodoma Regional Referral\n'.repeat(40)}`;
    const { db, runs, blob, worker } = await harness(big, undefined, { maxBufferBytes: 64 });
    const run = await runs.startUpload(upload());

    await expect(worker.tickOnce()).resolves.toBeUndefined();
    await worker.stop();

    const after = await runs.get(run.id);
    expect(after?.status).toBe('failed');
    // The number in the message is the ceiling actually in force, not a hardcoded constant that
    // could drift from it.
    expect(after?.error).toContain('64-byte ceiling');
    expect(after?.error).toMatch(/not validated/i);
    // Nothing was parsed and nothing was written — the refusal happens before `importFacilities`.
    expect(await registryRows(db)).toHaveLength(0);
    // The register is released, so the operator can upload a smaller file without a supersede.
    expect((await rowFor(db, run.id)).active_key).toBeNull();
    // Retained like any other failure: the object is the evidence of what was actually sent.
    expect(blob.delete).not.toHaveBeenCalled();
  });

  it('accepts a register exactly AT the ceiling — the limit is a maximum, not a margin', async () => {
    // Guards the boundary in the other direction: an off-by-one here would refuse files the config
    // says are allowed, which is the same defect wearing the opposite sign.
    const { db, runs, worker } = await harness(CSV, undefined, { maxBufferBytes: Buffer.byteLength(CSV, 'utf8') });
    const run = await runs.startUpload(upload());

    await worker.tickOnce();
    await worker.stop();

    expect((await runs.get(run.id))?.status).toBe('awaiting_confirmation');
    expect(await registryRows(db)).toHaveLength(0);
  });

  it('parks a BLOCKED file at awaiting_confirmation rather than failing it', async () => {
    // ⛔ Pinned so the apply phase cannot quietly change it: a blocked file is a real, reportable
    // reconciliation result the operator is entitled to SEE, not a validation crash. The confirm
    // path (Task 5) is what must refuse to apply it — and must do so by reading `summary.blocked`,
    // which `importFacilities` reports, rather than re-deriving the question a fourth time.
    const duplicateColumns = 'national_code,name,name\n100,Dodoma,Dodoma\n';
    const { db, runs, worker } = await harness(duplicateColumns);
    const run = await runs.startUpload(upload());

    await worker.tickOnce();
    await worker.stop();

    const after = await runs.get(run.id);
    expect(after?.status).toBe('awaiting_confirmation');
    expect(after?.summary).toMatchObject({ blocked: true, blockedReason: 'duplicate-columns' });
    expect(await registryRows(db)).toHaveLength(0);
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

  it('⛔ never claims a run the operator has not confirmed — a parked run is left alone', async () => {
    // THE core guarantee of the two-phase flow. `awaiting_confirmation` is in `CLAIMABLE_RUN_STATES`
    // (a carry-forward Task 4 moved rather than removed), so nothing in the TYPES stops an apply
    // being claimed from it — only this worker's choice of `APPLY_PHASE.from` does. A worker that
    // claimed the parked state would write a national register the operator never approved.
    const { db, runs, blob, worker } = await harness(CSV);
    const run = await runs.startUpload(upload());

    await worker.tickOnce();                       // validate → awaiting_confirmation
    expect((await runs.get(run.id))?.status).toBe('awaiting_confirmation');
    await worker.tickOnce();                       // …and again: there is nothing to claim
    await worker.stop();

    expect((await runs.get(run.id))?.status).toBe('awaiting_confirmation');
    // The file was read ONCE (by the validate). A second read would mean the apply had claimed it.
    expect(blob.getStream).toHaveBeenCalledTimes(1);
    expect(await registryRows(db)).toHaveLength(0);
    // Still parked, still holding its register, waiting for the operator.
    expect((await rowFor(db, run.id)).active_key).toBe(SYSTEM);
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

// ── A2b Task 5: the apply phase ────────────────────────────────────────────────────────────────
//
// The second claim. `POST /api/facilities/import/runs/:id/confirm` (apps/server) merges the
// operator's choices into the run's options and moves it `awaiting_confirmation` → `APPLY_PHASE.from`
// through `runs.confirm` — the SAME store call these tests make, so what is exercised here is
// exactly what the route hands the worker.

describe('createFacilityImportWorker — apply phase', () => {
  /** Upload → validate → confirm, leaving the run on the apply queue. Returns the run id. */
  async function uploadValidateConfirm(
    h: { runs: FacilityImportRunStore; worker: { tickOnce(): Promise<void> } },
    options: Record<string, unknown> = { nationalSystem: SYSTEM },
  ): Promise<string> {
    const run = await h.runs.startUpload(upload());
    await h.worker.tickOnce();
    expect((await h.runs.get(run.id))?.status).toBe('awaiting_confirmation');
    expect(await h.runs.confirm(run.id, 'awaiting_confirmation', options)).toBe(true);
    return run.id;
  }

  it('applies a confirmed run: the register is written, the run is applied, the key released', async () => {
    const h = await harness(CSV);
    const runId = await uploadValidateConfirm(h);

    await h.worker.tickOnce();
    await h.worker.stop();

    const after = await h.runs.get(runId);
    expect(after?.status).toBe('applied');
    // ⛔ `written` is what a statement actually wrote — the validate reported `written: {0,0,0}` for
    // this same file (see the validate suite above), so this is the whole difference the confirm made.
    expect(after?.summary).toMatchObject({
      parsed: 1, create: 1, changed: 0, unchanged: 0,
      written: { created: 1, updated: 0, retired: 0 },
      blocked: false, runId,
    });
    // The row really is in the registry, not merely counted.
    const rows = await registryRows(h.db);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Dodoma Regional Referral');
    // Terminal ⇒ the register is free for the next import.
    expect((await rowFor(h.db, runId)).active_key).toBeNull();
    expect(after?.phase).toBe('applied');
  });

  it('audits facility.import once, matching the inline route\'s record', async () => {
    const h = await harness(CSV);
    const runId = await uploadValidateConfirm(h, { nationalSystem: SYSTEM, allowMalformedRows: true });

    await h.worker.tickOnce();
    await h.worker.stop();

    expect(h.audited).toHaveLength(1);
    expect(h.audited[0]).toMatchObject({
      action: 'facility.import',
      entityType: 'facility',
      entityId: SYSTEM,
      metadata: {
        runId, nationalSystem: SYSTEM,
        allowUnknownColumns: false, allowMalformedRows: true,
        result: { written: { created: 1, updated: 0, retired: 0 } },
      },
    });
  });

  it('a validate that fails is never audited as an import', async () => {
    // The audit belongs to the WRITE. A run that only ever validated wrote nothing, so an entry here
    // would tell an operator a register was imported when it was not.
    const h = await harness(UNTERMINATED_QUOTE);
    await h.runs.startUpload(upload());

    await h.worker.tickOnce();
    await h.worker.stop();

    expect(h.audited).toEqual([]);
  });

  it('⛔ reports a row edited between the validate and the apply as a conflict, and skips it', async () => {
    // THE POINT OF THE TWO-PHASE FLOW. The watermark `completeValidation` stamped is what makes this
    // measurable at all: without it the apply reports `conflict: null` (NOT EVALUATED) and this row
    // is written as an ordinary `unchanged`/`changed`.
    let body = CSV;
    const h = await harness(() => body);

    // Run 1 — the register starts out holding this facility.
    const first = await uploadValidateConfirm(h);
    await h.worker.tickOnce();
    expect((await h.runs.get(first))?.status).toBe('applied');

    // Run 2 — uploaded and validated, so it carries a fresh watermark…
    body = CSV;
    const run = await h.runs.startUpload(upload());
    await h.worker.tickOnce();
    expect((await h.runs.get(run.id))?.status).toBe('awaiting_confirmation');

    // …and then somebody else edits the row before the operator confirms.
    //
    // ⛔ `now() + interval '1 second'`, not a plain `now()`: pg-mem's `now()` is real
    // millisecond-precision wall-clock time and two back-to-back calls land in the SAME millisecond
    // roughly half the time (measured), so a plain `now()` here races the watermark
    // `completeValidation` just stamped and would flake ~50% of the time. The same fix, for the same
    // measured reason, as the inline route's conflict tests in apps/server.
    await h.db.updateTable('facility_registry')
      .set({ updated_at: sql`now() + interval '1 second'` } as never)
      .where('national_code', '=', '100').execute();

    expect(await h.runs.confirm(run.id, 'awaiting_confirmation', { nationalSystem: SYSTEM })).toBe(true);
    await h.worker.tickOnce();
    await h.worker.stop();

    const after = await h.runs.get(run.id);
    expect(after?.status).toBe('applied');
    // ⛔ 1, and NOT null: the watermark reached `importFacilities`, so the question was ASKED. A null
    // here means the worker dropped `previewedAt` — conflicts NOT EVALUATED.
    expect((after?.summary as { conflict: number | null }).conflict).toBe(1);
    // The default policy is skip: the row somebody else touched is left exactly as they left it.
    expect(after?.summary).toMatchObject({ written: { created: 0, updated: 0, retired: 0 } });
  });

  it('writes the conflicting row when the operator confirms with onConflict: overwrite', async () => {
    // The mirror image of the test above — same setup, opposite outcome once the confirm carries the
    // explicit override. This is what makes the confirm's options load-bearing rather than recorded.
    let body = CSV;
    const h = await harness(() => body);

    const first = await uploadValidateConfirm(h);
    await h.worker.tickOnce();
    expect((await h.runs.get(first))?.status).toBe('applied');

    const RENAMED = 'national_code,name\n100,Dodoma Regional Referral Hospital\n';
    body = RENAMED;
    const run = await h.runs.startUpload(upload());
    await h.worker.tickOnce();

    await h.db.updateTable('facility_registry')
      .set({ updated_at: sql`now() + interval '1 second'` } as never)
      .where('national_code', '=', '100').execute();

    expect(await h.runs.confirm(run.id, 'awaiting_confirmation', {
      nationalSystem: SYSTEM, onConflict: 'overwrite',
    })).toBe(true);
    await h.worker.tickOnce();
    await h.worker.stop();

    const after = await h.runs.get(run.id);
    // Still COUNTED as a conflict — the operator must be told how many rows they overwrote, not have
    // the number vanish the moment they choose to act on it.
    expect((after?.summary as { conflict: number | null }).conflict).toBe(1);
    expect(after?.summary).toMatchObject({ written: { created: 0, updated: 1, retired: 0 } });
    const rows = await registryRows(h.db);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Dodoma Regional Referral Hospital');
  });

  it('a cancel requested before the apply is claimed writes nothing and releases the register', async () => {
    const h = await harness(CSV);
    const runId = await uploadValidateConfirm(h);
    // Requested while the run sits on the apply queue — the boundary the claim must observe.
    expect(await h.runs.requestCancel(runId)).toBe('requested');

    await h.worker.tickOnce();
    await h.worker.stop();

    const after = await h.runs.get(runId);
    expect(after?.status).toBe('cancelled');
    // ⛔ Nothing was written. A cancel honoured AFTER the write would be a lie the registry contradicts.
    expect(await registryRows(h.db)).toHaveLength(0);
    expect((await rowFor(h.db, runId)).active_key).toBeNull();
    // The stored file will never be applied now.
    expect(h.blob.delete).toHaveBeenCalledWith(KEY);
    // …and no audit: nothing was imported.
    expect(h.audited).toEqual([]);
  });

  it('publishes no row counts for a small apply — they would finish faster than they could be read', async () => {
    // A2b Task 7. MEASURED on real Postgres: 1 000 rows apply in 289 ms and 2 500 in 513 ms, so a
    // denominator here would flash past unread. `total` stays null and `processed` stays at its
    // column default rather than being written with numbers nobody can use.
    const h = await harness(CSV); // one row
    const runId = await uploadValidateConfirm(h);

    await h.worker.tickOnce();
    await h.worker.stop();

    expect((await h.runs.get(runId))?.status).toBe('applied');
    const stored = await rowFor(h.db, runId);
    expect(stored.total).toBeNull();
    expect(stored.processed).toBe(0);
    // The phase is still reported — a small apply is not silent, it is just uncounted.
    expect((await h.runs.get(runId))?.phase).toBe('applied');
  });

  it('⛔ publishes a denominator once an apply is big enough to be worth watching', async () => {
    // The other side of `PER_ROW_PROGRESS_MIN_ROWS` (5 000 rows ≈ 944 ms measured). Built at exactly
    // the threshold, because that is the boundary an off-by-one would move.
    const rows = Array.from({ length: 5000 }, (_, i) => `${1000 + i},Facility ${i}`).join('\n');
    const big = `national_code,name\n${rows}\n`;
    const h = await harness(big);
    const runId = await uploadValidateConfirm(h);
    // The gate reads the VALIDATE's own count, so pin that this run really is at the threshold —
    // otherwise a parser change could silently make this a small-apply test that still passed.
    expect((await h.runs.get(runId))?.summary).toMatchObject({ parsed: 5000 });

    await h.worker.tickOnce();
    await h.worker.stop();

    expect((await h.runs.get(runId))?.status).toBe('applied');
    const stored = await rowFor(h.db, runId);
    expect(stored.total).toBe(5000);
    // Closed by the count it was opened with: `parsed`, not `written` — an apply whose rows were
    // `unchanged` still processed all of them.
    expect(stored.processed).toBe(5000);
  }, 60_000);

  it('⛔ a cancel that arrives once the apply is under way reports applied, NOT cancelled', async () => {
    // A2b Task 6's honest semantics, at the layer that decides them. `cancel_requested` is observed
    // at PHASE BOUNDARIES and cannot interrupt the running transaction, so a cancel racing an apply
    // that is already reading its file loses — and the truthful answer is `applied`, because the
    // register really was written. Reporting `cancelled` here would tell an operator their national
    // register was untouched when it had just been rewritten, which is the single worst thing this
    // surface could say.
    let runs!: FacilityImportRunStore;
    let runId = '';
    let armed = false;
    // Fires as the APPLY opens the file — i.e. after the claim, mid-phase. The validate tick runs
    // first and must not trip it, hence `armed`.
    const h = await harness(CSV, async () => { if (armed) await runs.requestCancel(runId); });
    runs = h.runs;
    runId = await uploadValidateConfirm(h);
    armed = true;

    await h.worker.tickOnce();
    await h.worker.stop();

    const after = await h.runs.get(runId);
    expect(after?.status).toBe('applied');
    // The flag really was set — this is a genuine race that the apply won, not a cancel that never
    // arrived. Without this the test would pass even if `requestCancel` had silently done nothing.
    expect((await rowFor(h.db, runId)).cancel_requested).toBe(true);
    // And the write is real, which is what makes `applied` the honest answer.
    expect(await registryRows(h.db)).toHaveLength(1);
    expect(after?.summary).toMatchObject({ written: { created: 1, updated: 0, retired: 0 } });
    expect((await rowFor(h.db, runId)).active_key).toBeNull();
  });

  it('a throwing apply leaves the run failed with its own message and releases the register', async () => {
    // The file validated (the worker read a good CSV), then the stored object changed under it. The
    // apply must answer for that rather than crash the tick — and must release the register.
    let body = CSV;
    const h = await harness(() => body);
    const runId = await uploadValidateConfirm(h);
    body = UNTERMINATED_QUOTE;

    await expect(h.worker.tickOnce()).resolves.toBeUndefined();
    await h.worker.stop();

    const after = await h.runs.get(runId);
    expect(after?.status).toBe('failed');
    expect(after?.error).toBeTruthy();
    expect(await registryRows(h.db)).toHaveLength(0);
    expect((await rowFor(h.db, runId)).active_key).toBeNull();
    // Retained, unlike a cancel: the object is the only evidence of what was actually applied.
    expect(h.blob.delete).not.toHaveBeenCalled();
    expect(h.audited).toEqual([]);
  });

  it('crash recovery covers an interrupted apply, not only an interrupted validate', async () => {
    // `applying` is in RUNNING_RUN_STATES, so `failStaleRunning`'s set-driven sweep already reaches
    // it — pinned here because a run killed mid-apply is the one that holds a NATIONAL register.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const runs = createFacilityImportRunStore(db);
    const run = await runs.startUpload(upload());
    await runs.claimNext('queued', 'validating');
    await runs.completeValidation(run.id, { create: 1 });
    await runs.confirm(run.id, 'awaiting_confirmation', { nationalSystem: SYSTEM });
    await runs.claimNext(APPLY_PHASE.from, APPLY_PHASE.to); // a process killed mid-apply

    const worker = createFacilityImportWorker({
      runs, blob: fakeBlob(CSV), importDeps: { db, capture: referenceCapture },
      intervalMs: 10_000, logger: fakeLogger(),
    });
    await worker.stop();

    const after = await runs.get(run.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/restart/i);
    expect((await rowFor(db, run.id)).active_key).toBeNull();
  });
});
