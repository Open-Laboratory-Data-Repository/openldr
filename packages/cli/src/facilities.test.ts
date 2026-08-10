import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// ⛔ NOT mocked by the `vi.mock('@openldr/db', ...)` below — that mock only replaces the base
// `@openldr/db` specifier; `@openldr/db/testing` is a distinct export path (package.json's
// `exports['./testing']`), so this stays the REAL `makeMigratedDb`. Used by exactly one test (the
// "failed --apply releases the register" proof) that needs a real pg-mem-migrated db, not the fake
// `mocks.runStore` the rest of this file uses.
import { makeMigratedDb } from '@openldr/db/testing';

const mocks = vi.hoisted(() => ({
  ctx: {
    internalDb: { marker: 'internalDb' },
    store: { db: { marker: 'externalDb' } },
    terminology: { admin: { marker: 'admin' } },
    audit: { marker: 'audit' },
    logger: { marker: 'logger' },
    // Task 10: `openldr facilities jobs --retry <id>` calls `ctx.facilityJobs.retry` directly
    // (the OPERATOR's action, never `retryPreservingAttempts` — see facility-job-store.ts).
    // `enqueue` is here for the import command, which must hand this store to `importFacilities`.
    facilityJobs: { retry: vi.fn(), enqueue: vi.fn() },
    close: vi.fn(),
  },
  createAppContext: vi.fn(),
  importFacilities: vi.fn(),
  scanObservedFacilities: vi.fn(),
  publishFacilityMap: vi.fn(),
  listFacilityMappingConflicts: vi.fn(),
  facilityHealth: vi.fn(),
  recordAuditEvent: vi.fn(),
  referenceCapture: { marker: 'referenceCapture' },
  readFileSync: vi.fn(),
  // Task 12: `createFacilityImportRunStore` is a factory (`(db) => store`) — `createFacilityImportRunStore`
  // itself is the vi.fn(), and `runStore` is the fixed object every test's `beforeEach` points it at,
  // matching the shape of `mocks.ctx.facilityJobs` above (a fake collaborator with vi.fn() methods, not
  // a real @openldr/db store). The one test that needs the REAL store (proving `finishApply` actually
  // frees `active_key` — see "a failed --apply leaves no held active_key" below) reaches for the real
  // export via `vi.importActual` instead of this mock, for exactly that call.
  createFacilityImportRunStore: vi.fn(),
  runStore: {
    startPreview: vi.fn(),
    completePreview: vi.fn(),
    finishApply: vi.fn(),
    // A2b Task 9: the four-valued cancel. The CLI's whole job here is to report WHICH of the four
    // came back, so this is mocked per-test rather than given a default.
    requestCancel: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
  importFacilities: mocks.importFacilities,
  scanObservedFacilities: mocks.scanObservedFacilities,
  publishFacilityMap: mocks.publishFacilityMap,
  listFacilityMappingConflicts: mocks.listFacilityMappingConflicts,
  facilityHealth: mocks.facilityHealth,
  recordAuditEvent: mocks.recordAuditEvent,
}));

vi.mock('@openldr/db', () => ({
  referenceCapture: mocks.referenceCapture,
  createFacilityImportRunStore: mocks.createFacilityImportRunStore,
}));

vi.mock('node:fs', () => ({
  readFileSync: mocks.readFileSync,
}));

import {
  runFacilitiesImport, runFacilitiesScanObserved, runFacilitiesPublish, runFacilitiesConflicts, runFacilitiesJobs,
  runFacilitiesImportRuns, runFacilitiesImportRun, runFacilitiesImportRunCancel,
} from './facilities';
// ⛔ TYPE-only, so the `vi.mock('@openldr/db', ...)` above does not apply to it (type imports are
// erased before the module graph is built). It is what makes `DEFAULT_RUN` below an EXHAUSTIVE
// fixture: see the note there.
import type { FacilityImportRun } from '@openldr/db';

// The full `FacilityImportResult` shape (packages/bootstrap/src/facility-import.ts), not just the
// subset the pre-Task-12 CLI printed: `formatHuman` now reads `create`/`changed`/`unchanged`/
// `conflict`/`absent`/`deleted` too, and a mock missing them would print the literal string
// "undefined" into the human-readable output instead of failing loudly — exactly the kind of drift
// a COMPLETE fixture here is meant to catch. `conflict`/`absent` are `null` (not evaluated), matching
// a run with no linked preview watermark and a file that is not `--complete-release`.
const CLEAN_RESULT = {
  parsed: 10, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], invalid: [],
  written: { created: 0, updated: 0, retired: 0 }, duplicates: 0, blocked: false, blockedReason: null,
  create: 0, changed: 0, unchanged: 10, conflict: null, absent: null, deleted: 0,
  samples: { create: [], changed: [], conflict: [], absent: [], deleted: [] },
  runId: null, knownNationalSystem: true,
  // A2a fix wave: release provenance and the controlled-field warnings are part of the result
  // `formatHuman` reads, so a complete fixture has to carry them for the same reason the counters
  // above are here — a missing key would print "undefined" rather than fail.
  meta: null, countMismatch: [], releaseVersion: null,
  unmapped: { level: [], status: [], country: [] }, notValidated: [],
};

// Task 12's default run row, returned by the fake `mocks.runStore.startPreview` unless a test
// overrides it. Only fields `runFacilitiesImport` actually reads (`id`) are load-bearing; the rest
// exist so a test printing the whole object doesn't stumble over missing keys.
//
// ⛔ A2b Task 9: ANNOTATED `: FacilityImportRun`, and that annotation is the only thing pinning this
// CLI's `--json` wire shape. The `--json` tests below assert `JSON.stringify(<this fixture>)`, so a
// hand-built fixture makes them TAUTOLOGIES — they agree with whatever the fixture happens to carry.
// A2b Task 2 widened `FacilityImportRun` with six columns (`blobKey`, `phase`, `processed`, `total`,
// `cancelRequested`, `startedAt`) and every one of them slipped silently past this file, while the
// HTTP route's equivalent assertions (apps/server/src/facilities-routes.test.ts) are exhaustive
// `toEqual`s and had to be widened by hand. The annotation makes the compiler do that job here:
// a column added to the type and not to this object is a `tsc --noEmit` error.
const DEFAULT_RUN: FacilityImportRun = {
  id: 'fir_test1', nationalSystem: 'urn:tz:hfr', sourceFormat: 'csv' as const, fileHash: 'h',
  byteSize: 42, releaseVersion: null, releasePublishedAt: null, declaredRowCount: null,
  declaredDeletionCount: null, status: 'previewed' as const, previewedAt: null, summary: null,
  options: {}, error: null, requestedBy: 'cli', createdAt: '2026-08-01T00:00:00.000Z', finishedAt: null,
  // A2b Task 2's worker columns. Concrete values, matching an INLINE A2a preview: it stores no file,
  // and no worker ever claims one, so there is no phase, no progress, no cancel and no start.
  blobKey: null, phase: null, processed: 0, total: null, cancelRequested: false, startedAt: null,
};

describe('facilities import CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
    mocks.readFileSync.mockReturnValue('national_code,name\n100,Dodoma\n');
    // Task 12: every test gets the fake run store by default — `runFacilitiesImport` calls
    // `createFacilityImportRunStore(ctx.internalDb)` unconditionally (dry run or apply), so any test
    // that reaches that line without this would crash on `createFacilityImportRunStore is not a
    // function`. Only `--apply` tests ever have `startPreview`/`finishApply` actually EXERCISED — see
    // the docblock on `runFacilitiesImport` for why a dry run never calls either.
    mocks.createFacilityImportRunStore.mockReturnValue(mocks.runStore);
    mocks.runStore.startPreview.mockResolvedValue(DEFAULT_RUN);
    mocks.runStore.finishApply.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to a dry run: does not set apply, writes nothing, prints the summary, does not audit, mints no run', async () => {
    mocks.importFacilities.mockResolvedValue(CLEAN_RESULT);

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      { db: mocks.ctx.internalDb, capture: mocks.referenceCapture, admin: mocks.ctx.terminology.admin, facilityJobs: mocks.ctx.facilityJobs, logger: mocks.ctx.logger },
      'national_code,name\n100,Dodoma\n',
      {
        nationalSystem: 'urn:tz:hfr', allowUnknownColumns: undefined, allowMalformedRows: undefined, apply: undefined,
        format: undefined, completeRelease: undefined, onDeleted: undefined, onAbsent: undefined, onConflict: undefined,
        runId: null,
      },
    );
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    // Task 12: a dry run mints NO `facility_import_runs` row — see `runFacilitiesImport`'s own
    // docblock for why (no preview→apply gap to link across two invocations, and minting one anyway
    // would only hold `active_key` for a run this single-shot command can never itself supersede).
    expect(mocks.runStore.startPreview).not.toHaveBeenCalled();
    expect(mocks.runStore.finishApply).not.toHaveBeenCalled();
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/dry run/i);
    expect(human).toMatch(/nothing written|--apply/i);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  // Step 1 (brief): "a dry run prints the create/changed/unchanged summary".
  it('a dry run prints the create/changed/unchanged classification, not just parsed/skipped', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 10, create: 3, changed: 1, unchanged: 6,
    });

    await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/create 3/);
    expect(human).toMatch(/changed 1/);
    expect(human).toMatch(/unchanged 6/);
  });

  // Step 1 (brief), and the ⛔ output constraint: `conflict: null`/`absent: null` must print as "not
  // evaluated", NEVER as `0` — a `0` meaning "not computed" is the exact defect this slice removes.
  it('conflict and absent print as "not evaluated" — never 0 — when the result reports them null', async () => {
    mocks.importFacilities.mockResolvedValue({ ...CLEAN_RESULT, conflict: null, absent: null });

    await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/conflict not evaluated/);
    expect(human).toMatch(/absent not evaluated/);
    expect(human).not.toMatch(/conflict 0\b/);
    expect(human).not.toMatch(/absent 0\b/);
  });

  // Step 1 (brief): "a --complete-release dry run prints the absent count".
  it('--complete-release makes absent a real count once the result reports one', async () => {
    mocks.importFacilities.mockResolvedValue({ ...CLEAN_RESULT, absent: 5 });

    await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', completeRelease: true, json: false });

    expect(mocks.importFacilities).toHaveBeenCalledWith(
      expect.anything(), expect.any(String), expect.objectContaining({ completeRelease: true }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/absent 5/);
    // Only `absent` moved off "not evaluated" — `conflict` stays null on this call (no linked
    // preview watermark), so the phrase legitimately still appears for THAT field.
    expect(human).not.toMatch(/absent not evaluated/);
  });

  it('--apply writes and reports created/updated, and audits the import', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 3, create: 2, changed: 1, unchanged: 0, written: { created: 2, updated: 1 },
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      { db: mocks.ctx.internalDb, capture: mocks.referenceCapture, admin: mocks.ctx.terminology.admin, facilityJobs: mocks.ctx.facilityJobs, logger: mocks.ctx.logger },
      expect.any(String),
      {
        nationalSystem: 'urn:tz:hfr', allowUnknownColumns: undefined, allowMalformedRows: undefined, apply: true,
        format: undefined, completeRelease: undefined, onDeleted: undefined, onAbsent: undefined, onConflict: undefined,
        runId: DEFAULT_RUN.id,
      },
    );
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.ctx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'facility.import',
        entityType: 'facility',
        entityId: 'urn:tz:hfr',
      }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/created 2/);
    expect(human).toMatch(/updated 1/);
  });

  // Task 12: "record a facility_import_runs row" — an --apply mints one BEFORE the write (reserving
  // `active_key` for `opts.nationalSystem`) and finishes it 'applied' with the result as its summary
  // once the write succeeds, mirroring the HTTP route's own `startPreview`/`finishApply` pair.
  it('--apply mints a facility_import_runs row and finishes it applied with the result as summary', async () => {
    mocks.importFacilities.mockResolvedValue(CLEAN_RESULT);

    await runFacilitiesImport(
      '/some/file.csv',
      { nationalSystem: 'urn:tz:hfr', apply: true, format: 'jsonl', releaseVersion: 'r7', json: false },
    );

    expect(mocks.createFacilityImportRunStore).toHaveBeenCalledWith(mocks.ctx.internalDb);
    expect(mocks.runStore.startPreview).toHaveBeenCalledWith(expect.objectContaining({
      nationalSystem: 'urn:tz:hfr', sourceFormat: 'jsonl', releaseVersion: 'r7',
      byteSize: Buffer.byteLength('national_code,name\n100,Dodoma\n', 'utf8'),
    }));
    // `startPreview` runs BEFORE `importFacilities`, so this apply's `runId` reaches the importer.
    const startOrder = mocks.runStore.startPreview.mock.invocationCallOrder[0];
    const importOrder = mocks.importFacilities.mock.invocationCallOrder[0];
    expect(startOrder).toBeLessThan(importOrder);
    expect(mocks.runStore.finishApply).toHaveBeenCalledWith(
      DEFAULT_RUN.id, 'applied', { error: null, summary: CLEAN_RESULT },
    );
  });

  it('surfaces duplicates as a warning, not just a count', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 2, create: 1, changed: 0, unchanged: 1, written: { created: 1, updated: 0 }, duplicates: 1,
    });

    await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/WARNING/);
    expect(human).toMatch(/duplicate/i);
  });

  it('does not print a duplicates warning when duplicates is 0', async () => {
    mocks.importFacilities.mockResolvedValue(CLEAN_RESULT);

    await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).not.toMatch(/WARNING/);
  });

  it('unknown columns without --allow-unknown-columns refuse and name the columns; no audit; run marked failed', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 0, unknownColumns: ['beds', 'foo'], written: { created: 0, updated: 0 },
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/beds/);
    expect(err).toMatch(/foo/);
    expect(err).toMatch(/allow-unknown-columns/);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    // ⛔ The run this apply minted is finished 'failed', not left dangling `previewed` (which would
    // hold `active_key` for `urn:tz:hfr` forever — see the "failed apply releases active_key"
    // integration test below for the DB-level proof of the same invariant).
    expect(mocks.runStore.finishApply).toHaveBeenCalledWith(
      DEFAULT_RUN.id, 'failed', expect.objectContaining({ error: expect.stringMatching(/beds/) }),
    );
  });

  it('--allow-unknown-columns lets an import with unknown columns proceed', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 1, unknownColumns: ['beds'], create: 1, written: { created: 1, updated: 0 },
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, allowUnknownColumns: true, json: false });

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ allowUnknownColumns: true }),
    );
  });

  // Task 5: surface Task 4's `quarantined`/`allowMalformedRows` (facility-import.ts) through the CLI,
  // per the repo's CLI-parity rule — mirrors the unknown-columns refusal above.
  it('quarantined rows without --allow-malformed-rows refuse and print each line/reason; no audit; run marked failed', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 1,
      quarantined: [{ line: 3, reason: 'too_many_fields', raw: '2,Bad,Extra' }],
      written: { created: 0, updated: 0 }, blocked: true, blockedReason: 'quarantined-rows',
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/line 3: too_many_fields — 2,Bad,Extra/);
    expect(err).toMatch(/1 row\(s\) quarantined; re-run with --allow-malformed-rows to import the rest/);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.runStore.finishApply).toHaveBeenCalledWith(DEFAULT_RUN.id, 'failed', expect.objectContaining({ error: expect.any(String) }));
  });

  it('--allow-malformed-rows lets an import with quarantined rows proceed', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 1,
      quarantined: [{ line: 3, reason: 'too_many_fields', raw: '2,Bad,Extra' }],
      create: 1, written: { created: 1, updated: 0 }, blocked: false, blockedReason: null,
    });

    const code = await runFacilitiesImport(
      '/some/file.csv',
      { nationalSystem: 'urn:tz:hfr', apply: true, allowMalformedRows: true, json: false },
    );

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ allowMalformedRows: true }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/created 1/);
  });

  it('--json still refuses on quarantined rows, with quarantined present in the JSON payload', async () => {
    const result = {
      ...CLEAN_RESULT, parsed: 1,
      quarantined: [{ line: 3, reason: 'too_many_fields', raw: '2,Bad,Extra' }],
      written: { created: 0, updated: 0 }, blocked: true, blockedReason: 'quarantined-rows',
    };
    mocks.importFacilities.mockResolvedValue(result);

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: true });

    expect(code).toBe(1);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2) + '\n');
  });

  // ⛔ The block reason with NO override, which this CLI previously had no message for at all: a
  // duplicate-header file printed as an undifferentiated "0 rows found" summary and exit 0, because
  // the only refusal check here was the quarantine one. `result.blocked` is the importer's own
  // verdict (see `FacilityImportResult.blocked`), so the exit code can no longer disagree with
  // whether anything was written, and `blockedReason` keeps the message from pointing an operator at
  // --allow-malformed-rows, which cannot help them here.
  it('duplicate headers refuse with the columns named and no override suggested', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 0, duplicateColumns: ['name'],
      written: { created: 0, updated: 0 }, blocked: true, blockedReason: 'duplicate-columns',
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/duplicate column header\(s\) in \/some\/file\.csv: name/);
    expect(err).not.toMatch(/--allow-malformed-rows/);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('a missing file exits non-zero with a clear message, not a stack trace', async () => {
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, open '/nope.csv'"), { code: 'ENOENT' });
    mocks.readFileSync.mockImplementation(() => {
      throw enoent;
    });

    const code = await runFacilitiesImport('/nope.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(code).toBe(1);
    expect(mocks.createAppContext).not.toHaveBeenCalled();
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/nope\.csv/);
    expect(err).not.toMatch(/at Object|at runFacilitiesImport|\.ts:\d+/); // no stack trace
  });

  it('--json emits the whole machine-readable result, not prose', async () => {
    mocks.importFacilities.mockResolvedValue(CLEAN_RESULT);

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(CLEAN_RESULT, null, 2) + '\n');
  });

  it('--json still refuses on unknown columns, with unknownColumns present in the JSON payload', async () => {
    const result = { ...CLEAN_RESULT, parsed: 0, unknownColumns: ['beds'], written: { created: 0, updated: 0 } };
    mocks.importFacilities.mockResolvedValue(result);

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: true });

    expect(code).toBe(1);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2) + '\n');
  });

  // ⛔ The HTTP import route REFUSES any apply over MAX_INLINE_APPLY_ROWS (2000) and points the
  // operator at THIS command (apps/server/src/facilities-routes.ts), so this is the only path a
  // register of the stated workload size — a 14 000-row national register — is ever applied through.
  // The CLI shipped without `facilityJobs` in its deps, and `importFacilities` gates its enqueue
  // behind `if (deps.facilityJobs)` (packages/bootstrap/src/facility-import.ts), so every import big
  // enough to be the workload wrote the register and queued NO rebuild at all.
  //
  // The mock reproduces exactly that gate rather than asserting on the shape of the deps object: an
  // absent store then shows up here as "no rebuild was queued", which is the actual defect, instead
  // of as a missing key. That the REAL `importFacilities` enqueues once per applied import (and not
  // once per row) is pinned separately, against the real store, in
  // packages/bootstrap/src/facility-import.test.ts.
  it('an applied import hands the job store through, so the rebuild is actually queued', async () => {
    mocks.importFacilities.mockImplementation(async (deps: any, _csv: string, opts: any) => {
      if (opts.apply && deps.facilityJobs) await deps.facilityJobs.enqueue({ kind: 'facility-map-rebuild' });
      return CLEAN_RESULT;
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(0);
    expect(mocks.ctx.facilityJobs.enqueue).toHaveBeenCalledWith({ kind: 'facility-map-rebuild' });
  });

  it('a dry run queues no rebuild — nothing was written for the dimension to catch up to', async () => {
    mocks.importFacilities.mockImplementation(async (deps: any, _csv: string, opts: any) => {
      if (opts.apply && deps.facilityJobs) await deps.facilityJobs.enqueue({ kind: 'facility-map-rebuild' });
      return CLEAN_RESULT;
    });

    await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(mocks.ctx.facilityJobs.enqueue).not.toHaveBeenCalled();
  });

  it('closes the app context even when importFacilities throws, and marks the minted run failed', async () => {
    mocks.importFacilities.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
    expect(mocks.runStore.finishApply).toHaveBeenCalledWith(
      DEFAULT_RUN.id, 'failed', expect.objectContaining({ error: expect.stringMatching(/db exploded/) }),
    );
  });

  it('closes the app context even when importFacilities throws on a dry run (no run to finish)', async () => {
    mocks.importFacilities.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    expect(mocks.runStore.finishApply).not.toHaveBeenCalled();
  });

  it('refuses to start a second concurrent apply for the same register, without crashing', async () => {
    mocks.runStore.startPreview.mockRejectedValue(new Error('an import is already in progress for "urn:tz:hfr"'));

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(1);
    expect(mocks.importFacilities).not.toHaveBeenCalled();
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/already in progress/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  // ⛔ The proof the brief demands: a failed --apply must not leave `active_key` held, or every LATER
  // import of the same register — CLI or browser — 409s against a run nothing will ever finish. This
  // uses the REAL `createFacilityImportRunStore`/db (via `vi.importActual` + a pg-mem-migrated db),
  // not the fake `mocks.runStore` the rest of this file uses — a mock could assert `finishApply` was
  // CALLED (see the two tests above) without proving the call actually released the row at the
  // database. Only a real store closes that gap.
  it('a failed --apply releases the register: active_key is not held afterward', async () => {
    const real = await vi.importActual<typeof import('@openldr/db')>('@openldr/db');
    const db = (await makeMigratedDb()) as unknown as Record<string, unknown>;

    mocks.createAppContext.mockResolvedValueOnce({ ...mocks.ctx, internalDb: db, close: vi.fn().mockResolvedValue(undefined) });
    mocks.createFacilityImportRunStore.mockImplementationOnce((d: never) => real.createFacilityImportRunStore(d));
    mocks.importFacilities.mockRejectedValueOnce(new Error('exploded mid-apply'));

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(1);

    const store = real.createFacilityImportRunStore(db as never);
    const runs = await store.list('urn:tz:hfr');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error).toMatch(/exploded mid-apply/);

    // The invariant itself: `active_key` was released, so a second import of the SAME register can
    // proceed instead of refusing forever.
    await expect(store.startPreview({
      nationalSystem: 'urn:tz:hfr', sourceFormat: 'csv', fileHash: 'h2', byteSize: 1, options: {},
    })).resolves.toMatchObject({ nationalSystem: 'urn:tz:hfr', status: 'previewed' });
    // ⚠ 60s, not the package's 30s default. MEASURED: this test runs in ~3.0s alone but took 31.3s
    // under `turbo run test --force` and timed out, because it is the only test in this package that
    // migrates a real pg-mem database (every internal migration) and that work is starved when 67
    // turbo tasks compete. The slowness is inherent to what it proves — a mock could assert
    // `finishApply` was CALLED without proving the row was released at the database — so the budget
    // is raised rather than the coverage weakened.
  }, 60_000);

  // ⛔ Critical 1, the CLI half. This command used to call `importFacilities` with `apply: true`
  // FIRST and only then decide whether to refuse — so a refused file had already been written by the
  // time "refused" reached the operator's terminal. Combined with the importer's old absence
  // inference (a zero-record file made every registry row look absent), a `--complete-release
  // --on-absent retire` run over a file with one unrecognised column retired an entire national
  // register, printed a refusal, marked the run failed and skipped the audit.
  it('refuses BEFORE applying: no importFacilities call ever carries apply: true', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 0, unknownColumns: ['extra_col'],
    });

    const code = await runFacilitiesImport('/some/file.csv', {
      nationalSystem: 'urn:tz:hfr', apply: true, completeRelease: true, onAbsent: 'retire', json: false,
    });

    expect(code).toBe(1);
    expect(mocks.importFacilities).toHaveBeenCalledTimes(1);
    expect(mocks.importFacilities).not.toHaveBeenCalledWith(
      expect.anything(), expect.any(String), expect.objectContaining({ apply: true }),
    );
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  // 🟠 Important 7: the CSV/JSONL unknown-key contract. `parseFacilityRelease` never blocks on an
  // unrecognised key (each line is self-describing; the key goes to `extras`) and the HTTP route
  // accepts such a file — but this CLI refused it regardless of format, and it is the only path a
  // register above the route's inline-apply cap can be applied through. Now format-aware.
  it('does NOT refuse a JSONL release that grew an unrecognised key', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 2, create: 2, unchanged: 0, unknownColumns: ['newField'],
      written: { created: 2, updated: 0, retired: 0 },
    });

    const code = await runFacilitiesImport('/some/file.jsonl', {
      nationalSystem: 'urn:tz:hfr', apply: true, format: 'jsonl', json: false,
    });

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      expect.anything(), expect.any(String), expect.objectContaining({ apply: true }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/unrecognised key\(s\) carried into extras: newField/);
    // The CSV-only override must not be suggested for a format it does not affect.
    expect(human).not.toMatch(/--allow-unknown-columns/);
  });

  it('still refuses a CSV with an unrecognised column, and names the override', async () => {
    mocks.importFacilities.mockResolvedValue({ ...CLEAN_RESULT, parsed: 0, unknownColumns: ['beds'] });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(code).toBe(1);
    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join('')).toMatch(/--allow-unknown-columns/);
  });

  // 🟠 Important 3: `invalid` reached no human-facing consumer at all — a row rejected for a bad
  // coordinate simply vanished from this output and was visible only under --json.
  it('prints the coordinate errors with their line numbers, and names the override', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT,
      invalid: [
        { line: 4, field: 'latitude', reason: 'not_a_number', raw: 'N/A' },
        { line: 9, field: 'longitude', reason: 'out_of_range', raw: '999' },
      ],
    });

    await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/2 coordinate error\(s\) on line\(s\) 4, 9/);
    expect(human).toMatch(/--allow-invalid-coordinates/);
  });

  it('threads --allow-invalid-coordinates through to importFacilities and says the rows were kept', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, invalid: [{ line: 4, field: 'latitude', reason: 'not_a_number', raw: 'N/A' }],
    });

    await runFacilitiesImport('/some/file.csv', {
      nationalSystem: 'urn:tz:hfr', allowInvalidCoordinates: true, json: false,
    });

    expect(mocks.importFacilities).toHaveBeenCalledWith(
      expect.anything(), expect.any(String), expect.objectContaining({ allowInvalidCoordinates: true }),
    );
    expect(stdoutSpy.mock.calls.map((c) => String(c[0])).join('')).toMatch(/imported anyway with no coordinate/);
  });

  // Minor: an operator running `--on-absent retire` saw an `absent` count and no confirmation at all
  // of the mutation the command actually performed.
  it('reports how many rows were retired, not just how many were absent', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, absent: 3, written: { created: 0, updated: 0, retired: 3 },
    });

    await runFacilitiesImport('/some/file.csv', {
      nationalSystem: 'urn:tz:hfr', apply: true, completeRelease: true, onAbsent: 'retire', json: false,
    });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/retired 3/);
    expect(human).toMatch(/absent 3/);
  });

  // FAC-P1-05: the controlled-field warnings. Unmapped NEVER blocks and NEVER blanks — this output
  // is the only thing that tells an operator a value went in raw.
  it('reports unmapped controlled values and notValidated fields without failing the import', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT,
      unmapped: { level: ['health_center', 'disp.'], status: [], country: [] },
      notValidated: ['country'],
      written: { created: 2, updated: 0, retired: 0 },
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(0);
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/2 unmapped level value\(s\) written as-is: health_center, disp\./);
    expect(human).toMatch(/not validated \(no canonical value set on this install\): country/);
  });

  // 🟠 Important 5: the release's declared counts reached nobody.
  it('warns when the release declares more rows than parsed', async () => {
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 12998, countMismatch: [{ field: 'rowCount', declared: 13000, parsed: 12998 }],
    });

    await runFacilitiesImport('/some/file.jsonl', { nationalSystem: 'urn:tz:hfr', format: 'jsonl', json: false });

    expect(stdoutSpy.mock.calls.map((c) => String(c[0])).join(''))
      .toMatch(/the release declares 13000 row\(s\), 12998 parsed/);
  });
});

// ── Task 12: `openldr facilities import-runs` / `import-run <id>` ─────────────────────────────
describe('facilities import-runs CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  const RUN_OLDER = { ...DEFAULT_RUN, id: 'fir_a', status: 'applied' as const, createdAt: '2026-08-01T00:00:00.000Z', finishedAt: '2026-08-01T00:00:05.000Z' };
  const RUN_NEWER = { ...DEFAULT_RUN, id: 'fir_b', status: 'applied' as const, createdAt: '2026-08-02T00:00:00.000Z', finishedAt: '2026-08-02T00:00:05.000Z' };

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
    mocks.createFacilityImportRunStore.mockReturnValue(mocks.runStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Step 1 (brief): "import-runs lists newest first". Ordering itself is the STORE's contract,
  // already proven against a real db in packages/db/facility-import-run-store.test.ts ("list orders
  // newest first with a unique tiebreaker"); what this test proves is that the CLI prints the rows in
  // the exact order the store handed back, rather than re-sorting or reversing them.
  it('prints runs in the order the store returns them (newest first)', async () => {
    mocks.runStore.list.mockResolvedValue([RUN_NEWER, RUN_OLDER]);

    const code = await runFacilitiesImportRuns({ json: false });

    expect(code).toBe(0);
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human.indexOf('fir_b')).toBeGreaterThanOrEqual(0);
    expect(human.indexOf('fir_b')).toBeLessThan(human.indexOf('fir_a'));
  });

  // A2b Task 9: the list is where an operator LOOKS for a background run, and before this it could
  // not show one — a `validating` run rendered as a status with no indication of what the worker was
  // doing, and the `phase` column the worker publishes (`updateProgress`, facility-import-run-store.ts)
  // reached no human-facing surface at all.
  it('renders a job-path run: its new status AND the phase the worker published', async () => {
    mocks.runStore.list.mockResolvedValue([
      { ...DEFAULT_RUN, id: 'fir_live', status: 'validating' as const, phase: 'parsing', processed: 4200, total: 13000, finishedAt: null },
    ]);

    const code = await runFacilitiesImportRuns({ json: false });

    expect(code).toBe(0);
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/validating/);
    expect(human).toMatch(/parsing/);
    // And the column is labelled, so the value is not an unexplained extra token on the row.
    expect(human).toMatch(/phase/);
  });

  it('passes --national-system and --limit through to the store', async () => {
    mocks.runStore.list.mockResolvedValue([]);

    await runFacilitiesImportRuns({ nationalSystem: 'urn:tz:hfr', limit: 5, json: false });

    expect(mocks.createFacilityImportRunStore).toHaveBeenCalledWith(mocks.ctx.internalDb);
    expect(mocks.runStore.list).toHaveBeenCalledWith('urn:tz:hfr', 5);
  });

  it('says so plainly when there is nothing to show, rather than an empty table', async () => {
    mocks.runStore.list.mockResolvedValue([]);

    const code = await runFacilitiesImportRuns({ json: false });

    expect(code).toBe(0);
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/no facility import runs/i);
  });

  it('--json emits the whole machine-readable list, not prose', async () => {
    mocks.runStore.list.mockResolvedValue([RUN_NEWER]);

    const code = await runFacilitiesImportRuns({ json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify([RUN_NEWER], null, 2) + '\n');
  });

  it('never audits — it is read-only', async () => {
    mocks.runStore.list.mockResolvedValue([RUN_NEWER]);

    await runFacilitiesImportRuns({ json: false });

    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('closes the app context even when the store throws, and reports a redacted message', async () => {
    mocks.runStore.list.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesImportRuns({ json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
  });
});

describe('facilities import-run CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  const RUN_DETAIL = { ...DEFAULT_RUN, id: 'fir_a', status: 'applied' as const, summary: { create: 3, changed: 1 } };

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
    mocks.createFacilityImportRunStore.mockReturnValue(mocks.runStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints one run\'s detail, including its stored summary', async () => {
    mocks.runStore.get.mockResolvedValue(RUN_DETAIL);

    const code = await runFacilitiesImportRun('fir_a', { json: false });

    expect(code).toBe(0);
    expect(mocks.runStore.get).toHaveBeenCalledWith('fir_a');
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/fir_a/);
    expect(human).toMatch(/applied/);
    expect(human).toMatch(/"create":3/);
  });

  // A2b Task 9: the detail view is the only place a shell-only operator can watch a background run,
  // and A2b Task 2's worker columns reached none of it — `phase`/`processed`/`total`/`startedAt`
  // were readable under `--json` and nowhere else.
  it('prints a job-path run\'s phase, progress, start and pending cancel', async () => {
    mocks.runStore.get.mockResolvedValue({
      ...DEFAULT_RUN, id: 'fir_live', status: 'applying' as const, phase: 'writing',
      processed: 4200, total: 13000, cancelRequested: true, startedAt: '2026-08-01T00:00:03.000Z',
    });

    const code = await runFacilitiesImportRun('fir_live', { json: false });

    expect(code).toBe(0);
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/phase: writing/);
    expect(human).toMatch(/4200/);
    expect(human).toMatch(/13000/);
    expect(human).toMatch(/2026-08-01T00:00:03\.000Z/);
    expect(human).toMatch(/cancel requested/i);
  });

  // The other half of the line above: a run with no pending cancel must NOT say one is pending.
  it('does not claim a cancel is pending when none was requested', async () => {
    mocks.runStore.get.mockResolvedValue(RUN_DETAIL);

    await runFacilitiesImportRun('fir_a', { json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).not.toMatch(/cancel requested/i);
  });

  it('exits non-zero for an unknown run id, without a stack trace', async () => {
    mocks.runStore.get.mockResolvedValue(null);

    const code = await runFacilitiesImportRun('fir_nope', { json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/no such facility import run: fir_nope/);
  });

  it('--json emits the whole machine-readable run', async () => {
    mocks.runStore.get.mockResolvedValue(RUN_DETAIL);

    const code = await runFacilitiesImportRun('fir_a', { json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(RUN_DETAIL, null, 2) + '\n');
  });

  // ⛔ The `--json` assertion above compares against `JSON.stringify(<the fixture>)`, so it agrees
  // with whatever the fixture carries — it cannot notice a column that never reached the fixture.
  // `DEFAULT_RUN`'s `: FacilityImportRun` annotation is what stops the fixture drifting from the
  // type; this names the six A2b Task 2 columns explicitly so the wire shape is pinned by an
  // assertion too, not only by the compiler.
  it('--json carries the worker columns, not just the A2a ones', async () => {
    mocks.runStore.get.mockResolvedValue(RUN_DETAIL);

    await runFacilitiesImportRun('fir_a', { json: true });

    const payload = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(''));
    for (const key of ['blobKey', 'phase', 'processed', 'total', 'cancelRequested', 'startedAt']) {
      expect(Object.keys(payload)).toContain(key);
    }
  });

  it('--json still reports an unknown id as an error payload with a non-zero exit', async () => {
    mocks.runStore.get.mockResolvedValue(null);

    const code = await runFacilitiesImportRun('fir_nope', { json: true });

    expect(code).toBe(1);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify({ error: 'no such facility import run: fir_nope' }) + '\n');
  });

  it('closes the app context even when the store throws, and reports a redacted message', async () => {
    mocks.runStore.get.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesImportRun('fir_a', { json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
  });
});

// ── A2b Task 9: `openldr facilities import-run-cancel <id>` ───────────────────────────────────
//
// CLI parity for `POST /api/facilities/import/runs/:id/cancel` (apps/server/src/facilities-routes.ts),
// which answers FOUR different things and takes care never to overstate any of them: 200 `cancelled`
// (carried out — the run is terminal and its register free), 202 `requested` (a worker holds it; the
// flag is read at a phase boundary and cannot interrupt a running transaction, so the run may still
// finish `applied`), 404 and 409. A CLI has no status line, so exit codes carry that distinction —
// and collapsing any two of them is exactly the overstatement the route's two success codes exist to
// prevent.
describe('facilities import-run-cancel CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
    mocks.createFacilityImportRunStore.mockReturnValue(mocks.runStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('\'cancelled\' is reported as a FACT: the run is stopped and its register released', async () => {
    mocks.runStore.requestCancel.mockResolvedValue('cancelled');

    const code = await runFacilitiesImportRunCancel('fir_a', { json: false });

    expect(mocks.createFacilityImportRunStore).toHaveBeenCalledWith(mocks.ctx.internalDb);
    expect(mocks.runStore.requestCancel).toHaveBeenCalledWith('fir_a');
    expect(code).toBe(0);
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/\bcancelled\b/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  // ⛔ THE honesty property this command exists to preserve. A worker holds the run, the flag is
  // observed only at a phase boundary, and a write already inside its transaction will finish — so
  // the run may still end `applied`. Telling the operator it was "cancelled" would be a forecast
  // dressed as a fact, about a national register that may have just been rewritten.
  it('\'requested\' never claims the run was cancelled, and says it may still finish', async () => {
    mocks.runStore.requestCancel.mockResolvedValue('requested');

    const code = await runFacilitiesImportRunCancel('fir_a', { json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/requested/i);
    expect(human).toMatch(/may still|still finish/i);
    expect(human).not.toMatch(/\bcancelled\b/);
    // And its own exit code — a script asking "is this run stopped?" must not read 0 here.
    expect(code).not.toBe(0);
  });

  it('an unknown id is reported as such, on stderr, without a stack trace', async () => {
    mocks.runStore.requestCancel.mockResolvedValue('not-found');

    const code = await runFacilitiesImportRunCancel('fir_nope', { json: false });

    expect(code).not.toBe(0);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/no such facility import run: fir_nope/);
    expect(err).not.toMatch(/at Object|\.ts:\d+/);
  });

  // A cancel arriving after the write CANNOT be honoured, and an applied run stays applied. The
  // route answers 409 rather than a cheerful no-op for exactly this reason.
  it('a run that already finished is refused, not reported as cancelled', async () => {
    mocks.runStore.requestCancel.mockResolvedValue('already-terminal');

    const code = await runFacilitiesImportRunCancel('fir_done', { json: false });

    expect(code).not.toBe(0);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/already finished/i);
  });

  // ⛔ THE mutation guard. Each of the four outcomes means something different to a script and to a
  // person, so each gets its own exit code and its own sentence. Collapsing any two — most
  // temptingly `cancelled` and `requested`, which are both "the cancel was accepted" — is the defect
  // this whole surface exists to prevent, and it is invisible to any test that checks one outcome at
  // a time.
  it('maps the four store outcomes onto four DISTINCT exit codes and four distinct messages', async () => {
    const outcomes = ['cancelled', 'requested', 'not-found', 'already-terminal'] as const;
    const codes: number[] = [];
    const messages: string[] = [];

    for (const outcome of outcomes) {
      stdoutSpy.mockClear();
      stderrSpy.mockClear();
      mocks.runStore.requestCancel.mockResolvedValue(outcome);
      codes.push(await runFacilitiesImportRunCancel('fir_a', { json: false }));
      messages.push(
        stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
          + stderrSpy.mock.calls.map((c) => String(c[0])).join(''),
      );
    }

    expect(new Set(codes).size).toBe(4);
    expect(new Set(messages).size).toBe(4);
    // ...and the exit code that means "an unexpected failure" everywhere else in this CLI is not
    // reused for any of them, so `1` keeps meaning what the catch block below makes it mean.
    expect(codes).not.toContain(1);
  });

  // The machine-readable surface has to carry the same distinction the prose does — a script reading
  // `--json` must be able to tell "stopped" from "asked to stop" without parsing English.
  it('--json emits the outcome verbatim for both live answers', async () => {
    for (const outcome of ['cancelled', 'requested'] as const) {
      stdoutSpy.mockClear();
      mocks.runStore.requestCancel.mockResolvedValue(outcome);

      await runFacilitiesImportRunCancel('fir_a', { json: true });

      const payload = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(''));
      expect(payload).toEqual({ runId: 'fir_a', outcome });
    }
  });

  it('--json reports the two refusals as an error payload', async () => {
    for (const outcome of ['not-found', 'already-terminal'] as const) {
      stdoutSpy.mockClear();
      mocks.runStore.requestCancel.mockResolvedValue(outcome);

      const code = await runFacilitiesImportRunCancel('fir_a', { json: true });

      expect(code).not.toBe(0);
      const payload = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(''));
      expect(payload.error).toEqual(expect.any(String));
      expect(payload.outcome).toBeUndefined();
    }
  });

  // Matches the route, which audits both live outcomes and records WHICH one: an operator asking a
  // national register's import to stop is a decision worth an actor even when the import goes on to
  // finish anyway.
  it('audits facility.import.cancelled with the outcome, on both live answers', async () => {
    for (const outcome of ['cancelled', 'requested'] as const) {
      mocks.recordAuditEvent.mockClear();
      mocks.runStore.requestCancel.mockResolvedValue(outcome);

      await runFacilitiesImportRunCancel('fir_a', { json: false });

      expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
        mocks.ctx,
        expect.objectContaining({ actorType: 'cli' }),
        expect.objectContaining({
          action: 'facility.import.cancelled',
          entityType: 'facility',
          entityId: 'fir_a',
          metadata: expect.objectContaining({ outcome }),
        }),
      );
    }
  });

  it('audits nothing when there was no live run to cancel', async () => {
    for (const outcome of ['not-found', 'already-terminal'] as const) {
      mocks.recordAuditEvent.mockClear();
      mocks.runStore.requestCancel.mockResolvedValue(outcome);

      await runFacilitiesImportRunCancel('fir_a', { json: false });

      expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    }
  });

  it('closes the app context even when the store throws, and reports a redacted message', async () => {
    mocks.runStore.requestCancel.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesImportRunCancel('fir_a', { json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
    expect(err).not.toMatch(/at Object|\.ts:\d+/);
  });
});

const RECONCILE_DEPS = { internalDb: mocks.ctx.internalDb, externalDb: mocks.ctx.store.db, admin: mocks.ctx.terminology.admin };

describe('facilities scan-observed CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-runs by default: does not set apply, prints discovered/created/updated, does not audit', async () => {
    mocks.scanObservedFacilities.mockResolvedValue({ discovered: 5, created: 2, updated: 1, systemRegistered: true });

    const code = await runFacilitiesScanObserved({ json: false });

    expect(code).toBe(0);
    expect(mocks.scanObservedFacilities).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: undefined });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/dry run/i);
    expect(human).toMatch(/nothing written|--apply/i);
    expect(human).toMatch(/discovered 5/);
    expect(human).toMatch(/created 2/);
    expect(human).toMatch(/updated 1/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('dry-runs by default via --json and prints counts (brief Step 1)', async () => {
    mocks.scanObservedFacilities.mockResolvedValue({ discovered: 5, created: 2, updated: 1, systemRegistered: true });

    const code = await runFacilitiesScanObserved({ json: true });

    expect(code).toBe(0);
    expect(mocks.scanObservedFacilities).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: undefined });
    const printed = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(JSON.parse(printed)).toMatchObject({ discovered: expect.any(Number), created: expect.any(Number) });
  });

  it('--apply writes and audits facility.scan', async () => {
    mocks.scanObservedFacilities.mockResolvedValue({ discovered: 5, created: 2, updated: 1, systemRegistered: true });

    const code = await runFacilitiesScanObserved({ apply: true, json: false });

    expect(code).toBe(0);
    expect(mocks.scanObservedFacilities).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.ctx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'facility.scan', entityType: 'facility' }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/created 2/);
    expect(human).toMatch(/updated 1/);
  });

  it('--json emits the whole machine-readable result', async () => {
    const result = { discovered: 0, created: 0, updated: 0, systemRegistered: false };
    mocks.scanObservedFacilities.mockResolvedValue(result);

    const code = await runFacilitiesScanObserved({ json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2) + '\n');
  });

  it('closes the app context even when scanObservedFacilities throws, and reports a redacted message', async () => {
    mocks.scanObservedFacilities.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesScanObserved({ json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
  });
});

describe('facilities publish CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-runs by default: does not set apply, prints resolved/unmapped/targetMissing/written, does not audit', async () => {
    mocks.publishFacilityMap.mockResolvedValue({ resolved: 8, unmapped: 3, targetMissing: 1, nonFacilityTarget: 2, ambiguous: 1, written: 12 });

    const code = await runFacilitiesPublish({ json: false });

    expect(code).toBe(0);
    expect(mocks.publishFacilityMap).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: undefined });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/dry run/i);
    expect(human).toMatch(/nothing written|--apply/i);
    expect(human).toMatch(/resolved 8/);
    expect(human).toMatch(/unmapped 3/);
    expect(human).toMatch(/targetMissing 1/);
    // Task 10: `ambiguous` gets its own count in the human line. Folded into `unmapped` it would
    // tell an operator to go author a mapping, when the fix is to REMOVE one of the two they have.
    expect(human).toMatch(/nonFacilityTarget 2/);
    expect(human).toMatch(/ambiguous 1/);
    expect(human).toMatch(/written 12/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('--apply writes and audits facility.publish', async () => {
    mocks.publishFacilityMap.mockResolvedValue({ resolved: 8, unmapped: 3, targetMissing: 1, nonFacilityTarget: 2, ambiguous: 1, written: 12 });

    const code = await runFacilitiesPublish({ apply: true, json: false });

    expect(code).toBe(0);
    expect(mocks.publishFacilityMap).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.ctx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'facility.publish', entityType: 'facility' }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/written 12/);
  });

  it('--json emits the whole machine-readable result', async () => {
    const result = { resolved: 0, unmapped: 0, targetMissing: 0, written: 0 };
    mocks.publishFacilityMap.mockResolvedValue(result);

    const code = await runFacilitiesPublish({ json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2) + '\n');
  });

  it('closes the app context even when publishFacilityMap throws, and reports a redacted message', async () => {
    mocks.publishFacilityMap.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesPublish({ json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
  });
});

// ── Task 13: `openldr facilities conflicts` ────────────────────────────────────────────────────
//
// CLI parity for `GET /api/facilities/mapping-conflicts` (apps/server/src/facilities-routes.ts) —
// both call the SAME `listFacilityMappingConflicts` (@openldr/bootstrap), mocked here for the same
// reason every other run* function's collaborator is: this file is about what the CLI wrapper does
// with the result, not about the query.
const CONFLICT = {
  id: 1,
  fromSystem: 'urn:openldr:cs:observed-facility',
  fromCode: 'BALAB',
  kind: 'duplicate',
  mappingIds: ['tm-1', 'tm-2'],
  detail: [{ id: 'tm-1', toCode: 'fac-A' }, { id: 'tm-2', toCode: 'fac-B' }],
  detectedAt: new Date('2026-08-07T00:00:00.000Z'),
};

describe('facilities conflicts CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints from_system, from_code, kind and mapping_ids for each unresolved conflict', async () => {
    mocks.listFacilityMappingConflicts.mockResolvedValue([CONFLICT]);

    const code = await runFacilitiesConflicts({ json: false });

    expect(code).toBe(0);
    expect(mocks.listFacilityMappingConflicts).toHaveBeenCalledWith({ internalDb: mocks.ctx.internalDb });
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/urn:openldr:cs:observed-facility/);
    expect(human).toMatch(/BALAB/);
    expect(human).toMatch(/duplicate/);
    // The mapping ids are the actionable part — they are what an operator looks up to decide which
    // of the competing rows to remove. Printing a count instead would make the line unusable.
    expect(human).toMatch(/tm-1/);
    expect(human).toMatch(/tm-2/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('says so plainly when there is nothing to review, rather than printing a bare header', async () => {
    mocks.listFacilityMappingConflicts.mockResolvedValue([]);

    const code = await runFacilitiesConflicts({ json: false });

    expect(code).toBe(0);
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/no unresolved facility mapping conflicts/i);
  });

  // Read-only: an empty queue is the healthy state, not an error. Exiting non-zero would break any
  // script that runs this as a check.
  it('exits 0 on an empty queue', async () => {
    mocks.listFacilityMappingConflicts.mockResolvedValue([]);
    expect(await runFacilitiesConflicts({ json: true })).toBe(0);
  });

  it('never audits — it writes nothing', async () => {
    mocks.listFacilityMappingConflicts.mockResolvedValue([CONFLICT]);

    await runFacilitiesConflicts({ json: false });

    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('--json emits the whole machine-readable result', async () => {
    mocks.listFacilityMappingConflicts.mockResolvedValue([CONFLICT]);

    const code = await runFacilitiesConflicts({ json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify([CONFLICT], null, 2) + '\n');
  });

  it('closes the app context even when the query throws, and reports a redacted message', async () => {
    mocks.listFacilityMappingConflicts.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesConflicts({ json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
  });
});

// ── Task 10: `openldr facilities jobs [--retry <id>]` ──────────────────────────────────────────
//
// CLI parity for `GET /api/facilities/health` and `POST /api/facilities/jobs/:id/retry`
// (apps/server/src/facilities-routes.ts) — both surface Task 9's `facilityHealth`
// (@openldr/bootstrap), and both re-queue through `ctx.facilityJobs.retry` (the OPERATOR's action,
// resetting `attempts`), mocked here for the same reason every other run* function's collaborator
// is: this file is about what the CLI wrapper does with the result, not about the query itself.
const HEALTH_CURRENT = {
  reportDimension: { state: 'current', lastSuccessAt: '2026-08-07T00:00:00.000Z', rows: 88, error: null, jobId: null },
  projection: { failedCount: 0, failed: [] },
};

const HEALTH_FAILED = {
  reportDimension: { state: 'failed', lastSuccessAt: '2026-08-06T00:00:00.000Z', rows: 42, error: 'warehouse unreachable', jobId: 'fj_rebuild1' },
  projection: {
    failedCount: 1,
    failed: [{ id: 'fj_proj1', registryId: 'fac-A', lastError: 'terminology store unreachable' }],
  },
};

describe('facilities jobs CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
    mocks.ctx.facilityJobs.retry.mockResolvedValue('requeued');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the report-dimension state', async () => {
    mocks.facilityHealth.mockResolvedValue(HEALTH_CURRENT);

    const code = await runFacilitiesJobs({ json: false });

    expect(code).toBe(0);
    expect(mocks.facilityHealth).toHaveBeenCalledWith({ internalDb: mocks.ctx.internalDb, jobs: mocks.ctx.facilityJobs });
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/current/);
    expect(human).toMatch(/88/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('prints a failed state with its error and the separate projection-failure count', async () => {
    mocks.facilityHealth.mockResolvedValue(HEALTH_FAILED);

    const code = await runFacilitiesJobs({ json: false });

    expect(code).toBe(0);
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/failed/);
    expect(human).toMatch(/warehouse unreachable/);
    expect(human).toMatch(/1/); // failedCount
  });

  // ⛔ `--retry <id>` needs an id, and a shell-only operator had no way to obtain one: the
  // dimension's `jobId` was in the payload but never printed, and the failed PROJECTIONS had no id
  // in the payload at all — so the "N facility mappings need attention" signal named nothing that
  // could be acted on. Both ids, and the command to use them, are printed now.
  it('prints every retryable job id, so --retry has something to be given', async () => {
    mocks.facilityHealth.mockResolvedValue(HEALTH_FAILED);

    await runFacilitiesJobs({ json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/--retry fj_rebuild1/);
    expect(human).toMatch(/--retry fj_proj1/);
    // And the failed projection names the facility it is about, not just an opaque job id.
    expect(human).toMatch(/fac-A/);
    expect(human).toMatch(/terminology store unreachable/);
  });

  it('does not retry anything when --retry is not passed', async () => {
    mocks.facilityHealth.mockResolvedValue(HEALTH_CURRENT);

    await runFacilitiesJobs({ json: false });

    expect(mocks.ctx.facilityJobs.retry).not.toHaveBeenCalled();
  });

  it('--retry <id> re-queues the job before reporting the (now updated) state', async () => {
    mocks.facilityHealth.mockResolvedValue(HEALTH_CURRENT);

    const code = await runFacilitiesJobs({ retry: 'fj_abc123', json: false });

    expect(code).toBe(0);
    expect(mocks.ctx.facilityJobs.retry).toHaveBeenCalledWith('fj_abc123');
    // Re-queue happens before the state is read, not after — otherwise the printed state would
    // still show the pre-retry (failed) job.
    const retryOrder = mocks.ctx.facilityJobs.retry.mock.invocationCallOrder[0];
    const healthOrder = mocks.facilityHealth.mock.invocationCallOrder[0];
    expect(retryOrder).toBeLessThan(healthOrder);
  });

  it('--json emits the whole machine-readable health payload', async () => {
    mocks.facilityHealth.mockResolvedValue(HEALTH_CURRENT);

    const code = await runFacilitiesJobs({ json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(HEALTH_CURRENT, null, 2) + '\n');
  });

  it('never audits — it is a read (or a re-queue), not a mutation of the register itself', async () => {
    mocks.facilityHealth.mockResolvedValue(HEALTH_CURRENT);

    await runFacilitiesJobs({ retry: 'fj_abc123', json: false });

    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('closes the app context even when facilityHealth throws, and reports a redacted message', async () => {
    mocks.facilityHealth.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesJobs({ json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
  });

  // ⛔ `retry` does not throw for these two — it REPORTS them (see facility-job-store.ts's
  // `FacilityJobRetryOutcome`). Before the outcome was read, both printed the health payload and
  // exited 0, telling an operator their retry had been accepted when nothing was re-queued. These
  // are the exit-code equivalents of the HTTP route's 409 and 404.
  it('--retry on a RUNNING job refuses with a non-zero exit instead of reporting success', async () => {
    mocks.ctx.facilityJobs.retry.mockResolvedValue('running');
    mocks.facilityHealth.mockResolvedValue(HEALTH_CURRENT);

    const code = await runFacilitiesJobs({ retry: 'fj_running', json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/already running/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('--retry on an unknown job id refuses with a non-zero exit', async () => {
    mocks.ctx.facilityJobs.retry.mockResolvedValue('not-found');
    mocks.facilityHealth.mockResolvedValue(HEALTH_CURRENT);

    const code = await runFacilitiesJobs({ retry: 'fj_nope', json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/no such job: fj_nope/);
  });

  it('closes the app context even when retry throws, and reports a redacted message', async () => {
    mocks.ctx.facilityJobs.retry.mockRejectedValue(new Error('job not found'));

    const code = await runFacilitiesJobs({ retry: 'fj_nope', json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/job not found/);
  });
});
